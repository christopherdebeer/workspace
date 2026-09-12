/**
 * THE ATLAS ANSWERS FOR EVERY PLACE THIS GAME IS DRIVEN AT, BY NAME.
 *
 *   node cells/drive/devtools/traditions.test.mjs
 *
 * Pure node: esbuild the module and ask it. Each case is a coordinate the
 * doctrine records a drive at, and the tradition a person would name there —
 * so a box that drifts, or an entry that is renamed, fails a case that says
 * which town it lost. The last block holds the table itself to its own
 * contract: every region names an entry, every entry a real base culture, and
 * every grammar override is a number the shader can draw.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '../../..');
const cache = join(ROOT, 'node_modules/.cache');
mkdirSync(cache, { recursive: true });
const built = join(cache, 'drive-traditions.test.mjs');
execFileSync('npx', ['esbuild', join(HERE, '../client/traditions.ts'), '--bundle', '--format=esm',
  `--outfile=${built}`], { cwd: ROOT, stdio: 'pipe' });
const { TRADITIONS, TRADITION_REGIONS, TRADITION_LIST, ROOF_FORMS, RUIN_BY_MATERIAL, traditionFor, traditionCulture, traditionIndex, gramTable, gramDecode, roofFormFor, FACADE_DEFAULTS, GRAM_FIELDS }
  = await import(pathToFileURL(built).href);

let bad = 0;
const ok = (name, cond, saw) => {
  if (!cond) bad++;
  console.log(`${cond ? 'ok  ' : 'FAIL'}  ${name}${cond ? '' : `\n        saw ${JSON.stringify(saw)}`}`);
};

// ── THE DRIVEN WORLD, BY NAME ──
const PLACES = [
  ['Camps Bay', -33.94533, 18.38296, 'cape'],
  ["Simon's Town", -34.19511, 18.44192, 'cape'],
  ["Chapman's Peak", -34.09, 18.36, 'cape'],
  ['Glencairn', -34.15515, 18.43619, 'cape'],
  ['George', -33.96, 22.46, 'karoo'],
  ['Letsemeng', -29.7, 24.8, 'karoo'],
  ['De Hoop', -34.45, 20.5, 'karoo'],
  ['Senqu', -30.75509, 27.68403, 'lesotho-highland'],
  ['Suresnes', 48.86919, 2.21523, 'ile-de-france'],
  ['Vélizy', 48.77736, 2.22332, 'ile-de-france'],
  ['Paris, Île de la Cité', 48.8566, 2.3522, 'haussmann'],
  ['Rueil', 48.877, 2.18, 'ile-de-france'],
  ['Carmel Highlands', 36.5665, -121.913, 'california-coastal'],
  ['Bixby', 36.3753, -121.8974, 'california-coastal'],
  ['Yosemite', 37.75, -119.6, 'sierra'],
  ['Mariposa', 37.48, -119.97, 'sierra'],
  ['Death Valley', 36.2, -116.8, 'southwest-desert'],
  ['San Juan County', 37.5, -109.5, 'southwest-desert'],
  ['Flagstaff', 35.2, -111.65, 'southwest-desert'],
  ['Mono Lake', 38.0, -119.0, 'sierra'],
  ['Newfoundland', 48.5, -56.0, null],
  ['Giza', 29.979, 31.134, 'north-africa'],
  ['Tamanrasset', 22.79, 5.52, 'north-africa'],
  ['Dakar', 14.7, -17.45, 'sahel'],
  ['Serengeti', -2.3, 34.8, 'east-africa-savanna'],
  ['Sundarbans', 21.9, 89.2, 'bengal-delta'],
  ['Manaus', -3.1, -60.0, 'amazon'],
  ['Colcha K', -20.7, -67.6, 'andes-altiplano'],
  ['Obergoms', 46.5, 8.3, 'alpine'],
  ['Zermatt', 46.02, 7.75, 'alpine'],
  ['Stelvio', 46.53, 10.45, 'alpine'],
  ['Rubigen', 46.889, 7.54, 'swiss-mittelland'],
  ['Bern', 46.95, 7.44, 'swiss-mittelland'],
  ['Afsluitdijk', 53.0, 5.2, 'netherlands'],
  ['Gordes', 43.91, 5.2, 'mediterranean'],
  ['Freiburg', 47.99, 7.85, 'central-europe'],
  ['Edinburgh', 55.95, -3.19, 'british-isles'],
  ['Bergen', 60.39, 5.32, 'nordic'],
  ['Kakadu', -12.8, 132.8, 'australia'],
  ['Reykjavik', 64.13, -21.9, null],
  ['Irkutsk', 52.29, 104.3, null],
  ['the South Atlantic', -40, -20, null],
];
for (const [name, lat, lon, want] of PLACES) {
  const got = traditionFor(lat, lon)?.key ?? null;
  ok(`${name} builds ${want ?? 'as the climate says'}`, got === want, got);
}

// ── THE TABLE HOLDS TO ITS OWN CONTRACT ──
{
  const cultureKeys = new Set(['limewash', 'ochre', 'stone', 'timber', 'adobe', 'brick']);
  ok('every region names an entry', TRADITION_REGIONS.every((r) => TRADITIONS[r.key]),
    TRADITION_REGIONS.filter((r) => !TRADITIONS[r.key]).map((r) => r.key));
  ok('every entry has a region', Object.keys(TRADITIONS).every((k) => TRADITION_REGIONS.some((r) => r.key === k)),
    Object.keys(TRADITIONS).filter((k) => !TRADITION_REGIONS.some((r) => r.key === k)));
  ok('every entry stands on one of the six cultures', Object.values(TRADITIONS).every((t) => cultureKeys.has(t.base)),
    Object.values(TRADITIONS).filter((t) => !cultureKeys.has(t.base)).map((t) => t.key));
  ok('every region is a well-formed box',
    TRADITION_REGIONS.every((r) => r.lat[0] < r.lat[1] && r.lon[0] < r.lon[1] && r.lat[0] >= -90 && r.lat[1] <= 90 && r.lon[0] >= -180 && r.lon[1] <= 180),
    TRADITION_REGIONS.filter((r) => !(r.lat[0] < r.lat[1] && r.lon[0] < r.lon[1])).map((r) => r.key));
  ok('every entry says what it is modelled on', Object.values(TRADITIONS).every((t) => t.note.length > 40),
    Object.values(TRADITIONS).filter((t) => t.note.length <= 40).map((t) => t.key));
  const shares = ['winX0', 'winX1', 'winY0', 'winY1', 'doorX0', 'doorX1', 'doorY1', 'doorShare', 'openShare', 'glassShade', 'glassVar', 'lintel', 'stain',
    'revealM', 'sillM', 'frame', 'mullion', 'glassSky', 'stringCourse', 'cornice', 'shutters', 'balcony', 'streaks', 'shopfront'];
  const sane = (t) => {
    const g = t.grammar;
    for (const k of shares) if (g[k] !== undefined && !(g[k] >= 0 && g[k] <= 1)) return `${k}=${g[k]}`;
    if (g.bayM !== undefined && !(g.bayM >= 1.5 && g.bayM <= 6)) return `bayM=${g.bayM}`;
    if (g.storeyM !== undefined && !(g.storeyM >= 2.2 && g.storeyM <= 4.5)) return `storeyM=${g.storeyM}`;
    if (g.ivy !== undefined && !(g.ivy >= 0 && g.ivy <= 2)) return `ivy=${g.ivy}`;
    for (const k of ['plinthM', 'dampM']) if (g[k] !== undefined && !(g[k] >= 0 && g[k] <= 2)) return `${k}=${g[k]}`;
    if (g.eaveM !== undefined && !(g.eaveM >= 0 && g.eaveM <= 1.2)) return `eaveM=${g.eaveM}`;
    for (const k of ['trim', 'shutterCol']) if (g[k] !== undefined && !(Number.isInteger(g[k]) && g[k] >= 0 && g[k] <= 7)) return `${k}=${g[k]}`;
    if (g.winX0 !== undefined && g.winX1 !== undefined && !(g.winX0 < g.winX1)) return 'winX0 >= winX1';
    if (g.winY0 !== undefined && g.winY1 !== undefined && !(g.winY0 < g.winY1)) return 'winY0 >= winY1';
    if (g.doorX0 !== undefined && g.doorX1 !== undefined && !(g.doorX0 < g.doorX1)) return 'doorX0 >= doorX1';
    return null;
  };
  const insane = Object.values(TRADITIONS).map((t) => [t.key, sane(t)]).filter(([, e]) => e);
  ok('every grammar override is a number the shader can draw', insane.length === 0, insane);
  ok('a stated storey matches its grammar row where both are stated',
    Object.values(TRADITIONS).every((t) => t.storeyM === undefined || t.grammar.storeyM === undefined || Math.abs(t.storeyM - t.grammar.storeyM) < 1e-9),
    Object.values(TRADITIONS).filter((t) => t.storeyM !== undefined && t.grammar.storeyM !== undefined && t.storeyM !== t.grammar.storeyM).map((t) => t.key));
  // traditionCulture: the base with the overrides, keyed by the tradition.
  const cape = traditionCulture(TRADITIONS.cape);
  ok('a tradition resolves to a culture wearing its own key, canvases and paints',
    cape.key === 'cape' && cape.roofTex === 'corrugated' && cape.wallTex === 'render' && cape.wall.length === 6 && cape.affinity.length === 5, cape);
  const med = traditionCulture(TRADITIONS.mediterranean);
  ok('…and one with no overrides is its base, renamed',
    med.wallTex === 'render' && med.roofTex === 'pantile' && med.storeyM === 3.25 && med.key === 'mediterranean', med);
}
// ── THE TEXTURE ROUND TRIP: WHAT THE SHADER READS IS WHAT WAS AUTHORED ──
// Eight bits a field, under known scales. A bay may be 3 cm off and a share
// 0.4%, and nothing more — the composite quantises to fourteen levels, so
// that is precision nobody can see, and the test holds it anyway.
{
  const { data, rows } = gramTable();
  ok('one row per tradition, in list order', rows === TRADITION_LIST.length && data.length === rows * 32
    && TRADITION_LIST.every((k, i) => traditionIndex(k) === i + 1), { rows, list: TRADITION_LIST.length });
  ok('no tradition is row 0, and an unknown key is', traditionIndex('nowhere') === 0 && traditionIndex(null) === 0
    && TRADITION_LIST.every((k) => traditionIndex(k) > 0), null);
  const worst = [];
  for (const key of TRADITION_LIST) {
    const want = { ...FACADE_DEFAULTS, ...TRADITIONS[key].grammar };
    const got = gramDecode(data, traditionIndex(key));
    for (const [k, v] of Object.entries(want)) {
      const scale = GRAM_FIELDS.find(([f]) => f === k)?.[1];
      if (scale === undefined) { worst.push(`${k} is not in GRAM_FIELDS`); continue; }
      // A colour index is rounded back to the integer it was.
      const tol = k === 'trim' || k === 'shutterCol' ? 1e-9 : scale / 255 / 2 + 1e-9;
      if (Math.abs(got[k] - v) > tol) worst.push(`${key}.${k}: ${v} -> ${got[k]}`);
    }
  }
  ok('every field survives the bytes to within half a step', worst.length === 0, worst.slice(0, 6));
  ok('every grammar field has a row in the byte table', Object.keys(FACADE_DEFAULTS).every((k) => GRAM_FIELDS.some(([f]) => f === k)) && GRAM_FIELDS.length === 32,
    { fields: Object.keys(FACADE_DEFAULTS).length, table: GRAM_FIELDS.length });
  ok('row 0 decodes to the defaults', JSON.stringify(gramDecode(data, 0)) === JSON.stringify(FACADE_DEFAULTS), gramDecode(data, 0));
}
// ── STOREYS AND ROOFS: STATED, SANE, AND DRAWN AS STATED ──
{
  const entries = Object.values(TRADITIONS);
  ok('every entry states a storey range within one to nine, low to high',
    entries.every((t) => Array.isArray(t.storeys) && t.storeys[0] >= 1 && t.storeys[1] <= 9 && t.storeys[0] <= t.storeys[1]),
    entries.filter((t) => !(t.storeys[0] >= 1 && t.storeys[1] <= 9 && t.storeys[0] <= t.storeys[1])).map((t) => t.key));
  ok('every entry names roof forms the roof builder knows, with positive weight',
    entries.every((t) => Object.keys(t.roofs).every((f) => ROOF_FORMS.includes(f)) && Object.values(t.roofs).some((w) => w > 0)),
    entries.filter((t) => !Object.keys(t.roofs).every((f) => ROOF_FORMS.includes(f))).map((t) => t.key));
  // The draw reproduces the weights: ten thousand draws for the Cape.
  const cape = TRADITIONS.cape, n = 10000, seen = {};
  for (let i = 0; i < n; i++) { const f = roofFormFor(cape, (i + 0.5) / n); seen[f] = (seen[f] ?? 0) + 1; }
  ok('every entry states a chimney share', entries.every((t) => typeof t.chimneys === 'number' && t.chimneys >= 0 && t.chimneys <= 1),
    entries.filter((t) => !(typeof t.chimneys === 'number' && t.chimneys >= 0 && t.chimneys <= 1)).map((t) => t.key));
  ok('…and the Alps have hearths where the Sahel has none', TRADITIONS.alpine.chimneys > 0.8 && TRADITIONS.sahel.chimneys < 0.05,
    [TRADITIONS.alpine.chimneys, TRADITIONS.sahel.chimneys]);
  const total = Object.values(cape.roofs).reduce((a, b) => a + b, 0);
  const off = Object.entries(cape.roofs).map(([f, w]) => Math.abs((seen[f] ?? 0) / n - w / total)).reduce((a, b) => Math.max(a, b), 0);
  ok('the draw lands on each form in its stated share (Cape, ten thousand draws)', off < 0.002, { seen, off });
  ok('the first draw is the first form and the last draw the last', roofFormFor(cape, 0) === 'gabled' && roofFormFor(cape, 0.9999) === 'flat',
    [roofFormFor(cape, 0), roofFormFor(cape, 0.9999)]);
}
// ── EVERY MATERIAL RUINS, AND WITHIN REASON ──
{
  const mats = ['render', 'stone', 'brick', 'timber', 'adobe'];
  ok('every wall material has a ruin profile', mats.every((m) => RUIN_BY_MATERIAL[m]), Object.keys(RUIN_BY_MATERIAL));
  const sane = (p) => p.stand[0] > 0 && p.stand[0] <= p.stand[1] && p.stand[1] <= 1
    && p.floorM >= 0.8 && p.floorM <= 3
    && p.bayLoss >= 0 && p.bayLoss < 0.6 && p.bay >= 1.5 && p.bay <= 4
    && p.thick[0] >= 0.2 && p.thick[0] <= p.thick[1] && p.thick[1] <= 1.2
    && p.ragged >= 0 && p.ragged <= 1 && p.grey >= 0 && p.grey <= 1;
  ok('…and each profile is a wall a person could stand beside', mats.every((m) => sane(RUIN_BY_MATERIAL[m])),
    mats.filter((m) => !sane(RUIN_BY_MATERIAL[m])));
  ok('timber falls lower than stone, and loses more bays',
    RUIN_BY_MATERIAL.timber.stand[1] < RUIN_BY_MATERIAL.stone.stand[0] && RUIN_BY_MATERIAL.timber.bayLoss > RUIN_BY_MATERIAL.stone.bayLoss,
    [RUIN_BY_MATERIAL.timber, RUIN_BY_MATERIAL.stone]);
}
console.log(bad ? `\n${bad} FAILED` : '\nall ok');
process.exitCode = bad ? 1 : 0;
