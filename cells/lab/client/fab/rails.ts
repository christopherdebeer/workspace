/**
 * The rails: along the workshop's wall, to the left of the bench, a clothes rail for the workshop and one for each
 * person, each hung with skirts on hangers.
 *
 * A rail's skirts slide along its bar like a real rail's: drag them along and they run on, slow and settle with one
 * in front. Toward the bar's ends they bunch up, and each swings on its hook as it's pushed. A person's rail starts
 * with a bare hanger, for a new skirt.
 *
 * Every skirt on a rail is the real thing: its pattern drafted from its design (coarser: a rail's skirts don't need a
 * figure's detail), sewn and let fall from its hanger's clips by the same cloth (cloth.ts). Each settles once, a few
 * at a time, nearest first, and then hangs still: only its swing moves it, drawn as a turn about its hook.
 */
import { Cloth } from './cloth';
import { fabricById, makePrint } from './fabric';
import { draft, toHangerBuild, type Design } from './pattern';
import { FLOOR, HOOK, RAIL_W, RAIL_Y, swingAt, translate, type Fittings, type Item, type Look } from './render';
import { RAIL_COLOURS, rails, type Garment, type Rail } from './store';

type V3 = [number, number, number];
/** where the rails stand: in a row along the wall, left of the bench */
export const railX = (k: number) => -270 - k * 240;
export const RAIL_Z = -20;
const BAR_Y = FLOOR + 4.9 + RAIL_Y, SP = 30, GAP = 22, H = RAIL_W / 2 - 10, ELL = 26, SETTLE = 150;

interface Hung { g: Garment | null; x: number; vx: number; th: number; om: number; lastX: number; cloth: Cloth | null; frames: number; look: Look | null; key: string; model: Float32Array }
interface RailState { rail: Rail; scroll: number; vel: number; hung: Hung[] }

const keyOf = (d: Design) => JSON.stringify(d);
/** settled skirts, kept by design: going back to the rails is instant, and a skirt on two rails is settled once */
const cache = new Map<string, { cloth: Cloth; frames: number }>();

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
        const key = g ? keyOf(g.design) : '';
        return was && was.key === key ? { ...was, g } : { g, x: this.slotX(i, prev?.scroll ?? 0), vx: 0, th: 0, om: 0, lastX: 0, cloth: null, frames: 0, look: g ? { fabric: fabricById(g.design.fabric), print: makePrint(g.design.print, g.design.colour) } : null, key, model: new Float32Array(16) };
      });
      return { rail, scroll: prev?.scroll ?? 0, vel: 0, hung };
    });
    this.active = Math.min(this.active, this.states.length - 1);
  }
  // (along the bar: spaced, bunching toward its ends, and a gap either side of the one in front so it hangs clear)
  private slotX(i: number, scroll: number) { const p = i * SP - scroll; return H * Math.tanh((p + Math.sign(p) * GAP * (1 - Math.exp(-Math.abs(p) / SP))) / H); }
  /** the one at the front of a rail */
  front(k = this.active): number { const s = this.states[k]; return s ? Math.max(0, Math.min(s.hung.length - 1, Math.round(s.scroll / SP))) : 0; }
  frontHung(k = this.active): Hung | undefined { return this.states[k]?.hung[this.front(k)]; }

  /** a drag along the rail (screen pixels to centimetres along it) */
  push(dxCm: number, dt: number) {
    const s = this.states[this.active]; if (!s) return;
    s.scroll -= dxCm; s.vel = -dxCm / Math.max(1e-3, dt);
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
        const z = RAIL_Z + (i % 2 ? -1.2 : 1.2) + (i === this.front(k) ? 3 : 0);
        swingAt([railX(k) + h.x, BAR_Y, z], [0, HOOK, 0], h.th, h.model);
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
        if (c) { h.cloth = c.cloth; h.frames = c.frames; }
        else { const sk = draft(h.g!.design, 650); h.cloth = new Cloth(toHangerBuild(sk, fabricById(h.g!.design.fabric))); h.frames = 0; cache.set(h.key, { cloth: h.cloth, frames: 0 }); }
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
      hangers: [this.active - 1, this.active, this.active + 1].flatMap((k) => (this.states[k]?.hung ?? []).map((h) => h.model)),
    };
  }
  /** where to look at rail k from */
  viewOf(k: number, aspect: number) {
    // (near enough that the one in front fills a phone's width, with its neighbours either side)
    const wide = Math.min(1.6, Math.max(0.4, aspect)), dist = Math.max(200, (wide < 0.8 ? 100 : 150) / (2 * Math.tan(0.3) * wide));
    return { az: 0, el: 0.06, dist, target: [railX(k), BAR_Y - 40, RAIL_Z] as V3 };
  }
  /** which garment of the active rail is under a point on the screen (its hook to below its hem) */
  pick(px: number, py: number, vp: Float32Array, w: number, h: number): number {
    const s = this.states[this.active]; if (!s) return -1;
    const proj = (p: V3) => { const x = vp[0] * p[0] + vp[4] * p[1] + vp[8] * p[2] + vp[12], y = vp[1] * p[0] + vp[5] * p[1] + vp[9] * p[2] + vp[13], ww = vp[3] * p[0] + vp[7] * p[1] + vp[11] * p[2] + vp[15]; return [(x / ww * 0.5 + 0.5) * w, (1 - (y / ww * 0.5 + 0.5)) * h]; };
    let best = -1, bd = Infinity;
    s.hung.forEach((hg, i) => {
      if (hg.g?.id === this.onFigure && hg.g) return;
      const len = hg.g?.design.length ?? 10, top = proj([railX(this.active) + hg.x, BAR_Y + 4, RAIL_Z]), bot = proj([railX(this.active) + hg.x, BAR_Y - HOOK - len, RAIL_Z]);
      const half = Math.abs(proj([railX(this.active) + hg.x + 16, BAR_Y, RAIL_Z])[0] - top[0]);
      if (py < top[1] - 10 || py > bot[1] + 10) return;
      const dx = Math.abs(px - top[0]); if (dx < half && dx + (i === this.front() ? -8 : 0) < bd) { bd = dx; best = i; }
    });
    return best;
  }
}
