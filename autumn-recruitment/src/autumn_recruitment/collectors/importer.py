"""Import existing crawler exports without depending on their crawling internals."""
from __future__ import annotations

import csv
import html
import json
from pathlib import Path
from typing import Any

from .normalize import CollectorError, platform_name, post


def _first(row: dict, *keys: str) -> Any:
    return next((row[key] for key in keys if row.get(key) is not None and row.get(key) != ""), None)


def normalize_import(row: dict, platform: str) -> dict:
    """Supports canonical records, dataabc CSV exports and common MediaCrawler fields."""
    if not isinstance(row, dict):
        raise ValueError("每条记录必须为 JSON 对象")
    canonical = row.get("platform") == platform and isinstance(row.get("text"), str)
    text = _first(row, "text", "content", "微博正文", "正文", "full_text", "desc")
    title = _first(row, "title", "display_title", "标题")
    if not canonical and title and str(title) not in str(text or ""):
        text = f"{title}\n{text or ''}".strip()
    result = post(
        platform,
        _first(row, "post_id", "note_id", "tweet_id", "idstr", "微博id", "微博ID", "id", "mid"),
        html.escape(text) if canonical else text,
        _first(row, "published_at", "created_at", "publish_time", "publish_date", "日期", "发布时间", "time"),
        url=str(_first(row, "url", "note_url", "微博url", "微博URL", "链接") or ""),
        author_id=_first(row, "author_id", "user_id", "用户id", "用户ID", "uid"),
        likes=_first(row, "likes", "liked_count", "attitudes_count", "点赞数", "点赞"),
        comments=_first(row, "comments", "comment_count", "comments_count", "评论数"),
        shares=_first(row, "shares", "share_count", "reposts_count", "转发数"),
        raw=row.get("raw") if isinstance(row.get("raw"), dict) else row,
        query=str(row.get("query") or ""),
    )
    if canonical:
        # Canonical text is already plain text. Literal code and entity notation
        # must survive another import, e.g. C++ <T> or a quoted "&gt;".
        result["text"] = text.strip()
    for key in ("entry_type", "thread_id", "parent_id", "language", "market_region", "updated_at", "temporal_review"):
        if key in row:
            result[key] = row[key]
    return result


def import_posts(path: str | Path, platform: str) -> list[dict]:
    """Read CSV/JSONL/JSON; fail on malformed rows instead of silently dropping data."""
    source = Path(path)
    platform = platform_name(platform)
    try:
        with source.open(encoding="utf-8-sig", newline="") as handle:
            if source.suffix.lower() == ".csv":
                rows = list(csv.DictReader(handle))
            elif source.suffix.lower() in {".jsonl", ".ndjson"}:
                rows = []
                for number, line in enumerate(handle, 1):
                    if line.strip():
                        try:
                            rows.append(json.loads(line))
                        except json.JSONDecodeError:
                            raise CollectorError(f"{source.name} 第 {number} 行不是有效 JSON") from None
            else:
                payload = json.load(handle)
                rows = payload if isinstance(payload, list) else payload.get("posts", payload.get("data")) if isinstance(payload, dict) else None
                if not isinstance(rows, list):
                    raise CollectorError("JSON 导出必须为数组，或含 posts/data 数组")
    except (OSError, UnicodeError, json.JSONDecodeError) as error:
        raise CollectorError(f"无法读取导出文件 {source.name}（{type(error).__name__}）") from None
    unique: dict[str, dict] = {}
    for number, row in enumerate(rows, 1):
        try:
            item = normalize_import(row, platform)
        except (ValueError, TypeError, OverflowError):
            raise CollectorError(f"{source.name} 第 {number} 条记录无有效 ID、正文或发布时间；请先整理字段") from None
        unique.setdefault(item["post_id"], item)
    return list(unique.values())
