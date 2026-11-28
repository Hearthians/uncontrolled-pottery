import {useEffect, useRef, useState} from 'react';
import * as THREE from 'three';
import {OrbitControls} from 'three/addons/controls/OrbitControls.js';
import {createClayMaterial} from './clayAppearance.ts';
import {flutedGeometry} from './flutedGeometry.ts';
import type {FluteHit} from './flutedGeometry.ts';
import type {FluteMonth} from './flutedMapping.ts';

function floorShadow() {
  const shadow = new THREE.Mesh(new THREE.PlaneGeometry(13.6, 13.6), new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    vertexShader: 'varying vec2 p; void main(){p=2.0*uv-1.0;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}',
    fragmentShader: 'varying vec2 p; void main(){float r=dot(p,p);gl_FragColor=vec4(.25,.18,.14,.31*exp(-5.5*r)*(1.0-smoothstep(.45,1.0,r)));}',
  }));
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.set(.18, -.035, -.06);
  return shadow;
}

export function FlutedScene({months, label, onPick}: {
  months: FluteMonth[]; label: string; onPick: (hit: FluteHit) => void;
}) {
  const host = useRef<HTMLDivElement>(null);
  const callback = useRef(onPick);
  const [error, setError] = useState('');
  useEffect(() => {callback.current = onPick;}, [onPick]);

  useEffect(() => {
    const container = host.current!;
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({antialias: true, alpha: true});
    } catch {
      setError('WebGL is unavailable. Use the month buttons to inspect the data.');
      return;
    }
    renderer.setPixelRatio(Math.min(devicePixelRatio, 1.35));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.setClearColor(0, 0);
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.26;
    const canvas = renderer.domElement;
    canvas.setAttribute('role', 'img');
    canvas.setAttribute('aria-label', `${label} clay vase. Drag to rotate. Double-click a flute to inspect it.`);
    container.append(canvas);

    const scene = new THREE.Scene();
    const camera = new THREE.OrthographicCamera(-7, 7, 7, -7, .1, 150);
    camera.position.set(7, 15.45, 26);
    const controls = new OrbitControls(camera, canvas);
    controls.target.set(0, 6.35, 0);
    controls.enablePan = false;
    controls.minZoom = .75;
    controls.maxZoom = 2.4;
    controls.maxPolarAngle = Math.PI / 2 - .03;
    controls.update();

    scene.add(new THREE.HemisphereLight('#fff5e9', '#574235', 1.42));
    const key = new THREE.DirectionalLight('#fff6ec', 2.45);
    key.position.set(-7, 13, 6);
    scene.add(key);
    const bounce = new THREE.DirectionalLight('#e4e6ec', .55);
    bounce.position.set(5, 2, 5);
    scene.add(bounce);

    const geometry = flutedGeometry(months);
    const material = createClayMaterial();
    material.color.set('#a18577');
    material.side = THREE.FrontSide;
    material.vertexColors = true;
    const vessel = new THREE.Mesh(geometry.mesh, material);
    const shadow = floorShadow();
    scene.add(vessel, shadow);

    let frame = 0;
    function schedule() {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        renderer.render(scene, camera);
        container.dataset.depositedIndices = String(geometry.mesh.index!.count);
      });
    }
    function resize() {
      const width = container.clientWidth, height = container.clientHeight;
      if (!width || !height) return;
      const aspect = width / height;
      const span = Math.max(15.35, 11 / aspect);
      camera.left = -.5 * span * aspect;
      camera.right = .5 * span * aspect;
      camera.top = .5 * span;
      camera.bottom = -.5 * span;
      camera.updateProjectionMatrix();
      renderer.setSize(width, height);
      schedule();
    }

    const ray = new THREE.Raycaster();
    function pick(event: MouseEvent) {
      const bounds = canvas.getBoundingClientRect();
      ray.setFromCamera(new THREE.Vector2(2 * (event.clientX - bounds.left) / bounds.width - 1,
        1 - 2 * (event.clientY - bounds.top) / bounds.height), camera);
      const result = ray.intersectObject(vessel, false)[0];
      if (result?.faceIndex != null) callback.current(geometry.locate(result.faceIndex));
    }
    function lost(event: Event) {
      event.preventDefault();
      setError('The graphics context was lost. Reload the page or inspect the data using the month buttons.');
    }

    controls.addEventListener('change', schedule);
    canvas.addEventListener('dblclick', pick);
    canvas.addEventListener('webglcontextlost', lost);
    const observer = new ResizeObserver(resize);
    observer.observe(container);
    resize();

    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
      controls.dispose();
      canvas.removeEventListener('dblclick', pick);
      canvas.removeEventListener('webglcontextlost', lost);
      canvas.remove();
      delete container.dataset.depositedIndices;
      geometry.mesh.dispose();
      material.dispose();
      shadow.geometry.dispose();
      shadow.material.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
    };
  }, [months, label]);

  return <div className="fv-scene" ref={host}>{error && <p className="fv-scene-error" role="alert">{error}</p>}</div>;
}
