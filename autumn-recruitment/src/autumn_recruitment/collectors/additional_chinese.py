"""Public Chinese-platform adapters, retaining originals and explicit blockers.

Discovery snippets never count as complete study entries. Nowcoder records come
from a normal detail page's exact contentData; Bilibili records require a normal
video detail response, rather than the search description (which can truncate).
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from collections import Counter
from html.parser import HTMLParser
import json
from pathlib import Path
import re
import time
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode, urljoin, urlsplit, urlunsplit
from urllib.request import Request, urlopen

from .normalize import CollectorError, plain_text, timestamp

CHINA = timezone(timedelta(hours=8))
NOWCODER_SOURCE_FIELDS = frozenset({
    "id", "uuid", "entityId", "title", "content", "createdAt", "createTime", "editTime", "userId", "authorId",
})


class PublicAccessBlocked(CollectorError):
    """A real access restriction; the caller must stop this source."""


class PublicFetcher:
    def __init__(self, evidence_dir: str | Path, *, interval: float = 1.2):
        self.directory = Path(evidence_dir)
        self.directory.mkdir(parents=True, exist_ok=True)
        self.interval = interval
        self.last_request = 0.0
        self.requests: list[dict] = []
        self.blocked_hosts: set[str] = set()

    def get(self, url: str, name: str = "public") -> tuple[bytes, dict]:
        parsed = urlsplit(url)
        if (parsed.scheme != "https" or parsed.hostname not in {"www.nowcoder.com", "api.bilibili.com", "www.zhihu.com"}
                or parsed.username is not None or parsed.password is not None):
            raise ValueError("Only ordinary HTTPS platform URLs are supported")
        if parsed.hostname in self.blocked_hosts:
            raise PublicAccessBlocked("该入口已触发访问限制，本轮不会再次请求")
        pause = self.interval - (time.monotonic() - self.last_request)
        if pause > 0:
            time.sleep(pause)
        self.last_request = time.monotonic()
        request = Request(url, headers={"User-Agent": "Mozilla/5.0", "Accept": "text/html,application/json;q=0.9,*/*;q=0.8"})
        try:
            with urlopen(request, timeout=25) as response:
                body, status, actual_url = response.read(), response.status, response.url
        except HTTPError as exc:
            body, status, actual_url = exc.read(), exc.code, exc.url
            exc.close()
        except (URLError, TimeoutError) as exc:
            raise CollectorError("公开入口网络连接失败；已保存的记录可继续使用") from exc
        stem = f"{len(self.requests):04d}-{re.sub(r'[^a-zA-Z0-9_-]', '-', name)}"
        evidence = {"url": url, "final_url": actual_url, "status": status,
                    "collected_at": datetime.now(timezone.utc).isoformat(), "response_file": stem + ".response",
                    "bytes": len(body)}
        (self.directory / evidence["response_file"]).write_bytes(body)
        (self.directory / (stem + ".json")).write_text(json.dumps(evidence, ensure_ascii=False, indent=2), encoding="utf-8")
        self.requests.append(evidence)
        if status in {401, 403, 412, 429}:
            self.blocked_hosts.add(parsed.hostname)
            raise PublicAccessBlocked(f"公开入口返回 HTTP {status}；本轮已停止该来源")
        if status != 200:
            raise CollectorError(f"公开入口返回 HTTP {status}")
        return body, evidence


def season_window(year: int) -> tuple[datetime, datetime]:
    return datetime(year, 8, 1, tzinfo=CHINA), datetime(year, 11, 18, tzinfo=CHINA)


def _record(platform: str, identity: object, body: object, published: object, url: str, *, author_id: object,
            query: str, raw: dict, entry_type: str, updated: object = None) -> dict:
    text = plain_text(body)
    if not identity or len(text) < 6 or not published:
        raise ValueError("完整记录必须有ID、正文及原始发表时间")
    result = {"platform": platform, "post_id": str(identity), "text": text,
              "published_at": timestamp(published, "weibo"), "url": url,
              "author_id": str(author_id) if author_id is not None else None,
              "entry_type": entry_type, "thread_id": str(identity), "parent_id": None,
              "language": "zh", "market_region": "China", "query": query,
              "raw": raw, "text_complete": True, "collected_at": datetime.now(timezone.utc).isoformat()}
    if updated:
        result["updated_at"] = timestamp(updated, "weibo")
    return result


def nowcoder_state(html: str) -> dict:
    """Read JSON embedded by the ordinary server-rendered page, without eval."""
    match = re.search(r"window\.__INITIAL_STATE__\s*=\s*(.*?);\(function\(", html, re.DOTALL)
    if not match:
        return {}
    try:
        value = json.loads(match.group(1))
    except json.JSONDecodeError:
        return {}
    return value if isinstance(value, dict) else {}


def normalize_nowcoder_state(state: object, source_url: str, query: str = "") -> list[dict]:
    if not isinstance(state, dict) or not isinstance(state.get("prefetchData"), dict):
        return []
    parsed = urlsplit(source_url)
    if parsed.hostname != "www.nowcoder.com" or parsed.scheme != "https":
        return []
    match = re.fullmatch(r"/(?:feed/main/detail/([a-fA-F0-9]{32})|discuss/(\d+))/?", parsed.path)
    if not match:
        return []
    expected = match.group(1) or match.group(2)
    for component in state["prefetchData"].values():
        common = component.get("ssrCommonData") if isinstance(component, dict) else None
        note = common.get("contentData") if isinstance(common, dict) else None
        if not isinstance(note, dict):
            continue
        identity = str(note.get("uuid") or note.get("id") or "")
        identities = {str(note.get(key)) for key in ("uuid", "id", "entityId") if note.get(key) is not None}
        if expected not in identities:
            continue
        # Never substitute editTime/showTime or a search card's yearless date.
        published = note.get("createdAt") or note.get("createTime")
        if not note.get("content") or not published:
            continue
        title = plain_text(note.get("title"))
        content = plain_text(note["content"])
        if not content:
            # Image-only posts need a separate transcription workflow.
            continue
        text = f"{title}\n{content}".strip() if title != content else content
        canonical = urlunsplit(("https", parsed.hostname, parsed.path, "", ""))
        try:
            user = note.get("userBrief") if isinstance(note.get("userBrief"), dict) else {}
            return [_record("nowcoder", identity, text, published, canonical,
                            author_id=note.get("userId") or note.get("authorId") or user.get("userId"), query=query,
                            raw={"source": "ordinary_detail_ssr_contentData",
                                 "contentData": {key: value for key, value in note.items() if key in NOWCODER_SOURCE_FIELDS}},
                            entry_type="post", updated=note.get("editTime"))]
        except (ValueError, TypeError, OverflowError):
            continue
    return []


class _NowcoderLinks(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.links: dict[str, None] = {}

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag != "a":
            return
        url = urljoin("https://www.nowcoder.com", dict(attrs).get("href") or "")
        parsed = urlsplit(url)
        if (parsed.scheme == "https" and parsed.hostname == "www.nowcoder.com"
                and re.fullmatch(r"/(?:feed/main/detail/[a-fA-F0-9]{32}|discuss/\d+)/?", parsed.path)):
            self.links[urlunsplit(("https", parsed.hostname, parsed.path, "", ""))] = None


def nowcoder_search_links(html: str) -> list[str]:
    parser = _NowcoderLinks()
    parser.feed(html)
    return list(parser.links)


def normalize_bilibili_detail(payload: object, *, expected_bvid: str, query: str = "") -> list[dict]:
    """Accept the normal video-detail shape, never a truncated search snippet."""
    if not isinstance(payload, dict) or payload.get("code") != 0:
        return []
    data = payload.get("data")
    if not isinstance(data, dict) or data.get("bvid") != expected_bvid or not data.get("pubdate"):
        return []
    description = plain_text(data.get("desc"))
    if len(description) < 6 or description in {"-", "--", "暂无简介"}:
        return []
    title = plain_text(data.get("title"))
    owner = data.get("owner") if isinstance(data.get("owner"), dict) else {}
    try:
        result = _record("bilibili", expected_bvid, f"{title}\n{description}".strip(), data["pubdate"],
                         f"https://www.bilibili.com/video/{expected_bvid}", author_id=owner.get("mid"),
                         query=query, raw={"source": "ordinary_video_detail", "data": data}, entry_type="video_description")
        result["aid"] = data.get("aid")
        return [result]
    except (ValueError, TypeError, OverflowError):
        return []


def write_records(path: str | Path, records: list[dict]) -> None:
    destination = Path(path)
    destination.parent.mkdir(parents=True, exist_ok=True)
    temporary = destination.with_name(destination.name + ".tmp")
    with temporary.open("w", encoding="utf-8") as handle:
        for record in records:
            handle.write(json.dumps(record, ensure_ascii=False) + "\n")
    temporary.replace(destination)


def _nowcoder_in_study(item: dict, years: set[int]) -> int | None:
    try:
        moment = datetime.fromisoformat(item["published_at"])
        if moment.tzinfo is None or moment > datetime.now(timezone.utc):
            return None
        year = moment.astimezone(CHINA).year
        start, end = season_window(year)
        parsed = urlsplit(item["url"])
        if (item.get("platform") != "nowcoder" or not item.get("post_id") or not item.get("text_complete")
                or not item.get("text") or parsed.scheme != "https" or parsed.hostname != "www.nowcoder.com"
                or parsed.username is not None or parsed.password is not None
                or not re.fullmatch(r"/(?:feed/main/detail/[a-fA-F0-9]{32}|discuss/\d+)/?", parsed.path)
                or year not in years or not start <= moment < end):
            return None
        return year
    except (KeyError, TypeError, ValueError, OverflowError):
        return None


def collect_nowcoder_with_page(page, *, output: str | Path, evidence_dir: str | Path,
                               years: tuple[int, ...] = (2022, 2023, 2024, 2025, 2026),
                               per_year: int = 40, resume: str | Path | None = None,
                               max_seconds: float = 600, interval: float = 1.2,
                               search_pages: int = 3) -> dict:
    """Collect ordinary anonymous pages using a caller-owned Playwright page.

    There are no login, cookie, proxy, signature or challenge-solving options.
    Queries discover candidates; only the detail's original timestamp assigns
    its year. Public search snippets and page recommendations never supply text.
    """
    if (not years or any(type(year) is not int or not 2000 <= year <= 2100 for year in years)
            or type(per_year) is not int or per_year < 1 or not 1 <= search_pages <= 10
            or max_seconds <= 0 or not 0 <= interval <= 10):
        raise ValueError("Invalid collection years, quota, time budget or interval")
    destination, directory = Path(output), Path(evidence_dir)
    directory.mkdir(parents=True, exist_ok=True)
    checkpoint = directory / "summary.json"
    run_id = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S%fZ")
    selected_years = set(years)
    posts: dict[str, dict] = {}
    visited: set[str] = set()
    events: list[dict] = []
    requested, last_request = 0, 0.0
    deadline = time.monotonic() + max_seconds
    blocked = None
    if resume is not None:
        for line in Path(resume).read_text(encoding="utf-8").splitlines():
            if not line.strip():
                continue
            item = json.loads(line)
            if not isinstance(item, dict) or _nowcoder_in_study(item, selected_years) is None:
                continue
            raw = item.get("raw", {})
            note = raw.get("contentData", {}) if isinstance(raw, dict) else {}
            if not isinstance(note, dict):
                note = {}
            item["raw"] = {"source": "ordinary_detail_ssr_contentData",
                           "contentData": {key: value for key, value in note.items() if key in NOWCODER_SOURCE_FIELDS}}
            posts[str(item["post_id"])] = item
            visited.add(item["url"])

    def counts() -> Counter:
        return Counter(_nowcoder_in_study(item, selected_years) for item in posts.values())

    def save(status: str) -> dict:
        write_records(destination, list(posts.values()))
        summary = {"platform": "nowcoder", "status": status, "records": len(posts),
                   "counts": dict(counts()), "target_per_year": per_year, "raw_file": str(destination),
                   "shortfalls": {year: max(0, per_year - counts()[year]) for year in sorted(selected_years)},
                   "requests": requested, "events": events[-15:], "blocked": blocked,
                   "updated_at": datetime.now(timezone.utc).isoformat()}
        checkpoint.write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8")
        return summary

    def fetch(url: str, *, search: bool = False) -> str:
        nonlocal requested, last_request
        if time.monotonic() >= deadline:
            raise TimeoutError("collection time budget reached")
        pause = interval - (time.monotonic() - last_request)
        if pause > 0:
            time.sleep(pause)
        last_request = time.monotonic()
        requested += 1
        response = page.goto(url, wait_until="domcontentloaded", timeout=30000)
        if response is None:
            raise CollectorError("普通页面未返回文档响应")
        status = response.status
        html = response.text()
        stem = f"{run_id}-{requested:04d}"
        (directory / f"{stem}.html").write_text(html, encoding="utf-8", errors="backslashreplace")
        actual = urlsplit(page.url)
        metadata = {"url": url, "actual_url": urlunsplit((actual.scheme, actual.netloc, actual.path, "", "")),
                    "status": status, "collected_at": datetime.now(timezone.utc).isoformat(),
                    "response_file": f"{stem}.html"}
        (directory / f"{stem}.json").write_text(json.dumps(metadata, ensure_ascii=False, indent=2), encoding="utf-8")
        title = re.search(r"<title[^>]*>(.*?)</title>", html, re.IGNORECASE | re.DOTALL)
        denied_title = title and re.search(r"安全验证|访问验证|人机验证|access denied|just a moment", title[1], re.IGNORECASE)
        if (status in {401, 403, 412, 429} or actual.hostname != "www.nowcoder.com"
                or re.search(r"/(?:captcha|verify|challenge|login|signin|passport)(?:/|$)", actual.path, re.IGNORECASE)
                or denied_title):
            raise PublicAccessBlocked(f"普通公开页面要求验证或拒绝访问（HTTP {status}）；已停止该来源")
        if status != 200:
            return ""
        page.wait_for_timeout(900)
        if search and not nowcoder_search_links(html):
            html = page.content()
            # Browser DOM strings can contain a lone UTF-16 surrogate. Preserve
            # it as an escape in diagnostics instead of aborting valid records.
            (directory / f"{stem}.rendered.html").write_text(html, encoding="utf-8", errors="backslashreplace")
        return html

    try:
        for year in sorted(selected_years):
            if counts()[year] >= per_year:
                continue
            queries = [f"{year}秋招", f"{year + 1}届秋招", f"{str(year + 1)[-2:]}届秋招",
                       f"{str(year + 1)[-2:]}秋招进度", f"{year}秋招总结"]
            for query in queries:
                if counts()[year] >= per_year:
                    break
                for number in range(1, search_pages + 1):
                    if counts()[year] >= per_year:
                        break
                    url = "https://www.nowcoder.com/search/all?" + urlencode({"query": query, "page": number})
                    links = nowcoder_search_links(fetch(url, search=True))
                    events.append({"event": "search", "query": query, "page": number, "links": len(links)})
                    if not links:
                        break
                    for link in links:
                        if counts()[year] >= per_year:
                            break
                        if link in visited:
                            continue
                        visited.add(link)
                        for item in normalize_nowcoder_state(nowcoder_state(fetch(link)), link, query):
                            actual_year = _nowcoder_in_study(item, selected_years)
                            if actual_year is None or counts()[actual_year] >= per_year:
                                continue
                            if not re.search(r"秋招|校招|求职|面试|offer|应届|招聘", item["text"], re.IGNORECASE):
                                continue
                            posts[item["post_id"]] = item
                        save("collecting")
        return save("finished")
    except PublicAccessBlocked as exc:
        blocked = {"type": "PublicAccessBlocked", "message": str(exc)}
        return save("blocked")
    except TimeoutError:
        return save("time_budget_reached")
    except Exception as exc:
        # Browser errors can contain arbitrary page content; retain the class only.
        blocked = {"type": type(exc).__name__, "message": "普通页面加载失败；本轮停止，保留已收集记录"}
        return save("stopped")


def main(argv: list[str] | None = None) -> int:
    """Independent CLI, optional dependency: pip install -e '.[browser]'."""
    import argparse
    parser = argparse.ArgumentParser(description="牛客普通匿名页面采集；遇登录/验证/访问限制即停止")
    parser.add_argument("platform", choices=["nowcoder"])
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--evidence-dir", required=True, type=Path)
    parser.add_argument("--years", nargs="+", type=int, default=[2022, 2023, 2024, 2025, 2026])
    parser.add_argument("--per-year", type=int, default=40)
    parser.add_argument("--resume", type=Path)
    parser.add_argument("--max-seconds", type=float, default=600)
    parser.add_argument("--interval", type=float, default=1.2)
    parser.add_argument("--browser-executable")
    parser.add_argument("--headed", action="store_true")
    args = parser.parse_args(argv)
    try:
        from playwright.sync_api import sync_playwright
    except ImportError:
        parser.error("请先安装 browser 可选依赖并运行 python -m playwright install chromium")
    with sync_playwright() as playwright:
        options = {"headless": not args.headed}
        if args.browser_executable:
            options["executable_path"] = args.browser_executable
        browser = playwright.chromium.launch(**options)
        try:
            page = browser.new_page(locale="zh-CN")
            summary = collect_nowcoder_with_page(page, output=args.output, evidence_dir=args.evidence_dir,
                                                 years=tuple(args.years), per_year=args.per_year, resume=args.resume,
                                                 max_seconds=args.max_seconds, interval=args.interval)
        finally:
            browser.close()
    print(json.dumps(summary, ensure_ascii=False, indent=2))
    return 0 if summary["status"] in {"finished", "time_budget_reached"} else 2


if __name__ == "__main__":
    raise SystemExit(main())
