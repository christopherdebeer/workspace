/**
 * Print: the palette taken over by the drawing's layers, in the order they're laid, the paper up: **page** (where it
 * starts from, and how far everything's taken toward the page), **under** (the drawing beneath the picture), **colour**
 * (what's built, the land, the water), **light** (the shade, what's cast, the hollows, apart from the colour), **ink**
 * (the marks and the outlines over it all). Each layer has its strength and its own reach: how far out from what's
 * built it goes before it gives way to the page, so the light can go on past the colour onto the paper, and the lines
 * past both. Touch a layer and its values open under it, each a slider to drag; the picture follows as it's dragged,
 * and the address keeps what's set, so a print can be passed on as it is.
 */

/** the dials the renderer reads (render.ts \`dials\`), each a layer's value: the colour (what's built, the land, the
 * water, and its reach); the light by kind (a thing's shade, what's cast, the hollows; how much of its shade and hollows
 * the land keeps; its reach); the ink (the marks, the outlines, their reach, and how they end: thinning or fading); the
 * drawing under the picture; and how far everything's taken to the page */
export type Dials = {
  built: number; land: number; water: number; colourreach: number;
  shade: number; cast: number; hollow: number; landlight: number; lightreach: number;
  lines: number; edges: number; inkreach: number; inkfade: number;
  under: number; toward: number;
};
export type DialKey = keyof Dials;

/** the picture as it's lit: every layer whole, as far as it ever went */
export const PLAIN: Dials = { built: 1, land: 1, water: 1, colourreach: 1, shade: 1, cast: 1, hollow: 1, landlight: 1, lightreach: 1, lines: 1, edges: 1, inkreach: 1, inkfade: 0, under: 0, toward: 0 };
/** where it starts: the house setting (found by looking: static/labyrinth-look.md), the picture as it's lit, the
 * drawing with its shade, a study (the colour held close, the light out past it, the lines further still, fading), and
 * everything taken to the page */
export const HOUSE: Dials = { ...PLAIN, built: 0.8, land: 0.3, water: 0.8, shade: 1.15, cast: 0.75, hollow: 1.15, landlight: 0.45, under: 0.7 };
export const PRESETS: Record<string, Dials> = {
  house: HOUSE,
  picture: PLAIN,
  drawing: { ...HOUSE, built: 0, land: 0, water: 0.6, shade: 1.1, cast: 1.1, hollow: 1.1, landlight: 0.65, under: 1 },
  study: { ...HOUSE, built: 1, land: 0.2, water: 0.6, colourreach: 0.6, shade: 0.6, cast: 0.8, hollow: 0.7, landlight: 0.8, lightreach: 1.6, edges: 0.8, inkreach: 2, inkfade: 0.6, under: 0.3 },
  page: { ...HOUSE, toward: 1, water: 0.5 },
};

