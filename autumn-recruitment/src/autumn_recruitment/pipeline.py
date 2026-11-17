"""Search planning, timestamp validation, filtering, and balanced sampling."""

from __future__ import annotations

import hashlib
import re
from collections import Counter, defaultdict
from datetime import datetime, time, timedelta, timezone
from urllib.parse import urlencode
from zoneinfo import ZoneInfo

from .config import PLATFORMS


def year_quotas(config: dict) -> dict[int, int]:
    years = sorted(set(config["years"]))
    base, remainder = divmod(config.get("target_per_platform", 200), len(years))
    return {year: base + (index < remainder) for index, year in enumerate(years)}


def season_window(config: dict, year: int) -> tuple[datetime, datetime]:
    timezone = ZoneInfo(config.get("timezone", "Asia/Shanghai"))
    window = config.get("window", {})
    return (
        datetime(year, window.get("start_month", 8), window.get("start_day", 1), tzinfo=timezone),
        datetime(year, window.get("end_month", 11), window.get("end_day", 18), tzinfo=timezone),
    )


def make_plan(config: dict) -> list[dict]:
    """Create search jobs. Quotas total 200/platform by default, across all years.

    Xiaohongshu search cannot enforce historical dates; collectors must retrieve
    each note's original publication time before it can enter a season sample.
    Year/cohort keywords are search aids and are never treated as timestamps.
    """
    jobs = []
    for platform, settings in config.get("platforms", {}).items():
        if not settings.get("enabled", True):
            continue
        for year, quota in year_quotas(config).items():
            start, end = season_window(config, year)
            queries = settings.get("queries", ["秋招"])
            query_base, query_remainder = divmod(quota, len(queries))
            for index, template in enumerate(queries):
                query = template.format(year=year, short_year=str(year)[-2:], cohort=year + 1)
                if platform == "weibo":
                    params = {"q": query, "typeall": "1", "suball": "1",
                              "timescope": f"custom:{start.date()}:{(end - timedelta(days=1)).date()}",
                              "Refer": "g"}
                    url = "https://s.weibo.com/weibo?" + urlencode(params)
                elif platform == "xiaohongshu":
                    url = "https://www.xiaohongshu.com/search_result?" + urlencode({"keyword": query, "source": "web_search_result_notes"})
                elif platform == "x":
                    # X's date operators use UTC days. Broaden those days to
                    # cover the full study window; exact aware timestamps are
                    # checked again when a result enters the sample.
                    start_utc, end_utc = start.astimezone(timezone.utc), end.astimezone(timezone.utc)
                    until_date = end_utc.date() + timedelta(days=end_utc.time() != time.min)
                    xquery = f"{query} since:{start_utc.date()} until:{until_date}"
                    url = "https://x.com/search?" + urlencode({"q": xquery, "src": "typed_query", "f": "live"})
                else:
                    raise ValueError(f"Unknown platform: {platform}")
                jobs.append({"platform": platform, "year": year, "query": query,
                             "start": start.isoformat(), "end": end.isoformat(),
                             "quota": query_base + (index < query_remainder),
                             "year_quota": quota, "search_url": url})
    return jobs


def _publication_time(value: object, timezone: ZoneInfo) -> datetime | None:
    if not isinstance(value, str) or not value:
        return None
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except (ValueError, TypeError):
        return None
    # Collectors should emit timezone-aware ISO timestamps. Reject ambiguous
    # unzoned values instead of guessing a season near a day/year boundary.
    if parsed.tzinfo is None:
        return None
    return parsed.astimezone(timezone)


def clean_posts(posts: list[dict], config: dict) -> list[dict]:
    """Return relevant unique posts whose original dates fit a configured season.

    Always derive season_year from the publication timestamp, independently of
    search query/cohort mentions. An explicitly conflicting season_year is
    rejected. Original input objects are not modified.
    """
    timezone = ZoneInfo(config.get("timezone", "Asia/Shanghai"))
    filters = config.get("filters", {})
    minimum = filters.get("min_text_length", 6)
    keywords = [keyword.casefold() for keyword in filters.get("require_keywords", [])]
    excludes = [re.compile(pattern, re.IGNORECASE) for pattern in filters.get("exclude_regex", [])]
    windows = {year: season_window(config, year) for year in config["years"]}
    seen_ids: set[tuple[str, str]] = set()
    seen_texts: set[tuple[str, int, str]] = set()
    result = []
    ordered = sorted((post for post in posts if isinstance(post, dict)),
                     key=lambda post: (str(post.get("platform", "")),
                                       str(post.get("post_id", "")), str(post.get("text", ""))))
    for original in ordered:
        platform = original.get("platform")
        post_id = original.get("post_id")
        text = original.get("text")
        if platform not in PLATFORMS or not post_id or not isinstance(text, str):
            continue
        published = _publication_time(original.get("published_at"), timezone)
        if published is None or published.year not in windows:
            continue
        year = published.year
        start, end = windows[year]
        if not start <= published < end:
            continue
        declared_year = original.get("season_year")
        if declared_year is not None and str(declared_year) != str(year):
            continue
        normalized = re.sub(r"\s+", " ", text).strip()
        folded = normalized.casefold()
        if len(normalized) < minimum:
            continue
        if keywords and not any(keyword in folded for keyword in keywords):
            continue
        if any(pattern.search(normalized) for pattern in excludes):
            continue
        identity = (platform, str(post_id))
        text_identity = (platform, year, folded)
        if identity in seen_ids or text_identity in seen_texts:
            continue
        seen_ids.add(identity)
        seen_texts.add(text_identity)
        post = dict(original)
        post.update(post_id=str(post_id), published_at=published.isoformat(), season_year=year)
        cohort = re.search(r"(?<!\d)(20\d{2}|\d{2})届", normalized)
        if cohort:
            cohort_year = int(cohort.group(1))
            post["graduation_cohort"] = cohort_year + 2000 if cohort_year < 100 else cohort_year
        result.append(post)
    return result


def select_sample(posts: list[dict], config: dict) -> list[dict]:
    """Choose a stable sample with fixed equal quotas per calendar year.

    Missing year quotas stay unfilled, making shortages visible and preserving
    cross-year balance. This function filters again so unvalidated imported posts
    cannot silently bypass date checks. No result is invented to satisfy a quota.
    """
    clean = clean_posts(posts, config)
    enabled = {name for name, item in config.get("platforms", {}).items() if item.get("enabled", True)}
    grouped: dict[tuple[str, int], list[dict]] = defaultdict(list)
    for post in clean:
        if post["platform"] in enabled:
            grouped[(post["platform"], post["season_year"])].append(post)
    seed = str(config.get("sampling", {}).get("seed", "20261117"))
    maximum = config.get("sampling", {}).get("max_per_author_per_year", 3)
    result = []
    for (platform, year), candidates in sorted(grouped.items()):
        quota = year_quotas(config)[year]
        candidates.sort(key=lambda post: hashlib.sha256(
            f"{seed}:{platform}:{post['post_id']}".encode("utf-8")).hexdigest())
        authors: Counter = Counter()
        selected = 0
        for post in candidates:
            if selected >= quota:
                break
            author = post.get("author_id")
            if author and maximum and authors[str(author)] >= maximum:
                continue
            result.append(post)
            selected += 1
            if author:
                authors[str(author)] += 1
    return result
