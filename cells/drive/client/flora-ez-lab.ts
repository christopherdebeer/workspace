import * as THREE from 'three';
import { Tree, TreePreset } from '@dgreenheck/ez-tree';
import { createDials, type DialValues } from './lab-dials';
import {
  broadleaf, conifer, faceTone, snag, trunkReach,
  type VegKind,
} from './flora';
import { grainFx } from './grain';

/**
 * ── EZ-TREE CANDIDATE LAB: A FAIR FIGHT, NOT A SHOWROOM ──
 *
 * EZ-Tree is deliberately NOT wired into the world here. The question is
 * smaller and has to be answered before that dependency earns a production
 * path: does a severely reduced procedural skeleton still read better than
 * Drive's existing silhouette after the same pixel scale, light, population
 * and camera have had their say?
 *
 * LEFT is the shipping archetype and trunk composition from flora.ts. RIGHT is
 * raw geometry returned by EZ-Tree's createGeometry(), rendered through Drive's
 * plain flat Lambert treatment — no photographic leaf or bark textures and no
 * alpha blending to flatter it or hide mobile overdraw. Both sides are
 * InstancedMesh batches. A dial change rebuilds one shared candidate geometry,
 * never one tree per site.
 *
 * This is an evaluation surface only. Nothing in main.ts imports this module;
 * the external package is lazy-loaded only when /lab/flora-ez is opened.
 */

type Family = 'broadleaf' | 'conifer' | 'snag';
interface GeoPair { branches: THREE.BufferGeometry; leaves: THREE.BufferGeometry }

const PRESETS = ['Ash Small', 'Aspen Small', 'Oak Small', 'Pine Small'] as const;

function rng(seed: number): () => number {
  let a = (seed >>> 0) || 1;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function triangles(g: THREE.BufferGeometry): number {
  return Math.round((g.index?.count ?? g.getAttribute('position')?.count ?? 0) / 3);
}

function vertices(g: THREE.BufferGeometry): number {
  return g.getAttribute('position')?.count ?? 0;
}

function boundsOf(geos: THREE.BufferGeometry[]): THREE.Box3 {
  const box = new THREE.Box3();
  for (const g of geos) {
    g.computeBoundingBox();
    if (g.boundingBox) box.union(g.boundingBox);
  }
  return box;
}

function currentPair(family: Family): GeoPair {
  if (family === 'snag') {
    const empty = new THREE.BufferGeometry();
    return { branches: faceTone(snag(), 0.14, 0.34), leaves: empty };
  }
  const kind: VegKind = family;
  const crown = family === 'conifer'
    ? faceTone(conifer(), 0.16, 0.30)
    : faceTone(broadleaf());
  const crownBase = 3;
  crown.translate(0, crownBase, 0);
  const reach = trunkReach(kind, crownBase, 1);
  const trunk = new THREE.CylinderGeometry(0.14, 0.20, 1, 5);
  trunk.translate(0, 0.5, 0);
  trunk.scale(1, reach, 1);
  faceTone(trunk, 0.16, 0.36);
  return { branches: trunk, leaves: crown };
}

function scalePair(pair: GeoPair, targetHeight: number): number {
  const box = boundsOf([pair.branches, pair.leaves]);
  return targetHeight / Math.max(0.01, box.max.y - Math.min(0, box.min.y));
}

function disposeObject(root: THREE.Object3D): void {
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.geometry) m.geometry.dispose();
    const mat = m.material;
    if (Array.isArray(mat)) mat.forEach((x) => x.dispose());
    else mat?.dispose();
  });
  root.removeFromParent();
}

