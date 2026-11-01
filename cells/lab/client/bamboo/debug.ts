/**
 * The run's own working, drawn over the picture (`?debug=plan`): what the runner means, plans and does, frame by frame,
 * so a playtest shows why it moved as it did.
 *
 * - three arrows from the feet: **your heading** (blue, where you mean to go: only your turns move it), the **body's way**
 *   (orange, where it's carried now), the **eye** (green, where the camera looks);
 * - the **plan**: its takeoff (a ring), its flight as read (a solid arc) and its landing (a cross); the **next** of a chain
 *   fainter and dashed; a chained plan, or one whose foot's planted, marked as such;
 * - in the air, the flight **foreseen** at takeoff (dashed) against the one **flown** (solid), so steering, re-aims and a
 *   landing that isn't where it was meant to be are seen;
 * - the last **footfalls**, each a dot coloured by its effort (plant, soft, up, check, touch, push, land), the landing's
 *   larger;
 * - a line of state: act, pace, held / stopped / at a limit, the plan's kind;
 * - and a **map** in the corner, from above, your heading up: the footing's heights round you shaded (a face higher than
 *   a step red), the three ways, the plan and its next, the flight foreseen and flown, the footfalls.
 */
import type { Runner, Effort, Plan } from './runner';

type V3 = [number, number, number];
const G = 9.8;
const EFFORT: Record<Effort, string> = { plant: '#6b6b6b', soft: '#9a9a9a', up: '#2a9d8f', check: '#e9c46a', touch: '#8ab17d', push: '#e76f51', land: '#c1121f' };

