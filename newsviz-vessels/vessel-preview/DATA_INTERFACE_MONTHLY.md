# Monthly rib extension

This extends Xiaojun’s [annual country-year interface](DATA_INTERFACE.md). The annual preview and `readDataset` are unchanged. The monthly preview at `/rank/newsviz-vessels-monthly/` reads one JSON object per **year** (three vessels in one pack) and maps it onto a 120-layer vessel whose circumference is divided into 12 month ribs.

## Year pack

| Field | Type and validation |
|---|---|
| year | JavaScript safe integer, 2005–2026 |
| articleCount | Non-negative integer (tag articles in this year) |
| layerCount | `120` |
| bottomLayers | `3` (layers 1–3 are a solid stable base) |
| observedThrough | ISO date or `null`. Days after this date are **unobserved** (no clay on that rib), not “calm”. |
| vessels | Object with keys `valence`, `alarmist`, `angry` |
| articles | Sidecar map of item id → `{title, url, date, raw?, basis?}` for inspect |

## Vessel (`vessels[dimension]`)

| Field | Type and validation |
|---|---|
| country | Nonempty string, e.g. `Guardian · valence` |
| year | Same year as the pack |
| layerCount, bottomLayers | Repeat the pack values (`120`, `3`) |
| ribs | Array of **exactly 12** ribs, January (`month: 1`) to December |

## Rib

| Field | Type and validation |
|---|---|
| month | Integer 1–12, unique in the vessel, in calendar order |
| label | Short month name (`Jan`…`Dec`) |
| articleCount | `items.length` |
| empty | `true` when the month has no tag articles |
| sparse | `true` when `0 < articleCount < 5` |
| items | Array of `{id, score, date}`. `id` unique within the vessel, `score` in [0, 1], `date` ISO `YYYY-MM-DD` in this month. Date order. May be empty. |

Polarity, scaling and missing-value rules are the same as the annual interface: higher means more negative / alarmist / angry. Valence is already inverted upstream as `(1 − v) / 2`. Extra sidecar fields are for display only.

## How the preview maps a pack (117 wall layers)

- **Monthly by date (default).** Height is time *within the month*. Day `d` of a month with `D` days occupies wall layers `4 + floor((d−1)×117/D)` through `3 + floor(d×117/D)`. Several stories on the same day share that short band; the band score is their mean. Empty days are stable clay. Empty months are a fully stable rib. Unobserved days (after `observedThrough`) are left unprinted. Twelve thin gap gutters separate the ribs, including on empty months, so the calendar is always visible.
- **Monthly by score.** Each rib is Xiaojun’s annual grammar applied to that month only: items sorted by increasing score, spread up the wall; if a month has more than 117 articles it is quantile-sampled to 117. Height is severity, not time. Empty / unobserved months as above.
- **Annual.** Ribs are ignored. All items in the year are sorted by score and mapped onto the 117 wall layers (quantile-sampled if n > 117), one behaviour per layer, no gutters. This is the annual preview’s reading, on the 120-layer form, so the two can be compared.

Failure bins, staggered placement and the frozen Prototype C mapping are unchanged. Event counts are scaled down (at most three events per rib) so they fit in 1/12 of the perimeter. The parser lives in `src/monthlyMapping.ts` (`readMonthlyDataset`, `mapMonthlyVase`).
