"""Bounded public-API collection for independent overseas employment comparisons.

Run directly with ``--platform hackernews|workplace --stage probe|collect``.
No account, browser profile, database, or model credentials are read. Search
responses and original-source observations are cached under data/raw/additional.
"""
from __future__ import annotations

import argparse
from collections import Counter, defaultdict
from datetime import datetime, timezone, timedelta
import hashlib
from html import unescape
from html.parser import HTMLParser
import json
from pathlib import Path
import re
import time
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode, urlsplit
from urllib.request import Request, urlopen


ROOT = Path(__file__).resolve().parents[3]
CHINA = timezone(timedelta(hours=8))
YEARS = list(range(2022, 2027))
HN_QUERIES = ['"new grad"', '"job search"', '"hiring freeze"', '"job market"']
WORKPLACE_QUERIES = ["interview", "hiring", "job search", "job offer", "recruitment", "layoff"]
EMPLOYMENT = re.compile(r"\b(?:job\s+(?:market|search|hunt|offer|application)|new\s+grads?|graduate|hiring|interview|unemploy\w*|recruit\w*|resume|résumé|laid\s+off|layoffs?|career|looking\s+for\s+(?:a\s+)?(?:job|work)|applications?)\b", re.I)
AD_THREAD = re.compile(r"who is hiring|who wants to be hired|freelancer.*(?:seeking|hiring)|hiring.*freelancer", re.I)
HN_EMPLOYMENT_CONTEXT = re.compile(r"\b(?:jobs?|jobless|hiring|unemploy\w*|employ\w*|career\w*|layoffs?|recruit\w*|graduates?|grads?|interviews?|resume|résumé|salar\w*)\b", re.I)
PERSONAL_JOB_EXPERIENCE = re.compile(r"\b(?:I(?:'m|'ve| am| have| was| had| applied| interviewed| got| graduated)|my (?:job|career|resume|interview|application|offer|degree|search))\b.{0,100}\b(?:jobs?|interview\w*|hiring|employ\w*|offers?|resume)\b", re.I | re.S)


def now() -> str:
    return datetime.now(timezone.utc).isoformat()


