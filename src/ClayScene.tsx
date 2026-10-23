import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import {
  BASE_RADIUS,
  LAYERS,
  LAYER_HEIGHT,
  SEGMENTS,
  TOTAL_STEPS,
} from "./simulation";
import type { Pottery, SceneDeposit } from "./pottery";
import type { NozzlePose } from "./materialSimulation";
import { loadDeposits } from "./depositLoader";

const SIDES = 8;
const VERTICES = SIDES + 2;
const INDEX_STRIDE = SIDES * 6;
const MAX_NODES = TOTAL_STEPS + 1;
const CROSS_SECTION = Array.from({ length: SIDES }, (_, j) => ({
  ca: Math.cos(j / SIDES * Math.PI * 2),
  sa: Math.sin(j / SIDES * Math.PI * 2),
}));
const RADIAL = Array.from({ length: MAX_NODES }, (_, i) => ({
  ct: Math.cos(i / SEGMENTS * Math.PI * 2),
  st: Math.sin(i / SEGMENTS * Math.PI * 2),
}));

export interface SceneHandle {
  reset: () => void;
  append: (deposits: SceneDeposit[], start: number, nozzle?: NozzlePose) => void;
  display: (pottery: Pottery) => void;
  capture: () => string;
  resetView: () => void;
  setView: (view: "perspective" | "front" | "top") => void;
}

type Props = {
  initial: Pottery;
  planned?: boolean;
  autoRotate?: boolean;
  printing?: boolean;
  miniature?: boolean;
  onError?: () => void;
  onSnapshot?: (image: string) => void;
  initialNozzle?: NozzlePose;
};

interface World {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.OrthographicCamera;
  controls: OrbitControls;
  mesh: THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>;
  ghost: THREE.Group;
  head: THREE.Group;
  stream: THREE.Mesh;
  positions: Float32Array;
  normals: Float32Array;
  colors: Float32Array;
  indices: Uint32Array;
  indexEnds: Uint32Array;
  nodes: number;
  planned: boolean;
  printing: boolean;
  miniature: boolean;
  revision: number;
  ready: boolean;
}

