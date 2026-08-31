import * as THREE from 'three';
import { createDials, type DialValues } from './lab-dials';
import {
  ALT_BAND_NAMES, AltBand, BIOME_ORDER, LAPSE, altBandAt, climCompute, climPick, krummholz,
  seaTempAt, swardLift, treelineAt,
} from './climate';
import {
  FLORA_TUNING, FOLIAGE_ROWS, STONE, VEG_MIX,
  acaciaGeo, bandKind, broadleaf, bushGeo, cactusGeo, conifer, coverKind, faceTone, fernGeo,
  grassGeo, logGeo, palm, plantLook, rockGeo, setFloraTuning, snag, spireGeo, standTone,
  trunkReach,
  type VegKind, type VegSite,
} from './flora';
import { grainFx, grainU } from './grain';

/**
 * ── THE FLORA LAB: WHAT WOULD GROW HERE, AND WHAT IT LOOKS LIKE ──
 *
 * Two panes, because there are two questions and they have never been askable
 * in the same place.
 *
 * THE LADDER answers WHAT and WHERE. The climate field decides everything
 * standing on the ground — which trees, how dense, how high the sward reaches,
 * where the treeline is and what happens above it — and the column through the
 * altitudes makes that model legible in a way no drive does. Turning the
 * latitude and watching the treeline walk down it is the fastest check there
 * is that the model behaves.
 *
 * THE STAND answers whether any of it LOOKS like anything. That question used
 * to need a truck: find somewhere green, wait for four tiles, and hope the
 * camera comes to rest facing twenty trees. Every complaint about the
 * vegetation has been about this half — crowns too alike, rocks reading as
 * gravel, a conifer wood as a field of identical cones — and none of it could
 * be judged against a bar chart.
 *
 * Drives climate.ts, flora.ts and grain.ts: the same modules the world grows
 * from, all the way down to the shader on the leaves. Nothing here is a
 * stand-in, which is the only reason a change made on these dials means
 * anything once it is pasted back into flora.ts.
 */

const BAND_COLOUR = ['#4a6b3a', '#5b7a44', '#6d7a52', '#8a8f6a', '#8f8f92', '#d8dee2'];
const STONE_NAMES = ['granite', 'limestone', 'sandstone', 'basalt', 'ochre', 'greenstone'];
const KINDS: VegKind[] = ['broadleaf', 'conifer', 'palm', 'snag', 'bush', 'rock',
  'acacia', 'cactus', 'fern', 'log', 'spire'];

/** Deterministic, so a seed is a stand you can come back to and a screenshot
 *  taken before a change is comparable with one taken after. */
