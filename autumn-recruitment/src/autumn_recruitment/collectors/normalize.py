"""Shared, deliberately strict normalization for collection adapters."""
from __future__ import annotations

import html
import re
from datetime import datetime, timedelta, timezone
from email.utils import parsedate_to_datetime
from html.parser import HTMLParser
from typing import Any


class CollectorError(RuntimeError):
    """Collection cannot continue; credentials and response bodies stay out of errors."""


class _Text(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.parts: list[str] = []
        self.hidden = 0

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag in {"script", "style"}:
            self.hidden += 1
        elif tag in {"br", "p", "div"}:
            self.parts.append("\n")

    def handle_endtag(self, tag: str) -> None:
        if tag in {"script", "style"} and self.hidden:
            self.hidden -= 1

    def handle_data(self, data: str) -> None:
        if not self.hidden:
            self.parts.append(data)


def plain_text(value: Any) -> str:
    value = str(value or "")
    if re.search(r"</?[A-Za-z][^>]*>", value):
        parser = _Text()
        parser.feed(value)
        value = "".join(parser.parts)
    return re.sub(r"[ \t\r\f\v]+", " ", html.unescape(value)).strip()


def timestamp(value: Any, platform: str = "x") -> str:
    """Return an aware UTC timestamp; Chinese exports without zones use UTC+08."""
    default_zone = timezone.utc if platform == "x" else timezone(timedelta(hours=8))
    if isinstance(value, datetime):
        result = value
    elif isinstance(value, (int, float)) or re.fullmatch(r"\d{10}(?:\d{3})?", str(value or "")):
        epoch = float(value)
        result = datetime.fromtimestamp(epoch / 1000 if epoch > 1e11 else epoch, timezone.utc)
    else:
        text = str(value or "").strip()
        if not text:
            raise ValueError("缺少发布时间")
        text = text.replace("年", "-").replace("月", "-").replace("日", "")
        if re.fullmatch(r"\d{1,2}-\d{1,2}(?: \d\d:\d\d)?", text):
            raise ValueError("发布时间缺少年份；不能用于跨年研究")
        try:
            result = datetime.fromisoformat(text.replace("Z", "+00:00"))
        except ValueError:
            try:
                result = parsedate_to_datetime(text)
            except (ValueError, TypeError):
                result = None
                for fmt in ("%a %b %d %H:%M:%S %z %Y", "%Y-%m-%d %H:%M", "%Y/%m/%d %H:%M:%S", "%Y/%m/%d", "%Y-%m-%d"):
                    try:
                        result = datetime.strptime(text, fmt)
                        break
                    except ValueError:
                        pass
                if result is None:
                    raise ValueError("无法识别发布时间；请使用 ISO 日期或时间戳") from None
    if result.tzinfo is None:
        result = result.replace(tzinfo=default_zone)
    return result.astimezone(timezone.utc).isoformat()


def date_window(start: str, end: str, platform: str) -> tuple[datetime, datetime]:
    # This study uses Asia/Shanghai for every platform. Explicit offsets remain
    # authoritative; date-only and naive datetime boundaries use UTC+08.
    platform_name(platform)
    begin = datetime.fromisoformat(timestamp(start, "weibo"))
    finish = datetime.fromisoformat(timestamp(end, "weibo"))
    if begin >= finish:
        raise ValueError("start 必须早于 end（end 为不包含的上界）")
    return begin, finish


def count(value: Any) -> int | None:
    if value is None or value == "":
        return None
    if isinstance(value, (int, float)):
        return int(value)
    text = str(value).replace(",", "").strip()
    match = re.search(r"(\d+(?:\.\d+)?)\s*([万亿kKmM]?)", text)
    if not match:
        return None
    unit = {"万": 10000, "亿": 100000000, "k": 1000, "m": 1000000}.get(match[2].lower(), 1)
    return int(float(match[1]) * unit)


def platform_name(value: str) -> str:
    result = {"xhs": "xiaohongshu", "小红书": "xiaohongshu", "微博": "weibo", "twitter": "x"}.get(value.lower(), value.lower())
    if result not in {"weibo", "xiaohongshu", "x"}:
        raise ValueError("平台必须为 weibo、xiaohongshu 或 x")
    return result


def post(platform: str, post_id: Any, text: Any, published_at: Any, *, url: str = "", author_id: Any = None, likes: Any = None, comments: Any = None, shares: Any = None, raw: dict | None = None, query: str = "") -> dict:
    platform = platform_name(platform)
    identity = str(post_id or "").strip()
    body = plain_text(text)
    if not identity or not body:
        raise ValueError("帖子必须具有 post_id 和正文")
    if not url:
        url = {"weibo": "https://weibo.com/detail/", "xiaohongshu": "https://www.xiaohongshu.com/explore/", "x": "https://x.com/i/status/"}[platform] + identity
    return {
        "platform": platform, "post_id": identity, "text": body,
        "published_at": timestamp(published_at, platform), "url": url,
        "author_id": str(author_id) if author_id is not None else None,
        "likes": count(likes), "comments": count(comments), "shares": count(shares),
        "raw": raw or {}, "query": query,
        "collected_at": datetime.now(timezone.utc).isoformat(),
    }


def in_window(item: dict, window: tuple[datetime, datetime]) -> bool:
    moment = datetime.fromisoformat(item["published_at"])
    return window[0] <= moment < window[1]
