import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {test} from 'node:test';
import {flutedGeometry} from '../src/flutedGeometry.ts';
import {FLUTED_FORM, fluteDayAt, fluteRelief, mapFlutedVase} from '../src/flutedMapping.ts';

function pack(year) {
  return JSON.parse(readFileSync(new URL(`../../data/vessels-monthly/years/${year}.json`, import.meta.url)));
}

test('calendar scores use the five frozen bins and preserve missing observations', () => {
  const original = pack(2026);
  const vessel = structuredClone(original.vessels.valence);
  const scores = [.19, .20, .40, .60, .80, 1];
  vessel.ribs[0].items = scores.map((score, i) =>
    ({id: String(i), score, date: `2026-01-0${i + 1}`}));
  vessel.ribs[0].items.push({id: 'mean-a', date: '2026-01-07', score: .20},
    {id: 'mean-b', date: '2026-01-07', score: .40});
  const months = mapFlutedVase(vessel, original.observedThrough);
  assert.deepEqual(months[0].days.slice(0, 6).map(day => day.rule.behavior),
    ['stable', 'gaps', 'buldges', 'misalignment', 'sagging', 'sagging']);
  assert.ok(Math.abs(months[0].days[6].score - .30) < 1e-10);
  assert.equal(fluteDayAt(months[0], 3.1).date, '2026-01-01');
  assert.equal(fluteDayAt(months[0], 120).date, '2026-01-31');
  assert.equal(months[10].days[26].date, original.observedThrough);
  assert.equal(months[10].days[27].state, 'unobserved');
  assert.equal(months[11].state, 'unobserved');
  assert.ok(months[11].days.every(day => day.score === null && day.items.length === 0));
  assert.equal(fluteRelief(months[11], .8, 0).unfinished, 1);
  assert.equal(fluteRelief(months[11], .8, -.5).unfinished, 0);

  const early = pack(2005);
  const january = mapFlutedVase(early.vessels.valence, early.observedThrough)[0];
  assert.equal(january.state, 'empty');
  assert.ok(january.days.every(day => day.score === null));
  assert.equal(fluteRelief(january, .8, 0).unfinished, 0);
});

test('the pleated clay surface is one consistently wound closed shell with inspectable flutes', () => {
  const data = pack(2026);
  const {mesh, locate} = flutedGeometry(mapFlutedVase(data.vessels.valence, data.observedThrough));
  const indices = mesh.index.array;
  const positions = mesh.getAttribute('position');
  const vertices = positions.count;
  mesh.computeBoundingBox();
  assert.equal(mesh.boundingBox.min.y, 0);
  assert.ok(mesh.boundingBox.max.y > 12 && mesh.boundingBox.max.y < 12.5);
  assert.ok(mesh.boundingBox.max.x - mesh.boundingBox.min.x > 8);
  const edges = new Map();
  for (let i = 0; i < indices.length; i += 3) {
    for (let j = 0; j < 3; j++) {
      const a = indices[i + j], b = indices[i + (j + 1) % 3];
      assert.notEqual(a, b);
      const key = Math.min(a, b) * vertices + Math.max(a, b);
      const direction = a < b ? 1 : -1;
      const existing = edges.get(key);
      if (existing == null) edges.set(key, direction);
      else {
        assert.equal(existing, -direction, 'an edge should have exactly two oppositely wound faces');
        edges.set(key, 0);
      }
    }
  }
  assert.ok([...edges.values()].every(n => n === 0));
  assert.equal(vertices - edges.size + indices.length / 3, 2);
  assert.equal(locate(0), 'base');
  assert.equal(locate(indices.length / 3 - 1), 'base');
  const fluteFaces = FLUTED_FORM.segmentsPerFlute * 2;
  const midWall = FLUTED_FORM.flutes * fluteFaces * (FLUTED_FORM.height * 2);
  assert.equal(locate(midWall).month, 1);
  assert.equal(locate(midWall + 11 * fluteFaces).month, 12);
  mesh.dispose();
});
