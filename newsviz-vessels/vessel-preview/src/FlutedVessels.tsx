import {useEffect, useState} from 'react';
import {names} from './behaviourConfig.ts';
import {FlutedScene} from './FlutedScene.tsx';
import {fluteDayAt, mapFlutedVase} from './flutedMapping.ts';
import type {FluteMonth} from './flutedMapping.ts';
import type {FluteHit} from './flutedGeometry.ts';
import type {MonthlyVessel} from './monthlyMapping.ts';
import './fluted.css';

const base = import.meta.env.BASE_URL;
const dimensions = [
  {id: 'valence', label: 'Valence', note: 'Higher means more negative coverage.'},
  {id: 'alarmist', label: 'Alarmist', note: 'Higher means more alarmist framing.'},
  {id: 'angry', label: 'Angry', note: 'Higher means more anger in the article.'},
] as const;

type Dim = (typeof dimensions)[number]['id'];
type Article = {title: string; url: string};
type YearIndex = {from: number; to: number; observedThrough: string; years: {year: number; articleCount: number}[]};
type YearPack = {
  year: number; articleCount: number; observedThrough: string | null;
  vessels: Record<Dim, MonthlyVessel>; articles: Record<string, Article>;
};
type Loaded = {pack: YearPack; flutes: Record<Dim, FluteMonth[]>};
type Selection = {dimension: Dim; hit: FluteHit | {month: number}};

const yearRange = {from: 2005, to: 2026};
const displayDate = new Intl.DateTimeFormat('en-GB', {dateStyle: 'long', timeZone: 'UTC'});
const displayMonth = new Intl.DateTimeFormat('en-GB', {month: 'long', timeZone: 'UTC'});
const shortMonth = new Intl.DateTimeFormat('en-GB', {month: 'short', timeZone: 'UTC'});
const months = Array.from({length: 12}, (_, i) => new Date(Date.UTC(2020, i, 1)));

