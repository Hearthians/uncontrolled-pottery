import {defaultConfig, FOLD_DEFAULTS, scoreParams, validateConfig} from './behaviourConfig.ts';
import {FORM, PRINT} from './config.ts';
import {generateGeometry, twistAt} from './geometry.ts';
import {contactZ, foldFrames, settleFold} from './sagFold.ts';
import {DEFAULT_COHERENCE, registrationFrames, siteStrength, staggeredCourse} from './materialPattern.ts';
import {generateToolpath as makeToolpath} from './toolpath.ts';
import type {BeadFrame, Move, Toolpath, XYZ} from './toolpath.ts';
import defaults from './annualBehaviors.json' with {type: 'json'};
import {quantileSample, readMonthlyDataset} from './monthlyMapping.ts';
import type {MonthlyItem, MonthlyVessel, Behavior} from './monthlyMapping.ts';

export const STACKED_BOTTOM = 3;
export const LAYERS_PER_MONTH = 10;
export const STACKED_FULL_LAYERS = STACKED_BOTTOM + 12 * LAYERS_PER_MONTH;
export const MONTH_LABELS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'] as const;

export type MonthBand = {
  month: number;
  label: string;
  first: number;
  last: number;
  articleCount: number;
  empty: boolean;
  mean: number;
  median: number;
  min: number;
  max: number;
  meanBehavior: Behavior;
  items: MonthlyItem[];
  layerItems: {id: string; score: number; date?: string; first: number; last: number}[];
};

type Effective = ReturnType<typeof scoreParams> & {score: number};
type Event = {start: number; end: number; site: number; cell: number};
type Sample = {at: number; command: XYZ; clay: XYZ; width: number};
type Ring = {
  samples: Sample[]; moves: Move[]; events: Event[]; cellCount: number; perimeter: number;
  shiftMm: number; shiftUnverified: boolean; relief: boolean; key: string; printStart: number;
  replacements: ({firstMove: number; moveCount: number} & ReturnType<typeof settleFold>)[];
};
type Previous = {rings: Ring[]; layers: {renderMoves: Move[]}[]};
type Sources = ReturnType<typeof makeSources>;

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

export function stackedForm(layerCount: number) {
  // Always use the 123 mm full-year envelope so 2026 (113 layers, capped at
  // November) is shorter in the same camera frame, with November at the same
  // physical height as November in a complete year.
  return {
    ...FORM,
    version: `fixed-twist-2-stacked-${layerCount}`,
    heightMm: STACKED_FULL_LAYERS,
    layerCount,
    layerHeightMm: 1,
    bottomLayers: STACKED_BOTTOM,
  };
}

export function observedMonths(year: number, observedThrough: string | null) {
  const months: number[] = [];
  for (let month = 1; month <= 12; month++) {
    const start = `${year}-${String(month).padStart(2, '0')}-01`;
    if (observedThrough && start > observedThrough) break;
    months.push(month);
  }
  return months;
}

export function stackedLayerCount(monthCount: number) {
  return STACKED_BOTTOM + monthCount * LAYERS_PER_MONTH;
}

export function frameForLayers(layerCount: number) {
  const height = layerCount * 0.1;
  return {cameraY: height * 1.12 + 2.2, targetY: height / 2, span: height + 4.8};
}

function median(values: number[]) {
  const ordered = [...values].sort((a, b) => a - b);
  const mid = Math.floor(ordered.length / 2);
  return ordered.length % 2 ? ordered[mid] : (ordered[mid - 1] + ordered[mid]) / 2;
}

