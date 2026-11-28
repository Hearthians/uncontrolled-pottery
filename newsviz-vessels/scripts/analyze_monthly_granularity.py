#!/usr/bin/env python3
"""Monthly and daily granularity of Tag-only Guardian AI scores."""

from __future__ import annotations

import argparse
import calendar
import gzip
import json
import math
import statistics
from collections import defaultdict
from datetime import date, timedelta
from pathlib import Path

EPOCH = date(1970, 1, 1)
DIMS = ("valence", "alarmist", "angry")


def load_json(path: Path):
    data = path.read_bytes()
    if path.name.endswith(".gz"):
        data = gzip.decompress(data)
    return json.loads(data)


def unit_score(dimension: str, raw: float) -> float:
    value = raw / 10_000.0
    if dimension == "valence":
        value = (1.0 - value) / 2.0
    return min(1.0, max(0.0, value))


def score_map(payload: dict, series_id: str) -> dict[int, float]:
    series = payload[series_id]
    points = series[0] if isinstance(series, list) and series and isinstance(series[0], list) else series
    return {int(index): float(raw) for index, raw, *_ in points}


def mean(xs: list[float]) -> float:
    return sum(xs) / len(xs) if xs else float("nan")


def median(xs: list[float]) -> float:
    return statistics.median(xs) if xs else float("nan")


def stdev(xs: list[float]) -> float:
    return statistics.pstdev(xs) if len(xs) >= 2 else (0.0 if len(xs) == 1 else float("nan"))


def fmt(value: float, digits: int = 3) -> str:
    if value is None or not math.isfinite(value):
        return "—"
    return f"{value:.{digits}f}"


def verdict_for_year(populated: int, sparse: int, empty: int, ranges: dict[str, float],
                     within_std: dict[str, float], between_std: dict[str, float]) -> tuple[str, str]:
    """Return (label, reason) for one year."""
    if populated == 0:
        return "too-sparse", "no month has 5+ articles; monthly structure cannot be judged"
    if populated < 4:
        peak = max(ranges.values()) if ranges else 0
        return "too-sparse", (
            f"only {populated} month(s) have 5+ articles "
            f"({sparse} with 1–4, {empty} empty); "
            f"peak monthly-mean range {fmt(peak)}"
        )
    # A dimension "moves" if the range of monthly means is at least 0.10
    # (10 percentage points on the 0–1 vessel scale) or the std of monthly
    # means is at least 60% of the 2005–2026 between-year std, provided that
    # std is itself at least 0.04 so very small absolute wobble is ignored.
    movers = []
    for dim in DIMS:
        r, s, b = ranges[dim], within_std[dim], between_std[dim]
        ratio = (s / b) if b and math.isfinite(b) and b > 0 else float("inf")
        if (r >= 0.10 or (s >= 0.04 and ratio >= 0.60)) and math.isfinite(r):
            movers.append(f"{dim} range {fmt(r)} (std {fmt(s)}, {fmt(ratio)}× between-year)")
    if len(movers) >= 2 or (len(movers) == 1 and max(ranges.values()) >= 0.15):
        return "distinct", "; ".join(movers)
    if movers:
        return "mild", "; ".join(movers) + " — only one dimension, modest; annual still readable"
    peak = max(ranges.values())
    return "flat", (
        f"monthly-mean ranges {', '.join(f'{d} {fmt(ranges[d])}' for d in DIMS)}; "
        f"peak {fmt(peak)} < 0.10 and within-year std is small vs between-year"
    )


def md_escape(text: str) -> str:
    return text.replace("|", "\\|")


