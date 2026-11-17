"""Audit persisted anxiety results offline; never initializes an API client."""
from __future__ import annotations

import argparse
from collections import Counter, defaultdict
import csv
from datetime import datetime, timezone
import hashlib
import json
import math
from pathlib import Path
import statistics

ROOT = Path(__file__).resolve().parents[1]
CORPUS_SHA256 = "22025e772b232b72601517fcc03bf817fcdeb5ce8d104361d1139443373ef38f"
MODEL = "gpt-6.1-sol"
VERSION = "anxiety-intensity-v1"
PLATFORMS = {"weibo": 200, "xiaohongshu": 207, "nowcoder": 141,
             "hackernews": 200, "workplace": 200, "mastodon": 9}


def sha(value: str | bytes) -> str:
    return hashlib.sha256(value.encode("utf-8") if isinstance(value, str) else value).hexdigest()


def unit_number(value: object) -> bool:
    return type(value) in (int, float) and math.isfinite(value) and 0 <= value <= 1


def jsonl(file: Path) -> list[dict]:
    return [json.loads(line) for line in file.read_text(encoding="utf-8-sig").splitlines() if line.strip()]


def response_items(response: dict) -> list[dict]:
    if not isinstance(response, dict) or response.get("model") != MODEL:
        raise ValueError("Raw response model differs")
    if "status" in response:
        if response["status"] != "completed":
            raise ValueError("Raw response incomplete")
        text = response.get("output_text")
        if not text:
            text = "".join(part["text"] for message in response.get("output", [])
                           for part in message.get("content", []) if part.get("type") == "output_text")
    else:
        choices = response.get("choices", [])
        if len(choices) != 1 or choices[0].get("finish_reason") != "stop":
            raise ValueError("Raw chat response incomplete")
        text = choices[0]["message"]["content"]
    decoded = json.loads(text)
    if not isinstance(decoded, dict) or set(decoded) != {"items"} or not isinstance(decoded["items"], list):
        raise ValueError("Raw response JSON invalid")
    return decoded["items"]


def stats(rows: list[dict], results: dict[str, dict]) -> dict:
    statuses = Counter(results.get(row["record_id"], {}).get("status", "pending") for row in rows)
    values = [results[row["record_id"]]["score"] for row in rows
              if results.get(row["record_id"], {}).get("status") == "scored"
              and unit_number(results[row["record_id"]].get("score"))]
    bins = [0] * 10
    for value in values:
        bins[min(9, int(value * 10))] += 1
    return {"total": len(rows), "statuses": dict(statuses), "zero": values.count(0),
            "nonzero": len(values) - values.count(0), "mean": statistics.mean(values) if values else None,
            "median": statistics.median(values) if values else None,
            "min": min(values) if values else None, "max": max(values) if values else None,
            "histogram": bins}


