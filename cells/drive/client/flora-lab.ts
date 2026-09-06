import * as THREE from 'three';
import { createDials, type DialValues } from './lab-dials';
import {
  ALT_BAND_NAMES, AltBand, BIOME_ORDER, LAPSE, altBandAt, climCompute, climPick, krummholz,
  seaTempAt, siteAt, swardLift, treelineAt, type SiteClimate, type SiteEnv,
} from './climate';
import {
  FLORA_TUNING, FOLIAGE_ROWS, STONE, STONY, VEG_MIX,
  acaciaGeo, bandKind, broadleaf, bushGeo, cactusGeo, conifer, coverKind, faceTone, fernGeo,
  grassGeo, logGeo, palm, plantLook, rockGeo, setFloraTuning, snag, spireGeo, standTone,
  trunkReach,
  type VegKind, type VegSite,
} from './flora';
import { guildAt, type Guild } from './guild';
import { guildKind } from './guild';
import { ecoBiomeName, type EcoHit } from './eco';
import {
  EZ_FAMILIES, EZ_M_PER_SCALE, ezCrownReach, ezMaterial, ezPalette, ezPickVariant, ezVariantFor,
  ezVariants, type EzFamily,
} from './flora-ez';
import { seedAt, type CultureEnv } from './culture';
import { coastKm } from './coast';
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
 * ── THE PLACES: REAL COORDINATES CARRYING THEIR REAL ECOREGION ──
 *
 * The guild layer's whole argument is that no climate model derives an
 * ecoregion — the Cape is an ordinary Mediterranean climate growing something
 * structurally unlike any other Mediterranean climate on earth — so a lab that
 * let you dial up a biome number and call it a place would be arguing with
 * itself. Every row here was RESOLVED against the live `~/eco/v1/` tiles at
 * the coordinate beside it (devtools/eco-places.mjs prints this table); not
 * one of them is typed from memory, which is the same rule the captures follow
 * in world-fixtures.ts.
 *
 * Chosen to cover ten of the fourteen biomes and, deliberately, the
 * distinctions ONE sample cannot make: two Mediterranean shrublands in
 * different realms (Cape, Big Sur), two savannas in different realms
 * (Serengeti, Kakadu) and three deserts in three (Sonoran, Sahara, Outback) —
 * which is the only way to watch the cactus gate do its one job.
 */
interface LabPlace { label: string; lat: number; lon: number; elev: number; eco: EcoHit }
const PLACES: LabPlace[] = [
  { label: 'CAPE PENINSULA', lat: -34.0958, lon: 18.3602, elev: 300,
    eco: { id: 89, biome: 12, name: 'Fynbos shrubland', realm: 'Afrotropic' } },
  { label: 'BIG SUR', lat: 36.3752, lon: -121.9048, elev: 356,
    eco: { id: 425, biome: 12, name: 'Santa Lucia Montane Chaparral & Woodlands', realm: 'Nearctic' } },
  { label: 'SERENGETI', lat: -2.3333, lon: 34.8333, elev: 1500,
    eco: { id: 57, biome: 7, name: 'Southern Acacia-Commiphora bushlands and thickets', realm: 'Afrotropic' } },
  { label: 'KAKADU', lat: -12.85, lon: 132.4, elev: 30,
    eco: { id: 181, biome: 7, name: 'Arnhem Land tropical savanna', realm: 'Australasia' } },
  { label: 'SUNDARBANS', lat: 21.95, lon: 89.18, elev: 2,
    eco: { id: 323, biome: 14, name: 'Sundarbans mangroves', realm: 'Indomalayan' } },
  { label: 'YOSEMITE', lat: 37.75, lon: -119.59, elev: 1900,
    eco: { id: 366, biome: 5, name: 'Sierra Nevada forests', realm: 'Nearctic' } },
  { label: 'ALPS', lat: 46.02, lon: 7.75, elev: 1600,
    eco: { id: 689, biome: 5, name: 'Alps conifer and mixed forests', realm: 'Palearctic' } },
  { label: 'PARIS', lat: 48.8, lon: 2.2, elev: 100,
    eco: { id: 664, biome: 4, name: 'European Atlantic mixed forests', realm: 'Palearctic' } },
  { label: 'AMAZON', lat: -3.1, lon: -60.02, elev: 60,
    eco: { id: 473, biome: 1, name: 'Japurá-Solimões-Negro moist forests', realm: 'Neotropic' } },
  { label: 'BORNEO', lat: 1.5, lon: 113.5, elev: 300,
    eco: { id: 219, biome: 1, name: 'Borneo lowland rain forests', realm: 'Indomalayan' } },
  { label: 'SIBERIAN TAIGA', lat: 62, lon: 105, elev: 400,
    eco: { id: 710, biome: 6, name: 'East Siberian taiga', realm: 'Palearctic' } },
  { label: 'YAMAL TUNDRA', lat: 68, lon: 70, elev: 40,
    eco: { id: 784, biome: 11, name: 'Yamal-Gydan tundra', realm: 'Palearctic' } },
  { label: 'SONORAN DESERT', lat: 32.25, lon: -111.16, elev: 750,
    eco: { id: 435, biome: 13, name: 'Sonoran desert', realm: 'Nearctic' } },
  { label: 'SAHARA', lat: 22.79, lon: 5.53, elev: 1380,
    eco: { id: 846, biome: 13, name: 'West Saharan montane xeric woodlands', realm: 'Palearctic' } },
  { label: 'AUSTRALIAN OUTBACK', lat: -25, lon: 133, elev: 400,
    eco: { id: 208, biome: 13, name: 'Central Ranges xeric scrub', realm: 'Australasia' } },
  { label: 'PATAGONIAN STEPPE', lat: -47, lon: -70.5, elev: 500,
    eco: { id: 578, biome: 8, name: 'Patagonian steppe', realm: 'Neotropic' } },
  { label: 'GREAT PLAINS', lat: 41.5, lon: -100.5, elev: 900,
    eco: { id: 395, biome: 8, name: 'Nebraska Sand Hills mixed grasslands', realm: 'Nearctic' } },
];

