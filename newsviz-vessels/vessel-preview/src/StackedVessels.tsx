import {useEffect, useMemo, useState} from 'react';
import {ClayScene} from './ClayScene.tsx';
import {sampleToolpath} from './toolpath.ts';
import {
  frameForLayers, mapStackedVase, STACKED_BOTTOM, LAYERS_PER_MONTH,
  STACKED_FULL_LAYERS,
} from './stackedMapping.ts';
import type {MonthBand, StackedPlan} from './stackedMapping.ts';
import type {Behavior, MonthlyVessel} from './monthlyMapping.ts';
import {validateConfig} from './behaviourConfig.ts';
import frozenMapping from '../prototype-c-staggered-mapping-v1.json' with {type: 'json'};
import './styles.css';
import './vessels.css';
import './stacked.css';

const base = import.meta.env.BASE_URL;
const GALLERY_YEARS = [2019, 2020, 2021, 2022, 2023, 2024, 2025, 2026] as const;
const SHARED_FRAME = frameForLayers(STACKED_FULL_LAYERS);

const DIMS = [
  {id: 'alarmist', label: 'Alarmist', encode: '0–1 as scored. Higher = more alarmist framing.'},
  {id: 'angry', label: 'Angry', encode: '0–1 as scored. Higher = more angry framing.'},
  {id: 'valence', label: 'Valence', encode: 'Inverted (1 − v) / 2. Higher = more negative coverage.'},
] as const;
type DimId = (typeof DIMS)[number]['id'];
const DEFAULT_DIM: DimId = 'alarmist';

const config = validateConfig({
  ...frozenMapping,
  preview: {mode: 'Data-driven', behaviour: 'sagging'},
});

const legend: Record<Behavior, [string, string]> = {
  stable: ['Stable', '#728273'],
  gaps: ['Gaps', '#ad6745'],
  buldges: ['Bulging', '#aa8435'],
  misalignment: ['Misalignment', '#4e7795'],
  sagging: ['Sagging', '#8b6583'],
};

type YearRow = {year: number; articleCount: number; monthCounts: number[]; emptyMonths: string[]; sparseMonths: string[]};
type IndexFile = {from: number; to: number; articleCount: number; scorer: string; observedThrough: string; years: YearRow[]};
type ArticleMeta = {title: string; url: string; date: string; basis?: string; raw?: number};
type YearPack = {
  year: number; articleCount: number; observedThrough: string | null;
  vessels: Record<string, MonthlyVessel>;
  articles: Record<string, ArticleMeta>;
};
type Pick = {year: number; layerId: number};
type PlanCache = Partial<Record<DimId, Record<number, StackedPlan>>>;

function dimById(id: string | null | undefined): DimId {
  return DIMS.find((dim) => dim.id === id)?.id ?? DEFAULT_DIM;
}

