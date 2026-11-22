import * as THREE from "three";
import type { ScorePoint } from "./scoreStudyCore.ts";

/** Connected elliptical strands, with rounded ends only at actual interruptions. */
export function scoreTubeGeometry(points: readonly ScorePoint[], sides = 12) {
  const positions: number[] = [], normals: number[] = [], indices: number[] = [];
  const frameAt = (index: number) => {
    const p = points[index];
    const before = index > 0 && !p.breakBefore && !points[index - 1].gap ? points[index - 1] : p;
    const after = index + 1 < points.length && !points[index + 1].breakBefore && !points[index + 1].gap ? points[index + 1] : p;
    const tangent = new THREE.Vector3(after.x - before.x, after.y - before.y, after.z - before.z);
    if (tangent.lengthSq() < 1e-12) tangent.set(-Math.sin(p.theta), 0, Math.cos(p.theta));
    tangent.normalize();
    const right = new THREE.Vector3(tangent.z, 0, -tangent.x).normalize();
    if (right.lengthSq() < 1e-12) right.set(Math.cos(p.theta), 0, Math.sin(p.theta));
    return { tangent, right, up: new THREE.Vector3().crossVectors(tangent, right).normalize() };
  };
  const ring = (p: ScorePoint, frame: ReturnType<typeof frameAt>, scale: number, lift = 0, end = 0) => {
    const begin = positions.length / 3;
    for (let side = 0; side < sides; side++) {
      const theta = side / sides * Math.PI * 2, c = Math.cos(theta), s = Math.sin(theta);
      const radial = frame.right.clone().multiplyScalar(c * p.width).addScaledVector(frame.up, s * p.height);
      const position = radial.multiplyScalar(scale).addScaledVector(frame.tangent, lift);
      positions.push(p.x + position.x, p.y + position.y, p.z + position.z);
      const normal = frame.right.clone().multiplyScalar(c / p.width).addScaledVector(frame.up, s / p.height)
        .multiplyScalar(scale).addScaledVector(frame.tangent, end).normalize();
      normals.push(normal.x, normal.y, normal.z);
    }
    return begin;
  };
  const join = (a: number, b: number, reverse = false) => {
    for (let side = 0; side < sides; side++) {
      const aa = a + side, ab = a + (side + 1) % sides, ba = b + side, bb = b + (side + 1) % sides;
      if (reverse) indices.push(aa, ba, ab, ab, ba, bb);
      else indices.push(aa, ab, ba, ab, bb, ba);
    }
  };
  const cap = (p: ScorePoint, frame: ReturnType<typeof frameAt>, first: number, sign: number) => {
    let previous = first;
    const length = Math.min(p.width, p.height) * 0.65;
    for (let step = 1; step <= 3; step++) {
      const theta = step / 3 * Math.PI / 2;
      const current = ring(p, frame, Math.max(0.025, Math.cos(theta)), sign * length * Math.sin(theta), sign * Math.sin(theta));
      join(previous, current, sign < 0); previous = current;
    }
    const tip = positions.length / 3;
    positions.push(p.x + frame.tangent.x * sign * length, p.y + frame.tangent.y * sign * length, p.z + frame.tangent.z * sign * length);
    normals.push(frame.tangent.x * sign, frame.tangent.y * sign, frame.tangent.z * sign);
    for (let side = 0; side < sides; side++) {
      const a = previous + side, b = previous + (side + 1) % sides;
      if (sign > 0) indices.push(a, b, tip); else indices.push(b, a, tip);
    }
  };
  let previous = -1;
  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    if (p.gap) { previous = -1; continue; }
    const frame = frameAt(i), current = ring(p, frame, 1);
    if (previous >= 0 && !p.breakBefore) join(previous, current);
    else cap(p, frame, current, -1);
    if (i === points.length - 1 || points[i + 1].gap || points[i + 1].breakBefore) cap(p, frame, current, 1);
    previous = current;
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("normal", new THREE.Float32BufferAttribute(normals, 3));
  geometry.setIndex(indices); geometry.computeBoundingSphere();
  return geometry;
}
