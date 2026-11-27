// Piste's breeches, cut as a tailor cuts them (node cells/lab/devtools/piste-breeches.mjs): drafted from the undressed
// body (client/piste/look/breeches.ts), proved on the paper and sewn up in the air (look/proof.ts), let settle on the
// body in guard (look/settle.ts), measured by panel and band (how stretched across and along, how far off the body), and
// written for the game (static/piste/breeches-draft.json), as devtools/piste-jacket.mjs does the jacket.
import { build } from 'esbuild';
import { writeFileSync } from 'node:fs';
const lab = new URL('../client/piste/', import.meta.url).pathname;
const out = await build({ stdin: { contents: `export * from './look/breeches'; export * from './look/settle'; export * from './look/body'; export * from './look/proof'; export * from './fencer'; export * from './weapons';`, resolveDir: lab, loader: 'ts' }, bundle: true, write: false, format: 'esm', platform: 'node', logLevel: 'error' });
const M = await import('data:text/javascript;base64,' + Buffer.from(out.outputFiles[0].text).toString('base64'));
const f = new M.Fencer(M.EPEE, 0, 1); f.pose(); const F = f.frame;
const bare = M.bareBody(f), lowerParts = { parts: bare.parts.filter((p) => p.name === 'trunk' || p.name.startsWith('thigh') || p.name.startsWith('shin') || p.name.startsWith('foot')) };
const t0 = Date.now(), field = M.bodyField(lowerParts, [F.o[0] - 0.75, 0.0, -0.6], [F.o[0] + 0.75, 1.15, 0.6], 0.012);
console.log(`the body's distance field: ${((Date.now() - t0) / 1000).toFixed(1)} s`);
const P = M.draftBreeches(f, bare);
const cm = (x) => (x * 100).toFixed(1), pct = (x) => `${(x * 100).toFixed(1)}%`;
console.log('measured (cm): ' + Object.entries(P.girth).map(([k, v]) => `${k} ${cm(v)}`).join(', ') + `; inseam ${cm(P.inseam)}, side ${cm(P.side)}`);
const G = M.meshBreeches(P, f, bare);
let fails = 0;
const show = (title, list) => { console.log(`\n${title}`); for (const k of list) { if (!k.ok) fails++; console.log(`${k.ok ? 'ok  ' : 'FAIL'}  ${k.what} — ${k.detail}`); } };
show('on the paper', M.paperChecks(G, { capEase: 0 }).filter((k) => !/cap/.test(k.what)));
show('sewn up in the air', M.airChecks(G).checks.filter((k) => /closes|right side out/.test(k.what)));
const S = M.settle(G, [], { seconds: 8, passes: 16, body: field });
const strain = S.edges.map((e) => Math.hypot(...[0, 1, 2].map((k) => S.x[e.a * 3 + k] - S.x[e.b * 3 + k])) / e.rest - 1);
const q = (a, t) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.min(s.length - 1, Math.floor(t * s.length))] : NaN; };
console.log(`\nsettled on the body: stretch p50 ${pct(q(strain, 0.5))} p90 ${pct(q(strain, 0.9))} p99 ${pct(q(strain, 0.99))}`);
G.pieces.forEach((pc, pi) => {
  console.log(`  ${pc.name}`);
  for (const [nm, r0, r1] of [['waist', 0, 2], ['hips', 3, 7], ['crotch', 8, 12], ['thigh', 13, 19], ['knee', 20, 26], ['band', 27, 29]]) {
    const rowOf = (i) => Math.floor((i - pc.base) / pc.cols), inB = (i) => { const r = rowOf(i); return r >= r0 && r <= r1; };
    const ac = [], al = [], off = [];
    S.edges.forEach((e, k) => { if (e.piece !== pi || !inB(e.a)) return; if (e.dir === 'across') ac.push(strain[k]); if (e.dir === 'along') al.push(strain[k]); });
    for (let i = pc.base; i < pc.base + pc.rows * pc.cols; i++) if (inB(i)) off.push(field.at([S.x[i * 3], S.x[i * 3 + 1], S.x[i * 3 + 2]]).d);
    console.log(`    ${nm.padEnd(7)} across ${pct(q(ac, 0.75)).padStart(6)}  along ${pct(q(al, 0.75)).padStart(6)}  ease ${cm(q(off, 0.5)).padStart(5)} cm`);
  }
});
// written for the game: as the jacket's (devtools/piste-jacket.mjs): points, triangles (each panel's facing out), the
// paper, what's sewn to what (welded: each sewn point follows the points it's sewn to)
{
  const r3 = (v) => Math.round(v * 1000) / 1000, tris = [], uv = [], seam = [];
  const sewnTo = new Map(); for (const st of G.stitches) if (!sewnTo.has(st.p)) sewnTo.set(st.p, st);
  const roots = (i, depth = 0) => { const st = sewnTo.get(i); if (!st || depth > 8) return new Map([[i, 1]]); const m = new Map(); for (const [j, w] of [[st.q, 1 - st.t], [st.q2, st.t]]) if (w > 0) for (const [k2, v] of roots(j, depth + 1)) if (k2 !== i) m.set(k2, (m.get(k2) ?? 0) + v * w); return m.size ? m : new Map([[i, 1]]); };
  const stitches = [];
  for (const p of sewnTo.keys()) { const top = [...roots(p)].sort((a, b) => b[1] - a[1]).slice(0, 2); if (top[0][0] === p) continue; const [qa, wa] = top[0], [qb, wb] = top[1] ?? [qa, 0]; stitches.push([p, qa, qb, Math.round((wb / (wa + wb)) * 1000) / 1000]); }
  const X = S.x.slice(); for (const [p, a, b, t] of stitches) for (let k = 0; k < 3; k++) X[3 * p + k] = S.x[3 * a + k] * (1 - t) + S.x[3 * b + k] * t;
  const Xs = (i) => [X[i * 3], X[i * 3 + 1], X[i * 3 + 2]];
  G.pieces.forEach((pc) => {
    let vote = 0;
    for (let r = 0; r < pc.rows - 1; r++) for (let c = 0; c < pc.cols - 1; c++) {
      const a = pc.base + r * pc.cols + c, A = Xs(a), Bp = Xs(a + 1), C = Xs(a + pc.cols + 1), u = Bp.map((v, k) => v - A[k]), w = C.map((v, k) => v - A[k]);
      const nrm = [u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]], mid = A.map((v, k) => (v + Bp[k] + C[k]) / 3);
      vote += Math.sign(nrm.reduce((s2, v, k) => s2 + v * field.at(mid).n[k], 0));
    }
    const outw = vote >= 0;
    for (let r = 0; r < pc.rows - 1; r++) for (let c = 0; c < pc.cols - 1; c++) { const a = pc.base + r * pc.cols + c; if (outw) tris.push(a, a + 1, a + pc.cols + 1, a, a + pc.cols + 1, a + pc.cols); else tris.push(a, a + pc.cols + 1, a + 1, a, a + pc.cols, a + pc.cols + 1); }
    for (let r = 0; r < pc.rows; r++) for (let c = 0; c < pc.cols; c++) {
      const i = pc.base + r * pc.cols + c, p = G.flat[i]; uv.push(r3(Math.abs(p[0])), r3(p[1]));
      const ed = (j) => Math.hypot(p[0] - G.flat[j][0], p[1] - G.flat[j][1]);
      seam.push(r3(Math.min(ed(pc.base + r * pc.cols), ed(pc.base + r * pc.cols + pc.cols - 1))));
    }
  });
  const kneeRow = (M.CROTCH_ROW + (M.BROWS - 1 - M.CROTCH_ROW) * ((P.inseam - 0.07) / P.inseam)) / (M.BROWS - 1);
  const pieces = G.pieces.map((pc) => ({ name: pc.name, kind: 'breeches', base: pc.base, rows: pc.rows, cols: pc.cols, joint: r3(kneeRow), crotch: r3(M.CROTCH_ROW / (M.BROWS - 1)) }));
  writeFileSync(new URL('../static/piste/breeches-draft.json', import.meta.url), JSON.stringify({ x: Array.from(X, r3), tris, uv, seam, pieces, flat: G.flat.flatMap((p) => [r3(p[0]), r3(p[1])]), seams: G.stitches.map((st) => [st.p, st.q]), stitches }));
}
console.log(fails ? `\n${fails} failed` : '\nall proved');
