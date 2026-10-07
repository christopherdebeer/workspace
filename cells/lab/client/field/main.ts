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
import { formOf } from './mushrooms';
import { clusterTop, drawCluster } from './woodfungi';
import { customs } from '../mistwood/main';
import { DEPTH_RANGE, type WoodEnv } from '../mistwood/render';
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
function emblem(key: string, style: typeof SUIT_STYLES[number], seed: number, extra = '', lod = 2): string {
  const k = `${key}:${seed}:${lod}`;
  let svg = cache.get(k);
  if (!svg) {
    const st = { ...sample(style, seed), stipple: 0, washAmount: 0, faint: 1, ...LOD[lod] };
    svg = `<svg viewBox="-62 -62 124 124" aria-hidden="true">${sealSvg(draw(st, null, seed), st, `e${k.replace(/\W/g, '')}`)}${extra}</svg>`;
    cache.set(k, svg);
  }
  return svg;
}
/** a seal's levels of detail, coarse to fine: what each takes off (or adds to) the family's style.
 *  0 — a ring and the glyph; 1 — the construction (rings, band, the star lattice); 2 — a coarse
 *  even fill of ornament; 3 — fine and dense, with lace, for close up */
const LOD: Array<Record<string, unknown>> = [
  { rings: 1, beads: 0, band: 'none', lines: false, packTries: 0, dots: 0, crescents: 0, nodeDots: 0, diagNodes: false, medal: 0, motifSize: 0.01 },
  { rings: 2, beads: 0.4, packTries: 0, dots: 0, nodeDots: 1 },
  { packMax: 7.5, packMin: 1.6, links: 0, packTries: 16 },
  { packMax: 4.2, packMin: 0.5, packTries: 30, links: 0.6 },
];
/** the screen size (px) at which each level has fully taken over from the one before, and the
 *  width of the cross-fade below it (as a ratio of sizes) */
const LOD_AT = [0, 46, 120, 300], LOD_FADE = 1.6;
/** a seal's size in the wood (m): fixed, so it grows as you come close */
const SEAL_M = 1.6;
/** the glyph at a seal's heart: larger at the coarse levels, where it is most of what shows */
const glyphMark = (g: string, ink: string, lod = 2) => { const s = [1.9, 1.3, 1, 0.8][lod] ?? 1; return `<g transform="scale(${s})"><circle r="15" stroke="${ink}" stroke-width="1.2"/><text y="9" text-anchor="middle" font-size="25" font-family="Georgia,serif" fill="${ink}">${g}</text></g>`; };

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
const specimenSrc = (f: Find | Entry) => (f.kind === 'crystal' ? `/crystals?preview&seed=${f.seed}` : `/fungi?one&seed=${f.seed}&form=${formOf(f.seed)}`);

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

