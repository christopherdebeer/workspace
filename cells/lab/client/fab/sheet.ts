/**
 * The pattern: a garment's pieces laid flat on pattern paper as a dressmaker draws them, each once with how many to cut
 * (a skirt's panels, a pair of sleeves); on each its grain line (the arrow that's laid along the cloth's threads), its
 * marks (darts, pleat lines, where it's gathered, buttons), its stitching just in from the edge; the print laid on it as
 * it'll be cut, running with the grain. Below, the notes the cut made and the pattern's own checks.
 *
 * `mini`: the little card on the bench, pieces only. No print (`null`): the pieces as plain tissue.
 */
import { makePrint, type Print } from './fabric';
import { outline, type P2, type Piece } from './edges';
import type { Garment } from './garment';

const css = (c: [number, number, number]) => `rgb(${Math.round(c[0] * 255)},${Math.round(c[1] * 255)},${Math.round(c[2] * 255)})`;
/** the print as a tile, `px` pixels to the centimetre (as the cloth's shader draws it, near enough) */
export function tile(ctx: CanvasRenderingContext2D, pr: Print, px: number): CanvasPattern | string {
  const [g, a, b] = pr.ink.map(css), s = pr.scale * px;
  if (pr.kind === 0) return g;
  const size = pr.kind === 1 ? 3.2 : pr.kind === 2 ? 5.2 : pr.kind === 3 ? 5.6 : pr.kind === 4 ? 8.4 : 8;
  const t = document.createElement('canvas'), n = Math.max(4, Math.round(size * s));
  t.width = t.height = n;
  const c = t.getContext('2d')!, k = n / size;
  c.fillStyle = g; c.fillRect(0, 0, n, n);
  if (pr.kind === 1) { c.fillStyle = a; c.fillRect(0, 0, n * 0.34, n); c.fillStyle = b; c.fillRect(n * 0.63, 0, n * 0.08, n); }
  if (pr.kind === 2) { c.globalAlpha = 0.45; c.fillStyle = a; c.fillRect(0, 0, n / 2, n); c.fillRect(0, 0, n, n / 2); c.globalAlpha = 1; c.fillRect(0, 0, n / 2, n / 2); }
  const dots = (shape: (x: number, y: number) => void) => { c.fillStyle = a; for (const [x, y] of [[0.25, 0.25], [0.75, 0.75]]) shape(x * n, y * n); };
  if (pr.kind === 3) dots((x, y) => { c.beginPath(); c.arc(x, y, 0.56 * k, 0, 7); c.fill(); });
  if (pr.kind === 4) dots((x, y) => {
    for (let p = 0; p < 5; p++) { const an = (p / 5) * Math.PI * 2; c.beginPath(); c.ellipse(x + Math.cos(an) * 0.7 * k, y + Math.sin(an) * 0.7 * k, 0.75 * k, 0.45 * k, an, 0, 7); c.fill(); }
    c.fillStyle = b; c.beginPath(); c.arc(x, y, 0.4 * k, 0, 7); c.fill(); c.fillStyle = a;
  });
  if (pr.kind === 5) dots((x, y) => {
    c.beginPath();
    for (let p = 0; p < 10; p++) { const an = -Math.PI / 2 + (p / 10) * Math.PI * 2, r = (p % 2 ? 0.55 : 1.25) * k; c.lineTo(x + Math.cos(an) * r, y + Math.sin(an) * r); }
    c.fill();
  });
  return ctx.createPattern(t, 'repeat') ?? g;
}

/** where a piece was laid on the sheet: its flat pattern (cm) to the canvas's (css) pixels, and how many to the cm */
export interface Laid { piece: Piece; to: (q: P2) => [number, number]; sc: number }
/** `width`: lay the pieces out in a column this wide (css px), centred; `bare`: no title, notes or checks (on the
 * cutting table, where the pieces are what's worked) */
