/**
 * Field Journal: the lab's experiments in one walk.
 *
 * The wood is Mistwood, itself (its module runs here, on this page's canvas). In it, now and then,
 * an anomaly: a crystal broken up out of the ground tens of metres high, or fungi grown gigantic —
 * the Crystals experiment's specimen, the Hat-throwers' species, from the find's seed — changing
 * the wood about it: its light in the mist (seen far off, before anything else), the ground
 * crusted and fissured or white with threads, the trees petrified or rotting, cleared in its
 * heart. Its seal is inscribed in light on the ground about it and stands in the air at its edge,
 * one by the path: in the wood, among the trees, in the fog, not seen from far off.
 *
 * Over it, drawn in the same light: the compass (a seal that turns as you do, a mark on its rim
 * toward each anomaly whose light is in the fog), the journal, and a find's card.
 *
 * Query: Mistwood's (seed, x, y, heading, hour …) · preview (the lab's index: the wood, the compass).
 */
import './hooks';
import { hash } from '../kit/rng';
import { SUIT_STYLES } from '../seals/styles';
import { pick } from '../crystals/mineral';
import { anomalies, customs, obstacle } from '../mistwood/main';
import type { Anomaly, WoodEnv } from '../mistwood/render';
import { findsNear, gateOf, project, type Find, type View } from './finds';
import { emblem, findSeal, GLYPH } from './emblem';
import { cardFor, notes } from './card';
import { crystalSolids, drawCrystalAnomaly, prepareCrystal } from './giantcrystal';
import { drawFungusAnomaly, fungusSolids, prepareFungus } from './giantfungi';
import { drawStanding, drawWard, sealArt, STAND, WARD } from './woodseal';
import { drawMotes } from './motes';
import type { V3 } from './mesh';

type MistView = View & { seed: number; density: number; ground: (x: number, z: number) => number };
const qs = new URLSearchParams(location.search);
const preview = qs.has('preview');
const $ = (id: string) => document.getElementById(id)!;
const esc = (t: string) => t.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
const view = () => (window as unknown as { __mistwoodView?: MistView }).__mistwoodView;

/** how far an anomaly's light reaches through the fog (m: set into the wood within this), how far
 *  its body is drawn, and how near its seal at the path must be to open it */
const LIGHT = 240, BODY = 110, OPEN = 11;

// ─── each anomaly: its light, its gate, its seals' places ────────────────────────────────────────
/** its light: a crystal's its body colour, brightened; a fungus's a glow of its own */
function lightOf(f: Find): V3 {
  if (f.kind === 'crystal') {
    const t = pick(f.seed).tint;
    const m = Math.max(...t), l = (t[0] + t[1] + t[2]) / 3 / m;
    // (more saturated than the body: the light is the colour; a clear one glows a cold white)
    const c = t.map((v) => Math.min(1, Math.max(0.08, l + (v / m - l) * 1.4))) as V3;
    return (l > 0.95 ? [0.82, 0.9, 1] : c).map((v) => v * 0.36) as V3;
  }
  const hues: V3[] = [[0.42, 1, 0.55], [0.38, 0.88, 1], [0.72, 1, 0.38], [1, 0.72, 0.36]];
  return hues[hash(f.seed, 0x11f) % hues.length].map((v) => v * 0.36) as V3;
}
interface Place { f: Find; light: V3; gate: { x: number; z: number; face: [number, number] }; stands: Array<{ x: number; z: number; face: [number, number] }> }
const places = new Map<string, Place>();
function placeOf(wood: number, f: Find): Place {
  const key = `${wood}:${f.id}`;
  let p = places.get(key);
  if (p) return p;
  // the gate: by the path where it passes nearest (a couple of metres off it, toward the heart),
  // or at the ward's edge toward the path if the path keeps further off; facing the path
  const g = gateOf(wood, f);
  const rw = f.reach * WARD;
  const d = Math.min(Math.max(g.d - 2.2, 4), rw + 2);
  const gate = { x: f.x - g.to[0] * d, z: f.z - g.to[1] * d, face: [-g.to[0], -g.to[1]] as [number, number] };
  // and three more about the ward's rim, facing out
  const a0 = Math.atan2(-g.to[0], -g.to[1]);
  const stands = [gate, ...[1, 2, 3].map((k) => { const a = a0 + (k * Math.PI) / 2; const face: [number, number] = [Math.sin(a), Math.cos(a)]; return { x: f.x + face[0] * rw, z: f.z + face[1] * rw, face }; })];
  p = { f, light: lightOf(f), gate, stands };
  places.set(key, p);
  return p;
}