function selectedYear() {
  const value = Number(location.hash.replace(/^#(?:year=)?/, ''));
  return Number.isInteger(value) && value >= yearRange.from && value <= yearRange.to ? value : yearRange.to;
}

function formatDate(date: string) {
  return displayDate.format(new Date(date));
}

async function getData<T>(file: string, signal: AbortSignal): Promise<T> {
  const response = await fetch(`${base}data/${file}`, {signal});
  if (!response.ok) throw Error(`Could not load ${file} (HTTP ${response.status}).`);
  return response.json();
}

function Inspector({loaded, selection}: {loaded: Loaded; selection: Selection | null}) {
  if (!selection) return <p className="fv-inspector" aria-live="polite">Drag to rotate. Double-click a flute to inspect the scores on that day, or select a month above.</p>;
  const {dimension, hit} = selection;
  const label = dimensions.find(item => item.id === dimension)!.label;
  if (hit === 'base') return <p className="fv-inspector" aria-live="polite">{label} · Solid clay base.</p>;

  const month = loaded.flutes[dimension][hit.month - 1];
  const day = 'mm' in hit ? fluteDayAt(month, hit.mm) : null;
  const state = day?.state ?? month.state;
  const title = day ? formatDate(day.date) : `${displayMonth.format(months[hit.month - 1])} ${loaded.pack.year}`;
  const numArticles = day ? day.items.length : month.articleCount;

  return (
    <aside className="fv-inspector" aria-live="polite">
      <h2>{label} <span>· {title}</span></h2>
      {state === 'unobserved' ? (
        <p>Unobserved. Coverage ends {formatDate(loaded.pack.observedThrough!)}. This softened section has no score.</p>
      ) : state === 'empty' ? (
        <p>No tagged articles on this {day ? 'day' : 'month'}. Regular clay marks the observed absence of coverage.</p>
      ) : (
        <>
          <p>
            {numArticles.toLocaleString('en-GB')} tagged {numArticles === 1 ? 'article' : 'articles'}
            {day?.rule ? ` · ${day.rule.behavior === 'stable' ? 'Stable' : names[day.rule.behavior]} · ${day.score!.toFixed(3)}` : ''}
            {day && numArticles > 1 ? ' daily mean' : ''}
            {!day && ' · Double-click a band on this flute to inspect a day.'}
          </p>
          {day && <ul>
            {day.items.map(item => {
              const article = loaded.pack.articles[item.id];
              return <li key={item.id}>
                <span>{item.score.toFixed(3)}</span>
                {article ? <a href={article.url} target="_blank" rel="noreferrer">{article.title}</a> : item.id}
              </li>;
            })}
          </ul>}
        </>
      )}
    </aside>
  );
}

export default function FlutedVessels() {
  const [index, setIndex] = useState<YearIndex | null>(null);
  const [year, setYear] = useState(selectedYear);
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [indexError, setIndexError] = useState('');
  const [packError, setPackError] = useState('');
  const [selection, setSelection] = useState<Selection | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    getData<YearIndex>('index.json', controller.signal)
      .then(setIndex)
      .catch(error => {if (!controller.signal.aborted) setIndexError(error.message);});
    const onHash = () => setYear(selectedYear());
    addEventListener('hashchange', onHash);
    return () => {controller.abort(); removeEventListener('hashchange', onHash);};
  }, []);

  useEffect(() => {
    history.replaceState(null, '', `#year=${year}`);
    document.title = `Fluted vessels · Guardian AI ${year}`;
    const controller = new AbortController();
    setPackError('');
    setSelection(null);
    getData<YearPack>(`years/${year}.json`, controller.signal).then(pack => {
      if (controller.signal.aborted) return;
      if (pack.year !== year) throw Error('The year pack does not match the selected year.');
      const flutes = {
        valence: mapFlutedVase(pack.vessels.valence, pack.observedThrough),
        alarmist: mapFlutedVase(pack.vessels.alarmist, pack.observedThrough),
        angry: mapFlutedVase(pack.vessels.angry, pack.observedThrough),
      };
      setLoaded({pack, flutes});
    }).catch(error => {
      if (!controller.signal.aborted) setPackError(error.message);
    });
    return () => controller.abort();
  }, [year]);

  const view = loaded?.pack.year === year ? loaded : null;
  const count = view?.pack.articleCount ?? index?.years.find(item => item.year === year)?.articleCount;
  const from = index?.from ?? yearRange.from, to = index?.to ?? yearRange.to;
  const cutoff = view?.pack.observedThrough ?? index?.observedThrough;
  const currentMonth = selection && selection.hit !== 'base' ? selection.hit.month : null;
  const error = indexError || packError;

  return <div className="fv-page">
    <header className="fv-header">
      <a className="fv-brand" href="/rank/newsviz-vessels/"><span aria-hidden="true">gf</span> Grammar of Failure</a>
      <nav aria-label="Vessel previews">
        <a href="/rank/newsviz-vessels-monthly/">Monthly ribs</a>
        <a href="/rank/newsviz-vessels-stacked/">Stacked months</a>
        <a href="/rank/newsviz/">Scores</a>
      </nav>
    </header>
    <main>
      <header className="fv-intro">
        <div>
          <p className="fv-kicker">Guardian AI coverage</p>
          <h1>Fluted vessels</h1>
          <p className="fv-dek">Twelve twisting flutes follow the calendar. Each flute reads from the first day of its month at the base to the last at the rim.</p>
        </div>
        <div className="fv-year">
          <label htmlFor="fv-year">Year</label>
          <select id="fv-year" value={year} onChange={event => setYear(Number(event.target.value))}>
            {Array.from({length: to - from + 1}, (_, i) => from + i).map(value => <option key={value}>{value}</option>)}
          </select>
          {count != null && <p>{count.toLocaleString('en-GB')} tagged {count === 1 ? 'article' : 'articles'}</p>}
        </div>
      </header>
      {view && <div className="fv-calendar">
        <ol aria-label="Calendar months and article counts">
          {view.flutes.valence.map(month => (
            <li key={month.month} data-state={month.state}>
              <button type="button" aria-pressed={currentMonth === month.month}
                aria-label={`${displayMonth.format(months[month.month - 1])}, ${month.state === 'scored'
                  ? `${month.articleCount} tagged articles` : month.state === 'empty' ? 'empty' : 'unobserved'}`}
                onClick={() => setSelection({dimension: selection?.dimension ?? 'valence', hit: {month: month.month}})}>
                <span>{shortMonth.format(months[month.month - 1])}</span>
                <strong>{month.state === 'scored' ? month.articleCount : month.state === 'empty' ? 'Empty' : 'Unobserved'}</strong>
              </button>
            </li>
          ))}
        </ol>
        <p>Empty months retain regular clay.{cutoff && cutoff < `${year}-12-31`
          ? ` Coverage ends ${formatDate(cutoff)}. Unobserved portions have a shallower profile.` : ''}</p>
      </div>}
      {error && <p className="fv-load" role="alert">{error}</p>}
      {!view && !error && <p className="fv-load" role="status">Loading {year} vessels…</p>}
      {view && <>
        <div className="fv-gallery">
          {dimensions.map(dim => <section className="fv-vessel" key={`${year}-${dim.id}`} aria-label={dim.label}>
            <header>
              <h2>{dim.label}</h2>
              <p>{dim.note}</p>
            </header>
            <FlutedScene months={view.flutes[dim.id]} label={dim.label}
              onPick={hit => setSelection({dimension: dim.id, hit})}/>
          </section>)}
        </div>
        <Inspector loaded={view} selection={selection}/>
      </>}
      <footer className="fv-method">
        <h2>Reading the clay</h2>
        <p>Daily scores follow the frozen Prototype C mapping. When a day has several tagged articles, their mean sets the band. Valence uses (1 − v) / 2. Alarmist and Angry use their original 0–1 scores.</p>
        <dl>
          <div><dt>Stable</dt><dd>0–&lt;0.20 · Regular courses</dd></div>
          <div><dt>Gaps</dt><dd>0.20–&lt;0.40 · Recessed, thinner clay</dd></div>
          <div><dt>Bulging</dt><dd>0.40–&lt;0.60 · Outward swelling</dd></div>
          <div><dt>Misalignment</dt><dd>0.60–&lt;0.80 · Sideways offset</dd></div>
          <div><dt>Sagging</dt><dd>0.80–1.00 · Downward deformation</dd></div>
        </dl>
      </footer>
    </main>
  </div>;
}