/**
 * ── THE GROUND THE SITE SAMPLER READS ──
 *
 * `siteAt` asks the world for heights around the point, because the local half
 * of a site — insolation, wetness, exposure — is terrain and nothing else. The
 * lab has no terrain, so it authors one, and it uses the SAME convention as
 * devtools/climate-fixtures.test.mjs, which learned it the hard way: ground
 * falling toward +z is ground whose height DECREASES with z, so a fall of `k`
 * per metre toward +z is `-k*z`. The bearing rotates that fall; +z is south in
 * this engine, so bearing 0 is a south-facing slope and the hemisphere decides
 * whether that is the sunny side.
 *
 * `ring` is what the ground does at 150m and out: positive is a HOLLOW (a
 * ravine floor collects water — it is the walls that say what it is, which is
 * why a gradient cannot answer this), negative a knoll. `upwind` is relief at
 * 15–40km, which is the rain shadow.
 */
interface LabGround { elev: number; tiltPct: number; bearDeg: number; ring: number; upwind: number }
function labSiteEnv(place: { lat: number; lon: number }, g: LabGround,
  cover: number | null, seaM: number | null): SiteEnv {
  const tilt = g.tiltPct / 100;
  const b = (g.bearDeg * Math.PI) / 180;
  const sinB = Math.sin(b), cosB = Math.cos(b);
  return {
    latAt: () => place.lat,
    latAbsAt: () => Math.abs(place.lat),
    // THE BAKED COAST FIELD, NOT A DIAL. Continentality is the one input that
    // is already global, already bundled and already right for a real
    // coordinate — Cape Town reads 0km and the Sahara reads a thousand — so
    // asking the reviewer to guess it would only let them get it wrong.
    coastKmAt: () => coastKm(place.lat, place.lon),
    seaNearAt: () => seaM,
    coverAt: () => cover,
    groundAt: (x: number, z: number) => {
      const r = Math.hypot(x, z);
      if (r > 10000) return g.elev + g.upwind;
      if (r > 150) return g.elev + g.ring;
      return g.elev - tilt * (z * cosB + x * sinB);
    },
  };
}

/** METRES PER DEGREE, as culture.ts uses it. The lab needs the inverse of the
 *  world's own `localToLatLon` so a plant standing 40m east of the origin gets
 *  the district and stand seeds it would get at that place on the planet —
 *  which is the whole of what makes a stand a stand. +z is south, exactly as
 *  the engine has it. */
const M_PER_DEG = 111320;
const labCultEnv = (lat: number, lon: number): CultureEnv => {
  const mLon = M_PER_DEG * Math.cos((lat * Math.PI) / 180);
  return { latLonAt: (x: number, z: number) => [lat - z / M_PER_DEG, lon + x / mLon] };
};

