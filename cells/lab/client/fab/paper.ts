/**
 * The paper: one panel of the skirt's pattern laid on the bench, large, to be worked with the hands, as a pattern
 * cutter works paper. What a child does to it is a move on the cutting table (cut.ts), recorded in order; the figure
 * wears the result as soon as it's made (and while it's being made: the cloth follows the paper).
 *
 * The tools, few and each one thing a dressmaker does:
 * - **hand**: drag the hem up or down (longer, shorter); turn the grain arrow (where on the cloth's threads it's cut);
 *   tap a dart to close it into flare, tap again to gather it instead, again to sew it as it was;
 * - **scissors**: slash up from the hem where you touch and drag it open: a wedge of new cloth, flare;
 * - **fold**: at the waist, drag to fold in a pleat;
 * - **thread**: at the waist, drag to add width there and gather it in.
 *
 * Every move's a chip in the history under the paper; tap one to take it back (the rest are made again, in order:
 * some may then do something different, or nothing, and say so).
 */
import { ribAt, type Move, type Panel, type V2 } from './cut';
import { makePrint } from './fabric';
import { cutOf, type Recipe } from './pattern';
import { tile } from './sheet';

export type Tool = 'hand' | 'scissors' | 'fold' | 'thread';
export const TOOLS: Array<{ id: Tool; label: string; icon: string; hint: string }> = [
  { id: 'hand', label: 'hand', icon: '<path d="M12 30V14a2.5 2.5 0 015 0v8M17 22V10a2.5 2.5 0 015 0v12M22 22V12a2.5 2.5 0 015 0v12M27 24v-6a2.5 2.5 0 015 0v8c0 6-4 10-10 10h-3c-4 0-6-2-8-5l-4-6a2.5 2.5 0 014-3l3 3"/>', hint: 'drag the hem to make it longer or shorter · turn the grain arrow · tap a dart' },
  { id: 'scissors', label: 'slash', icon: '<circle cx="11" cy="28" r="4"/><circle cx="25" cy="28" r="4"/><path d="M13 25L27 6M23 25L9 6"/>', hint: 'touch the hem and drag sideways: slash up to the waist and spread it open' },
  { id: 'fold', label: 'fold', icon: '<path d="M6 8h28M10 8v24M18 8v24M14 8l4 6M26 8v24M22 8l4 6"/>', hint: 'touch the waist and drag sideways: fold in a pleat' },
  { id: 'thread', label: 'gather', icon: '<path d="M4 10h32M6 10q2 5 0 10t0 10M14 10q2 5 0 10t0 10M22 10q2 5 0 10t0 10M30 10q2 5 0 10t0 10"/><circle cx="36" cy="10" r="2"/>', hint: 'touch the waist and drag sideways: add width there, gathered in' },
];

const near = (p: V2, a: V2, b: V2) => { const dx = b[0] - a[0], dy = b[1] - a[1], l = dx * dx + dy * dy, t = l ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l)) : 0; return Math.hypot(p[0] - a[0] - dx * t, p[1] - a[1] - dy * t); };
/** how far along a polyline a point's nearest place is, as a fraction of its length, and how far off it is */
function onLine(q: V2[], p: V2) {
  let best = Infinity, at = 0, acc = 0, total = 0;
  for (let i = 1; i < q.length; i++) total += Math.hypot(q[i][0] - q[i - 1][0], q[i][1] - q[i - 1][1]);
  for (let i = 1; i < q.length; i++) {
    const a = q[i - 1], b = q[i], l = Math.hypot(b[0] - a[0], b[1] - a[1]), t = l ? Math.max(0, Math.min(1, ((p[0] - a[0]) * (b[0] - a[0]) + (p[1] - a[1]) * (b[1] - a[1])) / (l * l))) : 0;
    const d = Math.hypot(p[0] - a[0] - (b[0] - a[0]) * t, p[1] - a[1] - (b[1] - a[1]) * t);
    if (d < best) { best = d; at = (acc + l * t) / Math.max(1e-9, total); }
    acc += l;
  }
  return { at, d: best };
}

