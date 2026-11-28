// Piste's kit as its pattern and sewn up off the figure (node cells/lab/devtools/piste-kit-pattern.mjs): the jacket's
// pieces and the breeches' (as fitted: client/piste/look/*-pattern.json, else drafted from the undressed body) laid flat
// on paper, each seam's edges in its own colour; then sewn up in the air (no body, no gravity), from the front and the
// side. Writes devtools/out/kit-pattern.png and kit-sewn.png.
import { build } from 'esbuild';
import { writeFileSync, readFileSync, existsSync } from 'node:fs';
import { chromium } from 'playwright';
const lab = new URL('../client/piste/', import.meta.url).pathname, OUT = new URL('./out/', import.meta.url).pathname;
const out = await build({ stdin: { contents: `export * from './look/draft'; export * from './look/breeches'; export * from './look/settle'; export * from './look/body'; export * from './fencer'; export * from './weapons';`, resolveDir: lab, loader: 'ts' }, bundle: true, write: false, format: 'esm', platform: 'node', logLevel: 'error' });
const M = await import('data:text/javascript;base64,' + Buffer.from(out.outputFiles[0].text).toString('base64'));
const f = new M.Fencer(M.EPEE, 0, 1); f.pose(); const c = f.capsules, F = f.frame;
const B = { caps: c.filter((_, i) => i !== 2 && i !== 6), trunk: [c[0], c[1], c[3], c[15], c[16]], bodyCaps: [c[0], c[1], c[3], c[15], c[16], c[9], c[11]], sleeveCaps: c.filter((_, i) => i !== 2 && i !== 6), pelvis: c[0].a, f: F.f, r: F.r, up: [0, 1, 0], shoulder: f.shoulder, rearShoulder: c[7].a, armW: [f.shoulder, f.elbow, f.hand.map((v, k) => v + (f.elbow[k] - f.hand[k]) * 0.3)], armR: [c[7].a, c[7].b, c[8].b] };
const bare = M.bareBody(f);
const tf = M.bodyField({ parts: bare.parts.filter((p) => p.name === 'trunk' || p.name.startsWith('thigh')) }, [F.o[0] - 0.4, 0.45, -0.4], [F.o[0] + 0.4, 1.7, 0.4], 0.012);
B.dist = (p) => tf.at(p).d;
const load = (name) => { const p = new URL(`../client/piste/look/${name}`, import.meta.url); return existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : null; };
const PJ = load('jacket-pattern.json') ?? M.draftJacket(B), PB = load('breeches-pattern.json') ?? M.draftBreeches(f, bare);
const garments = [['jacket', M.meshJacket(PJ, B)], ['breeches', M.meshBreeches(PB, f, bare)]];
const hue = (s) => { let h = 0; for (const ch of s) h = (h * 31 + ch.charCodeAt(0)) % 360; return h; };

// ── the pattern: each piece flat, outlined, its seam edges coloured, laid out in rows ──
{
  const S = 900, gap = 0.04; let x = 0.02, y = 0.02, rowH = 0, svg = [];
  const cmToPx = S;   // (1 m = 900 px)
  for (const [gname, G] of garments) {
    const seamOf = new Map(); for (const st of G.stitches) { seamOf.set(st.p, st.seam); seamOf.set(st.q, seamOf.get(st.q) ?? st.seam); }
    for (const pc of G.pieces) {
      const pts = Array.from({ length: pc.rows * pc.cols }, (_, k) => G.flat[pc.base + k]);
      const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]), x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys), w = x1 - x0, h = y1 - y0;
      if (x + w > 2.2) { x = 0.02; y += rowH + gap + 0.03; rowH = 0; }
      const P = (k) => { const p = pts[k]; return [(x + p[0] - x0) * cmToPx, (y + (y1 - p[1])) * cmToPx]; };
      const id = (r, cc) => r * pc.cols + cc;
      // (the grid, faint: its rows and columns, the grain)
      for (let r = 0; r < pc.rows; r += 2) svg.push(`<polyline fill="none" stroke="#ccc" stroke-width="0.5" points="${Array.from({ length: pc.cols }, (_, cc) => P(id(r, cc)).join(',')).join(' ')}"/>`);
      // (the outline: each edge segment coloured by its seam, grey where it's a raw edge)
      const edge = [];
      for (let cc = 0; cc < pc.cols; cc++) edge.push(id(0, cc));
      for (let r = 1; r < pc.rows; r++) edge.push(id(r, pc.cols - 1));
      for (let cc = pc.cols - 2; cc >= 0; cc--) edge.push(id(pc.rows - 1, cc));
      for (let r = pc.rows - 2; r >= 0; r--) edge.push(id(r, 0));
      for (let k = 0; k < edge.length; k++) {
        const a = edge[k], b = edge[(k + 1) % edge.length], sa = seamOf.get(pc.base + a), sb = seamOf.get(pc.base + b);
        const seam = sa && sa === sb ? sa : null;
        svg.push(`<line x1="${P(a)[0]}" y1="${P(a)[1]}" x2="${P(b)[0]}" y2="${P(b)[1]}" stroke="${seam ? `hsl(${hue(seam)},70%,42%)` : '#555'}" stroke-width="${seam ? 2.4 : 1.2}"/>`);
      }
      svg.push(`<text x="${(x + w / 2) * cmToPx}" y="${(y + h / 2) * cmToPx}" font-family="sans-serif" font-size="13" text-anchor="middle" fill="#222">${pc.name}</text>`);
      svg.push(`<text x="${(x + w / 2) * cmToPx}" y="${(y + h / 2) * cmToPx + 15}" font-family="sans-serif" font-size="10" text-anchor="middle" fill="#666">${(w * 100).toFixed(0)} × ${(h * 100).toFixed(0)} cm</text>`);
      x += w + gap; rowH = Math.max(rowH, h);
    }
    x = 0.02; y += rowH + gap + 0.06; rowH = 0;
  }
  // the key: each seam's colour
  const seams = [...new Set(garments.flatMap(([, G]) => G.stitches.map((s) => s.seam)))];
  seams.forEach((s, i) => { const kx = 20 + (i % 6) * 330, ky = y * cmToPx + 20 + Math.floor(i / 6) * 18; svg.push(`<line x1="${kx}" y1="${ky - 4}" x2="${kx + 24}" y2="${ky - 4}" stroke="hsl(${hue(s)},70%,42%)" stroke-width="3"/><text x="${kx + 30}" y="${ky}" font-family="sans-serif" font-size="12">${s}</text>`); });
  const H = Math.ceil(y * cmToPx + 40 + Math.ceil(seams.length / 6) * 18);
  writeFileSync(OUT + 'kit-pattern.svg', `<svg xmlns="http://www.w3.org/2000/svg" width="2000" height="${H}" style="background:#f7f5ee"><rect width="2000" height="${H}" fill="#f7f5ee"/>${svg.join('')}</svg>`);
}

