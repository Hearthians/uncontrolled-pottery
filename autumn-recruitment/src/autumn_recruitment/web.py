"""Local, read-only dashboard over exported study results.

The browser receives display fields only. Raw observations, credentials, browser
profiles, and the study database are never part of the HTTP file tree.
"""
from __future__ import annotations

from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
from pathlib import Path
from urllib.parse import parse_qs, unquote, urlsplit, urlunsplit

from .anxiety import load_scores, score_for_post, summarize_scores


DATASETS = {
    "combined": ("全平台合并集", "combined"),
    "balanced": ("按年配额样本", ""),
    "xiaohongshu-available": ("小红书可用补充集", "xiaohongshu-available"),
    "additional-chinese": ("国内平台补充集", "additional-chinese"),
    "overseas-employment": ("海外英文就业讨论", "overseas-employment"),
}
PLATFORMS = {"weibo": "微博", "xiaohongshu": "小红书", "x": "X / Twitter",
             "nowcoder": "牛客", "bilibili": "哔哩哔哩", "zhihu": "知乎",
             "hackernews": "Hacker News", "workplace": "The Workplace",
             "mastodon": "Mastodon", "reddit": "Reddit", "bluesky": "Bluesky"}
STATIC_FILES = {
    "/": ("index.html", "text/html; charset=utf-8"),
    "/index.html": ("index.html", "text/html; charset=utf-8"),
    "/app.js": ("app.js", "text/javascript; charset=utf-8"),
    "/styles.css": ("styles.css", "text/css; charset=utf-8"),
    "/favicon.svg": ("favicon.svg", "image/svg+xml"),
}
POST_FIELDS = ("platform", "post_id", "text", "published_at", "season_year", "graduation_cohort",
               "entry_type", "thread_id", "parent_id", "language", "market_region")
ANALYSIS_FIELDS = ("id", "relevant", "topics", "sentiment", "emotions", "intensity", "confidence", "evidence")
SUMMARY_FIELDS = ("model", "prompt_version", "sampling_mode", "selected", "labelled", "limitations",
                  "study_scope", "study_name", "description")
GROUP_FIELDS = ("platform", "season_year", "target", "selected", "shortfall", "labelled", "relevant",
                "relevant_shortfall", "publication_date_count", "publication_dates", "sentiments", "topics", "emotions")
QUALITY_FIELDS = ("integrity_check", "raw_post_counts", "eligible_post_counts", "selected", "labelled", "relevant",
                  "duplicate_selected_ids", "selected_missing_author", "selected_with_ui_suffix", "raw_record_versions")


class DashboardError(ValueError):
    def __init__(self, message: str, status: int = 400):
        super().__init__(message)
        self.status = status


def source_url(value: object, platform: str) -> str:
    """Keep source links, without browser-issued tokens or unrelated hosts."""
    if not isinstance(value, str):
        return ""
    try:
        parsed = urlsplit(value)
        allowed = {
            "weibo": {"weibo.com", "www.weibo.com", "m.weibo.cn"},
            "xiaohongshu": {"www.xiaohongshu.com", "xiaohongshu.com"},
            "x": {"x.com", "www.x.com", "twitter.com", "www.twitter.com"},
            "nowcoder": {"nowcoder.com", "www.nowcoder.com"},
            "bilibili": {"www.bilibili.com"},
            "zhihu": {"www.zhihu.com", "zhihu.com"},
            "hackernews": {"news.ycombinator.com"},
            "workplace": {"workplace.stackexchange.com"},
            "mastodon": {"hachyderm.io", "mastodon.social", "isdream.ing", "mastodon.gamedev.place",
                         "mstdn.social", "toot.majorshouse.com", "universeodon.com"},
            "reddit": {"reddit.com", "www.reddit.com"},
            "bluesky": {"bsky.app"},
        }.get(platform, set())
        if (parsed.scheme != "https" or parsed.hostname not in allowed or parsed.username is not None
                or parsed.password is not None or parsed.port not in (None, 443)):
            return ""
        # HN's numeric item identifier is part of the permalink, not a token.
        query = ""
        if platform == "hackernews":
            identifiers = parse_qs(parsed.query, keep_blank_values=True).get("id", [])
            if len(identifiers) == 1 and identifiers[0].isascii() and identifiers[0].isdigit():
                query = "id=" + identifiers[0]
            elif parsed.path == "/item":
                return ""
        # Use a canonical hostname rather than retaining arbitrary authority text.
        return urlunsplit(("https", parsed.hostname or "", parsed.path, query, ""))
    except ValueError:
        return ""


def _json_file(path: Path) -> dict:
    try:
        value = json.loads(path.read_text(encoding="utf-8-sig"))
    except FileNotFoundError:
        raise DashboardError("尚无可用导出，请先执行 sample、analyze 和 export。", 404) from None
    except (OSError, UnicodeError, json.JSONDecodeError):
        raise DashboardError("导出文件暂时无法读取，请完成导出后刷新。", 503) from None
    if not isinstance(value, dict):
        raise DashboardError("导出文件格式无效，请重新执行 export。", 503)
    return value


