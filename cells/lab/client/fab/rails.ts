/**
 * The rails: along the workshop's wall, to the left of the bench, the workshop's rails (skirts, tops, dresses, trousers)
 * and one for each person, each hung with garments on hangers: a waistband in a hanger's two clips, anything with a
 * bodice by its shoulders on a coat hanger.
 *
 * A rail's garments hang as on a real rail: each hanger across the bar, so they overlap, seen along the rail at an
 * angle. Drag them along and they run on, slow and settle with one in front: that one's drawn out and turned to face
 * you, the ones behind it fan away, the ones already passed are pushed together toward the near end. Each swings on
 * its hook as it's pushed (the hook swivels: it stays over the bar). A person's rail starts
 * with a bare hanger, for something new.
 *
 * Every garment on a rail is the real thing: its pattern drafted from its design (coarser: a rail's garments don't need a
 * figure's detail), sewn and let fall from its hanger by the same cloth (cloth.ts). Each settles once, a few
 * at a time, nearest first, and then hangs still: only its swing moves it, drawn as a turn about its hook.
 */
import { Cloth } from './cloth';
import { fabricOf, printOf } from './fabric';
import { draftGarment, toHangerBuild } from './garment';
import { FLOOR, HOOK, RAIL_W, RAIL_Y, swingAt, translate, type Fittings, type Item, type Look } from './render';
import { RAIL_COLOURS, designOf, lookOf, rails, type Garment, type Rail } from './store';

type V3 = [number, number, number];
/** where the rails stand: in a row along the wall, left of the bench */
export const railX = (k: number) => -270 - k * 240;
export const RAIL_Z = -20;
/** the rail's seen from this far round (radians): along it, at an angle */
export const RAIL_AZ = 0.92;
const BAR_Y = FLOOR + 4.9 + RAIL_Y, SP = 30, H = RAIL_W / 2 - 8, ELL = 26, SETTLE = 150;
/** along the bar: cm between hangers, and the gaps either side of the one in front (the near side's wide, so what's
 * been passed doesn't hide it) */
const PER = 9, GAP_FAR = 20, GAP_NEAR = 44;

interface Hung { g: Garment | null; x: number; vx: number; th: number; om: number; lastX: number; cloth: Cloth | null; frames: number; look: Look | null; key: string; model: Float32Array; hook: Float32Array; yaw: number; coat: boolean; hang: number }
interface RailState { rail: Rail; scroll: number; vel: number; hung: Hung[] }

const keyOf = (x: unknown) => JSON.stringify(x);
/** settled skirts, kept by design: going back to the rails is instant, and a skirt on two rails is settled once */
const cache = new Map<string, { cloth: Cloth; frames: number; hang: number }>();

export class Room {
  states: RailState[] = [];
  active = 0;
  dragging = false;
  /** the garment that's on the figure: its hanger's left empty on the rail */
  onFigure: string | null = null;

  constructor() { this.refresh(); }

  /** rebuild from the store (a rail added, a skirt hung up), keeping where each rail was scrolled to */
  refresh() {
    const old = new Map(this.states.map((s) => [s.rail.id, s]));
    this.states = rails().map((rail) => {
      const prev = old.get(rail.id);
      const slots: Array<Garment | null> = rail.workshop ? rail.garments : [null, ...rail.garments];
      const hung = slots.map((g, i): Hung => {
        const was = prev?.hung.find((h) => (h.g?.id ?? null) === (g?.id ?? null));
        const key = g ? keyOf({ design: designOf(g), recipe: g.recipe }) : '';
        const dg = g ? designOf(g) : null;
        return was && was.key === key ? { ...was, g } : { g, x: this.slotX(i, prev?.scroll ?? 0), vx: 0, th: 0, om: 0, lastX: 0, cloth: null, frames: 0, look: g ? { fabric: fabricOf(lookOf(g)), print: printOf(lookOf(g)) } : null, key, model: new Float32Array(16), hook: new Float32Array(16), yaw: Math.PI / 2, coat: !!dg && dg.family !== 'skirt' && dg.family !== 'trousers', hang: dg?.length ?? 8 };
      });
      return { rail, scroll: prev?.scroll ?? 0, vel: 0, hung };
    });
    this.active = Math.min(this.active, this.states.length - 1);
  }
  // (along the bar: spaced, bunching toward its ends, and a gap either side of the one in front so it hangs clear)
  private slotX(i: number, scroll: number) {
    const p = i - scroll / SP, a = Math.abs(p), x = -Math.sign(p) * ((p > 0 ? GAP_FAR : GAP_NEAR) * (1 - Math.exp(-a * 2.5)) + a * PER);
    return H * Math.tanh(x / H);
  }
  /** the one at the front of a rail */
  front(k = this.active): number { const s = this.states[k]; return s ? Math.max(0, Math.min(s.hung.length - 1, Math.round(s.scroll / SP))) : 0; }
  frontHung(k = this.active): Hung | undefined { return this.states[k]?.hung[this.front(k)]; }

