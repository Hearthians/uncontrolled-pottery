import {forwardRef, useEffect, useImperativeHandle, useRef, useState} from 'react';
import * as THREE from 'three';
import {OrbitControls} from 'three/addons/controls/OrbitControls.js';
import {beadBuffers, writeBead, FLOATS_PER_MOVE, INDICES_PER_MOVE} from './beadGeometry.ts';
import {createBuildPlate} from './buildPlate.ts';
import {createClayMaterial, createLdmHead} from './clayAppearance.ts';
import type {Move, PathSample, Toolpath} from './toolpath.ts';

export type SceneHandle = {update: (sample: PathSample) => void; showToolpath: (visible: boolean) => void;
  turn: (angle: number) => void; resetView: () => void};
type Props = {path: Toolpath; initialSample: PathSample; toolpathVisible: boolean; showNozzle?: boolean; layers?: {renderMoves:Move[]}[]; isolated?:boolean;
  exhibit?: boolean; throughLayer?: number; onUnavailable?: () => void; onLayerPick?: (layer: number, extra?: {sourceType?: string; eventId?: number | null}) => void; framing?: {cameraY?: number; targetY?: number; span?: number}};
const scale = 0.1;

// Scene setup, partial-bead playback and disposal adapted from Prototype C ClayScene.
export const ClayScene = forwardRef<SceneHandle, Props>(function ClayScene({path, initialSample, toolpathVisible, showNozzle = true, layers, isolated=false, exhibit=false, throughLayer, onUnavailable, onLayerPick, framing}, ref) {
  const host = useRef<HTMLDivElement>(null);
  const refresh = useRef<((rows: NonNullable<Props['layers']>) => void) | null>(null);
  const revealLayers = useRef<((limit: number) => void) | null>(null);
  const actions = useRef<SceneHandle | null>(null);
  const [error, setError] = useState('');
  const cameraState = useRef<{position: THREE.Vector3; target: THREE.Vector3; zoom: number} | null>(null);
  useEffect(() => {actions.current?.showToolpath(toolpathVisible);}, [toolpathVisible, path]);
  useImperativeHandle(ref, () => ({
    update: sample => actions.current?.update(sample),
    showToolpath: visible => actions.current?.showToolpath(visible),
    turn: angle => actions.current?.turn(angle),
    resetView: () => actions.current?.resetView(),
  }), []);
  useEffect(() => {
    const container = host.current!;
    let renderer: THREE.WebGLRenderer;
    try { renderer = new THREE.WebGLRenderer({antialias: true, alpha: exhibit}); }
    catch { setError('The 3D preview needs WebGL. Try a browser with hardware acceleration enabled.'); onUnavailable?.(); return; }
    renderer.setPixelRatio(Math.min(devicePixelRatio, 1.25));
    renderer.setClearColor('#eee7dd', exhibit ? 0 : 1);
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.domElement.setAttribute('aria-label', exhibit ? '年度陶土器形，可拖动旋转' : isolated?'Isolated deposited sagging event':'Twisted vessel, printing toolpath and nozzle');
    renderer.domElement.setAttribute('role', 'img');
    container.appendChild(renderer.domElement);
    const scene = new THREE.Scene();
    const camera = new THREE.OrthographicCamera(-10, 10, 10, -10, 0.01, 500);
    camera.position.set(17, framing?.cameraY ?? (exhibit ? 13 : layers ? 10 : 17), 20);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.target.set(0, framing?.targetY ?? 5, 0); controls.enableDamping = true; controls.enablePan = false;
    controls.minZoom = 0.65; controls.maxZoom = 2.4; controls.maxPolarAngle = isolated ? Math.PI / 2 - 0.03 : Math.PI;
    controls.saveState();
    if (cameraState.current) {camera.position.copy(cameraState.current.position); controls.target.copy(cameraState.current.target); camera.zoom = cameraState.current.zoom;}
    let needsRender=true;
    if (layers) controls.addEventListener('change',()=>{
      needsRender=true;
      container.dataset.camera=JSON.stringify([...camera.position.toArray(),camera.zoom]);
    });
    scene.add(new THREE.HemisphereLight('#fff7ed', '#c6b6a2', exhibit ? 1.35 : 2.5));
    const key = new THREE.DirectionalLight('#fff4e7', exhibit ? 2.8 : 1.6); key.position.set(-4, 7, 5); scene.add(key);
    const fill = new THREE.DirectionalLight('#edf0f2', exhibit ? 1.35 : 1.2); fill.position.set(3, 4, -4); scene.add(fill);

    // Build plate top is exactly Z=0. Scene conversion is (x,z,-y)/10.
    const plate = isolated || exhibit ? null : createBuildPlate();
    if(plate) scene.add(plate);
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(200, 200), new THREE.MeshStandardMaterial({color: '#eee7dd', roughness: 1}));
    floor.rotation.x = -Math.PI / 2; floor.position.y = -0.23; floor.visible=!isolated && !exhibit; scene.add(floor);

    const data = beadBuffers(layers ? {moves:[]} : path);
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(data.positions, 3));
    geometry.setAttribute('normal', new THREE.BufferAttribute(data.normals, 3));
    geometry.setIndex(new THREE.BufferAttribute(data.indices, 1));
    const material = createClayMaterial();
    if (exhibit) material.color.set('#a86b4d');
    const mesh = new THREE.Mesh(geometry, material);
    const positions = new Float32Array(FLOATS_PER_MOVE), normals = new Float32Array(FLOATS_PER_MOVE);
    const partialGeometry = new THREE.BufferGeometry();
    partialGeometry.setAttribute('position', new THREE.BufferAttribute(positions, 3).setUsage(THREE.DynamicDrawUsage));
    partialGeometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3).setUsage(THREE.DynamicDrawUsage));
    partialGeometry.setIndex(new THREE.BufferAttribute(data.indices.slice(0, INDICES_PER_MOVE), 1));
    const partial = new THREE.Mesh(partialGeometry, material);
    for (const object of [mesh, partial]) {
      object.rotation.x = -Math.PI / 2; object.scale.setScalar(scale); object.frustumCulled = false; scene.add(object);
    }
    const linePoints = new Float32Array(layers ? 0 : path.moves.length * 6);
    if (!layers) path.moves.forEach((m, i) => linePoints.set([...m.start, ...m.end], i * 6));
    const linesGeometry = new THREE.BufferGeometry(); linesGeometry.setAttribute('position', new THREE.BufferAttribute(linePoints, 3));
    const lines = new THREE.LineSegments(linesGeometry, new THREE.LineBasicMaterial({color: '#3f685a', transparent: true, opacity: 0.3}));
    lines.rotation.x = -Math.PI / 2; lines.scale.setScalar(scale); lines.visible = toolpathVisible; scene.add(lines);
    // Illustrative outlet only: its lower face is the command's nozzle-tip position.
    const nozzle = createLdmHead(); nozzle.visible = showNozzle; scene.add(nozzle);
    const deposited = new THREE.Group();
    deposited.rotation.x=-Math.PI/2; deposited.scale.setScalar(scale); scene.add(deposited);
    const prior: Move[][] = [];
    let focusKey='';
    refresh.current = rows => {
      let count=0;
      container.querySelector('output')!.textContent='';
      rows.forEach(({renderMoves},index)=>{
        if (prior[index]!==renderMoves) {
          const buffers=beadBuffers({moves:renderMoves});
          const clay=new THREE.BufferGeometry();
          clay.setAttribute('position',new THREE.BufferAttribute(buffers.positions,3));
          clay.setAttribute('normal',new THREE.BufferAttribute(buffers.normals,3));
          clay.setIndex(new THREE.BufferAttribute(buffers.indices,1));
          if (!prior[index]) deposited.add(new THREE.Mesh(clay,material));
          else {
            const wall=deposited.children[index] as THREE.Mesh;
            wall.geometry.dispose(); wall.geometry=clay;
          }
          const wall=deposited.children[index] as THREE.Mesh;
          const segments=renderMoves.filter(move=>move.extrude);
          const eventId=isolated ? segments.find(move=>move.eventId!=null)?.eventId : null;
          wall.userData={layerId:segments[0]?.layerId,eventId,sourceType:'deposited-clay',segments};
          if(isolated && segments.length){
            const guide=new THREE.BufferGeometry().setFromPoints(renderMoves.flatMap(move=>[new THREE.Vector3(...move.start),new THREE.Vector3(...move.end)]));
            lines.geometry.dispose();lines.geometry=guide;
            lines.userData={layerId:wall.userData.layerId,eventId,sourceType:'nozzle-guide'};
            container.dataset.layerId=String(wall.userData.layerId);
            container.dataset.eventId=String(eventId);
            container.dataset.sourceType=wall.userData.sourceType;
            guide.computeBoundingSphere();
            const sphere=guide.boundingSphere!, centre=sphere.center;
            const key=[wall.userData.layerId,eventId,centre.x,centre.y,sphere.radius].join(':');
            if(focusKey!==key){
              controls.target.set(centre.x*scale,(centre.z-3)*scale,-centre.y*scale);
              const radial=new THREE.Vector3(centre.x,0,-centre.y).normalize();
              camera.position.copy(controls.target).addScaledVector(radial,15);camera.position.y+=2;
              controls.maxZoom=300;camera.zoom=Math.min(300,6/Math.max(0.7,sphere.radius*scale));
              camera.updateProjectionMatrix();controls.update();focusKey=key;
            }
          }
          prior[index]=renderMoves;
        }
        count+=(deposited.children[index] as THREE.Mesh).geometry.index!.count;
      });
      needsRender=true;
      container.dataset.depositedIndices=String(count);
      container.dataset.revision=String(Number(container.dataset.revision??0)+1);
    };
    revealLayers.current = limit => {
      const visible = Math.min(deposited.children.length, limit);
      deposited.children.forEach((mesh, index) => {mesh.visible = index < visible;});
      container.dataset.visibleLayers = String(visible);
      needsRender = true;
    };
    actions.current = {
      turn(angle) {
        const offset = camera.position.clone().sub(controls.target);
        offset.applyAxisAngle(new THREE.Vector3(0, 1, 0), angle);
        camera.position.copy(controls.target).add(offset);
        controls.update();
      },
      resetView() {controls.reset();},
      update(sample) {
        const move = path.moves[sample.moveIndex];
        geometry.setDrawRange(0, data.indexBefore[sample.moveIndex]);
        partial.visible = move.extrude && sample.fraction > 0;
        if (partial.visible) {
          writeBead(move, sample.fraction, positions, normals);
          partialGeometry.getAttribute('position').needsUpdate = true;
          partialGeometry.getAttribute('normal').needsUpdate = true;
        }
        const [x, y, z] = sample.position; nozzle.position.set(x * scale, z * scale, -y * scale);
        container.dataset.extruding = String(move.extrude);
        container.dataset.partialVisible = String(partial.visible);
        container.dataset.completedIndices = String(data.indexBefore[sample.moveIndex]);
        container.dataset.move = String(sample.moveIndex);
        container.dataset.nozzle = JSON.stringify(sample.position);
        container.dataset.depositedIndices = String(data.indexBefore[sample.moveIndex] + (partial.visible ? INDICES_PER_MOVE : 0));
      },
      showToolpath(visible) {needsRender=true; lines.visible = visible && (!layers || isolated); container.dataset.toolpath = String(lines.visible);},
    };
    if (layers) partial.visible=false; else actions.current.update(initialSample);
    actions.current.showToolpath(toolpathVisible);
    const resize = () => {
      const width = container.clientWidth, height = container.clientHeight;
      if (!width || !height) return;
      const aspect = width / height, span = (framing?.span ?? (exhibit ? 13.3 : 17)) / Math.min(1, aspect);
      camera.left = -span * aspect / 2; camera.right = span * aspect / 2;
      camera.top = span / 2; camera.bottom = -span / 2;
      camera.updateProjectionMatrix(); renderer.setSize(width, height); needsRender=true;
    };
    const observer = new ResizeObserver(resize); observer.observe(container); resize();
    const pick=(event:MouseEvent)=>{
      const rect=renderer.domElement.getBoundingClientRect(), ray=new THREE.Raycaster();
      ray.setFromCamera(new THREE.Vector2((event.clientX-rect.left)/rect.width*2-1,1-(event.clientY-rect.top)/rect.height*2),camera);
      const hit=ray.intersectObjects(deposited.children.filter(mesh => mesh.visible),false)[0];
      const move:Move|undefined=hit?.object.userData.segments[Math.floor((hit.faceIndex??0)*3/INDICES_PER_MOVE)];
      if (onLayerPick && move) {onLayerPick(move.layerId, {sourceType: move.sourceType, eventId: move.eventId ?? null}); return;}
      container.querySelector('output')!.textContent=move?'Layer '+move.layerId+' · '+(move.sourceType??move.kind)+' · '+(move.eventId?'event '+move.eventId:'no event'):'';
    };
    if(layers) renderer.domElement.addEventListener('dblclick',pick);
    let frame = 0;
    const draw = () => {
      frame=requestAnimationFrame(draw);
      controls.update();
      if(layers && !needsRender)return;
      if(plate) plate.visible = floor.visible = camera.position.y >= 0;
      renderer.render(scene,camera);
      needsRender=false;
      if(layers)container.dataset.geometries=String(renderer.info.memory.geometries);
    };
    draw();
    const lost = (event: Event) => {event.preventDefault(); setError('The graphics context was lost. Reload to restore the preview.'); onUnavailable?.();};
    renderer.domElement.addEventListener('webglcontextlost', lost);
    return () => {
      cameraState.current = {position: camera.position.clone(), target: controls.target.clone(), zoom: camera.zoom};
      cancelAnimationFrame(frame); observer.disconnect(); controls.dispose(); actions.current = null; refresh.current=null; revealLayers.current=null;
      renderer.domElement.removeEventListener('webglcontextlost', lost);
      renderer.domElement.removeEventListener('dblclick',pick);
      const materials = new Set<THREE.Material>();
      scene.traverse(object => {
        if (object instanceof THREE.Mesh || object instanceof THREE.Line) {
          object.geometry.dispose();
          for (const mat of Array.isArray(object.material) ? object.material : [object.material]) materials.add(mat);
        }
      });
      materials.forEach(m => m.dispose()); renderer.dispose(); renderer.forceContextLoss(); renderer.domElement.remove();
    };
  }, [layers ? null : path, layers ? null : initialSample, showNozzle, isolated, exhibit, onUnavailable, onLayerPick, framing]);
  useEffect(() => {if(layers) refresh.current?.(layers);}, [layers]);
  useEffect(() => {
    if (throughLayer !== undefined) revealLayers.current?.(throughLayer);
  }, [throughLayer, layers]);
  return <div className="clay-scene" ref={host} data-testid={isolated?'event-clay':'scene'}>{layers && <output className="clay-source" aria-live="polite"/>}{error && <p className="scene-error" role="alert">{error}</p>}</div>;
});
