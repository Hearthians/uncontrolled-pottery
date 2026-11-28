import {defaultConfig, FOLD_DEFAULTS, scoreParams, validateConfig} from './behaviourConfig.ts';
import type {Failure} from './behaviourConfig.ts';
import {FORM, PRINT} from './config.ts';
import {generateGeometry, twistAt} from './geometry.ts';
import {contactZ, foldFrames, settleFold} from './sagFold.ts';
import {DEFAULT_COHERENCE, registrationFrames, siteStrength, staggeredCourse} from './materialPattern.ts';
import {generateToolpath} from './toolpath.ts';
import type {BeadFrame, Move, Toolpath, XYZ} from './toolpath.ts';
import defaults from './annualBehaviors.json' with {type: 'json'};

export const MONTHLY_FORM = Object.freeze({
  ...FORM,
  version: 'fixed-twist-2-monthly-120',
  heightMm: 120,
  layerCount: 120,
  layerHeightMm: 1,
  bottomLayers: 3,
});

export type MappingMode = 'date' | 'score' | 'annual';
export type Behavior = 'stable' | 'gaps' | 'buldges' | 'misalignment' | 'sagging';
export type MonthlyItem = {id: string; score: number; date: string};
export type MonthlyRib = {
  month: number; label: string; articleCount: number;
  empty: boolean; sparse: boolean; items: MonthlyItem[];
};
export type MonthlyVessel = {
  country: string; year: number; layerCount: number; bottomLayers: number;
  ribs: MonthlyRib[];
};
export type RibKind = 'base' | 'empty' | 'unobserved' | 'grammar';
export type RibAssignment = {
  month: number; kind: RibKind; score: number;
  ids: string[]; date?: string; first?: number; last?: number;
};

const GUTTER = 0.007;
const MAX_RIB_EVENTS = 3;
const baseline = generateToolpath(generateGeometry(MONTHLY_FORM));
const contours = baseline.geometry.contours;
const templates = contours.map(() => [] as Move[]);
for (const move of baseline.moves) templates[move.layerId - 1].push(move);
const sources = contours.map((contour, index) => {
  const moves = templates[index].filter(move => move.kind === 'deposition'), arc = [0];
  for (const move of moves) arc.push(arc.at(-1)! + move.lengthMm);
  return {moves, arc, perimeter: arc.at(-1)!, points: contour.points};
});

type Event = {start: number; end: number; site: number; cell: number; behavior: Behavior; amplitude: number; strength: number; month: number; sourceType: string; inspectId: number};
type Sample = {at: number; command: XYZ; clay: XYZ; width: number};
type Ring = {supportMoves?: Move[]; samples: Sample[]; moves: Move[]; events: Event[]; cellCount: number; perimeter: number; shiftMm: number; shiftUnverified: boolean; relief: boolean; key: string; printStart: number;
  replacements: ({firstMove: number; moveCount: number} & ReturnType<typeof settleFold>)[]};
type Effective = ReturnType<typeof scoreParams> & {score: number};
type Previous = {rings: Ring[]; layers: {renderMoves: Move[]}[]};

const blend = (left: XYZ, right: XYZ, t: number): XYZ => t === 0 ? left : t === 1 ? right : [left[0] + t * (right[0] - left[0]), left[1] + t * (right[1] - left[1]), left[2] + t * (right[2] - left[2])];
const distance = (left: XYZ, right: XYZ) => Math.hypot(left[0] - right[0], left[1] - right[1], left[2] - right[2]);
const tip = (point: XYZ): XYZ => [point[0], point[1], point[2] + PRINT.nozzleAboveBeadCentreMm];
const smooth = (u: number) => u * u * (3 - 2 * u);
function interval(length: number, at: (index: number) => number, value: number) {
  let low = 0, high = length - 1;
  while (high - low > 1) {const mid = (high + low) >>> 1; if (at(mid) <= value) low = mid; else high = mid;}
  return low;
}
function outward(point: XYZ, offset: number): XYZ {
  const factor = 1 + offset / Math.hypot(point[0], point[1]);
  return [factor * point[0], factor * point[1], point[2]];
}

