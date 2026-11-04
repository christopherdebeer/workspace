// A world drawn without a renderer: plain isometric blocks in SVG (the land's columns, stone, stairs as ramps, water,
// paving, piers), and a stroke over it as the hand made it (start ring, end arrow, pauses dotted). Coarse on purpose:
// enough to read what was built and where, at what height, and how much, without WebGL. For the explorer's cases
// (labyrinth-explore.mjs), read blind before and after.
const CW = 26, CH = 13, HH = 15;
const shade = (hex, f) => { const n = parseInt(hex.slice(1), 16), c = [n >> 16, (n >> 8) & 255, n & 255].map((v) => Math.max(0, Math.min(255, Math.round(v * f)))); return `rgb(${c.join(',')})`; };

/** the world `w` around the cells `focus` (and what's built), as SVG; `stroke` cells [[i, j], …] drawn over it */
export function iso(w, { focus = [], stroke = null, rests = [], tap = null, title = '', margin = 3 } = {}) {
  const e = w.extent();
  let i0 = Infinity, i1 = -Infinity, j0 = Infinity, j1 = -Infinity;
  const take = (i, j) => { i0 = Math.min(i0, i); i1 = Math.max(i1, i); j0 = Math.min(j0, j); j1 = Math.max(j1, j); };
  for (const [i, j] of focus) take(i, j);
  if (!focus.length) { take(e.i0, e.j0); take(e.i1, e.j1); }
  i0 = Math.max(e.i0, i0 - margin); i1 = Math.min(e.i1, i1 + margin); j0 = Math.max(e.j0, j0 - margin); j1 = Math.min(e.j1, j1 + margin);
  let top = 0;
  for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) for (let k = Math.max(0, w.ground(i, j)); k < 40; k++) if (w.stone(k, i, j) || w.stair(k, i, j) >= 0 || w.pier(k, i, j) || k < w.ground(i, j)) top = Math.max(top, k + 1);
  const P = (i, j, k) => [(i - j) * CW, (i + j) * CH - k * HH];
  const ox = (j1 - i0 + 1) * CW + 20, oy = top * HH + 40;
  const pt = (i, j, k) => { const [x, y] = P(i, j, k); return `${(x + ox).toFixed(1)},${(y + oy).toFixed(1)}`; };
  const W = (i1 - i0 + j1 - j0 + 2) * CW + 40, H = (i1 - i0 + j1 - j0 + 2) * CH + top * HH + 80;
  const out = [`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}"><rect width="100%" height="100%" fill="#f4efe4"/>`];
  if (title) out.push(`<text x="10" y="18" font-family="monospace" font-size="12" fill="#333">${title.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</text>`);
  // (a box: its top and the two faces toward the eye, shaded as the light falls)
  const box = (i, j, k, h, col) => {
    const t = [pt(i, j, k + h), pt(i + 1, j, k + h), pt(i + 1, j + 1, k + h), pt(i, j + 1, k + h)];
    const l = [pt(i, j + 1, k + h), pt(i + 1, j + 1, k + h), pt(i + 1, j + 1, k), pt(i, j + 1, k)];
    const r = [pt(i + 1, j, k + h), pt(i + 1, j + 1, k + h), pt(i + 1, j + 1, k), pt(i + 1, j, k)];
    out.push(`<polygon points="${l.join(' ')}" fill="${shade(col, 0.72)}" stroke="#6b6355" stroke-width=".4"/><polygon points="${r.join(' ')}" fill="${shade(col, 0.86)}" stroke="#6b6355" stroke-width=".4"/><polygon points="${t.join(' ')}" fill="${col}" stroke="#6b6355" stroke-width=".4"/>`);
  };
  const ramp = (i, j, k, d, col) => {
    // (a stair: a wedge rising toward d (0 +x, 1 +z, 2 −x, 3 −z))
    const c = [[i, j], [i + 1, j], [i + 1, j + 1], [i, j + 1]], hi = [[1, 2], [2, 3], [3, 0], [0, 1]][d];
    const y = (q) => (hi.includes(q) ? k + 1 : k);
    out.push(`<polygon points="${c.map(([a, b], q) => pt(a, b, y(q))).join(' ')}" fill="${col}" stroke="#6b6355" stroke-width=".5"/>`);
  };
  // (painted back to front)
  const cells = [];
  for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) cells.push([i, j]);
  cells.sort((a, b) => a[0] + a[1] - (b[0] + b[1]) || a[0] - b[0]);
  // (the cells under the stroke, tinted on their tops as they're drawn: what's in front hides them, as it should; a line
  // alone, drawn over everything, reads as crossing whatever's painted over its true place)
  const under = new Set((stroke ?? (tap ? [tap] : [])).map(([i, j]) => `${Math.round(i)}.${Math.round(j)}`));
  const tint = (i, j, k) => { if (under.has(`${i}.${j}`)) out.push(`<polygon points="${[pt(i, j, k + 0.02), pt(i + 1, j, k + 0.02), pt(i + 1, j + 1, k + 0.02), pt(i, j + 1, k + 0.02)].join(' ')}" fill="#c0392b" opacity=".35"/>`); };
  for (const [i, j] of cells) {
    const g = w.ground(i, j);
    if (w.land) box(i, j, Math.min(0, g), Math.max(0.15, g - Math.min(0, g)), w.pool(i, j) ? '#8fb7c4' : g >= 3 ? '#cfc6b0' : '#d9d3bf');
    else box(i, j, -0.3, 0.3, '#eadcc0');
    if (w.paved(i, j)) out.push(`<polygon points="${[pt(i + 0.12, j + 0.12, g + 0.01), pt(i + 0.88, j + 0.12, g + 0.01), pt(i + 0.88, j + 0.88, g + 0.01), pt(i + 0.12, j + 0.88, g + 0.01)].join(' ')}" fill="#e8c9a0" stroke="#a88c66" stroke-width=".5"/>`);
    let hi = Math.max(0, g); for (let k = hi; k < 40; k++) if (w.stone(k, i, j) || w.stair(k, i, j) >= 0 || w.pier(k, i, j)) hi = k + 1;
    for (let k = Math.max(0, g); k < hi; k++) {
      if (w.stone(k, i, j)) box(i, j, k, 1, w.archway(k, i, j) >= 0 ? '#c9b48c' : w.wall(k, i, j) >= 0 ? '#bfae8e' : w.laidBy(k, i, j) ? '#d8c39c' : '#e2d3b4');
      else if (w.stair(k, i, j) >= 0) ramp(i, j, k, w.stair(k, i, j), '#e9b979');
      else if (w.pier(k, i, j)) box(i + 0.3, j + 0.3, k, 1, '#c8bca2');
    }
    tint(i, j, Math.max(hi, w.land ? g : 0));
  }
  // (the stroke, over the tops it crossed)
  const surf = (i, j) => { let k = w.ground(i, j); while (w.stone(k, i, j) || w.stair(k, i, j) >= 0) k++; return k; };
  const at = ([i, j], s) => pt(i + 0.5, j + 0.5, s ?? surf(i, j));
  if (stroke?.length) {
    out.push(`<polyline points="${stroke.map((c) => at(c)).join(' ')}" fill="none" stroke="#c0392b" stroke-width="1.5" stroke-linejoin="round" opacity=".6" stroke-dasharray="4 2"/>`);
    const [sx, sy] = at(stroke[0]).split(',').map(Number), [ex, ey] = at(stroke.at(-1)).split(',').map(Number);
    out.push(`<circle cx="${sx}" cy="${sy}" r="5" fill="#fff" stroke="#c0392b" stroke-width="2"/><circle cx="${ex}" cy="${ey}" r="4" fill="#c0392b"/>`);
    for (const r of rests) { const [x, y] = at(r).split(',').map(Number); out.push(`<circle cx="${x}" cy="${y}" r="8" fill="none" stroke="#c0392b" stroke-dasharray="2 2"/>`); }
  }
  if (tap) { const [x, y] = at(tap).split(',').map(Number); out.push(`<circle cx="${x}" cy="${y}" r="6" fill="none" stroke="#c0392b" stroke-width="2"/><circle cx="${x}" cy="${y}" r="2" fill="#c0392b"/>`); }
  out.push('</svg>');
  return out.join('');
}
