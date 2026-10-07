/**
 * Field Journal: the lab's experiments in one walk.
 *
 * The wood is Mistwood, itself (its module runs here, on this page's canvas). Over it, drawn in
 * the Seals' engraving: a compass seal that turns as you do, a marker over each find in view,
 * and the journal. The finds are crystals in the stone and fungi in the litter (finds.ts); come
 * close to one and open it, and its card holds the real thing — the Crystals experiment's
 * specimen, or the Hat-throwers' fungus, grown from the find's seed — and the journal keeps it.
 *
 * Query: Mistwood's (seed, x, y, heading, hour …) · preview (the lab's index: the wood, the compass).
 */
import { hash } from '../kit/rng';
import { card as sealCard, draw, sample, sealSvg } from '../seals/seal';
import { SUIT_STYLES } from '../seals/styles';
import { findsNear, project, type Find, type View } from './finds';
import { sprites, spriteTexture } from '../mistwood/main';
import { createCrystalEngine, type CrystalEngine } from '../crystals/engine';

type MistView = View & { seed: number; density: number; ground: (x: number, z: number) => number };
const qs = new URLSearchParams(location.search);
const preview = qs.has('preview');
const $ = (id: string) => document.getElementById(id)!;
const esc = (t: string) => t.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

/** how near a find must be to open, and how far its marker shows (m) */
const OPEN = 14, SHOW = 70;
/** the Seals' families for the finds: crystals the lattice of diamonds, fungi the clubs' */
const STYLE = { crystal: SUIT_STYLES[1], fungus: SUIT_STYLES[2] } as const;
const GLYPH = { crystal: '◆', fungus: '♣' } as const;

// ─── the wood ───────────────────────────────────────────────────────────────────────────────────
const canvas = $('wood') as HTMLCanvasElement;
const view = () => (window as unknown as { __mistwoodView?: MistView }).__mistwoodView;

// ─── seals, drawn once ──────────────────────────────────────────────────────────────────────────
const cache = new Map<string, string>();
/** a bare seal of a family, as an <svg> (a marker, the compass, a journal emblem) */
function emblem(key: string, style: typeof SUIT_STYLES[number], seed: number, extra = ''): string {
  const k = `${key}:${seed}`;
  let svg = cache.get(k);
  if (!svg) {
    const st = { ...sample(style, seed), stipple: 0, washAmount: 0, faint: 1 };
    svg = `<svg viewBox="-62 -62 124 124" aria-hidden="true">${sealSvg(draw(st, null, seed), st, `e${k.replace(/\W/g, '')}`)}${extra}</svg>`;
    cache.set(k, svg);
  }
  return svg;
}
const glyphMark = (g: string, ink: string) => `<circle r="15" stroke="${ink}" stroke-width="1.2"/><text y="9" text-anchor="middle" font-size="25" font-family="Georgia,serif" fill="${ink}">${g}</text>`;

// ─── the compass ────────────────────────────────────────────────────────────────────────────────
const compass = $('compass');
compass.innerHTML = `<div class="dial">${emblem('compass', SUIT_STYLES[3], 7, `<path d="M0 -58L5 -46H-5Z" stroke-width="1.2"/><text y="-30" text-anchor="middle" font-size="13" font-family="Georgia,serif">N</text>`)}</div><div class="needle"></div>`;
const dial = compass.querySelector<HTMLElement>('.dial')!;

// ─── the journal: what has been found, kept in this browser ─────────────────────────────────────
interface Entry { wood: number; id: string; kind: Find['kind']; name: string; seed: number; at: number }
const KEY = 'field.journal';
const load = (): Entry[] => { try { return JSON.parse(localStorage.getItem(KEY) ?? '[]') as Entry[]; } catch { return []; } };
const save = (e: Entry[]) => { try { localStorage.setItem(KEY, JSON.stringify(e)); } catch { /* (private window: kept for the visit) */ } };
let journal = load();
const found = (wood: number, id: string) => journal.some((e) => e.wood === wood && e.id === id);
const countEl = $('count');
const showCount = () => { countEl.textContent = journal.length ? `${journal.length} in the journal` : 'the journal'; };
showCount();

