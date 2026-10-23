import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import {
  BASE_RADIUS,
  LAYERS,
  LAYER_HEIGHT,
  SEGMENTS,
  TOTAL_STEPS,
  generateDeposits,
} from "./simulation";
import type { Deposit, Pottery } from "./simulation";

const SIDES = 8;
const MAX_NODES = TOTAL_STEPS + 1;

export interface SceneHandle {
  reset: () => void;
  append: (deposits: Deposit[], start: number) => void;
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
  nodes: number;
  planned: boolean;
  printing: boolean;
  miniature: boolean;
}

function appendNodes(world: World, deposits: Deposit[], start: number) {
  const { positions, normals, colors, indices, mesh } = world;
  for (let i = start; i < deposits.length; i++) {
    const p = deposits[i];
    const theta = (i / SEGMENTS) * Math.PI * 2;
    const ct = Math.cos(theta);
    const st = Math.sin(theta);
    const color =
      0.43 +
      Math.sin(i * 0.17) * 0.009 +
      Math.sin((i / SEGMENTS) * 1.8) * 0.018;
    for (let j = 0; j < SIDES; j++) {
      const angle = (j / SIDES) * Math.PI * 2;
      const ca = Math.cos(angle);
      const sa = Math.sin(angle);
      const offset = (i * SIDES + j) * 3;
      positions[offset] = p.x + ct * ca * p.thickness;
      positions[offset + 1] = p.y + sa * p.thickness * 0.88;
      positions[offset + 2] = p.z + st * ca * p.thickness;
      normals[offset] = ct * ca;
      normals[offset + 1] = sa;
      normals[offset + 2] = st * ca;
      colors[offset] = color * 1.015;
      colors[offset + 1] = color;
      colors[offset + 2] = color * 0.953;
    }
    if (i > 0) {
      const visible = !p.gap && !deposits[i - 1].gap;
      for (let j = 0; j < SIDES; j++) {
        const a = (i - 1) * SIDES + j;
        const b = (i - 1) * SIDES + ((j + 1) % SIDES);
        const c = i * SIDES + j;
        const d = i * SIDES + ((j + 1) % SIDES);
        const offset = ((i - 1) * SIDES + j) * 6;
        indices.set(visible ? [a, b, c, b, d, c] : [a, a, a, a, a, a], offset);
      }
    }
  }
  for (const name of ["position", "normal", "color"]) {
    const attribute = mesh.geometry.getAttribute(name) as THREE.BufferAttribute;
    attribute.clearUpdateRanges();
    attribute.addUpdateRange(
      start * SIDES * 3,
      (deposits.length - start) * SIDES * 3,
    );
    attribute.needsUpdate = true;
  }
  const index = mesh.geometry.index!;
  index.clearUpdateRanges();
  index.addUpdateRange(
    Math.max(0, start - 1) * SIDES * 6,
    Math.max(0, deposits.length - Math.max(1, start)) * SIDES * 6,
  );
  index.needsUpdate = true;
  mesh.geometry.setDrawRange(0, Math.max(0, deposits.length - 1) * SIDES * 6);
  world.nodes = deposits.length;
  const last = deposits.at(-1);
  if (last) {
    world.head.position.set(last.x, last.y + 0.075, last.z);
    world.stream.visible = !last.gap;
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

    useImperativeHandle(
      ref,
      () => ({
        reset() {
          const w = worldRef.current;
          if (!w) return;
          w.mesh.geometry.setDrawRange(0, 0);
          w.nodes = 0;
          w.head.position.set(BASE_RADIUS, 0.13, 0);
          resetCamera(w);
        },
        append(deposits, start) {
          if (worldRef.current) appendNodes(worldRef.current, deposits, start);
        },
        display(pottery) {
          const w = worldRef.current;
          if (!w) return;
          appendNodes(w, generateDeposits(pottery), 0);
          resetCamera(w);
        },
        capture() {
          const w = worldRef.current;
          if (!w) return "";
          const visible = w.head.visible;
          w.head.visible = false;
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

      const positions = new Float32Array(MAX_NODES * SIDES * 3);
      const normals = new Float32Array(MAX_NODES * SIDES * 3);
      const colors = new Float32Array(MAX_NODES * SIDES * 3);
      const indices = new Uint32Array(TOTAL_STEPS * SIDES * 6);
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
        new THREE.CylinderGeometry(0.078, 0.027, 0.19, 24),
        silver,
      );
      tip.position.y = 0.15;
      head.add(tip);
      const nozzle = new THREE.Mesh(
        new THREE.CylinderGeometry(0.09, 0.09, 0.37, 32),
        steel,
      );
      nozzle.position.y = 0.43;
      head.add(nozzle);
      for (let i = 0; i < 5; i++) {
        const heatRing = new THREE.Mesh(
          new THREE.CylinderGeometry(0.115, 0.115, 0.023, 32),
          steel,
        );
        heatRing.position.y = 0.32 + i * 0.045;
        head.add(heatRing);
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
        new THREE.CylinderGeometry(0.022, 0.026, 0.12, 12),
        new THREE.MeshStandardMaterial({ color: "#bdbdb1", roughness: 0.8 }),
      );
      stream.position.y = 0.01;
      head.add(stream);
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
        nodes: 0,
        planned: initial.planned ?? true,
        printing: initial.printing ?? false,
        miniature: !!initial.miniature,
      };
      worldRef.current = world;
      appendNodes(world, generateDeposits(initial.initial), 0);
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
          if (!snapshotTaken && initial.onSnapshot) {
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
      if (worldRef.current) worldRef.current.head.visible = !!props.printing;
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
