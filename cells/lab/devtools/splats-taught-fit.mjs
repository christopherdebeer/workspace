// The brush fitted to a drawn teacher (node cells/lab/devtools/splats-taught-fit.mjs <teacher> [iterations]).
//
// A taught drawing mapped by hand from the teacher's decisions had the strokes and missed the tone: how much the brush
// lays down for a decision was a guess. Here the loop is closed. The composed scene is drawn with a treatment set from
// outside, from the five views the teacher drew other than the right (kept for scoring); what it drew is measured as
// the teacher's drawings are (devtools/splats-taught-measure.py); and each group is adjusted until they match:
// - a stroke group, against its edge: how much of the edge is inked (in excess of the tone round it) sets how much of
//   the stroke is kept; how heavy that ink is, a unit of ink, sets how wide its marks are;
// - a wash group, against its face (or its object's body, or the ground): the tone's peak sets its strength; how much
//   of the face the tone covers (its mean against its peak) sets how far the wash reaches;
// - an edge shows away from the outline as far as the teacher inks interior creases against outline ones;
// - a contact goes with its object's strokes; the ground's lines get nothing.
// The best treatment met is written into client/splats/taughtfit.ts, by group key (`?policy=taught&teacher=<teacher>`).
import { withWood } from './harness.mjs';
import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
process.env.EXPERIMENT = 'splats'; process.env.READY = '__splats';
const teacher = process.argv[2] ?? 'sumi', ITERS = Number(process.argv[3] ?? 10);
const here = (f) => new URL(f, import.meta.url).pathname, dir = here('./out/field/');
const py = (...a) => JSON.parse(execFileSync('python3', [here('./splats-taught-measure.py'), ...a], { env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' }, maxBuffer: 1 << 26 }).toString());
const cams = JSON.parse(readFileSync(`${dir}wires.json`)).filter((w) => w.name !== 'right');
const TAUGHT = JSON.parse(readFileSync(here('../client/splats/taught.ts'), 'utf8').match(/= (\{"entries".*\});\s*$/s)[1]);
const objOf = Object.fromEntries(TAUGHT.entries.map((e) => [e.name, e.obj]));
const target = py('targets', teacher), T = target.entries;
console.log(`${teacher}: interior creases inked ${target.inner} of outline ones`);
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));

await withWood(async (wood) => {
  const page = await wood.open('scene=composed&res=1&clean&look=wash&policy=ranks&detail=1');
  page.on('pageerror', (e) => console.log('page error', e.message));
  await page.waitForFunction(() => window.__splats.scene?.name === 'composed' && window.__splats.drawn > 0, null, { timeout: 180000 });
  const map = await page.evaluate(() => window.__splats.composed.taughtMap());
  // (each group's measures in a set of entries: its own entry's, or its object's average for that kind)
  const kindOf = (m) => (m.cls === 'stroke' ? (n) => 'inkx' in (T[n] ?? {}) && objOf[n] === m.object : (n) => n.startsWith('face') && objOf[n] === m.object);
  const read = (E, m) => {
    if (m.cls === 'ground') return E.ground ?? null;
    if (m.cls === 'body') return E[`body obj${m.object}`] ?? null;
    if (m.cls !== 'stroke' && m.cls !== 'wash') return null;
    if (m.entry && E[m.entry]) return E[m.entry];
    const ns = Object.keys(E).filter(kindOf(m)); if (!ns.length) return null;
    const keys = Object.keys(E[ns[0]]); return Object.fromEntries(keys.map((k) => [k, ns.reduce((a, n) => a + E[n][k], 0) / ns.length]));
  };
  const st = map.map((m) => ({ e: m.cls === 'stroke' ? 0.6 : m.cls === 'none' ? 0 : m.cls === 'contact' ? 0.5 : 0.8, s: m.cls === 'stroke' || m.cls === 'contact' || m.cls === 'none' ? 1 : 1.5, w: m.cls === 'stroke' ? 1.3 : 1, inner: m.role === 'edge' ? target.inner : 0 }));
  const contacts = () => map.forEach((m, i) => { if (m.cls !== 'contact') return; const own = map.map((x, j) => (x.cls === 'stroke' && x.object === m.object ? st[j] : null)).filter(Boolean); if (own.length) { st[i].e = own.reduce((a, x) => a + x.e, 0) / own.length; st[i].w = own.reduce((a, x) => a + x.w, 0) / own.length; } });
  const render = async () => {
    await page.evaluate((t) => window.__splats.composed.setTreatment(t), { e: st.map((x) => x.e), s: st.map((x) => x.s), w: st.map((x) => x.w), inner: st.map((x) => x.inner) });
    const grabs = {};
    for (const c of cams) {
      await page.evaluate((c) => window.__splats.camera({ yaw: c.yaw, pitch: c.pitch, dist: c.dist, target: c.target, fov: c.fov }), c);
      await page.waitForTimeout(1900);
      const g = await page.evaluate(() => { const g = window.__splats.grab(); return { w: g.w, h: g.h, C: g.L.map((L) => Math.max(0, Math.min(1, (0.906 - L) / (0.906 - 0.12)))) }; });
      grabs[c.name] = { w: g.w, h: g.h, C: g.C.map((v) => +v.toFixed(2)) };
    }
    writeFileSync(`${dir}fit-grabs.json`, JSON.stringify(grabs));
    return py('measure', `${dir}fit-grabs.json`).entries;
  };
  const errors = (M) => {
    let a = 0, na = 0, b = 0, nb = 0;
    for (const [n, t] of Object.entries(T)) { const m = M[n]; if (!m) continue; if ('inkx' in t) { a += Math.abs(t.inkx - m.inkx); na++; } else { b += Math.abs(t.mean - m.mean); nb++; } }
    return { ink: a / na, tone: b / nb };
  };
  let best = null;
  for (let it = 0; it <= ITERS; it++) {
    contacts();
    const M = await render(), err = errors(M), score = err.ink + 3 * err.tone;
    console.log(`${String(it).padStart(2)}: ink off by ${err.ink.toFixed(3)}, tone by ${err.tone.toFixed(3)}`);
    if (!best || score < best.score) best = { score, err, st: st.map((x) => ({ ...x })), M };
    if (it === ITERS) break;
    map.forEach((m, i) => {
      const t = read(T, m), g = read(M, m), x = st[i]; if (!t || !g) return;
      if (m.cls === 'stroke') {
        if (t.inkx < 0.03) { x.e = 0; return; }
        x.e = clamp(x.e * ((t.inkx + 0.02) / (g.inkx + 0.02)) ** 0.6, 0.03, 1);
        if (g.inkx > 0.05) x.w = clamp(x.w * (((t.mass + 0.005) / (t.inkx + 0.02)) / ((g.mass + 0.005) / (g.inkx + 0.02))) ** 0.5, 0.5, 3.5);
        if (x.e > 0.999 && g.inkx < t.inkx * 0.85) x.w = Math.min(3.5, x.w * 1.12);
      } else {
        if (t.mean < 0.012) { x.e = 0; return; }
        x.s = clamp(x.s * ((t.peak + 0.03) / (g.peak + 0.03)) ** 0.6, 0.15, 6);
        x.e = clamp(x.e * ((t.mean / (t.peak + 0.03)) / Math.max(0.02, g.mean / (g.peak + 0.03))) ** 0.6, 0.05, 1);
      }
    });
  }
  await page.close();
  // (for looking into a fit: each entry's target beside what the best treatment drew, and each group's state)
  writeFileSync(`${dir}fit-debug-${teacher}.json`, JSON.stringify({ T, M: best.M, groups: map.map((m, i) => ({ ...m, ...best.st[i] })) }));
  const f = here('../client/splats/taughtfit.ts'), all = JSON.parse(readFileSync(f, 'utf8').match(/= (\{.*\});\s*$/s)[1]);
  const r3 = (v) => +v.toFixed(3);
  all[teacher] = { keys: map.map((m) => m.key), e: best.st.map((x) => r3(x.e)), s: best.st.map((x) => r3(x.s)), w: best.st.map((x) => r3(x.w)), inner: best.st.map((x) => r3(x.inner)), note: `fitted on five views (not the right): ink off by ${best.err.ink.toFixed(3)}, tone by ${best.err.tone.toFixed(3)}` };
  writeFileSync(f, `/** Fitted taught treatments, by teacher (written by devtools/splats-taught-fit.mjs). */\nimport type { TaughtFit } from './policy';\nexport const TAUGHT_FIT: Record<string, TaughtFit> = ${JSON.stringify(all)};\n`);
  console.log(`${teacher}: ${all[teacher].note}; written to client/splats/taughtfit.ts`);
}, { width: 1024, height: 683 });
