"""Normalize ordinary public social responses without inventing historical dates.

These records belong to a separate overseas employment cohort. Network access,
API approval and semantic screening are left to the caller; normalizing a record
does not establish that it is a relevant recruitment opinion.
"""
from __future__ import annotations

from datetime import datetime, timezone
import json
from pathlib import Path
from urllib.parse import quote, urlsplit, urlunsplit

from .normalize import plain_text


def _date(value: object, *, epoch: bool = False) -> str | None:
    try:
        if epoch and type(value) in {int, float}:
            moment = datetime.fromtimestamp(value, timezone.utc)
        elif isinstance(value, str):
            moment = datetime.fromisoformat(value.replace("Z", "+00:00"))
            if moment.tzinfo is None:
                return None
        else:
            return None
        return moment.astimezone(timezone.utc).isoformat()
    except (ValueError, OverflowError, OSError):
        return None


def _public_url(value: object) -> str:
    if not isinstance(value, str):
        return ""
    try:
        parsed = urlsplit(value)
        if parsed.scheme != "https" or not parsed.hostname or parsed.username or parsed.password:
            return ""
        return urlunsplit((parsed.scheme, parsed.netloc, parsed.path, "", ""))
    except ValueError:
        return ""


def _record(platform: str, identity: object, text: str, published: str | None, url: str,
            author: object, entry_type: str, parent: object, thread: object,
            language: object, query: str, raw: dict) -> dict | None:
    if not identity or not text.strip() or not published or not url:
        return None
    return {
        "platform": platform, "post_id": str(identity), "text": text.strip(),
        "published_at": published, "url": url,
        "author_id": str(author) if author else None, "entry_type": entry_type,
        "parent_id": str(parent) if parent else None, "thread_id": str(thread) if thread else None,
        "language": language if isinstance(language, str) else None,
        "market_region": "overseas_unspecified", "query": query, "raw": raw,
        "collected_at": datetime.now(timezone.utc).isoformat(),
    }


def normalize_mastodon_status(status: object, query: str = "", *, source_instance: str = "") -> dict | None:
    """Use canonical URI across instances and original created_at, not edited_at."""
    if not isinstance(status, dict) or status.get("reblog") is not None:
        return None
    if status.get("visibility", "public") != "public":
        return None
    account = status.get("account") if isinstance(status.get("account"), dict) else {}
    url = _public_url(status.get("url")) or _public_url(status.get("uri"))
    identity = status.get("uri") or url
    parent = status.get("in_reply_to_id")
    if parent and source_instance:
        parent = f"{source_instance}:{parent}"
    body = plain_text(status.get("content"))
    warning = plain_text(status.get("spoiler_text"))
    text = f"{warning}\n{body}".strip() if warning else body
    author = _public_url(account.get("url")) or account.get("acct")
    result = _record("mastodon", identity, text, _date(status.get("created_at")), url,
                     author, "reply" if parent else "post", parent,
                     None if parent else identity, status.get("language"), query, status)
    if result is not None:
        result["source_instance"] = source_instance
    return result


def normalize_reddit_post(post: object, query: str = "") -> dict | None:
    """Only original, dated self-post bodies; titles alone do not supply opinions."""
    if not isinstance(post, dict) or post.get("crosspost_parent"):
        return None
    body = post.get("selftext")
    if not isinstance(body, str) or not body.strip() or body.strip() in {"[removed]", "[deleted]"}:
        return None
    title = plain_text(post.get("title"))
    body = plain_text(body)
    permalink = post.get("permalink")
    url = _public_url("https://www.reddit.com" + permalink) if isinstance(permalink, str) and permalink.startswith("/") else ""
    identity = post.get("name") or ("t3_" + str(post["id"]) if post.get("id") else None)
    return _record("reddit", identity, f"{title}\n{body}".strip(), _date(post.get("created_utc"), epoch=True),
                   url, post.get("author"), "post", None, identity, None, query, post)


def normalize_bluesky_post(post: object, query: str = "") -> dict | None:
    """Date by the original record's createdAt, never the search index's sortAt."""
    if not isinstance(post, dict) or not isinstance(post.get("record"), dict):
        return None
    record = post["record"]
    author = post.get("author") if isinstance(post.get("author"), dict) else {}
    uri = post.get("uri")
    if not isinstance(uri, str) or not uri.startswith("at://") or "/app.bsky.feed.post/" not in uri:
        return None
    handle = author.get("handle") or author.get("did")
    if not isinstance(handle, str) or not handle:
        return None
    rkey = uri.rsplit("/", 1)[-1]
    url = "https://bsky.app/profile/" + quote(handle, safe=":.") + "/post/" + quote(rkey, safe="")
    reply = record.get("reply") if isinstance(record.get("reply"), dict) else {}
    parent = reply.get("parent") if isinstance(reply.get("parent"), dict) else {}
    root = reply.get("root") if isinstance(reply.get("root"), dict) else {}
    languages = record.get("langs")
    language = languages[0] if isinstance(languages, list) and languages else None
    return _record("bluesky", uri, plain_text(record.get("text")), _date(record.get("createdAt")),
                   url, author.get("did"), "reply" if parent.get("uri") else "post",
                   parent.get("uri"), root.get("uri") or uri, language, query, post)


def write_additional_posts(path: str | Path, posts: list[dict]) -> None:
    destination = Path(path)
    destination.parent.mkdir(parents=True, exist_ok=True)
    seen = set()
    with destination.open("w", encoding="utf-8") as handle:
        for post in posts:
            key = post["platform"], post["post_id"]
            if key not in seen:
                seen.add(key)
                handle.write(json.dumps(post, ensure_ascii=False) + "\n")
