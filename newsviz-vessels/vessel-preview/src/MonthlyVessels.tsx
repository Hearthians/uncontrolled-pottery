import {useEffect, useMemo, useState} from 'react';
import {ClayScene} from './ClayScene.tsx';
import {sampleToolpath} from './toolpath.ts';
import {mapMonthlyVase, MONTHLY_FORM} from './monthlyMapping.ts';
import type {MappingMode, MonthlyPlan, MonthlyVessel, RibAssignment} from './monthlyMapping.ts';
import {validateConfig} from './behaviourConfig.ts';
import frozenMapping from '../prototype-c-staggered-mapping-v1.json' with {type: 'json'};
import './styles.css';
import './vessels.css';
import './monthly.css';

const base = import.meta.env.BASE_URL;
const YEAR_FROM = 2005;
const YEAR_TO = 2026;
const FRAME = {cameraY: 15.4, targetY: 6, span: 16};

const config = validateConfig({
  ...frozenMapping,
  preview: {mode: 'Data-driven', behaviour: 'sagging'},
});

const DIMS = [
  {id: 'valence', label: 'Valence', encode: 'Inverted (1 − v) / 2. Higher = more negative coverage.'},
  {id: 'alarmist', label: 'Alarmist', encode: '0–1 as scored. Higher = more alarmist framing.'},
  {id: 'angry', label: 'Angry', encode: '0–1 as scored. Higher = more angry framing.'},
] as const;

const MODES: {id: MappingMode; label: string; hint: string}[] = [
  {id: 'date', label: 'Monthly by date', hint: '12 ribs (months). Height is day-of-month. Empty days stay stable; unobserved days are left unprinted.'},
  {id: 'score', label: 'Monthly by score', hint: '12 ribs (months). Height is severity, like the annual grammar applied to each month.'},
  {id: 'annual', label: 'Annual', hint: 'No ribs. The whole year is sorted by score and stacked from the base to the rim.'},
];

type YearRow = {year: number; articleCount: number; monthCounts: number[]; emptyMonths: string[]; sparseMonths: string[]; maxMonthCount: number; verdict?: string};
type IndexFile = {from: number; to: number; articleCount: number; scorer: string; observedThrough: string; years: YearRow[]};
type ArticleMeta = {title: string; url: string; date: string; basis?: string; raw?: number};
type YearPack = {
  year: number; articleCount: number; layerCount: number; bottomLayers: number;
  observedThrough: string | null;
  vessels: Record<string, MonthlyVessel>;
  articles: Record<string, ArticleMeta>;
};
type Pick = {dimension: string; layerId: number; sourceType?: string; eventId?: number | null};

function parseYear(value: string | null): number | null {
  if (!value) return null;
  const year = Number(value);
  if (!Number.isInteger(year) || year < YEAR_FROM || year > YEAR_TO) return null;
  return year;
}

