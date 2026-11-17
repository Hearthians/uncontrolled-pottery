"""Foreground browser collection using a persistent, normally authenticated profile.

No request signing, captcha solving, or authentication bypass is performed. Response
adapters only inspect documented shapes of posts, never arbitrary nested objects.
"""
from __future__ import annotations

import re
import time
from datetime import time as clock_time, timedelta, timezone
from pathlib import Path
from urllib.parse import urlencode, urlparse

from .normalize import CollectorError, date_window, in_window, platform_name, post
from .x_api import write_jsonl


def _objects(value: object) -> list[dict]:
    return [item for item in value if isinstance(item, dict)] if isinstance(value, list) else []


def _weibo_statuses(payload: dict) -> list[dict]:
    data = payload.get("data") if isinstance(payload.get("data"), dict) else payload
    rows = _objects(data.get("statuses"))
    if data.get("created_at") and (data.get("idstr") or data.get("id")):
        rows.append(data)
    for card in _objects(data.get("cards")):
        if isinstance(card.get("mblog"), dict):
            rows.append(card["mblog"])
        for child in _objects(card.get("card_group")):
            if isinstance(child.get("mblog"), dict):
                rows.append(child["mblog"])
    return rows


def _xhs_items(payload: dict) -> list[dict]:
    data = payload.get("data") or {}
    if not isinstance(data, dict):
        return []
    return _objects(data.get("items")) + _objects(data.get("notes"))


def _x_tweets(payload: dict) -> list[dict]:
    data = payload.get("data") or {}
    if not isinstance(data, dict):
        return []
    search = data.get("search_by_raw_query") or {}
    timeline = (search.get("search_timeline") or {}).get("timeline") or {}
    rows = []
    for instruction in _objects(timeline.get("instructions")):
        entries = _objects(instruction.get("entries"))
        if isinstance(instruction.get("entry"), dict):
            entries.append(instruction["entry"])
        for entry in entries:
            content = entry.get("content") or {}
            containers = [content]
            containers.extend((child.get("item") or {}) for child in _objects(content.get("items")))
            for container in containers:
                item = container.get("itemContent") or {}
                tweet = (item.get("tweet_results") or {}).get("result") or {}
                if tweet.get("__typename") == "TweetWithVisibilityResults":
                    tweet = tweet.get("tweet") or {}
                if isinstance(tweet.get("legacy"), dict):
                    rows.append(tweet)
    return rows


def extract_posts(platform: str, payload: dict, query: str = "") -> list[dict]:
    """Adapt known Weibo/XHS/X response shapes; search summaries without dates wait for detail."""
    platform = platform_name(platform)
    if not isinstance(payload, dict):
        return []
    results = []
    rows = {"weibo": _weibo_statuses, "xiaohongshu": _xhs_items, "x": _x_tweets}[platform](payload)
    for row in rows:
        try:
            if platform == "weibo":
                user = row.get("user") or {}
                item = post(platform, row.get("idstr") or row.get("id") or row.get("mid"), row.get("text_raw") or row.get("text"), row.get("created_at"), author_id=user.get("idstr") or user.get("id"), likes=row.get("attitudes_count"), comments=row.get("comments_count"), shares=row.get("reposts_count"), raw=row, query=query)
            elif platform == "xiaohongshu":
                note = row.get("note_card") or row
                user = note.get("user") or {}
                metrics = note.get("interact_info") or {}
                title = note.get("title") or note.get("display_title") or ""
                body = note.get("desc") or ""
                content = f"{title}\n{body}".strip() if title != body else body
                item = post(platform, row.get("id") or row.get("note_id") or note.get("note_id"), content, note.get("time") or note.get("publish_time") or note.get("publish_date"), author_id=user.get("user_id") or user.get("userId"), likes=metrics.get("liked_count"), comments=metrics.get("comment_count"), shares=metrics.get("share_count"), raw=row, query=query)
            else:
                legacy = row["legacy"]
                user = ((row.get("core") or {}).get("user_results") or {}).get("result") or {}
                note_text = (((row.get("note_tweet") or {}).get("note_tweet_results") or {}).get("result") or {}).get("text")
                item = post(platform, row.get("rest_id") or legacy.get("id_str"), note_text or legacy.get("full_text") or legacy.get("text"), legacy.get("created_at"), author_id=legacy.get("user_id_str") or user.get("rest_id"), likes=legacy.get("favorite_count"), comments=legacy.get("reply_count"), shares=legacy.get("retweet_count"), raw=row, query=query)
            results.append(item)
        except (ValueError, TypeError, AttributeError, OverflowError):
            # Incomplete summaries are not eligible samples until a detail response arrives.
            continue
    return results


def _xhs_links(payload: dict) -> list[str]:
    links = []
    for item in _xhs_items(payload):
        identity = item.get("id") or item.get("note_id")
        if identity and re.fullmatch(r"[a-fA-F0-9]{24}", str(identity)):
            token = item.get("xsec_token")
            suffix = "?" + urlencode({"xsec_token": token, "xsec_source": "pc_search"}) if token else ""
            links.append(f"https://www.xiaohongshu.com/explore/{identity}{suffix}")
    return links


