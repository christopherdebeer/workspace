/**
 * The run's own working, drawn into the scene (`?debug=plan`): what the runner means, plans and does, as lines in the
 * world (render.ts draws them a given width, turned to the eye, and still shows them, faint and hatched, where something
 * stands in front), so a playtest shows why it moved as it did, where it happened.
 *
 * - on the ground ahead of your feet, three arrows: **your heading** (blue: only your turns move it), the **body's way**
 *   (orange: where it's carried now), the **eye** (green: where the camera looks);
 * - **what it sees**: the footing along your heading for eight metres, hugging what's there, white where it can run on,
 *   amber a step it'd take, red a face higher than a step;
 * - the **plan**: a ring where it takes off, its flight as read (violet; pink if it's the next of a chain), a post and a
 *   cross where it lands; the **next** fainter;
 * - in the air, the flight **foreseen** at takeoff (pale teal) against the one **flown** (teal);
 * - the last **footfalls**, small discs coloured by effort (plant, soft, up, check, touch, push, land), the landing's
 *   larger;
 * - and a line of text at the foot of the page: act, pace, held / stopped / at a limit, the plan, the stance left, how
 *   far the body's off your line.
 */
import type { Runner, Effort, Plan } from './runner';

type V3 = [number, number, number];
type RGBA = [number, number, number, number];
type Line = { pts: V3[]; col: RGBA; w: number };
const G = 9.8;
const EFFORT: Record<Effort, RGBA> = {
  plant: [0.42, 0.42, 0.42, 1], soft: [0.62, 0.62, 0.62, 1], up: [0.16, 0.62, 0.56, 1], check: [0.91, 0.77, 0.42, 1],
  touch: [0.54, 0.69, 0.49, 1], push: [0.91, 0.44, 0.32, 1], land: [0.76, 0.07, 0.12, 1],
};
const BLUE: RGBA = [0.11, 0.31, 0.85, 1], ORANGE: RGBA = [0.98, 0.45, 0.09, 1], GREEN: RGBA = [0.09, 0.64, 0.29, 1];
const VIOLET: RGBA = [0.49, 0.23, 0.93, 1], PINK: RGBA = [0.86, 0.15, 0.47, 1], TEAL: RGBA = [0.05, 0.45, 0.56, 1];

