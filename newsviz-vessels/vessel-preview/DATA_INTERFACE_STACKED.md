# Stacked-month mapping

This preview reads the same year packs as the monthly-rib interface (`DATA_INTERFACE_MONTHLY.md`). It does **not** split the circumference into ribs. Time runs **up the vessel**.

## Form

- Solid base: layers **1–3** (stable), required by Xiaojun’s grammar. Not a month.
- Each **observed** month occupies **exactly 10** wall layers, around the full circumference.
- A complete year is therefore **3 + 12 × 10 = 123** layers (January = 4–13, February = 14–23, …, December = 114–123).
- If a month starts after `observedThrough` it is omitted and the vessel is **capped** there. In the current corpus that applies only to **December 2026** (observed through 2026-11-27), so 2026 is 3 + 11 × 10 = **113** layers and ends at November.
- Empty but already-observed months (for example May 2014) are still printed: a stable 10-layer band, marked in the UI.

Layer height is 1 mm, so a full-year vessel is 123 mm tall and a 2026 vessel is 113 mm tall.

## Scores inside a month band

Articles in the month keep their 0–1 vessel scores (valence already inverted upstream). They are sorted by increasing score and spread across the 10 layers exactly as the annual grammar spreads items across a wall: for *k* items, item *i* occupies layers `first + floor(10×i/k)` through `first + floor(10×(i+1)/k) − 1`. If *k* > 10, 10 evenly spaced score-quantiles are kept (min and max included). A month with one article uses that score for all 10 layers. An empty month uses score 0 (stable) on all 10 layers.

Xiaojun’s five bins are unchanged: Stable [0, .20), Gaps [.20, .40), Bulging [.40, .60), Misalignment [.60, .80), Sagging [.80, 1]. The UI also reports the month **mean** and its bin, so the typical level of the month is visible even when the ten layers show intra-month spread.

There is no annual-column mode on this page; the annual and rib previews remain at `/rank/newsviz-vessels/` and `/rank/newsviz-vessels-monthly/`.