function rng(seed: number): () => number {
  let a = (seed >>> 0) || 1;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * ── THE STAND: THE PLANTS THEMSELVES, NOT A MODEL OF THEM ──
 *
 * The ladder beside this answers WHAT grows here. It cannot answer whether it
 * LOOKS like anything, and that is the question every complaint about the
 * vegetation has actually been: the crowns are too alike, the rocks read as
 * gravel, a conifer wood is a field of identical cones. Judging that by
 * driving somewhere green and looking out of a windscreen is the loop the labs
 * exist to kill — it takes four tiles of streaming to see twenty trees.
 *
 * So this grows a stand from flora.ts directly: the same archetype geometry,
 * the same baked facet tone, the same grain shader, the same tint-and-shape
 * lottery, over a climate the dials describe. Nothing here is a stand-in. What
 * is on screen is what the truck drives past.
 */
function makeStand(mount: HTMLElement): {
  render(o: StandOpts): void; resize(): void; dispose(): void;
} {
  const renderer = new THREE.WebGLRenderer({ antialias: false, alpha: false });
  renderer.setPixelRatio(1);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  mount.appendChild(renderer.domElement);
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(42, 1, 0.4, 900);

  // ── LIT LIKE THE WORLD, OR THE TONE MEANS NOTHING ──
  // The baked facet tone and the grain are both multiplied into diffuse before
  // lighting, so a stand under a flat ambient shows neither. Key plus a
  // sky/ground hemisphere is what the game runs.
  const sun = new THREE.DirectionalLight(0xfff2dc, 2.1);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  const sc = sun.shadow.camera as THREE.OrthographicCamera;
  sc.left = -60; sc.right = 60; sc.top = 60; sc.bottom = -60; sc.near = 1; sc.far = 260;
  const hemi = new THREE.HemisphereLight(0x9fc4dd, 0x4a4433, 1.15);
  scene.add(sun, sun.target, hemi);

  const ground = new THREE.Mesh(
    new THREE.CircleGeometry(1, 64).rotateX(-Math.PI / 2),
    new THREE.MeshLambertMaterial({ color: 0x5d6a44 }),
  );
  ground.receiveShadow = true;
  scene.add(ground);

  // The production materials, grain and all. White bases: every plant's colour
  // arrives through instanceColor and the baked tone rides underneath it.
  const leafMat = new THREE.MeshLambertMaterial({ color: 0xffffff, flatShading: true, vertexColors: true });
  const woodMat = new THREE.MeshLambertMaterial({ color: 0x4a3826, flatShading: true, vertexColors: true });
  const stoneMat = new THREE.MeshLambertMaterial({ color: 0xffffff, flatShading: true, vertexColors: true });
  const grassMat = new THREE.MeshLambertMaterial({ color: 0xffffff, flatShading: true, side: THREE.DoubleSide });
  grainFx(grassMat, 'lab-sward', 0.85, 3.6);
  grainFx(stoneMat, 'lab-stone', 1.25, 3.4);
  grainFx(leafMat, 'lab-leaf', 0.95, 1.9);
  grainFx(woodMat, 'lab-wood', 0.95, 2.6);

  const GEO: Record<VegKind, () => THREE.BufferGeometry> = {
    broadleaf: () => faceTone(broadleaf()),
    conifer: () => faceTone(conifer(), 0.16, 0.3),
    palm: () => faceTone(palm(), 0.22, 0.1),
    snag: () => faceTone(snag(), 0.14, 0.34),
    bush: () => faceTone(bushGeo(), 0.24, 0.28),
    rock: () => faceTone(rockGeo(), 0.34, 0.3),
    grass: () => grassGeo(),
    acacia: () => faceTone(acaciaGeo(), 0.18, 0.12),
    cactus: () => faceTone(cactusGeo(), 0.2, 0.22),
    fern: () => fernGeo(),
    log: () => faceTone(logGeo(), 0.18, 0.2),
    spire: () => faceTone(spireGeo(), 0.32, 0.26),
  };
  const MAT: Record<VegKind, THREE.Material> = {
    broadleaf: leafMat, conifer: leafMat, palm: leafMat, bush: leafMat, acacia: leafMat,
    cactus: leafMat, fern: grassMat, grass: grassMat,
    snag: woodMat, log: woodMat, rock: stoneMat, spire: stoneMat,
  };

  const CAP = 900;
  const meshes = {} as Record<VegKind, THREE.InstancedMesh>;
  for (const k of Object.keys(GEO) as VegKind[]) {
    const m = new THREE.InstancedMesh(GEO[k](), MAT[k], CAP);
    m.count = 0;
    m.frustumCulled = false;
    m.castShadow = true;
    m.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(CAP * 3), 3);
    scene.add(m);
    meshes[k] = m;
  }
  // The drawn trunk under a crown — the game's own extra mesh, without which
  // every broadleaf floats.
  const trunkGeo = new THREE.CylinderGeometry(0.14, 0.2, 1, 5);
  trunkGeo.translate(0, 0.5, 0);
  faceTone(trunkGeo, 0.16, 0.36);
  const trunks = new THREE.InstancedMesh(trunkGeo, woodMat, CAP);
  trunks.count = 0; trunks.frustumCulled = false; trunks.castShadow = true;
  scene.add(trunks);

  const dummy = new THREE.Object3D();
  let spin = 0, last = performance.now();

  const resize = (): void => {
    const w = Math.max(120, mount.clientWidth), h = Math.max(120, mount.clientHeight);
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  };

  const render = (o: StandOpts): void => {
    const now = performance.now();
    if (o.orbit) spin += (now - last) * 0.00016;
    last = now;

    scene.background = new THREE.Color(o.sky);
    (ground.material as THREE.MeshLambertMaterial).color.set(o.groundCol);
    ground.scale.setScalar(o.patch * 1.9);
    ground.visible = o.ground;

    const el = (o.sunEl * Math.PI) / 180;
    sun.position.set(Math.cos(el) * 90, Math.sin(el) * 90, 40);
    sun.intensity = o.sunI;

    for (const k of Object.keys(meshes) as VegKind[]) meshes[k].count = 0;
    let nTrunk = 0;
    for (const v of o.sites) {
      const m = meshes[v.k];
      if (!m || m.count >= CAP) continue;
      const i = m.count++;
      // EXACTLY the composition the game uses — see the veg refill in main.
      dummy.position.set(v.x, v.h, v.z);
      dummy.rotation.set(v.tl ?? 0, v.rot, 0);
      dummy.scale.set(v.s * (v.sw ?? 1), v.s * (v.sy ?? 1), v.s);
      dummy.updateMatrix();
      m.setMatrixAt(i, dummy.matrix);
      m.instanceColor!.setXYZ(i, v.c.r, v.c.g, v.c.b);
      if (v.h > 0 && o.trunks && nTrunk < CAP) {
        dummy.position.set(v.x, 0, v.z);
        dummy.rotation.set(0, 0, 0);
        dummy.scale.set(v.s * 0.42 * (v.sw ?? 1), trunkReach(v.k, v.h, v.s), v.s * 0.42 * (v.sw ?? 1));
        dummy.updateMatrix();
        trunks.setMatrixAt(nTrunk++, dummy.matrix);
      }
    }
    for (const k of Object.keys(meshes) as VegKind[]) {
      const m = meshes[k];
      m.instanceMatrix.needsUpdate = true;
      m.instanceColor!.needsUpdate = true;
    }
    trunks.count = nTrunk;
    trunks.instanceMatrix.needsUpdate = true;

    const a = spin + o.turn;
    camera.position.set(Math.sin(a) * o.dist, o.eye, Math.cos(a) * o.dist);
    camera.lookAt(0, o.eye * 0.32, 0);
    renderer.render(scene, camera);
  };

  return { render, resize, dispose: () => renderer.dispose() };
}

