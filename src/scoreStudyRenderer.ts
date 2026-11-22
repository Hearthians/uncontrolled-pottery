import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { createClayMaterial } from "../xiaojun-version/GrammarofFailure_PrototypeB_v1/src/clayAppearance.ts";
import { scoreTubeGeometry } from "./scoreStudyMesh.ts";
import type { ScoreShape } from "./scoreStudyCore.ts";

export function createScoreRenderer(canvas: HTMLCanvasElement, interactive = false) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(1);
  renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.27;
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  const scene = new THREE.Scene(); scene.background = new THREE.Color("#eee7dd");
  const camera = new THREE.OrthographicCamera(-95, 95, 116, -116, 1, 1500);
  const home = new THREE.Vector3(245, 160, 370), target = new THREE.Vector3(0, 85, 0);
  camera.position.copy(home); camera.lookAt(target);
  scene.add(new THREE.HemisphereLight("#fff5e5", "#716250", 2.6));
  const key = new THREE.DirectionalLight("#fff5e8", 3.3); key.position.set(-130, 280, 260);
  key.castShadow = true; key.shadow.mapSize.set(1024, 1024);
  Object.assign(key.shadow.camera, { left: -140, right: 140, top: 230, bottom: -100, near: 1, far: 700 });
  key.shadow.bias = -0.0004; key.shadow.normalBias = 0.15; key.target.position.set(0, 80, 0);
  scene.add(key, key.target);
  const fill = new THREE.DirectionalLight("#ffe0c5", 0.8); fill.position.set(180, 110, -180); scene.add(fill);
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(2000, 2000), new THREE.MeshStandardMaterial({ color: "#eee7dd", roughness: 1 }));
  floor.rotation.x = -Math.PI / 2; floor.position.y = -0.6; floor.receiveShadow = true; scene.add(floor);
  const clay = createClayMaterial(); clay.color.set("#ad6747"); clay.roughness = 0.72;
  const upstream = clay.onBeforeCompile.bind(clay);
  clay.onBeforeCompile = (shader, renderer) => {
    upstream(shader, renderer);
    shader.vertexShader = shader.vertexShader.replace("vClayPosition = position;", "vClayPosition = position * .075;");
    shader.fragmentShader = shader.fragmentShader.replace("clamp(roughnessFactor + (grain-.5)*.03,.95,1.0)",
      "clamp(roughnessFactor + (grain-.5)*.03,.65,.8)");
  };
  clay.customProgramCacheKey = () => "score-study-clay-1";
  let mesh: THREE.Mesh | undefined, disposed = false;
  const orbit = interactive ? new OrbitControls(camera, canvas) : undefined;
  if (orbit) { orbit.target.copy(target); orbit.enablePan = false; orbit.minZoom = 0.65; orbit.maxZoom = 3; orbit.update(); }
  const draw = () => { if (!disposed) renderer.render(scene, camera); };
  orbit?.addEventListener("change", draw);
  return {
    show(shape: ScoreShape, yaw = 0) {
      if (mesh) { scene.remove(mesh); mesh.geometry.dispose(); }
      mesh = new THREE.Mesh(scoreTubeGeometry(shape.points), clay);
      mesh.rotation.y = yaw;
      mesh.castShadow = true; mesh.receiveShadow = true; scene.add(mesh); draw();
    },
    size(width: number, height: number) {
      renderer.setSize(width, height, false);
      // The same framing at every score leaves room for C's severe outward mounds.
      const halfHeight = Math.max(110, 100 * height / width), halfWidth = halfHeight * width / height;
      camera.left = -halfWidth; camera.right = halfWidth; camera.top = halfHeight; camera.bottom = -halfHeight;
      camera.updateProjectionMatrix(); draw();
    },
    reset() { camera.position.copy(home); camera.zoom = 1; camera.lookAt(target); camera.updateProjectionMatrix();
      if (orbit) { orbit.target.copy(target); orbit.update(); } draw(); },
    back() { camera.position.set(-245, 160, -370); camera.lookAt(target); orbit?.update(); draw(); },
    snapshot() { draw(); return canvas.toDataURL("image/png"); },
    dispose() {
      disposed = true; orbit?.removeEventListener("change", draw); orbit?.dispose();
      mesh?.geometry.dispose(); clay.dispose(); floor.geometry.dispose(); floor.material.dispose(); renderer.dispose(); renderer.forceContextLoss();
    },
  };
}