// ─── into the wood ───────────────────────────────────────────────────────────────────────────────
const failed = new Set<string>();
const prepared = new Set<string>();
/** a draw that fails is left out (and said once), not the wood with it */
const guard = (key: string, draw: (env: WoodEnv) => void) => (env: WoodEnv) => {
  try { draw(env); } catch (e) { console.error('field: did not draw', key, String(e)); customs.delete(key); failed.add(key); env.gl.depthMask(false); }
};
function inTheWood(v: MistView): Place[] {
  const near = preview ? [] : findsNear(v.seed, v.x, v.z, LIGHT);
  const keep = new Set<string>();
  const here: Place[] = [];
  anomalies.length = 0;
  for (const f of near.sort((a, b) => Math.hypot(a.x - v.x, a.z - v.z) - Math.hypot(b.x - v.x, b.z - v.z))) {
    const p = placeOf(v.seed, f);
    here.push(p);
    const g0 = v.ground(f.x, f.z);
    anomalies.push({ x: f.x, z: f.z, reach: f.reach, kind: f.kind, light: p.light, heart: g0 + (f.kind === 'crystal' ? 6 : 9) } satisfies Anomaly);
    const dist = Math.hypot(f.x - v.x, f.z - v.z);
    // (its meshes built a while before they are wanted, between frames)
    const key = `${v.seed}:${f.id}`;
    if (dist < BODY + 60 && !prepared.has(key)) {
      prepared.add(key);
      const ground = v.ground;
      setTimeout(() => { try { (f.kind === 'crystal' ? prepareCrystal : prepareFungus)(f, ground); } catch (e) { console.error('field: not built', String(e)); } }, 0);
    }
    if (dist > BODY + 10) continue;
    // its seal's pictures, made in the background as it comes near
    sealArt(f);
    const base = `field:${v.seed}:${f.id}`;
    const add = (key: string, c: Parameters<typeof customs.set>[1]) => { keep.add(key); if (!customs.has(key) && !failed.has(key)) customs.set(key, c); };
    const ground = v.ground;
    add(`${base}:body`, { x: f.x, z: f.z, top: 20, first: 2, range: BODY, draw: guard(`${base}:body`, (env) => (f.kind === 'crystal' ? drawCrystalAnomaly(env, f, p.light, ground) : drawFungusAnomaly(env, f, p.light, ground))) });
    add(`${base}:ward`, { x: f.x, z: f.z, top: 0.1, first: 1, range: f.reach + 30, draw: guard(`${base}:ward`, (env) => drawWard(env, f, ground)) });
    add(`${base}:motes`, { x: f.x, z: f.z, top: 30, range: f.reach + 40, draw: guard(`${base}:motes`, (env) => drawMotes(env, f, f.kind, p.light, f.reach * 0.6, f.kind === 'crystal' ? 26 : 34)) });
    p.stands.forEach((s, i) => add(`${base}:stand${i}`, { x: s.x, z: s.z, top: STAND.at + STAND.size / 2, range: 32, draw: guard(`${base}:stand${i}`, (env) => drawStanding(env, f, s.x, s.z, s.face)) }));
  }
  for (const key of customs.keys()) if (key.startsWith('field:') && !keep.has(key)) customs.delete(key);
  // what of them is solid (once built): you walk round a crystal or a giant's stalk, not through it
  const solid = here.filter((p) => Math.hypot(p.f.x - v.x, p.f.z - v.z) < p.f.reach + 10).flatMap((p) => (p.f.kind === 'crystal' ? crystalSolids : fungusSolids).get(p.f.seed) ?? []);
  obstacle.at = solid.length ? (x, z) => { let d = 99; for (const [sx, sz, r] of solid) d = Math.min(d, Math.hypot(x - sx, z - sz) - r); return d; } : null;
  return here;
}

// ─── the compass ────────────────────────────────────────────────────────────────────────────────
const compass = $('compass');
compass.innerHTML = `<div class="dial">${emblem('compass', SUIT_STYLES[3], 7, `<path d="M0 -58L5 -46H-5Z"/><text y="-30" text-anchor="middle" font-size="13" font-family="Georgia,serif">N</text>`, 1)}<svg class="sense" viewBox="-62 -62 124 124"></svg></div><div class="needle"></div>`;
const dial = compass.querySelector<HTMLElement>('.dial')!;
const sense = compass.querySelector<SVGSVGElement>('.sense')!;

// ─── the journal: what has been found, kept in this browser ─────────────────────────────────────
interface Entry { wood: number; id: string; kind: Find['kind']; name: string; seed: number; at: number; reach?: number }
const KEY = 'field.journal';
const load = (): Entry[] => { try { return JSON.parse(localStorage.getItem(KEY) ?? '[]') as Entry[]; } catch { return []; } };
const save = (e: Entry[]) => { try { localStorage.setItem(KEY, JSON.stringify(e)); } catch { /* (private window: kept for the visit) */ } };
let journal = load();
const found = (wood: number, id: string) => journal.some((e) => e.wood === wood && e.id === id);
const countEl = $('count');
const showCount = () => { countEl.textContent = journal.length ? `the journal · ${journal.length}` : 'the journal'; };
showCount();