export function planMonthBands(data: MonthlyVessel, observedThrough: string | null, config: ReturnType<typeof validateConfig>): MonthBand[] {
  const months = observedMonths(data.year, observedThrough);
  return months.map((month, index) => {
    const rib = data.ribs[month - 1];
    const items = [...rib.items].sort((a, b) => a.score - b.score || (a.id < b.id ? -1 : 1));
    const first = STACKED_BOTTOM + index * LAYERS_PER_MONTH + 1;
    const last = STACKED_BOTTOM + (index + 1) * LAYERS_PER_MONTH;
    const scores = items.map(item => item.score);
    const mean = scores.length ? scores.reduce((sum, value) => sum + value, 0) / scores.length : 0;
    const layerItems = items.length ? quantileSample(items, LAYERS_PER_MONTH).map((item, itemIndex, sampled) => ({
      id: item.id,
      score: item.score,
      date: item.date,
      first: first + Math.floor(itemIndex * LAYERS_PER_MONTH / sampled.length),
      last: first + Math.floor((itemIndex + 1) * LAYERS_PER_MONTH / sampled.length) - 1,
    })) : [];
    return {
      month,
      label: rib.label || MONTH_LABELS[month - 1],
      first,
      last,
      articleCount: items.length,
      empty: items.length === 0,
      mean,
      median: scores.length ? median(scores) : 0,
      min: scores.length ? Math.min(...scores) : 0,
      max: scores.length ? Math.max(...scores) : 0,
      meanBehavior: scoreParams(mean, config).behavior,
      items,
      layerItems,
    };
  });
}

function itemForLayer(bands: MonthBand[], layerId: number): {id: string; score: number; band: MonthBand} | {id: 'Solid base'; score: 0; band: null} | {id: string; score: 0; band: MonthBand} {
  if (layerId <= STACKED_BOTTOM) return {id: 'Solid base', score: 0, band: null};
  const band = bands.find(item => layerId >= item.first && layerId <= item.last);
  if (!band) return {id: 'Solid base', score: 0, band: null};
  if (band.empty) return {id: `${band.label} (empty)`, score: 0, band};
  const item = band.layerItems.find(entry => layerId >= entry.first && layerId <= entry.last);
  return {id: item?.id ?? `${band.label}`, score: item?.score ?? 0, band};
}

function makeSources(layerCount: number) {
  const form = stackedForm(layerCount);
  const geometry = generateGeometry(form);
  const baseline = makeToolpath(geometry);
  const contours = baseline.geometry.contours;
  const templates = contours.map(() => [] as Move[]);
  for (const move of baseline.moves) templates[move.layerId - 1].push(move);
  const sources = contours.map((contour, index) => {
    const moves = templates[index].filter(move => move.kind === 'deposition'), arc = [0];
    for (const move of moves) arc.push(arc.at(-1)! + move.lengthMm);
    return {moves, arc, perimeter: arc.at(-1)!, points: contour.points};
  });
  return {form, baseline, contours, templates, sources};
}

const setups = new Map<number, Sources>();
function setup(layerCount: number) {
  let stored = setups.get(layerCount);
  if (!stored) {
    stored = makeSources(layerCount);
    setups.set(layerCount, stored);
  }
  return stored;
}