export class PlanDebug {
  private text: HTMLDivElement;
  private flown: V3[] = [];
  private foreseen: V3[] = [];
  private wasAir = false;
  constructor() {
    this.text = document.createElement('div');
    Object.assign(this.text.style, { position: 'fixed', left: '8px', bottom: '64px', right: '8px', font: '600 12px ui-monospace, monospace', color: '#111', background: 'rgba(255,255,255,.8)', padding: '4px 6px', pointerEvents: 'none', zIndex: '5', whiteSpace: 'pre-wrap' });
    document.body.appendChild(this.text);
  }
  /** the lines for this frame (into `out`), and the text */
  draw(me: Runner, gaze: number, out: Line[]) {
    out.length = 0;
    const F = me.feet, lift = 0.06;
    const on = (x: number, z: number): V3 => [x, F.at(x, z).y + lift, z];
    const along = (a: number, d0: number, d1: number, step = 0.3) => { const pts: V3[] = []; for (let d = d0; d <= d1 + 1e-6; d += step) pts.push(on(me.x + Math.sin(a) * d, me.z + Math.cos(a) * d)); return pts; };
    const arrow = (a: number, len: number, col: RGBA, w: number) => {
      out.push({ pts: along(a, 0.6, len), col, w });
      const tip = on(me.x + Math.sin(a) * len, me.z + Math.cos(a) * len);
      for (const s of [-1, 1]) { const b = a + Math.PI + s * 0.45; out.push({ pts: [tip, on(tip[0] + Math.sin(b) * 0.5, tip[2] + Math.cos(b) * 0.5)], col, w }); }
    };
    const ring = (c: V3, r: number, col: RGBA, w: number) => { const pts: V3[] = []; for (let k = 0; k <= 16; k++) { const t = (k / 16) * Math.PI * 2; pts.push([c[0] + Math.sin(t) * r, c[1], c[2] + Math.cos(t) * r]); } out.push({ pts, col, w }); };
    const dashed = (pts: V3[], col: RGBA, w: number) => { for (let i = 0; i + 1 < pts.length; i += 2) out.push({ pts: [pts[i], pts[i + 1]], col, w }); };
    // (what it sees: the footing along your heading, by what it'd take)
    {
      const dx = Math.sin(me.heading), dz = Math.cos(me.heading);
      let prev = F.at(me.x, me.z).y, seg: V3[] = [], cur: RGBA | null = null;
      for (let d = 0.6; d <= 8; d += 0.2) {
        const x = me.x + dx * d, z = me.z + dz * d, y = F.at(x, z).y, rise = y - prev;
        const col: RGBA = rise > 0.95 ? [0.86, 0.1, 0.1, 0.95] : rise > 0.18 || rise < -0.4 ? [0.96, 0.62, 0.04, 0.95] : [1, 1, 1, 0.85];
        const p: V3 = [x, y + lift, z];
        if (cur && col !== cur && (col[0] !== cur[0] || col[1] !== cur[1])) { seg.push(p); out.push({ pts: seg, col: cur, w: 0.05 }); seg = []; }
        seg.push(p); cur = col; prev = y;
      }
      if (cur && seg.length > 1) out.push({ pts: seg, col: cur, w: 0.05 });
    }
    // (the three ways, flat on the ground ahead of your feet)
    arrow(me.heading, 5, BLUE, 0.09); arrow(me.move, 3.5, ORANGE, 0.08); arrow(gaze, 2.5, GREEN, 0.07);
    // (a move's flight as read: from its takeoff, rising to clear what it must, down to its landing)
    const arcOf = (p: Plan, y0: number): V3[] => {
      const L = Math.hypot(p.lx - p.ox, p.lz - p.oz), top = Math.max(y0, p.ly, p.clear || 0) + 0.2 + L * 0.06, pts: V3[] = [];
      for (let i = 0; i <= 20; i++) { const t = i / 20, base = y0 + (p.ly - y0) * t, y = base + 4 * t * (1 - t) * (top - Math.max(y0, p.ly)) + 4 * t * (1 - t) * (Math.max(y0, p.ly) - base) * 0.5; pts.push([p.ox + (p.lx - p.ox) * t, y + 0.1, p.oz + (p.lz - p.oz) * t]); }
      return pts;
    };
    const landing = (p: Plan, col: RGBA, w: number) => {
      const c: V3 = [p.lx, p.ly + lift, p.lz];
      for (const a of [0.785, -0.785]) out.push({ pts: [[c[0] - Math.sin(a) * 0.35, c[1], c[2] - Math.cos(a) * 0.35], [c[0] + Math.sin(a) * 0.35, c[1], c[2] + Math.cos(a) * 0.35]], col, w });
      out.push({ pts: [c, [c[0], c[1] + 1, c[2]]], col, w });
    };
    const p = me.plan;
    if (p && !me.air) {
      const oy = F.at(p.ox, p.oz).y;
      ring([p.ox, oy + lift, p.oz], 0.3, VIOLET, 0.06);
      out.push({ pts: arcOf(p, oy), col: p.chained ? PINK : VIOLET, w: 0.08 });
      landing(p, p.chained ? PINK : VIOLET, 0.07);
    }
    if (p?.next) { const n = p.next, c: RGBA = [VIOLET[0], VIOLET[1], VIOLET[2], 0.45]; dashed(arcOf(n, p.ly), c, 0.06); landing(n, c, 0.05); }
    // (in the air: foreseen at takeoff against flown)
    if (me.air && !this.wasAir) {
      this.flown = []; this.foreseen = [];
      for (let t = 0; t < 2.5; t += 0.04) { const y = me.y + me.vy * t - 0.5 * G * t * t; this.foreseen.push([me.x + me.vx * t, y + 0.1, me.z + me.vz * t]); if (y < F.at(me.x + me.vx * t, me.z + me.vz * t).y - 0.5) break; }
    }
    this.wasAir = me.air;
    if (me.air) this.flown.push([me.x, me.y + 0.1, me.z]);
    if (this.foreseen.length > 1) dashed(this.foreseen, [TEAL[0], TEAL[1], TEAL[2], 0.45], 0.06);
    if (this.flown.length > 1) out.push({ pts: this.flown, col: TEAL, w: 0.08 });
    if (me.aim) { const a = me.aim; out.push({ pts: [[a[0], a[1] + lift, a[2]], [a[0], a[1] + 1.4, a[2]]], col: TEAL, w: 0.05 }); }
    // (footfalls)
    for (const c of me.contacts) ring([c.x, c.y + lift, c.z], c.effort === 'land' ? 0.22 : 0.12, EFFORT[c.effort], c.effort === 'land' ? 0.06 : 0.045);
    // (the text)
    const s = me.debugState();
    this.text.textContent = [
      me.air ? `air · ${me.act}` : me.act,
      `${me.v.toFixed(1)} m/s`,
      s.held ? 'HELD at rim' : s.stopped ? 'STOPPED' : '',
      s.limitT > 0.4 ? `limit ${s.limitT.toFixed(1)}s` : '',
      p ? `plan ${p.kind}${p.planted !== undefined ? ' planted' : ''}${p.chained ? ' chained' : ''}${p.next ? ' +next' : ''}` : 'no plan',
      s.stanceLeft > 0 ? `stance ${(s.stanceLeft * 1000).toFixed(0)}ms` : '',
      `off-line ${(s.offLine * 57.3).toFixed(0)}°`,
    ].filter(Boolean).join('   ') + '\nblue heading · orange body · green eye · white/amber/red what it sees · violet plan (pink chained) · teal flight';
  }
}