export function daysInMonth(year: number, month: number) {
  return new Date(year, month, 0).getDate();
}

export function dayLayerRange(day: number, days: number, bottom = MONTHLY_FORM.bottomLayers, wall = MONTHLY_FORM.layerCount - MONTHLY_FORM.bottomLayers) {
  return {
    first: bottom + 1 + Math.floor((day - 1) * wall / days),
    last: bottom + Math.floor(day * wall / days),
  };
}

export function quantileSample<T extends {id: string; score: number}>(rows: T[], k: number): T[] {
  const ordered = [...rows].sort((a, b) => a.score - b.score || (a.id < b.id ? -1 : 1));
  if (ordered.length <= k) return ordered;
  const used = new Set<number>(), chosen: T[] = [];
  for (let i = 0; i < k; i++) {
    let index = Math.round(i * (ordered.length - 1) / (k - 1));
    if (used.has(index)) {
      for (let delta = 1; delta < ordered.length; delta++) {
        if (index + delta < ordered.length && !used.has(index + delta)) {index = index + delta; break;}
        if (index - delta >= 0 && !used.has(index - delta)) {index = index - delta; break;}
      }
    }
    used.add(index);
    chosen.push(ordered[index]);
  }
  return chosen;
}

function ribParams(score: number, config: ReturnType<typeof validateConfig>, manual?: Failure): Effective {
  const params = scoreParams(score, config, manual);
  if (params.behavior === 'stable' || params.eventCount <= 0) return {...params, score};
  return {...params, score, eventCount: Math.max(1, Math.min(MAX_RIB_EVENTS, Math.round(params.eventCount / 4) || 1))};
}

export function readMonthlyDataset(input: unknown): MonthlyVessel {
  const data = input as Partial<MonthlyVessel> | null;
  if (typeof data?.country !== 'string' || !data.country.trim() || !Number.isSafeInteger(data.year)) {
    throw new Error('Provide a country and an integer year.');
  }
  if (data.layerCount !== MONTHLY_FORM.layerCount || data.bottomLayers !== MONTHLY_FORM.bottomLayers) {
    throw new Error(`Expected layerCount ${MONTHLY_FORM.layerCount} and bottomLayers ${MONTHLY_FORM.bottomLayers}.`);
  }
  if (!Array.isArray(data.ribs) || data.ribs.length !== 12) throw new Error('Provide exactly 12 month ribs, January to December.');
  const ids = new Set<string>();
  const ribs = data.ribs.map((rib, index) => {
    if (!rib || rib.month !== index + 1) throw new Error('Ribs must be month 1 through 12 in order.');
    if (!Array.isArray(rib.items)) throw new Error(`Rib ${rib.month} is missing items.`);
    const items = rib.items.map(item => {
      if (typeof item?.id !== 'string' || !item.id.trim() || ids.has(item.id.trim())) throw new Error('Each item needs a unique, nonempty id.');
      if (!Number.isFinite(item.score) || item.score < 0 || item.score > 1) throw new Error(`Score for ${item.id} must be a number in [0, 1].`);
      if (typeof item.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(item.date)) throw new Error(`Item ${item.id} needs an ISO date.`);
      ids.add(item.id.trim());
      return {id: item.id.trim(), score: item.score, date: item.date};
    });
    return {
      month: rib.month,
      label: typeof rib.label === 'string' && rib.label.trim() ? rib.label.trim() : String(rib.month),
      articleCount: items.length,
      empty: items.length === 0,
      sparse: items.length > 0 && items.length < 5,
      items,
    };
  });
  return {country: data.country.trim(), year: data.year!, layerCount: MONTHLY_FORM.layerCount, bottomLayers: MONTHLY_FORM.bottomLayers, ribs};
}