export class PlanDebug {
  private cv: HTMLCanvasElement;
  private g: CanvasRenderingContext2D;
  private flown: V3[] = [];
  private foreseen: V3[] = [];
  private wasAir = false;
  private hm: { x: number; z: number; h: number; y: number[] } | null = null; private hmAge = 99;
  constructor() {
    this.cv = document.createElement('canvas');
    Object.assign(this.cv.style, { position: 'fixed', inset: '0', width: '100%', height: '100%', pointerEvents: 'none', zIndex: '5' });
    document.body.appendChild(this.cv);
    this.g = this.cv.getContext('2d')!;
  }
  draw(me: Runner, project: (p: V3) => [number, number] | null, gaze: number) {
    const w = innerWidth, h = innerHeight, k = Math.min(devicePixelRatio || 1, 2);
    if (this.cv.width !== Math.round(w * k)) { this.cv.width = Math.round(w * k); this.cv.height = Math.round(h * k); }
    const g = this.g;
    g.setTransform(k, 0, 0, k, 0, 0); g.clearRect(0, 0, w, h);
    const at = (p: V3) => project(p);
    const line = (pts: V3[], col: string, width = 2, dash: number[] = []) => {
      g.strokeStyle = col; g.lineWidth = width; g.setLineDash(dash); g.beginPath();
      let on = false;
      for (const p of pts) { const s = at(p); if (!s) { on = false; continue; } if (on) g.lineTo(s[0], s[1]); else g.moveTo(s[0], s[1]); on = true; }
      g.stroke(); g.setLineDash([]);
    };
    const dot = (p: V3, r: number, col: string, ring = false) => { const s = at(p); if (!s) return; g.beginPath(); g.arc(s[0], s[1], r, 0, Math.PI * 2); if (ring) { g.strokeStyle = col; g.lineWidth = 2; g.stroke(); } else { g.fillStyle = col; g.fill(); } };
    const cross = (p: V3, r: number, col: string) => { const s = at(p); if (!s) return; g.strokeStyle = col; g.lineWidth = 2.5; g.beginPath(); g.moveTo(s[0] - r, s[1] - r); g.lineTo(s[0] + r, s[1] + r); g.moveTo(s[0] + r, s[1] - r); g.lineTo(s[0] - r, s[1] + r); g.stroke(); };
    const feet: V3 = [me.x, me.y + 0.05, me.z];
    // (the three ways)
    const ray = (a: number, len: number, col: string) => line([feet, [me.x + Math.sin(a) * len, me.y + 0.05, me.z + Math.cos(a) * len]], col, 3);
    ray(me.heading, 4, '#1d4ed8'); ray(me.move, 3, '#f97316'); ray(gaze, 2.2, '#16a34a');
    // (a move's flight as it was read: from its takeoff to its landing, rising to clear what it must)
    const arcOf = (p: Plan, y0: number): V3[] => {
      const L = Math.hypot(p.lx - p.ox, p.lz - p.oz), top = Math.max(y0, p.ly, p.clear || 0) + 0.25 + L * 0.08, out: V3[] = [];
      for (let i = 0; i <= 16; i++) { const t = i / 16, y = y0 + (p.ly - y0) * t + 4 * (top - Math.max(y0, p.ly)) * t * (1 - t) + (Math.max(y0, p.ly) - (y0 + (p.ly - y0) * t)) * 4 * t * (1 - t) * 0.5; out.push([p.ox + (p.lx - p.ox) * t, y, p.oz + (p.lz - p.oz) * t]); }
      return out;
    };
    const p = me.plan;
    if (p && !me.air) {
      const oy = me.y;
      dot([p.ox, oy, p.oz], 7, '#7c3aed', true);
      line(arcOf(p, oy), p.chained ? '#db2777' : '#7c3aed', 2.5);
      cross([p.lx, p.ly, p.lz], 7, '#7c3aed');
      if (p.next) { line(arcOf(p.next, p.ly), 'rgba(124,58,237,.45)', 2, [6, 5]); cross([p.next.lx, p.next.ly, p.next.lz], 5, 'rgba(124,58,237,.45)'); }
    }
    // (in the air: foreseen at takeoff against flown)
    if (me.air && !this.wasAir) {
      this.flown = []; this.foreseen = [];
      for (let t = 0; t < 2; t += 0.03) { const y = me.y + me.vy * t - 0.5 * G * t * t; this.foreseen.push([me.x + me.vx * t, y, me.z + me.vz * t]); if (t > 0.1 && y < me.y - 4) break; }
    }
    this.wasAir = me.air;
    if (me.air) this.flown.push([me.x, me.y, me.z]);
    if (this.foreseen.length) line(this.foreseen, 'rgba(14,116,144,.55)', 2, [5, 4]);
    if (this.flown.length > 1) line(this.flown, '#0e7490', 2.5);
    if (me.aim) cross(me.aim, me.air ? 8 : 5, me.air ? '#0e7490' : 'rgba(14,116,144,.6)');
    if (p?.next && me.air) { line(arcOf(p.next, p.ly), 'rgba(124,58,237,.45)', 2, [6, 5]); cross([p.next.lx, p.next.ly, p.next.lz], 5, 'rgba(124,58,237,.45)'); }
    // (footfalls)
    for (const c of me.contacts) dot([c.x, c.y + 0.02, c.z], c.effort === 'land' ? 6 : 4, EFFORT[c.effort]);
    this.map(me, gaze);
    // (state)
    const s = me.debugState();
    const state = [
      me.air ? `air · ${me.act}` : me.act,
      `${me.v.toFixed(1)} m/s`,
      s.held ? 'HELD at rim' : s.stopped ? 'STOPPED' : '',
      s.limitT > 0.4 ? `limit ${s.limitT.toFixed(1)}s` : '',
      p ? `plan ${p.kind}${p.planted !== undefined ? ' planted' : ''}${p.chained ? ' chained' : ''}${p.next ? ' +next' : ''}` : 'no plan',
      s.stanceLeft > 0 ? `stance ${(s.stanceLeft * 1000).toFixed(0)}ms` : '',
      `off-line ${(s.offLine * 57.3).toFixed(0)}°`,
    ].filter(Boolean).join('   ');
    g.font = '600 12px ui-monospace, monospace'; g.fillStyle = 'rgba(255,255,255,.82)';
    const tw = g.measureText(state).width; g.fillRect(8, h - 70, tw + 12, 22);
    g.fillStyle = '#111'; g.fillText(state, 14, h - 54);
    // (key)
    const key: [string, string][] = [['heading', '#1d4ed8'], ['body', '#f97316'], ['eye', '#16a34a'], ['plan', '#7c3aed'], ['flight', '#0e7490']];
    let x = 14; for (const [n, c] of key) { g.fillStyle = c; g.fillRect(x, h - 40, 10, 10); g.fillStyle = '#111'; g.fillText(n, x + 14, h - 31); x += g.measureText(n).width + 40; }
  }
  /** the map: 14 m across, centred on you, your heading up */
  private map(me: Runner, gaze: number) {
    const g = this.g, S = 168, R = 7, ox = 10, oy = 44, cx = ox + S / 2, cy = oy + S / 2, k = S / (2 * R);
    const h = me.heading, ch = Math.cos(h), sh = Math.sin(h);
    // (world to map: relative to you, turned so your heading points up)
    const m = (x: number, z: number): [number, number] => { const dx = x - me.x, dz = z - me.z, r = dx * ch - dz * sh, f = dx * sh + dz * ch; return [cx - r * k, cy - f * k]; };
    // (the footing's heights, a grid sampled a few times a second)
    if (++this.hmAge > 6 || !this.hm) {
      const N = 28, y: number[] = [];
      for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) { const r = -R + (i + 0.5) * (2 * R / N), f = R - (j + 0.5) * (2 * R / N); y.push(me.feet.at(me.x - r * ch + f * sh, me.z + r * sh + f * ch).y); }
      this.hm = { x: me.x, z: me.z, h, y }; this.hmAge = 0;
    }
    g.save(); g.beginPath(); g.rect(ox, oy, S, S); g.clip();
    const N = 28, cs = S / N;
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      const d = this.hm.y[j * N + i] - me.y, t = Math.max(-1, Math.min(1, d / 3));
      g.fillStyle = d > 0.95 ? `rgba(200,30,30,${0.35 + Math.min(0.5, (d - 0.95) * 0.2)})` : t > 0 ? `rgba(90,70,40,${0.15 + t * 0.5})` : `rgba(40,90,140,${0.12 - t * 0.45})`;
      g.fillRect(ox + i * cs, oy + j * cs, cs + 0.5, cs + 0.5);
    }
    const seg = (pts: [number, number][], col: string, wdt = 2, dash: number[] = []) => { g.strokeStyle = col; g.lineWidth = wdt; g.setLineDash(dash); g.beginPath(); pts.forEach((q, i) => (i ? g.lineTo(q[0], q[1]) : g.moveTo(q[0], q[1]))); g.stroke(); g.setLineDash([]); };
    const ray = (a: number, len: number, col: string) => seg([m(me.x, me.z), m(me.x + Math.sin(a) * len, me.z + Math.cos(a) * len)], col, 3);
    ray(me.heading, 5, '#1d4ed8'); ray(me.move, 3.5, '#f97316'); ray(gaze, 2.5, '#16a34a');
    const p = me.plan;
    if (p) {
      seg([m(p.ox, p.oz), m(p.lx, p.lz)], p.chained ? '#db2777' : '#7c3aed', 3);
      const o = m(p.ox, p.oz); g.strokeStyle = '#7c3aed'; g.lineWidth = 2; g.beginPath(); g.arc(o[0], o[1], 4, 0, 7); g.stroke();
      const l = m(p.lx, p.lz); g.fillStyle = '#7c3aed'; g.fillRect(l[0] - 3, l[1] - 3, 6, 6);
      if (p.next) seg([m(p.lx, p.lz), m(p.next.lx, p.next.lz)], 'rgba(124,58,237,.5)', 2, [4, 3]);
    }
    if (this.foreseen.length) seg(this.foreseen.map((q) => m(q[0], q[2])), 'rgba(14,116,144,.6)', 2, [4, 3]);
    if (this.flown.length > 1) seg(this.flown.map((q) => m(q[0], q[2])), '#0e7490', 2.5);
    if (me.aim) { const a = m(me.aim[0], me.aim[2]); seg([[a[0] - 4, a[1] - 4], [a[0] + 4, a[1] + 4]], '#0e7490', 2); seg([[a[0] + 4, a[1] - 4], [a[0] - 4, a[1] + 4]], '#0e7490', 2); }
    for (const c of me.contacts) { const q = m(c.x, c.z); g.fillStyle = EFFORT[c.effort]; g.beginPath(); g.arc(q[0], q[1], c.effort === 'land' ? 4 : 2.5, 0, 7); g.fill(); }
    g.fillStyle = '#111'; g.beginPath(); g.arc(cx, cy, 3, 0, 7); g.fill();
    g.restore();
    g.strokeStyle = 'rgba(0,0,0,.5)'; g.lineWidth = 1; g.strokeRect(ox, oy, S, S);
    g.font = '600 10px ui-monospace, monospace'; g.fillStyle = 'rgba(0,0,0,.65)'; g.fillText('14 m · heading up · red: a face', ox, oy + S + 12);
  }
}
