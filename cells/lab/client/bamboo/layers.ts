/**
 * How the grove's drawn, as layers laid from the paper up (after Labyrinth's layers.ts): **page** (where everything's
 * measured from: how far it's taken toward the paper, how far out in the world a reach of one goes, how much sooner
 * things far beyond the focus go), **under** (how much of the drawing lies beneath the picture), **colour** (the culms,
 * the leaves, the land, each its own strength, and how far out it reaches), **light** (the sun's shade on a thing, the
 * shadows cast across it, the hollows, how much of them the land keeps, and how far out it reaches: past the colour,
 * onto the paper itself), **ink** (things' own marks, the land's strokes, the outlines, how far they reach, and how they
 * end: thinning out, fewer of them, or fading, all paler), and its hand: how **open** its contours are (their weight
 * going to where a thing meets the land, the rest left to the paper), how much it **swell**s (strong lines heavier, weak
 * ones hairlines), how much **grain** breaks it (granular, tone in stippled clusters); **focus** (one measure of how far out of focus a thing is, read
 * by each layer its own way: the colour and light softened, never the ink; near, a culm or spray gone wet, a dark wash in
 * place of its contour; far, the ink dried, paler and broken).
 *
 * Each layer is its own: its strengths and its reach move nothing else. A reach is a multiple of one measure of how far
 * out a point is: from the focus (where you're going and looking) across the frame (1 at every edge of it) and in depth
 * (sooner for things far beyond the focus), or in the world (1 at `distance` metres), whichever is further. So a reach
 * under 1 leaves every edge to the paper, and a reach over 1 lets that layer run out to the frame.
 */

/** the dials the renderer reads (render.ts `dials`) */
export type Dials = {
  culms: number; leaves: number; terrain: number; colourreach: number;
  shade: number; cast: number; hollow: number; landlight: number; lightreach: number; relief: number;
  lines: number; strokes: number; edges: number; inkreach: number; inkfade: number; open: number; swell: number; grain: number;
  under: number; toward: number; distance: number; depth: number;
  aperture: number; wet: number; dry: number; soften: number;
};
export type DialKey = keyof Dials;

/** the picture as it's lit: every layer whole, out to the frame and past it */
export const PLAIN: Dials = { culms: 1, leaves: 1, terrain: 1, colourreach: 4, shade: 1, cast: 1, hollow: 1, landlight: 1, lightreach: 4, relief: 1, lines: 1, strokes: 1, edges: 1, inkreach: 4, inkfade: 0, open: 0, swell: 0, grain: 0, under: 1, toward: 0, distance: 400, depth: 0, aperture: 0, wet: 0.8, dry: 0.6, soften: 1 };
/** where it starts: the colour held round the focus, the light out past it onto the paper, the ink further still and
 * thinning, every edge left to the paper */
export const HOUSE: Dials = { ...PLAIN, colourreach: 0.65, lightreach: 0.8, inkreach: 0.9, inkfade: 0.25, under: 0.7, distance: 70, depth: 1, cast: 0.7, hollow: 1.1, open: 0.7, swell: 0 };
export const PRESETS: Record<string, Dials> = {
  house: HOUSE,
  picture: PLAIN,
  // (the drawing with its shade: no colour; the light on the paper; the ink)
  drawing: { ...HOUSE, culms: 0, leaves: 0, terrain: 0, shade: 0.8, cast: 0.9, hollow: 0.8, lightreach: 0.85, inkreach: 0.95, under: 1 },
  // (the ink alone, no colour, no light, out to the frame: the drawing as it stands; the gates' ink)
  ink: { ...HOUSE, culms: 0, leaves: 0, terrain: 0, shade: 0, cast: 0, hollow: 0, lightreach: 0.25, inkreach: 4, inkfade: 0, under: 1, distance: 400, depth: 0 },
  page: { ...HOUSE, toward: 1 },
  // (focus as the board has it: what stands near goes wet, the land near stays sharp, every edge still the paper)
  wet: { ...HOUSE, inkfade: 0.2, distance: 400, depth: 0, aperture: 1.29, wet: 0.83, soften: 0.46 },
  // (the hands: the same ink, drawn four ways (the grammar of its marks), at a reach that carries the grove)
  contour: { ...HOUSE, culms: 0, leaves: 0, terrain: 0, shade: 0, cast: 0, hollow: 0, inkreach: 0.9, inkfade: 0, open: 0.35, swell: 0, grain: 0 },
  brush: { ...HOUSE, culms: 0, leaves: 0, terrain: 0, shade: 0, cast: 0, hollow: 0, inkreach: 0.9, inkfade: 0, open: 0.75, swell: 0.85, grain: 0 },
  litho: { ...HOUSE, culms: 0, leaves: 0, terrain: 0, shade: 0.9, cast: 0.4, hollow: 1, lightreach: 0.8, inkreach: 0.9, inkfade: 0.3, open: 0.5, swell: 0.2, grain: 0.85 },
  wash: { ...HOUSE, culms: 0, leaves: 0, terrain: 0, shade: 0.9, cast: 0.1, hollow: 1.1, landlight: 0.8, lightreach: 0.75, inkreach: 0.9, inkfade: 0, open: 0.75, swell: 0.8, grain: 0 },
};

