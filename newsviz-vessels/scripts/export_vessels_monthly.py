#!/usr/bin/env python3
"""Export Tag-only Guardian scores as a 12-rib monthly DATA_INTERFACE extension.

Each year pack holds three vessels. Each vessel has 12 month ribs; a rib lists
that month's articles in date order with scores in [0, 1]. Empty months are
kept explicitly. Unlike the annual export, articles are not quantile-sampled
here — the preview maps day-of-month onto 117 wall layers (date mode) or
quantile-samples a busy month in score mode.
"""

from __future__ import annotations

import argparse
import calendar
import json
from collections import defaultdict
from datetime import date, timedelta
from pathlib import Path

import export_vessels as ev

DIMS = ev.DIMS
LAYER_COUNT = 120
BOTTOM_LAYERS = 3


def export_monthly(asset_dir: Path, out_dir: Path, series_id: str) -> dict:
    articles = ev.load_json(asset_dir / "articles.json.gz")
    rows = articles["articles"]
    scores = {
        dim["id"]: ev.score_map(ev.load_json(asset_dir / "data" / f"{dim['id']}.json.gz"), series_id)
        for dim in DIMS
    }

    catalog: dict[str, dict] = {}
    # year -> month -> list of {id, date, scores}
    buckets: dict[int, dict[int, list[dict]]] = defaultdict(lambda: defaultdict(list))
    last_date = ev.EPOCH

    for index, row in enumerate(rows):
        day, title, _standfirst, url, *_ = row
        published = ev.EPOCH + timedelta(days=int(day))
        year, month = published.year, published.month
        if year < 2005 or year > 2026:
            continue
        ident = ev.article_id(url, index)
        catalog[ident] = {"title": title, "url": url, "date": published.isoformat()}
        item_scores = {}
        for dim in DIMS:
            raw, basis = scores[dim["id"]][index]
            item_scores[dim["id"]] = {
                "score": ev.unit_score(dim["id"], raw),
                "raw": raw / 10_000.0,
                "basis": ev.BASIS.get(basis, str(basis)),
            }
        buckets[year][month].append({
            "id": ident,
            "date": published.isoformat(),
            "scores": item_scores,
        })
        if published > last_date:
            last_date = published

    years = list(range(2005, 2027))
    out_dir.mkdir(parents=True, exist_ok=True)
    (out_dir / "years").mkdir(parents=True, exist_ok=True)

    year_summaries = []
    for year in years:
        months = buckets.get(year, {})
        article_count = sum(len(v) for v in months.values())
        if not article_count:
            observed = None
        elif year == last_date.year:
            observed = last_date.isoformat()
        else:
            observed = date(year, 12, 31).isoformat()
        pack = {
            "year": year,
            "articleCount": article_count,
            "layerCount": LAYER_COUNT,
            "bottomLayers": BOTTOM_LAYERS,
            "observedThrough": observed,
            "vessels": {},
            "articles": {},
        }

        month_counts = {}
        for dim in DIMS:
            ribs = []
            for month in range(1, 13):
                items = sorted(months.get(month, []), key=lambda r: (r["date"], r["id"]))
                month_counts[month] = len(items)
                rib_items = [{
                    "id": item["id"],
                    "score": item["scores"][dim["id"]]["score"],
                    "date": item["date"],
                } for item in items]
                ribs.append({
                    "month": month,
                    "label": calendar.month_abbr[month],
                    "articleCount": len(items),
                    "empty": len(items) == 0,
                    "sparse": 0 < len(items) < 5,
                    "items": rib_items,
                })
                for item in items:
                    meta = dict(catalog[item["id"]])
                    meta["basis"] = item["scores"][dim["id"]]["basis"]
                    meta["raw"] = item["scores"][dim["id"]]["raw"]
                    pack["articles"].setdefault(item["id"], meta)
            pack["vessels"][dim["id"]] = {
                "country": dim["country"],
                "year": year,
                "layerCount": LAYER_COUNT,
                "bottomLayers": BOTTOM_LAYERS,
                "ribs": ribs,
            }
        dest = out_dir / "years" / f"{year}.json"
        dest.write_text(json.dumps(pack, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
        year_summaries.append({
            "year": year,
            "articleCount": article_count,
            "monthCounts": [month_counts[m] for m in range(1, 13)],
            "emptyMonths": [calendar.month_abbr[m] for m in range(1, 13) if month_counts[m] == 0],
            "sparseMonths": [calendar.month_abbr[m] for m in range(1, 13) if 0 < month_counts[m] < 5],
            "maxMonthCount": max(month_counts.values()) if article_count else 0,
        })
        print(f"  {year}: {article_count} articles; empty={year_summaries[-1]['emptyMonths'] or '-'}; "
              f"sparse={year_summaries[-1]['sparseMonths'] or '-'}; busiest month n={year_summaries[-1]['maxMonthCount']}")

    index = {
        "corpus": "tag",
        "tag": "technology/artificialintelligenceai",
        "from": 2005,
        "to": 2026,
        "articleCount": sum(y["articleCount"] for y in year_summaries),
        "layerCount": LAYER_COUNT,
        "bottomLayers": BOTTOM_LAYERS,
        "observedThrough": last_date.isoformat(),
        "scorer": series_id,
        "dimensions": DIMS,
        "years": year_summaries,
        "notes": {
            "ribs": "Twelve circumferential ribs, January to December.",
            "layers": "120 layers including a 3-layer solid base (117 wall layers).",
            "dateMode": "Height is day-of-month; several stories on one day share a short band (mean score). Empty days stay stable. Days after observedThrough are unobserved.",
            "scoreMode": "Each rib maps that month's scores up the wall like the annual grammar (quantile-sample if n > 117).",
            "annualMode": "Ignores ribs; quantile-samples the whole year onto 117 wall layers, sorted by score.",
            "valence": "Stored valence is −1..+1; the vessel score is (1 − v) / 2 so higher is more negative.",
        },
    }
    (out_dir / "index.json").write_text(json.dumps(index, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return index


def main() -> None:
    root = Path(__file__).resolve().parents[1]
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--assets", type=Path, default=root / "dist" / "assets" / "5a679c554751590d")
    parser.add_argument("--out", type=Path, default=root / "data" / "vessels-monthly")
    parser.add_argument("--series", default=None)
    args = parser.parse_args()
    articles = ev.load_json(args.assets / "articles.json.gz")
    series_id = args.series or articles["defaultSeries"]
    index = export_monthly(args.assets, args.out, series_id)
    print(f"Wrote {len(index['years'])} year packs to {args.out} (observed through {index['observedThrough']})")


if __name__ == "__main__":
    main()
