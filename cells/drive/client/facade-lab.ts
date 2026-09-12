import * as THREE from 'three';
import { BUILD_CULTURES, type BuildCulture } from './culture';
import { FACADE_DEFAULTS, FACADE_GRAMMAR, facade, setFacadeGrammar, uFacNight, uFacSun, type FacadeGrammar } from './facade';
import { roofFx } from './roof-fx';
import { TRADITIONS, roofFormFor, traditionCulture, traditionIndex, type Tradition } from './traditions';
import { createDials, type DialValues } from './lab-dials';
import { clamp } from './num';
import { roofGeo } from './roof';
import { makeCanvasTex, wallTextures } from './wall-tex';

/**
 * ── THE FAÇADE LAB: ONE BUILDING, THE REAL SHADER, EVERY NUMBER ON A DIAL ──
 *
 * The marks lab put the production façade shader on four slabs so the
 * graffiti could be judged without a world. This is that lab widened to the
 * whole façade, because the building review's open items — one bay grid for
 * the planet, floors that do not follow the culture's storey, whether a door
 * stands at street level at all — are every one of them a question about the
 * shader's GRAMMAR against a building's MASSING, and neither a slab nor the
 * world can put the two side by side with a slider on each.
 *
 * So: one footprint extruded exactly as polygon() extrudes it in main.ts
 * (ExtrudeGeometry, rotated and mirrored, caps and sides as the two material
 * groups the batch splits on), sunk by the same plinth, wearing the culture's
 * own wall and roof canvases (wallTextures — the bake the game runs, not a
 * copy), roofed by roofGeo (the function the game calls), with the sun on a
 * dial and the eye 26 m off: the building survey's stand-off, how far a
 * driver is from the building line across a suburban street. The opening
 * grammar is FACADE_GRAMMAR pushed live, and COPY writes that literal.
 *
 * WHAT IT SHOWED BEFORE A DIAL WAS TURNED: THE PLINTH. polygon() sinks every
 * intact building by a plinth — 1.4 m on the flat, the footprint's own relief
 * more on a slope — and the shader counts its rows from the sunk base, so on
 * flat ground the ground-floor row is 1.7 m tall, a door's head stands 0.46 m
 * above the pavement, and the first upper window starts at 2.75 m. Uphill on
 * a slope the whole ground row is below the grass. The PLINTH dial is here so
 * that can be seen at will, and so a fix can be judged against it.
 *
 * WHAT IT DOES NOT DO: the composite. The game quantises to fourteen levels
 * and dithers at art resolution; here the PIXEL dial renders at a fraction of
 * the glass and magnifies nearest-neighbour, which is the pixel grid without
 * the palette. Whether a lintel survives the quantiser is a question for the
 * survey frames, which is why phase 0 takes both.
 */

const ROOFS = ['culture', 'gabled', 'hipped', 'pyramidal', 'skillion', 'flat'] as const;
const hex = (n: number): string => `#${n.toString(16).padStart(6, '0')}`;
/** The CULTURE dial offers the six cultures and, after them, every atlas
 *  entry as `t:<key>` — so a tradition can be judged as the world will build
 *  it, and argued with, on the same wall. */
const CULTURE_OPTIONS = [...BUILD_CULTURES.map((c) => c.key), ...Object.keys(TRADITIONS).map((k) => `t:${k}`)];
/** The grammar dials, by the FacadeGrammar field each carries — storeyM is
 *  the ROW dial, because the massing has its own storey. */
const GRAMMAR_DIALS: Record<keyof FacadeGrammar, string> = {
  bayM: 'bayM', storeyM: 'gridM', winX0: 'winX0', winX1: 'winX1', winY0: 'winY0', winY1: 'winY1',
  doorX0: 'doorX0', doorX1: 'doorX1', doorY1: 'doorY1', doorShare: 'doorShare', openShare: 'openShare',
  glassShade: 'glassShade', glassVar: 'glassVar', lintel: 'lintel', ivy: 'ivy', stain: 'stain',
  revealM: 'revealM', sillM: 'sillM', frame: 'frame', mullion: 'mullion', glassSky: 'glassSky',
  stringCourse: 'stringCourse', cornice: 'cornice', plinthM: 'plinthM', shutters: 'shutters', balcony: 'balcony',
  streaks: 'streaks', dampM: 'dampM', trim: 'trim', shutterCol: 'shutterCol', shopfront: 'shopfront', eaveM: 'eaveM',
};

