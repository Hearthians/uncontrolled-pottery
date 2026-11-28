# Guardian AI vessels

A **new, static-deployable copy** of Xiaojun’s annual behaviour preview. It does not modify
`xiaojun-version/behaviour/annual` or the main uncontrolled-pottery app.

Three clay vessels sit side by side for a chosen year (2005–2026):

- **Valence** — stored −1…+1 inverted to `(1 − v) / 2` (higher = more negative)
- **Alarmist** — 0–1 as scored
- **Angry** — 0–1 as scored

Corpus is Guardian **tag only** (`technology/artificialintelligenceai`). Years with more than 97
articles keep 97 evenly spaced score-quantiles, independently per dimension. Mapping uses the
frozen Prototype C staggered configuration in `prototype-c-staggered-mapping-v1.json`, forced to
data-driven mode.

## Data

Year packs are generated from the published Newsviz bundle:

```
python3 ../scripts/export_vessels.py
rsync -a --delete ../data/vessels/ public/data/
```

## Build and deploy

```
npm ci
npm run build          # base defaults to /rank/newsviz-vessels/
```

Deploy the `dist/` directory into the existing gfyh.fun `/rank/` static alias, for example
`/home/lizd/work/web/projects/work/web_forfun/rank/newsviz-vessels/`. Do not reload nginx or
overwrite `/pottery/`, `/xiaojun-version/`, or `/rank/newsviz/`.


## Monthly rib variant

A second entry (`monthly.html`, `src/MonthlyVessels.tsx`) maps the same corpus onto 12 month ribs and 120 layers. It does not replace the annual preview.

```
python3 ../scripts/export_vessels_monthly.py
npm run build:monthly          # base /rank/newsviz-vessels-monthly/
```

See `DATA_INTERFACE_MONTHLY.md` and `../reports/monthly-granularity.md`.


## Stacked-month variant

Months run **up** the vessel (January above the solid base, December at the rim). Each month is a 10-layer horizontal band around the full circumference — not 12 vertical ribs.

```
npm run build:stacked          # base /rank/newsviz-vessels-stacked/
```

See `DATA_INTERFACE_STACKED.md`. It reads the same `data/vessels-monthly/` year packs.

## Fluted variant

The [fluted preview](https://gfyh.fun/rank/newsviz-vessels-fluted/) uses the existing
`data/vessels-monthly/` packs for the tag-only 2005–2026 corpus. Each of the twelve
helical flutes represents a month, with the first day near the solid base and
the last at the ruffled rim. The mean score for a day sets its band using the
frozen Prototype C data-driven bins. The Gaps bin recesses and thins the clay
while keeping the wall closed. The other failure bins swell, shift, or droop
the wall. Empty months keep a regular flute. Days after the observed cutoff
have a shallower profile, including all of December 2026.

Double-click a flute to inspect its date band and linked articles. The month
buttons also expose counts and coverage status.

```sh
npm run build:fluted
npm test
```

The build copies the existing packs into `public-fluted/data/` and outputs a
separate `dist-fluted/` directory. Its default base URL is
`/rank/newsviz-vessels-fluted/`.

## Scrolling fluted gallery

The [scrolling gallery](https://gfyh.fun/rank/newsviz-vessels-scroll/) shows the
same three fluted forms for every year, oldest first. The centered year is
shown at full size, with smaller, dimmer previews of its neighbours. The
gallery fetches the focused year and immediate neighbours on demand and
keeps their parsed data for return visits. One shared WebGL renderer draws
fixed views into 2D canvases and releases each mesh after drawing. Canvases
are removed beyond the focused year and its neighbours.

```sh
npm run build:scroll
```

The build uses `public-scroll/data/` and outputs `dist-scroll/` with the base
`/rank/newsviz-vessels-scroll/`.