function assignDate(rib: MonthlyRib, layerId: number, year: number, observedThrough: string | null): RibAssignment {
  if (layerId <= MONTHLY_FORM.bottomLayers) return {month: rib.month, kind: 'base', score: 0, ids: []};
  const days = daysInMonth(year, rib.month);
  let day = 1;
  for (let candidate = 1; candidate <= days; candidate++) {
    const {first, last} = dayLayerRange(candidate, days);
    if (layerId >= first && layerId <= last) {day = candidate; break;}
  }
  const stamp = `${year}-${String(rib.month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  if (observedThrough && stamp > observedThrough) return {month: rib.month, kind: 'unobserved', score: 0, ids: [], date: stamp};
  const onDay = rib.items.filter(item => item.date === stamp);
  if (!onDay.length) return {month: rib.month, kind: rib.empty ? 'empty' : 'empty', score: 0, ids: [], date: stamp};
  const score = onDay.reduce((sum, item) => sum + item.score, 0) / onDay.length;
  return {month: rib.month, kind: 'grammar', score, ids: onDay.map(item => item.id), date: stamp};
}

function scoreBands(rib: MonthlyRib, wall: number) {
  const items = quantileSample(rib.items, wall);
  return items.map((item, index) => ({
    ...item,
    first: MONTHLY_FORM.bottomLayers + 1 + Math.floor(index * wall / items.length),
    last: MONTHLY_FORM.bottomLayers + Math.floor((index + 1) * wall / items.length),
  }));
}

function assignScore(rib: MonthlyRib, layerId: number, year: number, observedThrough: string | null, wall: number): RibAssignment {
  if (layerId <= MONTHLY_FORM.bottomLayers) return {month: rib.month, kind: 'base', score: 0, ids: []};
  const monthStart = `${year}-${String(rib.month).padStart(2, '0')}-01`;
  if (observedThrough && monthStart > observedThrough) return {month: rib.month, kind: 'unobserved', score: 0, ids: []};
  if (rib.empty) {
    if (observedThrough && monthStart > observedThrough) return {month: rib.month, kind: 'unobserved', score: 0, ids: []};
    return {month: rib.month, kind: 'empty', score: 0, ids: []};
  }
  const bands = scoreBands(rib, wall);
  const band = bands.find(item => layerId >= item.first && layerId <= item.last);
  if (!band) return {month: rib.month, kind: 'empty', score: 0, ids: []};
  return {month: rib.month, kind: 'grammar', score: band.score, ids: [band.id], date: band.date, first: band.first, last: band.last};
}

function flattenAnnual(data: MonthlyVessel, wall: number) {
  const items = quantileSample(data.ribs.flatMap(rib => rib.items), wall);
  const n = Math.max(1, items.length);
  return items.map((item, index) => ({
    ...item,
    first: MONTHLY_FORM.bottomLayers + 1 + Math.floor(index * wall / n),
    last: MONTHLY_FORM.bottomLayers + Math.floor((index + 1) * wall / n),
  }));
}

export type SectorPlan = RibAssignment & Effective;

function buildRingPrepared(
  index: number,
  sectors: SectorPlan[] | null,
  annual: Effective | null,
  config: ReturnType<typeof validateConfig>,
  seed: number,
  history: Ring[],
  maxDrop: number,
  key: string,
  slack: number,
  variation: number,
  coherence: number,
  edgeFor: (month: number) => number,
  gutters: boolean,
): Ring {
  const {perimeter, arc, points, moves: base} = sources[index];
  const wrap = (value: number) => ((value % perimeter) + perimeter) % perimeter;
  const events: Event[] = [];
  const cuts: number[] = [];
  const pushEvent = (start: number, width: number, behavior: Behavior, amplitude: number, strength: number, month: number, sourceType: string, site: number, cell: number, inspectId: number) => {
    if (width <= 1e-8) return;
    events.push({start: wrap(start), end: wrap(start) + width, behavior, amplitude, strength, month, sourceType, site, cell, inspectId});
    const subdivisions = behavior === 'gaps' ? 1 : behavior === 'sagging' ? 24 : 12;
    for (let part = 0; part <= subdivisions; part++) cuts.push(wrap(start + width * part / subdivisions));
  };

  if (gutters) {
    const width = GUTTER * 2 * perimeter;
    for (let month = 0; month < 12; month++) {
      const centre = (month / 12) * perimeter;
      pushEvent(centre - width / 2, width, 'gaps', 1, 1, month === 0 ? 12 : month, 'gutter', 100 + month, 100 + month, 9000 + (month === 0 ? 12 : month));
    }
  }

  const placeGrammar = (params: Effective, month: number, sourceType: string, origin: number, widthOf: number, edge: number, seedOffset: number) => {
    if (params.behavior === 'stable' || params.eventCount <= 0 || params.coverage <= 0 || params.amplitude <= (params.behavior === 'buldges' ? 1 : 0) || widthOf <= 0) return;
    const bond = staggeredCourse(index, params.score, params.coverage, seed + seedOffset, coherence);
    const pitch = widthOf / params.eventCount;
    const phase = config.patternSettings[params.behavior].phase;
    for (let site = 0; site < params.eventCount; site++) {
      const weight = siteStrength(site, params.eventCount, index, seed + seedOffset, coherence, variation);
      const window = pitch * params.coverage / 100;
      const width = params.behavior === 'gaps'
        ? Math.min(window, (1.4 + 1.6 * bond.within) * PRINT.beadWidthMm) * params.amplitude * edge * (0.78 + 0.22 * weight)
        : Math.min(window, widthOf * 0.92);
      const local = ((site + bond.centre) * pitch + (phase % 360) / 360 * widthOf) % widthOf;
      const centre = origin + local;
      const start = Math.min(Math.max(centre - width / 2, origin), origin + widthOf - width);
      const emphasis = params.behavior === 'sagging' ? weight ** (params.eventCount > 6 ? 2 : 1.5) : 0.65 + 0.35 * weight;
      pushEvent(start, width, params.behavior, params.amplitude, edge * emphasis, month, sourceType, site + 1, site * bond.cells + bond.lane + 1, month === 0 ? site + 1 : month * 100 + site + 1);
    }
  };

  if (annual) placeGrammar(annual, 0, 'annual', 0, perimeter, edgeFor(0), 0);

  if (sectors) {
    for (const sector of sectors) {
      const monthIndex = sector.month - 1;
      const origin = (monthIndex / 12 + GUTTER) * perimeter;
      const widthOf = Math.max(0, (1 / 12 - 2 * GUTTER) * perimeter);
      if (sector.kind === 'unobserved') {
        pushEvent(origin, widthOf, 'gaps', 1, 1, sector.month, `month:${String(sector.month).padStart(2, '0')}:unobserved`, sector.month, sector.month, 8000 + sector.month);
        continue;
      }
      if (sector.kind !== 'grammar') continue;
      const sourceType = `month:${String(sector.month).padStart(2, '0')}:${sector.date ?? sector.ids[0] ?? 'band'}`;
      placeGrammar(sector, sector.month, sourceType, origin, widthOf, edgeFor(sector.month), sector.month * 17);
    }
  }

  function eventAt(value: number) {
    return events.findIndex(event => {
      const along = wrap(value - event.start);
      return along > 1e-9 && along < event.end - event.start - 1e-9;
    });
  }
  for (const value of arc) {
    const slot = eventAt(value);
    if (slot < 0 || events[slot].behavior !== 'sagging' || value === 0 || value === perimeter) cuts.push(value);
  }
  cuts.sort((left, right) => left - right);
  const positions = cuts.filter((value, idx) => idx === 0 || (value - cuts[idx - 1] > 1e-9 && perimeter - value > 1e-9));
  positions.push(perimeter);

  const contour = positions.map(value => {
    const pos = interval(arc.length, idx => arc[idx], value), fraction = (value - arc[pos]) / (arc[pos + 1] - arc[pos]);
    const point = blend(points[pos], points[pos + 1], fraction), slot = eventAt(value);
    const u = slot < 0 ? 0 : wrap(value - events[slot].start) / (events[slot].end - events[slot].start);
    return {pos, fraction, point, slot, u};
  });

  const directions = events.map(event => {
    if (event.behavior !== 'misalignment') return [0, 0] as [number, number];
    const centre = wrap((event.start + event.end) / 2), i = interval(arc.length, j => arc[j], centre);
    const p = blend(points[i], points[i + 1], (centre - arc[i]) / (arc[i + 1] - arc[i]));
    const angle = Math.atan2(p[1], p[0]) + 0.83 + (event.site % 2 ? 0 : Math.PI);
    return [Math.cos(angle), Math.sin(angle)] as [number, number];
  });
  const shifted = (point: XYZ, u: number, amount: number, slot: number): XYZ => {
    const shoulder = Math.min(1, 4 * Math.min(u, 1 - u));
    const step = amount * shoulder;
    return [point[0] + directions[slot][0] * step, point[1] + directions[slot][1] * step, point[2]];
  };
  let shiftUnverified = false;
  const backed = (p: XYZ) => p[2] - contactZ(p, history, PRINT.beadHeightMm) <= 0.22 * PRINT.beadHeightMm;
  const anyMisalignment = events.some(event => event.behavior === 'misalignment');
  const nextCourse = anyMisalignment && index + 1 < sources.length ? sources.slice(0, index + 2) : null;
  const shifts = events.map((event, slot) => {
    if (event.behavior !== 'misalignment') return 0;
    const span = contour.filter(s => s.slot === slot);
    const wanted = Math.min(event.amplitude * event.strength, 0.16 * (event.end - event.start));
    const supported = (amount: number) => span.every(s => {
      const p = shifted(s.point, s.u, amount, slot);
      if (!backed(p)) return false;
      if (!nextCourse) return true;
      const probe: XYZ = [p[0], p[1], p[2] + 2 * PRINT.beadHeightMm];
      return probe[2] - contactZ(probe, nextCourse, PRINT.beadHeightMm) <= 0.26 * PRINT.beadHeightMm;
    });
    if (supported(wanted)) return wanted;
    let rejected = wanted;
    for (let step = 7; step >= 0; step--) {
      let accepted = wanted * step / 8;
      if (supported(accepted)) {
        for (let i = 0; i < 6; i++) {
          const trial = (accepted + rejected) / 2;
          if (supported(trial)) accepted = trial; else rejected = trial;
        }
        return accepted;
      }
      rejected = accepted;
    }
    shiftUnverified = true;
    return 0;
  });

  const samples = contour.map(({pos, fraction, point, slot, u}) => {
    const sample: Sample = {at: pos + fraction, command: point, clay: point, width: PRINT.beadWidthMm};
    if (slot >= 0) {
      const event = events[slot];
      const pulse = Math.sin(Math.PI * u) ** 2 * event.strength;
      if (event.behavior === 'buldges') {
        sample.width *= 1 + (event.amplitude - 1) * event.strength * Math.sin(Math.PI * u) ** 1.5;
        sample.clay = outward(point, 0.37 * (sample.width - PRINT.beadWidthMm));
      }
      if (event.behavior === 'misalignment') sample.command = sample.clay = shifted(point, u, shifts[slot], slot);
      if (event.behavior === 'sagging') sample.command = sample.clay = outward(point, Math.min(event.amplitude, (0.24 + 0.08 * event.amplitude / 6.5) * (event.end - event.start)) * pulse);
    }
    if (anyMisalignment && slot < 0 && !backed(point)) shiftUnverified = true;
    const lower = history[index - 1];
    const event = slot >= 0 ? events[slot] : null;
    if (lower?.relief && (event?.behavior !== 'sagging' || (slot < 0 && maxDrop > 0 && slack > 0))) {
      const below = interval(lower.samples.length, i => lower.samples[i].at, sample.at);
      const previous = lower.moves[below], a = lower.samples[below], b = lower.samples[below + 1];
      const t = (sample.at - a.at) / (b.at - a.at);
      const inherited = a.command[2] - a.clay[2] + t * ((b.command[2] - b.clay[2]) - (a.command[2] - a.clay[2]));
      let reach = 0.62 * inherited;
      if (!previous.extrude) {
        const gap = lower.events[previous.eventId! - 1];
        if (gap) {
          const lowerArc = sources[index - 1].arc;
          const lowerAt = lowerArc[pos] + fraction * (lowerArc[pos + 1] - lowerArc[pos]);
          const fromEntry = (lowerAt - gap.start + lower.perimeter) % lower.perimeter;
          const freeSpan = Math.max(0, Math.min(fromEntry, gap.end - gap.start - fromEntry));
          reach = Math.max(reach, 0.10 * freeSpan ** 2 / PRINT.beadWidthMm);
        }
      }
      if (reach > 0.025) {
        const p = sample.clay, floor = contactZ(p, history, reach);
        if (floor < p[2]) sample.clay = [p[0], p[1], floor];
      }
    }
    return sample;
  });

  function boundary(mm: number) {
    const value = wrap(mm), before = interval(positions.length, idx => positions[idx], value);
    return (value - positions[before] <= positions[before + 1] - value ? before : before + 1) % (positions.length - 1);
  }
  const count = positions.length - 1;
  const frames = new Map<number, readonly [BeadFrame, BeadFrame]>();
  const replacements: Ring['replacements'] = [];
  const sagIndex: number[] = [];
  events.forEach((event, slot) => {
    if (event.behavior !== 'sagging' && event.behavior !== 'misalignment') return;
    const firstMove = boundary(event.start), moveCount = (boundary(event.end) - firstMove + count) % count;
    const indices = Array.from({length: moveCount + 1}, (_, step) => (firstMove + step) % count);
    const progress = indices.map((idx, step) => step === 0 ? 0 : step === moveCount ? 1 : wrap(positions[idx] - event.start) / (event.end - event.start));
    const vertices = indices.map(idx => samples[idx]);
    if (event.behavior === 'sagging') {
      const anchored = (point: XYZ) => point[2] - contactZ(point, history, PRINT.beadHeightMm) <= 0.25 * PRINT.beadHeightMm;
      const anchors = [anchored(vertices[0].command), anchored(vertices.at(-1)!.command)] as const;
      const bondWithin = 0.5;
      const material = settleFold(vertices, progress, history, event.amplitude / 6.5 * event.strength, slack * (0.45 + 0.55 * bondWithin), maxDrop, anchors);
      sagIndex[slot] = replacements.length;
      replacements.push({firstMove, moveCount, ...material});
    } else if (!shifts[slot]) return;
    const path = vertices.map(v => v.clay);
    const section = event.behavior === 'sagging' ? foldFrames(path, progress) : registrationFrames(path, PRINT.beadWidthMm);
    indices.slice(0, -1).forEach((idx, step) => frames.set(idx, [section[step], section[step + 1]]));
  });
  if (events.length || history[index - 1]?.relief) samples[count] = {...samples[0], at: points.length - 1};
  const moves = positions.slice(0, -1).map((value, idx) => {
    const start = samples[idx], end = samples[idx + 1], original = base[Math.min(base.length - 1, Math.floor((start.at + end.at) / 2))];
    const slot = eventAt((value + positions[idx + 1]) / 2);
    const event = slot >= 0 ? events[slot] : null;
    const missing = event?.behavior === 'gaps';
    if (!event && start.command === original.beadStart && end.command === original.beadEnd && start.clay === start.command && end.clay === end.command && start.width === PRINT.beadWidthMm) return original;
    const sag = event?.behavior === 'sagging' ? replacements[sagIndex[slot]] : undefined;
    return {
      ...original, start: tip(start.command), end: tip(end.command), beadStart: start.clay, beadEnd: end.clay,
      lengthMm: distance(start.command, end.command), extrude: !missing, beadWidthMm: missing ? 0 : start.width, beadEndWidthMm: missing ? 0 : end.width,
      ...(event?.behavior === 'buldges' ? {flowMultiplier: (start.width + end.width) / (2 * PRINT.beadWidthMm)} : {}),
      ...(sag ? {flowMultiplier: sag.budget / sag.nozzleLength} : {}),
      ...(frames.has(idx) ? {beadFrames: frames.get(idx)} : {}),
      sourceType: event ? event.behavior : 'stable', eventId: event ? event.inspectId : null,
    };
  });
  const wrapped = replacements.find(span => span.firstMove + span.moveCount > moves.length);
  const printStart = wrapped ? (wrapped.firstMove + moves.length - 1) % moves.length : 0;
  const relief = moves.some(move => !move.extrude || move.end[2] - PRINT.nozzleAboveBeadCentreMm - move.beadEnd[2] > 0.025);
  const grammarEvents = events.filter(event => event.sourceType !== 'gutter').length;
  return {samples, moves, events, cellCount: Math.max(4, grammarEvents), perimeter, key, replacements, printStart, relief, shiftMm: Math.max(0, ...shifts, 0), shiftUnverified};
}

// Dead code guard: the first unfinished buildRing is never exported. Leave it unused-stripped by not referencing it from map.
const initialConfig = defaultConfig();

export function mapMonthlyVase(input: unknown, observedThrough: string | null, mode: MappingMode, tuning: unknown = initialConfig, previous?: Previous) {
  const data = readMonthlyDataset(input);
  const config = tuning && typeof tuning === 'object' && 'schemaVersion' in tuning ? validateConfig(tuning) : defaultConfig(tuning as typeof defaults);
  const wall = MONTHLY_FORM.layerCount - MONTHLY_FORM.bottomLayers;
  const annualItems = mode === 'annual' ? flattenAnnual(data, wall) : [];
  const scorePlans = mode === 'score' ? data.ribs.map(rib => scoreBands(rib, wall)) : [];
  const layersPlan = contours.map(({layerId}) => {
    if (mode === 'annual') {
      if (layerId <= MONTHLY_FORM.bottomLayers) return {layerId, annual: {...scoreParams(0, config), score: 0}, sectors: null as SectorPlan[] | null};
      const band = annualItems.find(item => layerId >= item.first && layerId <= item.last);
      const score = band?.score ?? 0;
      return {layerId, annual: {...scoreParams(score, config), score} as Effective, sectors: null as SectorPlan[] | null, band};
    }
    const sectors: SectorPlan[] = data.ribs.map(rib => {
      const assignment = mode === 'date'
        ? assignDate(rib, layerId, data.year, observedThrough)
        : assignScore(rib, layerId, data.year, observedThrough, wall);
      const params = assignment.kind === 'grammar' ? ribParams(assignment.score, config) : {...scoreParams(0, config), score: 0};
      return {...assignment, ...params};
    });
    return {layerId, annual: null as Effective | null, sectors};
  });

  const rings: Ring[] = [], moves: Move[] = [], layerEndTimes: number[] = [];
  let time = 0, lengthMm = 0, depositedLengthMm = 0, dirtyBelow = false;
  const {slack = FOLD_DEFAULTS.slack, variation = FOLD_DEFAULTS.variation} = config.patternSettings.sagging;
  const coherence = config.simulationSettings.coherenceLayers ?? DEFAULT_COHERENCE;

  const layers = layersPlan.map((plan, index) => {
    const {layerId, annual, sectors} = plan;
    const isBase = layerId <= MONTHLY_FORM.bottomLayers;
    const key = isBase ? 'base' : annual
      ? ['annual', annual.behavior, annual.eventCount, annual.coverage, annual.amplitude, annual.score].join('/')
      : (sectors ?? []).map(s => [s.month, s.kind, s.behavior, s.score.toFixed(4)].join(':')).join('|');
    const prev = previous && !dirtyBelow ? previous.rings[index] : undefined;
    const edgeFor = (month: number) => {
      if (isBase) return 1;
      if (annual) {
        const nearby = layersPlan.filter((row, i) => Math.abs(i - index) <= 3 && row.annual);
        const change = nearby.find(row => row.annual && (row.annual.behavior !== annual.behavior || row.annual.eventCount !== annual.eventCount));
        if (!change) return 1;
        const distance = Math.abs(change.layerId - layerId);
        return smooth(Math.min(1, distance / 3));
      }
      const here = sectors?.find(s => s.month === month);
      if (!here) return 1;
      for (let step = 1; step <= 3; step++) {
        const before = layersPlan[index - step]?.sectors?.find(s => s.month === month);
        const after = layersPlan[index + step]?.sectors?.find(s => s.month === month);
        if ((before && (before.kind !== here.kind || before.behavior !== here.behavior)) || (after && (after.kind !== here.kind || after.behavior !== here.behavior))) {
          return smooth(Math.min(1, step / 3));
        }
      }
      return 1;
    };
    const ring = prev && prev.key === key ? prev : buildRingPrepared(
      index, isBase ? null : sectors, isBase ? null : annual, config, config.seed, rings,
      config.simulationSettings.maxDropMm, key, slack, variation, coherence, edgeFor, !isBase && !annual,
    );
    if (prev && prev.key === key && prev !== ring) {/* noop */}
    dirtyBelow ||= ring !== prev && !isBase;
    let renderMoves: Move[] = ring.moves;
    const firstSample = ring.samples[ring.printStart || 0];
    const lastSample = ring.samples[ring.samples.length - 1];
    const connect = (source: Move, start: XYZ, end: XYZ, clayStart: XYZ, clayEnd: XYZ): Move =>
      ({...source, start, end, beadStart: clayStart, beadEnd: clayEnd, lengthMm: distance(start, end)});
    const entry = templates[index][0], prevRing = rings.at(-1);
    const prevSample = prevRing?.samples[prevRing.printStart || prevRing.samples.length - 1];
    const join = connect(entry, prevSample ? tip(prevSample.command) : entry.start, tip(firstSample.command), prevSample?.clay ?? entry.beadStart, firstSample.clay);
    const seamInterrupted = prevRing && (!ring.moves[0].extrude || !ring.moves.at(-1)!.extrude || !prevRing.moves.at(-1)!.extrude || !prevRing.moves[0].extrude);
    const settledSeam = prevSample && (prevSample.clay[2] !== prevSample.command[2] || firstSample.clay[2] !== firstSample.command[2]);
    const relocate = prevRing && (seamInterrupted || settledSeam || ring.printStart !== 0 || prevRing.printStart !== 0);
    const ordered = ring.printStart ? [...ring.moves.slice(ring.printStart), ...ring.moves.slice(0, ring.printStart)] : ring.moves;
    renderMoves = [relocate ? {...join, kind: 'travel' as const, extrude: false, feedrateMmMin: PRINT.travelFeedrateMmMin} : join, ...ordered];
    if (index === contours.length - 1) {
      const lift = templates[index].at(-1)!;
      renderMoves.push(connect(lift, tip(lastSample.command), lift.end, lastSample.clay, lift.beadEnd));
    }
    for (const move of renderMoves) {
      const endTimeS = time + move.lengthMm * 60 / move.feedrateMmMin;
      moves.push(move.startTimeS === time && move.endTimeS === endTimeS ? move : {...move, startTimeS: time, endTimeS});
      time = endTimeS; lengthMm += move.lengthMm; if (move.extrude) depositedLengthMm += move.lengthMm;
    }
    layerEndTimes.push(moves[moves.length - (index === contours.length - 1 ? 2 : 1)].endTimeS);
    rings.push(ring);
    const band = annual
      ? {id: isBase ? 'Solid base' : ((plan as {band?: {id: string}}).band?.id ?? 'annual'), score: annual.score, behavior: annual.behavior, first: layerId, last: layerId}
      : {id: isBase ? 'Solid base' : 'ribs', score: sectors?.find(s => s.kind === 'grammar')?.score ?? 0, behavior: (sectors?.find(s => s.kind === 'grammar')?.behavior ?? 'stable') as Behavior, first: layerId, last: layerId};
    return {layerId, band, bandIndex: isBase ? -1 : 0, events: ring.events, perimeter: ring.perimeter, renderMoves, assignments: sectors};
  });

  const path: Toolpath = {...baseline, moves, lengthMm, depositedLengthMm, durationS: time, layerEndTimes};
  const bands = mode === 'annual'
    ? [
        {id: 'Solid base', score: 0, behavior: 'stable' as const, first: 1, last: MONTHLY_FORM.bottomLayers},
        ...annualItems.map(item => ({id: item.id, score: item.score, behavior: scoreParams(item.score, config).behavior, first: item.first, last: item.last})),
      ]
    : [
        {id: 'Solid base', score: 0, behavior: 'stable' as const, first: 1, last: MONTHLY_FORM.bottomLayers},
        ...data.ribs.map(rib => ({id: rib.label, score: rib.items.length ? rib.items.reduce((s, i) => s + i.score, 0) / rib.items.length : 0, behavior: 'stable' as const, first: 4, last: MONTHLY_FORM.layerCount})),
      ];
  void scorePlans;
  return {data, bands, layers, rings, path, mode};
}

export type MonthlyPlan = ReturnType<typeof mapMonthlyVase>;