function parseHash(): {dim: DimId; year: number | null} {
  const raw = window.location.hash.replace(/^#/, '');
  const looksLikePairs = raw.includes('=') || raw.startsWith('year') || raw.startsWith('dim');
  const params = new URLSearchParams(
    looksLikePairs
      ? raw
      : (GALLERY_YEARS as readonly number[]).includes(Number(raw))
        ? `year=${raw}`
        : DIMS.some((dim) => dim.id === raw)
          ? `dim=${raw}`
          : '',
  );
  const year = Number(params.get('year'));
  return {
    dim: dimById(params.get('dim')),
    year: (GALLERY_YEARS as readonly number[]).includes(year) ? year : null,
  };
}

function hashFor(dim: DimId, year: number | null): string {
  const params = new URLSearchParams();
  if (dim !== DEFAULT_DIM) params.set('dim', dim);
  if (year) params.set('year', String(year));
  const query = params.toString();
  return query ? `#${query}` : '';
}

function YearCard({
  dim, pack, plan, selected, onPick,
}: {
  dim: (typeof DIMS)[number];
  pack: YearPack;
  plan: StackedPlan;
  selected: Pick | null;
  onPick: (pick: Pick) => void;
}) {
  const sample = useMemo(() => sampleToolpath(plan.path, plan.path.durationS), [plan.path]);
  const focused = selected?.year === pack.year;
  const lastMonth = plan.months[plan.months.length - 1]?.label;
  const capped = plan.months.length < 12;
  return (
    <section className="nv-year-card" data-focus={focused} aria-label={`${dim.label} vessel for ${pack.year}`}>
      <header>
        <h2>{pack.year}</h2>
        <p>
          {pack.articleCount.toLocaleString('en-GB')} articles
          {capped ? ` · ends at ${lastMonth}` : ''}
          {' · '}{plan.layerCount} layers
        </p>
      </header>
      <div className="nv-scene nv-scene-gallery">
        <ClayScene
          layers={plan.layers}
          path={plan.path}
          initialSample={sample}
          toolpathVisible={false}
          showNozzle={false}
          exhibit
          framing={SHARED_FRAME}
          onLayerPick={(layerId) => onPick({year: pack.year, layerId})}
        />
      </div>
    </section>
  );
}

function MonthLegend({months, selected, onChoose}: {months: MonthBand[]; selected?: MonthBand; onChoose: (month: MonthBand) => void}) {
  return (
    <ol className="nv-stack-legend" aria-label="Months from base to rim">
      {months.map((month) => (
        <li key={month.month} data-state={month.empty ? 'empty' : selected?.month === month.month ? 'active' : 'ok'}>
          <button type="button" onClick={() => onChoose(month)} style={{all: 'unset', display: 'contents', cursor: 'pointer'}}>
            <span>{month.label}</span>
            <span>
              <i style={{background: legend[month.meanBehavior][1]}} />
              {month.empty ? 'Empty · stable' : `${legend[month.meanBehavior][0]} · mean ${month.mean.toFixed(3)}`}
            </span>
            <b>{month.articleCount}</b>
          </button>
        </li>
      ))}
    </ol>
  );
}

function Inspect({pack, plan, pick}: {pack: YearPack; plan: StackedPlan; pick: Pick}) {
  if (pick.layerId <= STACKED_BOTTOM) {
    return <aside className="nv-inspect" aria-live="polite"><p>Solid base · layers 1–{STACKED_BOTTOM}. Required by the clay grammar, not a month.</p></aside>;
  }
  const band = plan.months.find(month => pick.layerId >= month.first && pick.layerId <= month.last);
  if (!band) return <aside className="nv-inspect" aria-live="polite"><p>Layer {pick.layerId}.</p></aside>;
  const layer = plan.layers[pick.layerId - 1];
  if (band.empty) {
    return <aside className="nv-inspect" aria-live="polite"><p>{band.label} {pack.year} · layers {band.first}–{band.last} · no tag articles. The band is stable clay, not a low score.</p></aside>;
  }
  const articles = band.items.map(item => ({...item, meta: pack.articles[item.id]})).filter(item => item.meta);
  return (
    <aside className="nv-inspect" aria-live="polite">
      <span className="nv-kicker">
        {band.label} {pack.year} · layers {band.first}–{band.last}
        {' · mean '}{band.mean.toFixed(3)} ({legend[band.meanBehavior][0]})
        {' · spread '}{band.min.toFixed(3)}–{band.max.toFixed(3)}
        {layer?.band ? ` · this layer ${layer.band.score.toFixed(3)} (${legend[layer.band.behavior as Behavior]?.[0] ?? layer.band.behavior})` : ''}
      </span>
      <div style={{maxHeight: 220, overflow: 'auto', marginTop: 8}}>
        {articles.map(item => (
          <p key={item.id}>
            <a href={item.meta.url} target="_blank" rel="noreferrer">{item.meta.title}</a>
            <span> {item.date} · {item.score.toFixed(3)}</span>
          </p>
        ))}
      </div>
    </aside>
  );
}

export default function StackedVessels() {
  const initial = parseHash();
  const [index, setIndex] = useState<IndexFile | null>(null);
  const [packs, setPacks] = useState<Record<number, YearPack> | null>(null);
  const [cache, setCache] = useState<PlanCache>({});
  const [dim, setDim] = useState<DimId>(initial.dim);
  const [status, setStatus] = useState('Loading corpus…');
  const [error, setError] = useState('');
  const [selected, setSelected] = useState<Pick | null>(
    initial.year ? {year: initial.year, layerId: STACKED_BOTTOM + 5} : null,
  );

  const active = DIMS.find((item) => item.id === dim) ?? DIMS[0];
  const plans = cache[dim] ?? null;

  useEffect(() => {
    document.title = `${active.label} · 2019–2026 · stacked months`;
  }, [active]);

  useEffect(() => {
    const next = hashFor(dim, selected?.year ?? null);
    const current = window.location.hash === '#' ? '' : window.location.hash;
    if (current !== next) {
      const url = `${window.location.pathname}${window.location.search}${next}`;
      history.replaceState(null, '', url);
    }
  }, [dim, selected]);

  useEffect(() => {
    const onHash = () => {
      const parsed = parseHash();
      setDim(parsed.dim);
      setSelected((current) => {
        if (!parsed.year) return current;
        return current?.year === parsed.year ? current : {year: parsed.year, layerId: STACKED_BOTTOM + 5};
      });
    };
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  useEffect(() => {
    let cancelled = false;
    fetch(`${base}data/index.json`)
      .then((response) => {
        if (!response.ok) throw new Error(`index.json HTTP ${response.status}`);
        return response.json() as Promise<IndexFile>;
      })
      .then((data) => { if (!cancelled) setIndex(data); })
      .catch((reason: Error) => { if (!cancelled) setError(reason.message); });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!index) return;
    let cancelled = false;
    setStatus('Loading 2019–2026…');
    Promise.all(GALLERY_YEARS.map((year) =>
      fetch(`${base}data/years/${year}.json`).then((response) => {
        if (!response.ok) throw new Error(`year ${year} HTTP ${response.status}`);
        return response.json() as Promise<YearPack>;
      }),
    )).then((loaded) => {
      if (cancelled) return;
      const nextPacks = Object.fromEntries(loaded.map((pack) => [pack.year, pack])) as Record<number, YearPack>;
      setPacks(nextPacks);
      setStatus('');
    }).catch((reason: Error) => {
      if (!cancelled) {
        setPacks(null);
        setError(reason.message);
        setStatus('');
      }
    });
    return () => { cancelled = true; };
  }, [index]);

  useEffect(() => {
    if (!packs || cache[dim]) return;
    let cancelled = false;
    setStatus(`Shaping eight ${active.label.toLowerCase()} vessels…`);
    window.setTimeout(() => {
      if (cancelled) return;
      try {
        const next: Record<number, StackedPlan> = {};
        for (const year of GALLERY_YEARS) {
          const pack = packs[year];
          const vase = pack.vessels[dim];
          if (!vase) throw new Error(`No ${dim} vessel for ${year}`);
          next[year] = mapStackedVase(vase, pack.observedThrough, config);
        }
        setCache((current) => ({...current, [dim]: next}));
        setStatus('');
        setError('');
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : 'Mapping failed.');
        setStatus('');
      }
    }, 0);
    return () => { cancelled = true; };
  }, [packs, dim, cache, active]);

  const selectedPack = selected && packs ? packs[selected.year] : null;
  const selectedPlan = selected && plans ? plans[selected.year] : null;
  const selectedBand = selected && selectedPlan
    ? selectedPlan.months.find(month => selected.layerId >= month.first && selected.layerId <= month.last)
    : undefined;

  return (
    <div className="memory-experience vessels stacked" data-dim={dim}>
      <header className="mx-header">
        <a href={base} className="mx-brand"><span className="mx-mark">g<span>f</span></span><span>GRAMMAR<br/>OF FAILURE</span></a>
        <nav aria-label="Main navigation">
          <a href="/rank/newsviz-vessels/">Annual vessels</a>
          <a href="/rank/newsviz-vessels-monthly/">Monthly ribs</a>
          <a href={base} aria-current="page">Stacked months</a>
          <a href="/rank/newsviz/">Score explorer</a>
        </nav>
        <span className="mx-edition">GUARDIAN · {active.label.toUpperCase()} · 2019–2026 <i/></span>
      </header>
      <main>
        <section className="mx-intro">
          <div>
            <span className="nv-kicker">Material atlas / time up the vessel</span>
            <h1>{active.label} <em>/ 2019–2026</em></h1>
            <div className="nv-dim" role="radiogroup" aria-label="Score dimension">
              {DIMS.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  role="radio"
                  aria-checked={item.id === dim}
                  aria-pressed={item.id === dim}
                  data-dim={item.id}
                  onClick={() => setDim(item.id)}
                >
                  {item.label}
                  {item.id === 'valence' ? <small>inverted (1−v)/2</small> : null}
                </button>
              ))}
            </div>
            <p className="nv-dim-encode">{active.encode}</p>
            <p>
              Eight years, one {active.label.toLowerCase()} vessel each, drawn at the same scale.
              January sits just above a three-layer solid base; each month is a ten-layer band
              around the full circumference, with that month’s scores spread through the band.
              A complete year is 123 layers. 2026 is capped at November (113 layers), so it
              stands shorter in the same frame. Double-click a band to inspect that month.
            </p>
          </div>
          <div className="nv-origin">
            {index ? `${index.articleCount.toLocaleString('en-GB')} tag articles in the full corpus` : 'Loading…'}
            <br/><span>{STACKED_BOTTOM} base + {LAYERS_PER_MONTH} layers / month · shared 123-layer scale</span>
          </div>
        </section>

        {error && <p className="nv-error" role="alert">{error}</p>}
        {status && <p className="nv-status" role="status">{status}</p>}

        {packs && plans && (
          <div className="nv-gallery">
            {GALLERY_YEARS.map((year) => (
              <YearCard
                key={`${dim}-${year}`}
                dim={active}
                pack={packs[year]}
                plan={plans[year]}
                selected={selected}
                onPick={setSelected}
              />
            ))}
          </div>
        )}

        {selectedPack && selectedPlan && selected && (
          <section className="nv-focus" aria-label={`Inspect ${selected.year}`}>
            <h2>{selected.year}</h2>
            <p className="nv-caption">
              {active.label}
              {' · '}{selectedPack.articleCount.toLocaleString('en-GB')} tag articles
              {' · '}{selectedPlan.layerCount} layers
              {selectedPlan.months.length < 12
                ? ` · vessel ends at ${selectedPlan.months[selectedPlan.months.length - 1]?.label}`
                : ''}
              . Months run from the base to the rim.
            </p>
            <div className="nv-focus-body">
              <MonthLegend
                months={selectedPlan.months}
                selected={selectedBand}
                onChoose={(month) => setSelected({year: selected.year, layerId: Math.floor((month.first + month.last) / 2)})}
              />
              <Inspect pack={selectedPack} plan={selectedPlan} pick={selected} />
            </div>
          </section>
        )}

        <footer>
          <span>GRAMMAR OF FAILURE / GUARDIAN AI / {active.label.toUpperCase()} 2019–2026</span>
          <span>Time runs from the base to the rim · not a machine toolpath</span>
        </footer>
      </main>
    </div>
  );
}