def load_dashboard(config: dict, dataset: str = "balanced") -> dict:
    if dataset not in DATASETS:
        raise DashboardError("未知数据集。")
    export_root = Path(config["project_root"]) / "outputs"
    directory = export_root / DATASETS[dataset][1]
    summary_file, sample_file = directory / "summary.json", directory / "sample.jsonl"
    original_summary = _json_file(summary_file)
    summary = {key: original_summary[key] for key in SUMMARY_FIELDS if key in original_summary}
    groups = original_summary.get("groups")
    if not isinstance(groups, list) or not all(isinstance(g, dict) for g in groups):
        raise DashboardError("统计导出格式无效，请重新执行 export。", 503)
    summary["groups"] = [{key: group[key] for key in GROUP_FIELDS if key in group} for group in groups]
    anxiety_results, anxiety_duplicates, anxiety_unreadable, anxiety_changed = load_scores(export_root)
    posts = []
    try:
        with sample_file.open(encoding="utf-8-sig") as handle:
            for line in handle:
                if not line.strip():
                    continue
                original = json.loads(line)
                if not isinstance(original, dict) or original.get("platform") not in PLATFORMS:
                    raise DashboardError("样本导出格式无效，请重新执行 export。", 503)
                post = {key: original[key] for key in POST_FIELDS if key in original}
                post["url"] = source_url(original.get("url"), original["platform"])
                analysis = original.get("analysis")
                post["analysis"] = ({key: analysis[key] for key in ANALYSIS_FIELDS if key in analysis}
                                    if isinstance(analysis, dict) else None)
                post["anxiety"] = score_for_post(post, anxiety_results, anxiety_duplicates, anxiety_unreadable)
                posts.append(post)
    except FileNotFoundError:
        raise DashboardError("尚无可用样本，请先执行 export。", 404) from None
    except (OSError, UnicodeError, json.JSONDecodeError):
        raise DashboardError("样本文件暂时无法读取，请完成导出后刷新。", 503) from None
    quality_path = directory / "quality-audit.json"
    quality = {}
    if quality_path.is_file():
        original_quality = _json_file(quality_path)
        quality = {key: original_quality[key] for key in QUALITY_FIELDS if key in original_quality}
        errors = original_quality.get("label_validation_errors", [])
        quality["label_validation_error_count"] = len(errors) if isinstance(errors, list) else None
    available = []
    for name, (label, suffix) in DATASETS.items():
        folder = export_root / suffix
        if (folder / "summary.json").is_file() and (folder / "sample.jsonl").is_file():
            available.append({"id": name, "label": label})
    summary["anxiety"] = summarize_scores(posts)
    changed = max(path.stat().st_mtime for path in (summary_file, sample_file, quality_path, *anxiety_changed) if path.is_file())
    years = sorted({group["season_year"] for group in groups if isinstance(group.get("season_year"), int)})
    platforms = {group.get("platform") for group in groups}
    return {"dataset": dataset, "summary": summary, "posts": posts, "quality": quality,
            "meta": {"updated_at": datetime.fromtimestamp(changed, timezone.utc).isoformat(),
                     "available_datasets": available, "years": years,
                     "platforms": [{"id": key, "label": label} for key, label in PLATFORMS.items() if key in platforms],
                     "window": {key: value for key, value in config.get("window", {}).items()
                                if key in {"start_month", "start_day", "end_month", "end_day"}}}}


def create_server(config: dict, host: str = "127.0.0.1", port: int = 8765) -> ThreadingHTTPServer:
    if not 0 <= port <= 65535:
        raise ValueError("port 必须为 0 到 65535。")
    web_root = Path(config["project_root"]) / "web"

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *_: object) -> None:
            pass

        def send_content(self, status: int, body: bytes, content_type: str, head: bool = False) -> None:
            self.send_response(status)
            self.send_header("Content-Type", content_type)
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "no-store")
            self.send_header("X-Content-Type-Options", "nosniff")
            self.send_header("Referrer-Policy", "no-referrer")
            self.send_header("Content-Security-Policy", "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'")
            self.end_headers()
            if not head:
                self.wfile.write(body)

        def send_json(self, status: int, value: object, head: bool = False) -> None:
            self.send_content(status, json.dumps(value, ensure_ascii=False).encode("utf-8"), "application/json; charset=utf-8", head)

        def handle_read(self, head: bool = False) -> None:
            parsed = urlsplit(self.path)
            path = unquote(parsed.path)
            if path == "/health":
                self.send_json(200, {"ok": True}, head)
                return
            if path == "/api/dashboard":
                query = parse_qs(parsed.query, keep_blank_values=True)
                values = query.get("dataset", ["balanced"])
                if len(values) != 1:
                    self.send_json(400, {"error": "每次只能选择一个数据集。"}, head)
                    return
                try:
                    self.send_json(200, load_dashboard(config, values[0]), head)
                except DashboardError as exc:
                    self.send_json(exc.status, {"error": str(exc)}, head)
                except OSError:
                    self.send_json(503, {"error": "数据正在更新，请稍后刷新。"}, head)
                return
            asset = STATIC_FILES.get(path)
            if asset is None:
                self.send_json(404, {"error": "页面不存在。"}, head)
                return
            try:
                body = (web_root / asset[0]).read_bytes()
            except OSError:
                self.send_json(404, {"error": "页面资源尚未安装。"}, head)
                return
            self.send_content(200, body, asset[1], head)

        def do_GET(self) -> None:
            self.handle_read()

        def do_HEAD(self) -> None:
            self.handle_read(head=True)

    return ThreadingHTTPServer((host, port), Handler)


def serve(config: dict, host: str = "127.0.0.1", port: int = 8765) -> None:
    with create_server(config, host, port) as server:
        address, actual_port = server.server_address[:2]
        print(f"秋招讨论可视化：http://{address}:{actual_port}/", flush=True)
        print("按 Ctrl+C 停止。", flush=True)
        try:
            server.serve_forever(poll_interval=0.25)
        except KeyboardInterrupt:
            print("网页服务已停止。", flush=True)
