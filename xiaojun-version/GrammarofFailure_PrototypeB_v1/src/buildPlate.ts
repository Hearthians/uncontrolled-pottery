import * as THREE from "three";
import { MACHINE } from "./machine.ts";

// Existing renderer convention: 1 scene unit = 10 mm, Y up; machine coordinates stay mm/Z up.
export const MM_TO_SCENE = .1;
export function createBuildPlate() {
  const group = new THREE.Group();
  group.name = "Machine build plate";
  const platformRadius = MACHINE.diameterMm / 2 * MM_TO_SCENE;
  const platform = new THREE.Mesh(
    new THREE.CylinderGeometry(platformRadius, platformRadius, 0.13, 96),
    new THREE.MeshStandardMaterial({
      color: "#d9d2c6",
      roughness: 1,
      metalness: 0,
    }),
  );
  platform.name = "Build plate surface";
  platform.position.y = -0.065;
  platform.receiveShadow = true;
  platform.castShadow = true;
  group.add(platform);
  const rim = new THREE.Mesh(
    new THREE.CylinderGeometry(platformRadius - 0.02, platformRadius - 0.07, 0.06, 96),
    new THREE.MeshStandardMaterial({
      color: "#777e77",
      roughness: 0.7,
      metalness: 0.35,
    }),
  );
  rim.position.y = -0.18;
  group.add(rim);
  [platformRadius - 0.4, platformRadius - 0.22, platformRadius - 0.09].forEach((radius) => {
    const points = Array.from(
      { length: 129 },
      (_, i) =>
        new THREE.Vector3(
          Math.cos((i / 128) * Math.PI * 2) * radius,
          -0.017,
          Math.sin((i / 128) * Math.PI * 2) * radius,
        ),
    );
    const ring = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints(points),
      new THREE.LineBasicMaterial({
        color: "#a4aaa0",
        transparent: true,
        opacity: 0.5,
      }),
    );
    group.add(ring);
  });
  return group;
}
