import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import type { LabSnapshot } from "./depositionLab";

type Surface = { renderer: THREE.WebGLRenderer; scene: THREE.Scene; camera: THREE.PerspectiveCamera;
  controls: OrbitControls; geometry: THREE.BufferGeometry; nozzle: THREE.Mesh; line: THREE.Line;
  snapshot?: LabSnapshot };

export function LabSurface({ snapshot }: { snapshot: LabSnapshot }) {
  const host = useRef<HTMLDivElement>(null);
  const world = useRef<Surface | null>(null);
  const latest = useRef(snapshot);
  latest.current = snapshot;
  const [error, setError] = useState(false);

  useEffect(() => {
    if (!host.current) return;
    const container = host.current;
    let renderer: THREE.WebGLRenderer;
    try { renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true }); }
    catch { setError(true); return; }
    renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    container.appendChild(renderer.domElement);
    const scene = new THREE.Scene();
    scene.background = new THREE.Color("#e8e9e4");
    const camera = new THREE.PerspectiveCamera(35, 1, 0.1, 250);
    camera.position.set(42, 43, 61);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.target.set(0, 2, 0); controls.enableDamping = true;
    controls.minDistance = 20; controls.maxDistance = 150;
    controls.maxPolarAngle = Math.PI / 2 - 0.03;
    scene.add(new THREE.HemisphereLight("#ffffff", "#96958e", 1.5));
    const light = new THREE.DirectionalLight("#fffaf2", 2.6);
    light.position.set(-25, 45, 16); light.castShadow = true;
    light.shadow.mapSize.set(1024, 1024);
    Object.assign(light.shadow.camera, { left: -40, right: 40, top: 35, bottom: -35, far: 120 });
    light.shadow.normalBias = 0.03; scene.add(light);
    const board = new THREE.Mesh(new THREE.BoxGeometry(62, 1, 30), new THREE.MeshStandardMaterial({ color: "#c8cbc4", roughness: 0.9 }));
    board.position.y = -0.52; board.receiveShadow = true; scene.add(board);
    const geometry = new THREE.BufferGeometry();
    const clay = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ color: "#9d9283", roughness: 0.72, metalness: 0, side: THREE.DoubleSide }));
    clay.castShadow = true; clay.receiveShadow = true; scene.add(clay);
    const nozzle = new THREE.Mesh(new THREE.CylinderGeometry(3.4, 3, 4, 32, 1, true), new THREE.MeshStandardMaterial({ color: "#565e5b", metalness: 0.6, roughness: 0.4, transparent: true, opacity: 0.7, side: THREE.DoubleSide }));
    scene.add(nozzle);
    const line = new THREE.Line(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: "#2a78d6" }));
    scene.add(line);
    const state: Surface = { renderer, scene, camera, controls, geometry, nozzle, line };
    world.current = state;
    const resize = new ResizeObserver(() => {
      const { width, height } = container.getBoundingClientRect();
      renderer.setSize(width, height); camera.aspect = width / height; camera.updateProjectionMatrix();
    });
    resize.observe(container);
    let frame = 0;
    const render = () => {
      if (state.snapshot !== latest.current) {
        updateSurface(state, latest.current);
        state.snapshot = latest.current;
      }
      controls.update(); renderer.render(scene, camera);
      frame = requestAnimationFrame(render);
    };
    render();
    return () => {
      cancelAnimationFrame(frame); resize.disconnect(); controls.dispose();
      scene.traverse((object) => {
        if (object instanceof THREE.Mesh || object instanceof THREE.Line) {
          object.geometry.dispose();
          for (const material of Array.isArray(object.material) ? object.material : [object.material]) material.dispose();
        }
      });
      renderer.dispose(); renderer.forceContextLoss(); renderer.domElement.remove(); world.current = null;
    };
  }, []);

  return <div className="lab-surface" ref={host} aria-label="Rotatable deposition sample">
    {error && <p role="alert">WebGL is unavailable. Numerical results and cross-section data remain available below.</p>}
  </div>;
}

function updateSurface(world: Surface, snapshot: LabSnapshot) {
  const { nx, nz, height, config, nozzle } = snapshot;
  const positions = new Float32Array(nx * nz * 3);
  const indices: number[] = [];
  const d = config.cellMm;
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
    const index = j * nx + i;
    positions[index * 3] = (i + 0.5) * d - nx * d / 2;
    positions[index * 3 + 1] = height[index];
    positions[index * 3 + 2] = (j + 0.5) * d - nz * d / 2;
    if (i + 1 < nx && j + 1 < nz) {
      const b = index + 1, c = index + nx, e = c + 1;
      // Crop dry cells without connecting across missing material. Heights are
      // shown directly; no smooth union adds material between layers or gaps.
      if (Math.max(height[index], height[b], height[c], height[e]) > 0.005)
        indices.push(index, c, b, b, c, e);
    }
  }
  world.geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  world.geometry.setIndex(indices); world.geometry.computeVertexNormals(); world.geometry.computeBoundingSphere();
  world.nozzle.visible = nozzle.depositing;
  world.nozzle.position.set(nozzle.x, nozzle.y + 2, nozzle.z);
  const points = Array.from({ length: nz }, (_, j) => new THREE.Vector3(0,
    height[j * nx + Math.floor(nx / 2)] + 0.04, (j + 0.5) * d - nz * d / 2));
  world.line.geometry.dispose(); world.line.geometry = new THREE.BufferGeometry().setFromPoints(points);
  world.renderer.domElement.dataset.tick = String(snapshot.tick);
  world.renderer.domElement.dataset.triangles = String(indices.length / 3);
}
