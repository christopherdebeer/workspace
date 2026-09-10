/**
 * IS NATURAL EARTH'S ROAD LAYER GOOD ENOUGH TO BE THE WIDE CHART?
 *
 *   node cells/drive/devtools/ne-roads-coverage.mjs
 *
 * The wide rungs of the overview (z7-z9, boxes of 313, 156 and 78km) cannot be
 * got from Overpass reliably — see CLAUDE.md, "The wide chart does not load".
 * The proposal is to stop asking: bake a generalised road network the way
 * `bake-coast.mjs` bakes the land mask, and serve those rungs from the bank
 * with no upstream at all.
 *
 * That stands or falls on ONE question, and it has to be answered before any
 * of the pipeline is written: does Natural Earth cover the places this game is
 * actually driven? Its road layer has a reputation for being North America and
 * Europe heavy, and a wide chart that works in France and is empty in the
 * Karoo is not a fix — it is the same failure with a different cause and no
 * error message.
 *
 * So this counts features per region, in kilometres of road per million km² of
 * land, at the six places the captures and the reel already go. A region is
 * judged against what the chart NEEDS at 600m per pixel, which is not much:
 * the trunk network that makes a landform legible. The bar is deliberately
 * stated before the numbers are read.
 */
const GH = 'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson';

// Boxes are [W, S, E, N]. Chosen as the places the game is driven and the
// places most likely to expose a northern-hemisphere bias, not as a uniform
// sample: the question is about THIS game's world, not about the dataset.
const REGIONS = [
  ['W Europe (control, dense)', -5, 42, 9, 52],
  ['E United States (control)', -85, 30, -70, 43],
  ['Southern Africa', 15, -35, 33, -22],
  ['South America (Andes)', -75, -35, -55, -15],
  ['Australia', 113, -39, 154, -20],
  ['South-East Asia', 95, -8, 120, 15],
  ['Central Asia', 55, 35, 90, 50],
  ['Sahara / Sahel', -10, 12, 30, 28],
];

const R = 6371;
const rad = (d) => (d * Math.PI) / 180;
function segKm(a, b) {
  const dLat = rad(b[1] - a[1]), dLon = rad(b[0] - a[0]);
  const m = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a[1])) * Math.cos(rad(b[1])) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(m)));
}
function boxKm2([w, s, e, n]) {
  return (R ** 2) * Math.abs(rad(e) - rad(w)) * Math.abs(Math.sin(rad(n)) - Math.sin(rad(s)));
}
const inBox = ([x, y], [w, s, e, n]) => x >= w && x <= e && y >= s && y <= n;

for (const file of ['ne_10m_roads.geojson', 'ne_10m_populated_places_simple.geojson']) {
  const url = `${GH}/${file}`;
  process.stdout.write(`\nfetching ${file} ... `);
  const t0 = Date.now();
  const res = await fetch(url);
  if (!res.ok) { console.log(`HTTP ${res.status} — not available at this path`); continue; }
  const text = await res.text();
  const geo = JSON.parse(text);
  console.log(`${(text.length / 1048576).toFixed(1)}MB, ${geo.features.length} features, ${((Date.now() - t0) / 1000).toFixed(1)}s`);

  // What is actually ON a feature decides what a chart can draw with it: a
  // network with no class and no name is a grey scribble, and the overview's
  // own trim keeps highway/name/ref for exactly that reason.
  const props = new Map();
  for (const f of geo.features.slice(0, 400)) for (const k of Object.keys(f.properties ?? {})) props.set(k, (props.get(k) ?? 0) + 1);
  console.log(`  attributes: ${[...props.keys()].slice(0, 18).join(', ')}`);
  const sample = geo.features[0]?.properties ?? {};
  for (const k of ['type', 'scalerank', 'name', 'label', 'featurecla', 'continent', 'expressway', 'pop_max']) {
    if (k in sample) console.log(`    e.g. ${k} = ${JSON.stringify(sample[k])}`);
  }
  // The class vocabulary, since the ladder has to be expressed in it.
  if (file.includes('roads')) {
    const kinds = new Map();
    for (const f of geo.features) {
      const t = f.properties?.type ?? '?';
      kinds.set(t, (kinds.get(t) ?? 0) + 1);
    }
    console.log(`  types: ${[...kinds.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(', ')}`);
    const sr = new Map();
    for (const f of geo.features) { const s = f.properties?.scalerank ?? '?'; sr.set(s, (sr.get(s) ?? 0) + 1); }
    console.log(`  scalerank: ${[...sr.entries()].sort((a, b) => a[0] - b[0]).map(([k, v]) => `${k}:${v}`).join(' ')}`);
  }

  console.log(`  ${'region'.padEnd(28)} ${'feats'.padStart(6)} ${'km'.padStart(9)} ${'km per Mkm2'.padStart(12)}`);
  for (const region of REGIONS) {
    const [name] = region;
    const box = region.slice(1);
    let feats = 0, km = 0;
    for (const f of geo.features) {
      const g = f.geometry;
      if (!g) continue;
      const lines = g.type === 'LineString' ? [g.coordinates]
        : g.type === 'MultiLineString' ? g.coordinates
        : g.type === 'Point' ? [[g.coordinates]] : [];
      let touched = false;
      for (const line of lines) {
        for (let i = 0; i < line.length; i++) {
          if (!inBox(line[i], box)) continue;
          touched = true;
          if (i > 0) km += segKm(line[i - 1], line[i]);
        }
      }
      if (touched) feats++;
    }
    const a = boxKm2(box) / 1e6;
    console.log(`  ${name.padEnd(28)} ${String(feats).padStart(6)} ${km.toFixed(0).padStart(9)} ${(km / a).toFixed(0).padStart(12)}`);
  }
}