type Range = { key: DialKey; name: string; lo: number; hi: number; log?: boolean };
type Layer = { id: string; name: string; icon: string; ranges: Range[]; presets?: boolean };
const REACH = (key: DialKey): Range => ({ key, name: 'reach', lo: 0.25, hi: 4, log: true });
export const LAYERS: Layer[] = [
  { id: 'page', name: 'page', icon: '<rect x="4" y="5" width="16" height="14" rx="1.5"/><path d="M7 15l3-3 2 2 5-5"/>', presets: true, ranges: [
    { key: 'toward', name: 'to the page', lo: 0, hi: 1 },
  ] },
  { id: 'under', name: 'under', icon: '<path d="M4 16c3-2 5-2 8 0s5 2 8 0M4 11c3-2 5-2 8 0s5 2 8 0"/><path d="M4 6h16" opacity=".45"/>', ranges: [
    { key: 'under', name: 'drawing under', lo: 0, hi: 1 },
  ] },
  { id: 'colour', name: 'colour', icon: '<circle cx="9" cy="10" r="5"/><circle cx="15" cy="10" r="5"/><circle cx="12" cy="15" r="5"/>', ranges: [
    { key: 'built', name: 'built', lo: 0, hi: 1 },
    { key: 'land', name: 'land', lo: 0, hi: 1 },
    { key: 'water', name: 'water', lo: 0, hi: 1 },
    REACH('colourreach'),
  ] },
  { id: 'light', name: 'light', icon: '<circle cx="12" cy="12" r="7"/><path d="M12 5a7 7 0 010 14z" fill="currentColor"/>', ranges: [
    { key: 'shade', name: 'shade', lo: 0, hi: 2 },
    { key: 'cast', name: 'cast', lo: 0, hi: 2 },
    { key: 'hollow', name: 'hollows', lo: 0, hi: 2 },
    { key: 'landlight', name: 'on the land', lo: 0, hi: 2 },
    REACH('lightreach'),
  ] },
  { id: 'ink', name: 'ink', icon: '<path d="M5 19c4-1 6-4 8-8l4-5 1 1-5 4c-4 2-7 4-8 8z"/>', ranges: [
    { key: 'lines', name: 'marks', lo: 0, hi: 1 },
    { key: 'edges', name: 'outlines', lo: 0, hi: 1 },
    REACH('inkreach'),
    { key: 'inkfade', name: 'thin ↔ fade', lo: 0, hi: 1 },
  ] },
];

// (a slider's place, 0–1, for a value, and back: on a log scale where it's a multiple)
const toT = (r: Range, v: number) => (r.log ? Math.log(v / r.lo) / Math.log(r.hi / r.lo) : (v - r.lo) / (r.hi - r.lo));
const fromT = (r: Range, t: number) => (r.log ? r.lo * Math.pow(r.hi / r.lo, t) : r.lo + t * (r.hi - r.lo));
const shown = (r: Range, v: number) => (r.log ? `×${v < 1 ? v.toFixed(2) : v.toFixed(1)}` : v.toFixed(2));
// (each value kept to a step that reads: hundredths, or two figures of a multiple)
const tidy = (r: Range, v: number) => (r.log ? Number(v.toPrecision(2)) : Math.round(v * 100) / 100);

/** each dial's name in the address: the land's colour is \`terrain\` there (\`?land=\` is already the land's own seed) */
export const PARAM: Record<DialKey, string> = { built: 'built', land: 'terrain', water: 'water', colourreach: 'colourreach', shade: 'shade', cast: 'cast', hollow: 'hollow', landlight: 'landlight', lightreach: 'lightreach', lines: 'lines', edges: 'edges', inkreach: 'inkreach', inkfade: 'inkfade', under: 'under', toward: 'toward' };

/** the address with the dials that differ from the house setting (and nothing else of theirs), in print */
export function address(d: Dials, printing: boolean): string {
  const q = new URLSearchParams(location.search);
  for (const k of ['colour', 'color', 'look', 'print', 'shadow', 'landshadow', 'fade', ...Object.values(PARAM)]) q.delete(k);
  if (printing) q.set('print', '');
  for (const k of Object.keys(HOUSE) as DialKey[]) if (Math.abs(d[k] - HOUSE[k]) > 1e-6) q.set(PARAM[k], String(d[k]));
  // (a flag as a bare name, as it was written: \`?print\`, not \`?print=\`)
  const s = Array.from(q).map(([k, v]) => (v === '' ? encodeURIComponent(k) : `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)).join('&');
  return `${location.pathname}${s ? `?${s}` : ''}${location.hash}`;
}

/**
 * The print palette, in `el`: the layers as a row of its slots, the one touched open under them with its sliders.
 * `get`/`set` are the dials as they stand; `set` is called as a slider's dragged (and for a start chosen).
 */
export function layersPalette(el: HTMLElement, get: () => Dials, set: (d: Dials) => void) {
  el.innerHTML = '';
  const row = document.createElement('div'); row.className = 'row'; row.setAttribute('role', 'tablist'); row.setAttribute('aria-label', "the print's layers, the paper up");
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
  /** one value: its name, the slider (a mark where the house has it; a double tap on the name puts it back), its value */
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