/** The game's extrusion, to the letter — see polygon() in main.ts. The shape
 *  is XY, rotated onto XZ, mirrored so the extrusion runs up, and translated
 *  so the box spans bottom..top. */
function extrude(pts: Array<[number, number]>, bottom: number, top: number): THREE.BufferGeometry {
  const shape = new THREE.Shape(pts.map(([x, z]) => new THREE.Vector2(x, z)));
  const geo = new THREE.ExtrudeGeometry(shape, { depth: top - bottom, bevelEnabled: false });
  geo.rotateX(Math.PI / 2);
  geo.scale(1, -1, 1);
  geo.translate(0, bottom, 0);
  return geo;
}
/** aBase, aMark and aGram: the three attributes the tile batch owes every
 *  vertex. No marks here; aGram is 0 (the uniforms, which the dials drive)
 *  unless VIA ATTRIBUTE asks the wall to read its tradition's row instead. */
function withBase(geo: THREE.BufferGeometry, base: number, gram: number, top: number): THREE.BufferGeometry {
  const n = geo.attributes.position.count;
  geo.setAttribute('aBase', new THREE.BufferAttribute(new Float32Array(n).fill(base), 1));
  geo.setAttribute('aMark', new THREE.BufferAttribute(new Float32Array(n), 1));
  geo.setAttribute('aGram', new THREE.BufferAttribute(new Float32Array(n).fill(gram), 1));
  geo.setAttribute('aTop', new THREE.BufferAttribute(new Float32Array(n).fill(top), 1));
  return geo;
}
const num = (v: DialValues, k: string): number => Number(v[k]);
const bool = (v: DialValues, k: string): boolean => v[k] === true;
const str = (v: DialValues, k: string): string => String(v[k]);

/** What the CULTURE dial names: one of the six, or an atlas entry resolved
 *  through traditionCulture exactly as buildLook resolves it. */
function cultureOf(v: DialValues): { culture: BuildCulture; tradition: Tradition | null } {
  const k = str(v, 'culture');
  if (k.startsWith('t:')) {
    const t = TRADITIONS[k.slice(2)];
    if (t) return { culture: traditionCulture(t), tradition: t };
  }
  return { culture: BUILD_CULTURES.find((c) => c.key === k) ?? BUILD_CULTURES[0], tradition: null };
}

/** The grammar the dials describe, resolved against the culture where a
 *  toggle says to follow it — one function, so COPY and the wall agree. */
function grammarFrom(v: DialValues): FacadeGrammar {
  const { culture } = cultureOf(v);
  const storeyM = bool(v, 'cultureStorey') ? culture.storeyM : num(v, 'storeyM');
  return {
    bayM: num(v, 'bayM'),
    storeyM: bool(v, 'gridFollows') ? storeyM : num(v, 'gridM'),
    winX0: num(v, 'winX0'), winX1: num(v, 'winX1'), winY0: num(v, 'winY0'), winY1: num(v, 'winY1'),
    doorX0: num(v, 'doorX0'), doorX1: num(v, 'doorX1'), doorY1: num(v, 'doorY1'),
    doorShare: num(v, 'doorShare'), openShare: num(v, 'openShare'),
    glassShade: num(v, 'glassShade'), glassVar: num(v, 'glassVar'),
    lintel: num(v, 'lintel'), ivy: num(v, 'ivy'), stain: num(v, 'stain'),
    revealM: num(v, 'revealM'), sillM: num(v, 'sillM'), frame: num(v, 'frame'), mullion: num(v, 'mullion'),
    glassSky: num(v, 'glassSky'), stringCourse: num(v, 'stringCourse'), cornice: num(v, 'cornice'), plinthM: num(v, 'plinthM'),
    shutters: num(v, 'shutters'), balcony: num(v, 'balcony'), streaks: num(v, 'streaks'), dampM: num(v, 'dampM'),
    trim: Math.round(num(v, 'trim')), shutterCol: Math.round(num(v, 'shutterCol')), shopfront: num(v, 'shopfront'), eaveM: num(v, 'eaveM'),
  };
}

