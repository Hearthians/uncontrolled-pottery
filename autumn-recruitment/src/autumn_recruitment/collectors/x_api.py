"""Official X search API adapter. Archive access is determined by the user's plan."""
from __future__ import annotations

import json
import os
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen

from .normalize import CollectorError, date_window, in_window, post


def write_jsonl(path: str | Path, posts: list[dict]) -> None:
    destination = Path(path)
    destination.parent.mkdir(parents=True, exist_ok=True)
    temporary = destination.with_name(destination.name + ".tmp")
    with temporary.open("w", encoding="utf-8") as handle:
        for item in posts:
            handle.write(json.dumps(item, ensure_ascii=False) + "\n")
    temporary.replace(destination)


def collect_x_api(query: str, start: str, end: str, output_path: str | Path, limit: int = 200, *, endpoint: str = "all", bearer_env: str = "X_BEARER_TOKEN", max_pages: int = 10) -> list[dict]:
    """Fetch [start, end) using /2/tweets/search/{all,recent}; never downgrades access."""
    if endpoint not in {"all", "recent"}:
        raise ValueError("X 搜索端点必须为 all 或 recent")
    if limit < 1 or max_pages < 1:
        raise ValueError("limit 和 max_pages 必须为正整数")
    token = os.environ.get(bearer_env, "").strip()
    if not token:
        raise CollectorError(f"未设置 {bearer_env}；请配置已申请的 X API Bearer Token")
    window = date_window(start, end, "x")
    params = {
        "query": query,
        "start_time": window[0].isoformat().replace("+00:00", "Z"),
        "end_time": window[1].isoformat().replace("+00:00", "Z"),
        "tweet.fields": "created_at,author_id,public_metrics,lang",
    }
    unique: dict[str, dict] = {}
    seen_tokens: set[str] = set()
    try:
        for _ in range(max_pages):
            params["max_results"] = str(max(10, min(100, limit - len(unique))))
            request = Request(
                f"https://api.x.com/2/tweets/search/{endpoint}?{urlencode(params)}",
                headers={"Authorization": f"Bearer {token}", "Accept": "application/json"},
            )
            try:
                with urlopen(request, timeout=30) as response:
                    payload = json.load(response)
            except HTTPError as error:
                error.close()
                reason = {
                    400: "搜索参数被拒绝；请检查时间范围与查询语法",
                    401: "Bearer Token 无效或已过期",
                    403: f"当前 API 权限不允许访问 {endpoint} 搜索；历史搜索需要相应权限",
                    429: "触发 X API 限流或额度上限；已停止请求",
                }.get(error.code, "服务返回错误")
                raise CollectorError(f"X API HTTP {error.code}：{reason}") from None
            except (URLError, TimeoutError, OSError, json.JSONDecodeError):
                raise CollectorError("X API 请求失败；请检查网络、代理与服务状态") from None
            if not isinstance(payload, dict):
                raise CollectorError("X API 返回了非预期结构")
            if payload.get("errors") and not payload.get("data"):
                raise CollectorError("X API 返回错误；请检查查询参数、权限或额度")
            rows = payload.get("data", [])
            if not isinstance(rows, list):
                raise CollectorError("X API 返回了非预期的帖子数组结构")
            for row in rows:
                if not isinstance(row, dict):
                    continue
                metrics = row.get("public_metrics") or {}
                if not isinstance(metrics, dict):
                    continue
                try:
                    item = post("x", row.get("id"), row.get("text"), row.get("created_at"), author_id=row.get("author_id"), likes=metrics.get("like_count"), comments=metrics.get("reply_count"), shares=metrics.get("retweet_count"), raw=row, query=query)
                except (ValueError, TypeError, OverflowError):
                    continue
                if in_window(item, window):
                    unique.setdefault(item["post_id"], item)
                if len(unique) >= limit:
                    break
            # Persist every completed page before requesting the next one. A later
            # malformed response or interruption cannot discard earlier samples.
            write_jsonl(output_path, list(unique.values()))
            if len(unique) >= limit:
                break
            metadata = payload.get("meta") or {}
            if not isinstance(metadata, dict):
                raise CollectorError("X API 返回了非预期的分页结构")
            following = metadata.get("next_token")
            if not following or following in seen_tokens:
                break
            seen_tokens.add(following)
            params["next_token"] = following
    finally:
        # KeyboardInterrupt inherits BaseException, so finally also preserves any
        # records normalized since the most recent page checkpoint.
        write_jsonl(output_path, list(unique.values()))
    return list(unique.values())