def _response_allowed(platform: str, url: str) -> bool:
    parsed = urlparse(url)
    host = parsed.hostname or ""
    if platform == "weibo":
        return (host == "weibo.com" or host.endswith(".weibo.com") or host == "m.weibo.cn") and parsed.path.startswith(("/ajax/side/search", "/ajax/search/", "/ajax/statuses/", "/api/container/getIndex", "/api/statuses/show"))
    if platform == "xiaohongshu":
        return (host == "xiaohongshu.com" or host.endswith(".xiaohongshu.com")) and bool(re.fullmatch(r"/api/sns/web/v[12]/(?:search/notes|feed)", parsed.path))
    return (host == "x.com" or host.endswith(".x.com") or host == "twitter.com") and "/graphql/" in parsed.path and parsed.path.endswith("/SearchTimeline")


def _check_page(page: object) -> None:
    url = page.url.lower()
    if any(marker in url for marker in ("/captcha", "/challenge", "/account/access", "/verify")):
        raise CollectorError("平台要求安全验证；请停止采集，在正常浏览器中处理后重试")
    for selector in ('[class*="captcha"]', '#captcha', '#pl_common_sassfilter'):
        if page.locator(selector).first.is_visible():
            raise CollectorError("平台出现验证码或访问限制；采集已停止")
    if any(marker in url for marker in ("/i/flow/login", "passport.weibo", "/login.php")):
        raise CollectorError("需要先登录平台；请使用同一个 profile_dir 完成正常登录后重试")
    for selector in (".login-container", ".login-modal", ".login-mask"):
        if page.locator(selector).first.is_visible():
            raise CollectorError("平台要求登录；请先在持久浏览器资料中正常登录后重试")


_WEIBO_DOM = """() => Array.from(document.querySelectorAll('.card-wrap[mid]')).map(card => {
  const content = card.querySelector('[node-type="feed_list_content_full"]') || card.querySelector('[node-type="feed_list_content"]');
  const date = card.querySelector('.from a');
  const author = card.querySelector('.info a.name');
  return {id:card.getAttribute('mid'), text:content?.innerText, date:date?.getAttribute('title') || date?.innerText,
    url:date?.href || '', author_url:author?.href || ''};
})"""
_X_DOM = """() => Array.from(document.querySelectorAll('article[data-testid="tweet"]')).map(card => {
  const date = card.querySelector('time'); const link = date?.closest('a');
  return {url:link?.href || '', date:date?.getAttribute('datetime'), text:card.querySelector('[data-testid="tweetText"]')?.innerText};
})"""
_XHS_LINK_DOM = r"""() => Array.from(document.querySelectorAll('section.note-item a[href]')).map(a=>a.href).filter(url=>/\/(explore|search_result)\/[a-f0-9]{24}/i.test(url))"""


def build_browser_search_url(platform: str, query: str, start: str, end: str) -> str:
    """Return a search URL covering the study window; exact filtering follows capture."""
    platform = platform_name(platform)
    begin, finish = date_window(start, end, platform)
    if platform == "weibo":
        china = timezone(timedelta(hours=8))
        first_day = begin.astimezone(china).date()
        last_day = (finish - timedelta(microseconds=1)).astimezone(china).date()
        return "https://s.weibo.com/weibo?" + urlencode({"q": query, "timescope": f"custom:{first_day}:{last_day}", "Refer": "g"})
    if platform == "xiaohongshu":
        return "https://www.xiaohongshu.com/search_result?" + urlencode({"keyword": query, "source": "web_search_result_notes"})
    # X's date operators use UTC whole days. Expand outwards so the first eight
    # hours of a Chinese date are not lost, then apply in_window to every record.
    since_day = begin.date()
    until_day = finish.date()
    if finish.time() != clock_time.min:
        until_day += timedelta(days=1)
    search = f"{query} since:{since_day} until:{until_day}"
    return "https://x.com/search?" + urlencode({"q": search, "src": "typed_query", "f": "live"})


def _validate_proxy_server(value: str) -> str:
    """Accept a browser proxy address without putting user input in exceptions."""
    message = "proxy-server 必须为 http、https 或 socks5 代理地址，且不能包含账号密码、路径或查询参数"
    try:
        parsed = urlparse(value)
        if (
            parsed.scheme not in {"http", "https", "socks5"}
            or not parsed.hostname
            or parsed.username is not None
            or parsed.password is not None
            or parsed.path not in {"", "/"}
            or parsed.params or parsed.query or parsed.fragment
            or any(ord(character) < 33 for character in value)
        ):
            raise ValueError(message)
        # Accessing port validates malformed/out-of-range port numbers.
        parsed.port
    except (ValueError, TypeError, AttributeError):
        raise ValueError(message) from None
    return value.rstrip("/")