/** a touch on the paper, in its own pixels */
interface Touch { clientX: number; clientY: number }
/** the paper's sheet: a fixed size, in its own pixels; the piece drawn on it at `sc` pixels a centimetre */
export const SHEET_W = 1024, SHEET_H = 768;
export class Paper {
  tool: Tool = 'hand';
  sc = 1; ox = 0; oy = 0; private frozen = false; private fitted = false;
  /** the sheet's pixels per pixel of the screen where it's being touched (so a fingertip's the same size wherever the
   * paper's seen from) */
  k = 1;
  /** goes up whenever it's drawn: whoever shows it knows to take it again */
  version = 0;
  private drag: null | { kind: 'hem' | 'grain' | 'spread' | 'pleat' | 'gather'; x0: number; y0: number; at: number; start: Recipe } = null;
  /** the move being made, drawn and worn before it's let go */
  preview: Recipe | null = null;
  get dragging() { return !!this.drag; }

  constructor(readonly cv: HTMLCanvasElement, private get: () => Recipe, private live: (r: Recipe) => void, private commit: (r: Recipe) => void, private tap: (r: Recipe, what: string) => void) {
    cv.width = SHEET_W; cv.height = SHEET_H;
  }
  /** touches, in the sheet's own pixels (the host maps the screen onto it) */
  downAt(x: number, y: number) { this.down({ clientX: x, clientY: y }); }
  moveAt(x: number, y: number) { this.move({ clientX: x, clientY: y }); }
  upAt() { this.up(); }
  cancel() { this.drag = null; this.preview = null; this.frozen = false; this.draw(); }
  private toFlat(e: Touch): V2 { return [(e.clientX - this.ox) / this.sc, -(e.clientY - this.oy) / this.sc]; }
  private toScreen(p: V2): V2 { return [this.ox + p[0] * this.sc, this.oy - p[1] * this.sc]; }
  /** the piece's extent on the sheet, in its pixels */
  bounds() {
    const { panel } = cutOf(this.preview ?? this.get()), pts = panel.ribs.flatMap((rb) => [rb.top, rb.knee, rb.bottom]).map((q) => this.toScreen(q));
    return { x0: Math.min(...pts.map((q) => q[0])), x1: Math.max(...pts.map((q) => q[0])), y0: Math.min(...pts.map((q) => q[1])), y1: Math.max(...pts.map((q) => q[1])) };
  }