def audit(allow_pending: bool) -> dict:
    base = ROOT / "outputs" / "combined"
    directory = base / "anxiety-v1"
    failures: list[str] = []
    skipped: list[str] = []
    checks = 0

    def check(condition: bool, message: str) -> None:
        nonlocal checks
        checks += 1
        if not condition:
            failures.append(message)

    raw = (base / "sample.jsonl").read_bytes()
    corpus = []
    for index, line in enumerate(raw.decode("utf-8-sig").splitlines(), 1):
        if not line.strip():
            continue
        row = json.loads(line)
        corpus.append({**row, "record_id": f"{row['platform']}:{row['post_id']}",
                       "case_id": f"p{index:05d}", "text_sha256": sha(row["text"])})
    by_id = {row["record_id"]: row for row in corpus}
    by_case = {row["case_id"]: row for row in corpus}
    check(sha(raw) == CORPUS_SHA256, "Original corpus SHA-256 changed")
    check(len(corpus) == len(by_id) == 957, "Corpus must contain 957 unique canonical IDs")
    check(Counter(row["platform"] for row in corpus) == PLATFORMS, "Corpus platform totals differ")
    check(sum(row["analysis"]["relevant"] is True for row in corpus) == 831, "Original relevance total differs")
    manifest = json.loads((directory / "manifest.json").read_text(encoding="utf-8"))
    check(manifest.get("model") == MODEL and manifest.get("version") == VERSION, "Manifest model/version differs")
    check(manifest.get("corpus_sha256") == CORPUS_SHA256 and manifest.get("total") == 957, "Manifest corpus differs")
    check(manifest.get("records") == [{key: row[key] for key in ("record_id", "text_sha256", "case_id")} for row in corpus],
          "Manifest record identities or text hashes differ")
    prompt = (directory / "prompt.txt").read_text(encoding="utf-8").removesuffix("\n")
    check(manifest.get("prompt_sha256") == sha(prompt), "Saved prompt hash differs from manifest")
    scores = jsonl(directory / "scores.jsonl")
    results = {row.get("record_id"): row for row in scores}
    check(len(scores) == len(results), "Duplicate result IDs")
    check(set(results) <= set(by_id), "Results contain IDs outside the corpus")
    if not allow_pending:
        check(len(results) == 957, "Results do not contain all 957 posts")

    requests: dict[str, tuple[dict, dict[str, list[dict]]]] = {}
    discarded_total = 0
    for result in scores:
        ident = result.get("record_id")
        row = by_id.get(ident)
        if row is None:
            continue
        try:
            check(all(result.get(key) == row[key] for key in ("record_id", "case_id", "text_sha256")), f"{ident}: identity mismatch")
            check(result.get("model") == MODEL and result.get("prompt_version") == VERSION, f"{ident}: model/version mismatch")
            status, value = result.get("status"), result.get("score")
            check(status in {"scored", "unassessable"}, f"{ident}: unfinished or invalid result status {status}")
            if status not in {"scored", "unassessable"}:
                continue
            check(result.get("assessable") is (status == "scored"), f"{ident}: assessability differs from status")
            check(unit_number(value) if status == "scored" else value is None, f"{ident}: score/null invalid")
            check(unit_number(result.get("confidence")), f"{ident}: confidence invalid")
            check(isinstance(result.get("reason"), str) and bool(result["reason"].strip()), f"{ident}: missing reason")
            evidence = result.get("evidence")
            check(isinstance(evidence, list) and len(evidence) <= 2
                  and all(isinstance(quote, str) and bool(quote) and quote in row["text"] for quote in evidence),
                  f"{ident}: evidence is not verbatim")
            if value is None or value == 0:
                check(evidence == [], f"{ident}: zero/null has supporting evidence")
            elif unit_number(value):
                check(bool(evidence), f"{ident}: nonzero has no evidence")
            cache = directory / "records" / (sha(ident) + ".json")
            check(json.loads(cache.read_text(encoding="utf-8")) == result, f"{ident}: record cache differs from sidecar")
            name = result.get("raw_file")
            if not isinstance(name, str):
                raise ValueError("Missing raw response path")
            file = directory / name
            if file.resolve().parent != (directory / "requests").resolve() or file.suffix != ".json":
                raise ValueError("Invalid raw response path")
            if name not in requests:
                saved = json.loads(file.read_text(encoding="utf-8"))
                check(saved.get("model") == MODEL and saved.get("prompt_version") == VERSION, f"{name}: request model/version differs")
                for key in ("prompt_sha256", "schema_sha256"):
                    if key in saved:
                        check(saved[key] == manifest[key], f"{name}: request {key} differs")
                inputs = saved.get("inputs", [])
                input_ids = [item.get("case_id") for item in inputs]
                check(len(inputs) == len(set(input_ids)) and bool(inputs), f"{name}: duplicate or missing request inputs")
                for item in inputs:
                    original = by_case.get(item.get("case_id"))
                    check(original is not None and set(item) == {"case_id", "text"}
                          and item["text"] == original["text"], f"{name}: request text/case differs from corpus")
                response = saved["response"]
                if "instructions" in response:
                    check(response["instructions"] == prompt, f"{name}: actual prompt differs")
                indexed: dict[str, list[dict]] = defaultdict(list)
                for item in response_items(response):
                    indexed[item["case_id"]].append(item)
                requests[name] = (saved, indexed)
            saved, indexed = requests[name]
            check(result["case_id"] in [item["case_id"] for item in saved["inputs"]], f"{ident}: case absent from referenced request")
            check(result.get("response_id") == saved["response"].get("id"), f"{ident}: response ID mismatch")
            items = indexed.get(result["case_id"], [])
            if len(items) != 1:
                raise ValueError("Case missing or duplicated in raw response")
            original = items[0]
            check(set(original) == {"case_id", "score", "assessable", "confidence", "evidence", "reason"}
                  and type(original.get("assessable")) is bool
                  and unit_number(original.get("confidence"))
                  and (unit_number(original.get("score")) if original.get("assessable") else original.get("score") is None),
                  f"{ident}: original response item schema invalid")
            for key in ("score", "assessable", "confidence", "reason"):
                check(result.get(key) == original.get(key), f"{ident}: {key} differs from model response")
            original_evidence = original["evidence"]
            retained = [quote for quote in original_evidence if quote in row["text"]]
            discarded = [quote for quote in original_evidence if quote not in row["text"]]
            check(evidence == retained, f"{ident}: evidence differs from valid raw quotes")
            check(result.get("discarded_nonverbatim_quotes") == discarded, f"{ident}: discarded quote audit differs")
            discarded_total += len(discarded)
        except (KeyError, TypeError, ValueError, OSError) as exc:
            check(False, f"{ident}: audit could not finish: {type(exc).__name__}: {exc}")

    totals = stats(corpus, results)
    summary = json.loads((directory / "summary.json").read_text(encoding="utf-8"))
    if allow_pending:
        skipped.append("Summary and CSV snapshot comparisons deferred while scorer may still be writing.")
    else:
        check(summary.get("model") == MODEL and summary.get("prompt_version") == VERSION, "Summary model/version differs")
        check(summary.get("corpus_sha256") == CORPUS_SHA256, "Summary corpus hash differs")
        for status in ("scored", "unassessable", "pending", "error"):
            check(summary.get(status) == totals["statuses"].get(status, 0), f"Summary {status} count differs")
        check(summary.get("completed") == 957 and summary.get("total") == 957, "Summary completion differs")
        for name in ("mean", "median"):
            expected = totals[name]
            actual = summary.get(name)
            check(actual is None if expected is None else isinstance(actual, (int, float)) and math.isclose(actual, expected, abs_tol=1e-12),
                  f"Summary {name} differs")
        with (directory / "scores.csv").open(encoding="utf-8-sig", newline="") as handle:
            csv_rows = list(csv.DictReader(handle))
        csv_ids = [row.get("record_id") for row in csv_rows]
        check(len(csv_rows) == len(set(csv_ids)) == 957 and set(csv_ids) == set(by_id), "CSV must contain all 957 unique IDs")
        for entry in csv_rows:
            ident = entry["record_id"]
            if ident not in results or ident not in by_id:
                continue
            result, row = results[ident], by_id[ident]
            for key in ("status", "assessable", "confidence", "reason", "model", "prompt_version"):
                check(entry[key] == str(result[key]), f"{ident}: CSV {key} differs")
            check(entry["score"] == ("" if result["score"] is None else str(result["score"])), f"{ident}: CSV score/null differs")
            check(json.loads(entry["evidence"]) == result["evidence"], f"{ident}: CSV evidence differs")
            for key in ("platform", "season_year", "text", "url"):
                expected = str(row.get(key, ""))
                if expected.lstrip().startswith(("=", "+", "-", "@")):
                    expected = "'" + expected
                check(entry[key] == expected, f"{ident}: CSV {key} differs")
            check(entry["relevant"] == str(row["analysis"]["relevant"]), f"{ident}: CSV relevance differs")

    examples = []
    for label, low, high in (("zero", 0, 0), ("slight", .1, .25), ("moderate", .3, .5),
                             ("strong", .55, .75), ("very strong", .8, 1)):
        candidates = [row for row in corpus if unit_number(results.get(row["record_id"], {}).get("score"))
                      and low <= results[row["record_id"]]["score"] <= high]
        if candidates:
            row = min(candidates, key=lambda item: len(item["text"]))
            result = results[row["record_id"]]
            examples.append({"anchor": label, "record_id": row["record_id"], "platform": row["platform"],
                             "text": row["text"], "score": result["score"], "evidence": result["evidence"], "reason": result["reason"]})
    return {"passed": not failures, "allow_pending": allow_pending, "checks": checks, "failures": failures,
            "skipped": skipped, "audited_at": datetime.now(timezone.utc).isoformat(),
            "corpus_sha256": sha(raw), "model": MODEL, "prompt_version": VERSION,
            "totals": totals, "referenced_raw_responses": len(requests), "discarded_nonverbatim_quotes": discarded_total,
            "by_platform": {platform: stats([row for row in corpus if row["platform"] == platform], results) for platform in sorted(PLATFORMS)},
            "by_year": {str(year): stats([row for row in corpus if row["season_year"] == year], results)
                        for year in sorted({row["season_year"] for row in corpus})},
            "examples": examples,
            "interpretation": "Single-model text-expression estimates; no accuracy or clinical validity claim. Examples illustrate the scale and are not representative samples."}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--allow-pending", action="store_true", help="Permit missing records and defer final summary/CSV snapshot checks")
    parser.add_argument("--output", type=Path, default=ROOT / "data" / "diagnostics" / "anxiety-data-audit.json")
    args = parser.parse_args()
    try:
        report = audit(args.allow_pending)
    except (OSError, ValueError, KeyError, TypeError) as exc:
        report = {"passed": False, "failures": [f"{type(exc).__name__}: {exc}"]}
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    brief = {key: report[key] for key in ("passed", "checks", "totals", "skipped") if key in report}
    brief.update(failure_count=len(report["failures"]), failures=report["failures"][:20])
    print(json.dumps(brief, ensure_ascii=False, indent=2))
    print(f"Report: {args.output}")
    return 0 if report["passed"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
