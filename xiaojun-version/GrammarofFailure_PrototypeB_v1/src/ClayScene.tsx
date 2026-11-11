import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { beadBuffers, writeBead, hasDepositedMaterial, FLOATS_PER_MOVE, INDICES_PER_MOVE } from "./claySurface";
import { createClayMaterial, createLdmHead } from "./clayAppearance";
import { createBuildPlate, MM_TO_SCENE } from "./buildPlate";
import { MACHINE } from "./machine";
import { sampleToolpath } from "./toolpath";
import type { PathSample, Toolpath } from "./toolpath";
import type {ResiduePlan} from "./clayResidue";
import type {SupportResult} from "./support";

function outerRadiusMm(path: Toolpath) {
  return path.contours.reduce((radius, contour) => contour.points.reduce(
    (r, point) => Math.max(r, Math.hypot(point[0], point[1])), radius), 0);
}

type Framing = "vessel" | "plate";
type View = "perspective" | "front" | "top";
export interface SceneHandle {
  update: (sample: PathSample) => void;
  setView: (view: View) => void;
  capture: () => string;
}
type Props = { material?:ReturnType<typeof beadBuffers>; support?:SupportResult; residue?:ResiduePlan; framing: Framing; path: Toolpath; basePath: Toolpath; showBase: boolean; planned: boolean; autoRotate: boolean; onError: () => void };
type World = {
  residue?:ResiduePlan;
  support?:SupportResult;
  framing: Framing; resize: () => void;
  renderer: THREE.WebGLRenderer; scene: THREE.Scene; camera: THREE.OrthographicCamera;
  controls: OrbitControls; head: THREE.Group; ghost: THREE.Group;
  baseMesh: THREE.Mesh; showBase: boolean; planned: boolean; sample: PathSample;
  mesh: THREE.Mesh; partial: THREE.Mesh; indexBefore: Uint32Array;
  positions: Float32Array; normals: Float32Array; path: Toolpath;
};
function setView(w: World, view: View) {
  const h = w.path.parameters.heightMm / 10;
  const d = Math.max(h, MACHINE.diameterMm * MM_TO_SCENE) * 2 + 4;
  w.camera.up.set(0, 1, 0); w.controls.target.set(0, h / 2, 0);
  if (view === "top") { w.camera.position.set(0, d, 0); w.camera.up.set(0, 0, -1); }
  else if (view === "front") w.camera.position.set(0, h / 2, d);
  else w.camera.position.set(d * .7, h / 2 + d * .5, d * .8);
  w.camera.zoom = 1; w.camera.updateProjectionMatrix(); w.controls.update();
}
function showSample(w: World, sample: PathSample) {
  w.sample = sample;
  w.baseMesh.visible = w.showBase;
  w.mesh.visible = w.head.visible = !w.showBase;
  w.ghost.visible = w.planned && !w.showBase;
  const move = w.path.moves[sample.moveIndex];
  w.mesh.geometry.setDrawRange(0, w.indexBefore[sample.moveIndex]);
  w.partial.visible = !w.showBase && hasDepositedMaterial(move,w.support?.segments[sample.moveIndex]) && sample.fraction > 0;
  if (w.partial.visible) {
    writeBead(move, sample.fraction, w.positions, w.normals,0,w.residue?.[sample.moveIndex],w.support?.segments[sample.moveIndex]);
    w.partial.geometry.getAttribute("position").needsUpdate = true;
    w.partial.geometry.getAttribute("normal").needsUpdate = true;
  }
  const [x, y, z] = sample.position;
  // The visual outlet origin follows the commanded position exactly; no path offsets.
  w.head.position.set(x / 10, z / 10, -y / 10);
}
export const ClayScene = forwardRef<SceneHandle, Props>(function ClayScene(props, ref) {
  const container = useRef<HTMLDivElement>(null);
  const worldRef = useRef<World | null>(null);
  useImperativeHandle(ref, () => ({
    update(sample) { if (worldRef.current) showSample(worldRef.current, sample); },
    setView(view) { if (worldRef.current) setView(worldRef.current, view); },
    capture() {
      const w = worldRef.current; if (!w) return "";
      w.renderer.render(w.scene, w.camera); return w.renderer.domElement.toDataURL("image/png");
    },
  }), []);
  useEffect(() => {
    const host = container.current!;
    let renderer: THREE.WebGLRenderer;
    try { renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true }); }
    catch { props.onError(); return; }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
    // Editorial material view: no shadow-map pass or hard cast shadows.
    renderer.shadowMap.enabled = false;
    renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.05;
    host.appendChild(renderer.domElement);
    const scene = new THREE.Scene(); scene.background = new THREE.Color("#eee7dd");
    const camera = new THREE.OrthographicCamera(-4, 4, 3, -3, .01, 500);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true; controls.enablePan = false;
    controls.minZoom = .65; controls.maxZoom = 2.4;
    controls.minPolarAngle = 0; controls.maxPolarAngle = Math.PI / 2 - .03;
    controls.autoRotateSpeed = .55; controls.autoRotate = props.autoRotate;
      scene.add(new THREE.HemisphereLight("#fff7ed", "#c6b6a2", 2.5));
      const key = new THREE.DirectionalLight("#fff4e7", 1.6);
      key.position.set(-4, 7, 5);
      scene.add(key);
      const fill = new THREE.DirectionalLight("#edf0f2", 1.2);
      fill.position.set(3, 4, -4);
      scene.add(fill);

      const floor = new THREE.Mesh(
        new THREE.PlaneGeometry(200, 200),
        new THREE.MeshStandardMaterial({ color: "#eee7dd", roughness: 1 }),
      );
      floor.rotation.x = -Math.PI / 2;
      floor.position.y = -0.23;
      floor.receiveShadow = true;
      scene.add(floor);
      const grid = new THREE.GridHelper(70, 140, "#c2c5bc", "#c2c5bc");
      grid.position.y = -0.225;
      (grid.material as THREE.Material).transparent = true;
      (grid.material as THREE.Material).opacity = 0.035;
      scene.add(grid);

      scene.add(createBuildPlate());

    const data = props.material??beadBuffers(props.path,props.residue,props.support?.segments);
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(data.positions, 3));
    geometry.setAttribute("normal", new THREE.BufferAttribute(data.normals, 3));
    geometry.setIndex(new THREE.BufferAttribute(data.indices, 1)); geometry.setDrawRange(0, 0);
    const material = createClayMaterial();
    const mesh = new THREE.Mesh(geometry, material);
    // Precompute comparison once per configuration; toggling never replaces the live path.
    const baseData = beadBuffers(props.basePath);
    const baseGeometry = new THREE.BufferGeometry();
    baseGeometry.setAttribute("position", new THREE.BufferAttribute(baseData.positions, 3));
    baseGeometry.setAttribute("normal", new THREE.BufferAttribute(baseData.normals, 3));
    baseGeometry.setIndex(new THREE.BufferAttribute(baseData.indices, 1));
    const baseMesh = new THREE.Mesh(baseGeometry, material);
    const positions = new Float32Array(FLOATS_PER_MOVE), normals = new Float32Array(FLOATS_PER_MOVE);
    const partialGeometry = new THREE.BufferGeometry();
    partialGeometry.setAttribute("position", new THREE.BufferAttribute(positions, 3).setUsage(THREE.DynamicDrawUsage));
    partialGeometry.setAttribute("normal", new THREE.BufferAttribute(normals, 3).setUsage(THREE.DynamicDrawUsage));
    partialGeometry.setIndex(new THREE.BufferAttribute(data.indices.slice(0, INDICES_PER_MOVE), 1));
    const partial = new THREE.Mesh(partialGeometry, material);
    for (const object of [mesh, partial, baseMesh]) {
      object.rotation.x = -Math.PI / 2; object.scale.setScalar(.1);
      object.castShadow = true; object.receiveShadow = true; object.frustumCulled = false; scene.add(object);
    }
    const ghost = new THREE.Group();
    const ghostMaterial = new THREE.LineBasicMaterial({ color: "#737f74", transparent: true, opacity: .18 });
    for (const contour of props.path.contours) {
      const points = contour.points.map(([x, y, z]) => new THREE.Vector3(x / 10, z / 10, -y / 10));
      ghost.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(points), ghostMaterial));
    }
    ghost.visible = props.planned; scene.add(ghost);
    const head = createLdmHead();
    scene.add(head);
    const world: World = { support:props.support,residue:props.residue,renderer, scene, camera, controls, mesh, partial, head, ghost,
      framing: props.framing, resize: () => {}, positions, normals, indexBefore: data.indexBefore, path: props.path,
      baseMesh, showBase: props.showBase, planned: props.planned, sample: sampleToolpath(props.path, 0) };
    worldRef.current = world; showSample(world, sampleToolpath(props.path, 0)); setView(world, "perspective");
    const resize = () => {
      const width = host.clientWidth, height = host.clientHeight; if (!width || !height) return;
      const aspect = width / height;
      const diameter = world.framing === "plate" ? MACHINE.diameterMm * MM_TO_SCENE :
        outerRadiusMm(props.path) / 5 + .8;
      const span = Math.max(props.path.parameters.heightMm / 10 + 4,
        (diameter + 1) / Math.min(1, aspect));
      camera.left = -span * aspect / 2; camera.right = span * aspect / 2;
      camera.top = span / 2; camera.bottom = -span / 2;
      camera.updateProjectionMatrix(); renderer.setSize(width, height);
    };
    world.resize = resize;
    const observer = new ResizeObserver(resize); observer.observe(host); resize();
    let frame = 0;
    const render = () => { frame = requestAnimationFrame(render); controls.update(); renderer.render(scene, camera); };
    render();
    return () => {
      cancelAnimationFrame(frame); observer.disconnect(); controls.dispose();
      const materials = new Set<THREE.Material>();
      scene.traverse(object => {
        if (object instanceof THREE.Mesh || object instanceof THREE.Line) {
          object.geometry.dispose();
          for (const mat of Array.isArray(object.material) ? object.material : [object.material]) materials.add(mat);
        }
      });
      materials.forEach(mat => mat.dispose()); renderer.dispose(); renderer.forceContextLoss();
      renderer.domElement.remove(); worldRef.current = null;
    };
  }, [props.path, props.basePath,props.residue,props.support,props.material]);
  useEffect(() => {
    const world = worldRef.current;
    if (world) { world.showBase = props.showBase; world.planned = props.planned; showSample(world, world.sample); }
  }, [props.showBase, props.planned]);
  useEffect(() => {
    const world = worldRef.current;
    if (world) { world.framing = props.framing; world.camera.zoom = 1; world.resize(); }
  }, [props.framing]);
  useEffect(() => { if (worldRef.current) worldRef.current.controls.autoRotate = props.autoRotate; }, [props.autoRotate]);
  return <div ref={container} className="clay-scene" aria-label="Interactive 3D clay print" />;
});