export function drawSheet(cv: HTMLCanvasElement, g: Garment, pr: Print | null = makePrint(0, 0), mini = false, opts: { width?: number; bare?: boolean } = {}): Laid[] {
  const dpr = Math.min(2, devicePixelRatio || 1), W = cv.clientWidth, H = cv.clientHeight;
  if (!W || !H) return [];
  cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
  const ctx = cv.getContext('2d')!;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  if (mini) ctx.clearRect(0, 0, W, H); else { ctx.fillStyle = '#f4efe2'; ctx.fillRect(0, 0, W, H); }
  const shown = g.pieces.filter((p) => p.drawn !== false && (p.nu > 1 || p.nv > 1));
  const bare = !!opts.bare, LW = Math.min(W, opts.width ?? W), head = mini ? 6 : bare ? 24 : 104, foot = mini ? 6 : bare ? 16 : Math.min(190, H * 0.38);
  if (!mini && !bare) { ctx.fillStyle = '#5b4a36'; ctx.font = '800 15px ui-rounded, system-ui, sans-serif'; ctx.fillText('the pattern', 14, 96); }
  const outs = shown.map(outline), boxes = outs.map((o) => {
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (const [x, y] of o) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
    return { x0, x1, y0, y1, w: x1 - x0, h: y1 - y0 };
  });
  // (laid out as on a cutting table: the biggest first, in rows across the paper, at the largest scale they all fit)
  const gap = 4, order = shown.map((_, k) => k).sort((a, b) => boxes[b].h * boxes[b].w - boxes[a].h * boxes[a].w);
  const pack = (sc: number) => {
    const maxW = (LW - 24) / sc, at: Array<[number, number]> = new Array(shown.length);
    let x = 0, y = 0, rowH = 0;
    for (const k of order) {
      const b = boxes[k];
      if (x > 0 && x + b.w > maxW) { x = 0; y += rowH + gap; rowH = 0; }
      at[k] = [x, y]; x += b.w + gap; rowH = Math.max(rowH, b.h);
    }
    return { at, h: y + rowH };
  };
  let lo = 0.2, hi = 30;
  for (let k = 0; k < 30; k++) { const m = (lo + hi) / 2; if (pack(m).h * m <= H - head - foot - 10 && boxes.every((b) => b.w * m <= LW - 24)) lo = m; else hi = m; }
  const sc = lo, { at } = pack(sc), oy = head + 4, used = Math.max(...shown.map((_, k) => at[k][0] + boxes[k].w)) * sc, ox0 = (W - used) / 2;
  // (the paper's centimetre grid)
  ctx.lineWidth = 1;
  for (let cm = 0; cm * sc < Math.max(W, H); cm++) {
    // (none on the little card: it's pinned on squared paper already)
    if (mini) break;
    ctx.strokeStyle = cm % 5 ? 'rgba(120,150,170,.12)' : 'rgba(120,150,170,.28)';
    ctx.beginPath(); ctx.moveTo(12 + cm * sc, 0); ctx.lineTo(12 + cm * sc, H); ctx.moveTo(0, oy + cm * sc); ctx.lineTo(W, oy + cm * sc); ctx.stroke();
  }
  // (no print: the pieces as plain tissue)
  const fill = pr ? tile(ctx, pr, sc) : '#fffcf4', laid: Laid[] = [];
  shown.forEach((p, k) => {
    const b = boxes[k], ox = ox0 + at[k][0] * sc, py = oy + at[k][1] * sc;
    const to = (q: P2): [number, number] => [ox + (q[0] - b.x0) * sc, py + (b.y1 - q[1]) * sc];
    laid.push({ piece: p, to, sc });
    const path = new Path2D(); outs[k].forEach((q, i) => { const [sx, sy] = to(q); if (i) path.lineTo(sx, sy); else path.moveTo(sx, sy); }); path.closePath();
    ctx.save();
    // (the print, on the grain: turned with it)
    if (typeof fill !== 'string') { const [cx, cy] = to([0, 0]), gr = p.grain; fill.setTransform(new DOMMatrix([Math.cos(-gr), Math.sin(-gr), -Math.sin(-gr), Math.cos(-gr), cx, cy])); }
    ctx.fillStyle = fill; ctx.globalAlpha = pr ? 0.85 : 1; ctx.fill(path); ctx.globalAlpha = 1;
    ctx.strokeStyle = '#3b2f24'; ctx.lineWidth = mini ? 1.2 : 1.8; ctx.stroke(path);
    ctx.clip(path); ctx.setLineDash([4, 3]); ctx.strokeStyle = 'rgba(40,30,20,.5)'; ctx.lineWidth = Math.max(1, 1.6 * sc); ctx.stroke(path);
    ctx.restore();
    marks(ctx, p, to, mini);
    // (the grain line: a long arrow along the threads)
    const c0 = p.flat(0.5, 0.55), gr = p.grain, len = Math.min(b.h, b.w) * 0.32 + 2;
    const dx = -Math.sin(gr), dy = Math.cos(gr), [ax, ay] = to([c0[0] - dx * len, c0[1] - dy * len]), [bx, by] = to([c0[0] + dx * len, c0[1] + dy * len]);
    ctx.strokeStyle = '#3b2f24'; ctx.lineWidth = mini ? 1 : 1.4; ctx.setLineDash([]);
    ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by);
    for (const [px2, py2, sx, sy] of [[bx, by, ax, ay], [ax, ay, bx, by]]) { const an = Math.atan2(py2 - sy, px2 - sx); ctx.moveTo(px2, py2); ctx.lineTo(px2 - Math.cos(an - 0.4) * 7, py2 - Math.sin(an - 0.4) * 7); ctx.moveTo(px2, py2); ctx.lineTo(px2 - Math.cos(an + 0.4) * 7, py2 - Math.sin(an + 0.4) * 7); }
    ctx.stroke();
    if (p.label && !mini) {
      const [cx, cy] = to(p.flat(0.5, p.kind === 'band' ? 0.5 : 0.3));
      ctx.font = `600 ${mini ? 8 : 11}px ui-rounded, system-ui, sans-serif`; ctx.textAlign = 'center';
      const tw = ctx.measureText(p.label).width + 8;
      ctx.fillStyle = 'rgba(255,250,240,.9)'; ctx.fillRect(cx - tw / 2, cy - (mini ? 7 : 9), tw, mini ? 11 : 14);
      ctx.fillStyle = '#3b2f24'; ctx.fillText(p.label, cx, cy + 1); ctx.textAlign = 'left';
    }
  });
  if (mini || bare) return laid;
  // (what the cut needed, and the pattern's checks)
  let y = H - foot + 16;
  ctx.font = '600 12px ui-rounded, system-ui, sans-serif'; ctx.fillStyle = '#5b4a36';
  const pieces = g.pieces.filter((p) => p.nu > 1 || p.nv > 1).length;
  // (seams counted where they're sewn edge to edge; a skirt's own side seams are its paper's)
  const seams = g.seams.length + (g.skirt?.m.panels ?? 0);
  ctx.fillText(`${pieces} piece${pieces === 1 ? '' : 's'} · ${(g.m.area * 1e4).toFixed(0)} cm² of cloth · ${seams} seam${seams === 1 ? '' : 's'}`, 14, y); y += 17;
  if (g.notes.length) {
    // (the notes, wrapped)
    let line = '';
    for (const w of g.notes.join(' · ').split(' ')) { if (ctx.measureText(`${line} ${w}`).width > W - 28 && line) { ctx.fillText(line, 14, y); y += 15; line = w; } else line = line ? `${line} ${w}` : w; }
    if (line) { ctx.fillText(line, 14, y); y += 19; }
  }
  // (the checks: each one's name, then what it found, cut to fit)
  for (const c of g.checks) {
    if (y > H - 6) break;
    ctx.font = '700 11px ui-rounded, system-ui, sans-serif'; ctx.fillStyle = c.ok ? '#3f7a4a' : '#b8323f';
    const head2 = `${c.ok ? '✓' : '✗'} ${c.name}`; ctx.fillText(head2, 14, y);
    const x = 18 + ctx.measureText(head2).width; ctx.font = '500 11px ui-rounded, system-ui, sans-serif'; ctx.fillStyle = '#7a6a56';
    let t = c.detail; while (t.length > 4 && ctx.measureText(t).width > W - x - 12) t = t.slice(0, -2);
    ctx.fillText(t === c.detail ? t : `${t.trim()}…`, x, y); y += 14;
  }
  return laid;
}