// ─── the specimens in the wood, as real geometry ────────────────────────────────────────────────
// Drawn into Mistwood's own scene (its CustomDraw), in its place among the trees and grass, in its
// light, fog and mist, writing its depth:
// - crystals: the Crystals ray tracer itself, on the wood's GL context, every pixel's ray from the
//   wood's camera (so walking round one, it turns; coming close, it fills the view, refracting
//   and dispersing what is behind it as the studio specimen does) — within a scissor round it;
// - fungi: a cluster of the species' mushrooms as meshes (woodfungi.ts).
const NEAR = 40;
/** a crystal specimen's scale: metres to the Crystals' units (its matrix ~1.3 wide: ~35 cm) */
const CRYSTAL_SCALE = 0.26;
let engine: CrystalEngine | null = null;
const fogAt = (d: number, above: number, density: number) => { const path = d * 0.55 + (d * d) / 40; const sm = Math.min(1, Math.max(0, (d - 5) / 15)); return 1 - Math.exp(-density * path * (1 + 1.1 * Math.exp(-Math.max(above, 0) * 0.35) * sm * sm * (3 - 2 * sm))); };
function drawCrystal(env: WoodEnv, f: Find) {
  if (!engine) { try { engine = createCrystalEngine(env.gl, { quality: 'low', still: true, cut: true }); } catch (e) { console.warn('crystals in the wood:', e); return; } }
  if (engine.seed !== f.seed || !engine.spec) engine.grow(f.seed);
  const v = env.view, A = env.look.atmos;
  const turn = (f.seed % 628) / 100;
  // the scissor: round the specimen's reach, on the wood's screen (GL pixels, y up)
  const reach = engine.extent() * CRYSTAL_SCALE * 1.15;
  const cy = env.base + reach * 0.4;
  const rx = f.x - v.x, rz = f.z - v.z, ry = cy - v.eye;
  const cs = Math.cos(v.yaw), sn = Math.sin(v.yaw);
  const cx = rx * cs - rz * sn, cz = rx * sn + rz * cs;
  const hd = Math.max(0.05, Math.hypot(cx, cz));
  let rect: [number, number, number, number] = [0, 0, env.W, env.H];
  if (hd > reach * 1.6) {
    const sx = Math.atan2(cx, cz) * v.f + env.W / 2, sy = (ry / hd) * v.f + v.horizon, pr = (reach / (hd - reach)) * v.f * 1.2 + 4;
    rect = [Math.max(0, sx - pr), Math.max(0, sy - pr), Math.min(env.W, 2 * pr), Math.min(env.H, 2 * pr)];
  }
  const dist = Math.hypot(rx, rz);
  const fog = 1 - (1 - fogAt(dist, 0.2, env.look.density)) * Math.exp(-(env.mist[0] + env.mist[1]) / 2);
  const light = [Math.sin(A.at[0]) * Math.cos(A.at[1]), Math.sin(A.at[1]), Math.cos(A.at[0]) * Math.cos(A.at[1])];
  const illum = (A.illum[0] + A.illum[1] + A.illum[2]) / 3;
  env.gl.depthMask(true);
  engine.drawWood({ res: [env.W, env.H], f: v.f, horizon: v.horizon, cam: [v.x, v.z, v.eye, v.yaw], anchor: [f.x, env.base, f.z], scale: CRYSTAL_SCALE, turn, light, lightCol: A.illum.map((c) => c * 1.6), fogCol: A.fogLow, fog, exposure: 0.55 + 0.6 * illum, depthRange: DEPTH_RANGE, rect });
  env.gl.depthMask(false);
}
const tops = new Map<number, number>();
const failed = new Set<string>();
const topOf = (f: Find) => { let t = tops.get(f.seed); if (t === undefined) { t = f.kind === 'crystal' ? 0.5 : clusterTop(f.seed); tops.set(f.seed, t); } return t; };
function specimens(v: MistView) {
  const near = preview ? [] : findsNear(v.seed, v.x, v.z, NEAR);
  const keep = new Set<string>();
  for (const f of near) {
    const key = `field:${v.seed}:${f.id}`;
    keep.add(key);
    if (customs.has(key) || failed.has(key)) continue;
    const turn = (f.seed % 628) / 100;
    // (a specimen that fails to draw is left out, not the wood with it)
    const draw = f.kind === 'crystal' ? (env: WoodEnv) => drawCrystal(env, f) : (env: WoodEnv) => drawCluster(env, f.seed, [f.x, f.z], turn);
    if ((f.kind === 'crystal' && qs.has('nocrystal')) || (f.kind === 'fungus' && qs.has('nofungi'))) continue;
    customs.set(key, { x: f.x, z: f.z, top: topOf(f), draw: (env) => { try { draw(env); const e = env.gl.getError(); if (e) console.warn(`field: GL error ${e} after ${f.kind}`); } catch (e) { console.warn('field: a specimen did not draw', e); customs.delete(key); failed.add(key); env.gl.depthMask(false); env.gl.disable(env.gl.SCISSOR_TEST); } } });
  }
  for (const key of customs.keys()) if (key.startsWith('field:') && !keep.has(key)) customs.delete(key);
}