function appendNodes(world: World, deposits: SceneDeposit[], start: number, nozzle?: NozzlePose) {
  const { positions, normals, colors, indices, mesh } = world;
  start = Math.min(world.nodes, Math.max(0, start - 1));
  // Compact indices omit missing spans; offsets keep later uploads incremental.
  const indexStart = world.indexEnds[start];
  let cursor = indexStart;
  for (let i = start; i < deposits.length; i++) {
    const p = deposits[i];
    const previous = deposits[i - 1];
    const next = deposits[i + 1];
    const material = p.halfHeight !== undefined;
    const halfHeight = p.halfHeight ?? p.thickness * 0.88;
    const { ct, st } = RADIAL[i];
    const before = previous && !previous.gap ? previous : p;
    const after = next && !next.gap ? next : p;
    const length = Math.hypot(after.x - before.x, after.y - before.y, after.z - before.z);
    const tx = length > 1e-8 ? (after.x - before.x) / length : -st;
    const ty = length > 1e-8 ? (after.y - before.y) / length : 0;
    const tz = length > 1e-8 ? (after.z - before.z) / length : ct;
    const upLength = Math.hypot(ty * st, tz * ct - tx * st, -ty * ct) || 1;
    const ux = material ? ty * st / upLength : 0;
    const uy = material ? (tz * ct - tx * st) / upLength : 1;
    const uz = material ? -ty * ct / upLength : 0;
    const color = 0.43 + Math.sin(i * 0.17) * 0.009 + Math.sin((i / SEGMENTS) * 1.8) * 0.018;
    const invWidth = 1 / Math.max(p.thickness, 0.001);
    const invHeight = 1 / Math.max(halfHeight, 0.001);
    for (let j = 0; j < SIDES; j++) {
      const { ca, sa } = CROSS_SECTION[j];
      const offset = (i * VERTICES + j) * 3;
      positions[offset] = p.x + ct * ca * p.thickness + ux * sa * halfHeight;
      positions[offset + 1] = p.y + uy * sa * halfHeight;
      positions[offset + 2] = p.z + st * ca * p.thickness + uz * sa * halfHeight;
      const nx = ct * ca * invWidth + ux * sa * invHeight;
      const ny = uy * sa * invHeight;
      const nz = st * ca * invWidth + uz * sa * invHeight;
      const nl = Math.sqrt(ca * ca * invWidth * invWidth + sa * sa * invHeight * invHeight) || 1;
      normals[offset] = material ? nx / nl : ct * ca;
      normals[offset + 1] = material ? ny / nl : sa;
      normals[offset + 2] = material ? nz / nl : st * ca;
      colors[offset] = color * 1.015;
      colors[offset + 1] = color;
      colors[offset + 2] = color * 0.953;
    }
    for (let cap = 0; cap < 2; cap++) {
      const offset = (i * VERTICES + SIDES + cap) * 3;
      const sign = cap === 0 ? -1 : 1;
      const depth = material ? 0.012 : 0;
      positions[offset] = p.x + tx * depth * sign;
      positions[offset + 1] = p.y + ty * depth * sign;
      positions[offset + 2] = p.z + tz * depth * sign;
      normals[offset] = tx * sign;
      normals[offset + 1] = ty * sign;
      normals[offset + 2] = tz * sign;
      colors[offset] = color * 1.015;
      colors[offset + 1] = color;
      colors[offset + 2] = color * 0.953;
    }
    for (let j = 0; j < SIDES; j++) {
      const c = i * VERTICES + j;
      const d = i * VERTICES + ((j + 1) % SIDES);
      if (!p.gap && previous && !previous.gap) {
        const a = (i - 1) * VERTICES + j;
        const b = (i - 1) * VERTICES + ((j + 1) % SIDES);
        indices[cursor++] = a;
        indices[cursor++] = b;
        indices[cursor++] = c;
        indices[cursor++] = b;
        indices[cursor++] = d;
        indices[cursor++] = c;
      }
      if (material && !p.gap && (!previous || previous.gap)) {
        indices[cursor++] = i * VERTICES + SIDES;
        indices[cursor++] = d;
        indices[cursor++] = c;
      }
      if (material && !p.gap && (!next || next.gap)) {
        indices[cursor++] = i * VERTICES + SIDES + 1;
        indices[cursor++] = c;
        indices[cursor++] = d;
      }
    }
    world.indexEnds[i + 1] = cursor;
  }
  for (const name of ["position", "normal", "color"]) {
    const attribute = mesh.geometry.getAttribute(name) as THREE.BufferAttribute;
    attribute.clearUpdateRanges();
    attribute.addUpdateRange(
      start * VERTICES * 3,
      (deposits.length - start) * VERTICES * 3,
    );
    attribute.needsUpdate = true;
  }
  const index = mesh.geometry.index!;
  index.clearUpdateRanges();
  index.addUpdateRange(
    indexStart,
    cursor - indexStart,
  );
  index.needsUpdate = true;
  mesh.geometry.setDrawRange(0, cursor);
  world.nodes = deposits.length;
  world.renderer.domElement.dataset.nodes = String(deposits.length);
  const last = deposits.at(-1);
  if (last) {
    const pose = nozzle ?? { x: last.x, y: last.y + 0.13, z: last.z, flow: last.gap ? 0 : 1, contactY: last.y };
    world.head.position.set(pose.x, pose.y, pose.z);
    const top = new THREE.Vector3(pose.x, pose.y, pose.z);
    const bottom = new THREE.Vector3(last.x, pose.contactY, last.z);
    const direction = top.clone().sub(bottom);
    const distance = direction.length();
    world.stream.visible = world.printing && !last.gap && pose.flow >= 0.085 && distance > 0.001;
    world.stream.position.copy(top.add(bottom).multiplyScalar(0.5));
    world.stream.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.normalize());
    world.stream.scale.set(0.04 * Math.sqrt(Math.max(pose.flow, 0)), distance, 0.04 * Math.sqrt(Math.max(pose.flow, 0)));
    world.renderer.domElement.dataset.nozzleX = pose.x.toFixed(5);
    world.renderer.domElement.dataset.nozzleY = pose.y.toFixed(5);
    world.renderer.domElement.dataset.nozzleZ = pose.z.toFixed(5);
    world.renderer.domElement.dataset.flow = pose.flow.toFixed(5);
  }
}