const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);
/** `none` is not a class, it is the absence of evidence — which is what the
 *  raster answers over most ground and what `coverKind`/`guildKind` are both
 *  written to take. */
const coverOf = (sel: string): number | null => (sel === 'none' ? null : parseInt(sel, 10));
const isEzFamily = (k: VegKind): k is EzFamily => (EZ_FAMILIES as string[]).includes(k);

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

  /**
   * ── AND THE SKELETONS, WHICH ARE WHAT THE WORLD ACTUALLY DRAWS ──
   *
   * Every broadleaf, conifer, acacia, palm and snag in the game has been a
   * baked EZ-Tree skeleton since the atlas shipped; the archetypes above them
   * are what the OTHER seven kinds still use, and what `?ez=0` restores. A
   * lab that showed only the lollipops was reviewing a version of the game
   * nobody plays — which it did, silently, for as long as the atlas has
   * existed.
   *
   * One InstancedMesh per variant, at the stand's own cap. The world keeps two
   * (a shadow-casting tier and its twin) because an instanced mesh is not
   * culled per instance and a distant tree's shadow lands outside the map;
   * there is no distance here worth the split.
   */
  const ezBendU = { value: 0 };
  const ezWindU = { uTime: { value: 0 }, uGust: { value: new THREE.Vector2() }, uWindK: { value: 0.085 } };
  const ezMat = ezMaterial(0x4a3826, { bend: ezBendU, wind: ezWindU });
  // The world chains terrainFx in here as well — cloud shadow and weather
  // tint — which the lab has no sky for. The grain is the same call it makes.
  grainFx(ezMat, 'lab-ez', 0.95, 2.2);
  const ezTiers = {} as Record<EzFamily, THREE.InstancedMesh[]>;
  for (const fam of EZ_FAMILIES) {
    ezTiers[fam] = ezVariants(fam).map((v) => {
      const m = new THREE.InstancedMesh(v.geometry, ezMat, CAP);
      m.count = 0;
      m.frustumCulled = false;
      m.castShadow = true;
      m.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(CAP * 3), 3);
      scene.add(m);
      return m;
    });
  }

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

    ezBendU.value = o.bend;
    ezWindU.uTime.value = now / 1000;
    // EXACTLY THE WORLD'S ARITHMETIC (see the wind step in main.ts): the gust
    // is metres of tip travel per metre of blade, clamped, and the trees take
    // `uWindK` of it. A lab that invented its own mapping would make the one
    // number worth arguing about — how much a wood moves in a gale — mean
    // something different here than it does from the seat.
    {
      const t = (o.windDeg * Math.PI) / 180;
      const amp = clamp(o.windKmh / 130, 0, 0.35);
      ezWindU.uGust.value.set(-Math.sin(t) * amp, Math.cos(t) * amp);
    }

    for (const k of Object.keys(meshes) as VegKind[]) meshes[k].count = 0;
    for (const fam of EZ_FAMILIES) for (const m of ezTiers[fam]) m.count = 0;
    let nTrunk = 0;
    for (const v of o.sites) {
      if (o.ez && isEzFamily(v.k)) {
        // THE SAME COMPOSITION `refreshVeg` USES, down to the crown reach.
        // A site's scale draw becomes metres at the family's own rate, and the
        // skeleton is scaled so the TOTAL — wood plus crown — is that height:
        // the bake stands every tree on y=0 with its wood topping out at y=1,
        // and the crown sticks out above it.
        const fam = v.k;
        const tier = ezTiers[fam][o.ezPick.get(v) ?? 0];
        if (!tier || tier.count >= CAP) continue;
        const formSy = clamp(1 + ((v.sy ?? 1) - 1) * o.formScale, 0.18, 4.5);
        const formSw = clamp(1 + ((v.sw ?? 1) - 1) * o.formScale, 0.18, 4.5);
        const H = (EZ_M_PER_SCALE[fam] * v.s * formSy * o.sizeScale) / (1 + ezCrownReach(fam));
        const i = tier.count++;
        dummy.position.set(v.x, 0, v.z);
        dummy.rotation.set((v.tl ?? 0) * o.formScale, v.rot, 0);
        dummy.scale.set(H * formSw, H, H * formSw);
        dummy.updateMatrix();
        tier.setMatrixAt(i, dummy.matrix);
        tier.instanceColor!.setXYZ(i, v.c.r, v.c.g, v.c.b);
        continue;
      }
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
    for (const fam of EZ_FAMILIES) {
      for (const m of ezTiers[fam]) {
        m.instanceMatrix.needsUpdate = true;
        m.instanceColor!.needsUpdate = true;
      }
    }

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
  /** The skeletons, and which variant each site drew — decided in `grow`,
   *  because that is where the guild's form preference and the district and
   *  stand seeds are known. */
  ez: boolean; ezPick: Map<VegSite, number>;
  sizeScale: number; formScale: number; bend: number;
  windKmh: number; windDeg: number;
}


