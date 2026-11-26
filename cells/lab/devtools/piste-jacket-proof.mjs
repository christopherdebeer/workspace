// Piste's jacket proved before it's fitted (node cells/lab/devtools/piste-jacket-proof.mjs): its pattern drafted from the
// athlete (look/draft.ts) checked on the paper and sewn up in the air (look/proof.ts). Every line should say ok.
import { build } from 'esbuild';
const lab = new URL('../client/piste/', import.meta.url).pathname;
const out = await build({ stdin: { contents: `export * from './look/draft'; export * from './look/proof'; export * from './fencer'; export * from './weapons';`, resolveDir: lab, loader: 'ts' }, bundle: true, write: false, format: 'esm', platform: 'node', logLevel: 'error' });
const M = await import('data:text/javascript;base64,' + Buffer.from(out.outputFiles[0].text).toString('base64'));
const f = new M.Fencer(M.EPEE, 0, 1); f.pose(); const c = f.capsules, F = f.frame;
const B = { caps: c.filter((_, i) => i !== 2 && i !== 6), trunk: [c[0], c[1], c[3], c[15], c[16]], bodyCaps: [c[0], c[1], c[3], c[15], c[16], c[9], c[11]], sleeveCaps: c.filter((_, i) => i !== 2 && i !== 6), pelvis: c[0].a, f: F.f, r: F.r, up: [0, 1, 0], shoulder: f.shoulder, rearShoulder: c[7].a, armW: [f.shoulder, f.elbow, f.hand.map((v, k) => v + (f.elbow[k] - f.hand[k]) * 0.3)], armR: [c[7].a, c[7].b, c[8].b] };
const P = process.argv[2] ? JSON.parse((await import('node:fs')).readFileSync(process.argv[2], 'utf8')) : M.draftJacket(B);
const G = M.meshJacket(P, B);
let fails = 0;
const show = (title, list) => { console.log(`\n${title}`); for (const k of list) { if (!k.ok) fails++; console.log(`${k.ok ? 'ok  ' : 'FAIL'}  ${k.what} — ${k.detail}`); } };
show('on the paper', M.paperChecks(G, { capEase: P.capEase }));
show('sewn up in the air', M.airChecks(G).checks);
console.log(fails ? `\n${fails} failed` : '\nall proved');