  private down(e: Touch) {
    const r = this.get(), { panel } = cutOf(r), p = this.toFlat(e), tol = (16 * this.k) / this.sc;
    const hem = panel.ribs.map((rb) => rb.bottom), waist = panel.ribs.map((rb) => rb.top);
    const base = { x0: e.clientX, y0: e.clientY, start: r };
    if (this.tool === 'hand') {
      // (the grain arrow's tip turns it; a dart's tapped; anywhere near the hem drags it)
      // (a dart first (they're small); then the grain arrow's handle, at its tip; else the hem)
      const dart = this.dartAt(panel, p);
      if (dart !== null) { this.tap(this.cycleDart(r, panel, dart), 'dart'); return; }
      const g = this.grainArrow(panel, r.grain);
      if (Math.hypot(p[0] - g.tip[0], p[1] - g.tip[1]) < (18 * this.k) / this.sc) { this.drag = { kind: 'grain', at: 0, ...base }; this.frozen = true; return; }
      if (onLine(hem, p).d < tol * 1.6 || p[1] < Math.min(...hem.map((q) => q[1])) + tol) { this.drag = { kind: 'hem', at: 0, ...base }; this.frozen = true; }
      return;
    }
    if (this.tool === 'scissors') { this.drag = { kind: 'spread', at: onLine(hem, p).at, ...base }; this.frozen = true; return; }
    this.drag = { kind: this.tool === 'fold' ? 'pleat' : 'gather', at: onLine(waist, p).at, ...base };
    this.frozen = true;
  }
  private move(e: Touch) {
    if (!this.drag) return;
    const d = this.drag, dx = (e.clientX - d.x0) / this.sc, dy = (e.clientY - d.y0) / this.sc, r = d.start;
    let next: Recipe;
    if (d.kind === 'hem') next = { ...r, length: Math.round(Math.max(12, Math.min(62, r.length + dy))) };
    else if (d.kind === 'grain') { const g = Math.max(0, Math.min(45, r.grain + dx * 1.2)); next = { ...r, grain: Math.round(g) }; }
    else {
      const amt = Math.round(Math.abs(dx) * 2) / 2;
      const m: Move = d.kind === 'spread' ? { kind: 'spread', at: d.at, open: amt } : d.kind === 'pleat' ? { kind: 'pleat', at: d.at, depth: amt / 2 } : { kind: 'gather', at: d.at, add: amt };
      next = amt >= 0.5 ? { ...r, moves: [...r.moves, m] } : r;
    }
    this.preview = next; this.draw(); this.live(next);
  }
  private up() {
    if (!this.drag) return;
    const next = this.preview; this.drag = null; this.preview = null; this.frozen = false;
    if (next && next !== this.get()) this.commit(next); else this.draw();
  }
  /** a tap on a dart: sewn → closed into flare → gathered instead → sewn again */
  private cycleDart(r: Recipe, panel: Panel, k: number): Recipe {
    const st = panel.strips[k];
    if (st.kind === 'dart') { const idx = panel.strips.slice(0, k).filter((s) => s.kind === 'dart').length; return { ...r, moves: [...r.moves, { kind: 'close-dart', dart: idx }] }; }
    const m = r.moves[st.by];
    if (m?.kind === 'close-dart') return { ...r, moves: r.moves.map((x, i) => (i === st.by ? { kind: 'release-dart', dart: m.dart } : x)) };
    if (m?.kind === 'release-dart') return { ...r, moves: r.moves.filter((_, i) => i !== st.by) };
    return r;
  }
  /** which dart (or closed or released dart) is under a point: its strip */
  private dartAt(panel: Panel, p: V2): number | null {
    for (let k = 0; k < panel.strips.length; k++) {
      const st = panel.strips[k], m = st.by >= 0 ? this.get().moves[st.by] : null;
      const isDart = st.kind === 'dart' || m?.kind === 'close-dart' || m?.kind === 'release-dart';
      if (!isDart) continue;
      const a = panel.ribs[k], b = panel.ribs[k + 1], tip = a.knee;
      // (its triangle, generously: a child's finger's wider than a dart)
      const c: V2 = [(a.top[0] + b.top[0] + tip[0]) / 3, (a.top[1] + b.top[1] + tip[1]) / 3];
      if (Math.hypot(p[0] - c[0], p[1] - c[1]) < Math.max(3, (22 * this.k) / this.sc) || near(p, a.top, tip) < (14 * this.k) / this.sc || near(p, b.top, tip) < (14 * this.k) / this.sc) return k;
    }
    return null;
  }
  private grainArrow(panel: Panel, grain: number) {
    const top = panel.ribs.map((rb) => rb.top), bot = panel.ribs.map((rb) => rb.bottom);
    const mid = (q: V2[]) => q[Math.floor(q.length / 2)];
    // (in the middle of the piece, low enough that its handle's clear of the waist's darts)
    const a = mid(top), b = mid(bot), c: V2 = [a[0] + (b[0] - a[0]) * 0.58, a[1] + (b[1] - a[1]) * 0.58], g = (grain * Math.PI) / 180, len = Math.abs(a[1] - b[1]) * 0.26;
    const dx = -Math.sin(g), dy = Math.cos(g);
    return { tail: [c[0] - dx * len, c[1] - dy * len] as V2, tip: [c[0] + dx * len, c[1] + dy * len] as V2 };
  }