  /** a drag along the rail (screen pixels to centimetres along it) */
  push(dxCm: number, dt: number) {
    // (the skirts move with the finger: the bar's seen at an angle, so a centimetre across the screen is more along
    // it; and a slot's a scroll of SP but only about 12 cm along the bar, once they're bunched behind the front one)
    const s = this.states[this.active]; if (!s) return;
    const d = (dxCm * SP) / (12 * Math.cos(RAIL_AZ));
    s.scroll += d; s.vel = d / Math.max(1e-3, dt);
  }
  /** bring garment i to the front */
  goTo(i: number) { const s = this.states[this.active]; if (s) { s.vel = 0; s.scroll = Math.max(0, Math.min(s.hung.length - 1, i)) * SP; } }
  /** a garment touched: it swings */
  nudge(i: number, dir: number) { const h = this.states[this.active]?.hung[i]; if (h) h.om += 1.2 * dir; }

  /** one frame: the rails' skirts slide, swing, and settle (within `budget` ms) */
  update(dt: number, budget: number) {
    for (let k = 0; k < this.states.length; k++) {
      const s = this.states[k], max = (s.hung.length - 1) * SP;
      if (!this.dragging || k !== this.active) {
        // (running on, slowing; then settling with the nearest at the front)
        s.scroll += s.vel * dt; s.vel *= Math.exp(-3.2 * dt);
        if (Math.abs(s.vel) < 40) { const target = Math.max(0, Math.min(max, Math.round(s.scroll / SP) * SP)); s.scroll += (target - s.scroll) * Math.min(1, dt * 7); }
      }
      // (past the ends it gives, and springs back)
      if (s.scroll < 0) s.scroll += -s.scroll * Math.min(1, dt * 9); if (s.scroll > max) s.scroll -= (s.scroll - max) * Math.min(1, dt * 9);
      s.hung.forEach((h, i) => {
        h.lastX = h.x; h.x = this.slotX(i, s.scroll);
        const v = (h.x - h.lastX) / Math.max(1e-3, dt), a = (v - h.vx) / Math.max(1e-3, dt); h.vx = v;
        // (each swings on its hook: a damped pendulum, pushed by how its hook's carried along)
        const w2 = 980 / ELL, acc = -w2 * Math.sin(h.th) - 2 * 0.22 * Math.sqrt(w2) * h.om - (Math.max(-500, Math.min(500, a)) / ELL) * Math.cos(h.th);
        h.om += acc * dt; h.th = Math.max(-0.35, Math.min(0.35, h.th + h.om * dt));
        // (the one in front turned to face the viewer; the others across the bar. Each hangs from its hook, on the bar,
        // the hook swivelling with it: hanger and hook share the one point they meet at)
        const p = Math.abs(i - s.scroll / SP), f = Math.max(0, 1 - p), w = f * f * (3 - 2 * f);
        h.yaw = Math.PI / 2 + (RAIL_AZ - Math.PI / 2) * w;
        const at: V3 = [railX(k) + h.x, BAR_Y, RAIL_Z];
        swingAt(at, [0, HOOK, 0], h.th, h.model, h.yaw);
        swingAt(at, [0, HOOK, 0], h.th, h.hook);
      });
    }
    // (settling, nearest the front of the rail being looked at first)
    const t0 = performance.now(), want: Hung[] = [];
    for (const k of [this.active, this.active - 1, this.active + 1]) {
      const s = this.states[k]; if (!s) continue;
      const f = this.front(k);
      want.push(...s.hung.filter((h) => h.g).sort((a, b) => Math.abs(s.hung.indexOf(a) - f) - Math.abs(s.hung.indexOf(b) - f)));
    }
    for (const h of want) {
      if (!h.cloth) {
        const c = cache.get(h.key);
        if (c) { h.cloth = c.cloth; h.frames = c.frames; h.hang = c.hang; }
        else {
          // (a garment that won't draft (it can't: every design that can be saved is made whole) hangs as a bare hanger)
          try { const g = draftGarment(designOf(h.g!), 650, h.g!.recipe); h.cloth = new Cloth(toHangerBuild(g, fabricOf(lookOf(h.g!)))); h.hang = g.m.hang; }
          catch { h.g = null; continue; }
          h.frames = 0; cache.set(h.key, { cloth: h.cloth, frames: 0, hang: h.hang });
        }
      }
      while (h.frames < SETTLE && performance.now() - t0 < budget) { h.cloth.step(1 / 60); h.frames++; cache.get(h.key)!.frames = h.frames; }
      if (performance.now() - t0 >= budget) break;
    }
  }

