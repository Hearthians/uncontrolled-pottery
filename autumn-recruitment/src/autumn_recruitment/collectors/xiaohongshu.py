"""Normalize full notes rendered in Xiaohongshu's ordinary detail-page state."""
from __future__ import annotations

import re
from urllib.parse import parse_qs, urlencode, urlparse

from .normalize import post


NOTE_STATE_JS = "() => ({noteDetailMap: window.__INITIAL_STATE__?.note?.noteDetailMap || {}})"


def detail_links_from_dom(links: list[str]) -> dict[str, str]:
    """Use the ordinary signed-in card link, skipping its tokenless SEO sibling."""
    result = {}
    for link in links:
        parsed = urlparse(link)
        match = re.fullmatch(r"/(?:explore|search_result)/([a-fA-F0-9]{24})", parsed.path)
        if parsed.hostname != "www.xiaohongshu.com" or match is None:
            continue
        token = parse_qs(parsed.query).get("xsec_token", [None])[0]
        if token:
            result[match.group(1)] = "https://www.xiaohongshu.com/explore/" + match.group(1) + "?" + urlencode({"xsec_token": token, "xsec_source": "pc_search"})
    return result


def extract_note_state(state: object, query: str = "", *, expected_note_id: str | None = None,
                       source_url: str = "") -> list[dict]:
    """Read original publication time, never update time or a search-card date.

    The live page exposes camelCase fields; unfinished note-map slots are empty.
    A current-page ID prevents stale notes from another open detail being counted.
    """
    if not isinstance(state, dict):
        return []
    mapping = state.get("noteDetailMap")
    if not isinstance(mapping, dict):
        return []
    results = {}
    for value in mapping.values():
        if not isinstance(value, dict) or not isinstance(value.get("note"), dict):
            continue
        note = value["note"]
        identity = note.get("noteId") or note.get("note_id")
        if not identity or (expected_note_id is not None and str(identity) != str(expected_note_id)):
            continue
        title = note.get("title") or ""
        description = note.get("desc") or ""
        text = f"{title}\n{description}".strip() if title != description else description
        user = note.get("user") if isinstance(note.get("user"), dict) else {}
        metrics = note.get("interactInfo") or note.get("interact_info") or {}
        if not isinstance(metrics, dict):
            metrics = {}
        try:
            result = post("xiaohongshu", identity, text, note.get("time") or note.get("publish_time"),
                          url=source_url, author_id=user.get("userId") or user.get("user_id"),
                          likes=metrics.get("likedCount", metrics.get("liked_count")),
                          comments=metrics.get("commentCount", metrics.get("comment_count")),
                          shares=metrics.get("shareCount", metrics.get("share_count")),
                          query=query, raw={"source": "rendered_note_state", "note": note})
        except (ValueError, TypeError, OverflowError):
            continue
        results[result["post_id"]] = result
    return list(results.values())