/** a piece's marks: darts (two legs to a point), pleats (the fold line and where it's laid to, and an arrow the way it
 * folds), a slash spread open (its two edges dashed, the wedge between them shaded), gathering (a wavy line), buttons */
function marks(ctx: CanvasRenderingContext2D, p: Piece, to: (q: P2) => [number, number], mini: boolean) {
  ctx.strokeStyle = '#b8323f'; ctx.fillStyle = '#b8323f'; ctx.lineWidth = mini ? 1 : 1.6; ctx.setLineDash([]);
  for (const mk of p.marks ?? []) {
    const q = mk.pts.map(to);
    ctx.beginPath();
    if (mk.kind === 'dart') { ctx.moveTo(...q[0]); ctx.lineTo(...q[1]); ctx.lineTo(...q[2]); }
    else if (mk.kind === 'pleat') {
      ctx.moveTo(...q[0]); ctx.lineTo(...q[1]); ctx.moveTo(...q[3]); ctx.lineTo(...q[2]);
      if (!mini) { const yy = q[0][1] + (q[1][1] - q[0][1]) * 0.45; ctx.moveTo(q[3][0] - 1, yy); ctx.lineTo(q[0][0] + 2, yy); ctx.moveTo(q[0][0] + 6, yy - 3); ctx.lineTo(q[0][0] + 2, yy); ctx.lineTo(q[0][0] + 6, yy + 3); }
    } else if (mk.kind === 'gather') {
      for (let k = 0; k + 1 < q.length; k++) {
        const [x0, y0] = q[k], [x1, y1] = q[k + 1], n = Math.max(2, Math.round(Math.hypot(x1 - x0, y1 - y0) / 5));
        for (let i = 0; i <= n * 4; i++) { const t = i / (n * 4), x = x0 + (x1 - x0) * t, y = y0 + (y1 - y0) * t + Math.sin(t * n * Math.PI * 2) * 2; if (i || k) ctx.lineTo(x, y); else ctx.moveTo(x, y); }
      }
    } else if (mk.kind === 'wedge') {
      const half = q.length / 2, path = new Path2D();
      q.forEach((pt, i) => (i ? path.lineTo(...pt) : path.moveTo(...pt))); path.closePath();
      ctx.fillStyle = 'rgba(184,50,63,.12)'; ctx.fill(path); ctx.setLineDash([5, 4]); ctx.strokeStyle = 'rgba(184,50,63,.7)';
      q.slice(0, half).forEach((pt, i) => (i ? ctx.lineTo(...pt) : ctx.moveTo(...pt)));
      q.slice(half).forEach((pt, i) => (i ? ctx.lineTo(...pt) : ctx.moveTo(...pt)));
      ctx.stroke(); ctx.setLineDash([]); ctx.strokeStyle = '#b8323f'; ctx.fillStyle = '#b8323f'; ctx.beginPath();
    } else if (mk.kind === 'button') { for (const [x, y] of q) { ctx.moveTo(x + 3.2, y); ctx.arc(x, y, 3.2, 0, 7); } }
    ctx.stroke();
  }
}