class BodyParser(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.parts = []

    def handle_starttag(self, tag, attrs):
        if tag in {"p", "br", "li", "blockquote", "div"}:
            self.parts.append("\n")

    def handle_data(self, data):
        self.parts.append(data)


def text_of(value: object) -> str:
    parser = BodyParser()
    parser.feed(str(value or ""))
    value = unescape("".join(parser.parts))
    return re.sub(r"\n\s*\n+", "\n\n", re.sub(r"[ \t\r]+", " ", value)).strip()


def window(year: int) -> tuple[int, int]:
    return int(datetime(year, 8, 1, tzinfo=CHINA).timestamp()), int(datetime(year, 11, 18, tzinfo=CHINA).timestamp())


def month_windows(year: int) -> list[tuple[int, int]]:
    return [(int(datetime(year, month, 1, tzinfo=CHINA).timestamp()),
             int(datetime(year, month + 1, 1, tzinfo=CHINA).timestamp()) if month < 11 else window(year)[1])
            for month in range(8, 12)]


def in_year(moment: int | float, year: int) -> bool:
    begin, end = window(year)
    return begin <= moment < end


def substantive(body: str) -> bool:
    return len(body) >= 80 and len(re.findall(r"[A-Za-z]", body)) >= 45 and bool(EMPLOYMENT.search(body))


class CollectionStopped(RuntimeError):
    pass


class PublicAPI:
    def __init__(self, root: Path = ROOT, delay: float = .35):
        self.root = root
        self.raw = root / "data/raw/additional/api-cache"
        self.raw.mkdir(parents=True, exist_ok=True)
        self.diagnostics = root / "data/diagnostics"
        self.diagnostics.mkdir(parents=True, exist_ok=True)
        self.last_request = 0.0
        self.delay = delay
        self.backoff_until = 0.0
        self.quota_remaining = None
        self.requests = 0

    def log(self, event: dict):
        with (self.diagnostics / "additional-overseas-requests.jsonl").open("a", encoding="utf-8") as handle:
            handle.write(json.dumps({"at": now(), **event}, ensure_ascii=False) + "\n")

    def get(self, url: str):
        host = urlsplit(url).hostname
        if host not in {"hn.algolia.com", "hacker-news.firebaseio.com", "api.stackexchange.com"}:
            raise ValueError("Only the configured public API hosts are supported.")
        name = hashlib.sha256(url.encode()).hexdigest()
        cache = self.raw / f"{name}.json"
        if cache.is_file():
            return json.loads(cache.read_text(encoding="utf-8"))
        if host == "api.stackexchange.com":
            wait = self.backoff_until - time.monotonic()
            if wait > 60:
                raise CollectionStopped("Stack Exchange requested a backoff longer than 60 seconds; stopped without another request.")
            if wait > 0:
                time.sleep(wait)
            if self.quota_remaining is not None and self.quota_remaining < 2:
                raise CollectionStopped("Stack Exchange remaining public quota is below 2; stopped.")
        for attempt in range(3):
            wait = self.delay - (time.monotonic() - self.last_request)
            if wait > 0:
                time.sleep(wait)
            self.last_request = time.monotonic()
            self.requests += 1
            request = Request(url, headers={"User-Agent": "AutumnRecruitmentResearch/0.1", "Accept": "application/json"})
            try:
                with urlopen(request, timeout=25) as response:
                    payload = response.read()
                    status = response.status
                data = json.loads(payload)
                cache.write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")
                self.log({"url": url, "status": status, "cache": name})
                if host == "api.stackexchange.com" and isinstance(data, dict):
                    self.quota_remaining = data.get("quota_remaining", self.quota_remaining)
                    backoff = data.get("backoff", 0)
                    if isinstance(backoff, (int, float)) and backoff > 0:
                        self.backoff_until = time.monotonic() + backoff
                        self.log({"event": "backoff", "seconds": backoff})
                    if data.get("error_id"):
                        raise CollectionStopped(f"Stack Exchange reported API error {data['error_id']}.")
                return data
            except HTTPError as exc:
                code = exc.code
                body = exc.read()
                exc.close()
                (self.raw / f"{name}.error-response").write_bytes(body)
                self.log({"url": url, "status": code})
                if code in {403, 429}:
                    raise CollectionStopped(f"Public API returned HTTP {code}; collection stopped.") from None
                if code in {500, 502, 503, 504} and attempt < 2:
                    time.sleep(2 ** attempt)
                    continue
                raise CollectionStopped(f"Public API returned HTTP {code}.") from None
            except (URLError, TimeoutError, OSError, json.JSONDecodeError):
                self.log({"url": url, "event": "network_or_json_error", "attempt": attempt + 1})
                if attempt < 2:
                    time.sleep(2 ** attempt)
                    continue
                raise CollectionStopped("Public API network/JSON request failed after bounded retries.") from None


def hn_candidate(hit: dict, year: int) -> dict | None:
    identity = str(hit.get("objectID") or "")
    moment = hit.get("created_at_i")
    if not identity.isdigit() or not isinstance(moment, (int, float)) or not in_year(moment, year):
        return None
    kind = "comment" if "comment" in hit.get("_tags", []) else "story"
    body = text_of(hit.get("comment_text") if kind == "comment" else hit.get("story_text"))
    title = hit.get("story_title") or hit.get("title") or ""
    if (AD_THREAD.search(title) or not substantive(body)
            or not (HN_EMPLOYMENT_CONTEXT.search(title) or PERSONAL_JOB_EXPERIENCE.search(body))):
        return None
    return {"id": identity, "kind": kind, "body": body, "title": title, "time": moment, "hit": hit}


def normalize_hn(candidate: dict, original: dict, query: str, year: int) -> dict | None:
    if (not isinstance(original, dict) or str(original.get("id")) != candidate["id"] or original.get("deleted")
            or original.get("dead") or original.get("type") not in {"story", "comment"}
            or original.get("type") != candidate["kind"] or original.get("time") != candidate["time"]
            or not original.get("by") or not in_year(original["time"], year)):
        return None
    body = text_of(original.get("text"))
    if not substantive(body):
        return None
    if original["type"] == "story":
        if original.get("url") or not body:
            return None  # External-link headlines are not author opinions.
        title = original.get("title") or ""
        if AD_THREAD.search(title):
            return None
        body = f"{title}\n\n{body}".strip()
        thread, parent = candidate["id"], None
    else:
        thread = str(candidate["hit"].get("story_id") or "")
        parent = str(original.get("parent") or "")
        if not thread.isdigit() or not parent.isdigit():
            return None
        indexed_parent = candidate["hit"].get("parent_id")
        if indexed_parent is not None and str(indexed_parent) != parent:
            return None
    return {"platform": "hackernews", "post_id": candidate["id"], "text": body,
            "published_at": datetime.fromtimestamp(original["time"], timezone.utc).isoformat(),
            "season_year": year, "url": f"https://news.ycombinator.com/item?id={candidate['id']}",
            "author_id": str(original["by"]), "entry_type": original["type"], "thread_id": thread,
            "parent_id": parent, "thread_title": candidate["title"], "language": "en",
            "market_region": "international_unspecified", "query": query,
            "raw": {"source": "algolia_search_and_official_hn_firebase", "search_hit": candidate["hit"], "item": original},
            "collected_at": now()}


def normalize_workplace(item: dict, year: int, query: str, *, question: dict | None = None) -> dict | None:
    kind = "answer" if item.get("answer_id") is not None else "question"
    identity = item.get("answer_id") if kind == "answer" else item.get("question_id")
    moment = item.get("creation_date")
    body = text_of(item.get("body"))
    title = unescape((question or item).get("title") or "")
    if not identity or not isinstance(moment, (int, float)) or not in_year(moment, year):
        return None
    if not substantive(body) or AD_THREAD.search(title):
        return None
    owner = item.get("owner") or {}
    author = owner.get("user_id")
    if author is None:
        return None  # The per-author cap cannot be applied to anonymous users.
    question_id = str(item.get("question_id") or (question or {}).get("question_id") or "")
    if not question_id:
        return None
    return {"platform": "workplace", "post_id": f"{kind}:{identity}",
            "text": f"{title}\n\n{body}".strip() if kind == "question" else body,
            "published_at": datetime.fromtimestamp(moment, timezone.utc).isoformat(), "season_year": year,
            "url": item.get("link") or f"https://workplace.stackexchange.com/a/{identity}",
            "author_id": str(author), "entry_type": kind, "thread_id": question_id,
            "parent_id": question_id if kind == "answer" else None, "thread_title": title,
            "language": "en", "market_region": "international_unspecified", "query": query,
            "content_license": item.get("content_license"),
            "updated_at": datetime.fromtimestamp(item["last_edit_date"], timezone.utc).isoformat() if isinstance(item.get("last_edit_date"), (int, float)) else None,
            "raw": {"source": "official_stackexchange_api", "item": item, "question": question}, "collected_at": now()}


def stable_order(posts: list[dict]) -> list[dict]:
    buckets = defaultdict(list)
    for post in posts:
        moment = datetime.fromisoformat(post["published_at"]).astimezone(CHINA)
        buckets[moment.month].append(post)
    for rows in buckets.values():
        rows.sort(key=lambda p: hashlib.sha256(f"20261117:{p['post_id']}".encode()).hexdigest())
    result = []
    while any(buckets.values()):
        for month in sorted(buckets):
            if buckets[month]:
                result.append(buckets[month].pop())
    return result


class Collector:
    def __init__(self, api: PublicAPI, platform: str, target: int, max_thread: int = 4):
        self.api, self.platform, self.target, self.max_thread = api, platform, target, max_thread
        self.output = api.root / "data/raw/additional" / f"{platform}-posts.jsonl"
        self.posts = {}
        if self.output.is_file():
            self.posts = {post["post_id"]: post for post in (json.loads(line) for line in self.output.read_text(encoding="utf-8").splitlines())}
            if platform == "hackernews":
                # A probe can reveal search noise. Preserve its complete file,
                # but reapply the current context rule before filling quotas.
                removed = [p for p in self.posts.values() if hn_candidate(p.get("raw", {}).get("search_hit", {}), p["season_year"]) is None]
                if removed:
                    archive = self.output.with_name(f"hackernews-before-context-review-{datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S%fZ')}.jsonl")
                    archive.write_bytes(self.output.read_bytes())
                    for post in removed:
                        del self.posts[post["post_id"]]
                    self.output.write_text("".join(json.dumps(p, ensure_ascii=False) + "\n" for p in self.posts.values()), encoding="utf-8")
                    api.log({"event": "context_review_excluded", "platform": platform, "post_ids": [p["post_id"] for p in removed], "reason": "No employment-related thread or direct personal employment experience; original probe archived."})
        self.rejections = Counter()

    def count(self, year):
        return sum(post.get("season_year") == year for post in self.posts.values())

    def remember(self, post: dict | None) -> bool:
        if post is None:
            self.rejections["missing_or_ineligible_original"] += 1
            return False
        year = post["season_year"]
        if post["post_id"] in self.posts or self.count(year) >= self.target:
            return False
        same_year = [p for p in self.posts.values() if p["season_year"] == year]
        if sum(p["author_id"] == post["author_id"] for p in same_year) >= 3:
            self.rejections["author_cap"] += 1
            return False
        if sum(p["thread_id"] == post["thread_id"] for p in same_year) >= self.max_thread:
            self.rejections["thread_cap"] += 1
            return False
        if any(re.sub(r"\s+", " ", p["text"]).casefold() == re.sub(r"\s+", " ", post["text"]).casefold() for p in same_year):
            self.rejections["duplicate_text"] += 1
            return False
        self.posts[post["post_id"]] = post
        rows = sorted(self.posts.values(), key=lambda p: (p["season_year"], p["published_at"], p["post_id"]))
        temporary = self.output.with_suffix(".tmp")
        temporary.write_text("".join(json.dumps(p, ensure_ascii=False) + "\n" for p in rows), encoding="utf-8")
        temporary.replace(self.output)
        print(json.dumps({"event": "post", "platform": self.platform, "year": year, "year_count": self.count(year), "total": len(rows)}, ensure_ascii=False), flush=True)
        return True

    def hackernews(self, year: int, probe: bool):
        candidates = {}
        queries = HN_QUERIES[:1] if probe else HN_QUERIES
        for query in queries:
            for begin, end in month_windows(year):
                params = {"query": query, "tags": "comment", "numericFilters": f"created_at_i>={begin},created_at_i<{end}", "hitsPerPage": 20 if probe else 80, "page": 0}
                data = self.api.get("https://hn.algolia.com/api/v1/search?" + urlencode(params))
                for hit in data.get("hits", []):
                    candidate = hn_candidate(hit, year)
                    if candidate:
                        candidate["query"] = query
                        candidates.setdefault(candidate["id"], candidate)
            if not probe:
                begin, end = window(year)
                params = {"query": query, "tags": "story", "numericFilters": f"created_at_i>={begin},created_at_i<{end}", "hitsPerPage": 25, "page": 0}
                for hit in self.api.get("https://hn.algolia.com/api/v1/search?" + urlencode(params)).get("hits", []):
                    candidate = hn_candidate(hit, year)
                    if candidate:
                        candidate["query"] = query
                        candidates.setdefault(candidate["id"], candidate)
        # Round-robin month buckets prevents the first recent result page from
        # becoming the entire annual sample. Author and thread caps apply next.
        ordered = []
        for candidate in candidates.values():
            ordered.append({"post_id": candidate["id"], "published_at": datetime.fromtimestamp(candidate["time"], timezone.utc).isoformat(), "candidate": candidate})
        for row in stable_order(ordered):
            if self.count(year) >= self.target:
                break
            candidate = row["candidate"]
            if candidate["id"] in self.posts:
                continue
            original = self.api.get(f"https://hacker-news.firebaseio.com/v0/item/{candidate['id']}.json")
            self.remember(normalize_hn(candidate, original, candidate["query"], year))

    def workplace(self, year: int, probe: bool):
        candidates, questions = {}, {}
        queries = WORKPLACE_QUERIES[:1] if probe else WORKPLACE_QUERIES
        for query in queries:
            for begin, end in month_windows(year):
                params = {"site": "workplace", "q": query, "fromdate": begin, "todate": end - 1,
                          "sort": "creation", "order": "desc", "pagesize": 12 if probe else 100, "page": 1, "filter": "withbody"}
                data = self.api.get("https://api.stackexchange.com/2.3/search/advanced?" + urlencode(params))
                for item in data.get("items", []):
                    questions[str(item.get("question_id"))] = item
                    post = normalize_workplace(item, year, query)
                    if post:
                        candidates.setdefault(post["post_id"], post)
            for post in stable_order(list(candidates.values())):
                self.remember(post)
                if self.count(year) >= self.target:
                    return
        # Answers are distinct authors' opinions, not additional questions or
        # additional independent job seekers. Keep their parent and thread IDs.
        begin, end = window(year)
        ids = sorted(q for q in questions if q.isdigit())
        for index in range(0, len(ids), 30):
            params = {"site": "workplace", "fromdate": begin, "todate": end - 1, "sort": "creation",
                      "order": "desc", "pagesize": 100, "filter": "withbody"}
            path = ";".join(ids[index:index + 30])
            data = self.api.get(f"https://api.stackexchange.com/2.3/questions/{path}/answers?" + urlencode(params))
            answers = [p for item in data.get("items", []) if (p := normalize_workplace(item, year, "answers to employment-related questions", question=questions.get(str(item.get("question_id")))))]
            for post in stable_order(answers):
                self.remember(post)
                if self.count(year) >= self.target:
                    return

    def summary(self, stage: str, stopped: str | None = None) -> dict:
        groups = []
        for year in YEARS:
            posts = [p for p in self.posts.values() if p["season_year"] == year]
            groups.append({"year": year, "selected": len(posts), "target": self.target, "shortfall": max(0, self.target - len(posts)),
                           "authors": len({p["author_id"] for p in posts}), "threads": len({p["thread_id"] for p in posts}),
                           "max_per_author": max(Counter(p["author_id"] for p in posts).values(), default=0),
                           "max_per_thread": max(Counter(p["thread_id"] for p in posts).values(), default=0),
                           "months": dict(Counter(datetime.fromisoformat(p["published_at"]).astimezone(CHINA).month for p in posts)),
                           "entry_types": dict(Counter(p["entry_type"] for p in posts))})
        return {"created_at": now(), "platform": self.platform, "stage": stage, "selected": len(self.posts), "groups": groups,
                "stopped_reason": stopped, "public_requests_this_run": self.api.requests, "quota_remaining": self.api.quota_remaining,
                "rejections": dict(self.rejections), "output": str(self.output.relative_to(self.api.root)),
                "population": "Independent overseas English employment discussion comparison; not Chinese campus recruitment.",
                "limitations": ["Non-probability search sample; source availability and ranking constrain coverage.",
                                "Candidate relevance is heuristic and requires the subsequent model/manual review.",
                                "Story/question and comment/answer units are explicitly identified; thread and author caps apply.",
                                "Original creation times are verified, but retrieved text is the current available version."]}


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--platform", required=True, choices=["hackernews", "workplace"])
    parser.add_argument("--stage", choices=["probe", "collect"], default="probe")
    parser.add_argument("--target-per-year", type=int)
    args = parser.parse_args(argv)
    target = args.target_per_year or (3 if args.stage == "probe" else 40)
    if not 1 <= target <= 100:
        parser.error("target-per-year must be between 1 and 100")
    api = PublicAPI()
    collector = Collector(api, args.platform, target, max_thread=4 if args.platform == "hackernews" else 3)
    stopped = None
    try:
        for year in YEARS:
            if collector.count(year) >= target:
                continue
            getattr(collector, args.platform)(year, args.stage == "probe")
    except (CollectionStopped, KeyboardInterrupt) as exc:
        stopped = str(exc) or "Operator interrupted; all completed observations checkpointed."
    summary = collector.summary(args.stage, stopped)
    diagnostic = api.diagnostics / f"additional-overseas-{args.platform}-{args.stage}.json"
    diagnostic.write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(summary, ensure_ascii=False), flush=True)
    return 1 if stopped else 0


if __name__ == "__main__":
    raise SystemExit(main())
