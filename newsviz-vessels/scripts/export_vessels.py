#!/usr/bin/env python3
"""Export Tag-only Guardian scores into Xiaojun's annual DATA_INTERFACE JSON.

Each year and dimension becomes one vessel record:
  {country, year, items: [{id, score}]}  with 1–97 items, scores in [0, 1].

Valence is inverted as (1 - v) / 2 so higher means more negative.
Years with more than 97 articles keep 97 evenly spaced score-quantiles
(per dimension). A sidecar lists title, url and date for hover/inspect.
"""

from __future__ import annotations

import argparse
import gzip
import json
import math
from collections import defaultdict
from datetime import date, timedelta
from pathlib import Path

EPOCH = date(1970, 1, 1)
MAX_ITEMS = 97
DIMS = (
    {"id": "valence", "label": "Valence", "country": "Guardian · valence",
     "scale": "inverted (1 − v) / 2; higher = more negative"},
    {"id": "alarmist", "label": "Alarmist", "country": "Guardian · alarmist",
     "scale": "0–1; higher = more alarmist"},
    {"id": "angry", "label": "Angry", "country": "Guardian · angry",
     "scale": "0–1; higher = more angry"},
)
BASIS = {0: "headline_standfirst", 1: "body", 2: "body_truncated"}


def load_json(path: Path):
    data = path.read_bytes()
    if path.name.endswith(".gz"):
        data = gzip.decompress(data)
    return json.loads(data)


def article_id(url: str, index: int) -> str:
    prefix = "https://www.theguardian.com/"
    if url.startswith(prefix):
        slug = url[len(prefix):].strip("/")
        if slug:
            return slug
    return f"article-{index}"


def unit_score(dimension: str, raw: float) -> float:
    """Convert a stored 10_000-scaled score into a 0–1 vessel score."""
    value = raw / 10_000.0
    if dimension == "valence":
        value = (1.0 - value) / 2.0
    if not math.isfinite(value):
        raise ValueError(f"non-finite score {raw}")
    return min(1.0, max(0.0, value))


def quantile_sample(rows: list[dict], k: int = MAX_ITEMS) -> list[dict]:
    """Keep all rows if n ≤ k, otherwise k rank-even quantile samples.

    Rows are sorted by (score, id). Indices are
    round(i * (n - 1) / (k - 1)) for i in 0..k-1, so the sample includes
    the lowest and highest scores. Rare index collisions are nudged to the
    nearest unused rank so the result always has k distinct articles.
    """
    ordered = sorted(rows, key=lambda row: (row["score"], row["id"]))
    n = len(ordered)
    if n <= k:
        return ordered
    chosen: list[int] = []
    used: set[int] = set()
    for i in range(k):
        index = int(round(i * (n - 1) / (k - 1)))
        if index in used:
            for delta in range(1, n):
                if index + delta < n and index + delta not in used:
                    index = index + delta
                    break
                if index - delta >= 0 and index - delta not in used:
                    index = index - delta
                    break
        used.add(index)
        chosen.append(index)
    return [ordered[index] for index in chosen]


def year_of(day_offset: int) -> int:
    return (EPOCH + timedelta(days=int(day_offset))).year


def iso_date(day_offset: int) -> str:
    return (EPOCH + timedelta(days=int(day_offset))).isoformat()


def score_map(payload: dict, series_id: str) -> dict[int, tuple[float, int]]:
    series = payload[series_id]
    points = series[0] if isinstance(series, list) and series and isinstance(series[0], list) else series
    mapping: dict[int, tuple[float, int]] = {}
    for point in points:
        index, raw, *rest = point
        basis = rest[0] if rest else 1
        mapping[int(index)] = (float(raw), int(basis))
    return mapping