function buildRing(
  index: number,
  sources: Sources,
  params: Effective,
  phase: number,
  seed: number,
  history: Ring[],
  maxDrop: number,
  key: string,
  slack: number,
  variation: number,
  coherence: number,
  edge: number,
): Ring {
  const {sources: rings, form} = sources;
  const {perimeter, arc, points, moves: base} = rings[index];
  const {behavior, eventCount, coverage, amplitude} = params;
  const events: Event[] = [], cuts: number[] = [];
  const active = behavior !== 'stable' && eventCount > 0 && coverage > 0 && amplitude > (behavior === 'buldges' ? 1 : 0);
  const pitch = active ? perimeter / eventCount : 0;
  const bond = staggeredCourse(index, params.score, coverage, seed, coherence);
  const strengths: number[] = [];
  const wrap = (value: number) => ((value % perimeter) + perimeter) % perimeter;
  const subdivisions = behavior === 'gaps' ? 1 : behavior === 'sagging' ? 32 : 12;
  const twistVertex = twistAt(rings[bond.firstLayer].points[0][2], form) / (2 * Math.PI) * (points.length - 1), left = Math.floor(twistVertex);
  const twistArc = arc[left] + (twistVertex - left) * (arc[left + 1] - arc[left]);
  if (active) for (let site = 0; site < eventCount; site++) {
    const weight = siteStrength(site, eventCount, index, seed, coherence, variation);
    const window = pitch * coverage / 100;
    const width = behavior === 'gaps'
      ? Math.min(window, (1.4 + 1.6 * bond.within) * PRINT.beadWidthMm) * amplitude * edge * (0.78 + 0.22 * weight)
      : window;
    if (width / subdivisions <= 1e-8) continue;
    const centre = wrap((site + bond.centre) * pitch + twistArc + ((phase + seed - 42) % 360) / 360 * perimeter);
    const start = wrap(centre - width / 2);
    events.push({start, end: start + width, site: site + 1, cell: site * bond.cells + bond.lane + 1});
    const emphasis = behavior === 'sagging' ? weight ** (eventCount > 6 ? 2 : 1.5) : 0.65 + 0.35 * weight;
    strengths.push(edge * emphasis);
    for (let part = 0; part <= subdivisions; part++) cuts.push(wrap(start + width * part / subdivisions));
  }
  function eventAt(value: number) {
    return events.findIndex(event => {
      const along = wrap(value - event.start);
      return along > 1e-9 && along < event.end - event.start - 1e-9;
    });
  }
  for (const value of arc) {
    if (behavior !== 'sagging' || value === 0 || value === perimeter || eventAt(value) < 0) cuts.push(value);
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
  const directions = behavior === 'misalignment' ? events.map(({start, end, site}) => {
    const centre = wrap((start + end) / 2), i = interval(arc.length, j => arc[j], centre);
    const p = blend(points[i], points[i + 1], (centre - arc[i]) / (arc[i + 1] - arc[i]));
    const angle = Math.atan2(p[1], p[0]) + 0.83 + (site % 2 ? 0 : Math.PI);
    return [Math.cos(angle), Math.sin(angle)] as [number, number];
  }) : [];
  const shifted = (point: XYZ, u: number, amount: number, slot: number): XYZ => {
    const shoulder = Math.min(1, 4 * Math.min(u, 1 - u));
    const step = amount * shoulder;
    return [point[0] + directions[slot][0] * step, point[1] + directions[slot][1] * step, point[2]];
  };
  let shiftUnverified = false;
  const backed = (p: XYZ) => p[2] - contactZ(p, history, PRINT.beadHeightMm) <= 0.22 * PRINT.beadHeightMm;
  const releases = bond.releases || edge < 1;
  const nextCourse = behavior === 'misalignment' && index + 1 < rings.length ? rings.slice(0, index + 2) : null;
  const shifts = behavior === 'misalignment' ? events.map((event, slot) => {
    const span = contour.filter(s => s.slot === slot);
    const wanted = Math.min(amplitude * strengths[slot], 0.16 * (event.end - event.start));
    const supported = (amount: number) => span.every(s => {
      const p = shifted(s.point, s.u, amount, slot);
      if (!backed(p)) return false;
      if (!nextCourse) return true;
      const probe: XYZ = [p[0], p[1], p[2] + 2 * PRINT.beadHeightMm];
      return probe[2] - contactZ(probe, nextCourse, PRINT.beadHeightMm) <= (releases ? 0.18 : 0.26) * PRINT.beadHeightMm;
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
  }) : [];
  const samples = contour.map(({pos, fraction, point, slot, u}) => {
    const sample: Sample = {at: pos + fraction, command: point, clay: point, width: PRINT.beadWidthMm};
    if (slot >= 0) {
      const event = events[slot];
      const pulse = Math.sin(Math.PI * u) ** 2 * strengths[slot];
      if (behavior === 'buldges') {
        sample.width *= 1 + (amplitude - 1) * strengths[slot] * Math.sin(Math.PI * u) ** 1.5;
        sample.clay = outward(point, 0.37 * (sample.width - PRINT.beadWidthMm));
      }
      if (behavior === 'misalignment') sample.command = sample.clay = shifted(point, u, shifts[slot], slot);
      if (behavior === 'sagging') sample.command = sample.clay = outward(point, Math.min(amplitude, (0.24 + 0.08 * amplitude / 6.5) * (event.end - event.start)) * pulse);
    }
    if (behavior === 'misalignment' && slot < 0 && !backed(point)) shiftUnverified = true;
    const lower = history[index - 1];
    if (lower?.relief && (behavior !== 'sagging' || (slot < 0 && maxDrop > 0 && slack > 0))) {
      const below = interval(lower.samples.length, i => lower.samples[i].at, sample.at);
      const previous = lower.moves[below], a = lower.samples[below], b = lower.samples[below + 1];
      const t = (sample.at - a.at) / (b.at - a.at);
      const inherited = a.command[2] - a.clay[2] + t * ((b.command[2] - b.clay[2]) - (a.command[2] - a.clay[2]));
      let reach = 0.62 * inherited;
      if (!previous.extrude) {
        const gap = lower.events[previous.eventId! - 1];
        if (gap) {
          const lowerArc = rings[index - 1].arc;
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
  if (behavior === 'sagging' || behavior === 'misalignment') events.forEach((event, slot) => {
    const firstMove = boundary(event.start), moveCount = (boundary(event.end) - firstMove + count) % count;
    const indices = Array.from({length: moveCount + 1}, (_, step) => (firstMove + step) % count);
    const progress = indices.map((idx, step) => step === 0 ? 0 : step === moveCount ? 1 : wrap(positions[idx] - event.start) / (event.end - event.start));
    const vertices = indices.map(idx => samples[idx]);
    if (behavior === 'sagging') {
      const anchored = (point: XYZ) => point[2] - contactZ(point, history, PRINT.beadHeightMm) <= 0.25 * PRINT.beadHeightMm;
      const anchors = [anchored(vertices[0].command), anchored(vertices.at(-1)!.command)] as const;
      const material = settleFold(vertices, progress, history, amplitude / 6.5 * strengths[slot], slack * (0.45 + 0.55 * bond.within), maxDrop, anchors);
      replacements.push({firstMove, moveCount, ...material});
    } else if (!shifts[slot]) return;
    const path = vertices.map(v => v.clay);
    const section = behavior === 'sagging' ? foldFrames(path, progress) : registrationFrames(path, PRINT.beadWidthMm);
    indices.slice(0, -1).forEach((idx, step) => frames.set(idx, [section[step], section[step + 1]]));
  });
  if (active || history[index - 1]?.relief) samples[count] = {...samples[0], at: points.length - 1};
  const moves = positions.slice(0, -1).map((value, idx) => {
    const start = samples[idx], end = samples[idx + 1], original = base[Math.min(base.length - 1, Math.floor((start.at + end.at) / 2))];
    const slot = eventAt((value + positions[idx + 1]) / 2);
    const missing = behavior === 'gaps' && slot >= 0;
    if (behavior !== 'sagging' && slot < 0 && start.command === original.beadStart && end.command === original.beadEnd && start.clay === start.command && end.clay === end.command && start.width === PRINT.beadWidthMm && end.width === start.width) return original;
    return {
      ...original, start: tip(start.command), end: tip(end.command), beadStart: start.clay, beadEnd: end.clay,
      lengthMm: distance(start.command, end.command), extrude: !missing, beadWidthMm: missing ? 0 : start.width, beadEndWidthMm: missing ? 0 : end.width,
      ...(behavior === 'buldges' && slot >= 0 ? {flowMultiplier: (start.width + end.width) / (2 * PRINT.beadWidthMm)} : {}),
      ...(behavior === 'sagging' && slot >= 0 ? {flowMultiplier: replacements[slot].budget / replacements[slot].nozzleLength} : {}),
      ...(frames.has(idx) ? {beadFrames: frames.get(idx)} : {}),
      sourceType: slot >= 0 ? behavior : 'stable' as const, eventId: slot >= 0 ? slot + 1 : null,
    };
  });
  const wrapped = replacements.find(span => span.firstMove + span.moveCount > moves.length);
  const printStart = wrapped ? (wrapped.firstMove + moves.length - 1) % moves.length : 0;
  const relief = moves.some(move => !move.extrude || move.end[2] - PRINT.nozzleAboveBeadCentreMm - move.beadEnd[2] > 0.025);
  return {samples, moves, events, cellCount: (behavior === 'stable' ? 4 : eventCount) * bond.cells, perimeter, key, replacements, printStart, relief, shiftMm: Math.max(0, ...shifts, 0), shiftUnverified};
}

const initialConfig = defaultConfig();

export function mapStackedVase(input: unknown, observedThrough: string | null, tuning: unknown = initialConfig, previous?: Previous) {
  const data = readMonthlyDataset(input);
  const config = tuning && typeof tuning === 'object' && 'schemaVersion' in tuning ? validateConfig(tuning) : defaultConfig(tuning as typeof defaults);
  const bands = planMonthBands(data, observedThrough, config);
  const layerCount = stackedLayerCount(bands.length);
  const kit = setup(layerCount);
  const {baseline, contours, templates, sources} = kit;
  const {slack = FOLD_DEFAULTS.slack, variation = FOLD_DEFAULTS.variation} = config.patternSettings.sagging;
  const coherence = config.simulationSettings.coherenceLayers ?? DEFAULT_COHERENCE;

  const assignments = contours.map(({layerId}) => {
    const item = itemForLayer(bands, layerId);
    const params = {...scoreParams(item.score, config), score: item.score};
    return {layerId, item, params};
  });
  const changes = assignments.slice(1).flatMap((row, i) => row.params.behavior !== assignments[i].params.behavior || row.params.eventCount !== assignments[i].params.eventCount ? [row.layerId - 0.5] : []);

  const rings: Ring[] = [], moves: Move[] = [], layerEndTimes: number[] = [];
  let time = 0, lengthMm = 0, depositedLengthMm = 0, dirtyBelow = false, boundaryIndex = 0;

  const layers = assignments.map((row, index) => {
    const {layerId, item, params} = row;
    const isBase = layerId <= STACKED_BOTTOM;
    const phase = params.behavior === 'stable' ? 0 : config.patternSettings[params.behavior].phase;
    if (layerId > (changes[boundaryIndex] ?? Infinity)) boundaryIndex++;
    const proximity = Math.min(layerId - (changes[boundaryIndex - 1] ?? -Infinity), (changes[boundaryIndex] ?? Infinity) - layerId);
    const edge = smooth(Math.min(1, proximity / 3));
    const key = params.behavior === 'stable'
      ? 'stable/' + params.score
      : [params.behavior, params.eventCount, params.coverage, params.amplitude, params.score, phase, config.seed, coherence, edge, params.behavior === 'sagging' ? [config.simulationSettings.maxDropMm, slack, variation].join(':') : 0].join('/');
    const prev = previous && !dirtyBelow ? previous.rings[index] : undefined;
    const ring = prev && prev.key === key ? prev : buildRing(
      index, kit, params, phase, config.seed, rings, config.simulationSettings.maxDropMm, key, slack, variation, coherence, edge,
    );
    dirtyBelow ||= ring !== prev && !isBase;
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
    let renderMoves: Move[] = [relocate ? {...join, kind: 'travel' as const, extrude: false, feedrateMmMin: PRINT.travelFeedrateMmMin} : join, ...ordered];
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
    const band = isBase
      ? {id: 'Solid base', score: 0, behavior: 'stable' as const, first: 1, last: STACKED_BOTTOM}
      : {id: item.id, score: item.score, behavior: params.behavior, first: item.band?.first ?? layerId, last: item.band?.last ?? layerId, month: item.band?.month};
    return {layerId, band, bandIndex: isBase ? -1 : (item.band ? bands.indexOf(item.band) : 0), events: ring.events, perimeter: ring.perimeter, renderMoves, month: item.band?.month ?? null};
  });

  const path: Toolpath = {...baseline, moves, lengthMm, depositedLengthMm, durationS: time, layerEndTimes};
  void sources;
  return {data, months: bands, layers, rings, path, layerCount, bottomLayers: STACKED_BOTTOM};
}

export type StackedPlan = ReturnType<typeof mapStackedVase>;
