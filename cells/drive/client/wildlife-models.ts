import * as THREE from 'three';

export const LEG = [.92, .82, 1.12];
export const HIP_X = [.20, .32, .24];
export const HIP_Z = [[.48, -.48], [.6, -.6], [.62, -.66]];
export const hip = (sp: number, leg: number): [number, number, number] =>
  [HIP_X[sp] * (leg % 2 ? 1 : -1), LEG[sp], HIP_Z[sp][leg < 2 ? 0 : 1]];

// Separate from the world's box/merge helpers: every vertex retains its joint.
function shape(air: boolean, sp: number): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const add = (g: THREE.BufferGeometry, col: number, joint = 0, pivot = [0, 0, 0]) => {
    if (g.index) { const old = g; g = g.toNonIndexed(); old.dispose(); }
    const n = g.attributes.position.count, c = new THREE.Color(col);
    const colours = new Float32Array(n * 3), joints = new Float32Array(n * 4);
    for (let i = 0; i < n; i++) { colours.set([c.r, c.g, c.b], i * 3); joints.set([...pivot, joint], i * 4); }
    g.setAttribute('color', new THREE.BufferAttribute(colours, 3));
    g.setAttribute('aJoint', new THREE.BufferAttribute(joints, 4)); parts.push(g);
  };
  const oval = (p: number[], size: number[], col: number, joint = 0, pivot = [0, 0, 0], tilt = 0) => {
    const g = air && size[0]<.04 ? new THREE.OctahedronGeometry(1, 0) : new THREE.SphereGeometry(1, air ? 6 : 7, air ? 3 : 4);
    g.scale(size[0] / 2, size[1] / 2, size[2] / 2); g.rotateX(tilt); g.translate(p[0], p[1], p[2]);
    add(g, col, joint, pivot);
  };
  const bone = (a: number[], b: number[], radius: number, col: number, joint = 0, pivot = [0, 0, 0]) => {
    const av = new THREE.Vector3(...a as [number, number, number]), bv = new THREE.Vector3(...b as [number, number, number]);
    const d = bv.clone().sub(av), g = new THREE.CylinderGeometry(radius * .7, radius, d.length(), 5, 1);
    g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.clone().normalize()));
    g.translate(...av.add(bv).multiplyScalar(.5).toArray() as [number, number, number]); add(g, col, joint, pivot);
  };
  if (air) {
    const span = [1.48, 1.06, 1.78][sp], len = [.78, .65, .98][sp];
    oval([0, 0, 0], [.23, .24, len], 0xc2c2bc);
    oval([0, .09, len * .4], [.21, .23, .28], 0xe0dfd5);
    bone([0, .06, len * .5], [0, .015, len * .72], .06, sp === 0 ? 0xb9994b : 0x5d5549);
    for (const side of [-1, 1]) {
      oval([side * .098, .12, len * .49], [.025, .03, .032], 0x111417);
      // Closed, shallow wedge panels give both a top and an underside; the
      // wrist folds independently, with a tapered feather edge at the tip.
      for (let outer = 0; outer < 2; outer++) {
        const x0 = side * (outer ? span * .53 : .08), x1 = side * span;
        const end = outer ? x1 : side * span * .53;
        const p = [x0, .015, .15, end, 0, outer ? -.15 : .02, end, 0, outer ? -.36 : -.32, x0, .015, -.27];
        const verts: number[] = [];
        const face = (a: number, b: number, c: number, dy: number) => {
          for (const i of [a, b, c]) verts.push(p[i * 3], p[i * 3 + 1] + dy, p[i * 3 + 2]);
        };
        // Correct top winding on each side, and a separate underside.
        for (const dy of [0, -.035]) {
          const flip = (side > 0) !== (dy < 0);
          for (const f of [[0, 1, 2], [0, 2, 3]]) face(f[0], f[flip ? 2 : 1], f[flip ? 1 : 2], dy);
        }
        for (let i = 0; i < 4; i++) {
          const j = (i + 1) % 4;
          for (const [k, dy] of [[i, 0], [j, 0], [j, -.035], [i, 0], [j, -.035], [i, -.035]])
            verts.push(p[k * 3], p[k * 3 + 1] + dy, p[k * 3 + 2]);
        }
        const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3)); g.computeVertexNormals();
        add(g, outer ? 0x9e9e9b : 0xc3c3bb, outer ? 2 : 1, [side * .08, 0, 0]);
      }
      oval([side * .10, -.015, -len * .52], [.22, .065, .42], 0x858680, 3, [0, 0, -len * .3]);
    }
  } else {
    const body = [0x98724b, 0x67503b, 0x805a3e][sp], dark = [0x604630, 0x342a23, 0x3d2c23][sp];
    const headPivot = sp === 1 ? [0, 1.05, .75] : [0, sp === 0 ? 1.2 : 1.5, .5];
    oval([0, sp === 0 ? 1.02 : 1.3, sp === 1 ? -.30 : -.1],
      sp === 0 ? [.58, .66, 1.42] : sp === 1 ? [.99, .98, 1.95] : [.70, .86, 1.92], body);
    if (sp === 1) {
      oval([0, 1.48, .43], [1.10, 1.26, 1.22], body);
      oval([0, 1, 1.22], [.65, .64, .76], dark, 9, headPivot);
      oval([0, .67, 1.27], [.4, .48, .35], 0x2f251e, 9, headPivot);
      for (const s of [-1, 1]) {
        bone([s * .24, 1.22, 1.20], [s * .53, 1.31, 1.17], .07, 0xb8ac91, 9, headPivot);
        bone([s * .53, 1.31, 1.17], [s * .50, 1.48, 1.17], .045, 0xcec2a6, 9, headPivot);
      }
    } else {
      const deer = sp === 0, y = deer ? 1.69 : 2.06, z = deer ? .88 : 1.10;
      oval([0, deer ? 1.38 : 1.72, deer ? .58 : .72], [deer ? .30 : .36, deer ? .72 : .88, .4], body, 9, headPivot, .38);
      oval([0, y, z], [.26, .29, deer ? .49 : .65], body, 9, headPivot);
      oval([0, y - .065, z + (deer ? .21 : .30)], [.22, .18, .19], dark, 9, headPivot);
      for (const s of [-1, 1]) {
        oval([s * .17, y + .15, z - .14], [.15, .29, .08], body, 9, headPivot);
        oval([s * .123, y + .055, z + .07], [.027, .035, .039], 0x101316, 9, headPivot);
        if (deer) {
          bone([s * .09, y + .12, z - .14], [s * .16, y + .53, z - .18], .027, 0xc5b696, 9, headPivot);
          bone([s * .14, y + .37, z - .17], [s * .32, y + .5, z - .10], .02, 0xc5b696, 9, headPivot);
          bone([s * .14, y + .35, z - .17], [s * .10, y + .45, z + .07], .02, 0xc5b696, 9, headPivot);
        }
      }
      if (!deer) oval([0, 1.93, .60], [.16, .58, .58], dark, 9, headPivot, .38);
    }
    const tail = [0, sp === 0 ? 1.12 : 1.4, sp === 0 ? -.68 : -1.0];
    oval([0, tail[1] - .19, tail[2] - .06], [sp === 2 ? .23 : .13, sp === 0 ? .28 : .67, .17], sp === 0 ? 0xd8c9ad : dark, 10, tail);
    for (let l = 0; l < 4; l++) {
      const h = hip(sp, l), knee = [h[0], h[1] / 2, h[2]], foot = [h[0], .065, h[2]];
      oval([h[0], h[1]+.16, h[2]], [sp===1?.34:.23, .48, .34], body);
      bone(h, knee, sp === 1 ? .11 : .065, body, l + 1, h);
      bone(knee, foot, sp === 1 ? .073 : .044, dark, l + 5, h);
      oval([h[0], .065, h[2] + .035], [sp === 1 ? .21 : .13, .13, .19], 0x332e29, l + 5, h);
    }
  }
  const out = new THREE.BufferGeometry();
  for (const [name, size] of [['position', 3], ['normal', 3], ['color', 3], ['aJoint', 4]] as const) {
    const all = new Float32Array(parts.reduce((n, g) => n + g.attributes[name].array.length, 0));
    let off = 0; for (const g of parts) { all.set(g.attributes[name].array, off); off += g.attributes[name].array.length; }
    out.setAttribute(name, new THREE.BufferAttribute(all, size));
  }
  for (const p of parts) p.dispose(); out.computeBoundingSphere(); return out;
}