// ── sewn up in the air: no body, no gravity, nothing pinned; front and side ──
{
  const views = [];
  for (const [gname, G] of garments) {
    const S = M.settle(G, [], { seconds: 10, gravity: 0, free: true, passes: 20 }), X = (i) => [S.x[i * 3], S.x[i * 3 + 1], S.x[i * 3 + 2]];
    const tris = []; for (const pc of G.pieces) for (let r = 0; r < pc.rows - 1; r++) for (let cc = 0; cc < pc.cols - 1; cc++) { const a = pc.base + r * pc.cols + cc; tris.push([a, a + 1, a + pc.cols + 1, pc.name], [a, a + pc.cols + 1, a + pc.cols, pc.name]); }
    const cen = [0, 1, 2].map((k) => { let s = 0; for (let i = 0; i < G.n; i++) s += S.x[i * 3 + k]; return s / G.n; });
    for (const [vname, right, fwd] of [['front', F.f, F.r], ['side', [-F.r[0], 0, -F.r[2]], F.f]]) {
      const proj = (p) => { const d = p.map((v, k) => v - cen[k]); return [d[0] * right[0] + d[2] * right[2], -d[1], d[0] * fwd[0] + d[2] * fwd[2]]; };
      const L = [0.4, 0.6, -0.7], polys = tris.map(([a, b, cc, nm]) => {
        const A = X(a), Bp = X(b), C = X(cc), u = Bp.map((v, k) => v - A[k]), w = C.map((v, k) => v - A[k]);
        let n = [u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]]; const ln = Math.hypot(...n) || 1; n = n.map((v) => v / ln);
        const pa = proj(A), pb = proj(Bp), pc2 = proj(C), depth = (pa[2] + pb[2] + pc2[2]) / 3;
        const sh = 0.45 + 0.5 * Math.abs(n[0] * L[0] + n[1] * L[1] + n[2] * L[2]);
        return { depth, pts: [pa, pb, pc2], col: `hsl(${hue(nm)},28%,${Math.round(sh * 85)}%)` };
      }).sort((p, q) => q.depth - p.depth);
      const sc = 620, ox = 360, oy = 500;
      views.push(`<g><text x="20" y="28" font-family="sans-serif" font-size="16">${gname}, sewn in the air: ${vname}</text>${polys.map((p) => `<polygon points="${p.pts.map((q) => `${(ox + q[0] * sc).toFixed(1)},${(oy + q[1] * sc).toFixed(1)}`).join(' ')}" fill="${p.col}" stroke="${p.col}" stroke-width="0.3"/>`).join('')}</g>`);
    }
  }
  const cells = views.map((v, i) => `<svg x="${(i % 4) * 720}" y="0" width="720" height="1000">${v}</svg>`).join('');
  writeFileSync(OUT + 'kit-sewn.svg', `<svg xmlns="http://www.w3.org/2000/svg" width="2880" height="1000"><rect width="2880" height="1000" fill="#f7f5ee"/>${cells}</svg>`);
}
const browser = await chromium.launch({ executablePath: existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined });
for (const name of ['kit-pattern', 'kit-sewn']) {
  const svg = readFileSync(OUT + name + '.svg', 'utf8'), m = svg.match(/width="(\d+)" height="(\d+)"/);
  const page = await browser.newPage({ viewport: { width: Number(m[1]), height: Number(m[2]) } });
  await page.setContent(`<body style="margin:0">${svg}</body>`); await page.screenshot({ path: OUT + name + '.png' }); await page.close();
  console.log(OUT + name + '.png');
}
await browser.close();
