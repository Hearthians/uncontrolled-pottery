import * as THREE from 'three';
import {createClayMaterial} from './clayAppearance.ts';
import {flutedGeometry} from './flutedGeometry.ts';
import type {FluteMonth} from './flutedMapping.ts';

type PendingView = {months: FluteMonth[]; onError: (error: unknown) => void};

export function createScrollRenderer(onContextLost: () => void) {
  const renderer = new THREE.WebGLRenderer({antialias: true, alpha: true});
  renderer.setPixelRatio(Math.min(devicePixelRatio, 1.25));
  renderer.setClearColor(0, 0);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.26;

  const scene = new THREE.Scene();
  const camera = new THREE.OrthographicCamera(-7, 7, 7, -7, .1, 150);
  camera.position.set(7, 15.45, 26);
  camera.lookAt(0, 6.35, 0);
  scene.add(new THREE.HemisphereLight('#fff5e9', '#574235', 1.42));
  const key = new THREE.DirectionalLight('#fff6ec', 2.45);
  key.position.set(-7, 13, 6);
  scene.add(key);
  const bounce = new THREE.DirectionalLight('#e4e6ec', .55);
  bounce.position.set(5, 2, 5);
  scene.add(bounce);

  const clay = createClayMaterial();
  clay.color.set('#a18577');
  clay.side = THREE.FrontSide;
  clay.vertexColors = true;

  const shadow = new THREE.Mesh(new THREE.PlaneGeometry(13.6, 13.6), new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    vertexShader: 'varying vec2 p; void main(){p=2.0*uv-1.0;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}',
    fragmentShader: 'varying vec2 p; void main(){float r=dot(p,p);gl_FragColor=vec4(.25,.18,.14,.31*exp(-5.5*r)*(1.0-smoothstep(.45,1.0,r)));}',
  }));
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.set(.18, -.035, -.06);
  scene.add(shadow);

  const pending = new Map<HTMLCanvasElement, PendingView>();
  const size = new THREE.Vector2();
  let frame = 0;
  let lost = false;

  function draw(canvas: HTMLCanvasElement, months: FluteMonth[]) {
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    if (!width || !height) return;
    const ratio = width / height;
    const span = Math.max(15.15, 11 / ratio);
    camera.left = -.5 * span * ratio;
    camera.right = .5 * span * ratio;
    camera.top = .5 * span;
    camera.bottom = -.5 * span;
    camera.updateProjectionMatrix();
    renderer.getSize(size);
    if (size.x !== width || size.y !== height) renderer.setSize(width, height, false);

    const {mesh} = flutedGeometry(months);
    const vessel = new THREE.Mesh(mesh, clay);
    scene.add(vessel);
    try {
      renderer.render(scene, camera);
      canvas.width = renderer.domElement.width;
      canvas.height = renderer.domElement.height;
      const bitmap = canvas.getContext('2d');
      if (!bitmap) throw Error('Canvas is unavailable.');
      bitmap.drawImage(renderer.domElement, 0, 0);
      canvas.dataset.depositedIndices = String(mesh.index!.count);
    } finally {
      scene.remove(vessel);
      mesh.dispose();
    }
  }

  function schedule() {
    if (frame || lost || !pending.size) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      const next = pending.entries().next().value;
      if (!next) return;
      const [canvas, view] = next;
      pending.delete(canvas);
      try {
        if (canvas.isConnected) draw(canvas, view.months);
      } catch (error) {
        view.onError(error);
      }
      schedule();
    });
  }

  function contextLost(event: Event) {
    event.preventDefault();
    lost = true;
    pending.clear();
    cancelAnimationFrame(frame);
    onContextLost();
  }
  renderer.domElement.addEventListener('webglcontextlost', contextLost);

  return {
    enqueue(canvas: HTMLCanvasElement, months: FluteMonth[], onError: PendingView['onError']) {
      if (lost) return;
      pending.set(canvas, {months, onError});
      schedule();
    },
    cancel(canvas: HTMLCanvasElement) {pending.delete(canvas);},
    dispose() {
      cancelAnimationFrame(frame);
      pending.clear();
      renderer.domElement.removeEventListener('webglcontextlost', contextLost);
      shadow.geometry.dispose();
      shadow.material.dispose();
      clay.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
    },
  };
}

export type ScrollRenderer = ReturnType<typeof createScrollRenderer>;