  draw() {
    const cv = this.cv, W = SHEET_W, H = SHEET_H;
    const ctx = cv.getContext('2d')!; ctx.setTransform(1, 0, 0, 1, 0, 0);
    this.version++;
    const r = this.preview ?? this.get(), { panel, ok } = cutOf(r);
    // (pattern paper)
    ctx.fillStyle = '#f4efe2'; ctx.fillRect(0, 0, W, H);
    // (the piece laid on the sheet, and left where it lies: it's moved and the sheet re-cut only when the piece no longer
    // fits on it, or has shrunk to a corner of it; never while a hand's on it)
    const pts = panel.ribs.flatMap((rb) => [rb.top, rb.knee, rb.bottom]);
    const x0 = Math.min(...pts.map((q) => q[0])), x1 = Math.max(...pts.map((q) => q[0])), y0 = Math.min(...pts.map((q) => q[1])), y1 = Math.max(...pts.map((q) => q[1]));
    if (!this.frozen) {
      const px0 = this.ox + x0 * this.sc, px1 = this.ox + x1 * this.sc, py0 = this.oy - y1 * this.sc, py1 = this.oy - y0 * this.sc, m = 40;
      const out = px0 < m || px1 > W - m || py0 < m || py1 > H - m, small = px1 - px0 < W * 0.4 && py1 - py0 < H * 0.4;
      if (!this.fitted || out || small) {
        this.sc = Math.min(24, (W - 2 * m - 60) / Math.max(10, x1 - x0), (H - 2 * m - 60) / Math.max(10, y1 - y0));
        this.ox = W / 2 - ((x0 + x1) / 2) * this.sc; this.oy = H / 2 + ((y0 + y1) / 2) * this.sc;
        this.fitted = true;
      }
    }
    const sc = this.sc;
    ctx.lineWidth = 1;
    for (let cm = -200; cm < 200; cm++) {
      ctx.strokeStyle = cm % 5 ? 'rgba(120,150,170,.1)' : 'rgba(120,150,170,.25)';
      const x = this.ox + cm * sc, y = this.oy + cm * sc;
      if (x > 0 && x < W) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke(); }
      if (y > 0 && y < H) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke(); }
    }
    // (the piece, its print laid along the grain)
    const path = new Path2D(), n = panel.ribs.length - 1;
    const add = (q: V2, i: number) => { const s = this.toScreen(q); if (i) path.lineTo(s[0], s[1]); else path.moveTo(s[0], s[1]); };
    let i = 0;
    for (let j = 0; j <= n; j++) add(panel.ribs[j].top, i++);
    for (let t = 1; t <= 10; t++) add(ribAt(panel.ribs[n], t / 10), i++);
    for (let j = n - 1; j >= 0; j--) add(panel.ribs[j].bottom, i++);
    for (let t = 9; t > 0; t--) add(ribAt(panel.ribs[0], t / 10), i++);
    path.closePath();
    const fill = tile(ctx, makePrint(r.print, r.colour), sc), g = (r.grain * Math.PI) / 180;
    if (typeof fill !== 'string') { const o = this.toScreen([0, 0]); fill.setTransform(new DOMMatrix([Math.cos(-g), Math.sin(-g), -Math.sin(-g), Math.cos(-g), o[0], o[1]])); }
    ctx.save(); ctx.globalAlpha = 0.8; ctx.fillStyle = fill; ctx.fill(path); ctx.restore();
    ctx.strokeStyle = '#3b2f24'; ctx.lineWidth = 4; ctx.stroke(path);
    // (how it was made: wedges shaded with their slashes dashed; pleats' fold lines; darts' legs; gathers' running stitch)
    const R = (k: number, s: number) => this.toScreen(ribAt(panel.ribs[k], s));
    panel.strips.forEach((st, k) => {
      ctx.setLineDash([]); ctx.lineWidth = 3.2; ctx.strokeStyle = '#b8323f';
      const strip = () => { const p2 = new Path2D(); for (let t = 0; t <= 10; t++) p2.lineTo(...R(k, t / 10)); for (let t = 10; t >= 0; t--) p2.lineTo(...R(k + 1, t / 10)); p2.closePath(); return p2; };
      if (st.kind === 'wedge') { ctx.fillStyle = 'rgba(224,86,110,.16)'; ctx.fill(strip()); ctx.setLineDash([10, 8]); ctx.beginPath(); for (let t = 0; t <= 10; t++) ctx.lineTo(...R(k, t / 10)); ctx.stroke(); ctx.beginPath(); for (let t = 0; t <= 10; t++) ctx.lineTo(...R(k + 1, t / 10)); ctx.stroke(); }
      if (st.kind === 'pleat') { ctx.fillStyle = 'rgba(60,110,180,.14)'; ctx.fill(strip()); ctx.strokeStyle = '#2f5f9f'; ctx.beginPath(); for (let t = 0; t <= 10; t++) ctx.lineTo(...R(k, t / 10)); ctx.stroke(); ctx.setLineDash([8, 6]); ctx.beginPath(); for (let t = 0; t <= 10; t++) ctx.lineTo(...R(k + 1, t / 10)); ctx.stroke(); }
      if (st.kind === 'ease') { ctx.fillStyle = 'rgba(90,150,80,.14)'; ctx.fill(strip()); ctx.strokeStyle = '#3f7a4a'; ctx.setLineDash([4, 6]); const a = R(k, 0.03), b = R(k + 1, 0.03); ctx.beginPath(); ctx.moveTo(...a); ctx.lineTo(...b); ctx.stroke(); }
      if (st.kind === 'dart') { const a = this.toScreen(panel.ribs[k].top), t = this.toScreen(panel.ribs[k].knee), b = this.toScreen(panel.ribs[k + 1].top); ctx.fillStyle = 'rgba(184,50,63,.18)'; ctx.beginPath(); ctx.moveTo(...a); ctx.lineTo(...t); ctx.lineTo(...b); ctx.closePath(); ctx.fill(); ctx.stroke(); }
    });
    ctx.setLineDash([]);
    // (the grain arrow, with a handle to turn it by)
    const ga = this.grainArrow(panel, r.grain), ta = this.toScreen(ga.tail), tb = this.toScreen(ga.tip);
    ctx.strokeStyle = '#3b2f24'; ctx.lineWidth = 3.4; ctx.beginPath(); ctx.moveTo(...ta); ctx.lineTo(...tb);
    for (const [p, q] of [[tb, ta], [ta, tb]]) { const an = Math.atan2(p[1] - q[1], p[0] - q[0]); ctx.moveTo(p[0], p[1]); ctx.lineTo(p[0] - Math.cos(an - 0.45) * 18, p[1] - Math.sin(an - 0.45) * 18); ctx.moveTo(p[0], p[1]); ctx.lineTo(p[0] - Math.cos(an + 0.45) * 18, p[1] - Math.sin(an + 0.45) * 18); }
    ctx.stroke();
    if (this.tool === 'hand') { ctx.fillStyle = 'rgba(59,47,36,.85)'; ctx.beginPath(); ctx.arc(tb[0], tb[1], 11, 0, 7); ctx.fill(); }
    // (what it is, and a move that did nothing)
    ctx.font = '700 26px ui-rounded, system-ui, sans-serif'; ctx.fillStyle = '#5b4a36'; ctx.textAlign = 'left';
    ctx.fillText(`${r.panels === 1 ? 'the skirt' : `one panel · cut ${r.panels}`} · ${r.length} cm${r.grain > 2 ? ` · ${r.grain}° off the grain` : ''}`, 24, H - 24);
    if (ok.some((x) => !x)) { ctx.fillStyle = '#b8323f'; ctx.textAlign = 'right'; ctx.fillText('a move did nothing here', W - 24, H - 24); }
    ctx.textAlign = 'left';
  }
}

/** a move in a few words, for its chip in the history */
export function moveWords(m: Move): string {
  if (m.kind === 'spread') return `✂ spread ${m.open.toFixed(m.open < 10 ? 1 : 0)} cm`;
  if (m.kind === 'pleat') return `fold ${(m.depth * 2).toFixed(1)} cm`;
  if (m.kind === 'gather') return `gather +${m.add.toFixed(1)} cm`;
  if (m.kind === 'close-dart') return 'dart → flare';
  return 'dart → gathers';
}
