import * as THREE from "three";

export function createClayMaterial() {
  const material = new THREE.MeshStandardMaterial({
    color: "#79503c", roughness: .98, metalness: 0, side: THREE.DoubleSide,
  });
  material.onBeforeCompile = shader => {
    shader.vertexShader = "varying vec3 vClayPosition;\n" + shader.vertexShader;
    shader.vertexShader = shader.vertexShader.replace("#include <begin_vertex>",
      "#include <begin_vertex>\nvClayPosition = position;");
    shader.fragmentShader = `varying vec3 vClayPosition;
      float clayHash(vec3 p) { return fract(sin(dot(p, vec3(127.1,311.7,74.7))) * 43758.5453); }
      float clayNoise(vec3 p) {
        vec3 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f);
        return mix(mix(mix(clayHash(i),clayHash(i+vec3(1,0,0)),f.x),
          mix(clayHash(i+vec3(0,1,0)),clayHash(i+vec3(1,1,0)),f.x),f.y),
          mix(mix(clayHash(i+vec3(0,0,1)),clayHash(i+vec3(1,0,1)),f.x),
          mix(clayHash(i+vec3(0,1,1)),clayHash(i+vec3(1,1,1)),f.x),f.y),f.z);
      }
    ` + shader.fragmentShader;
    shader.fragmentShader = shader.fragmentShader.replace("#include <color_fragment>",
      `#include <color_fragment>
      float grain = clayNoise(vClayPosition * 9.0);
      float mottling = clayNoise(vClayPosition * 1.2);
      // Fade subpixel pores to avoid shimmer as the view moves or zooms out.
      float poreWeight = 1.0 - smoothstep(.35, 1.2, length(fwidth(vClayPosition * 24.0)));
      float pores = (clayNoise(vClayPosition * 24.0) - .5) * poreWeight;
      diffuseColor.rgb *= .91 + .07 * mottling + .11 * grain + .07 * pores;`);
    shader.fragmentShader = shader.fragmentShader.replace("#include <roughnessmap_fragment>",
      "#include <roughnessmap_fragment>\nroughnessFactor = clamp(roughnessFactor + (grain-.5)*.03,.95,1.0);");
    shader.fragmentShader = shader.fragmentShader.replace("#include <normal_fragment_maps>",
      `#include <normal_fragment_maps>
      // Micropores perturb shading only; coordinates and silhouettes stay unchanged.
      float relief = .0015 * grain + .0004 * mottling + .0005 * pores;
      vec3 sx = dFdx(-vViewPosition), sy = dFdy(-vViewPosition);
      vec3 rx = cross(sy, normal), ry = cross(normal, sx);
      float det = dot(sx, rx);
      normal = normalize(abs(det)*normal - sign(det)*(dFdx(relief)*rx+dFdy(relief)*ry));`);
  };
  material.customProgramCacheKey = () => "terracotta-earth-grain-v3";
  return material;
}

// External silhouette from WASP's 2019 2040 Clay manual, p.33.
// Proportions are illustrative, not measured CAD. No invented internal mechanism.
export function createLdmHead() {
  const head = new THREE.Group();
  const aluminium = new THREE.MeshStandardMaterial({ color: "#aeb1ad", metalness: .72, roughness: .32 });
  const dark = new THREE.MeshStandardMaterial({ color: "#292c2c", metalness: .25, roughness: .5 });
  const body = new THREE.MeshStandardMaterial({ color: "#cccac0", metalness: .2, roughness: .47 });
  const add = (geometry: THREE.BufferGeometry, material: THREE.Material, x: number, y: number, z = 0) => {
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(x, y, z); mesh.castShadow = true; head.add(mesh); return mesh;
  };
  // Metal outlet terminates exactly at local (0,0,0), which is the path position.
  add(new THREE.CylinderGeometry(.065, .025, .16, 24), aluminium, 0, .08);
  add(new THREE.CylinderGeometry(.13, .13, .24, 32), body, 0, .28);
  add(new THREE.CylinderGeometry(.29, .29, .045, 3), aluminium, 0, .42);
  add(new THREE.CylinderGeometry(.19, .19, .65, 32), body, 0, .765);
  add(new THREE.BoxGeometry(.48, .075, .48), aluminium, 0, 1.125);
  add(new THREE.BoxGeometry(.46, .43, .46), dark, 0, 1.375);
  add(new THREE.BoxGeometry(.48, .06, .48), aluminium, 0, 1.62);
  // Visible side push-fit and cooling fan. No animated screw or invented delta linkage.
  const inlet = add(new THREE.CylinderGeometry(.11, .11, .18, 6), aluminium, .25, .84);
  inlet.rotation.z = Math.PI / 2;
  const collar = add(new THREE.CylinderGeometry(.085, .085, .04, 24), dark, .36, .84);
  collar.rotation.z = Math.PI / 2;
  add(new THREE.BoxGeometry(.07, .34, .34), dark, -.28, 1.37);
  const fan = add(new THREE.CylinderGeometry(.14, .14, .025, 24), aluminium, -.325, 1.37);
  fan.rotation.z = Math.PI / 2;
  for (const radius of [.06, .1, .135]) {
    const grill = add(new THREE.TorusGeometry(radius, .006, 4, 24), dark, -.342, 1.37);
    grill.rotation.y = Math.PI / 2;
  }
  return head;
}
