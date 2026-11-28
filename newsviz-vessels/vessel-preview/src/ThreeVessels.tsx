import {useEffect, useMemo, useState} from 'react';
import {ClayScene} from './ClayScene.tsx';
import {FORM} from './config.ts';
import {sampleToolpath} from './toolpath.ts';
import {mapAnnualVase} from './annualMapping.ts';
import type {Behavior} from './annualMapping.ts';
import {validateConfig} from './behaviourConfig.ts';
import frozenMapping from '../prototype-c-staggered-mapping-v1.json' with {type: 'json'};
import './styles.css';
import './vessels.css';

const base = import.meta.env.BASE_URL;
const YEAR_FROM = 2005;
const YEAR_TO = 2026;

const config = validateConfig({
  ...frozenMapping,
  preview: {mode: 'Data-driven', behaviour: 'sagging'},
});

const DIMS = [
  {id: 'valence', label: 'Valence', encode: 'Inverted (1 − v) / 2. Higher = more negative coverage.'},
  {id: 'alarmist', label: 'Alarmist', encode: '0–1 as scored. Higher = more alarmist framing.'},
  {id: 'angry', label: 'Angry', encode: '0–1 as scored. Higher = more angry framing.'},
] as const;

const legend: Record<Behavior, [string, string]> = {
  stable: ['Stable', '#728273'],
  gaps: ['Gaps', '#ad6745'],
  buldges: ['Bulging', '#aa8435'],
  misalignment: ['Misalignment', '#4e7795'],
  sagging: ['Sagging', '#8b6583'],
};

type YearRow = {year: number; articleCount: number; itemCounts: Record<string, number>; sampled: boolean};
type IndexFile = {from: number; to: number; articleCount: number; scorer: string; years: YearRow[]};
type ArticleMeta = {title: string; url: string; date: string; basis?: string; raw?: number};
type VesselData = {country: string; year: number; items: {id: string; score: number}[]};
type YearPack = {year: number; articleCount: number; vessels: Record<string, VesselData>; articles: Record<string, ArticleMeta>};
type Plan = ReturnType<typeof mapAnnualVase>;
type Pick = {dimension: string; layerId: number; articleId?: string};

function parseYear(value: string | null): number | null {
  if (!value) return null;
  const year = Number(value);
  if (!Number.isInteger(year) || year < YEAR_FROM || year > YEAR_TO) return null;
  return year;
}