function yearFromLocation(): number {
  const hash = window.location.hash.replace(/^#/, '');
  const params = new URLSearchParams(hash.startsWith('year=') || hash.includes('=') ? hash : `year=${hash}`);
  return parseYear(params.get('year')) ?? YEAR_TO;
}

function modeFromLocation(): MappingMode {
  const hash = window.location.hash.replace(/^#/, '');
  const params = new URLSearchParams(hash.includes('=') ? hash : '');
  const mode = params.get('mode');
  return mode === 'score' || mode === 'annual' || mode === 'date' ? mode : 'date';
}

function writeLocation(year: number, mode: MappingMode) {
  const next = `#year=${year}&mode=${mode}`;
  if (window.location.hash !== next) history.replaceState(null, '', next);
}

function parsePick(eventId?: number | null) {
  if (eventId == null) return {kind: 'stable' as const};
  if (eventId >= 9000) return {kind: 'gutter' as const, month: eventId - 9000};
  if (eventId >= 8000) return {kind: 'unobserved' as const, month: eventId - 8000};
  if (eventId >= 100) return {kind: 'grammar' as const, month: Math.floor(eventId / 100), site: eventId % 100};
  return {kind: 'annual' as const, site: eventId};
}

function VesselColumn({
  dim, pack, plan, selected, onPick,
}: {
  dim: (typeof DIMS)[number];
  pack: YearPack;
  plan: MonthlyPlan;
  selected: Pick | null;
  onPick: (pick: Pick) => void;
}) {
  const sample = useMemo(() => sampleToolpath(plan.path, plan.path.durationS), [plan.path]);
  const vessel = pack.vessels[dim.id];
  const active = selected?.dimension === dim.id;
  const populated = vessel.ribs.filter(rib => !rib.empty).length;
  return (
    <section className="nv-column" aria-label={`${dim.label} vessel for ${pack.year}`}>
      <header className="nv-column-head">
        <h2>{dim.label}</h2>
        <p>{dim.encode}</p>
        <p className="nv-meta">
          {vessel.ribs.reduce((sum, rib) => sum + rib.articleCount, 0)} tag articles
          {' · '}{populated} of 12 months occupied
        </p>
      </header>
      <div className="nv-scene nv-scene-tall">
        <ClayScene
          layers={plan.layers}
          path={plan.path}
          initialSample={sample}
          toolpathVisible={false}
          showNozzle={false}
          exhibit
          framing={FRAME}
          onLayerPick={(layerId, extra) => onPick({dimension: dim.id, layerId, sourceType: extra?.sourceType, eventId: extra?.eventId})}
        />
      </div>
      <p className="nv-hint">Double-click a rib to inspect that day’s articles</p>
      {active && selected && <Inspect pack={pack} plan={plan} pick={selected} />}
    </section>
  );
}

function assignmentFromPick(plan: MonthlyPlan, pick: Pick): RibAssignment | undefined {
  const layer = plan.layers[pick.layerId - 1];
  if (!layer) return undefined;
  const parsed = parsePick(pick.eventId);
  if (parsed.month && layer.assignments) return layer.assignments.find(item => item.month === parsed.month);
  return undefined;
}

function Inspect({pack, plan, pick}: {pack: YearPack; plan: MonthlyPlan; pick: Pick}) {
  if (pick.layerId <= MONTHLY_FORM.bottomLayers) {
    return <aside className="nv-inspect" aria-live="polite"><p>Solid base · layers 1–{MONTHLY_FORM.bottomLayers}. Not an article.</p></aside>;
  }
  const parsed = parsePick(pick.eventId);
  if (parsed.kind === 'gutter') {
    return <aside className="nv-inspect" aria-live="polite"><p>Month gutter — the 12 ribs are separated by a thin unprinted seam.</p></aside>;
  }
  const assignment = assignmentFromPick(plan, pick);
  if (parsed.kind === 'unobserved' || assignment?.kind === 'unobserved') {
    return <aside className="nv-inspect" aria-live="polite"><p>Unobserved · after {pack.observedThrough}. This part of the rib is left unprinted, not scored as calm.</p></aside>;
  }
  if (assignment?.kind === 'empty' || (!assignment && plan.mode !== 'annual' && parsed.kind === 'stable')) {
    const month = assignment?.month ?? parsed.month;
    const label = month ? pack.vessels[pick.dimension].ribs[month - 1]?.label : 'This month';
    return <aside className="nv-inspect" aria-live="polite"><p>{label}{assignment?.date ? ` · ${assignment.date}` : ''} · no tag articles on this band. Stable clay marks an observed gap, not a low score.</p></aside>;
  }
  const ids = assignment?.ids ?? [];
  const articles = ids.map(id => pack.articles[id]).filter(Boolean);
  if (plan.mode === 'annual') {
    const band = plan.bands.find(item => pick.layerId >= item.first && pick.layerId <= item.last && item.id !== 'Solid base');
    const article = band ? pack.articles[band.id] : undefined;
    if (!article) return <aside className="nv-inspect" aria-live="polite"><p>Layer {pick.layerId}.</p></aside>;
    return (
      <aside className="nv-inspect" aria-live="polite">
        <span className="nv-kicker">Layer {pick.layerId} · {band?.behavior} · {band ? band.score.toFixed(3) : ''}</span>
        <a href={article.url} target="_blank" rel="noreferrer">{article.title}</a>
        <p>{article.date}{article.raw != null ? ` · raw ${article.raw.toFixed(3)}` : ''}</p>
      </aside>
    );
  }
  if (!articles.length) {
    return <aside className="nv-inspect" aria-live="polite"><p>Layer {pick.layerId}{assignment?.date ? ` · ${assignment.date}` : ''}.</p></aside>;
  }
  return (
    <aside className="nv-inspect" aria-live="polite">
      <span className="nv-kicker">
        Layer {pick.layerId}
        {assignment?.date ? ` · ${assignment.date}` : ''}
        {assignment ? ` · ${assignment.score.toFixed(3)}` : ''}
        {articles.length > 1 ? ` · mean of ${articles.length} articles` : ''}
      </span>
      {articles.map((article, index) => (
        <p key={ids[index] ?? article.url}>
          <a href={article.url} target="_blank" rel="noreferrer">{article.title}</a>
          <span> {article.date}{article.raw != null ? ` · raw ${article.raw.toFixed(3)}` : ''}</span>
        </p>
      ))}
    </aside>
  );
}

function MonthLegend({row, observedThrough}: {row: YearRow; observedThrough: string | null}) {
  const labels = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return (
    <ol className="nv-months" aria-label="Articles per month">
      {labels.map((label, index) => {
        const count = row.monthCounts[index] ?? 0;
        const stamp = `${row.year}-${String(index + 1).padStart(2, '0')}-01`;
        const unobserved = Boolean(observedThrough && stamp > observedThrough);
        const state = unobserved && count === 0 ? 'unobserved' : count === 0 ? 'empty' : count < 5 ? 'sparse' : 'ok';
        return (
          <li key={label} data-state={state}>
            <span>{label}</span>
            <b>{unobserved && count === 0 ? '—' : count}</b>
          </li>
        );
      })}
    </ol>
  );
}

export default function MonthlyVessels() {
  const [index, setIndex] = useState<IndexFile | null>(null);
  const [year, setYear] = useState(yearFromLocation);
  const [mode, setMode] = useState<MappingMode>(modeFromLocation);
  const [pack, setPack] = useState<YearPack | null>(null);
  const [plans, setPlans] = useState<Record<string, MonthlyPlan> | null>(null);
  const [status, setStatus] = useState('Loading corpus…');
  const [error, setError] = useState('');
  const [selected, setSelected] = useState<Pick | null>(null);

  useEffect(() => { document.title = `Guardian AI ${year} · monthly ribs`; }, [year]);
  useEffect(() => { writeLocation(year, mode); }, [year, mode]);
  useEffect(() => {
    const onHash = () => { setYear(yearFromLocation()); setMode(modeFromLocation()); };
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
    const row = index.years.find((item) => item.year === year);
    setSelected(null);
    setPlans(null);
    if (!row) {
      setPack(null);
      setStatus(`No year pack for ${year}.`);
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
        window.setTimeout(() => {
          if (cancelled) return;
          try {
            const next: Record<string, MonthlyPlan> = {};
            for (const dim of DIMS) next[dim.id] = mapMonthlyVase(data.vessels[dim.id], data.observedThrough, mode, config);
            setPlans(next);
            setStatus('');
            setError('');
          } catch (reason) {
            setPlans(null);
            setError(reason instanceof Error ? reason.message : 'Mapping failed.');
            setStatus('');
          }
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
  }, [index, year, mode]);

  const row = index?.years.find((item) => item.year === year);
  const yearCounts = useMemo(() => {
    const map = new Map<number, YearRow>();
    for (const item of index?.years ?? []) map.set(item.year, item);
    return map;
  }, [index]);
  const modeInfo = MODES.find((item) => item.id === mode)!;

  return (
    <div className="memory-experience vessels monthly">
      <header className="mx-header">
        <a href={base} className="mx-brand"><span className="mx-mark">g<span>f</span></span><span>GRAMMAR<br/>OF FAILURE</span></a>
        <nav aria-label="Main navigation">
          <a href="/rank/newsviz-vessels/">Annual vessels</a>
          <a href={base} aria-current="page">Monthly ribs</a>
          <a href="/rank/newsviz/">Score explorer</a>
        </nav>
        <span className="mx-edition">GUARDIAN · TAG AI · 12 RIBS <i/></span>
      </header>
      <main>
        <section className="mx-intro">
          <div>
            <span className="nv-kicker">Material atlas / time dimension</span>
            <h1>Twelve ribs <em>/ {year}</em></h1>
            <p>
              The same Guardian tag corpus, now split by month. Circumference is the calendar
              (Jan–Dec). In the default mode, height is the day of that month, so a mid-year
              change can sit mid-vessel instead of stacking into a column. 2016–2022 (and 2014,
              2024, 2026) show the strongest month-to-month contrast; 2023 is busy but flat
              across months; early years are too sparse to read as a monthly series.
            </p>
          </div>
          <div className="nv-origin">
            {index ? `${index.articleCount.toLocaleString('en-GB')} tag articles, ${YEAR_FROM}–${YEAR_TO}` : 'Loading…'}
            <br/><span>{MONTHLY_FORM.layerCount} layers · 12 ribs</span>
          </div>
        </section>

        <section className="nv-year" aria-label="Year and mapping mode">
          <label>
            <span className="nv-kicker">Year</span>
            <strong>{year}</strong>
            <input type="range" min={YEAR_FROM} max={YEAR_TO} value={year} onChange={(event) => setYear(Number(event.target.value))} list="nv-years"/>
          </label>
          <datalist id="nv-years">
            {Array.from({length: YEAR_TO - YEAR_FROM + 1}, (_, i) => YEAR_FROM + i).map((value) => (
              <option key={value} value={value} label={String(value)} />
            ))}
          </datalist>
          <div className="nv-year-ticks" aria-hidden="true">
            {Array.from({length: YEAR_TO - YEAR_FROM + 1}, (_, i) => YEAR_FROM + i).map((value) => (
              <button key={value} type="button" data-empty={(yearCounts.get(value)?.articleCount ?? 0) === 0} aria-pressed={value === year} onClick={() => setYear(value)}>
                {String(value).slice(2)}
              </button>
            ))}
          </div>
          <div className="nv-modes" role="tablist" aria-label="Mapping mode">
            {MODES.map((item) => (
              <button key={item.id} type="button" role="tab" aria-selected={mode === item.id} onClick={() => setMode(item.id)}>{item.label}</button>
            ))}
          </div>
          <p className="nv-caption">{modeInfo.hint}</p>
          <p className="nv-caption">
            {row
              ? `${row.articleCount.toLocaleString('en-GB')} tag article${row.articleCount === 1 ? '' : 's'} this year`
                + (row.emptyMonths.length ? ` · empty months: ${row.emptyMonths.join(', ')}` : '')
                + (row.sparseMonths.length ? ` · thin months (<5): ${row.sparseMonths.join(', ')}` : '')
                + (pack?.observedThrough && year === YEAR_TO ? ` · observed through ${pack.observedThrough}` : '')
                + '.'
              : `${year} has no year pack.`}
          </p>
          {row && <MonthLegend row={row} observedThrough={pack?.observedThrough ?? index?.observedThrough ?? null} />}
        </section>

        {error && <p className="nv-error" role="alert">{error}</p>}
        {status && <p className="nv-status" role="status">{status}</p>}

        {pack && plans && (
          <div className="nv-grid">
            {DIMS.map((dim) => (
              <VesselColumn
                key={`${pack.year}-${mode}-${dim.id}`}
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
          <span>GRAMMAR OF FAILURE / GUARDIAN AI / MONTHLY RIBS</span>
          <span>Software simulation on real tag scores · not a machine toolpath</span>
        </footer>
      </main>
    </div>
  );
}
