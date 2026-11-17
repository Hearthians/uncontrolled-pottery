"""Normalize authenticated Weibo search cards with original, complete body text."""
from __future__ import annotations

import re
import time
from urllib.parse import urlparse

from .normalize import CollectorError, post, timestamp


WEIBO_SEARCH_DOM = r"""() => Array.from(document.querySelectorAll('.card-wrap[mid]')).map(card => {
  const full = card.querySelector('[node-type="feed_list_content_full"]');
  const short = card.querySelector('[node-type="feed_list_content"]');
  const node = full || short;
  const date = card.querySelector('.from a');
  const author = card.querySelector('.info a.name');
  const expandedLink = short?.querySelector('a[action-type="fl_unfold"]');
  const copy = node?.cloneNode(true);
  copy?.querySelectorAll('a[action-type="fl_unfold"], a[action-type="fl_fold"]').forEach(a => a.remove());
  return {
    id: card.getAttribute('mid'),
    text: copy?.textContent?.trim(),
    date: date?.getAttribute('title') || date?.getAttribute('date') || date?.innerText,
    url: date?.href || '',
    author_url: author?.href || '',
    has_full_text: Boolean(full),
    truncated: !full && Boolean(expandedLink) && /展开/.test(expandedLink.textContent || '')
  };
})"""


def clean_search_body(value: object) -> str:
    """Remove only the verified trailing search-card collapse control."""
    return re.sub(r"\s*收起d[\s\u200b\ufeff]*$", "", str(value or "")).strip()


def normalize_search_rows(rows: list[dict], query: str, search_url: str = "") -> list[dict]:
    """Reject unknown dates and still-truncated snippets instead of guessing."""
    results = []
    for row in rows:
        if not isinstance(row, dict) or row.get("truncated"):
            continue
        author_match = re.search(r"weibo\.com/(?:u/)?(\d+)(?:[/?]|$)", row.get("author_url") or "")
        try:
            results.append(post("weibo", row.get("id"), clean_search_body(row.get("text")), row.get("date"),
                                url=row.get("url") or "",
                                author_id=author_match.group(1) if author_match else None,
                                raw={"source": "authenticated_search_dom", "search_url": search_url, **row},
                                query=query))
        except (ValueError, TypeError, OverflowError):
            continue
    return results


def resolve_missing_dates(page: object, rows: list[dict], *, deadline: float | None = None,
                          max_detail_requests: int = 10, check_page=None) -> list[dict]:
    """Read yearless dates from the normal post detail page's own JSON response.

    A direct APIRequestContext request is deliberately unnecessary: the normal
    authenticated page loads its own status data. Original full DOM text stays
    intact. Missing or mismatched metadata leaves that card ineligible.
    """
    resolved = [dict(row) if isinstance(row, dict) else row for row in rows]
    pending = []
    for index, row in enumerate(resolved):
        if not isinstance(row, dict) or row.get("truncated"):
            continue
        try:
            timestamp(row.get("date"), "weibo")
        except (ValueError, TypeError, OverflowError):
            url = urlparse(row.get("url") or "")
            if url.scheme in {"https", "http"} and url.hostname in {"weibo.com", "www.weibo.com"} and str(row.get("id", "")).isdigit():
                pending.append(index)
    if not pending or max_detail_requests < 1 or (deadline is not None and time.monotonic() >= deadline):
        return resolved

    def is_status_response(response):
        url = urlparse(response.url)
        return url.hostname in {"weibo.com", "www.weibo.com"} and url.path == "/ajax/statuses/show"

    detail = page.context.new_page()
    try:
        for index in pending[:max_detail_requests]:
            if deadline is not None and time.monotonic() >= deadline:
                break
            row = resolved[index]
            timeout = 18000 if deadline is None else min(18000, max(1, int((deadline - time.monotonic()) * 1000)))
            try:
                with detail.expect_response(is_status_response, timeout=timeout) as event:
                    detail.goto(row["url"], wait_until="domcontentloaded", timeout=timeout)
                response = event.value
                if check_page is not None:
                    check_page(detail)
                if response.status in {401, 403, 429}:
                    raise CollectorError(f"微博正常详情页面返回 HTTP {response.status}；采集已停止")
                if response.status != 200:
                    continue
                payload = response.json()
                data = payload.get("data") if isinstance(payload.get("data"), dict) else payload
                identity = str(data.get("idstr") or data.get("id"))
                if identity != str(row["id"]) or not data.get("created_at"):
                    continue
                timestamp(data["created_at"], "weibo")
                resolved[index] = {**row, "source_date_label": row.get("date"), "date": data["created_at"],
                                   "timestamp_source": "ordinary_post_detail_response", "timestamp_post_id": identity}
                detail.wait_for_timeout(250)
            except CollectorError:
                raise
            except Exception:
                # A missing/deleted post or a network timeout never supplies a
                # guessed year. Inspect the page for an actual login challenge.
                if check_page is not None:
                    check_page(detail)
    finally:
        detail.close()
    return resolved


def extract_search_posts(page: object, query: str, *, resolve_dates: bool = False,
                         deadline: float | None = None, max_detail_requests: int = 10,
                         check_page=None) -> list[dict]:
    rows = page.evaluate(WEIBO_SEARCH_DOM)
    if resolve_dates:
        rows = resolve_missing_dates(page, rows, deadline=deadline, max_detail_requests=max_detail_requests, check_page=check_page)
    return normalize_search_rows(rows, query, page.url)