function deformGLSL(air: boolean, sp: number): string {
  return `
attribute vec4 aJoint, aPose;
${air ? '' : 'attribute vec4 aFeetX, aFeetY, aFeetZ;'}
mat3 wildRX(float a){float c=cos(a),s=sin(a);return mat3(1.,0.,0.,0.,c,s,0.,-s,c);}
mat3 wildRZ(float a){float c=cos(a),s=sin(a);return mat3(c,s,0.,-s,c,0.,0.,0.,1.);}
mat3 wildBone(vec3 d){vec3 y=-normalize(d);vec3 x=normalize(cross(y,vec3(0.,0.,1.)));return mat3(x,y,cross(x,y));}
void wildDeform(inout vec3 p,inout vec3 n){
float j=aJoint.w;vec3 h=aJoint.xyz;mat3 r=mat3(1.);
${air ? `
if(j>.5&&j<2.5){float side=sign(h.x);float flap=(sin(aPose.x)+.23*sin(2.*aPose.x)) * aPose.w;
if(j>1.5){vec3 wrist=vec3(side*${([1.48,1.06,1.78][sp]*.53).toFixed(4)},0.,0.);r=wildRZ(side*(.20*aPose.w+.28*cos(aPose.x+.7)*aPose.w));p=wrist+r*(p-wrist);n=r*n;}
r=wildRZ(side*flap);p=h+r*(p-h);n=r*n;
}else if(j>2.5){r=wildRX(.07*sin(aPose.x*.4));p=h+r*(p-h);n=r*n;}` : `
if(j>.5&&j<8.5){float leg=mod(j-1.,4.);vec4 mask=leg<.5?vec4(1.,0.,0.,0.):leg<1.5?vec4(0.,1.,0.,0.):leg<2.5?vec4(0.,0.,1.,0.):vec4(0.,0.,0.,1.);
vec3 target=vec3(dot(aFeetX,mask),dot(aFeetY,mask),dot(aFeetZ,mask));
float len=${LEG[sp].toFixed(4)};vec3 delta=target-h;float reach=clamp(length(delta),.08,len*.997);vec3 dir=normalize(delta+vec3(0.,-.00001,0.));target=h+dir*reach;
vec3 bend=vec3(0.,0.,leg<1.5?1.:-1.);bend=normalize(bend-dir*dot(bend,dir)+vec3(.00001,0.,0.));
vec3 knee=h+dir*reach*.5+bend*sqrt(max(0.,len*len*.25-reach*reach*.25));
if(j<4.5){r=wildBone(knee-h);p=h+r*(p-h);}else{r=wildBone(target-knee);p=knee+r*(p-(h-vec3(0.,len*.5,0.)));}n=r*n;
}else if(j>8.5){r=j<9.5?wildRX(.045*sin(aPose.x+.6)*aPose.y):wildRZ(.18*sin(aPose.x*.55+aPose.z*6.28));p=h+r*(p-h);n=r*n;}`}
}
`;
}

