import { useEffect, useRef } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { createClayMaterial } from "../xiaojun-version/GrammarofFailure_PrototypeB_v1/src/clayAppearance";
import { generateTopographyForm, sampleTopographyPath, topographyBuffers, type FormMetrics } from "./topographyForm";
import { revealedIndices, topographyFrame, TOPOGRAPHY_ANIMATION, type TopographyFrame } from "./topographyAnimation";
import type { TopographyPlan } from "./memoryTopography";

function claySurface() {
  const clay = createClayMaterial(); clay.color.set("#98684c"); clay.roughness = 0.66;
  const shadeClay = clay.onBeforeCompile.bind(clay);
  clay.onBeforeCompile = (shader, renderer) => {
    shadeClay(shader, renderer);
    shader.vertexShader = shader.vertexShader.replace("vClayPosition = position;", "vClayPosition = position * 0.07;");
    shader.fragmentShader = shader.fragmentShader.replace(
      "float relief = .0015 * grain + .0004 * mottling + .0005 * pores;",
      "float relief = .035 * grain + .012 * mottling + .009 * pores;");
    shader.fragmentShader = shader.fragmentShader.replace(
      ".91 + .07 * mottling + .11 * grain + .07 * pores",
      ".96 + .035 * mottling + .035 * grain + .015 * pores");
    shader.fragmentShader = shader.fragmentShader.replace(
      "clamp(roughnessFactor + (grain-.5)*.03,.95,1.0)",
      "clamp(roughnessFactor + (grain-.5)*.035,.58,.76)");
  };
  clay.customProgramCacheKey = () => "topography-wet-clay-mm-v3";
  return clay;
}

/** A simplified vertical extrusion outlet; the tip is local y=0. */
function createNozzle() {
  const nozzle = new THREE.Group();
  const steel = new THREE.MeshStandardMaterial({ color: "#a8aca7", metalness: 0.72, roughness: 0.34 });
  const sleeve = new THREE.MeshStandardMaterial({ color: "#424741", metalness: 0.45, roughness: 0.46 });
  const tip = new THREE.Mesh(new THREE.CylinderGeometry(3.8, 2.6, 9, 32, 1, true), steel);
  tip.position.y = 4.5; nozzle.add(tip);
  const collar = new THREE.Mesh(new THREE.CylinderGeometry(5.2, 3.8, 10, 32), sleeve);
  collar.position.y = 14; nozzle.add(collar);
  const feed = new THREE.Mesh(new THREE.CylinderGeometry(3.2, 3.2, 10, 24), steel);
  feed.position.y = 24; nozzle.add(feed);
  const lip = new THREE.Mesh(new THREE.TorusGeometry(2.65, 0.3, 8, 32), steel);
  lip.rotation.x = Math.PI / 2; nozzle.add(lip);
  nozzle.traverse(object => { if (object instanceof THREE.Mesh) { object.castShadow = true; object.receiveShadow = true; } });
  nozzle.visible = false;
  return nozzle;
}

