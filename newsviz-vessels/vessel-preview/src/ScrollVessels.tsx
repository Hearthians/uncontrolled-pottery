import {useEffect, useLayoutEffect, useRef, useState} from 'react';
import {mapFlutedVase} from './flutedMapping.ts';
import type {FluteMonth} from './flutedMapping.ts';
import type {MonthlyVessel} from './monthlyMapping.ts';
import {createScrollRenderer} from './scrollRenderer.ts';
import type {ScrollRenderer} from './scrollRenderer.ts';
import './scroll.css';

const base = import.meta.env.BASE_URL;
const dimensions = [
  {id: 'valence', label: 'Valence'},
  {id: 'alarmist', label: 'Alarmist'},
  {id: 'angry', label: 'Angry'},
] as const;

type Dimension = (typeof dimensions)[number]['id'];
type Vessels = Record<Dimension, FluteMonth[]>;
type Index = {years: {year: number}[]};
type Pack = {year: number; observedThrough: string | null; vessels: Record<Dimension, MonthlyVessel>};

async function read<T>(path: string, signal: AbortSignal): Promise<T> {
  const response = await fetch(`${base}data/${path}`, {signal});
  if (!response.ok) throw Error(`HTTP ${response.status}`);
  return response.json();
}

function VesselImage({label, months, surface, year}: {
  label: string; months: FluteMonth[]; surface: ScrollRenderer; year: number;
}) {
  const element = useRef<HTMLCanvasElement>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    const canvas = element.current!;
    function render() {
      surface.enqueue(canvas, months, () => setError(true));
    }
    const resize = new ResizeObserver(render);
    resize.observe(canvas);
    return () => {
      resize.disconnect();
      surface.cancel(canvas);
    };
  }, [months, surface]);

  return <>
    <canvas ref={element} aria-label={`${label} fluted vase, ${year}`} role="img"/>
    {error && <span className="vs-error" role="status">Preview unavailable</span>}
  </>;
}

function Year({year, active, focused, surface}: {
  year: number; active: boolean; focused: boolean; surface: ScrollRenderer | null;
}) {
  const [vessels, setVessels] = useState<Vessels | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (!active || vessels) return;
    const controller = new AbortController();
    setError(false);
    read<Pack>(`years/${year}.json`, controller.signal).then(pack => {
      if (controller.signal.aborted) return;
      if (pack.year !== year) throw Error('Unexpected year');
      setVessels({
        valence: mapFlutedVase(pack.vessels.valence, pack.observedThrough),
        alarmist: mapFlutedVase(pack.vessels.alarmist, pack.observedThrough),
        angry: mapFlutedVase(pack.vessels.angry, pack.observedThrough),
      });
    }).catch(() => {if (!controller.signal.aborted) setError(true);});
    return () => controller.abort();
  }, [year, active, vessels]);

  return <section className="vs-year" data-year={year} aria-current={focused || undefined}
    aria-labelledby={`year-${year}`}
    aria-describedby={year === 2026 ? 'last-year-coverage' : undefined}>
    <div className="vs-card">
      <h2 id={`year-${year}`}>{year}</h2>
      <div className="vs-vessels">
        {dimensions.map(dimension => <figure key={dimension.id}>
          <div className="vs-piece">
            {active && surface && vessels && <VesselImage label={dimension.label}
              months={vessels[dimension.id]} surface={surface} year={year}/>}
          </div>
          <figcaption>{dimension.label}</figcaption>
        </figure>)}
      </div>
      {active && error && <p className="vs-error" role="status">Could not load {year}.</p>}
    </div>
  </section>;
}

export default function ScrollVessels() {
  const gallery = useRef<HTMLElement>(null);
  const [years, setYears] = useState<number[]>([]);
  const [focus, setFocus] = useState<number | null>(null);
  const [surface, setSurface] = useState<ScrollRenderer | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    const controller = new AbortController();
    read<Index>('index.json', controller.signal)
      .then(index => {if (!controller.signal.aborted) setYears(index.years.map(row => row.year).sort((a, b) => a - b));})
      .catch(() => {if (!controller.signal.aborted) setError('Could not load the year list.');});
    return () => controller.abort();
  }, []);

  useEffect(() => {
    try {
      const renderer = createScrollRenderer(() => setError('Graphics context lost. Reload to restore the gallery.'));
      setSurface(renderer);
      return () => renderer.dispose();
    } catch {
      setError('WebGL is unavailable.');
    }
  }, []);

  useLayoutEffect(() => {
    if (!years.length) return;
    const sections = Array.from(gallery.current!.querySelectorAll<HTMLElement>('.vs-year'));
    let frame = 0;
    let visible: HTMLElement[] = [];
    let focused = -1;

    function update() {
      frame = 0;
      const first = sections[0].getBoundingClientRect();
      const center = document.documentElement.clientHeight / 2;
      const position = (center - first.top - first.height / 2) / first.height;
      const index = Math.max(0, Math.min(sections.length - 1, Math.round(position)));
      if (index !== focused) {
        focused = index;
        setFocus(index);
      }

      const start = Math.max(0, index - 1);
      const next = sections.slice(start, index + 2);
      for (const section of visible) {
        if (!next.includes(section)) section.style.removeProperty('--year-opacity');
      }
      next.forEach((section, offset) => {
        const distance = Math.abs(start + offset - position);
        const t = Math.min(1, distance);
        const fade = t * t * (3 - 2 * t);
        const edge = Math.min(1, Math.max(0, (1.5 - distance) * 2));
        section.style.setProperty('--year-scale', String(1 - .32 * fade));
        section.style.setProperty('--year-opacity', String((1 - .54 * fade) * edge));
      });
      visible = next;
    }

    function schedule() {
      if (!frame) frame = requestAnimationFrame(update);
    }
    update();
    window.addEventListener('scroll', schedule, {passive: true});
    window.addEventListener('resize', schedule);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('scroll', schedule);
      window.removeEventListener('resize', schedule);
    };
  }, [years]);

  return <main className="vs-gallery" ref={gallery}>
    <h1 className="vs-sr-only">Fluted vessels by year</h1>
    <p className="vs-sr-only" id="last-year-coverage">Coverage ends 27 November 2026. Unobserved December has a shallower flute.</p>
    {error && <p className="vs-global-error" role="alert">{error}</p>}
    <div className="vs-timeline" aria-hidden="true">
      {years.map((year, index) => <span key={year} data-current={index === focus}/>)}
    </div>
    {years.map((year, index) => <Year key={year} year={year} focused={index === focus}
      active={focus !== null && Math.abs(index - focus) <= 1} surface={surface}/>)}
  </main>;
}