function resetCamera(
  world: World,
  view: "perspective" | "front" | "top" = "perspective",
) {
  const target = new THREE.Vector3(0, 1.35, 0);
  world.camera.up.set(0, 1, 0);
  if (view === "top") {
    world.camera.position.set(0.01, 9, 0.01);
    world.camera.up.set(0, 0, -1);
    target.set(0, 1.1, 0);
  } else if (view === "front") {
    world.camera.position.set(0, 2.7, 9);
  } else {
    world.camera.position.set(6.2, 5.2, 7.5);
  }
  world.controls.target.copy(target);
  world.camera.zoom = 1;
  world.camera.updateProjectionMatrix();
  world.controls.update();
}

export const ClayScene = forwardRef<SceneHandle, Props>(
  function ClayScene(props, ref) {
    const container = useRef<HTMLDivElement>(null);
    const worldRef = useRef<World | null>(null);
    const initialProps = useRef(props);
    const loadRef = useRef<(pottery: Pottery) => void>(() => {});

    useImperativeHandle(
      ref,
      () => ({
        reset() {
          const w = worldRef.current;
          if (!w) return;
          w.mesh.geometry.setDrawRange(0, 0);
          w.nodes = 0;
          w.revision++;
          w.ready = true;
          w.stream.visible = false;
          w.head.position.set(BASE_RADIUS, 0.13, 0);
          if (container.current) container.current.dataset.renderState = "ready";
          resetCamera(w);
        },
        append(deposits, start, nozzle) {
          const w = worldRef.current;
          if (!w) return;
          if (!w.ready) {
            w.revision++;
            w.ready = true;
            start = 0;
            if (container.current) container.current.dataset.renderState = "ready";
          }
          appendNodes(w, deposits, start, nozzle);
        },
        display(pottery) {
          loadRef.current(pottery);
        },
        capture() {
          const w = worldRef.current;
          if (!w || !w.ready) return "";
          const visible = w.head.visible;
          const flowing = w.stream.visible;
          w.head.visible = false;
          w.stream.visible = false;
          w.renderer.render(w.scene, w.camera);
          const source = w.renderer.domElement;
          const canvas = document.createElement("canvas");
          canvas.width = 480;
          canvas.height = 480;
          const ctx = canvas.getContext("2d")!;
          const size = Math.min(source.width, source.height);
          ctx.drawImage(
            source,
            (source.width - size) / 2,
            (source.height - size) / 2,
            size,
            size,
            0,
            0,
            480,
            480,
          );
          w.head.visible = visible;
          w.stream.visible = flowing;
          return canvas.toDataURL("image/webp", 0.85);
        },
        resetView() {
          if (worldRef.current) resetCamera(worldRef.current);
        },
        setView(view) {
          if (worldRef.current) resetCamera(worldRef.current, view);
        },
      }),
      [],
    );

    useEffect(() => {
      const host = container.current;
      if (!host) return;
      const initial = initialProps.current;
      let renderer: THREE.WebGLRenderer;
      try {
        renderer = new THREE.WebGLRenderer({
          antialias: true,
          alpha: false,
          preserveDrawingBuffer: true,
          powerPreference: "high-performance",
        });
      } catch {
        initial.onError?.();
        return;
      }
      renderer.setPixelRatio(
        Math.min(window.devicePixelRatio, initial.miniature ? 1.25 : 1.75),
      );
      renderer.shadowMap.enabled = !initial.miniature;
      renderer.shadowMap.type = THREE.PCFSoftShadowMap;
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      renderer.toneMappingExposure = 1.3;
      host.appendChild(renderer.domElement);
      const scene = new THREE.Scene();
      scene.background = new THREE.Color("#e8e9e4");
      scene.fog = new THREE.Fog("#e8e9e4", 16, 35);
      const camera = new THREE.OrthographicCamera(-4, 4, 3, -3, 0.1, 60);
      const controls = new OrbitControls(camera, renderer.domElement);
      controls.enableDamping = true;
      controls.dampingFactor = 0.07;
      controls.enablePan = false;
      controls.minZoom = 0.65;
      controls.maxZoom = 2.4;
      controls.minPolarAngle = 0.05;
      controls.maxPolarAngle = Math.PI / 2 - 0.03;
      controls.autoRotateSpeed = 0.55;
      controls.enabled = !initial.miniature;

      scene.add(new THREE.HemisphereLight("#ffffff", "#b9b9ab", 2.15));
      const key = new THREE.DirectionalLight("#fffaf0", 3.2);
      key.position.set(-4, 7, 5);
      key.castShadow = true;
      key.shadow.mapSize.set(2048, 2048);
      key.shadow.camera.left = -5;
      key.shadow.camera.right = 5;
      key.shadow.camera.top = 6;
      key.shadow.camera.bottom = -5;
      key.shadow.normalBias = 0.025;
      key.shadow.bias = -0.0002;
      key.shadow.radius = 3;
      scene.add(key);
      const fill = new THREE.DirectionalLight("#ecf1f8", 0.9);
      fill.position.set(3, 4, -4);
      scene.add(fill);

      const floor = new THREE.Mesh(
        new THREE.PlaneGeometry(200, 200),
        new THREE.MeshStandardMaterial({ color: "#dedfd8", roughness: 1 }),
      );
      floor.rotation.x = -Math.PI / 2;
      floor.position.y = -0.23;
      floor.receiveShadow = true;
      scene.add(floor);
      if (!initial.miniature) {
        const grid = new THREE.GridHelper(70, 140, "#c2c5bc", "#c2c5bc");
        grid.position.y = -0.225;
        (grid.material as THREE.Material).transparent = true;
        (grid.material as THREE.Material).opacity = 0.26;
        scene.add(grid);
      }

      const platform = new THREE.Mesh(
        new THREE.CylinderGeometry(1.85, 1.85, 0.13, 96),
        new THREE.MeshStandardMaterial({
          color: "#c9cbc5",
          roughness: 0.8,
          metalness: 0.13,
        }),
      );
      platform.position.y = -0.085;
      platform.receiveShadow = true;
      platform.castShadow = true;
      scene.add(platform);
      const rim = new THREE.Mesh(
        new THREE.CylinderGeometry(1.83, 1.78, 0.06, 96),
        new THREE.MeshStandardMaterial({
          color: "#777e77",
          roughness: 0.7,
          metalness: 0.35,
        }),
      );
      rim.position.y = -0.18;
      scene.add(rim);
      [1.45, 1.63, 1.76].forEach((radius) => {
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
        scene.add(ring);
      });
      const base = new THREE.Mesh(
        new THREE.CylinderGeometry(
          BASE_RADIUS + 0.015,
          BASE_RADIUS + 0.015,
          0.045,
          96,
        ),
        new THREE.MeshStandardMaterial({ color: "#bcbcb1", roughness: 0.85 }),
      );
      base.position.y = 0.01;
      base.receiveShadow = true;
      scene.add(base);

      const positions = new Float32Array(MAX_NODES * VERTICES * 3);
      const normals = new Float32Array(MAX_NODES * VERTICES * 3);
      const colors = new Float32Array(MAX_NODES * VERTICES * 3);
      const indices = new Uint32Array(MAX_NODES * INDEX_STRIDE);
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute(
        "position",
        new THREE.BufferAttribute(positions, 3).setUsage(
          THREE.DynamicDrawUsage,
        ),
      );
      geometry.setAttribute(
        "normal",
        new THREE.BufferAttribute(normals, 3).setUsage(THREE.DynamicDrawUsage),
      );
      geometry.setAttribute(
        "color",
        new THREE.BufferAttribute(colors, 3).setUsage(THREE.DynamicDrawUsage),
      );
      geometry.setIndex(
        new THREE.BufferAttribute(indices, 1).setUsage(THREE.DynamicDrawUsage),
      );
      geometry.setDrawRange(0, 0);
      const mesh = new THREE.Mesh(
        geometry,
        new THREE.MeshStandardMaterial({
          vertexColors: true,
          roughness: 0.7,
          metalness: 0,
          side: THREE.DoubleSide,
        }),
      );
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.frustumCulled = false;
      scene.add(mesh);

      const ghost = new THREE.Group();
      const ghostMaterial = new THREE.LineDashedMaterial({
        color: "#737f74",
        transparent: true,
        opacity: 0.4,
        dashSize: 0.055,
        gapSize: 0.04,
        depthWrite: false,
      });
      [0, LAYERS * LAYER_HEIGHT + 0.05].forEach((y) => {
        const points = Array.from(
          { length: 129 },
          (_, i) =>
            new THREE.Vector3(
              Math.cos((i / 128) * Math.PI * 2) * BASE_RADIUS,
              y,
              Math.sin((i / 128) * Math.PI * 2) * BASE_RADIUS,
            ),
        );
        const line = new THREE.Line(
          new THREE.BufferGeometry().setFromPoints(points),
          ghostMaterial,
        );
        line.computeLineDistances();
        ghost.add(line);
      });
      for (let i = 0; i < 12; i++) {
        const theta = (i / 12) * Math.PI * 2;
        const points = [
          new THREE.Vector3(
            Math.cos(theta) * BASE_RADIUS,
            0,
            Math.sin(theta) * BASE_RADIUS,
          ),
          new THREE.Vector3(
            Math.cos(theta) * BASE_RADIUS,
            LAYERS * LAYER_HEIGHT + 0.05,
            Math.sin(theta) * BASE_RADIUS,
          ),
        ];
        const line = new THREE.Line(
          new THREE.BufferGeometry().setFromPoints(points),
          ghostMaterial,
        );
        line.computeLineDistances();
        ghost.add(line);
      }
      ghost.visible = initial.planned ?? true;
      scene.add(ghost);

      const head = new THREE.Group();
      const steel = new THREE.MeshStandardMaterial({
        color: "#4a514e",
        metalness: 0.72,
        roughness: 0.32,
      });
      const silver = new THREE.MeshStandardMaterial({
        color: "#b6bdb6",
        metalness: 0.75,
        roughness: 0.24,
      });
      const tip = new THREE.Mesh(
        new THREE.CylinderGeometry(0.12, 0.082, 0.22, 24),
        silver,
      );
      tip.position.y = 0.11;
      head.add(tip);
      const nozzle = new THREE.Mesh(
        new THREE.CylinderGeometry(0.125, 0.125, 0.37, 32),
        steel,
      );
      nozzle.position.y = 0.43;
      head.add(nozzle);
      for (let i = 0; i < 2; i++) {
        const coupling = new THREE.Mesh(
          new THREE.CylinderGeometry(0.145, 0.145, 0.05, 6),
          steel,
        );
        coupling.position.y = 0.27 + i * 0.29;
        head.add(coupling);
      }
      const sleeve = new THREE.Mesh(
        new THREE.CylinderGeometry(0.068, 0.068, 3.8, 24),
        silver,
      );
      sleeve.position.y = 2.45;
      head.add(sleeve);
      const headBand = new THREE.Mesh(
        new THREE.CylinderGeometry(0.095, 0.095, 0.035, 24),
        new THREE.MeshStandardMaterial({ color: "#d66a4c", roughness: 0.6 }),
      );
      headBand.position.y = 0.6;
      head.add(headBand);
      const stream = new THREE.Mesh(
        new THREE.CylinderGeometry(1, 1, 1, 12),
        new THREE.MeshStandardMaterial({ color: "#bdbdb1", roughness: 0.8 }),
      );
      stream.visible = false;
      scene.add(stream);
      head.visible = initial.printing ?? false;
      scene.add(head);

      const world: World = {
        renderer,
        scene,
        camera,
        controls,
        mesh,
        ghost,
        head,
        stream,
        positions,
        normals,
        colors,
        indices,
        indexEnds: new Uint32Array(MAX_NODES + 1),
        nodes: 0,
        planned: initial.planned ?? true,
        printing: initial.printing ?? false,
        miniature: !!initial.miniature,
        revision: 0,
        ready: false,
      };
      worldRef.current = world;
      host.dataset.renderState = "loading";
      resetCamera(world);

      let snapshotFrame = 0;
      let snapshotTaken = false;
      const resize = () => {
        const width = host.clientWidth;
        const height = host.clientHeight;
        if (!width || !height) return;
        const aspect = initial.miniature ? 1 : width / height;
        const span = initial.miniature ? 4.3 : width < 500 ? 5.2 : 5.6;
        camera.left = (-span * aspect) / 2;
        camera.right = (span * aspect) / 2;
        camera.top = span / 2;
        camera.bottom = -span / 2;
        camera.updateProjectionMatrix();
        renderer.setSize(
          initial.miniature ? 400 : width,
          initial.miniature ? 400 : height,
          !initial.miniature,
        );
        const beside = width / height >= 1.4;
        ghost.position.set(
          beside ? 1.75 : 0,
          beside ? -0.14 : 0,
          beside ? -1.3 : 0,
        );
        if (initial.miniature) {
          renderer.render(scene, camera);
          if (world.ready && !snapshotTaken && initial.onSnapshot) {
            snapshotTaken = true;
            snapshotFrame = requestAnimationFrame(() =>
              initial.onSnapshot?.(
                renderer.domElement.toDataURL("image/webp", 0.85),
              ),
            );
          }
        }
      };
      const observer = new ResizeObserver(resize);
      observer.observe(host);
      resize();
      loadRef.current = (pottery) => {
        const revision = ++world.revision;
        world.ready = false;
        host.dataset.renderState = "loading";
        host.dataset.engine = pottery.simulation ? "2" : "1";
        loadDeposits(pottery).then((deposits) => {
          if (worldRef.current !== world || revision !== world.revision) return;
          appendNodes(world, deposits, 0, initial.initialNozzle);
          world.ready = true;
          host.dataset.renderState = "ready";
          resetCamera(world);
          resize();
        }).catch(() => {
          if (worldRef.current === world && revision === world.revision) initial.onError?.();
        });
      };
      loadRef.current(initial.initial);
      let frame = 0;
      const render = () => {
        frame = requestAnimationFrame(render);
        controls.update();
        renderer.render(scene, camera);
      };
      if (!initial.miniature) render();
      return () => {
        cancelAnimationFrame(frame);
        cancelAnimationFrame(snapshotFrame);
        observer.disconnect();
        controls.dispose();
        scene.traverse((object) => {
          if (object instanceof THREE.Mesh || object instanceof THREE.Line) {
            object.geometry.dispose();
            const materials = Array.isArray(object.material)
              ? object.material
              : [object.material];
            materials.forEach((material) => material.dispose());
          }
        });
        renderer.dispose();
        renderer.forceContextLoss();
        renderer.domElement.remove();
        worldRef.current = null;
      };
    }, []);

    useEffect(() => {
      if (worldRef.current) worldRef.current.ghost.visible = !!props.planned;
    }, [props.planned]);
    useEffect(() => {
      if (worldRef.current)
        worldRef.current.controls.autoRotate = !!props.autoRotate;
    }, [props.autoRotate]);
    useEffect(() => {
      if (worldRef.current) {
        worldRef.current.printing = !!props.printing;
        worldRef.current.head.visible = !!props.printing;
        if (!props.printing) worldRef.current.stream.visible = false;
      }
    }, [props.printing]);

    return (
      <div
        ref={container}
        className={props.miniature ? "clay-scene miniature" : "clay-scene"}
        aria-label="可旋转的三维陶器"
      />
    );
  },
);
