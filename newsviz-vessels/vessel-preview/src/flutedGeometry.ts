import * as THREE from 'three';
import {FLUTED_FORM, fluteRelief, mix, smooth} from './flutedMapping.ts';
import type {FluteMonth} from './flutedMapping.ts';

const {height, bottom, flutes, segmentsPerFlute} = FLUTED_FORM;
const around = flutes * segmentsPerFlute;
const cycle = 2 * Math.PI;
const thickness = 2.45;

type Ring = {mm: number; inside: number; round: number};
export type FluteHit = {month: number; mm: number} | 'base';

function outline(mm: number) {
  const u = mm / height;
  return {
    radius: 23.2 + 13.2 * smooth(u) + 2.7 * smooth(Math.max(0, (u - .79) / .21)),
    depth: 1.65 + 6.95 * smooth(Math.min(1, u * 1.27)),
    twist: .69 * (.14 * u + .86 * u ** 1.28),
    ruffle: 1.25 * smooth(Math.max(0, (u - .67) / .33)),
    foot: smooth(Math.min(1, mm / 8)),
  };
}

export function flutedGeometry(months: FluteMonth[]) {
  const outsideSteps = height * 4;
  const insideSteps = (height - bottom) * 3;
  const rings: Ring[] = [
    ...Array.from({length: outsideSteps + 1}, (_, i) => ({mm: i / 4, inside: 0, round: 0})),
    ...[.25, .5, .75].map(t => ({mm: height, inside: t, round: .98 * Math.sin(Math.PI * t)})),
    ...Array.from({length: insideSteps + 1}, (_, i) => ({mm: height - i / 3, inside: 1, round: 0})),
  ];
  const vertexCount = rings.length * around + 2;
  const positions = new Float32Array(vertexCount * 3);
  const colors = new Float32Array(positions.length);
  const indices = new Uint32Array((rings.length - 1) * around * 6 + around * 6);

  function vertex(i: number, x: number, y: number, z: number, shade: number, tint = 0) {
    positions.set([x * .1, y * .1, z * .1], i * 3);
    colors.set([shade, shade * (1 + tint * .22), shade * (1 + tint * .38)], i * 3);
  }

  rings.forEach(({mm, inside, round}, row) => {
    const shape = outline(mm);
    const heightFraction = Math.max(0, (mm - bottom) / (height - bottom));
    const bead = .5 - .5 * Math.cos(cycle * mm);
    for (let segment = 0; segment < around; segment++) {
      const month = Math.floor(segment / segmentsPerFlute);
      const across = segment % segmentsPerFlute / segmentsPerFlute - .5;
      const wave = Math.cos(cycle * across);
      const pleat = wave + .12 * (1 - wave * wave);
      const relief = fluteRelief(months[month], heightFraction, across);
      const radius = shape.radius + shape.depth * (pleat - 1.17 * relief.unfinished * shape.foot)
        + shape.foot * relief.radial + (bead - .5) * mix(.38, .31, inside)
          * (1 - .53 * relief.neck * shape.foot - .44 * relief.unfinished * shape.foot)
        - (thickness - .61 * relief.neck * shape.foot) * inside - .65 * (1 - shape.foot);
      const angle = (month + across) / flutes * cycle + shape.twist + shape.foot * relief.shift;
      const lift = shape.ruffle * (wave - .9 * relief.unfinished);
      const z = mm + lift - relief.drop * shape.foot + round;
      const valley = (.5 - .5 * wave) ** 1.55;
      const cavity = mix(.52, .96, heightFraction ** 5);
      const grain = 1 + .021 * Math.sin(43.7 * angle + .89 * mm) * Math.sin(12.3 * angle - 1.19 * mm);
      const shade = (1 - .42 * valley) * mix(1, cavity, inside) * (.94 + .06 * bead)
        * (1 - .12 * relief.neck * shape.foot) * grain;
      vertex(row * around + segment, radius * Math.sin(angle), z, radius * Math.cos(angle), shade,
        relief.unfinished * .43 * shape.foot);
    }
  });

  // Connect around the complete perimeter, then close the underside and inside floor.
  let at = 0;
  for (let row = 0; row < rings.length - 1; row++) {
    for (let j = 0; j < around; j++) {
      const next = (j + 1) % around;
      const a = row * around + j, b = row * around + next;
      indices.set([a, b, a + around, b, b + around, a + around], at);
      at += 6;
    }
  }
  const underside = vertexCount - 2, floor = vertexCount - 1;
  const innerRing = (rings.length - 1) * around;
  vertex(underside, 0, 0, 0, .82);
  vertex(floor, 0, bottom, 0, .51);
  for (let j = 0; j < around; j++) {
    const next = (j + 1) % around;
    indices.set([underside, next, j, floor, innerRing + j, innerRing + next], at);
    at += 6;
  }

  const mesh = new THREE.BufferGeometry();
  mesh.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  mesh.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  mesh.setIndex(new THREE.BufferAttribute(indices, 1));
  mesh.computeVertexNormals();
  mesh.computeBoundingSphere();

  function locate(face: number): FluteHit {
    const strip = Math.floor(face / (around * 2));
    if (strip >= rings.length - 1) return 'base';
    const mm = (rings[strip].mm + rings[strip + 1].mm) / 2;
    if (mm < bottom) return 'base';
    return {month: Math.floor(face % (around * 2) / (2 * segmentsPerFlute)) + 1, mm};
  }

  return {mesh, locate};
}
