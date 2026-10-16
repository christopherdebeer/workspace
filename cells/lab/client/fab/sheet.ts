/**
 * The pattern sheet: a garment's pieces laid out flat as they'd be cut, on its own cloth, each with its name, its
 * cutting line, and its stitching just inside (the same stitching that's on it on the figure). Packed in rows,
 * biggest first, and scaled to the sheet.
 */
import type { Print } from './fabric';
import type { Garment, Piece } from './pattern';

/** a piece's outline on the flat (centimetres, y up as drawn): along its top, down its right, back along its foot, up its left */
function outline(p: Piece): Array<[number, number]> {
  const o: Array<[number, number]> = [];
  for (let i = 0; i <= p.nu; i++) o.push(p.flat(i / p.nu, 0));
  for (let j = 1; j <= p.nv; j++) o.push(p.flat(1, j / p.nv));
  for (let i = p.nu - 1; i >= 0; i--) o.push(p.flat(i / p.nu, 1));
  for (let j = p.nv - 1; j > 0; j--) o.push(p.flat(0, j / p.nv));
  return o;
}

const css = (c: [number, number, number]) => `rgb(${Math.round(c[0] * 255)},${Math.round(c[1] * 255)},${Math.round(c[2] * 255)})`;
/** the print as a tile, `px` pixels to the centimetre (as the cloth's shader draws it, near enough) */
function tile(ctx: CanvasRenderingContext2D, pr: Print, px: number): CanvasPattern | string {
  const [g, a, b] = pr.ink.map(css), s = pr.scale * px;
  if (pr.kind === 0) return g;
  const size = pr.kind === 1 ? 3.2 : pr.kind === 2 ? 5.2 : pr.kind === 3 ? 5.6 : pr.kind === 4 ? 8.4 : 8;
  const t = document.createElement('canvas'), n = Math.max(4, Math.round(size * s));
  t.width = t.height = n;
  const c = t.getContext('2d')!, k = n / size;
  c.fillStyle = g; c.fillRect(0, 0, n, n);
  if (pr.kind === 1) { c.fillStyle = a; c.fillRect(0, 0, n * 0.34, n); c.fillStyle = b; c.fillRect(n * 0.63, 0, n * 0.08, n); }
  if (pr.kind === 2) {
    c.globalAlpha = 0.45; c.fillStyle = a; c.fillRect(0, 0, n / 2, n); c.fillRect(0, 0, n, n / 2);
    c.globalAlpha = 1; c.fillRect(0, 0, n / 2, n / 2);
  }
  const dots = (r: number, col: string, shape: (x: number, y: number) => void) => { c.fillStyle = col; for (const [x, y] of [[0.25, 0.25], [0.75, 0.75]]) { shape(x * n, y * n); } void r; };
  if (pr.kind === 3) dots(0.2, a, (x, y) => { c.beginPath(); c.arc(x, y, 0.2 * 2.8 * k, 0, 7); c.fill(); });
  if (pr.kind === 4) dots(0, a, (x, y) => {
    for (let p = 0; p < 5; p++) { const an = (p / 5) * Math.PI * 2; c.beginPath(); c.ellipse(x + Math.cos(an) * 0.7 * k, y + Math.sin(an) * 0.7 * k, 0.75 * k, 0.45 * k, an, 0, 7); c.fill(); }
    c.fillStyle = b; c.beginPath(); c.arc(x, y, 0.4 * k, 0, 7); c.fill(); c.fillStyle = a;
  });
  if (pr.kind === 5) dots(0, a, (x, y) => {
    c.beginPath();
    for (let p = 0; p < 10; p++) { const an = -Math.PI / 2 + (p / 10) * Math.PI * 2, r = (p % 2 ? 0.55 : 1.25) * k; c.lineTo(x + Math.cos(an) * r, y + Math.sin(an) * r); }
    c.fill();
  });
  return ctx.createPattern(t, 'repeat') ?? g;
}