function addPopulation(
  root: THREE.Group,
  pair: GeoPair,
  count: number,
  seed: number,
  centreX: number,
  radius: number,
  targetHeight: number,
  leafColour: THREE.Color,
  woodColour: THREE.Color,
  shadows: boolean,
): { draws: number; trisEach: number; verticesEach: number } {
  const s0 = scalePair(pair, targetHeight);
  const wood = new THREE.MeshLambertMaterial({
    color: 0xffffff, flatShading: true, vertexColors: pair.branches.hasAttribute('color'),
  });
  const leaf = new THREE.MeshLambertMaterial({
    color: 0xffffff, flatShading: true, vertexColors: pair.leaves.hasAttribute('color'),
    side: THREE.DoubleSide,
  });
  grainFx(wood, `ez-lab-wood-${centreX}`, 0.80, 2.5);
  grainFx(leaf, `ez-lab-leaf-${centreX}`, 0.85, 2.0);

  const branches = new THREE.InstancedMesh(pair.branches, wood, count);
  const leaves = new THREE.InstancedMesh(pair.leaves, leaf, count);
  branches.name = centreX < 0 ? 'drive-branches' : 'ez-branches';
  leaves.name = centreX < 0 ? 'drive-leaves' : 'ez-leaves';
  branches.castShadow = leaves.castShadow = shadows;
  branches.receiveShadow = leaves.receiveShadow = shadows;
  branches.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(count * 3), 3);
  leaves.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(count * 3), 3);

  const r = rng(seed);
  const dummy = new THREE.Object3D();
  for (let i = 0; i < count; i++) {
    const rr = Math.sqrt(r()) * radius;
    const a = r() * Math.PI * 2;
    const scale = s0 * (0.76 + r() * 0.48);
    dummy.position.set(centreX + Math.cos(a) * rr, 0, Math.sin(a) * rr);
    dummy.rotation.set((r() - 0.5) * 0.08, r() * Math.PI * 2, (r() - 0.5) * 0.08);
    dummy.scale.set(scale * (0.88 + r() * 0.24), scale * (0.88 + r() * 0.24), scale);
    dummy.updateMatrix();
    branches.setMatrixAt(i, dummy.matrix);
    leaves.setMatrixAt(i, dummy.matrix);
    const tint = 0.82 + r() * 0.28;
    branches.instanceColor.setXYZ(i,
      Math.min(1, woodColour.r * tint), Math.min(1, woodColour.g * tint), Math.min(1, woodColour.b * tint));
    leaves.instanceColor.setXYZ(i,
      Math.min(1, leafColour.r * tint), Math.min(1, leafColour.g * tint), Math.min(1, leafColour.b * tint));
  }
  branches.instanceMatrix.needsUpdate = leaves.instanceMatrix.needsUpdate = true;
  branches.instanceColor.needsUpdate = leaves.instanceColor.needsUpdate = true;
  root.add(branches);
  if (vertices(pair.leaves) > 0) root.add(leaves);

  return {
    draws: vertices(pair.leaves) > 0 ? 2 : 1,
    trisEach: triangles(pair.branches) + triangles(pair.leaves),
    verticesEach: vertices(pair.branches) + vertices(pair.leaves),
  };
}