// ─── a find's card: the seal shell, the specimen in it ──────────────────────────────────────────
/** the body's place on the card (mm): where the specimen's frame sits */
const BODY = { x: 8, y: 13.4, w: 47, h: 55.2 };
function cardFor(f: Find | Entry, wood: number): string {
  const st = STYLE[f.kind];
  return sealCard({
    style: st, seed: hash(wood, f.seed), faces: null, id: `c${f.seed}`, rank: 1,
    title: `${GLYPH[f.kind]} · ${f.kind === 'crystal' ? 'MINERAL' : 'FUNGUS'}`,
    index: { rank: GLYPH[f.kind], glyph: '', color: st.ink },
    body: { svg: `<rect x="${BODY.x}" y="${BODY.y}" width="${BODY.w}" height="${BODY.h}" rx="2" fill="none" stroke="${st.ink}" stroke-width=".3"/>`, zone: { k: 'box', c: [BODY.x + BODY.w / 2, BODY.y + BODY.h / 2], hw: BODY.w / 2, hh: BODY.h / 2, rx: 2 } },
    caption: { line: f.name.length > 22 ? f.name.slice(0, 21) + '…' : f.name, sum: `No. ${f.seed} · ${f.kind === 'crystal' ? 'from the stone' : 'from the litter'}` },
  }).svg;
}
/** the real thing: the lab's own experiment, grown from the find's seed */
const specimenSrc = (f: Find | Entry) => (f.kind === 'crystal' ? `/crystals?preview&seed=${f.seed}` : `/fungi?one&preview&seed=${f.seed}&t=250`);

const sheet = $('sheet');
function open(f: Find | Entry, wood: number) {
  const pct = (v: number, of: number) => `${(v / of) * 100}%`;
  sheet.innerHTML = `<div class="card">${cardFor(f, wood)}<iframe title="${esc(f.name)}" src="${specimenSrc(f)}" style="left:${pct(BODY.x, 63)};top:${pct(BODY.y, 88)};width:${pct(BODY.w, 63)};height:${pct(BODY.h, 88)}" loading="lazy"></iframe></div><div class="row"><button id="close">close</button></div>`;
  sheet.hidden = false;
  $('close').addEventListener('click', () => { sheet.hidden = true; sheet.innerHTML = ''; });
  if ('x' in f && !found(wood, f.id)) {
    journal = [...journal, { wood, id: f.id, kind: f.kind, name: f.name, seed: f.seed, at: Date.now() }];
    save(journal);
    showCount();
  }
}
countEl.addEventListener('click', () => {
  const v = view();
  sheet.innerHTML = `<div class="journal"><h2>The journal</h2>${journal.length ? `<div class="grid">${[...journal].reverse().map((e, i) => `<button class="entry" data-i="${journal.length - 1 - i}" aria-label="${esc(e.name)}">${emblem(e.kind, STYLE[e.kind], e.seed, glyphMark(GLYPH[e.kind], STYLE[e.kind].ink))}<span>${esc(e.name)}</span></button>`).join('')}</div>` : '<p>Nothing yet. Walk; look for the seals among the trees.</p>'}<div class="row"><button id="close">close</button></div></div>`;
  sheet.hidden = false;
  $('close').addEventListener('click', () => { sheet.hidden = true; sheet.innerHTML = ''; });
  sheet.querySelectorAll<HTMLButtonElement>('.entry').forEach((b) => b.addEventListener('click', () => { const e = journal[Number(b.dataset.i)]; open(e, e.wood); }));
  void v;
});