  items(): Item[] {
    const out: Item[] = [];
    for (const k of [this.active - 1, this.active, this.active + 1]) for (const h of this.states[k]?.hung ?? []) if (h.cloth && h.look && h.g?.id !== this.onFigure) out.push({ cloth: h.cloth, look: h.look, model: h.model });
    return out;
  }
  fittings(): Fittings {
    return {
      rails: this.states.map((s, k) => ({ model: translate(railX(k), FLOOR + 4.9, RAIL_Z), tint: s.rail.workshop ? [0.6, 0.6, 0.62] as V3 : RAIL_COLOURS[s.rail.colour % RAIL_COLOURS.length].tint })),
      hangers: [this.active - 1, this.active, this.active + 1].flatMap((k) => (this.states[k]?.hung ?? []).filter((h) => !h.coat).map((h) => h.model)),
      coats: [this.active - 1, this.active, this.active + 1].flatMap((k) => (this.states[k]?.hung ?? []).filter((h) => h.coat).map((h) => h.model)),
      hooks: [this.active - 1, this.active, this.active + 1].flatMap((k) => (this.states[k]?.hung ?? []).map((h) => h.hook)),
    };
  }
  /** where to look at rail k from: along it at an angle, the one in front filling most of the width */
  viewOf(k: number, aspect: number) {
    // (from a child's eye height, below the bar: so the bar runs away from it on a slant, and the skirts behind the
    // one in front grow smaller as they go)
    const wide = Math.min(1.6, Math.max(0.4, aspect)), dist = Math.max(150, (wide < 0.8 ? 80 : 140) / (2 * Math.tan(0.3) * wide));
    return { az: RAIL_AZ, el: -0.1, dist, target: [railX(k) - 4, BAR_Y - 36, RAIL_Z + 6] as V3 };
  }
  /** which garment of the active rail is under a point on the screen: the one in front if it's on it, else the one
   * nearest it along the rail whose outline (hook to hem, clip to clip) holds the point */
  pick(px: number, py: number, vp: Float32Array, w: number, h: number): number {
    const s = this.states[this.active]; if (!s) return -1;
    const screen = (m: Float32Array, l: V3) => {
      const p = [m[0] * l[0] + m[4] * l[1] + m[8] * l[2] + m[12], m[1] * l[0] + m[5] * l[1] + m[9] * l[2] + m[13], m[2] * l[0] + m[6] * l[1] + m[10] * l[2] + m[14]];
      const x = vp[0] * p[0] + vp[4] * p[1] + vp[8] * p[2] + vp[12], y = vp[1] * p[0] + vp[5] * p[1] + vp[9] * p[2] + vp[13], ww = vp[3] * p[0] + vp[7] * p[1] + vp[11] * p[2] + vp[15];
      return [(x / ww * 0.5 + 0.5) * w, (1 - (y / ww * 0.5 + 0.5)) * h];
    };
    const f = this.front(), inside = (i: number) => {
      const hg = s.hung[i], len = hg.g ? hg.hang : 8, pts = [[-19, HOOK + 2, 0], [19, HOOK + 2, 0], [-24, -len, 0], [24, -len, 0]].map((q) => screen(hg.model, q as V3));
      const xs = pts.map((q) => q[0]), ys = pts.map((q) => q[1]);
      return px >= Math.min(...xs) - 6 && px <= Math.max(...xs) + 6 && py >= Math.min(...ys) - 6 && py <= Math.max(...ys) + 6;
    };
    if (s.hung[f] && inside(f)) return f;
    let best = -1;
    for (let d = 1; d < s.hung.length; d++) for (const i of [f + d, f - d]) if (best < 0 && s.hung[i] && inside(i)) best = i;
    return best;
  }
}