export async function startFloraLab(): Promise<void> {
  document.title = 'DRIVE · FLORA LAB';
  const style = document.createElement('style');
  style.textContent = `
    html, body { margin: 0; height: 100%; background: #0b0f11; color: #d6e2e4; overflow: hidden;
      font: 12px/1.5 ui-monospace, SFMono-Regular, Menlo, monospace; }
    /* The gutter follows the panel — see paintFold in lab-dials. Folding it
       away is most of the point, and a hard 288px would keep the hole. */
    #panes { position: fixed; inset: 0 0 132px calc(var(--dials-w, 272px) + 16px);
      display: flex; flex-direction: column; transition: left .12s ease; }
    @media (max-width: 720px) { #panes { inset: 0 0 132px 0; } }
    #stand { flex: 1 1 62%; min-height: 200px; border-bottom: 1px solid #24343a; position: relative; }
    #stand canvas { display: block; width: 100%; height: 100%; image-rendering: pixelated; }
    #ladderWrap { flex: 0 0 38%; display: grid; place-items: center; overflow: hidden; }
    #ladder { max-width: 98%; max-height: 100%; }
    /* Clear of the dials, and it moves when they fold — see paintFold. */
    #status { position: fixed; left: var(--dials-w, 272px); right: 0; bottom: 0;
      padding: 8px 96px 8px 12px; white-space: pre; overflow: hidden;
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
  cv.width = 1400; cv.height = 500;
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
      // ── THE PLACE, WHICH IS THE WHOLE POINT OF THE GUILD ──
      { id: 'sPlace', label: 'THE PLACE', kind: 'section' },
      { id: 'place', label: 'PLACE', kind: 'select', value: 'CAPE PENINSULA',
        options: ['CUSTOM', ...PLACES.map((p) => p.label)] },
      // The exact A/B, and the same one `?guild=0` gives the game: off, the
      // ecoregion is withheld, `guildAt` returns null and every plant is
      // chosen by the five-biome climate path exactly as it was before.
      { id: 'guild', label: 'GUILD', kind: 'toggle', value: true },
      { id: 'lon', label: 'LON (custom)', kind: 'range', min: -180, max: 180, step: 0.5, value: 7 },
      { id: 'south', label: 'SOUTHERN (custom)', kind: 'toggle', value: false },
      // ── THE LOCAL HALF: what THIS slope does, which no climate cell knows ──
      { id: 'tilt', label: 'SLOPE %', kind: 'range', min: 0, max: 90, step: 1, value: 18 },
      { id: 'bear', label: 'FALLS TOWARD °', kind: 'range', min: 0, max: 350, step: 10, value: 0 },
      { id: 'ring', label: 'HOLLOW m', kind: 'range', min: -80, max: 80, step: 2, value: 0 },
      { id: 'upwind', label: 'UPWIND RELIEF m', kind: 'range', min: 0, max: 3000, step: 50, value: 0 },
      { id: 'seaM', label: 'SEA m (0 = inland)', kind: 'range', min: 0, max: 3000, step: 25, value: 0 },
      // ── WHERE ──
      { id: 'sWhere', label: 'WHERE', kind: 'section' },
      { id: 'lat', label: 'LATITUDE', kind: 'range', min: 0, max: 78, step: 0.5, value: 46 },
      { id: 'elev', label: 'ELEV m', kind: 'range', min: -50, max: 4500, step: 25, value: 700 },
      { id: 'moist', label: 'MOISTURE', kind: 'range', min: 0, max: 1, step: 0.02, value: 0.5 },
      { id: 'aspect', label: 'ASPECT m', kind: 'range', min: -300, max: 300, step: 10, value: 0 },
      // `none` IS A REAL ANSWER AND THE COMMONEST ONE. A cover pixel NARROWS a
      // guild — canopy picks from its trees, a shrub pixel damps them — so
      // leaving it at `10` shows a guild's forest and never its country, which
      // is how the first run of this lab reported 244 broadleaf on a fynbos
      // hillside. With no pixel the guild's own proportions come through.
      { id: 'cover', label: 'COVER CLASS', kind: 'select', value: 'none',
        options: ['none', '10', '20', '30', '40', '50', '60', '70', '90', '95', '100'] },
      { id: 'habitat', label: 'HABITAT DENSITY', kind: 'range', min: 0.05, max: 1, step: 0.05, value: 0.65 },
      { id: 'top', label: 'COLUMN TOP m', kind: 'range', min: 800, max: 6000, step: 100, value: 4000 },
      // ── THE SKELETONS, AND THE TREE RACK'S OWN LEVERS ──
      { id: 'sEz', label: 'THE SKELETONS', kind: 'section' },
      { id: 'ez', label: 'EZ SKELETONS', kind: 'toggle', value: true },
      // The two-scale variant choice against the old per-position hash — the
      // one that made two trees standing together an oak and a leggy aspen.
      { id: 'ezstand', label: 'PER STAND', kind: 'toggle', value: true },
      { id: 'variants', label: 'EZ VARIANTS', kind: 'select', value: 'ALL', options: ['1', '2', '4', 'ALL'] },
      { id: 'treeSize', label: 'HEIGHT x', kind: 'range', min: 0.4, max: 3, step: 0.1, value: 1 },
      { id: 'treeForm', label: 'FORM SPREAD x', kind: 'range', min: 0, max: 5, step: 0.25, value: 1 },
      { id: 'treeBend', label: 'GROWTH BEND', kind: 'range', min: 0, max: 1.1, step: 0.02, value: 0 },
      { id: 'windKmh', label: 'WIND km/h', kind: 'range', min: 0, max: 130, step: 5, value: 0 },
      { id: 'windDeg', label: 'WIND FROM °', kind: 'range', min: 0, max: 350, step: 10, value: 220 },
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
  /** Which baked variant each site drew, decided where the guild's forms and
   *  the two culture seeds are known. */
  let ezPick = new Map<VegSite, number>();
  /** The variant tally, and the number that says whether a wood is a wood:
   *  the mean count of DISTINCT silhouettes inside one 32m stand cell. Per
   *  position it read 1.54 at the Cape and per stand 1.07 — see __stand. */
  let ezNames: Array<[string, number]> = [];
  let perStand = 0;
  /** Written by the place selector, read to stop it writing again. */
  let lastPlace = '';

  /** Grow the stand. Deliberately the same sequence plantClump uses: ONE tone
   *  for the whole stand, a sqrt-biased radius so the clump has a core and a
   *  fringe, and one member in six of a different species — a monoculture is
   *  the single most obvious way a wood stops reading as a wood. */
  const grow = (w: number[], treeline: number, effElev: number, band: AltBand,
    guild: Guild | null, geo: { lat: number; lon: number }): void => {
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
    const cover = coverOf(dials.str('cover'));
    // ── WHO CHOOSES: THE GUILD, OR THE FIVE-BIOME LADDER ──
    // `guildKind` narrows to the guild's TREES on a canopy pixel and to its
    // whole mix otherwise, which is the same call `pickKind` makes in the
    // world. With no guild this is the shipping climate path, untouched.
    const roll = (): VegKind => (guild
      ? guildKind(guild, cover, r)
      : (bandKind(band, r) ?? coverKind(cover, w, r)));
    // AND THE GUILD SETS HOW MUCH STANDS HERE. In the world `density` scales
    // the candidate acceptance over an area AND sizes each clump; over a fixed
    // patch the honest analogue of the first half is the population itself,
    // which is also the only way that term becomes visible — `__vegkind` rolls
    // the chooser and cannot see it.
    const n = Math.max(1, Math.round(dials.num('count') * (guild?.density ?? 1)));
    const dens = clamp(dials.num('habitat') * (guild?.density ?? 1), 0, 1);
    const cult = labCultEnv(geo.lat, geo.lon);
    const vCapSel = dials.str('variants');
    const vCap = vCapSel === 'ALL' ? Number.MAX_SAFE_INTEGER : parseInt(vCapSel, 10);
    const standOn = dials.bool('ezstand');
    const out: VegSite[] = [];
    const tally = new Map<VegKind, number>();
    const picks = new Map<VegSite, number>();
    const names = new Map<string, number>();
    /** Distinct variants seen inside each 32m stand cell — the coherence
     *  number, computed the way `__stand` computes it in the world. */
    const inStand = new Map<number, Set<number>>();
    /**
     * ── A PATCH IS MANY CLUMPS, NOT ONE ──
     *
     * The first cut grew the whole population as a single clump with a single
     * dominant, and it could not show a guild's proportions at all: one roll
     * decided 83% of everything, so the Cape came out 244 broadleaf and 3
     * conifer out of a mix that is mostly shrub. The world scatters clumps of
     * 3–19 plants at 6–22 m and rolls a dominant and a tone for EACH — see
     * `seedCell` and `plantClump`, whose draws are copied here exactly,
     * `dens` included, because the lumpiness those numbers produce is most of
     * what a landscape looks like from a distance.
     */
    let guard = 0;
    while (out.length < n && guard++ < 4000) {
      // Uniform over the disc — sqrt, not the clump's own 0.62 bias, or every
      // stand would huddle at the origin.
      const ct = Math.sqrt(r()) * rad;
      const ca = r() * Math.PI * 2;
      const cx = Math.cos(ca) * ct, cz = Math.sin(ca) * ct;
      const tone = standTone(r, bedrock);           // ONE TONE FOR THE STAND
      const dominant: VegKind = want === 'mix' ? roll() : (want as VegKind);
      const cRad = 6 + r() * 16 * (0.4 + dens);
      const cN = Math.max(1, Math.round((5 + r() * 14) * (0.5 + dens)));
      for (let i = 0; i < cN && out.length < n; i++) {
        const t = Math.pow(r(), 0.62) * cRad;
        const a = r() * Math.PI * 2;
        const x = cx + Math.cos(a) * t, z = cz + Math.sin(a) * t;
        // One member in six is a different species — mixed stands, not
        // monoculture, and it is the guild that answers when there is one.
        const kind: VegKind = want === 'mix'
          ? (r() < 0.83 ? dominant : (guild ? roll() : ((climPick(VEG_MIX, w, r) as VegKind) ?? dominant)))
          : dominant;
        const site = plantLook(x, z, kind, r, {
          tone,
          biomeW: () => w,
          krummK: () => krummholz(effElev, treeline),
        }, FOLIAGE_ROWS);
        // THE GUILD SETS THE HEIGHT, exactly where the world sets it — after
        // the look, before anything draws, and never on stone: a boulder's
        // size is the mountain's business, not the vegetation's.
        if (guild && guild.scale !== 1 && !STONY.includes(kind)) site.s *= guild.scale;
        if (isEzFamily(kind)) {
          const standSeed = seedAt(cult, x, z, 'stand');
          const vi = standOn
            ? ezPickVariant(ezPalette(kind, seedAt(cult, x, z, 'district'), vCap, guild?.forms), standSeed)
            : ezVariantFor(kind, x, z, vCap);
          picks.set(site, vi);
          const nm = ezVariants(kind)[vi]?.label ?? `${kind} #${vi}`;
          names.set(nm, (names.get(nm) ?? 0) + 1);
          if (!inStand.has(standSeed)) inStand.set(standSeed, new Set());
          inStand.get(standSeed)!.add(vi);
        }
        out.push(site);
        tally.set(kind, (tally.get(kind) ?? 0) + 1);
      }
    }
    sites = out;
    ezPick = picks;
    census = [...tally.entries()].sort((p, q) => q[1] - p[1]);
    ezNames = [...names.entries()].sort((p, q) => q[1] - p[1]);
    perStand = inStand.size
      ? [...inStand.values()].reduce((acc, set) => acc + set.size, 0) / inStand.size
      : 0;
  };

  const draw = (): void => {
    // ── THE PLACE FIRST, BECAUSE EVERYTHING BELOW HANGS OFF IT ──
    // A place writes its own coordinates into the WHERE dials ONCE, so the
    // ladder and the column keep describing the same spot as the stand; after
    // that the dials rule and you can climb the hill from where it put you.
    const placeSel = dials.str('place');
    const place = PLACES.find((q) => q.label === placeSel) ?? null;
    if (place && placeSel !== lastPlace) {
      lastPlace = placeSel;
      dials.set({ lat: Math.abs(place.lat), lon: place.lon, south: place.lat < 0, elev: place.elev });
      return;                       // `set` fires the listeners; this is that call
    }
    if (!place) lastPlace = '';

    const lat = dials.num('lat');
    const elev = dials.num('elev');
    const moist = dials.num('moist');
    const cover = coverOf(dials.str('cover'));
    const latSigned = place ? place.lat : (dials.bool('south') ? -lat : lat);
    const lon = place ? place.lon : dials.num('lon');
    // The real climate computation, over a stand-in world whose cover and
    // height answer exactly what the dials say — so the sample is the game's,
    // taken at a place the dials describe.
    const env = {
      coverAt: () => cover,
      latAbsAt: () => lat,
      groundAt: () => elev,
    };
    const s = climCompute(env, 0, 0, 1);
    // ── AND THE TWO LAYERS UNDER THE FIVE BIOMES ──
    // `siteAt` over the authored hillside gives the physical facts a plant
    // responds to; the ecoregion is the one thing no climate model derives,
    // so it is looked up and not computed. `guildAt` returns null with no
    // region — the sea, a custom coordinate, the switch off — and every
    // caller then runs the shipping path unchanged, which is the A/B.
    const seaM = dials.num('seaM');
    const siteEnv = labSiteEnv({ lat: latSigned, lon }, {
      elev,
      tiltPct: dials.num('tilt'),
      bearDeg: dials.num('bear'),
      ring: dials.num('ring'),
      upwind: dials.num('upwind'),
    }, cover, seaM > 0 ? seaM : null);
    const site: SiteClimate = siteAt(siteEnv, 0, 0);
    const eco: EcoHit | null = place && dials.bool('guild') ? place.eco : null;
    const guild = guildAt(site, eco);
    const treeline = treelineAt(lat, moist);
    const eff0 = elev + dials.num('aspect');
    grow(s.w, treeline, eff0, altBandAt(eff0, treeline), guild, { lat: latSigned, lon });

    ctx.fillStyle = '#0b0f11';
    ctx.fillRect(0, 0, cv.width, cv.height);

    // ── WHAT GROWS HERE, AS BARS ──
    // The guild's own weights when there is one, the five-biome mix when
    // there is not — the same picture of the same decision, so flicking GUILD
    // off is a direct comparison rather than a change of subject.
    const barX = 40, barW = 260;
    ctx.font = '12px ui-monospace, monospace';
    const rows: Array<[string, number, boolean]> = guild
      ? (() => {
        const tot = guild.mix.reduce((acc, [, wgt]) => acc + wgt, 0) || 1;
        const treeOf = new Set(guild.trees.map(([k]) => k));
        return guild.mix.map(([k, wgt]) => [k, wgt / tot, treeOf.has(k)] as [string, number, boolean]);
      })()
      : BIOME_ORDER.map((b, i) => [b, s.w[i], i === s.domIdx] as [string, number, boolean]);
    for (let i = 0; i < rows.length; i++) {
      const [label, frac, hot] = rows[i];
      const y = 46 + i * 26;
      ctx.fillStyle = '#6f8285';
      ctx.fillText(label.toUpperCase(), barX, y - 4);
      ctx.strokeStyle = '#24343a';
      ctx.strokeRect(barX + 96, y - 14, barW, 12);
      ctx.fillStyle = hot ? '#7fd0c4' : '#3f6f6a';
      ctx.fillRect(barX + 96, y - 14, barW * Math.min(1, frac), 12);
      ctx.fillStyle = '#9fb2b5';
      ctx.fillText(frac.toFixed(3), barX + 96 + barW + 10, y - 3);
    }
    ctx.fillStyle = '#6f8285';
    ctx.fillText(guild
      ? `GUILD MIX · ${guild.name.toUpperCase()}${guild.trees.length ? '  (teal = a tree)' : ''}`
      : 'BIOME MIX AT THE POINT (no guild)', barX, 28);

    // ── THE SITE: THE PHYSICAL FACTS UNDER BOTH OF THEM ──
    // Not a classification — the things a plant actually responds to, which
    // is what makes the guild's `why` legible rather than an assertion.
    {
      // ITS OWN COLUMN. Stacked under the bars it ran off the bottom of the
      // canvas — fourteen rows below a mix that is itself up to eight — and
      // the first thing it cut was `salt`, which is the one term that decides
      // whether a coast grows mangrove.
      const sx = 500, sy0 = 46;
      ctx.fillStyle = '#6f8285';
      ctx.fillText('THE SITE', sx, sy0 - 18);
      const cells: Array<[string, string]> = [
        ['heat', `${site.heatC.toFixed(1)}°C`],
        ['summer/winter', `${site.summerC.toFixed(0)} / ${site.winterC.toFixed(0)}°C`],
        ['frost days', `${Math.round(site.frostDays)}`],
        ['water', `${Math.round(site.waterMm)} mm`],
        ['summer dry', site.summerDry.toFixed(2)],
        ['winter dry', site.winterDry.toFixed(2)],
        ['continentality', `${site.contin.toFixed(2)}${site.hadCoast ? '' : ' (no coast)'}`],
        ['rain shadow', site.rainShadow.toFixed(2)],
        ['treeline', `${site.treelineDelta > 0 ? '+' : ''}${Math.round(site.treelineDelta)} m`],
        ['— local —', ''],
        ['insolation', site.insolation.toFixed(2)],
        ['wetness', site.wetness.toFixed(2)],
        ['salt', site.salt.toFixed(2)],
        ['exposure', site.exposure.toFixed(2)],
      ];
      cells.forEach(([k, v], i) => {
        const y = sy0 + i * 16;
        ctx.fillStyle = '#6f8285';
        ctx.fillText(k, sx, y);
        ctx.fillStyle = '#9fb2b5';
        ctx.fillText(v, sx + 150, y);
      });
    }

    // ── THE COLUMN: EVERY ALTITUDE ABOVE THIS SPOT ──
    // The one picture that makes the band model legible — where montane gives
    // way to treeline, krummholz, meadow, scree and snow, and how far the
    // sward still reaches into each.
    const colX = 820, colW = 300, colTop = 40, colH = cv.height - 110;
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
    const where = place
      ? `${place.label} ${place.lat.toFixed(2)},${place.lon.toFixed(2)} ${Math.round(elev)}m`
      : `CUSTOM ${latSigned.toFixed(1)},${lon.toFixed(1)} ${Math.round(elev)}m`;
    const ecoLine = eco
      ? `${eco.name} · ${ecoBiomeName(eco.biome)} · ${eco.realm}`
      : (place ? 'ECOREGION WITHHELD (guild off — the shipping climate path)' : 'no ecoregion for a custom point');
    // THE DIVERSITY READOUT. "Is this stand varied" is not a feeling when the
    // tally is on the glass: one species at 190 is a plantation, five species
    // with a dominant at two thirds is a wood. `perStand` is the same question
    // one level down — how many SILHOUETTES stand inside one 32m thicket.
    const topSil = ezNames.slice(0, 4).map(([nm, n]) => `${nm} ×${n}`).join(' · ');
    status.textContent =
      `${where} · ${ecoLine}\n`
      + (guild
        ? `GUILD ${guild.name} · scale ×${guild.scale.toFixed(2)} · density ×${guild.density.toFixed(2)}`
          + ` · forms ${guild.forms.length ? guild.forms.join(',') : 'no opinion'}`
          + `${guild.why.length ? ` · ${guild.why.join(' · ')}` : ''}\n`
        : `NO GUILD · ${BIOME_ORDER[s.domIdx].toUpperCase()} · ${s.tempC.toFixed(1)}°C`
          + ` · moisture ${s.moisture.toFixed(2)} · sea temp ${seaTempAt(lat).toFixed(1)}°C\n`)
      + `band ${ALT_BAND_NAMES[band].toUpperCase()} · sward ${swardLift(eff, treeline).toFixed(2)}`
      + ` · krummholz ${krummholz(eff, treeline).toFixed(2)} · lapse ${(LAPSE * 1000).toFixed(1)}°C/km`
      + ` · bedrock ${STONE_NAMES[bedrock]}\n`
      + `STAND ${sites.length} · ${spread || 'nothing grows here'}\n`
      + (ezNames.length
        ? `SILHOUETTES ${ezNames.length} · ${perStand.toFixed(2)} per 32m stand · ${topSil}`
        : 'SILHOUETTES none — nothing here has a baked skeleton');
  };

  dials.onChange(draw);
  const opts = (): StandOpts => ({
    sites,
    ez: dials.bool('ez'),
    ezPick,
    sizeScale: dials.num('treeSize'),
    formScale: dials.num('treeForm'),
    bend: dials.num('treeBend'),
    windKmh: dials.num('windKmh'),
    windDeg: dials.num('windDeg'),
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