// ─── the specimens in the wood: crystals, ray-traced where they lie ─────────────────────────────
// One Crystals engine, offscreen, in its cut-out mode (the specimen on transparency): each crystal
// near enough is drawn from where you stand — so walking round it, it turns — and its picture is
// set into the wood as a sprite on the ground, among the trees, in the fog. They take turns, the
// nearest and the longest-waiting first.
const NEAR_SPECIMEN = 45, SPRITE_PX = 224, SPECIMEN_M = 1.15;
let crystalGl: { engine: CrystalEngine; canvas: HTMLCanvasElement } | null = null;
try {
  const c = document.createElement('canvas');
  c.width = c.height = SPRITE_PX;
  const g = c.getContext('webgl2', { alpha: true, premultipliedAlpha: true, antialias: false, depth: false, preserveDrawingBuffer: true });
  if (g) crystalGl = { engine: createCrystalEngine(g, { quality: 'low', still: true, cut: true }), canvas: c };
} catch { crystalGl = null; }
const drawnAt = new Map<string, number>();
function specimens(v: MistView) {
  const near = preview ? [] : findsNear(v.seed, v.x, v.z, NEAR_SPECIMEN).filter((f) => f.kind === 'crystal');
  const keep = new Set(near.map((f) => `${v.seed}:${f.id}`));
  for (const key of sprites.keys()) if (key.startsWith('field:') && !keep.has(key.slice(6)) && !lives.some((l) => `field:${l.key}` === key)) sprites.delete(key);
  if (!crystalGl || !near.length) return;
  const now = performance.now();
  // the one most owed a new picture: never drawn, or drawn longest ago for how near it is
  let best: Find | null = null, owed = -1;
  for (const f of near) {
    const r = Math.hypot(f.x - v.x, f.z - v.z), at = drawnAt.get(`${v.seed}:${f.id}`);
    const o = at === undefined ? 1e9 : (now - at) / (200 + r * 40);
    if (o > owed) { owed = o; best = f; }
  }
  if (!best || owed < 1) return;
  const f = best, key = `${v.seed}:${f.id}`, r = Math.hypot(f.x - v.x, f.z - v.z);
  const { engine, canvas } = crystalGl;
  if (engine.seed !== f.seed) engine.grow(f.seed);
  // (seen from here: round it as you stand to it, and from as high as your eye is over it)
  const az = Math.atan2(v.x - f.x, v.z - f.z) + (f.seed % 628) / 100;
  const el = Math.max(0.1, Math.min(0.9, Math.atan2(v.eye - v.ground(f.x, f.z) - 0.35, r)));
  engine.frame({ az, el, dist: 9 }, SPRITE_PX, SPRITE_PX);
  const old = sprites.get(`field:${key}`);
  const tex = spriteTexture(canvas, old?.tex ?? null);
  sprites.set(`field:${key}`, { x: f.x, z: f.z, w: SPECIMEN_M, h: SPECIMEN_M, sink: 0.22, alpha: 1, tex });
  drawnAt.set(key, now);
}

// ─── the fungi in the wood: the Hat-throwers' own renderer, live ───────────────────────────────
// The two nearest fungi each run the Hat-throwers page itself, in its cut-out mode (`?one&cut`:
// the species alone, on transparency, on its own clock — growing, glistening, throwing), in a
// small frame kept in view behind the wood (so the browser keeps it running). Each frame it is
// told where you stand, and its picture is lifted into the wood, on the litter, in the fog.
const FUNGI_LIVE = 2, NEAR_FUNGUS = 32, FUNGUS_M = 0.75;
interface Live { frame: HTMLIFrameElement; key: string; f: Find }
const lives: Live[] = [];
function fungi(v: MistView) {
  const near = preview ? [] : findsNear(v.seed, v.x, v.z, NEAR_FUNGUS).filter((f) => f.kind === 'fungus')
    .sort((a, b) => Math.hypot(a.x - v.x, a.z - v.z) - Math.hypot(b.x - v.x, b.z - v.z)).slice(0, FUNGI_LIVE);
  const want = new Map(near.map((f) => [`${v.seed}:${f.id}`, f]));
  // (let go of the ones no longer near: their frame is reused for one that is)
  for (const l of lives) if (!want.has(l.key)) { sprites.delete(`field:${l.key}`); l.key = ''; }
  for (const [key, f] of want) {
    if (lives.some((l) => l.key === key)) continue;
    let l = lives.find((x) => !x.key);
    if (!l) {
      if (lives.length >= FUNGI_LIVE) continue;
      const frame = document.createElement('iframe');
      frame.className = 'live';
      frame.setAttribute('aria-hidden', 'true');
      frame.tabIndex = -1;
      document.body.appendChild(frame);
      l = { frame, key: '', f };
      lives.push(l);
    }
    l.key = key;
    l.f = f;
    l.frame.src = `/fungi?one&cut&seed=${f.seed}&t=${8 + (f.seed % 10)}`;
  }
  for (const l of lives) {
    if (!l.key) continue;
    const f = l.f, r = Math.hypot(f.x - v.x, f.z - v.z);
    try {
      const w = l.frame.contentWindow as (Window & { __fungiCut?: { yaw: number; pitch: number } }) | null;
      const c = l.frame.contentDocument?.getElementById('macro') as HTMLCanvasElement | null;
      if (!w || !c || !c.width) continue;
      // (seen from where you stand: round it as you walk round it; from your eye's height over it)
      w.__fungiCut = { yaw: Math.atan2(v.z - f.z, v.x - f.x) + (f.seed % 628) / 100, pitch: Math.max(0.12, Math.min(0.75, Math.atan2(v.eye - v.ground(f.x, f.z), r))) };
      const old = sprites.get(`field:${l.key}`);
      sprites.set(`field:${l.key}`, { x: f.x, z: f.z, w: FUNGUS_M, h: FUNGUS_M, sink: 0.12, alpha: 1, tex: spriteTexture(c, old?.tex ?? null) });
    } catch { /* (not loaded yet, or another origin: no picture this frame) */ }
  }
}