type Range = { key: DialKey; name: string; lo: number; hi: number; log?: boolean; unit?: string };
type Layer = { id: string; name: string; icon: string; ranges: Range[]; presets?: boolean };
const REACH = (key: DialKey): Range => ({ key, name: 'reach', lo: 0.25, hi: 4, log: true });
export const LAYERS: Layer[] = [
  { id: 'page', name: 'page', icon: '<rect x="4" y="5" width="16" height="14" rx="1.5"/><path d="M7 15l3-3 2 2 5-5"/>', presets: true, ranges: [
    { key: 'toward', name: 'to the page', lo: 0, hi: 1 },
    { key: 'distance', name: 'distance', lo: 10, hi: 400, log: true, unit: 'm' },
    { key: 'depth', name: 'depth', lo: 0, hi: 2 },
  ] },
  { id: 'under', name: 'under', icon: '<path d="M4 16c3-2 5-2 8 0s5 2 8 0M4 11c3-2 5-2 8 0s5 2 8 0"/><path d="M4 6h16" opacity=".45"/>', ranges: [
    { key: 'under', name: 'drawing under', lo: 0, hi: 1 },
  ] },
  { id: 'colour', name: 'colour', icon: '<circle cx="9" cy="10" r="5"/><circle cx="15" cy="10" r="5"/><circle cx="12" cy="15" r="5"/>', ranges: [
    { key: 'culms', name: 'culms', lo: 0, hi: 1 },
    { key: 'leaves', name: 'leaves', lo: 0, hi: 1 },
    { key: 'terrain', name: 'land', lo: 0, hi: 1 },
    REACH('colourreach'),
  ] },
  { id: 'light', name: 'light', icon: '<circle cx="12" cy="12" r="7"/><path d="M12 5a7 7 0 010 14z" fill="currentColor"/>', ranges: [
    { key: 'shade', name: 'shade', lo: 0, hi: 2 },
    { key: 'cast', name: 'cast', lo: 0, hi: 2 },
    { key: 'hollow', name: 'hollows', lo: 0, hi: 2 },
    { key: 'landlight', name: 'on the land', lo: 0, hi: 2 },
    { key: 'relief', name: 'relief', lo: 0, hi: 2 },
    REACH('lightreach'),
  ] },
  { id: 'focus', name: 'focus', icon: '<circle cx="12" cy="12" r="7"/><circle cx="12" cy="12" r="2.5"/><path d="M12 3v2M12 19v2M3 12h2M19 12h2"/>', ranges: [
    { key: 'aperture', name: 'aperture', lo: 0, hi: 2 },
    { key: 'wet', name: 'near wet', lo: 0, hi: 1 },
    { key: 'dry', name: 'far dry', lo: 0, hi: 1 },
    { key: 'soften', name: 'soften', lo: 0, hi: 1 },
  ] },
  { id: 'ink', name: 'ink', icon: '<path d="M5 19c4-1 6-4 8-8l4-5 1 1-5 4c-4 2-7 4-8 8z"/>', ranges: [
    { key: 'lines', name: 'marks', lo: 0, hi: 1 },
    { key: 'strokes', name: 'land strokes', lo: 0, hi: 1 },
    { key: 'edges', name: 'outlines', lo: 0, hi: 1 },
    REACH('inkreach'),
    { key: 'inkfade', name: 'thin ↔ fade', lo: 0, hi: 1 },
    { key: 'open', name: 'open', lo: 0, hi: 1 },
    { key: 'swell', name: 'swell', lo: 0, hi: 1 },
    { key: 'grain', name: 'grain', lo: 0, hi: 1 },
  ] },
];

// (a slider's place, 0–1, for a value, and back: on a log scale where it's a multiple)
const toT = (r: Range, v: number) => (r.log ? Math.log(v / r.lo) / Math.log(r.hi / r.lo) : (v - r.lo) / (r.hi - r.lo));
const fromT = (r: Range, t: number) => (r.log ? r.lo * Math.pow(r.hi / r.lo, t) : r.lo + t * (r.hi - r.lo));
const shown = (r: Range, v: number) => (r.unit ? `${Math.round(v)} ${r.unit}` : r.log ? `×${v < 1 ? v.toFixed(2) : v.toFixed(1)}` : v.toFixed(2));
// (each value kept to a step that reads: hundredths, or two figures of a multiple)
const tidy = (r: Range, v: number) => (r.log ? Number(v.toPrecision(2)) : Math.round(v * 100) / 100);