// ─── the markers, every frame ───────────────────────────────────────────────────────────────────
const layer = $('marks');
const els = new Map<string, HTMLButtonElement>();
/** seals drawn this frame (a fine one is slow: one a frame) */
let drawnThisFrame = 0;
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
  if (preview || !sheet.hidden) { layer.style.visibility = 'hidden'; return; }
  layer.style.visibility = '';
  const k = canvas.clientWidth / v.W;
  drawnThisFrame = 0;
  const near = findsNear(v.seed, v.x, v.z, SHOW);
  const live = new Set<string>();
  for (const f of near) {
    const p = project(v, f.x, f.z, v.ground(f.x, f.z) + topOf(f) + 1.1);
    if (!p) continue;
    const key = `${v.seed}:${f.id}`;
    live.add(key);
    let el = els.get(key);
    if (!el) {
      el = document.createElement('button');
      el.className = `mark ${f.kind}`;
      el.setAttribute('aria-label', `${f.kind === 'crystal' ? 'a crystal' : 'a fungus'}: ${f.name}`);
      // (the levels, stacked, each drawn when first wanted; and the hit: only the middle takes a
      // tap, so a seal grown large doesn't stop you walking)
      el.innerHTML = `${LOD.map((_, i) => `<div class="lod" data-l="${i}"></div>`).join('')}<span class="hit"></span>`;
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
    // a fixed size in the wood: small far off, large close to
    const size = Math.max(8, (SEAL_M / p.r) * v.f * k);
    // (it comes out of the fog as the trees do — the wood's own fog, thicker where the wood is
    // denser — and softens as it goes; one you have found is quieter)
    const fog = Math.exp(-p.r * 0.045 * Math.max(0.4, v.density));
    // (and close to, it gives way to the thing itself: gone by 2.5 m, the find in front of you)
    const near = Math.min(1, Math.max(0, (p.r - 2.5) / 3.5));
    const op = fog * near * (1 - Math.min(1, Math.max(0, (p.r - (SHOW - 12)) / 12))) * (found(v.seed, f.id) ? 0.55 : 1);
    el.style.cssText = `left:${p.px * k}px;top:${p.py * k}px;width:${size.toFixed(1)}px;height:${size.toFixed(1)}px;opacity:${op.toFixed(2)};z-index:${Math.round(1000 - p.r)}`;
    el.classList.toggle('near', p.r <= OPEN);
    // the levels: each fades in over the band of sizes below where it takes over, the one before
    // fading out as it does (a finer level not drawn yet: the coarser holds until it is)
    const layers = el.querySelectorAll<HTMLElement>('.lod');
    const w = LOD_AT.map((at, i) => (i === 0 ? 1 : Math.max(0, Math.min(1, Math.log(size / (at / LOD_FADE)) / Math.log(LOD_FADE)))));
    let shown = 0;
    for (let i = LOD.length - 1; i >= 0; i--) {
      // (this level's share: its own weight, less what the finer levels have taken)
      const finer = i < LOD.length - 1 ? w[i + 1] : 0;
      const a = Math.max(0, w[i] - (i < LOD.length - 1 && layers[i + 1].firstChild ? finer : 0));
      const want = a > 0.01 || (i < LOD.length - 1 && finer > 0.01 && !layers[i + 1].firstChild);
      if (want && !layers[i].firstChild) {
        if (drawnThisFrame < 1 || i === 0) { layers[i].innerHTML = emblem(f.kind, STYLE[f.kind], f.seed, glyphMark(GLYPH[f.kind], STYLE[f.kind].ink, i), i); drawnThisFrame++; }
      }
      const ready = !!layers[i].firstChild;
      const opacity = ready ? Math.min(1, a + (i < LOD.length - 1 && !layers[i + 1].firstChild ? finer : 0)) : 0;
      layers[i].style.opacity = opacity.toFixed(2);
      layers[i].style.display = opacity > 0.01 ? '' : 'none';
      if (opacity > 0.01) shown = Math.max(shown, i);
    }
    el.dataset.lod = String(shown);
  }
  for (const [key, el] of els) if (!live.has(key)) { el.remove(); els.delete(key); }
}
if (preview) document.documentElement.classList.add('preview');
// (Mistwood started itself on import, on this page's canvas; the journal's layer follows it)
requestAnimationFrame(frame);