export async function startEzFloraLab(): Promise<void> {
  document.title = 'DRIVE · EZ-TREE CANDIDATE LAB';
  const style = document.createElement('style');
  style.textContent = `
    html, body { margin: 0; height: 100%; overflow: hidden; background: #0b0f11; color: #d6e2e4;
      font: 11px/1.45 ui-monospace, SFMono-Regular, Menlo, monospace; }
    #ezStage { position: fixed; inset: 0 0 92px var(--dials-w, 272px); transition: left .12s ease; }
    #ezStage canvas { display: block; width: 100%; height: 100%; image-rendering: pixelated; }
    #ezLabels { position: fixed; left: var(--dials-w, 272px); right: 0; top: 9px;
      display: grid; grid-template-columns: 1fr 1fr; pointer-events: none; transition: left .12s ease; }
    #ezLabels span { text-align: center; letter-spacing: 2px; color: #b8c9c8;
      text-shadow: 0 1px 2px #000; }
    #ezLabels span + span { border-left: 1px solid #52706f; }
    #ezStatus { position: fixed; left: var(--dials-w, 272px); right: 0; bottom: 0; height: 74px;
      padding: 8px 11px; box-sizing: border-box; white-space: pre-wrap; overflow: hidden;
      background: rgba(8,14,16,.96); border-top: 1px solid #24343a; color: #9fb2b5;
      transition: left .12s ease; }
    a.back { position: fixed; right: 8px; bottom: 7px; color: #6f8285; text-decoration: none;
      letter-spacing: 2px; z-index: 4; }
    @media (max-width: 720px) {
      #ezStage, #ezLabels, #ezStatus { left: 0; }
      #ezStatus { padding-right: 72px; font-size: 9px; }
    }`;
  document.head.appendChild(style);

  const mount = document.createElement('div');
  mount.id = 'ezStage';
  const labels = document.createElement('div');
  labels.id = 'ezLabels';
  labels.innerHTML = '<span>DRIVE · SHIPPING</span><span>EZ · REDUCED + INSTANCED</span>';
  const status = document.createElement('div');
  status.id = 'ezStatus';
  const back = document.createElement('a');
  back.className = 'back';
  back.href = `${(location.pathname.match(/^\/@[^/]+\/[^/]+/) ?? [''])[0]}/lab`;
  back.textContent = 'ALL LABS';
  document.body.append(mount, labels, status, back);

  const dials = createDials({
    slug: 'flora-ez',
    spec: [
      { id: 'sTree', label: 'TREE', kind: 'section' },
      { id: 'family', label: 'DRIVE KIND', kind: 'select', value: 'broadleaf',
        options: ['broadleaf', 'conifer', 'snag'] },
      { id: 'preset', label: 'EZ PRESET', kind: 'select', value: 'Oak Small',
        options: [...PRESETS] },
      { id: 'seed', label: 'SKELETON SEED', kind: 'range', min: 1, max: 999, step: 1, value: 37 },
      { id: 'height', label: 'HEIGHT m', kind: 'range', min: 3, max: 20, step: 0.5, value: 8 },
      { id: 'count', label: 'TREES / SIDE', kind: 'range', min: 1, max: 300, step: 1, value: 90 },
      { id: 'patch', label: 'PATCH m', kind: 'range', min: 8, max: 90, step: 1, value: 34 },

      { id: 'sMesh', label: 'EZ REDUCTION', kind: 'section' },
      { id: 'sectionStride', label: 'BRANCH STRIDE', kind: 'range', min: 1, max: 12, step: 1, value: 5 },
      { id: 'segmentFactor', label: 'RADIAL x', kind: 'range', min: 0.2, max: 1, step: 0.05, value: 0.4 },
      { id: 'leafStride', label: 'LEAF STRIDE', kind: 'range', min: 1, max: 20, step: 1, value: 6 },
      { id: 'leafScale', label: 'LEAF SCALE', kind: 'range', min: 0.3, max: 3, step: 0.05, value: 1.35 },
      { id: 'showLeaves', label: 'SHOW LEAVES', kind: 'toggle', value: true },

      { id: 'sView', label: 'VIEW', kind: 'section' },
      { id: 'distance', label: 'CAMERA m', kind: 'range', min: 25, max: 240, step: 2, value: 105 },
      { id: 'eye', label: 'EYE m', kind: 'range', min: 2, max: 80, step: 1, value: 27 },
      { id: 'turn', label: 'BEARING', kind: 'range', min: 0, max: 6.28, step: 0.02, value: 0.35 },
      { id: 'orbit', label: 'ORBIT', kind: 'toggle', value: false },
      { id: 'pixel', label: 'PIXEL SCALE', kind: 'range', min: 1, max: 5, step: 1, value: 3 },
      { id: 'shadows', label: 'SHADOWS', kind: 'toggle', value: true },
    ],
    source: (v: DialValues) => JSON.stringify({
      preset: String(v.preset), seed: Number(v.seed),
      detail: {
        sectionStride: Number(v.sectionStride), segmentFactor: Number(v.segmentFactor),
        leafStride: Number(v.leafStride), leafScale: Number(v.leafScale),
        billboard: 'single',
      },
    }, null, 2),
  });

  const renderer = new THREE.WebGLRenderer({ antialias: false, alpha: false });
  renderer.setPixelRatio(1);
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  mount.appendChild(renderer.domElement);
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x26363d);
  scene.fog = new THREE.Fog(0x26363d, 120, 260);
  const camera = new THREE.PerspectiveCamera(42, 1, 0.5, 600);

  const sun = new THREE.DirectionalLight(0xfff2dc, 2.1);
  sun.position.set(70, 95, 55);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  const sc = sun.shadow.camera as THREE.OrthographicCamera;
  sc.left = -100; sc.right = 100; sc.top = 80; sc.bottom = -80; sc.near = 1; sc.far = 300;
  scene.add(sun, sun.target, new THREE.HemisphereLight(0x9fc4dd, 0x4a4433, 1.15));

  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(300, 180),
    new THREE.MeshLambertMaterial({ color: 0x536449 }),
  );
  ground.rotateX(-Math.PI / 2);
  ground.receiveShadow = true;
  scene.add(ground);
  const divider = new THREE.Line(
    new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0.03, -90), new THREE.Vector3(0, 0.03, 90)]),
    new THREE.LineBasicMaterial({ color: 0x52706f }),
  );
  scene.add(divider);

  let population: THREE.Group | null = null;
  let driveStats = { draws: 0, trisEach: 0, verticesEach: 0 };
  let ezStats = { draws: 0, trisEach: 0, verticesEach: 0 };
  let ezFull = { tris: 0, vertices: 0 };
  let buildMs = 0;
  let dirty = true;

  const rebuild = (): void => {
    dirty = false;
    if (population) disposeObject(population);
    population = new THREE.Group();
    population.name = 'ez-tree-comparison';
    scene.add(population);

    const family = dials.str('family') as Family;
    const preset = dials.str('preset');
    const seed = Math.round(dials.num('seed'));
    const count = Math.round(dials.num('count'));
    const patch = dials.num('patch');
    const height = dials.num('height');
    const shadows = dials.bool('shadows');
    renderer.shadowMap.enabled = shadows;
    sun.castShadow = shadows;
    ground.receiveShadow = shadows;

    const current = currentPair(family);
    driveStats = addPopulation(population, current, count, seed + 101, -patch * 1.12, patch,
      height, new THREE.Color(0x527c48), new THREE.Color(0x4a3826), shadows);

    const t0 = performance.now();
    const tree = new Tree();
    const chosen = (TreePreset as Record<string, unknown>)[preset];
    if (chosen && typeof (tree.options as { copy?: unknown }).copy === 'function') {
      (tree.options as { copy(v: unknown): void }).copy(chosen);
    }
    tree.options.seed = seed;
    const full = tree.createGeometry({});
    ezFull = {
      tris: triangles(full.branches) + triangles(full.leaves),
      vertices: vertices(full.branches) + vertices(full.leaves),
    };
    full.branches.dispose();
    full.leaves.dispose();
    const reduced = tree.createGeometry({
      sectionStride: Math.round(dials.num('sectionStride')),
      segmentFactor: dials.num('segmentFactor'),
      leafStride: Math.round(dials.num('leafStride')),
      leafScale: dials.num('leafScale'),
      billboard: 'single',
    });
    if (!dials.bool('showLeaves') || family === 'snag') {
      reduced.leaves.dispose();
      reduced.leaves = new THREE.BufferGeometry();
    }
    buildMs = performance.now() - t0;
    ezStats = addPopulation(population, reduced, count, seed + 101, patch * 1.12, patch,
      height, new THREE.Color(0x527c48), new THREE.Color(0x4a3826), shadows);
  };

  const resize = (): void => {
    const px = Math.max(1, Math.round(dials.num('pixel')));
    const w = Math.max(80, Math.floor(mount.clientWidth / px));
    const h = Math.max(80, Math.floor(mount.clientHeight / px));
    renderer.setSize(w, h, false);
    renderer.domElement.style.width = '100%';
    renderer.domElement.style.height = '100%';
    camera.aspect = mount.clientWidth / Math.max(1, mount.clientHeight);
    camera.updateProjectionMatrix();
  };

  dials.onChange(() => { dirty = true; resize(); });
  addEventListener('resize', resize);
  resize();

  let spin = 0;
  let last = performance.now();
  const frame = (): void => {
    if (dirty) rebuild();
    const now = performance.now();
    if (dials.bool('orbit')) spin += (now - last) * 0.00018;
    last = now;
    const a = dials.num('turn') + spin;
    const dist = dials.num('distance');
    camera.position.set(Math.sin(a) * dist, dials.num('eye'), Math.cos(a) * dist);
    camera.lookAt(0, dials.num('height') * 0.35, 0);
    renderer.render(scene, camera);

    const n = Math.round(dials.num('count'));
    const reduction = ezFull.tris > 0 ? (100 * ezStats.trisEach / ezFull.tris) : 0;
    status.textContent =
      `PER TREE  DRIVE ${driveStats.verticesEach}v / ${driveStats.trisEach}t · `
      + `EZ FULL ${ezFull.vertices}v / ${ezFull.tris}t · `
      + `EZ SHOWN ${ezStats.verticesEach}v / ${ezStats.trisEach}t (${reduction.toFixed(1)}%)\n`
      + `POPULATION ×${n}  DRIVE ${(driveStats.trisEach * n).toLocaleString()}t / ${driveStats.draws} batches · `
      + `EZ ${(ezStats.trisEach * n).toLocaleString()}t / ${ezStats.draws} batches · `
      + `candidate build ${buildMs.toFixed(1)}ms · frame calls ${renderer.info.render.calls} / `
      + `${renderer.info.render.triangles.toLocaleString()} triangles\n`
      + `OPAQUE FLAT CARDS · NO EZ TEXTURES · ONE SHARED EZ SKELETON · LAB ONLY`;
    requestAnimationFrame(frame);
  };
  frame();
}