// ─── the markers, every frame ───────────────────────────────────────────────────────────────────
const layer = $('marks');
const els = new Map<string, HTMLButtonElement>();
const say = $('say');
let sayUntil = 0;
function hintAt(t: string) { say.textContent = t; say.classList.add('show'); sayUntil = performance.now() + 2200; }
function frame() {
  requestAnimationFrame(frame);
  const v = view();
  if (performance.now() > sayUntil) say.classList.remove('show');
  if (!v) return;
  dial.style.transform = `rotate(${(-v.yaw * 180) / Math.PI}deg)`;
  specimens(v);
  fungi(v);
  if (preview || !sheet.hidden) { layer.style.visibility = 'hidden'; return; }
  layer.style.visibility = '';
  const k = canvas.clientWidth / v.W;
  const near = findsNear(v.seed, v.x, v.z, SHOW);
  const live = new Set<string>();
  for (const f of near) {
    const p = project(v, f.x, f.z, v.ground(f.x, f.z) + (f.kind === 'crystal' ? SPECIMEN_M + 0.45 : FUNGUS_M + 0.2));
    if (!p) continue;
    const key = `${v.seed}:${f.id}`;
    live.add(key);
    let el = els.get(key);
    if (!el) {
      el = document.createElement('button');
      el.className = `mark ${f.kind}`;
      el.setAttribute('aria-label', `${f.kind === 'crystal' ? 'a crystal' : 'a fungus'}: ${f.name}`);
      el.innerHTML = emblem(f.kind, STYLE[f.kind], f.seed, glyphMark(GLYPH[f.kind], STYLE[f.kind].ink));
      el.addEventListener('click', () => {
        const w = view();
        if (!w) return;
        const d = Math.hypot(f.x - w.x, f.z - w.z);
        if (d <= OPEN) open(f, w.seed);
        else hintAt(`${f.kind === 'crystal' ? 'A glint in the stone' : 'Something in the litter'}, ${Math.round(d)} m off. Come closer.`);
      });
      layer.appendChild(el);
      els.set(key, el);
    }
    const size = Math.max(22, Math.min(96, (2.4 / p.r) * v.f * k));
    // (it comes out of the fog as the trees do — the wood's own fog, thicker where the wood is
    // denser — and softens as it goes; one you have found is quieter)
    const fog = Math.exp(-p.r * 0.045 * Math.max(0.4, v.density));
    const op = fog * (1 - Math.min(1, Math.max(0, (p.r - (SHOW - 12)) / 12))) * (found(v.seed, f.id) ? 0.55 : 1);
    el.style.cssText = `left:${p.px * k}px;top:${p.py * k}px;width:${size}px;height:${size}px;opacity:${op.toFixed(2)};z-index:${Math.round(1000 - p.r)}`;
    el.classList.toggle('near', p.r <= OPEN);
  }
  for (const [key, el] of els) if (!live.has(key)) { el.remove(); els.delete(key); }
}
if (preview) document.documentElement.classList.add('preview');
// (Mistwood started itself on import, on this page's canvas; the journal's layer follows it)
requestAnimationFrame(frame);