/** the dials from the address: a start (`?look=house|picture|drawing|ink|page`), each dial over it by its own name */
export function readDials(q: URLSearchParams): Dials {
  const d = { ...(PRESETS[q.get('look') ?? 'house'] ?? HOUSE) };
  for (const k of Object.keys(d) as DialKey[]) { const v = q.get(k); if (v !== null && v !== '' && Number.isFinite(Number(v))) d[k] = Number(v); }
  return d;
}
/** the address with the dials that differ from the house setting (and nothing else of theirs) */
export function address(d: Dials): string {
  const q = new URLSearchParams(location.search);
  for (const k of ['look', ...Object.keys(HOUSE)]) q.delete(k);
  for (const k of Object.keys(HOUSE) as DialKey[]) if (Math.abs(d[k] - HOUSE[k]) > 1e-6) q.set(k, String(d[k]));
  const s = Array.from(q).map(([k, v]) => (v === '' ? encodeURIComponent(k) : `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)).join('&');
  return `${location.pathname}${s ? `?${s}` : ''}${location.hash}`;
}

/**
 * The palette, in `el`: the layers as a row of slots, the one touched open under them with its sliders (a mark where
 * the house has it; a double tap on a name puts it back). `get`/`set` are the dials as they stand.
 */
export function layersPalette(el: HTMLElement, get: () => Dials, set: (d: Dials) => void) {
  el.innerHTML = '';
  const row = document.createElement('div'); row.className = 'row'; row.setAttribute('role', 'tablist'); row.setAttribute('aria-label', 'the layers, the paper up');
  const tray = document.createElement('div'); tray.className = 'tray'; tray.setAttribute('role', 'tabpanel');
  el.append(row, tray);
  let open: string | null = null;
  const tabs = new Map<string, HTMLButtonElement>();
  // (a layer's slot shows how much of it there is: its first value, as a line under its name)
  const meter = (l: Layer) => { const r = l.ranges[0]; return Math.max(0, Math.min(1, toT(r, get()[r.key]))); };
  for (const l of LAYERS) {
    const b = document.createElement('button');
    b.dataset.layer = l.id; b.setAttribute('role', 'tab'); b.setAttribute('aria-selected', 'false'); b.setAttribute('aria-label', `${l.name}: ${l.ranges.map((r) => r.name).join(', ')}`);
    b.innerHTML = `<svg viewBox="0 0 24 24">${l.icon}</svg><i>${l.name}</i><s><b></b></s>`;
    b.addEventListener('click', () => show(open === l.id ? null : l.id));
    row.append(b); tabs.set(l.id, b);
  }
  const meters = () => { for (const l of LAYERS) (tabs.get(l.id)!.querySelector('s b') as HTMLElement).style.width = `${meter(l) * 100}%`; };
  function show(id: string | null) {
    open = id;
    for (const [k, b] of tabs) { b.classList.toggle('on', k === id); b.setAttribute('aria-selected', String(k === id)); }
    el.classList.toggle('open', !!id);
    tray.innerHTML = '';
    const l = LAYERS.find((x) => x.id === id);
    if (!l) return;
    for (const r of l.ranges) tray.append(slider(r));
    if (l.presets) {
      const p = document.createElement('div'); p.className = 'starts';
      p.innerHTML = '<i>start from</i>';
      for (const name of Object.keys(PRESETS)) {
        const b = document.createElement('button'); b.textContent = name;
        b.addEventListener('click', () => { set({ ...PRESETS[name] }); show(open); meters(); });
        p.append(b);
      }
      tray.append(p);
    }
  }
  function slider(r: Range) {
    const w = document.createElement('label'); w.className = 'dial';
    const v = get()[r.key];
    w.innerHTML = `<span>${r.name}</span><div class="track"><input type="range" min="0" max="1000" step="1" aria-label="${r.name}"><em style="left:${toT(r, HOUSE[r.key]) * 100}%"></em></div><output></output>`;
    const input = w.querySelector('input')!, out = w.querySelector('output')!;
    const put = (x: number) => { input.value = String(Math.round(toT(r, x) * 1000)); out.textContent = shown(r, x); input.style.setProperty('--t', `${toT(r, x) * 100}%`); };
    put(v);
    input.addEventListener('input', () => { const x = tidy(r, fromT(r, Number(input.value) / 1000)); set({ ...get(), [r.key]: x }); out.textContent = shown(r, x); input.style.setProperty('--t', `${toT(r, x) * 100}%`); meters(); });
    w.querySelector('span')!.addEventListener('dblclick', () => { set({ ...get(), [r.key]: HOUSE[r.key] }); put(HOUSE[r.key]); meters(); });
    return w;
  }
  meters();
  return { show, refresh: () => { show(open); meters(); } };
}