export function wildlifeMaterial(air: boolean, sp: number, material?: THREE.Material): THREE.Material {
  const mat = material ?? new THREE.MeshLambertMaterial({color: 0xffffff, vertexColors: true});
  const surface = !material;
  mat.onBeforeCompile = shader => {
    shader.vertexShader = deformGLSL(air, sp) + (surface ? 'varying vec3 vWildRest; varying float vWildSeed;\n' : '') + shader.vertexShader;
    shader.vertexShader = shader.vertexShader.replace('#include <beginnormal_vertex>',
      '#include <beginnormal_vertex>\nvec3 wildNP=position; wildDeform(wildNP,objectNormal);');
    shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>',
      '#include <begin_vertex>\nvec3 wildN=vec3(0.,1.,0.); wildDeform(transformed,wildN);' +
      (surface ? '\nvWildRest=position; vWildSeed=aPose.z;' : ''));
    if (surface) {
      shader.fragmentShader = `varying vec3 vWildRest; varying float vWildSeed;
float wildHash(vec3 p){return fract(sin(dot(p,vec3(127.1,311.7,74.7)))*43758.5453);}
float wildNoise(vec3 p){vec3 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(mix(wildHash(i),wildHash(i+vec3(1,0,0)),f.x),mix(wildHash(i+vec3(0,1,0)),wildHash(i+vec3(1,1,0)),f.x),f.y),mix(mix(wildHash(i+vec3(0,0,1)),wildHash(i+vec3(1,0,1)),f.x),mix(wildHash(i+vec3(0,1,1)),wildHash(i+vec3(1,1,1)),f.x),f.y),f.z);}
` + shader.fragmentShader;
      shader.fragmentShader = shader.fragmentShader.replace('#include <color_fragment>', `#include <color_fragment>
vec3 wp=vWildRest; float seed=vWildSeed*97.;
// 'patch' is a reserved word in GLSL ES 3.00 (WebGL2 compiles every three
// material as GLSL3): as an identifier it fails the compile and the program
// never links, so nothing with this material draws on a WebGL2 device.
float wildPatch=wildNoise(wp*${air ? '3.' : '2.2'}+seed);
float furFreq=${air ? '30.' : '90.'};
float band=wp.${air ? 'x' : 'y'}*furFreq+wildNoise(wp*8.+seed)*3.;
float fine=sin(band)* (1.-smoothstep(.45,1.8,fwidth(band)));
diffuseColor.rgb *= .87+.24*wildPatch+.035*fine;
${air ? `float belly=1.-smoothstep(-.06,.09,wp.y);diffuseColor.rgb*=1.+belly*.13;
float tip=smoothstep(${[.93,.67,1.15][sp].toFixed(3)},${[1.35,.96,1.63][sp].toFixed(3)},abs(wp.x));diffuseColor.rgb*=1.-tip*${sp===0?'.62':'.20'};` : `float belly=(1.-smoothstep(.72,1.1,wp.y))*smoothstep(.24,.46,wp.y);diffuseColor.rgb=mix(diffuseColor.rgb,diffuseColor.rgb*vec3(1.16,1.12,1.04),belly*.7);
float sock=(1.-smoothstep(.16,.48,wp.y))*smoothstep(.43,.64,wildNoise(vec3(floor(wp.x*4.),seed,floor(wp.z*3.)))) ;diffuseColor.rgb=mix(diffuseColor.rgb,diffuseColor.rgb*1.45,sock*.4);`}
float wildRelief=fine*.00045+wildPatch*.002;
`);
      shader.fragmentShader = shader.fragmentShader.replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
vec3 wdx=dFdx(-vViewPosition),wdy=dFdy(-vViewPosition);
vec3 wr1=cross(wdy,normal),wr2=cross(normal,wdx);float wd=dot(wdx,wr1);
normal=normalize(abs(wd)*normal-sign(wd)*(dFdx(wildRelief)*wr1+dFdy(wildRelief)*wr2));
`);
    }
  };
  mat.customProgramCacheKey = () => `wildlife-3-${air}-${sp}-${surface}-${mat.type}`;
  if (surface) {
    // `extensions` is read by three's program builder on any material but
    // declared by @types/three only on ShaderMaterial, so the write is typed
    // structurally (the same shape facade.ts uses). Same runtime.
    const ext = mat as THREE.Material & { extensions?: { derivatives?: boolean } };
    ext.extensions = { ...ext.extensions, derivatives: true };
    mat.userData.wildlifeDeform = (wire: THREE.Material) => wildlifeMaterial(air, sp, wire);
  }
  return mat;
}

export function wildlifeMeshes(air: boolean, count: number): THREE.InstancedMesh[] {
  return [0, 1, 2].map(sp => {
    const g = shape(air, sp);
    for (const name of air ? ['aPose'] : ['aPose', 'aFeetX', 'aFeetY', 'aFeetZ'])
      g.setAttribute(name, new THREE.InstancedBufferAttribute(new Float32Array(count * 4), 4).setUsage(THREE.DynamicDrawUsage));
    const mesh = new THREE.InstancedMesh(g, wildlifeMaterial(air, sp), count);
    mesh.name = air ? 'birds' : 'herds'; mesh.count = 0; mesh.frustumCulled = false;
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(count * 3).fill(1), 3).setUsage(THREE.DynamicDrawUsage);
    mesh.customDepthMaterial = wildlifeMaterial(air, sp, new THREE.MeshDepthMaterial({depthPacking: THREE.RGBADepthPacking}));
    mesh.customDistanceMaterial = wildlifeMaterial(air, sp, new THREE.MeshDistanceMaterial());
    return mesh;
  });
}
