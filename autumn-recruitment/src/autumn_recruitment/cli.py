from __future__ import annotations

import argparse
from collections import Counter
from datetime import datetime, timezone
import json
from pathlib import Path
import sys

from .config import load_config
from .llm import LLMClient, PROMPT_VERSION, content_hash, load_settings
from .pipeline import clean_posts, make_plan, select_sample
from .reporting import export_study, write_json
from .storage import Storage


def emit(value: object) -> None:
    print(json.dumps(value, ensure_ascii=False, indent=2))


def selected_posts(store: Storage, config: dict) -> list[dict]:
    return select_sample(clean_posts(store.list_posts(), config), config)


def project_path(value: str, config: dict) -> Path:
    root = Path(config["project_root"])
    path = (root / value).resolve()
    if not path.is_relative_to(root):
        raise ValueError("输出文件必须放在 autumn-recruitment 独立目录内。")
    return path


def make_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="按年采集秋招讨论，使用 sub2api 标注话题与情绪。")
    parser.add_argument("--config", help="研究配置 JSON 路径")
    commands = parser.add_subparsers(dest="command", required=True)
    plan = commands.add_parser("plan", help="显示查询计划，不联网")
    plan.add_argument("--output", help="可选计划 JSON 输出路径，相对项目目录")
    doctor = commands.add_parser("doctor", help="查看模型配置，不显示密钥")
    doctor.add_argument("--live", action="store_true", help="只查询网关模型列表")
    commands.add_parser("llm-check", help="用一条明确标记的合成帖子验证真实模型调用")
    importer = commands.add_parser("import", help="导入 CSV、JSON 或 JSONL")
    importer.add_argument("path")
    importer.add_argument("--platform", required=True, choices=["weibo", "xiaohongshu", "x"])
    commands.add_parser("sample", help="清洗并按平台/年份抽样，输出缺口")
    browser = commands.add_parser("collect-browser", help="浏览器 RPA，默认可见窗口，可复用登录资料")
    browser.add_argument("--platform", required=True, choices=["weibo", "xiaohongshu", "x"])
    browser.add_argument("--query", required=True)
    browser.add_argument("--start", required=True)
    browser.add_argument("--end", required=True, help="不包含此日")
    browser.add_argument("--limit", type=int, default=40)
    browser.add_argument("--timeout", type=int, default=180)
    browser.add_argument("--headless", action="store_true", help="使用无界面 Chromium，复用同一登录资料")
    browser.add_argument("--browser-executable", help="可选 Chromium 可执行文件路径")
    browser.add_argument("--proxy-server", help="本次浏览器专用代理 URL（http/https/socks5，不含账号密码）")
    xapi = commands.add_parser("collect-x-api", help="官方 X 搜索接口，需对应历史权限")
    xapi.add_argument("--query", required=True)
    xapi.add_argument("--start", required=True)
    xapi.add_argument("--end", required=True)
    xapi.add_argument("--limit", type=int, default=40)
    xapi.add_argument("--endpoint", choices=["all", "recent"], default="all")
    analyze = commands.add_parser("analyze", help="调用模型标注当前样本，缓存已完成批次")
    analyze.add_argument("--limit", type=int, help="本次最多分析多少条新帖子")
    analyze.add_argument("--batch-size", type=int, help="每次模型调用帖子数（1–16）")
    commands.add_parser("export", help="导出当前样本、标注 CSV 和按年统计")
    return parser