function yearFromLocation(): number {
  const hash = window.location.hash.replace(/^#/, '');
  const hashYear = parseYear(hash.startsWith('year=') ? hash.slice(5) : hash);
  if (hashYear) return hashYear;
  const queryYear = parseYear(new URLSearchParams(window.location.search).get('year'));
  return queryYear ?? YEAR_TO;
}

function countClasses(plan: Plan): string {
  const counts: Partial<Record<Behavior, number>> = {};
  for (const band of plan.bands) {
    if (band.id === 'Solid base') continue;
    counts[band.behavior] = (counts[band.behavior] ?? 0) + 1;
  }
  return (Object.keys(legend) as Behavior[])
    .filter((key) => counts[key])
    .map((key) => `${legend[key][0]} ${counts[key]}`)
    .join(' · ');
}

function meanScore(items: {score: number}[]): string {
  const mean = items.reduce((sum, item) => sum + item.score, 0) / items.length;
  return mean.toFixed(3);
}

function VesselColumn({
  dim, pack, plan, selected, onPick,
}: {
  dim: (typeof DIMS)[number];
  pack: YearPack;
  plan: Plan;
  selected: Pick | null;
  onPick: (pick: Pick) => void;
}) {
  const sample = useMemo(() => sampleToolpath(plan.path, plan.path.durationS), [plan.path]);
  const vessel = pack.vessels[dim.id];
  const active = selected?.dimension === dim.id;
  return (
    <section className="nv-column" aria-label={`${dim.label} vessel for ${pack.year}`}>
      <header className="nv-column-head">
        <h2>{dim.label}</h2>
        <p>{dim.encode}</p>
        <p className="nv-meta">
          {vessel.items.length} of {pack.articleCount} articles
          {pack.articleCount > vessel.items.length ? ' (quantile sample)' : ''}
          {' · mean '}{meanScore(vessel.items)}
        </p>
        <p className="nv-meta">{countClasses(plan)}</p>
      </header>
      <div className="nv-scene">
        <ClayScene
          layers={plan.layers}
          path={plan.path}
          initialSample={sample}
          toolpathVisible={false}
          showNozzle={false}
          exhibit
          onLayerPick={(layerId) => {
            const band = plan.layers[layerId - 1]?.band;
            onPick({dimension: dim.id, layerId, articleId: band && band.id !== 'Solid base' ? band.id : undefined});
          }}
        />
      </div>
      <p className="nv-hint">Double-click the clay to inspect an article</p>
      {active && selected && <Inspect pack={pack} plan={plan} pick={selected} />}
    </section>
  );
}

function Inspect({pack, plan, pick}: {pack: YearPack; plan: Plan; pick: Pick}) {
  const layer = plan.layers[pick.layerId - 1];
  const article = pick.articleId ? pack.articles[pick.articleId] : undefined;
  const band = layer?.band;
  if (!layer) return null;
  if (!article) {
    return <aside className="nv-inspect" aria-live="polite"><p>Solid base · layers 1–{FORM.bottomLayers}. Not an article.</p></aside>;
  }
  return (
    <aside className="nv-inspect" aria-live="polite">
      <span className="nv-kicker">Layer {pick.layerId} · {band ? legend[band.behavior][0] : ''} · {band ? band.score.toFixed(3) : ''}</span>
      <a href={article.url} target="_blank" rel="noreferrer">{article.title}</a>
      <p>{article.date}{article.raw != null ? ` · raw ${article.raw.toFixed(3)}` : ''}</p>
    </aside>
  );
}

export default function ThreeVessels() {
  const [index, setIndex] = useState<IndexFile | null>(null);
  const [year, setYear] = useState(yearFromLocation);
  const [pack, setPack] = useState<YearPack | null>(null);
  const [plans, setPlans] = useState<Record<string, Plan> | null>(null);
  const [status, setStatus] = useState('Loading corpus…');
  const [error, setError] = useState('');
  const [selected, setSelected] = useState<Pick | null>(null);

  useEffect(() => { document.title = `Guardian AI ${year} · Grammar of Failure`; }, [year]);

  useEffect(() => {
    const hash = `#${year}`;
    if (window.location.hash !== hash) history.replaceState(null, '', hash);
  }, [year]);

  useEffect(() => {
    const onHash = () => {
      const next = yearFromLocation();
      setYear(next);
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
    const row = index?.years.find((item) => item.year === year);
    setSelected(null);
    setPlans(null);
    if (!index) return;
    if (!row) {
      setPack(null);
      setStatus(`No tag articles in ${year}.`);
      setError('');
      return;
    }
    let cancelled = false;
    setStatus('Loading year…');
    fetch(`${base}data/years/${year}.json`)
      .then((response) => {
        if (!response.ok) throw new Error(`year ${year} HTTP ${response.status}`);
        return response.json() as Promise<YearPack>;
      })
      .then((data) => {
        if (cancelled) return;
        setPack(data);
        setStatus('Shaping vessels…');
        requestAnimationFrame(() => {
          if (cancelled) return;
          const next: Record<string, Plan> = {};
          for (const dim of DIMS) next[dim.id] = mapAnnualVase(data.vessels[dim.id], config);
          setPlans(next);
          setStatus('');
          setError('');
        });
      })
      .catch((reason: Error) => {
        if (!cancelled) {
          setPack(null);
          setError(reason.message);
          setStatus('');
        }
      });
    return () => { cancelled = true; };
  }, [index, year]);

  const row = index?.years.find((item) => item.year === year);
  const yearCounts = useMemo(() => {
    const map = new Map<number, YearRow>();
    for (const item of index?.years ?? []) map.set(item.year, item);
    return map;
  }, [index]);

  return (
    <div className="memory-experience vessels">
      <header className="mx-header">
        <a href={base} className="mx-brand"><span className="mx-mark">g<span>f</span></span><span>GRAMMAR<br/>OF FAILURE</span></a>
        <nav aria-label="Main navigation">
          <a href={base} aria-current="page">Guardian vessels</a>
          <a href="/rank/newsviz/">Score explorer</a>
          <a href="/xiaojun-version/behaviour/annual/">Annual preview</a>
        </nav>
        <span className="mx-edition">GUARDIAN · TAG AI <i/></span>
      </header>
      <main>
        <section className="mx-intro">
          <div>
            <span className="nv-kicker">Material atlas / Guardian AI, tag only</span>
            <h1>Three vessels <em>/ {year}</em></h1>
            <p>
              One year of the Guardian tag <code>technology/artificialintelligenceai</code>,
              mapped onto Xiaojun’s annual clay grammar. Each dimension is its own vessel.
              Layers 1–3 are a solid base; higher scores sit nearer the rim.
            </p>
          </div>
          <div className="nv-origin">
            {index ? `${index.articleCount.toLocaleString('en-GB')} tag articles, ${YEAR_FROM}–${YEAR_TO}` : 'Loading…'}
            <br/><span>Local Qwen framing scores</span>
          </div>
        </section>

        <section className="nv-year" aria-label="Year selector">
          <label>
            <span className="nv-kicker">Year</span>
            <strong>{year}</strong>
            <input
              type="range"
              min={YEAR_FROM}
              max={YEAR_TO}
              value={year}
              onChange={(event) => setYear(Number(event.target.value))}
              list="nv-years"
            />
          </label>
          <datalist id="nv-years">
            {Array.from({length: YEAR_TO - YEAR_FROM + 1}, (_, i) => YEAR_FROM + i).map((value) => (
              <option key={value} value={value} label={String(value)} />
            ))}
          </datalist>
          <div className="nv-year-ticks" aria-hidden="true">
            {Array.from({length: YEAR_TO - YEAR_FROM + 1}, (_, i) => YEAR_FROM + i).map((value) => (
              <button
                key={value}
                type="button"
                data-empty={!yearCounts.has(value)}
                aria-pressed={value === year}
                onClick={() => setYear(value)}
                title={yearCounts.has(value) ? `${yearCounts.get(value)!.articleCount} articles` : 'No tag articles'}
              >
                {String(value).slice(2)}
              </button>
            ))}
          </div>
          <p className="nv-caption">
            {row
              ? `${row.articleCount.toLocaleString('en-GB')} tag article${row.articleCount === 1 ? '' : 's'} this year`
                + (row.sampled
                  ? `; each vessel shows ${row.itemCounts.valence} evenly spaced score-quantiles.`
                  : '; each vessel uses every article.')
              : `${year} has no articles in the tag corpus (the tag first appears in 2005, and 2006 is empty).`}
          </p>
        </section>

        {error && <p className="nv-error" role="alert">{error}</p>}
        {status && <p className="nv-status" role="status">{status}</p>}

        {pack && plans && (
          <div className="nv-grid">
            {DIMS.map((dim) => (
              <VesselColumn
                key={`${pack.year}-${dim.id}`}
                dim={dim}
                pack={pack}
                plan={plans[dim.id]}
                selected={selected}
                onPick={setSelected}
              />
            ))}
          </div>
        )}

        <footer>
          <span>GRAMMAR OF FAILURE / GUARDIAN AI</span>
          <span>Simulated deposition · scores from the published Newsviz bundle · not a machine toolpath</span>
        </footer>
      </main>
    </div>
  );
}