def export(asset_dir: Path, out_dir: Path, series_id: str) -> dict:
    articles = load_json(asset_dir / "articles.json.gz")
    rows = articles["articles"]
    if not rows:
        raise SystemExit("no tag articles in articles.json.gz")

    scores = {
        dim["id"]: score_map(load_json(asset_dir / "data" / f"{dim['id']}.json.gz"), series_id)
        for dim in DIMS
    }

    by_year: dict[int, list[int]] = defaultdict(list)
    catalog: dict[str, dict] = {}
    for index, row in enumerate(rows):
        day, title, _standfirst, url, *_ = row
        year = year_of(day)
        ident = article_id(url, index)
        by_year[year].append(index)
        catalog[ident] = {"title": title, "url": url, "date": iso_date(day)}

    years = sorted(year for year in by_year if 2005 <= year <= 2026)
    out_dir.mkdir(parents=True, exist_ok=True)

    year_summaries = []
    sidecar: dict[str, dict] = {}
    missing = {dim["id"]: 0 for dim in DIMS}

    for year in years:
        indices = by_year[year]
        article_count = len(indices)
        item_counts = {}
        pack = {"year": year, "articleCount": article_count, "vessels": {}, "articles": {}}
        for dim in DIMS:
            built = []
            for index in indices:
                entry = scores[dim["id"]].get(index)
                if entry is None:
                    missing[dim["id"]] += 1
                    continue
                raw, basis = entry
                ident = article_id(rows[index][3], index)
                built.append({
                    "id": ident,
                    "score": unit_score(dim["id"], raw),
                    "raw": raw / 10_000.0,
                    "basis": BASIS.get(basis, str(basis)),
                })
            sampled = quantile_sample(built)
            item_counts[dim["id"]] = len(sampled)
            pack["vessels"][dim["id"]] = {
                "country": dim["country"],
                "year": year,
                "items": [{"id": row["id"], "score": row["score"]} for row in sampled],
            }
            for row in sampled:
                meta = dict(catalog[row["id"]])
                meta["basis"] = row["basis"]
                meta["raw"] = row["raw"]
                pack["articles"][row["id"]] = meta
                sidecar[row["id"]] = catalog[row["id"]]
        dest = out_dir / "years" / f"{year}.json"
        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_text(json.dumps(pack, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
        year_summaries.append({
            "year": year,
            "articleCount": article_count,
            "itemCounts": item_counts,
            "sampled": article_count > MAX_ITEMS,
        })

    index = {
        "corpus": "tag",
        "tag": "technology/artificialintelligenceai",
        "from": years[0],
        "to": years[-1],
        "articleCount": sum(item["articleCount"] for item in year_summaries),
        "maxItems": MAX_ITEMS,
        "scorer": series_id,
        "dimensions": DIMS,
        "years": year_summaries,
        "missingScores": missing,
        "notes": {
            "valence": "Stored valence is −1..+1; the vessel score is (1 − v) / 2 so higher is more negative.",
            "sampling": "Years with more than 97 articles keep 97 evenly spaced quantiles of that dimension's score, independently.",
        },
    }
    (out_dir / "index.json").write_text(json.dumps(index, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    (out_dir / "sidecar.json").write_text(json.dumps(sidecar, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    return index


def main() -> None:
    root = Path(__file__).resolve().parents[1]
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--assets", type=Path, default=root / "dist" / "assets" / "5a679c554751590d",
                        help="Directory containing articles.json.gz and data/<dim>.json.gz")
    parser.add_argument("--out", type=Path, default=root / "data" / "vessels",
                        help="Output directory")
    parser.add_argument("--series", default=None, help="Scorer id (default: articles.json defaultSeries)")
    args = parser.parse_args()
    articles = load_json(args.assets / "articles.json.gz")
    series_id = args.series or articles["defaultSeries"]
    index = export(args.assets, args.out, series_id)
    years = index["years"]
    print(f"Wrote {len(years)} year packs ({index['from']}–{index['to']}) to {args.out}")
    print(f"Tag articles: {index['articleCount']}; missing scores: {index['missingScores']}")
    for row in years:
        flag = " (quantile 97)" if row["sampled"] else ""
        counts = ", ".join(f"{k}={v}" for k, v in row["itemCounts"].items())
        print(f"  {row['year']}: {row['articleCount']} articles{flag}; items {counts}")


if __name__ == "__main__":
    main()
