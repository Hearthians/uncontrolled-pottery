"""Export selected posts and labelled counts with explicit sampling denominators."""
from __future__ import annotations

import csv
import json
from collections import Counter
from pathlib import Path

from .llm import content_hash
from .pipeline import year_quotas


def write_json(path: Path, value: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def export_study(posts: list[dict], analyses: list[dict], config: dict, model: str, prompt_version: str) -> dict:
    output = Path(config["output_dir"])
    output.mkdir(parents=True, exist_ok=True)
    labels = {(a["platform"], a["post_id"], a["content_hash"]): a["analysis"] for a in analyses
              if a["model"] == model and a["prompt_version"] == prompt_version}
    rows = []
    for post in posts:
        analysis = labels.get((post["platform"], post["post_id"], content_hash(post)))
        rows.append({**post, "analysis": analysis})
    with (output / "sample.jsonl").open("w", encoding="utf-8") as handle:
        for row in rows:
            handle.write(json.dumps(row, ensure_ascii=False) + "\n")
    post_fields = ["platform", "season_year", "graduation_cohort", "post_id", "published_at", "text", "url",
                   "entry_type", "thread_id", "parent_id", "language", "market_region"]
    analysis_fields = ["relevant", "topics", "sentiment", "emotions", "intensity", "confidence", "evidence"]
    fields = post_fields + analysis_fields + ["review_required"]
    with (output / "labels.csv").open("w", encoding="utf-8-sig", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=fields)
        writer.writeheader()
        for row in rows:
            analysis = row["analysis"]
            entry = {key: row.get(key, "") for key in post_fields}
            if analysis:
                entry.update({key: analysis[key] for key in analysis_fields})
                for key in ("topics", "emotions", "evidence"):
                    entry[key] = json.dumps(entry[key], ensure_ascii=False)
                entry["review_required"] = analysis["confidence"] < 0.7 or analysis["sentiment"] == "uncertain"
            # Prevent spreadsheet formulas in user-authored text or other fields.
            for key, value in entry.items():
                if isinstance(value, str) and value.lstrip().startswith(("=", "+", "-", "@")):
                    entry[key] = "'" + value
            writer.writerow(entry)
    groups = []
    quotas = year_quotas(config)
    for platform, settings in config["platforms"].items():
        if not settings.get("enabled", True):
            continue
        for year in config["years"]:
            selected = [p for p in rows if p["platform"] == platform and p["season_year"] == year]
            labelled = [p for p in selected if p["analysis"] is not None]
            relevant = [p for p in labelled if p["analysis"]["relevant"]]
            publication_dates = sorted({p["published_at"][:10] for p in selected})
            groups.append({"platform": platform, "season_year": year, "target": quotas[year],
                           "selected": len(selected), "shortfall": max(0, quotas[year] - len(selected)),
                           "labelled": len(labelled), "relevant": len(relevant),
                           "relevant_shortfall": max(0, quotas[year] - len(relevant)),
                           "publication_date_count": len(publication_dates), "publication_dates": publication_dates,
                           "sentiments": dict(Counter(p["analysis"]["sentiment"] for p in relevant)),
                           "topics": dict(Counter(t for p in relevant for t in p["analysis"]["topics"])),
                           "emotions": dict(Counter(e for p in relevant for e in p["analysis"]["emotions"]))})
    mode = config.get("sampling", {}).get("mode", "balanced")
    summary = {"model": model, "prompt_version": prompt_version, "sampling_mode": mode,
               "study_scope": config.get("study_scope", "campus_recruitment"),
               "study_name": config.get("study_name", ""), "description": config.get("description", ""), "selected": len(rows),
               "labelled": sum(p["analysis"] is not None for p in rows), "groups": groups,
               "limitations": ["搜索结果为非概率样本，不能据此估计整个秋招市场或平台人群的情绪比例。",
                               "多标签话题和情绪计数的分母为各组已标注且相关的帖子，比例之和可能超过 100%。",
                               "候选缺口按选中条数计算；相关缺口按模型确认相关的条数计算，含尚未标注的潜在缺口。",
                               "正文明确包含研究窗口后新增内容、并经 temporal_review 确认的帖子不纳入按年比较；原始记录保留。其余历史帖也是采集时可见版本，不能保证还原最初正文。",
                               "情感与情绪描述作者在整帖中的表达，可能涉及生活或其他事件，不能一律解释为对招聘市场的态度；标签未经全量人工语义复核。",
                               "缺少的年份配额保留缺口；未完成标注的帖子不计入情绪分母。",
                               "2026 年为采集时已发表且处于共同窗口内的阶段样本，不代表完整秋招季。"]}
    if mode == "available":
        summary["limitations"].append("本报告为可用数据补充集，保留作者上限但不限制各年条数；年份分布不均，目标列仅用来展示原定逐年配额及其缺口。")
    if config.get("study_scope") == "overseas_employment":
        summary["limitations"][0] = "搜索结果为非概率样本，不能据此估计整个海外就业市场或平台人群的情绪比例。"
        summary["limitations"] = [
            "2026 年为采集时已发表且处于共同窗口内的阶段样本；海外就业并不采用中国秋招季定义。"
            if item == "2026 年为采集时已发表且处于共同窗口内的阶段样本，不代表完整秋招季。" else item
            for item in summary["limitations"]
        ]
        summary["limitations"].append("本组为海外英文等就业讨论比较集，含一般职场与求职观点，不代表中文校园秋招人群。主题帖、问题、回答和评论是不同讨论单元，原文语言及类型随记录保留。")
    sparse_weibo = [g for g in groups if g["platform"] == "weibo" and 0 < g["publication_date_count"] <= 4]
    if sparse_weibo:
        summary["limitations"].append(
            "本次微博采集取月度搜索结果的前部页面，所选年份样本仅覆盖各年不超过 4 个日期；"
            "存在排序和边界日期集中偏差，不能据此判断整个秋招季的变化。具体日期见各组 publication_dates。")
    write_json(output / "summary.json", summary)
    mode_label = "按年配额样本" if mode == "balanced" else "可用数据补充集（年份不均衡）"
    overseas = config.get("study_scope") == "overseas_employment"
    title, year_label = ("海外就业讨论样本报告", "讨论年份") if overseas else ("秋招讨论样本报告", "秋招年份")
    lines = [f"# {title}", "", f"{mode_label}。选中 {len(rows)} 条，已标注 {summary['labelled']} 条；模型 {model}，提示版本 {prompt_version}。", "",
             f"| 平台 | {year_label} | 目标 | 选中 | 候选缺口 | 已标注 | 相关 | 相关缺口 | 覆盖日期数 | 情感计数 |", "|---|---:|---:|---:|---:|---:|---:|---:|---:|---|"]
    for group in groups:
        sentiments = "、".join(f"{k}: {v}" for k, v in group["sentiments"].items())
        if not sentiments:
            sentiments = "无样本" if not group["selected"] else "待标注" if group["labelled"] < group["selected"] else "无相关帖子"
        lines.append(f"| {group['platform']} | {group['season_year']} | {group['target']} | {group['selected']} | {group['shortfall']} | {group['labelled']} | {group['relevant']} | {group['relevant_shortfall']} | {group['publication_date_count']} | {sentiments} |")
    lines.extend(["", "各年份的主要话题和情绪如下。每条帖子可有多个标签，计数分母为该组已标注且相关的帖子。", "",
                  f"| 平台 | {year_label} | 相关帖子数 | 讨论话题（条数） | 表达情绪（条数） |",
                  "|---|---:|---:|---|---|"])
    for group in groups:
        if not group["relevant"]:
            continue
        topics = "、".join(f"{name}: {count}" for name, count in Counter(group["topics"]).most_common(5)) or "无明确话题"
        emotions = "、".join(f"{name}: {count}" for name, count in Counter(group["emotions"]).most_common(5)) or "无明确情绪"
        lines.append(f"| {group['platform']} | {group['season_year']} | {group['relevant']} | {topics} | {emotions} |")
    lines.extend(["", *[f"- {item}" for item in summary["limitations"]], ""])
    (output / "report.md").write_text("\n".join(lines), encoding="utf-8")
    return summary