def collect_browser(platform: str, query: str, start: str, end: str, profile_dir: str | Path, output_path: str | Path, limit: int = 200, *, timeout_seconds: int = 180, headless: bool = False, executable_path: str | Path | None = None, proxy_server: str | None = None) -> list[dict]:
    """Collect a bounded sample using a persistent profile; end is exclusive.

    Search ranking limits historical coverage. A short result is returned as a short
    result: no fabricated timestamps, repeating posts, or automatic year relaxation.
    XHS opens detail pages because search summaries often omit publication times.
    Visible Chromium is the default. Optional headless mode reuses the same profile
    and stops on the same login/challenge conditions as a visible browser.
    """
    platform = platform_name(platform)
    if limit < 1 or timeout_seconds < 1:
        raise ValueError("limit 和 timeout_seconds 必须为正整数")
    browser_proxy = _validate_proxy_server(proxy_server) if proxy_server is not None else None
    window = date_window(start, end, platform)
    try:
        from playwright.sync_api import sync_playwright
    except ImportError:
        raise CollectorError("浏览器采集需要 playwright；安装后运行 playwright install chromium") from None
    directory = Path(profile_dir).expanduser().resolve()
    directory.mkdir(parents=True, exist_ok=True)
    url = build_browser_search_url(platform, query, start, end)
    unique: dict[str, dict] = {}
    detail_links: dict[str, str] = {}
    faults: list[str] = []

    def remember(item: dict) -> None:
        if in_window(item, window) and len(unique) < limit:
            unique.setdefault(item["post_id"], item)

    def response_received(response: object) -> None:
        if not _response_allowed(platform, response.url):
            return
        if response.status in {401, 403, 429}:
            faults.append(f"平台接口返回 HTTP {response.status}；请检查登录状态或访问限制")
            return
        if response.status != 200:
            return
        try:
            payload = response.json()
        except Exception:
            return
        for item in extract_posts(platform, payload, query):
            remember(item)
        if platform == "xiaohongshu" and isinstance(payload, dict):
            for link in _xhs_links(payload):
                detail_links.setdefault(urlparse(link).path.rsplit("/", 1)[-1], link)

    deadline = time.monotonic() + timeout_seconds
    try:
        with sync_playwright() as playwright:
            launch_options = {"headless": headless, "viewport": {"width": 1360, "height": 900}, "locale": "zh-CN"}
            if executable_path is not None:
                launch_options["executable_path"] = str(Path(executable_path).expanduser())
            if browser_proxy is not None:
                launch_options["proxy"] = {"server": browser_proxy}
            context = playwright.chromium.launch_persistent_context(str(directory), **launch_options)
            try:
                context.on("response", response_received)
                page = context.pages[0] if context.pages else context.new_page()
                page.goto(url, wait_until="domcontentloaded", timeout=45000)
                page.wait_for_timeout(1800)
                idle = 0
                previous_count = (-1, -1)
                page_number = 1
                while len(unique) < limit and time.monotonic() < deadline:
                    _check_page(page)
                    if faults:
                        raise CollectorError(faults[0])
                    if platform in {"weibo", "x"}:
                        for row in page.evaluate(_WEIBO_DOM if platform == "weibo" else _X_DOM):
                            try:
                                identity = row.get("id") if platform == "weibo" else re.search(r"/status/(\d+)", row.get("url", "")).group(1)
                                remember(post(platform, identity, row.get("text"), row.get("date"), url=row.get("url", ""), raw={"source": "visible_search_dom", **row}, query=query))
                            except (ValueError, AttributeError, TypeError, OverflowError):
                                continue
                    else:
                        for link in page.evaluate(_XHS_LINK_DOM):
                            parsed = urlparse(link)
                            if parsed.hostname == "www.xiaohongshu.com":
                                detail_links.setdefault(parsed.path.rsplit("/", 1)[-1], link)
                    after = (len(unique), len(detail_links))
                    idle = idle + 1 if after == previous_count else 0
                    previous_count = after
                    if platform == "xiaohongshu" and (len(detail_links) >= max(limit * 2, 20) or idle >= 3):
                        break
                    if platform == "weibo":
                        if idle >= 2 or page_number >= 50:
                            break
                        next_page = page.locator('a.next').first
                        if not next_page.is_visible():
                            break
                        next_page.click(timeout=10000)
                        page_number += 1
                        page.wait_for_timeout(1200)
                    else:
                        if idle >= 5:
                            break
                        page.mouse.wheel(0, 1000)
                        page.wait_for_timeout(1000)
                if platform == "xiaohongshu":
                    for identity, link in list(detail_links.items()):
                        if len(unique) >= limit or time.monotonic() >= deadline:
                            break
                        if identity in unique:
                            continue
                        page.goto(link, wait_until="domcontentloaded", timeout=30000)
                        page.wait_for_timeout(1200)
                        _check_page(page)
                        if faults:
                            raise CollectorError(faults[0])
            finally:
                context.close()
    except (CollectorError, KeyboardInterrupt):
        write_jsonl(output_path, list(unique.values()))
        raise
    except Exception:
        write_jsonl(output_path, list(unique.values()))
        raise CollectorError("浏览器采集失败；请检查 Chromium 安装、桌面环境、网络与 profile 是否被占用；已保存采到的记录") from None
    result = list(unique.values())
    write_jsonl(output_path, result)
    return result