export async function startFacadeLab(): Promise<void> {
  document.title = 'DRIVE · FAÇADE LAB';
  const style = document.createElement('style');
  style.textContent = `
    html, body { margin: 0; height: 100%; background: #0b0f11; overflow: hidden;
      font: 12px/1.5 ui-monospace, SFMono-Regular, Menlo, monospace; color: #d6e2e4; }
    canvas.view { display: block; width: 100vw; height: 100vh; image-rendering: pixelated; }
    #status { position: fixed; left: var(--dials-w, 272px); bottom: 0; right: 0;
      padding: 8px 12px; white-space: pre-wrap;
      background: rgba(8,14,16,.86); border-top: 1px solid #24343a; letter-spacing: 1px; }
    a.back { position: fixed; right: 8px; top: 8px; color: #6f8285; text-decoration: none;
      letter-spacing: 2px; }`;
  document.head.appendChild(style);
  const status = document.createElement('div');
  status.id = 'status';
  document.body.appendChild(status);
  const back = document.createElement('a');
  back.className = 'back'; back.href = '/lab'; back.textContent = 'ALL LABS';
  document.body.appendChild(back);

  // ── THE DIALS ──
  // Liberal on purpose. Everything the shader reads, everything the massing
  // is made of, the light and the eye — a number you cannot turn is a number
  // you will guess at, and the whole point of phase 0 is to stop guessing.
  const G = FACADE_GRAMMAR;
  const dials = createDials({
    slug: 'facade',
    spec: [
      { id: 'sBld', label: 'THE BUILDING', kind: 'section' },
      { id: 'culture', label: 'CULTURE', kind: 'select', value: BUILD_CULTURES[0].key, options: CULTURE_OPTIONS },
      { id: 'wallPick', label: 'WALL PAINT #', kind: 'range', min: 0, max: 6, step: 1, value: 0 },
      { id: 'roofPick', label: 'ROOF PAINT #', kind: 'range', min: 0, max: 3, step: 1, value: 0 },
      { id: 'custom', label: 'CUSTOM PAINT', kind: 'toggle', value: false },
      { id: 'paint', label: 'WALL', kind: 'color', value: hex(BUILD_CULTURES[0].wall[0]) },
      { id: 'roofPaint', label: 'ROOF', kind: 'color', value: hex(BUILD_CULTURES[0].roof[0]) },
      // Wider than deep, so the ridge — roofGeo runs it along the LONGEST edge
      // — lies across the frame and the eye sees an eave and a roof slope; a
      // deeper-than-wide default put a gable end square to the camera and its
      // limewash triangle read as a pale hipped roof in the first frames.
      { id: 'width', label: 'WIDTH m', kind: 'range', min: 3, max: 40, step: 0.5, value: 11 },
      { id: 'depth', label: 'DEPTH m', kind: 'range', min: 3, max: 30, step: 0.5, value: 8 },
      { id: 'storeys', label: 'STOREYS', kind: 'range', min: 1, max: 9, step: 1, value: 2 },
      { id: 'cultureStorey', label: 'CULTURE STOREY', kind: 'toggle', value: true },
      { id: 'storeyM', label: 'STOREY m', kind: 'range', min: 2.2, max: 4.2, step: 0.05, value: 3.0 },
      { id: 'plinth', label: 'PLINTH m', kind: 'range', min: 0, max: 4, step: 0.1, value: 1.4 },
      // ON: aBase is the ground line, as polygon() hands the batch now. OFF:
      // aBase is the plinth's bottom, which is what every building on earth
      // had until the lab measured it — the A/B for that fix, one switch.
      { id: 'baseGround', label: 'BASE = GROUND', kind: 'toggle', value: true },
      { id: 'roof', label: 'ROOF', kind: 'select', value: 'culture', options: ROOFS },
      { id: 'cultureRidge', label: 'CULTURE RIDGE', kind: 'toggle', value: true },
      { id: 'ridge', label: 'RIDGE m', kind: 'range', min: 0.4, max: 8, step: 0.1, value: 2.2 },
      { id: 'terrace', label: 'TERRACE', kind: 'range', min: 1, max: 8, step: 1, value: 1 },
      { id: 'sGram', label: 'THE OPENINGS', kind: 'section' },
      // ON: the wall reads its tradition's ROW of the atlas texture through
      // aGram, exactly as a building in the world does, and the uniforms are
      // parked at the defaults — so the picture must come from the texture,
      // and a wall that changed with the toggle would say the two paths
      // disagree. OFF: the dials drive the uniforms and aGram is 0.
      { id: 'viaAttr', label: 'VIA ATTRIBUTE', kind: 'toggle', value: false },
      { id: 'bayM', label: 'BAY m', kind: 'range', min: 1.2, max: 6, step: 0.05, value: G.bayM },
      { id: 'gridFollows', label: 'ROWS = STOREYS', kind: 'toggle', value: false },
      { id: 'gridM', label: 'ROW m', kind: 'range', min: 2.2, max: 4.5, step: 0.05, value: G.storeyM },
      { id: 'winX0', label: 'WIN X0', kind: 'range', min: 0, max: 0.5, step: 0.01, value: G.winX0 },
      { id: 'winX1', label: 'WIN X1', kind: 'range', min: 0.5, max: 1, step: 0.01, value: G.winX1 },
      { id: 'winY0', label: 'WIN Y0', kind: 'range', min: 0, max: 0.6, step: 0.01, value: G.winY0 },
      { id: 'winY1', label: 'WIN Y1', kind: 'range', min: 0.4, max: 1, step: 0.01, value: G.winY1 },
      { id: 'doorX0', label: 'DOOR X0', kind: 'range', min: 0, max: 0.5, step: 0.01, value: G.doorX0 },
      { id: 'doorX1', label: 'DOOR X1', kind: 'range', min: 0.5, max: 1, step: 0.01, value: G.doorX1 },
      { id: 'doorY1', label: 'DOOR HEAD', kind: 'range', min: 0.2, max: 1, step: 0.01, value: G.doorY1 },
      { id: 'doorShare', label: 'DOORS', kind: 'range', min: 0, max: 1, step: 0.02, value: G.doorShare },
      { id: 'openShare', label: 'OPENINGS', kind: 'range', min: 0, max: 1, step: 0.02, value: G.openShare },
      { id: 'glassShade', label: 'GLASS', kind: 'range', min: 0, max: 0.6, step: 0.01, value: G.glassShade },
      { id: 'glassVar', label: 'GLASS VAR', kind: 'range', min: 0, max: 0.5, step: 0.01, value: G.glassVar },
      { id: 'lintel', label: 'LINTEL', kind: 'range', min: 0, max: 0.6, step: 0.01, value: G.lintel },
      { id: 'ivy', label: 'IVY', kind: 'range', min: 0, max: 2, step: 0.05, value: G.ivy },
      { id: 'stain', label: 'STAIN', kind: 'range', min: 0, max: 0.5, step: 0.01, value: G.stain },
      { id: 'sArt', label: 'DEPTH AND TRIM', kind: 'section' },
      { id: 'revealM', label: 'REVEAL m', kind: 'range', min: 0, max: 0.5, step: 0.01, value: G.revealM },
      { id: 'sillM', label: 'SILL m', kind: 'range', min: 0, max: 0.3, step: 0.01, value: G.sillM },
      { id: 'frame', label: 'FRAME', kind: 'range', min: 0, max: 1, step: 0.02, value: G.frame },
      { id: 'mullion', label: 'MULLIONS', kind: 'range', min: 0, max: 1, step: 0.02, value: G.mullion },
      { id: 'glassSky', label: 'SKY IN GLASS', kind: 'range', min: 0, max: 1, step: 0.02, value: G.glassSky },
      { id: 'trim', label: 'TRIM #', kind: 'range', min: 0, max: 7, step: 1, value: G.trim },
      { id: 'shutters', label: 'SHUTTERS', kind: 'range', min: 0, max: 1, step: 0.02, value: G.shutters },
      { id: 'shutterCol', label: 'SHUTTER #', kind: 'range', min: 0, max: 7, step: 1, value: G.shutterCol },
      { id: 'balcony', label: 'BALCONIES', kind: 'range', min: 0, max: 1, step: 0.02, value: G.balcony },
      { id: 'shopfront', label: 'SHOPFRONTS', kind: 'range', min: 0, max: 1, step: 0.02, value: G.shopfront },
      { id: 'stringCourse', label: 'STRING COURSE', kind: 'range', min: 0, max: 1, step: 0.02, value: G.stringCourse },
      { id: 'cornice', label: 'CORNICE', kind: 'range', min: 0, max: 1, step: 0.02, value: G.cornice },
      { id: 'eaveM', label: 'EAVE m', kind: 'range', min: 0, max: 1.2, step: 0.02, value: G.eaveM },
      { id: 'plinthM', label: 'PLINTH BAND m', kind: 'range', min: 0, max: 2, step: 0.05, value: G.plinthM },
      { id: 'streaks', label: 'STREAKS', kind: 'range', min: 0, max: 1, step: 0.02, value: G.streaks },
      { id: 'dampM', label: 'DAMP m', kind: 'range', min: 0, max: 2, step: 0.05, value: G.dampM },
      { id: 'sLight', label: 'THE LIGHT', kind: 'section' },
      { id: 'sunAlt', label: 'SUN ALT', kind: 'range', min: 3, max: 85, step: 1, value: 52 },
      { id: 'sunAz', label: 'SUN AZ', kind: 'range', min: -180, max: 180, step: 5, value: 35 },
      { id: 'ambient', label: 'SKY', kind: 'range', min: 0, max: 2, step: 0.05, value: 1.1 },
      { id: 'night', label: 'NIGHT', kind: 'toggle', value: false },
      { id: 'lit', label: 'LIT BAYS', kind: 'range', min: 0, max: 1, step: 0.02, value: 0.34 },
      { id: 'sView', label: 'THE EYE', kind: 'section' },
      { id: 'dist', label: 'STAND-OFF m', kind: 'range', min: 6, max: 80, step: 1, value: 26 },
      { id: 'eye', label: 'EYE m', kind: 'range', min: 0.5, max: 30, step: 0.1, value: 1.3 },
      { id: 'yaw', label: 'YAW', kind: 'range', min: -180, max: 180, step: 5, value: 20 },
      { id: 'pixel', label: 'PIXEL', kind: 'range', min: 1, max: 4, step: 0.5, value: 1 },
    ],
    // PASTE-READY. The literal is the one in facade.ts, so a grammar found on
    // this wall reaches the engine as a paste rather than sixteen transcriptions.
    source: (v: DialValues) => {
      const g = grammarFrom(v);
      return ['// tuned in /lab/facade', 'export const FACADE_GRAMMAR: FacadeGrammar = {',
        ...(Object.keys(g) as Array<keyof FacadeGrammar>).map((k) => `  ${k}: ${g[k]},`), '};'].join('\n');
    },
  });

  const renderer = new THREE.WebGLRenderer({ antialias: false });
  renderer.setPixelRatio(1);
  renderer.domElement.className = 'view';
  document.body.appendChild(renderer.domElement);
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x2c3f47);
  // The cab's lens.
  const camera = new THREE.PerspectiveCamera(55, innerWidth / innerHeight, 0.1, 600);
  const sun = new THREE.DirectionalLight(0xfff2dc, 2.1);
  const sky = new THREE.AmbientLight(0x7d94a0, 1.1);
  scene.add(sun, sky);
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(400, 400),
    new THREE.MeshLambertMaterial({ color: 0x50564a }));
  ground.rotateX(-Math.PI / 2);
  scene.add(ground);

  // THE PRODUCTION MATERIALS. The same construction registerCulturePaint uses:
  // a Lambert per surface, the culture's canvas as its map, DoubleSide because
  // the mirrored extrusion leaves the winding mixed, the façade hung on the
  // wall and the roof at 0.78 of its paint — a roof is tile or felt and has
  // no business being the brighter of the two.
  const tex = wallTextures(makeCanvasTex(Math.min(8, renderer.capabilities.getMaxAnisotropy())));
  const wallMat = new THREE.MeshLambertMaterial({ color: 0xe9dcc6, map: tex.WALL_TEX.render, side: THREE.DoubleSide });
  facade(wallMat);
  const roofMat = new THREE.MeshLambertMaterial({ color: 0xa8613c, map: tex.ROOF_TEX.pantile, side: THREE.DoubleSide });
  roofFx(roofMat, 'pantile');
  const group = new THREE.Group();
  scene.add(group);

  let builtKey = '';
  let roofRefused = false;
  const rebuild = (w: number, d: number, height: number, plinth: number, aBase: number, gram: number,
    roofShape: string, ridge: number, terrace: number): void => {
    for (const m of group.children) (m as THREE.Mesh).geometry.dispose();
    group.clear();
    roofRefused = false;
    // A terrace is N footprints sharing a wall, extruded one by one — which is
    // exactly what the game does with N attached OSM rings, party wall and all.
    const total = w * terrace;
    for (let i = 0; i < terrace; i++) {
      const x0 = -total / 2 + i * w;
      const pts: Array<[number, number]> = [[x0, -d / 2], [x0 + w, -d / 2], [x0 + w, d / 2], [x0, d / 2]];
      group.add(new THREE.Mesh(withBase(extrude(pts, -plinth, height), aBase, gram, height), [roofMat, wallMat]));
      if (roofShape !== 'flat') {
        const rg = roofGeo(pts, roofShape, height, ridge);
        if (rg) group.add(new THREE.Mesh(withBase(rg, aBase, gram, height), [roofMat, wallMat]));
        else roofRefused = true;
      }
    }
  };

  let sized = { w: 0, h: 0, px: 0 };
  const size = (px: number): void => {
    if (sized.w === innerWidth && sized.h === innerHeight && sized.px === px) return;
    sized = { w: innerWidth, h: innerHeight, px };
    renderer.setSize(Math.round(innerWidth / px), Math.round(innerHeight / px), false);
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
  };

  let report: Record<string, unknown> = {};
  let lastTradition = '';
  const apply = (): void => {
    const v = dials.values();
    const { culture, tradition } = cultureOf(v);
    // A tradition CHOSEN sets the grammar dials to what it states, once, and
    // the dials are the record from then on — turn one and it is yours. The
    // set fires onChange, which re-enters here with the tradition already
    // noted, so the wall is built once.
    if (tradition && tradition.key !== lastTradition) {
      lastTradition = tradition.key;
      const g = { ...FACADE_DEFAULTS, ...tradition.grammar };
      const patch: DialValues = { ...v };
      for (const k of Object.keys(GRAMMAR_DIALS) as Array<keyof FacadeGrammar>) patch[GRAMMAR_DIALS[k]] = g[k];
      patch.gridFollows = false;
      dials.set(patch);
      return;
    }
    if (!tradition) lastTradition = '';
    const storeyM = bool(v, 'cultureStorey') ? culture.storeyM : num(v, 'storeyM');
    const storeys = Math.round(num(v, 'storeys'));
    const height = storeys * storeyM;
    const g = grammarFrom(v);
    // The attribute path parks the uniforms at the defaults so the texture is
    // the only thing that can be dressing the wall.
    const gram = bool(v, 'viaAttr') && tradition ? traditionIndex(tradition.key) : 0;
    setFacadeGrammar(gram ? { ...FACADE_DEFAULTS } : g);
    const night = bool(v, 'night');
    uFacNight.value.set(night ? 1 : 0, num(v, 'lit'));
    // The paint: the culture's own palette by index, or a colour typed in.
    const wallCol = bool(v, 'custom') ? new THREE.Color(str(v, 'paint'))
      : new THREE.Color(culture.wall[Math.round(num(v, 'wallPick')) % culture.wall.length]);
    const roofCol = bool(v, 'custom') ? new THREE.Color(str(v, 'roofPaint'))
      : new THREE.Color(culture.roof[Math.round(num(v, 'roofPick')) % culture.roof.length]);
    wallMat.color.copy(wallCol);
    roofMat.color.copy(roofCol).multiplyScalar(0.78);
    if (wallMat.map !== tex.WALL_TEX[culture.wallTex]) { wallMat.map = tex.WALL_TEX[culture.wallTex]; wallMat.needsUpdate = true; }
    if (roofMat.map !== tex.ROOF_TEX[culture.roofTex]) {
      // The kind rides on userData and the hook reads it at compile, which
      // needsUpdate forces — so the courses change with the canvas.
      roofMat.map = tex.ROOF_TEX[culture.roofTex]; roofMat.userData.roofKind = culture.roofTex; roofMat.needsUpdate = true;
    }
    // The massing. The culture's roof is what building() picks for a plain
    // house of this tradition: flat below a 0.2 pitch, else a gable (the hip
    // is a minority draw there, and there is a dial for it here). The ridge is
    // building()'s own rule off the culture's base pitch — snowLoad steepens
    // it in the world, and that is one of the numbers the dial exists to try.
    const ask = str(v, 'roof');
    // 'culture': a tradition's commonest form (its table read at the median
    // draw), else the six cultures' own rule — flat below a 0.2 pitch.
    const roofShape = ask !== 'culture' ? ask
      : tradition ? (roofFormFor(tradition, 0.5) ?? 'gabled') : (culture.pitch < 0.2 ? 'flat' : 'gabled');
    const w = num(v, 'width'), d = num(v, 'depth'), plinth = num(v, 'plinth');
    // The shader's base: the ground line (the game's rule now), or the sunk
    // bottom of the box (the rule the lab found and the toggle keeps for A/B).
    const aBase = bool(v, 'baseGround') ? 0 : -plinth;
    const ridge = bool(v, 'cultureRidge') ? clamp((Math.min(w, d) / 2) * culture.pitch, 1.2, 7) : num(v, 'ridge');
    const terrace = Math.round(num(v, 'terrace'));
    const key = [w, d, height, plinth, aBase, gram, roofShape, ridge, terrace].join('|');
    if (key !== builtKey) { builtKey = key; rebuild(w, d, height, plinth, aBase, gram, roofShape, ridge, terrace); }
    // The light. At night the sun is the moon and the sky is a floor; the
    // game's skylight lift (bldSkylit) is not reproduced, so a night wall here
    // reads darker than in the world — the lit bays are what this is for.
    const alt = num(v, 'sunAlt') * Math.PI / 180, az = num(v, 'sunAz') * Math.PI / 180;
    sun.position.set(Math.cos(alt) * Math.sin(az) * 40, Math.sin(alt) * 40, Math.cos(alt) * Math.cos(az) * 40);
    uFacSun.value.copy(sun.position).normalize();
    sun.intensity = night ? 0.06 : 2.1;
    sky.intensity = night ? 0.14 : num(v, 'ambient');
    (scene.background as THREE.Color).set(night ? 0x0a1016 : 0x2c3f47);
    // The eye: level, like the cab's, at the survey's stand-off.
    const yaw = num(v, 'yaw') * Math.PI / 180, dist = num(v, 'dist'), eye = num(v, 'eye');
    camera.position.set(Math.sin(yaw) * dist, eye, Math.cos(yaw) * dist);
    camera.lookAt(0, eye, 0);
    size(num(v, 'pixel'));
    // What the grammar makes of this massing — the numbers the review asked
    // for and could not read off a frame.
    const bays = (w / g.bayM), rows = height / g.storeyM;
    const row1 = g.storeyM + aBase, doorHead = g.doorY1 * g.storeyM + aBase;
    const win1 = g.storeyM + g.winY0 * g.storeyM + aBase;
    report = {
      culture: culture.key, tradition: tradition?.key ?? null, gramIndex: gram, viaAttribute: gram > 0,
      w, d, storeys, storeyM, height, roof: roofShape, ridge, terrace, plinth, aBase,
      bays: +bays.toFixed(2), rows: +rows.toFixed(2), row1AboveGround: +row1.toFixed(2),
      doorHeadAboveGround: +doorHead.toFixed(2), firstWindowSill: +win1.toFixed(2), roofRefused, night,
    };
    status.textContent =
      `${culture.key.toUpperCase()}${tradition ? ` (atlas: ${tradition.base} base)` : ''} · ${w} x ${d} m · ${storeys} storeys of ${storeyM.toFixed(2)} = ${height.toFixed(1)} m`
      + ` · roof ${roofShape}${roofShape === 'flat' ? '' : ` ridge ${ridge.toFixed(1)}`}${roofRefused ? ' (roofGeo REFUSED this plan)' : ''}`
      + ` · ${terrace > 1 ? `terrace of ${terrace}` : 'detached'}${gram ? ` · grammar VIA aGram row ${gram}` : ''}\n`
      + `bays ${bays.toFixed(1)} across a ${g.bayM} m grid · rows ${rows.toFixed(2)} of ${g.storeyM.toFixed(2)} m`
      + ` · row 1 stands ${row1.toFixed(2)} m above ground (plinth ${plinth}, base ${aBase === 0 ? 'ground' : 'plinth'}) · door head ${doorHead.toFixed(2)} m · first sill ${win1.toFixed(2)} m\n`
      + `${night ? 'NIGHT' : `sun ${num(v, 'sunAlt')}° az ${num(v, 'sunAz')}°`} · eye ${eye} m at ${dist} m · pixel ${num(v, 'pixel')}x`;
  };
  dials.onChange(apply);
  apply();

  // Drag to turn, wheel to close in — the dials are the record; a drag is a
  // glance and is not written back to them.
  let drag: { x: number; y: number } | null = null;
  let yawG = 0, distG = 0;
  renderer.domElement.addEventListener('pointerdown', (e) => { drag = { x: e.clientX, y: e.clientY }; });
  addEventListener('pointerup', () => { drag = null; });
  addEventListener('pointermove', (e) => {
    if (!drag) return;
    yawG -= (e.clientX - drag.x) * 0.006;
    drag = { x: e.clientX, y: e.clientY };
    const v = dials.values();
    const yaw = num(v, 'yaw') * Math.PI / 180 + yawG, dist = num(v, 'dist') + distG, eye = num(v, 'eye');
    camera.position.set(Math.sin(yaw) * dist, eye, Math.cos(yaw) * dist);
    camera.lookAt(0, eye, 0);
  });
  addEventListener('wheel', (e) => {
    const v = dials.values();
    distG = clamp(distG + Math.sign(e.deltaY) * 1.5, 4 - num(v, 'dist'), 120);
    const yaw = num(v, 'yaw') * Math.PI / 180 + yawG, dist = num(v, 'dist') + distG, eye = num(v, 'eye');
    camera.position.set(Math.sin(yaw) * dist, eye, Math.cos(yaw) * dist);
    camera.lookAt(0, eye, 0);
  }, { passive: true });
  addEventListener('resize', () => { sized.w = 0; size(num(dials.values(), 'pixel')); });

  (window as unknown as { __facade?: () => object }).__facade = () => ({ ...report, grammar: { ...FACADE_GRAMMAR } });

  const frame = (): void => {
    renderer.render(scene, camera);
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}