def main(argv: list[str] | None = None) -> int:
    args = make_parser().parse_args(argv)
    try:
        config = load_config(args.config)
        if args.command == "plan":
            jobs = make_plan(config)
            result = {"target_per_platform": config["target_per_platform"], "years": config["years"],
                      "note": "year_quota 为平台/年份总配额；quota 为该查询分摊的配额，多条查询的 quota 合计为 year_quota。", "jobs": jobs}
            if args.output:
                write_json(project_path(args.output, config), result)
                emit({"plan": str(project_path(args.output, config)), "jobs": len(jobs)})
            else:
                emit(result)
            return 0
        if args.command in {"doctor", "llm-check"}:
            settings = load_settings()
            result = {"base_url": settings.base_url, "model": settings.model, "api": settings.api,
                      "credential_source": settings.credential_source}
            client = LLMClient(settings)
            if args.command == "doctor" and args.live:
                models = client.available_models()
                result.update({"model_list_ok": True, "configured_model_available": settings.model in models})
            if args.command == "llm-check":
                post = {"platform": "weibo", "post_id": "synthetic-check-only", "text": "【合成测试，非真实采集】秋招投了好多简历，还是没有面试，真的很焦虑。", "published_at": "2025-09-01T12:00:00+08:00"}
                labels, usage = client.analyze([post])
                result.update({"synthetic_test": True, "schema_validated": True, "labels": labels, "usage": usage})
            emit(result)
            return 0
        with Storage(config["db_path"]) as store:
            if args.command == "import":
                from .collectors import import_posts
                posts = import_posts(args.path, args.platform)
                emit({"imported": store.upsert_posts(posts), "path": args.path})
            elif args.command in {"collect-browser", "collect-x-api"}:
                if args.limit < 1:
                    raise ValueError("limit 必须为正数。")
                stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S%fZ")
                platform = args.platform if args.command == "collect-browser" else "x"
                output = Path(config["raw_dir"]) / f"{platform}_{stamp}.jsonl"
                if args.command == "collect-browser":
                    from .collectors import collect_browser
                    profile = Path(config["data_dir"]) / "browser-profiles" / platform
                    posts = collect_browser(platform, args.query, args.start, args.end, profile, output,
                                            args.limit, timeout_seconds=args.timeout,
                                            headless=args.headless, executable_path=args.browser_executable,
                                            proxy_server=args.proxy_server)
                else:
                    from .collectors import collect_x_api
                    posts = collect_x_api(args.query, args.start, args.end, output, args.limit, endpoint=args.endpoint)
                emit({"received": len(posts), "requested": args.limit, "shortfall": max(0, args.limit - len(posts)),
                      "stored": store.upsert_posts(posts), "raw_file": str(output)})
            elif args.command == "sample":
                posts = selected_posts(store, config)
                counts = Counter((p["platform"], p["season_year"]) for p in posts)
                output = Path(config["output_dir"])
                output.mkdir(parents=True, exist_ok=True)
                with (output / "sample.jsonl").open("w", encoding="utf-8") as handle:
                    for post in posts:
                        handle.write(json.dumps(post, ensure_ascii=False) + "\n")
                from .pipeline import year_quotas
                quotas = year_quotas(config)
                groups = [{"platform": p, "year": y, "selected": counts[p, y], "target": quotas[y],
                           "shortfall": max(0, quotas[y] - counts[p, y])} for p, setting in config["platforms"].items()
                          if setting.get("enabled", True) for y in config["years"]]
                emit({"selected": len(posts), "groups": groups, "sample": str(output / "sample.jsonl")})
            elif args.command == "analyze":
                if args.limit is not None and args.limit < 1:
                    raise ValueError("limit 必须为正数。")
                batch_size = args.batch_size if args.batch_size is not None else config["llm"].get("batch_size", 8)
                if not 1 <= batch_size <= 16:
                    raise ValueError("batch-size 必须为 1 到 16。")
                settings = load_settings()
                version = PROMPT_VERSION  # Version follows actual prompt, not an editable config label.
                posts = selected_posts(store, config)
                pending = [p for p in posts if store.get_analysis(p["platform"], p["post_id"], content_hash(p), settings.model, version) is None]
                cached = len(posts) - len(pending)
                if args.limit is not None:
                    pending = pending[:args.limit]
                client = LLMClient(settings)
                done = 0
                for index in range(0, len(pending), batch_size):
                    batch = pending[index:index + batch_size]
                    labels, usage = client.analyze(batch)
                    for post, label in zip(batch, labels):
                        store.save_analysis(post["platform"], post["post_id"], label, settings.model, version, content_hash(post))
                    done += len(batch)
                    emit({"analysed": done, "scheduled": len(pending), "cached": cached, "usage": usage})
                emit({"analysed_this_run": done, "cached": cached, "selected": len(posts), "model": settings.model})
            elif args.command == "export":
                settings = load_settings()
                summary = export_study(selected_posts(store, config), store.list_analyses(), config, settings.model, PROMPT_VERSION)
                emit({"selected": summary["selected"], "labelled": summary["labelled"], "output_dir": config["output_dir"]})
        return 0
    except (ValueError, RuntimeError, OSError, json.JSONDecodeError) as exc:
        print(f"错误：{exc}", file=sys.stderr)
        return 1
    except KeyboardInterrupt:
        print("已停止；已完成的采集和分析仍保存在项目目录。", file=sys.stderr)
        return 130