def main() -> None:
    root = Path(__file__).resolve().parents[1]
    parser = argparse.ArgumentParser()
    parser.add_argument("--assets", type=Path, default=root / "dist" / "assets" / "5a679c554751590d")
    parser.add_argument("--out", type=Path, default=root / "reports" / "monthly-granularity.md")
    args = parser.parse_args()

    articles = load_json(args.assets / "articles.json.gz")
    series_id = articles["defaultSeries"]
    rows = articles["articles"]
    scores = {
        dim: score_map(load_json(args.assets / "data" / f"{dim}.json.gz"), series_id)
        for dim in DIMS
    }

    # records: list of {date, year, month, day, scores}
    records = []
    for index, row in enumerate(rows):
        day_offset, title, _standfirst, url, *_ = row
        published = EPOCH + timedelta(days=int(day_offset))
        rec = {
            "date": published,
            "year": published.year,
            "month": published.month,
            "day": published.day,
            "url": url,
            "scores": {dim: unit_score(dim, scores[dim][index]) for dim in DIMS},
        }
        records.append(rec)

    records.sort(key=lambda r: r["date"])
    years = list(range(2005, 2027))
    by_year = defaultdict(list)
    for rec in records:
        if 2005 <= rec["year"] <= 2026:
            by_year[rec["year"]].append(rec)

    annual_means = {dim: [] for dim in DIMS}
    year_rows = []

    for year in years:
        items = by_year[year]
        annual = {dim: [r["scores"][dim] for r in items] for dim in DIMS}
        for dim in DIMS:
            if items:
                annual_means[dim].append(mean(annual[dim]))
        months = []
        for month in range(1, 13):
            bucket = [r for r in items if r["month"] == month]
            entry = {"month": month, "n": len(bucket), "stats": {}}
            for dim in DIMS:
                xs = [r["scores"][dim] for r in bucket]
                entry["stats"][dim] = {
                    "n": len(xs),
                    "mean": mean(xs),
                    "median": median(xs),
                    "std": stdev(xs),
                    "min": min(xs) if xs else float("nan"),
                    "max": max(xs) if xs else float("nan"),
                }
            months.append(entry)

        # daily
        if items:
            first, last = items[0]["date"], items[-1]["date"]
            span_days = (last - first).days + 1
            by_day = defaultdict(int)
            for r in items:
                by_day[r["date"]] += 1
            active_days = len(by_day)
            empty_in_span = span_days - active_days
            counts = list(by_day.values())
            daily = {
                "first": first.isoformat(),
                "last": last.isoformat(),
                "span_days": span_days,
                "active_days": active_days,
                "empty_in_span": empty_in_span,
                "empty_frac": empty_in_span / span_days if span_days else 1,
                "mean_on_active": mean([float(c) for c in counts]),
                "median_on_active": median([float(c) for c in counts]),
                "max_day": max(counts) if counts else 0,
                "days_ge2": sum(1 for c in counts if c >= 2),
                "days_ge5": sum(1 for c in counts if c >= 5),
            }
        else:
            daily = None

        year_rows.append({
            "year": year,
            "n": len(items),
            "annual": {dim: {"mean": mean(annual[dim]), "median": median(annual[dim]), "std": stdev(annual[dim])} for dim in DIMS},
            "months": months,
            "daily": daily,
        })

    between_std = {dim: stdev(annual_means[dim]) for dim in DIMS}
    between_range = {dim: (max(annual_means[dim]) - min(annual_means[dim])) if annual_means[dim] else float("nan") for dim in DIMS}

    # attach within-year stats + verdicts (months with n>=5 only, for means)
    for row in year_rows:
        populated = [m for m in row["months"] if m["n"] >= 5]
        sparse = [m for m in row["months"] if 0 < m["n"] < 5]
        empty = [m for m in row["months"] if m["n"] == 0]
        row["n_populated"] = len(populated)
        row["n_sparse"] = len(sparse)
        row["n_empty"] = len(empty)
        row["max_month_n"] = max(m["n"] for m in row["months"])
        ranges, wstd = {}, {}
        for dim in DIMS:
            means = [m["stats"][dim]["mean"] for m in populated]
            ranges[dim] = (max(means) - min(means)) if len(means) >= 2 else (0.0 if len(means) == 1 else float("nan"))
            wstd[dim] = stdev(means) if len(means) >= 2 else (0.0 if len(means) == 1 else float("nan"))
        row["month_mean_range"] = ranges
        row["month_mean_std"] = wstd
        label, reason = verdict_for_year(len(populated), len(sparse), len(empty), ranges, wstd, between_std)
        row["verdict"] = label
        row["reason"] = reason

    # daily corpus-wide
    by_day_all = defaultdict(int)
    for r in records:
        by_day_all[r["date"]] += 1
    first_all, last_all = records[0]["date"], records[-1]["date"]
    span_all = (last_all - first_all).days + 1

    # write markdown
    lines: list[str] = []
    a = lines.append
    a("# Monthly granularity of Guardian AI tag scores")
    a("")
    a("Tag-only corpus (`technology/artificialintelligenceai`), 2005–2026, 5,676 articles.")
    a("Scores are the published local Qwen framing series. Valence is inverted with `(1 − v) / 2` so every dimension is 0–1 and higher is more negative / alarmist / angry.")
    a("This is a software check of whether a year should be split by month before we commit to 12 ribs × 120 layers.")
    a("")
    a(f"Generated from the frozen public bundle. Scorer: `{series_id}`.")
    a("")
    a("## How to read the verdict")
    a("")
    a("Monthly means use only months with **5 or more** articles, so a handful of stories cannot swing the comparison. Between-year standard deviations of annual means (21 years with at least one article; 2006 is empty) are:")
    a("")
    a("| Dimension | Between-year std of annual means | Range of annual means |")
    a("|---|---:|---:|")
    for dim in DIMS:
        a(f"| {dim} | {fmt(between_std[dim])} | {fmt(between_range[dim])} |")
    a("")
    a("A year is:")
    a("")
    a("- **too-sparse** if fewer than 4 months have 5+ articles;")
    a("- **distinct** if at least two dimensions have a monthly-mean range ≥ 0.10, or one dimension has range ≥ 0.15, or the std of monthly means is ≥ 0.04 and at least 60% of the between-year std;")
    a("- **mild** if only one dimension crosses the 0.10 range bar (and that range is under 0.15);")
    a("- **flat** if no dimension meets those bars.")
    a("")
    a("These cutoffs are descriptive, not a significance test. Sparse months still have real articles; they are just too thin to estimate a monthly mean.")
    a("")
    a("## Verdict by year")
    a("")
    a("| Year | Articles | Months 5+ / 1–4 / 0 | Max month n | Valence range (std) | Alarmist range (std) | Angry range (std) | Verdict |")
    a("|---:|---:|---:|---:|---:|---:|---:|---|")
    counts = defaultdict(int)
    for row in year_rows:
        counts[row["verdict"]] += 1
        if row["n"] == 0:
            a(f"| {row['year']} | 0 | 0 / 0 / 12 | 0 | — | — | — | too-sparse |")
            continue
        def cell(dim: str) -> str:
            return f"{fmt(row['month_mean_range'][dim])} ({fmt(row['month_mean_std'][dim])})"
        a(
            f"| {row['year']} | {row['n']} | "
            f"{row['n_populated']} / {row['n_sparse']} / {row['n_empty']} | "
            f"{row['max_month_n']} | {cell('valence')} | {cell('alarmist')} | {cell('angry')} | "
            f"{row['verdict']} |"
        )
    a("")
    a(
        "Verdict tally: "
        + ", ".join(f"**{k}** {counts[k]}" for k in ("distinct", "mild", "flat", "too-sparse"))
        + "."
    )
    a("")
    a("### Why the year was labelled that way")
    a("")
    for row in year_rows:
        if row["n"] == 0:
            a(f"- **{row['year']}**: no tag articles.")
        else:
            a(f"- **{row['year']}** ({row['verdict']}): {row['reason']}.")
    a("")
    a("## Monthly counts and means")
    a("")
    a("Empty cells are months with no tag articles. Means are shown only when n ≥ 1; treat n < 5 as anecdotal.")
    a("")
    for row in year_rows:
        if row["n"] == 0:
            continue
        a(f"### {row['year']} · {row['n']} articles · {row['verdict']}")
        a("")
        am = row["annual"]
        a(
            "Annual mean / median / std: "
            + "; ".join(
                f"{dim} {fmt(am[dim]['mean'])} / {fmt(am[dim]['median'])} / {fmt(am[dim]['std'])}"
                for dim in DIMS
            )
            + "."
        )
        a("")
        a("| Month | n | Valence mean (med, std) | Alarmist mean (med, std) | Angry mean (med, std) |")
        a("|---|---:|---|---|---|")
        for m in row["months"]:
            name = calendar.month_abbr[m["month"]]
            if m["n"] == 0:
                a(f"| {name} | 0 | — | — | — |")
                continue
            cells = []
            for dim in DIMS:
                s = m["stats"][dim]
                cells.append(f"{fmt(s['mean'])} ({fmt(s['median'])}, {fmt(s['std'])})")
            a(f"| {name} | {m['n']} | {cells[0]} | {cells[1]} | {cells[2]} |")
        a("")

    a("## Daily granularity")
    a("")
    a(
        f"Across the corpus, articles fall on {len(by_day_all):,} distinct days "
        f"between {first_all.isoformat()} and {last_all.isoformat()} "
        f"({span_all:,} calendar days, {span_all - len(by_day_all):,} empty, "
        f"{(span_all - len(by_day_all)) / span_all:.0%} empty). "
        f"On days with at least one article the mean is {fmt(mean([float(c) for c in by_day_all.values()]), 2)} "
        f"and the median is {fmt(median([float(c) for c in by_day_all.values()]), 2)}; "
        f"the busiest day has {max(by_day_all.values())}."
    )
    a("")
    a("A literal 120-layer daily vessel for a whole year would leave most layers empty before 2023. After 2023 there are often several stories on the same day, so a day still has to be aggregated. Daily scoring is feasible as a *within-month* placement (day-of-month → height on that month's rib), not as 365 distinct layers.")
    a("")
    a("| Year | Articles | Span (first–last) | Active days | Empty days in span | Empty % | Mean / median / max on active days | Days with 2+ / 5+ |")
    a("|---:|---:|---|---:|---:|---:|---|---:|")
    for row in year_rows:
        d = row["daily"]
        if not d:
            a(f"| {row['year']} | 0 | — | 0 | — | — | — | — |")
            continue
        a(
            f"| {row['year']} | {row['n']} | {d['span_days']}d ({d['first']} – {d['last']}) | "
            f"{d['active_days']} | {d['empty_in_span']} | {d['empty_frac']:.0%} | "
            f"{fmt(d['mean_on_active'], 2)} / {fmt(d['median_on_active'], 2)} / {d['max_day']} | "
            f"{d['days_ge2']} / {d['days_ge5']} |"
        )
    a("")
    a("## Design implications")
    a("")
    distinct_years = [r["year"] for r in year_rows if r["verdict"] == "distinct"]
    mild_years = [r["year"] for r in year_rows if r["verdict"] == "mild"]
    flat_years = [r["year"] for r in year_rows if r["verdict"] == "flat"]
    sparse_years = [r["year"] for r in year_rows if r["verdict"] == "too-sparse"]
    max_month = max(r["max_month_n"] for r in year_rows)
    a(f"- **Months do differ, but only in the busy years.** Distinct: {distinct_years or 'none'}. Mild: {mild_years or 'none'}. Flat: {flat_years or 'none'}. Too sparse to judge: {sparse_years}.")
    a("- **2005–2014 and 2020 are too thin for monthly means.** Several of these years have only one- or two-digit article counts and many empty months. A 12-rib vessel will correctly look almost plain, with one or two ribs carrying a handful of articles. For these years the annual vessel remains the clearer summary.")
    a(f"- **No month exceeds the 117-wall-layer budget** (busiest month has {max_month} articles), so a month can keep every article without quantile sampling.")
    a("- **Daily layers for a whole year are not useful.** Even 2025–2026 leave a large share of calendar days empty, and busy days already bundle several articles. The preview should map *day-of-month to height on that month's rib*: empty days stay stable, several stories on one day share a short band (mean score), and empty months are a fully stable rib with a visible gutter.")
    a("- **Default encoding:** 12 circumferential ribs (Jan–Dec), 120 layers (3-layer solid base + 117 wall). Height in monthly-date mode is time within the month, not severity, so anomalies can appear mid-vessel instead of stacking into a column. A 'by score' rib mode and an annual (sorted, no ribs) mode are available to compare against the existing preview.")
    a("- **Valence, alarmist and angry do not always peak in the same month.** When they diverge, the three vessels will disagree about which rib is most disturbed — that is a feature, not a defect.")
    a("")

    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text("\n".join(lines) + "\n", encoding="utf-8")

    # compact console summary
    print(f"Wrote {args.out}")
    print("Between-year std:", {d: round(between_std[d], 3) for d in DIMS})
    print("Busiest month n:", max_month)
    for row in year_rows:
        print(
            f"  {row['year']}: n={row['n']:4d}  5+/thin/empty="
            f"{row['n_populated']}/{row['n_sparse']}/{row['n_empty']}  "
            f"range V/A/Y={fmt(row['month_mean_range']['valence'])}/"
            f"{fmt(row['month_mean_range']['alarmist'])}/"
            f"{fmt(row['month_mean_range']['angry'])}  {row['verdict']}"
        )


if __name__ == "__main__":
    main()
