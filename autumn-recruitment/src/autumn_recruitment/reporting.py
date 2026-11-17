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
    fields = ["platform", "season_year", "graduation_cohort", "post_id", "published_at", "text", "url",
              "relevant", "topics", "sentiment", "emotions", "intensity", "confidence", "evidence", "review_required"]
    with (output / "labels.csv").open("w", encoding="utf-8-sig", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=fields)
        writer.writeheader()
        for row in rows:
            analysis = row["analysis"]
            entry = {key: row.get(key, "") for key in fields[:7]}
            if analysis:
                entry.update({key: analysis[key] for key in fields[7:-1]})
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
            groups.append({"platform": platform, "season_year": year, "target": quotas[year],
                           "selected": len(selected), "shortfall": max(0, quotas[year] - len(selected)),
                           "labelled": len(labelled), "relevant": len(relevant),
                           "sentiments": dict(Counter(p["analysis"]["sentiment"] for p in relevant)),
                           "topics": dict(Counter(t for p in relevant for t in p["analysis"]["topics"])),
                           "emotions": dict(Counter(e for p in relevant for e in p["analysis"]["emotions"]))})
    summary = {"model": model, "prompt_version": prompt_version, "selected": len(rows),
               "labelled": sum(p["analysis"] is not None for p in rows), "groups": groups,
               "limitations": ["搜索结果为非概率样本，不能据此估计整个秋招市场或平台人群的情绪比例。",
                               "多标签话题和情绪计数的分母为各组已标注且相关的帖子，比例之和可能超过 100%。",
                               "缺少的年份配额保留缺口；未完成标注的帖子不计入情绪分母。",
                               "2026 年为截至共同窗口终点的阶段样本，不代表完整秋招季。"]}
    write_json(output / "summary.json", summary)
    lines = ["# 秋招讨论样本报告", "", f"选中 {len(rows)} 条，已标注 {summary['labelled']} 条；模型 {model}，提示版本 {prompt_version}。", "",
             "| 平台 | 秋招年份 | 目标 | 样本 | 缺口 | 已标注 | 相关 | 情感计数 |", "|---|---:|---:|---:|---:|---:|---:|---|"]
    for group in groups:
        sentiments = "、".join(f"{k}: {v}" for k, v in group["sentiments"].items()) or "待标注"
        lines.append(f"| {group['platform']} | {group['season_year']} | {group['target']} | {group['selected']} | {group['shortfall']} | {group['labelled']} | {group['relevant']} | {sentiments} |")
    lines.extend(["", *[f"- {item}" for item in summary["limitations"]], ""])
    (output / "report.md").write_text("\n".join(lines), encoding="utf-8")
    return summary