interface StandOpts {
  sites: VegSite[];
  patch: number; dist: number; eye: number; turn: number; orbit: boolean;
  sunEl: number; sunI: number; sky: string; groundCol: string;
  ground: boolean; trunks: boolean;
}


export async function startFloraLab(): Promise<void> {
  document.title = 'DRIVE · FLORA LAB';
  const style = document.createElement('style');
  style.textContent = `
    html, body { margin: 0; height: 100%; background: #0b0f11; color: #d6e2e4; overflow: hidden;
      font: 12px/1.5 ui-monospace, SFMono-Regular, Menlo, monospace; }
    /* The gutter follows the panel — see paintFold in lab-dials. Folding it
       away is most of the point, and a hard 288px would keep the hole. */
    #panes { position: fixed; inset: 0 0 104px calc(var(--dials-w, 272px) + 16px);
      display: flex; flex-direction: column; transition: left .12s ease; }
    @media (max-width: 720px) { #panes { inset: 0 0 104px 0; } }
    #stand { flex: 1 1 62%; min-height: 200px; border-bottom: 1px solid #24343a; position: relative; }
    #stand canvas { display: block; width: 100%; height: 100%; image-rendering: pixelated; }
    #ladderWrap { flex: 0 0 38%; display: grid; place-items: center; overflow: hidden; }
    #ladder { max-width: 98%; max-height: 100%; }
    /* Clear of the dials, and it moves when they fold — see paintFold. */
    #status { position: fixed; left: var(--dials-w, 272px); right: 0; bottom: 0;
      padding: 8px 12px; white-space: pre;
      background: rgba(8,14,16,.94); border-top: 1px solid #24343a; letter-spacing: 1px; }
    a.back { position: fixed; right: 8px; bottom: 8px; color: #6f8285; text-decoration: none;
      letter-spacing: 2px; }`;
  document.head.appendChild(style);

  const panes = document.createElement('div');
  panes.id = 'panes';
  const standEl = document.createElement('div');
  standEl.id = 'stand';
  const ladderWrap = document.createElement('div');
  ladderWrap.id = 'ladderWrap';
  const cv = document.createElement('canvas');
  cv.id = 'ladder';
  cv.width = 1000; cv.height = 520;
  ladderWrap.appendChild(cv);
  panes.append(standEl, ladderWrap);
  document.body.appendChild(panes);
  const status = document.createElement('div');
  status.id = 'status';
  document.body.appendChild(status);
  const back = document.createElement('a');
  back.className = 'back';
  back.href = `${(location.pathname.match(/^\/@[^/]+\/[^/]+/) ?? [''])[0]}/lab`;
  back.textContent = 'ALL LABS';
  document.body.appendChild(back);

  const dials = createDials({
    slug: 'flora',
    spec: [
      // ── WHERE ──
      { id: 'sWhere', label: 'WHERE', kind: 'section' },
      { id: 'lat', label: 'LATITUDE', kind: 'range', min: 0, max: 78, step: 0.5, value: 46 },
      { id: 'elev', label: 'ELEV m', kind: 'range', min: -50, max: 4500, step: 25, value: 700 },
      { id: 'moist', label: 'MOISTURE', kind: 'range', min: 0, max: 1, step: 0.02, value: 0.5 },
      { id: 'aspect', label: 'ASPECT m', kind: 'range', min: -300, max: 300, step: 10, value: 0 },
      { id: 'cover', label: 'COVER CLASS', kind: 'select', value: '10',
        options: ['10', '20', '30', '40', '50', '60', '70', '90', '100'] },
      { id: 'top', label: 'COLUMN TOP m', kind: 'range', min: 800, max: 6000, step: 100, value: 4000 },
      // ── THE STAND ──
      { id: 'sStand', label: 'THE STAND', kind: 'section' },
      { id: 'species', label: 'SPECIES', kind: 'select', value: 'mix', options: ['mix', ...KINDS] },
      { id: 'count', label: 'PLANTS', kind: 'range', min: 4, max: 700, step: 2, value: 190 },
      { id: 'patch', label: 'PATCH m', kind: 'range', min: 6, max: 140, step: 2, value: 46 },
      { id: 'seed', label: 'SEED', kind: 'range', min: 1, max: 999, step: 1, value: 7 },
      { id: 'stone', label: 'BEDROCK', kind: 'select', value: 'auto', options: ['auto', ...STONE_NAMES] },
      { id: 'dist', label: 'CAMERA m', kind: 'range', min: 6, max: 220, step: 2, value: 86 },
      { id: 'eye', label: 'EYE m', kind: 'range', min: 0.6, max: 60, step: 0.4, value: 21 },
      { id: 'turn', label: 'BEARING', kind: 'range', min: 0, max: 6.28, step: 0.02, value: 0.6 },
      { id: 'orbit', label: 'ORBIT', kind: 'toggle', value: true },
      { id: 'sunEl', label: 'SUN °', kind: 'range', min: 3, max: 88, step: 1, value: 34 },
      { id: 'sunI', label: 'SUN INT', kind: 'range', min: 0, max: 4, step: 0.05, value: 2.1 },
      { id: 'sky', label: 'SKY', kind: 'color', value: '#2b3a44' },
      { id: 'groundCol', label: 'GROUND', kind: 'color', value: '#5d6a44' },
      { id: 'showGround', label: 'SHOW GROUND', kind: 'toggle', value: true },
      { id: 'trunks', label: 'TRUNKS', kind: 'toggle', value: true },
      { id: 'grain', label: 'GRAIN x', kind: 'range', min: 0, max: 3, step: 0.05, value: 1 },
      // ── THE LOTTERY, WHICH IS WHAT THE STAND IS FOR ──
      { id: 'sLottery', label: 'THE LOTTERY', kind: 'section' },
      { id: 'sizeMul', label: 'SIZE x', kind: 'range', min: 0.2, max: 3, step: 0.05, value: FLORA_TUNING.sizeMul },
      { id: 'oddAutumn', label: 'AUTUMN', kind: 'range', min: 0, max: 0.4, step: 0.005, value: FLORA_TUNING.oddAutumn },
      { id: 'oddSilver', label: 'SILVER', kind: 'range', min: 0, max: 0.5, step: 0.005, value: FLORA_TUNING.oddSilver },
      { id: 'krummFloor', label: 'KRUMM MIN', kind: 'range', min: 0.05, max: 1, step: 0.01, value: FLORA_TUNING.krummFloor },
      { id: 'erraticP', label: 'ERRATIC p', kind: 'range', min: 0, max: 0.4, step: 0.005, value: FLORA_TUNING.erraticP },
      { id: 'erraticMul', label: 'ERRATIC x', kind: 'range', min: 1, max: 5, step: 0.05, value: FLORA_TUNING.erraticMul },
      { id: 'leanMul', label: 'LEAN x', kind: 'range', min: 0, max: 4, step: 0.05, value: FLORA_TUNING.leanMul },
      { id: 'stretchMul', label: 'STRETCH x', kind: 'range', min: 0, max: 3, step: 0.05, value: FLORA_TUNING.stretchMul },
      { id: 'toneMul', label: 'STAND TONE x', kind: 'range', min: 0, max: 3, step: 0.05, value: FLORA_TUNING.toneMul },
    ],
    // COPY writes the engine literal, not the panel: these nine numbers are
    // the ones flora.ts actually reads, and they are the whole argument about
    // how varied a stand looks.
    source: (v: DialValues) => {
      const n = (k: string, d: number): number => (Number.isFinite(Number(v[k])) ? Number(v[k]) : d);
      return 'export const FLORA_TUNING: FloraTuning = {\n'
        + `  sizeMul: ${n('sizeMul', 1)},\n`
        + `  oddAutumn: ${n('oddAutumn', 0.045)},\n`
        + `  oddSilver: ${n('oddSilver', 0.085)},\n`
        + `  krummFloor: ${n('krummFloor', 0.18)},\n`
        + `  erraticP: ${n('erraticP', 0.04)},\n`
        + `  erraticMul: ${n('erraticMul', 1.9)},\n`
        + `  leanMul: ${n('leanMul', 1)},\n`
        + `  stretchMul: ${n('stretchMul', 1)},\n`
        + `  toneMul: ${n('toneMul', 1)},\n};`;
    },
  });

  const stand = makeStand(standEl);
  const ctx = cv.getContext('2d')!;
  let sites: VegSite[] = [];
  let census: Array<[VegKind, number]> = [];
  let bedrock = 0;

  /** Grow the stand. Deliberately the same sequence plantClump uses: ONE tone
   *  for the whole stand, a sqrt-biased radius so the clump has a core and a
   *  fringe, and one member in six of a different species — a monoculture is
   *  the single most obvious way a wood stops reading as a wood. */
  const grow = (w: number[], treeline: number, effElev: number, band: AltBand): void => {
    setFloraTuning({
      sizeMul: dials.num('sizeMul'), oddAutumn: dials.num('oddAutumn'),
      oddSilver: dials.num('oddSilver'), krummFloor: dials.num('krummFloor'),
      erraticP: dials.num('erraticP'), erraticMul: dials.num('erraticMul'),
      leanMul: dials.num('leanMul'), stretchMul: dials.num('stretchMul'),
      toneMul: dials.num('toneMul'),
    });
    for (const g of grainU) g.u.uGrainAmp.value = g.base * dials.num('grain');

    const r = rng(dials.num('seed'));
    const stoneSel = dials.str('stone');
    const stone = stoneSel === 'auto'
      ? Math.min(STONE.length - 1, Math.floor(r() * STONE.length))
      : STONE_NAMES.indexOf(stoneSel);
    bedrock = Math.max(0, stone);
    const tone = standTone(r, bedrock);
    const want = dials.str('species');
    const rad = dials.num('patch');
    // THE SAME RULE THE WORLD USES. Altitude overrules the raster — a cover
    // tile says "forest" on a pixel whose upper half is scree — and below the
    // treeline the cover class decides. Which is what makes COVER CLASS and
    // ELEV the two most interesting dials on this panel: they restock the
    // whole stand rather than tinting it.
    const cover = parseInt(dials.str('cover'), 10);
    const dominant: VegKind = want === 'mix'
      ? (bandKind(band, r) ?? coverKind(cover, w, r))
      : (want as VegKind);
    const out: VegSite[] = [];
    const tally = new Map<VegKind, number>();
    for (let i = 0; i < dials.num('count'); i++) {
      const t = Math.pow(r(), 0.62) * rad;
      const a = r() * Math.PI * 2;
      const kind: VegKind = want === 'mix'
        ? (r() < 0.83 ? dominant : ((climPick(VEG_MIX, w, r) as VegKind) ?? dominant))
        : dominant;
      out.push(plantLook(Math.cos(a) * t, Math.sin(a) * t, kind, r, {
        tone,
        biomeW: () => w,
        krummK: () => krummholz(effElev, treeline),
      }, FOLIAGE_ROWS));
      tally.set(kind, (tally.get(kind) ?? 0) + 1);
    }
    sites = out;
    census = [...tally.entries()].sort((p, q) => q[1] - p[1]);
  };

  const draw = (): void => {
    const lat = dials.num('lat');
    const elev = dials.num('elev');
    const moist = dials.num('moist');
    const cover = parseInt(dials.str('cover'), 10);
    // The real climate computation, over a stand-in world whose cover and
    // height answer exactly what the dials say — so the sample is the game's,
    // taken at a place the dials describe.
    const env = {
      coverAt: () => cover,
      latAbsAt: () => lat,
      groundAt: () => elev,
    };
    const s = climCompute(env, 0, 0, 1);
    const treeline = treelineAt(lat, moist);
    const eff0 = elev + dials.num('aspect');
    grow(s.w, treeline, eff0, altBandAt(eff0, treeline));

    ctx.fillStyle = '#0b0f11';
    ctx.fillRect(0, 0, cv.width, cv.height);

    // ── THE BIOME MIX, AS BARS ──
    const barX = 40, barW = 300;
    ctx.font = '12px ui-monospace, monospace';
    for (let i = 0; i < BIOME_ORDER.length; i++) {
      const y = 46 + i * 30;
      ctx.fillStyle = '#6f8285';
      ctx.fillText(BIOME_ORDER[i].toUpperCase(), barX, y - 4);
      ctx.fillStyle = '#12202400';
      ctx.strokeStyle = '#24343a';
      ctx.strokeRect(barX + 96, y - 14, barW, 12);
      ctx.fillStyle = i === s.domIdx ? '#7fd0c4' : '#3f6f6a';
      ctx.fillRect(barX + 96, y - 14, barW * s.w[i], 12);
      ctx.fillStyle = '#9fb2b5';
      ctx.fillText(s.w[i].toFixed(3), barX + 96 + barW + 10, y - 3);
    }
    ctx.fillStyle = '#6f8285';
    ctx.fillText('BIOME MIX AT THE POINT', barX, 28);

    // ── THE COLUMN: EVERY ALTITUDE ABOVE THIS SPOT ──
    // The one picture that makes the band model legible — where montane gives
    // way to treeline, krummholz, meadow, scree and snow, and how far the
    // sward still reaches into each.
    const colX = 520, colW = 300, colTop = 40, colH = cv.height - 110;
    const top = dials.num('top');
    ctx.fillStyle = '#6f8285';
    ctx.fillText('THE COLUMN ABOVE IT', colX, 28);
    const yOf = (m: number): number => colTop + colH - (m / top) * colH;
    for (let m = 0; m <= top; m += 20) {
      const eff = m + dials.num('aspect');
      const band = altBandAt(eff, treeline);
      ctx.fillStyle = BAND_COLOUR[band] ?? '#555';
      ctx.fillRect(colX, yOf(m + 20), colW * 0.55, Math.max(1, yOf(m) - yOf(m + 20) + 1));
      // Sward lift and krummholz, as widths — how much ground cover survives.
      const sw = swardLift(eff, treeline);
      const kz = krummholz(eff, treeline);
      ctx.fillStyle = 'rgba(160,210,150,.75)';
      ctx.fillRect(colX + colW * 0.58, yOf(m + 20), colW * 0.18 * sw, Math.max(1, yOf(m) - yOf(m + 20) + 1));
      ctx.fillStyle = 'rgba(200,170,110,.75)';
      ctx.fillRect(colX + colW * 0.79, yOf(m + 20), colW * 0.18 * kz, Math.max(1, yOf(m) - yOf(m + 20) + 1));
    }
    // The treeline itself, and where the dials put the truck.
    ctx.strokeStyle = '#d8c23a'; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(colX - 8, yOf(treeline)); ctx.lineTo(colX + colW, yOf(treeline)); ctx.stroke();
    ctx.fillStyle = '#d8c23a';
    ctx.fillText(`treeline ${Math.round(treeline)}m`, colX + colW + 8, yOf(treeline) + 4);
    ctx.strokeStyle = '#7fd0c4';
    ctx.beginPath(); ctx.moveTo(colX - 8, yOf(elev)); ctx.lineTo(colX + colW, yOf(elev)); ctx.stroke();
    ctx.fillStyle = '#7fd0c4';
    ctx.fillText(`here ${Math.round(elev)}m`, colX + colW + 8, yOf(elev) + 4);
    ctx.fillStyle = '#6f8285';
    ctx.fillText('BAND', colX, cv.height - 76);
    ctx.fillText('SWARD', colX + colW * 0.58, cv.height - 76);
    ctx.fillText('KRUMM', colX + colW * 0.79, cv.height - 76);


    const eff = elev + dials.num('aspect');
    const band = altBandAt(eff, treeline);
    const spread = census.map(([k, n]) => `${k} ${n}`).join(' · ');
    // THE DIVERSITY READOUT. "Is this stand varied" is not a feeling when the
    // tally is on the glass: one species at 190 is a plantation, five species
    // with a dominant at two thirds is a wood.
    status.textContent =
      `${BIOME_ORDER[s.domIdx].toUpperCase()} · ${s.tempC.toFixed(1)}°C · MOISTURE ${s.moisture.toFixed(2)}`
      + ` · SEA TEMP AT THIS LATITUDE ${seaTempAt(lat).toFixed(1)}°C\n`
      + `band ${ALT_BAND_NAMES[band].toUpperCase()} · sward ${swardLift(eff, treeline).toFixed(2)}`
      + ` · krummholz ${krummholz(eff, treeline).toFixed(2)} · lapse ${(LAPSE * 1000).toFixed(1)}°C/km`
      + ` · bedrock ${STONE_NAMES[bedrock]}\n`
      + `STAND ${sites.length} · ${spread || 'nothing grows here'}`;
  };

  dials.onChange(draw);
  const opts = (): StandOpts => ({
    sites,
    patch: dials.num('patch'),
    dist: dials.num('dist'),
    eye: dials.num('eye'),
    turn: dials.num('turn'),
    orbit: dials.bool('orbit'),
    sunEl: dials.num('sunEl'),
    sunI: dials.num('sunI'),
    sky: dials.str('sky'),
    groundCol: dials.str('groundCol'),
    ground: dials.bool('showGround'),
    trunks: dials.bool('trunks'),
  });
  const frame = (): void => {
    stand.render(opts());
    requestAnimationFrame(frame);
  };
  addEventListener('resize', () => { stand.resize(); });
  stand.resize();
  draw();
  frame();
}