export function drawSheet(cv: HTMLCanvasElement, g: Garment | null, pr: Print | null, title: string) {
  const dpr = Math.min(2, devicePixelRatio || 1), W = cv.clientWidth, H = cv.clientHeight;
  cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
  const ctx = cv.getContext('2d')!;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  // (pattern paper: pale, a centimetre grid, every fifth line darker)
  ctx.fillStyle = '#f4efe2'; ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = '#5b4a36'; ctx.font = '600 13px ui-rounded, system-ui, sans-serif'; ctx.fillText(title, 14, 22);
  if (!g || !pr) return;
  const outs = g.pieces.map(outline), boxes = outs.map((o) => {
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (const [x, y] of o) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
    return { x0, x1, y0, y1, w: x1 - x0, h: y1 - y0 };
  });
  // (rows, biggest first, packed to a width that keeps the sheet's shape)
  const order = boxes.map((b, k) => k).sort((a, b) => boxes[b].h - boxes[a].h), gap = 4;
  const area = boxes.reduce((s, b) => s + (b.w + gap) * (b.h + gap), 0), rowW = Math.max(...boxes.map((b) => b.w + gap), Math.sqrt(area * (W / (H - 34))) * 1.05);
  const at: Array<[number, number]> = []; let x = 0, y = 0, rowH = 0, usedW = 0;
  for (const k of order) {
    const b = boxes[k];
    if (x > 0 && x + b.w > rowW) { x = 0; y += rowH + gap; rowH = 0; }
    at[k] = [x, y]; x += b.w + gap; rowH = Math.max(rowH, b.h); usedW = Math.max(usedW, x);
  }
  const usedH = y + rowH, sc = Math.min((W - 24) / usedW, (H - 44) / usedH), ox = 12 + (W - 24 - usedW * sc) / 2, oy = 34;
  // (the grid, at this scale)
  ctx.lineWidth = 1;
  for (let cm = 0; cm * sc < Math.max(W, H); cm++) {
    ctx.strokeStyle = cm % 5 ? 'rgba(120,150,170,.13)' : 'rgba(120,150,170,.3)';
    ctx.beginPath(); ctx.moveTo(ox + cm * sc, 0); ctx.lineTo(ox + cm * sc, H); ctx.moveTo(0, oy + cm * sc); ctx.lineTo(W, oy + cm * sc); ctx.stroke();
  }
  const fill = tile(ctx, pr, sc);
  g.pieces.forEach((p, k) => {
    const b = boxes[k], [px, py] = at[k], to = (q: [number, number]): [number, number] => [ox + (px + q[0] - b.x0) * sc, oy + (py + (b.y1 - q[1])) * sc];
    const path = new Path2D(); outs[k].forEach((q, i) => { const [sx, sy] = to(q); if (i) path.lineTo(sx, sy); else path.moveTo(sx, sy); }); path.closePath();
    ctx.save();
    // (the print laid on the piece in its own place, so it runs as it does on the figure)
    if (typeof fill !== 'string') fill.setTransform(new DOMMatrix([1, 0, 0, 1, ox + (px - b.x0) * sc, oy + (py + b.y1) * sc]));
    ctx.fillStyle = fill; ctx.fill(path);
    ctx.strokeStyle = '#3b2f24'; ctx.lineWidth = 1.6; ctx.stroke(path);
    // (its stitching, just inside: a dashed line)
    ctx.clip(path); ctx.setLineDash([4, 3]); ctx.strokeStyle = 'rgba(40,30,20,.55)'; ctx.lineWidth = Math.max(1, 1.6 * sc); ctx.stroke(path);
    ctx.restore();
    const [cx, cy] = to([(b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2]);
    ctx.font = '600 11px ui-rounded, system-ui, sans-serif'; ctx.textAlign = 'center';
    ctx.fillStyle = 'rgba(255,250,240,.85)'; const tw = ctx.measureText(p.name).width + 10; ctx.fillRect(cx - tw / 2, cy - 9, tw, 15);
    ctx.fillStyle = '#3b2f24'; ctx.fillText(p.name, cx, cy + 2); ctx.textAlign = 'left';
  });
}