const sheet = $('sheet');
const closeSheet = () => { sheet.hidden = true; sheet.innerHTML = ''; };
function open(f: Find | Entry, wood: number) {
  const entry = journal.find((e) => e.wood === wood && e.id === f.id);
  const at = entry?.at ?? Date.now();
  sheet.innerHTML = `<div class="card">${cardFor(f, wood, at)}</div><p class="notes">${esc(notes(f))}</p><div class="row"><button class="lit" id="close">close</button></div>`;
  sheet.hidden = false;
  $('close').addEventListener('click', closeSheet);
  if ('x' in f && !found(wood, f.id)) {
    journal = [...journal, { wood, id: f.id, kind: f.kind, name: f.name, seed: f.seed, at, reach: f.reach }];
    save(journal);
    showCount();
  }
}
countEl.addEventListener('click', () => {
  sheet.innerHTML = `<div class="journal"><h2>The journal</h2>${journal.length ? `<div class="grid">${[...journal].reverse().map((e, i) => `<button class="entry" data-i="${journal.length - 1 - i}" aria-label="${esc(e.name)}">${findSeal(e.kind, e.seed, 1)}<span>${esc(e.name)}</span></button>`).join('')}</div>` : '<p>Nothing yet. Walk; look for a light in the mist.</p>'}<div class="row"><button class="lit" id="close">close</button></div></div>`;
  sheet.hidden = false;
  $('close').addEventListener('click', closeSheet);
  sheet.querySelectorAll<HTMLButtonElement>('.entry').forEach((b) => b.addEventListener('click', () => { const e = journal[Number(b.dataset.i)]; open(e, e.wood); }));
});

// ─── every frame ────────────────────────────────────────────────────────────────────────────────
const gateBtn = $('gate') as HTMLButtonElement;
const prompt = $('prompt') as HTMLButtonElement;
let current: Find | null = null;
const openCurrent = () => { const v = view(); if (current && v) open(current, v.seed); };
gateBtn.addEventListener('click', openCurrent);
prompt.addEventListener('click', openCurrent);
function frame() {
  requestAnimationFrame(frame);
  const v = view();
  if (!v) return;
  dial.style.transform = `rotate(${(-v.yaw * 180) / Math.PI}deg)`;
  const here = inTheWood(v);
  // (for tests and pictures: what is near, where)
  (window as unknown as { __field: unknown }).__field = here.map((p) => ({ id: p.f.id, kind: p.f.kind, name: p.f.name, x: p.f.x, z: p.f.z, reach: p.f.reach, gate: p.gate }));
  // the compass: a mark toward each light in the fog, nearer brighter (north up on the dial: it
  // turns with you, so they do too)
  sense.innerHTML = here.map((p) => {
    const d = Math.hypot(p.f.x - v.x, p.f.z - v.z);
    const a = Math.atan2(p.f.x - v.x, p.f.z - v.z);
    const op = Math.max(0.15, 1 - d / LIGHT);
    const x = Math.sin(a) * 54, y = -Math.cos(a) * 54, x2 = Math.sin(a) * 60, y2 = -Math.cos(a) * 60;
    return `<path d="M${x.toFixed(1)} ${y.toFixed(1)}L${x2.toFixed(1)} ${y2.toFixed(1)}" opacity="${op.toFixed(2)}"/><circle cx="${x2.toFixed(1)}" cy="${y2.toFixed(1)}" r="1.6" opacity="${op.toFixed(2)}"/>`;
  }).join('');
  if (preview || !sheet.hidden) { gateBtn.hidden = true; prompt.classList.remove('show'); return; }
  // near enough to one to open it: by its gate, or within its ward
  current = null;
  let best = Infinity;
  for (const p of here) {
    const dg = Math.hypot(p.gate.x - v.x, p.gate.z - v.z), dh = Math.hypot(p.f.x - v.x, p.f.z - v.z);
    const ok = dg < OPEN || dh < p.f.reach * WARD + 4;
    if (ok && dg < best) { best = dg; current = p.f; }
  }
  if (current) {
    const p = placeOf(v.seed, current);
    prompt.innerHTML = `<span class="g">${GLYPH[current.kind]}</span> ${esc(current.name)} <span class="sub">${found(v.seed, current.id) ? 'in the journal' : 'record it'}</span>`;
    prompt.classList.add('show');
    // its seal by the path takes a touch where it stands
    const k = $('wood').clientWidth / v.W;
    const s = project(v, p.gate.x, p.gate.z, v.ground(p.gate.x, p.gate.z) + STAND.at);
    if (s) {
      const size = Math.max(44, Math.min(260, (STAND.size / s.r) * v.f * k));
      gateBtn.style.cssText = `left:${s.px * k}px;top:${s.py * k}px;width:${size.toFixed(0)}px;height:${size.toFixed(0)}px`;
      gateBtn.hidden = false;
      gateBtn.setAttribute('aria-label', `the seal of ${current.name}: open it`);
    } else gateBtn.hidden = true;
  } else { prompt.classList.remove('show'); gateBtn.hidden = true; }
}
if (preview) document.documentElement.classList.add('preview');
// (Mistwood started itself on import, on this page's canvas; the journal follows it)
requestAnimationFrame(frame);
