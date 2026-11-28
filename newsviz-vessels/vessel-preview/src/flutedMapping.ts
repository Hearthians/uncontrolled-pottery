import {scoreParams, validateConfig} from './behaviourConfig.ts';
import {siteStrength, staggeredCourse} from './materialPattern.ts';
import type {MonthlyItem, MonthlyVessel} from './monthlyMapping.ts';
import frozenMapping from '../prototype-c-staggered-mapping-v1.json' with {type: 'json'};

export const FLUTED_FORM = {height: 120, bottom: 3, flutes: 12, segmentsPerFlute: 20} as const;

const config = validateConfig({...frozenMapping, preview: {mode: 'Data-driven', behaviour: 'sagging'}});
const coherence = config.simulationSettings.coherenceLayers ?? 8;
const cycle = 2 * Math.PI;
export const smooth = (t: number) => t * t * (3 - 2 * t);
export const mix = (a: number, b: number, t: number) => a + (b - a) * t;

type State = 'scored' | 'empty' | 'unobserved';
type Rule = ReturnType<typeof scoreParams>;
type Site = {center: number; strength: number};
export type FluteDay = {
  date: string; state: State; score: number | null; items: MonthlyItem[];
  rule: Rule | null; sites: Site[];
};
export type FluteMonth = {month: number; state: State; articleCount: number; days: FluteDay[]};
type Relief = {radial: number; shift: number; drop: number; neck: number; unfinished: number};
const calm: Relief = {radial: 0, shift: 0, drop: 0, neck: 0, unfinished: 0};

function dayStamp(year: number, month: number, day: number) {
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

export function mapFlutedVase(vessel: MonthlyVessel, observedThrough: string | null): FluteMonth[] {
  if (vessel.ribs.length !== FLUTED_FORM.flutes) throw Error('Expected twelve calendar months in the year pack.');
  return vessel.ribs.map((rib, index) => {
    const month = index + 1;
    if (rib.month !== month) throw Error('Expected months in calendar order.');
    const dayCount = new Date(Date.UTC(vessel.year, month, 0)).getUTCDate();
    const grouped = new Map<string, MonthlyItem[]>();
    for (const item of rib.items) {
      const day = Number(item.date.slice(-2));
      if (!Number.isInteger(day) || day < 1 || day > dayCount || item.date !== dayStamp(vessel.year, month, day) ||
          !Number.isFinite(item.score) || item.score < 0 || item.score > 1) {
        throw Error('Expected an in-month date and a score between 0 and 1.');
      }
      const sameDay = grouped.get(item.date);
      if (sameDay) sameDay.push(item);
      else grouped.set(item.date, [item]);
    }
    const days: FluteDay[] = Array.from({length: dayCount}, (_, dayIndex) => {
      const date = dayStamp(vessel.year, month, dayIndex + 1);
      if (observedThrough && date > observedThrough) {
        return {date, state: 'unobserved', score: null, items: [], rule: null, sites: []};
      }
      const items = grouped.get(date) ?? [];
      if (!items.length) return {date, state: 'empty', score: null, items, rule: null, sites: []};
      const score = items.reduce((sum, item) => sum + item.score, 0) / items.length;
      const rule = scoreParams(score, config);
      if (rule.behavior === 'stable') return {date, state: 'scored', score, items, rule, sites: []};

      const course = FLUTED_FORM.bottom + Math.floor((dayIndex + .5) *
        (FLUTED_FORM.height - FLUTED_FORM.bottom) / dayCount);
      const seed = config.seed + month * 17;
      const {centre} = staggeredCourse(course, score, rule.coverage, seed, coherence);
      const offset = (centre - Math.floor(centre) - .5) * .42;
      const count = Math.max(1, Math.round(rule.eventCount / 4));
      const sites = Array.from({length: count}, (_, site) => ({
        center: offset + (site - (count - 1) / 2) * .22,
        strength: siteStrength(site, count, course, seed, coherence, .24),
      }));
      return {date, state: 'scored', score, items, rule, sites};
    });
    const articleCount = days.reduce((sum, day) => sum + day.items.length, 0);
    const state = days[0].state === 'unobserved' ? 'unobserved' : articleCount ? 'scored' : 'empty';
    return {month, state, articleCount, days};
  });
}

function reliefFor(day: FluteDay, across: number): Relief {
  // The envelope is zero with zero slope at each shared fold valley.
  const envelope = .5 + .5 * Math.cos(cycle * across);
  if (day.state === 'unobserved') return {...calm, unfinished: envelope};
  const rule = day.rule;
  if (!rule || !day.sites.length) return calm;
  const width = .14 + rule.coverage * .006;
  let effect = 0;
  for (const site of day.sites) {
    const distance = Math.abs(across - site.center) / width;
    if (distance < 1) effect = Math.max(effect, site.strength * (1 - smooth(distance)));
  }
  effect *= envelope;
  switch (rule.behavior) {
    case 'gaps': return {...calm, radial: -1.10 * rule.amplitude * effect, neck: effect};
    case 'buldges': return {...calm, radial: .77 * (rule.amplitude - 1) * effect};
    case 'misalignment': return {...calm, shift: rule.amplitude * effect * .0072};
    case 'sagging': return {...calm, drop: .17 * rule.amplitude * effect};
    default: return calm;
  }
}

export function fluteRelief(month: FluteMonth, fraction: number, across: number): Relief {
  const day = Math.max(0, Math.min(month.days.length - 1, fraction * month.days.length - .5));
  const index = Math.floor(day);
  const start = reliefFor(month.days[index], across);
  const next = month.days[index + 1];
  if (!next || index === day) return start;
  const end = reliefFor(next, across);
  const t = smooth(day - index);
  return {
    radial: mix(start.radial, end.radial, t), shift: mix(start.shift, end.shift, t),
    drop: mix(start.drop, end.drop, t), neck: mix(start.neck, end.neck, t),
    unfinished: mix(start.unfinished, end.unfinished, t),
  };
}

export function fluteDayAt(month: FluteMonth, mm: number) {
  const fraction = (mm - FLUTED_FORM.bottom) / (FLUTED_FORM.height - FLUTED_FORM.bottom);
  const index = Math.max(0, Math.min(month.days.length - 1, Math.floor(fraction * month.days.length)));
  return month.days[index];
}
