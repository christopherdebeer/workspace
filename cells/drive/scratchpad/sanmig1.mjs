// ORIENTATION AT THE SAN MIGUEL. Everything the seat's frame could be made of,
// measured once: the hydro field's verdict, the height field, the RENDERED
// mesh, and the gap between them, on a grid and on a transect.
import { openDrive } from '../devtools/harness.mjs';
import { writeFileSync } from 'node:fs';
const d = await openDrive({
  spot: 'lat=37.86119&lon=-107.87094&h=321&cam=chase&tdbg=0&wxlive=0&time=NOON',
  tag: 'sanmig1', settle: 0, bootTimeout: 300000,
});
const q = (f, ...a) => d.page.evaluate(f, ...a);
await d.page.waitForTimeout(180000);            // let the world stream in

const out = {};
const safe = async (name, fn, ...a) => {
  try { out[name] = await q(fn, ...a); } catch (e) { out[name] = { ERR: String(e).slice(0, 200) }; }
};

await safe('origin', () => window.__origin());
await safe('life', () => window.__life());
await safe('hydrotiles', () => window.__hydrotiles());
await safe('waterinfo', () => window.__waterinfo());
await safe('ford', () => window.__ford());
await safe('hydrowhy', () => window.__hydrowhy());
await safe('rivers', () => window.__rivers());
await safe('riverpts', () => window.__riverpts(24));
await safe('tileholes', () => window.__tileholes());
await safe('hydromap', () => window.__hydromap(600, 41));
await safe('wetmap', () => window.__wetmap(200, 25));
await safe('hydrofeeds', () => window.__hydrofeeds().slice(-12));
await safe('demsrc', () => window.__demsrc());

// ── THE GRID. For every post: what the field says, what the MESH draws, and
// what the water plane sits at. All three in one frame of reference.
await safe('grid', () => {
  const S = 8, N = 101;                          // 800 m square at 8 m
  const cx = window.__origin().x ?? 0, cz = window.__origin().z ?? 0;
  const rows = [];
  for (let iz = 0; iz < N; iz++) {
    const z = cz + (iz - (N >> 1)) * S;
    const row = [];
    for (let ix = 0; ix < N; ix++) {
      const x = cx + (ix - (N >> 1)) * S;
      const w = window.__hydrowhy(x, z);
      const m = window.__meshAt(x, z);
      row.push([w.bed, w.restingLevelM ?? null, m, w.depthM ?? null, w.coverage ?? null]);
    }
    rows.push(row);
  }
  return { S, N, cx, cz, rows };
});
writeFileSync(new URL('./sanmig1.json', import.meta.url), JSON.stringify(out));
console.log('KEYS', Object.keys(out).join(' '));
console.log('origin', JSON.stringify(out.origin));
console.log('waterinfo', JSON.stringify(out.waterinfo));
console.log('hydrowhy', JSON.stringify(out.hydrowhy));
console.log('tileholes', JSON.stringify(out.tileholes));
console.log('hydromap'); for (const r of (out.hydromap ?? [])) console.log(r);
await d.page.screenshot({ path: new URL('./sanmig1.png', import.meta.url).pathname });
console.log('errors', d.errors.slice(0, 5));
await d.close();