export function TopographyScene({ plan, playing, replayKey, resetViewKey, initiallyComplete, onReady, onFrame, onViewChange, onError }: {
  plan: TopographyPlan;
  playing: boolean;
  replayKey: number;
  resetViewKey: number;
  initiallyComplete: boolean;
  onReady: (image: string, metrics: FormMetrics) => void;
  onFrame: (frame: TopographyFrame) => void;
  onViewChange: (manual: boolean) => void;
  onError: () => void;
}) {
  const host = useRef<HTMLDivElement>(null);
  const controls = useRef({ playing, replayKey, resetClock: false });
  const viewReset = useRef(resetViewKey);
  useEffect(() => { controls.current = { playing, replayKey, resetClock: true }; }, [playing, replayKey]);
  useEffect(() => { viewReset.current = resetViewKey; }, [resetViewKey]);
  useEffect(() => {
    let cancelled = false;
    let dispose: (() => void) | undefined;
    generateTopographyForm(plan).then(form => {
      if (cancelled || !host.current) return;
      const container = host.current;
      const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true, alpha: false });
      const scene = new THREE.Scene();
      let animationId = 0, disposed = false;
      let orbit: OrbitControls | undefined;
      let resizeObserver: ResizeObserver | undefined, visibilityObserver: IntersectionObserver | undefined;
      let lastTime: number | null = null, lastRender = -Infinity, lastReport = -Infinity;
      let inView = true, resizePending = false;
      const resetClock = () => { lastTime = null; };
      const depth = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
      dispose = () => {
        if (disposed) return;
        disposed = true;
        cancelAnimationFrame(animationId);
        resizeObserver?.disconnect(); visibilityObserver?.disconnect();
        orbit?.dispose();
        document.removeEventListener("visibilitychange", resetClock);
        scene.traverse(object => {
          if (object instanceof THREE.Mesh || object instanceof THREE.Line) {
            object.geometry.dispose();
            const materials = Array.isArray(object.material) ? object.material : [object.material];
            materials.forEach(material => material.dispose());
          }
        });
        depth.dispose(); renderer.dispose(); renderer.forceContextLoss(); renderer.domElement.remove();
      };
      renderer.setSize(1000, 1160);
      renderer.setPixelRatio(1);
      renderer.shadowMap.enabled = true;
      renderer.shadowMap.type = THREE.PCFSoftShadowMap;
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      renderer.toneMappingExposure = 1.3;
      container.appendChild(renderer.domElement);
      scene.background = new THREE.Color("#eee8de");
      scene.fog = new THREE.Fog("#eee8de", 750, 1550);
      const span = 325, aspect = 1000 / 1160;
      const camera = new THREE.OrthographicCamera(-span * aspect / 2, span * aspect / 2, span / 2, -span / 2, 1, 1800);
      camera.position.set(275, 205, 440); camera.lookAt(0, 126, 0); camera.updateMatrixWorld();
      scene.add(new THREE.HemisphereLight("#fff9ef", "#b5a18b", 1.5));
      const key = new THREE.DirectionalLight("#ffefd9", 3.5);
      key.position.set(-180, 390, 280); key.castShadow = true;
      key.shadow.mapSize.set(1024, 1024);
      key.shadow.camera.left = -220; key.shadow.camera.right = 220;
      key.shadow.camera.top = 300; key.shadow.camera.bottom = -200;
      key.shadow.camera.near = 1; key.shadow.camera.far = 900;
      key.shadow.normalBias = 0.25; key.shadow.bias = -0.0001;
      scene.add(key);
      const fill = new THREE.DirectionalLight("#e2e6ec", 0.6);
      fill.position.set(200, 200, -150); scene.add(fill);
      const buffers = topographyBuffers(form);
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute("position", new THREE.BufferAttribute(buffers.positions, 3));
      geometry.setAttribute("normal", new THREE.BufferAttribute(buffers.normals, 3));
      geometry.setAttribute("depositedAt", new THREE.BufferAttribute(buffers.depositedAt, 1));
      geometry.setAttribute("initialCenter", new THREE.BufferAttribute(buffers.initialCenters, 3));
      geometry.setAttribute("finalCenter", new THREE.BufferAttribute(buffers.finalCenters, 3));
      geometry.setAttribute("sectionFrame", new THREE.BufferAttribute(buffers.sectionFrames, 4));
      geometry.setAttribute("sectionSize", new THREE.BufferAttribute(buffers.sectionSizes, 4));
      geometry.setAttribute("sectionUv", new THREE.BufferAttribute(buffers.sectionUv, 3));
      geometry.setIndex(new THREE.BufferAttribute(buffers.indices, 1));
      geometry.computeBoundingSphere();

      const { printSeconds, settleSeconds, settleDelaySeconds } = TOPOGRAPHY_ANIMATION;
      const completeAt = printSeconds + settleSeconds + settleDelaySeconds;
      const clockUniform = { value: completeAt };
      const motionShader = `
        attribute float depositedAt;
        attribute vec3 initialCenter;
        attribute vec3 finalCenter;
        attribute vec4 sectionFrame;
        attribute vec4 sectionSize;
        attribute vec3 sectionUv;
        uniform float topographyTime;
        float settled() {
          float age = topographyTime - depositedAt * ${(printSeconds / form.layers.length).toFixed(8)} - ${settleDelaySeconds.toFixed(3)};
          float t = smoothstep(0.0, ${settleSeconds.toFixed(3)}, age);
          // Bounded creep: flow speeds up after extrusion, then arrests smoothly.
          return (1.0 - exp(-3.5 * t)) / (1.0 - exp(-3.5));
        }
        void strandFrame(float s, out vec3 radial, out vec3 up, out vec3 tangent) {
          float dh = sectionFrame.z - sectionFrame.x;
          float heading = sectionFrame.x + atan(sin(dh), cos(dh)) * s;
          float pitch = mix(sectionFrame.y, sectionFrame.w, s);
          float ch = cos(heading), sh = sin(heading), cp = cos(pitch), sp = sin(pitch);
          radial = vec3(ch, 0.0, sh);
          up = vec3(-sp * sh, cp, sp * ch);
          tangent = vec3(sh * cp, sp, -ch * cp);
        }
      `;
      const animateShader = (shader: THREE.WebGLProgramParametersWithUniforms, normals: boolean) => {
        shader.uniforms.topographyTime = clockUniform;
        shader.vertexShader = motionShader + shader.vertexShader;
        shader.vertexShader = shader.vertexShader.replace("#include <begin_vertex>", `
          #include <begin_vertex>
          {
            float s = settled();
            vec3 radial, up, tangent;
            strandFrame(s, radial, up, tangent);
            vec2 size = mix(sectionSize.xy, sectionSize.zw, s);
            // Move the centerline and rotate the whole ellipse. Interpolating
            // surface vertices directly can collapse a bending strand's section.
            transformed = mix(initialCenter, finalCenter, s)
              + radial * sectionUv.x * size.x + up * sectionUv.y * size.y;
          }
        `);
        if (normals) shader.vertexShader = shader.vertexShader.replace("#include <beginnormal_vertex>", `
          #include <beginnormal_vertex>
          {
            float s = settled();
            vec3 radial, up, tangent;
            strandFrame(s, radial, up, tangent);
            vec2 size = mix(sectionSize.xy, sectionSize.zw, s);
            objectNormal = abs(sectionUv.z) > 0.5 ? tangent * sectionUv.z
              : normalize(radial * sectionUv.x / size.x + up * sectionUv.y / size.y);
          }
        `);
      };
      const clay = claySurface(), shadeClay = clay.onBeforeCompile.bind(clay);
      clay.onBeforeCompile = (shader, activeRenderer) => { shadeClay(shader, activeRenderer); animateShader(shader, true); };
      clay.customProgramCacheKey = () => "topography-plump-strand-clay-v4";
      depth.onBeforeCompile = shader => animateShader(shader, false);
      depth.customProgramCacheKey = () => "topography-plump-strand-depth-v4";
      const workpiece = new THREE.Group(); scene.add(workpiece);
      const vessel = new THREE.Mesh(geometry, clay);
      vessel.customDepthMaterial = depth;
      vessel.castShadow = true; vessel.receiveShadow = true; workpiece.add(vessel);
      const foot = new THREE.Mesh(new THREE.CylinderGeometry(form.baseRadius - 0.8, form.baseRadius - 0.8, 3, 128), claySurface());
      foot.position.y = 1.5; foot.castShadow = true; foot.receiveShadow = true; workpiece.add(foot);
      const nozzle = createNozzle(); workpiece.add(nozzle);
      const freshBead = new THREE.Mesh(new THREE.SphereGeometry(1, 20, 12), claySurface());
      freshBead.visible = false; freshBead.castShadow = true; freshBead.receiveShadow = true; workpiece.add(freshBead);
      const floor = new THREE.Mesh(new THREE.PlaneGeometry(2500, 2500), new THREE.MeshStandardMaterial({ color: "#e8dfd0", roughness: 1 }));
      floor.rotation.x = -Math.PI / 2; floor.position.y = -0.45; floor.receiveShadow = true; scene.add(floor);

      // The download always contains the finished work, independent of playback.
      renderer.render(scene, camera);
      const image = renderer.domElement.toDataURL("image/png");
      let elapsed = initiallyComplete ? completeAt : 0;
      let observedReplay = controls.current.replayKey;
      let observedViewReset = viewReset.current;
      let manualView = false, viewDirty = true, turnOffset = 0;
      orbit = new OrbitControls(camera, renderer.domElement);
      orbit.target.set(0, 126, 0);
      orbit.enablePan = false;
      // Inspection should stop exactly where the pointer or fingers stop.
      orbit.enableDamping = false;
      orbit.rotateSpeed = 0.6;
      orbit.zoomSpeed = 0.65;
      orbit.minZoom = 0.7; orbit.maxZoom = 2.6;
      orbit.minPolarAngle = 0.2; orbit.maxPolarAngle = 1.65;
      orbit.update(); orbit.saveState();
      const reportView = () => {
        container.dataset.viewAzimuth = orbit!.getAzimuthalAngle().toFixed(6);
        container.dataset.viewPolar = orbit!.getPolarAngle().toFixed(6);
        container.dataset.viewZoom = camera.zoom.toFixed(6);
        container.dataset.viewManual = String(manualView);
      };
      orbit.addEventListener("start", () => {
        manualView = true; viewDirty = true;
        container.dataset.dragging = "true";
        reportView(); onViewChange(true);
      });
      orbit.addEventListener("end", () => { container.dataset.dragging = "false"; });
      orbit.addEventListener("change", () => { viewDirty = true; reportView(); });
      reportView();
      const applyFrame = () => {
        const frame = topographyFrame(elapsed, form.layers.length);
        clockUniform.value = elapsed;
        geometry.setDrawRange(0, revealedIndices(buffers.reveal, frame.progress * form.layers.length));
        if (!manualView) workpiece.rotation.y = frame.rotation + turnOffset;
        frame.rotation = workpiece.rotation.y;
        const path = frame.progress * form.layers.length;
        const tip = sampleTopographyPath(form, path);
        nozzle.position.set(tip.x, tip.y + tip.height, tip.z);
        nozzle.visible = frame.phase === "printing";
        freshBead.position.set(tip.x, tip.y, tip.z);
        freshBead.scale.set(tip.width * 0.8, tip.height * 0.92, tip.width * 0.8);
        freshBead.visible = nozzle.visible && !tip.gap;
        // Source centerline coordinates describe the continuous toolpath itself.
        container.dataset.nozzleX = tip.x.toFixed(6); container.dataset.nozzleY = tip.y.toFixed(6);
        container.dataset.nozzleZ = tip.z.toFixed(6); container.dataset.nozzlePath = path.toFixed(8);
        container.dataset.nozzleVisible = String(nozzle.visible);
        container.dataset.nozzleFlowing = String(freshBead.visible);
        return frame;
      };
      const firstFrame = applyFrame();
      renderer.render(scene, camera);
      onReady(image, form.metrics); onFrame(firstFrame);

      const tick = (now: number) => {
        if (cancelled) return;
        try {
          let force = resizePending || controls.current.resetClock;
          if (controls.current.resetClock) { lastTime = null; controls.current.resetClock = false; }
          if (observedReplay !== controls.current.replayKey) {
            observedReplay = controls.current.replayKey; elapsed = 0; lastTime = null; force = true;
            if (!manualView) turnOffset = 0;
          }
          if (observedViewReset !== viewReset.current) {
            observedViewReset = viewReset.current;
            orbit!.reset();
            manualView = false; turnOffset = -topographyFrame(elapsed, form.layers.length).rotation;
            workpiece.rotation.y = 0; viewDirty = true; reportView(); onViewChange(false);
          }
          const active = controls.current.playing && !document.hidden && inView;
          if (active && lastTime !== null) elapsed += (now - lastTime) / 1000;
          lastTime = now;
          if (resizePending) {
            const width = Math.round(Math.min(1000, Math.max(390, container.clientWidth * Math.min(devicePixelRatio, 1.25))));
            renderer.setSize(width, Math.round(width * 1160 / 1000), false); resizePending = false;
          }
          orbit!.update();
          force ||= viewDirty;
          const frameInterval = elapsed < completeAt ? 1000 / 60 : 1000 / 30;
          if (force || (active && now - lastRender >= frameInterval)) {
            const frame = applyFrame();
            renderer.render(scene, camera); lastRender = now;
            if (force || now - lastReport >= 100) { onFrame(frame); lastReport = now; }
            viewDirty = false;
          }
          animationId = requestAnimationFrame(tick);
        } catch { dispose?.(); if (!cancelled) onError(); }
      };
      document.addEventListener("visibilitychange", resetClock);
      visibilityObserver = new IntersectionObserver(entries => {
        inView = entries[0]?.isIntersecting ?? true; lastTime = null;
      });
      visibilityObserver.observe(container);
      resizeObserver = new ResizeObserver(() => { resizePending = true; });
      resizeObserver.observe(container);
      animationId = requestAnimationFrame(tick);
    }).catch(() => { dispose?.(); if (!cancelled) onError(); });
    return () => { cancelled = true; dispose?.(); };
  }, [plan, initiallyComplete, onReady, onFrame, onViewChange, onError]);
  return <div className="topography-canvas" ref={host} role="img" aria-label="Three-dimensional memory vessel. Drag to rotate; scroll or pinch to zoom." />;
}
