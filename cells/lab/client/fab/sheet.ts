/**
 * The pattern: a skirt's pieces laid flat on pattern paper as a dressmaker draws them. One panel (with how many to cut),
 * the waistband; on each its grain line (the arrow that's laid along the cloth's threads), its darts or pleat lines,
 * its stitching just in from the edge; the print laid on it as it'll be cut, running with the grain. Below, the notes
 * the cut made and the pattern's own checks.
 *
 * `mini`: the little card on the bench, pieces only.
 */
import { makePrint, type Print } from './fabric';
import { ribAt } from './cut';
import type { Piece, Skirt } from './pattern';

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

export function drawSheet(cv: HTMLCanvasElement, sk: Skirt, pr: Print = makePrint(0, 0), mini = false) {
  const dpr = Math.min(2, devicePixelRatio || 1), W = cv.clientWidth, H = cv.clientHeight;
  if (!W || !H) return;
  cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
  const ctx = cv.getContext('2d')!;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = '#f4efe2'; ctx.fillRect(0, 0, W, H);
  const n = sk.m.panels, shown = [sk.pieces[0], sk.pieces[sk.pieces.length - 1]];
  const label = (p: Piece) => (p.kind === 'band' ? 'waistband · cut 1' : n === 1 ? 'skirt · cut 1' : `${n === 2 ? 'front & back' : 'panel'} · cut ${n}`);
  const head = mini ? 6 : 104, foot = mini ? 6 : Math.min(170, H * 0.36);
  if (!mini) { ctx.fillStyle = '#5b4a36'; ctx.font = '800 15px ui-rounded, system-ui, sans-serif'; ctx.fillText('the pattern', 14, 96); }
  const outs = shown.map(outline), boxes = outs.map((o) => {
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (const [x, y] of o) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
    return { x0, x1, y0, y1, w: x1 - x0, h: y1 - y0 };
  });
  // (the panel above, the band under it, both centred)
  const gap = 5, usedW = Math.max(boxes[0].w, boxes[1].w), usedH = boxes[0].h + gap + boxes[1].h;
  const sc = Math.min((W - 24) / usedW, (H - head - foot - 10) / usedH), oy = head + 4;
  // (the paper's centimetre grid)
  ctx.lineWidth = 1;
  for (let cm = 0; cm * sc < Math.max(W, H); cm++) {
    ctx.strokeStyle = cm % 5 ? 'rgba(120,150,170,.12)' : 'rgba(120,150,170,.28)';
    ctx.beginPath(); ctx.moveTo(12 + cm * sc, 0); ctx.lineTo(12 + cm * sc, H); ctx.moveTo(0, oy + cm * sc); ctx.lineTo(W, oy + cm * sc); ctx.stroke();
  }
  const fill = tile(ctx, pr, sc);
  let top = oy;
  shown.forEach((p, k) => {
    const b = boxes[k], ox = (W - b.w * sc) / 2, py = top;
    const to = (q: [number, number]): [number, number] => [ox + (q[0] - b.x0) * sc, py + (b.y1 - q[1]) * sc];
    const path = new Path2D(); outs[k].forEach((q, i) => { const [sx, sy] = to(q); if (i) path.lineTo(sx, sy); else path.moveTo(sx, sy); }); path.closePath();
    ctx.save();
    // (the print, on the grain: turned with it)
    if (typeof fill !== 'string') { const [cx, cy] = to([0, 0]), g = p.grain; fill.setTransform(new DOMMatrix([Math.cos(-g), Math.sin(-g), -Math.sin(-g), Math.cos(-g), cx, cy])); }
    ctx.fillStyle = fill; ctx.globalAlpha = 0.85; ctx.fill(path); ctx.globalAlpha = 1;
    ctx.strokeStyle = '#3b2f24'; ctx.lineWidth = mini ? 1.2 : 1.8; ctx.stroke(path);
    ctx.clip(path); ctx.setLineDash([4, 3]); ctx.strokeStyle = 'rgba(40,30,20,.5)'; ctx.lineWidth = Math.max(1, 1.6 * sc); ctx.stroke(path);
    ctx.restore();
    // (the marks of how it was made, from the panel's strips: darts, two legs to a point; pleats, the fold and where it's
    // laid, stitched a little way, an arrow the way it folds; a slash spread open, its two edges dashed and the wedge
    // between shaded; gathers, a running stitch along the waist)
    if (p.kind === 'panel') {
      const P = sk.cut, R = (k: number, s: number) => to(ribAt(P.ribs[k], s));
      ctx.lineWidth = mini ? 1 : 1.6;
      P.strips.forEach((st, k) => {
        ctx.setLineDash([]); ctx.strokeStyle = '#b8323f'; ctx.fillStyle = 'rgba(184,50,63,.12)';
        const L = sk.m.length, top = (q: number) => to(P.ribs[q].top), knee = (q: number) => to(P.ribs[q].knee);
        if (st.kind === 'dart') { ctx.beginPath(); ctx.moveTo(...top(k)); ctx.lineTo(...knee(k)); ctx.lineTo(...top(k + 1)); ctx.stroke(); }
        if (st.kind === 'pleat') {
          const s1 = Math.min(1, (st.stitch ?? 0) / L);
          ctx.beginPath(); ctx.moveTo(...R(k, 0)); ctx.lineTo(...R(k, s1)); ctx.moveTo(...R(k + 1, 0)); ctx.lineTo(...R(k + 1, s1)); ctx.stroke();
          if (!mini) { const a = R(k, s1 * 0.45), b = R(k + 1, s1 * 0.45); ctx.beginPath(); ctx.moveTo(b[0] - 1, b[1]); ctx.lineTo(a[0] + 2, a[1]); ctx.moveTo(a[0] + 6, a[1] - 3); ctx.lineTo(a[0] + 2, a[1]); ctx.lineTo(a[0] + 6, a[1] + 3); ctx.stroke(); }
        }
        if (st.kind === 'wedge') {
          const path = new Path2D(); for (let i = 0; i <= 8; i++) path.lineTo(...R(k, i / 8)); for (let i = 8; i >= 0; i--) path.lineTo(...R(k + 1, i / 8)); path.closePath();
          ctx.fill(path); ctx.setLineDash([5, 4]); ctx.strokeStyle = 'rgba(184,50,63,.7)';
          ctx.beginPath(); for (let i = 0; i <= 8; i++) ctx.lineTo(...R(k, i / 8)); ctx.stroke();
          ctx.beginPath(); for (let i = 0; i <= 8; i++) ctx.lineTo(...R(k + 1, i / 8)); ctx.stroke();
        }
        if (st.kind === 'ease') {
          ctx.setLineDash([2, 3]); ctx.beginPath();
          const a = R(k, 0.02), b = R(k + 1, 0.02); ctx.moveTo(a[0], a[1] + 3); ctx.lineTo(b[0], b[1] + 3); ctx.stroke();
          ctx.fillStyle = 'rgba(184,50,63,.08)'; const path = new Path2D(); for (let i = 0; i <= 8; i++) path.lineTo(...R(k, i / 8)); for (let i = 8; i >= 0; i--) path.lineTo(...R(k + 1, i / 8)); path.closePath(); ctx.fill(path);
        }
      });
      ctx.setLineDash([]);
    }
    // (the grain line: a long arrow along the threads)
    const c0 = p.kind === 'band' ? p.flat(0.5, 0.5) : p.flat(0.5, 0.55), g = p.grain, len = Math.min(b.h, b.w) * 0.32 + 2;
    const dx = -Math.sin(g), dy = Math.cos(g), [ax, ay] = to([c0[0] - dx * len, c0[1] - dy * len]), [bx, by] = to([c0[0] + dx * len, c0[1] + dy * len]);
    ctx.strokeStyle = '#3b2f24'; ctx.lineWidth = mini ? 1 : 1.4; ctx.setLineDash([]);
    ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by);
    for (const [px2, py2, sx, sy] of [[bx, by, ax, ay], [ax, ay, bx, by]]) { const an = Math.atan2(py2 - sy, px2 - sx); ctx.moveTo(px2, py2); ctx.lineTo(px2 - Math.cos(an - 0.4) * 7, py2 - Math.sin(an - 0.4) * 7); ctx.moveTo(px2, py2); ctx.lineTo(px2 - Math.cos(an + 0.4) * 7, py2 - Math.sin(an + 0.4) * 7); }
    ctx.stroke();
    if (!mini || p.kind === 'panel') {
      const [cx, cy] = to(p.kind === 'band' ? p.flat(0.5, 0.5) : p.flat(0.5, 0.2));
      ctx.font = `600 ${mini ? 9 : 12}px ui-rounded, system-ui, sans-serif`; ctx.textAlign = 'center';
      const tw = ctx.measureText(label(p)).width + 10;
      ctx.fillStyle = 'rgba(255,250,240,.9)'; ctx.fillRect(cx - tw / 2, cy - (mini ? 7 : 10), tw, mini ? 12 : 16);
      ctx.fillStyle = '#3b2f24'; ctx.fillText(label(p), cx, cy + (mini ? 2 : 2)); ctx.textAlign = 'left';
    }
    top += b.h * sc + gap * sc;
  });
  if (mini) return;
  // (what the cut needed, and the pattern's checks)
  let y = H - foot + 16;
  ctx.font = '600 12px ui-rounded, system-ui, sans-serif'; ctx.fillStyle = '#5b4a36';
  const m = sk.m;
  ctx.fillText(`${m.length.toFixed(0)} cm long · hem ${m.hem.toFixed(0)} cm round · ${(m.area * 1e4).toFixed(0)} cm² of cloth`, 14, y); y += 17;
  if (sk.notes.length) { ctx.fillText(sk.notes.join(' · '), 14, y); y += 19; }
  // (the checks: each one's name, then what it found, cut to fit)
  for (const c of sk.checks) {
    ctx.font = '700 11px ui-rounded, system-ui, sans-serif'; ctx.fillStyle = c.ok ? '#3f7a4a' : '#b8323f';
    const head2 = `${c.ok ? '✓' : '✗'} ${c.name}`; ctx.fillText(head2, 14, y);
    const x = 18 + ctx.measureText(head2).width; ctx.font = '500 11px ui-rounded, system-ui, sans-serif'; ctx.fillStyle = '#7a6a56';
    let t = c.detail; while (t.length > 4 && ctx.measureText(t).width > W - x - 12) t = t.slice(0, -2);
    ctx.fillText(t === c.detail ? t : `${t.trim()}…`, x, y); y += 15;
  }
}
