"""Read and validate offline anxiety scores for the dashboard.

This module never opens credentials, model clients, or the study database.
"""
from __future__ import annotations

import hashlib
import json
import math
from pathlib import Path
import re


PROMPT_VERSION = "anxiety-intensity-v1"
STATUSES = ("scored", "unassessable", "pending", "error")
ERROR_REASON = "评分结果暂时不可用，请更新评分结果后刷新。"


def empty_score(status: str = "pending") -> dict:
    return {"status": status, "score": None, "evidence": [],
            "reason": ERROR_REASON if status == "error" else "",
            "confidence": None, "model": "", "prompt_version": ""}


def _unit_number(value: object) -> bool:
    return type(value) in (int, float) and math.isfinite(value) and 0 <= value <= 1


def load_scores(export_root: Path) -> tuple[dict[str, dict], set[str], bool, list[Path]]:
    """Return indexed results, duplicate IDs, unreadability, and update sources."""
    directory = export_root / "combined" / "anxiety-v1"
    file = directory / "scores.jsonl"
    changed = [path for path in (file, directory / "summary.json") if path.is_file()]
    if not file.is_file():
        return {}, set(), False, changed
    results: dict[str, dict] = {}
    duplicates: set[str] = set()
    try:
        with file.open(encoding="utf-8-sig") as handle:
            for line in handle:
                if not line.strip():
                    continue
                row = json.loads(line)
                if not isinstance(row, dict) or not isinstance(row.get("record_id"), str) or not row["record_id"]:
                    return {}, set(), True, changed
                ident = row["record_id"]
                if ident in results:
                    duplicates.add(ident)
                else:
                    results[ident] = row
    except (OSError, UnicodeError, json.JSONDecodeError):
        return {}, set(), True, changed
    return results, duplicates, False, changed


def score_for_post(post: dict, results: dict[str, dict], duplicates: set[str], unreadable: bool) -> dict:
    """Bind a score to exact text and expose only validated display fields."""
    if unreadable:
        return empty_score("error")
    ident = f"{post.get('platform')}:{post.get('post_id')}"
    if ident in duplicates:
        return empty_score("error")
    row = results.get(ident)
    if row is None:
        return empty_score()
    text = post.get("text")
    digest = row.get("text_sha256")
    if not isinstance(text, str) or not isinstance(digest, str) or not re.fullmatch(r"[0-9a-f]{64}", digest):
        return empty_score("error")
    if hashlib.sha256(text.encode("utf-8")).hexdigest() != digest:
        return empty_score()
    status = row.get("status")
    if status == "error":
        return empty_score("error")
    if status not in {"scored", "unassessable"}:
        return empty_score("error")
    if row.get("prompt_version") != PROMPT_VERSION:
        return empty_score()
    if "score" not in row:
        return empty_score("error")
    model, reason, confidence = row.get("model"), row.get("reason"), row.get("confidence")
    if not isinstance(model, str) or not model.strip() or not isinstance(reason, str) or not reason.strip():
        return empty_score("error")
    if confidence is not None and not _unit_number(confidence):
        return empty_score("error")
    evidence = row.get("evidence")
    if (not isinstance(evidence, list) or len(evidence) > 2
            or any(not isinstance(quote, str) or not quote or quote not in text for quote in evidence)):
        return empty_score("error")
    if status == "scored":
        if row.get("assessable") is not True or not _unit_number(row.get("score")):
            return empty_score("error")
        if row["score"] > 0 and not evidence:
            return empty_score("error")
    elif row.get("assessable") is not False or row.get("score") is not None or evidence:
        return empty_score("error")
    return {"status": status, "score": row["score"], "evidence": evidence,
            "reason": reason, "confidence": confidence,
            "model": model, "prompt_version": row["prompt_version"]}


def summarize_scores(posts: list[dict]) -> dict:
    result = {"total": len(posts), **dict.fromkeys(STATUSES, 0)}
    for post in posts:
        result[post["anxiety"]["status"]] += 1
    return result
