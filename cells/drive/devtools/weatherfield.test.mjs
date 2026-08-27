/**
 * THE WEATHER FIELD — no browser, no renderer.
 *
 *   node cells/drive/devtools/weatherfield.test.mjs
 *
 * The claims that matter are the SPATIAL ones, because space is the entire
 * reason this module exists. A front must actually travel downwind. Rain must
 * fall in patches you could drive out of. The ground must get wet where its
 * own rain fell and stay dry where none did — and that wetness must be nailed
 * to the WORLD, not to the truck, or driving north would drag the puddles
 * along with you.
 *
 * Determinism is asserted first because everything else stands on it: the
 * harness's pinned-weather fixtures rely on a pinned CLEAR being exactly
 * clear, byte for byte, build after build.
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '../../..');
const tmp = mkdtempSync(join(tmpdir(), 'wxf-'));
const built = join(tmp, 'weatherfield.mjs');
execFileSync('npx', ['esbuild', join(HERE, '../client/weatherfield.ts'), '--bundle', '--format=esm',
  `--outfile=${built}`], { cwd: ROOT, stdio: 'pipe' });
const W = await import(pathToFileURL(built).href);

let bad = 0;
const check = (name, cond, saw) => {
  if (!cond) bad++;
  console.log(`${cond ? 'ok  ' : 'FAIL'}  ${name}${cond ? '' : `\n        saw ${JSON.stringify(saw)}`}`);
};
const flat = () => 100;
const T = (over = {}) => ({ t: 1000, windX: 8, windZ: 0, cover: 0.5, rain: 0.5, fog: 0, dt: 2, dayF: 1, ...over });
const mean = (f, c) => {
  let s = 0;
  for (let k = 0; k < W.WXF_N * W.WXF_N; k++) s += f.data[k * 4 + c];
  return s / (W.WXF_N * W.WXF_N * 255);
};

console.log('── determinism and the pins ──');
{
  const a = W.mkField(0, 0), b = W.mkField(0, 0);
  W.buildField(a, T(), flat);
  W.buildField(b, T(), flat);
  check('two identical builds are byte-identical',
    a.data.every((v, i) => v === b.data[i]), null);

  const clear = W.mkField(0, 0);
  W.buildField(clear, T({ cover: 0, rain: 0, fog: 0 }), flat);
  check('a pinned CLEAR is exactly clear — no invented clouds, no rain, no fog',
    mean(clear, 0) === 0 && mean(clear, 1) === 0 && mean(clear, 2) === 0,
    [mean(clear, 0), mean(clear, 1), mean(clear, 2)]);

  const storm = W.mkField(0, 0);
  W.buildField(storm, T({ cover: 0.95, rain: 1 }), flat);
  check('a pinned STORM is nearly wall to wall',
    mean(storm, 0) > 0.88 && mean(storm, 1) > 0.8, [mean(storm, 0), mean(storm, 1)]);
}

console.log('\n── the regional mean, and the patches around it ──');
{
  const f = W.mkField(0, 0);
  W.buildField(f, T({ cover: 0.5 }), flat);
  check('mid cover averages near its target', Math.abs(mean(f, 0) - 0.5) < 0.08, +mean(f, 0).toFixed(3));
  // …and is not FLAT: the whole point is that some cells are under the front
  // and some are not.
  let lo = 0, hi = 0;
  for (let k = 0; k < W.WXF_N * W.WXF_N; k++) {
    const v = f.data[k * 4] / 255;
    if (v < 0.3) lo++; if (v > 0.7) hi++;
  }
  check('…with real open patches and real dark ones', lo > 40 && hi > 40, { lo, hi });

  const shower = W.mkField(0, 0);
  W.buildField(shower, T({ rain: 0.3 }), flat);
  let raining = 0;
  for (let k = 0; k < W.WXF_N * W.WXF_N; k++) if (shower.data[k * 4 + 1] > 12) raining++;
  const frac = raining / (W.WXF_N * W.WXF_N);
  check('light rain is scattered showers, not a thin drizzle everywhere',
    frac > 0.05 && frac < 0.6, +frac.toFixed(3));
}

console.log('\n── the front moves downwind ──');
{
  // Same field, two moments 60s apart, wind due +x at 8m/s: the rain pattern
  // at t1 should best match the t0 pattern SHIFTED ~480m east — about two
  // cells — and better than it matches the unshifted one.
  const a = W.mkField(0, 0), b = W.mkField(0, 0);
  W.buildField(a, T({ t: 0 }), flat);
  W.buildField(b, T({ t: 60 }), flat);
  const corrAtShift = (cells) => {
    let s = 0, n = 0;
    for (let j = 0; j < W.WXF_N; j++) {
      for (let i = cells; i < W.WXF_N; i++) {
        s += Math.abs(b.data[(j * W.WXF_N + i) * 4 + 1] - a.data[(j * W.WXF_N + i - cells) * 4 + 1]);
        n++;
      }
    }
    return s / n;   // mean abs difference: lower is a better match
  };
  const d0 = corrAtShift(0), d2 = corrAtShift(2);
  check('sixty seconds of 8m/s wind moves the rain about two cells east',
    d2 < d0 * 0.8, { still: +d0.toFixed(1), shifted: +d2.toFixed(1) });
}

console.log('\n── wet is memory, and it is nailed to the ground ──');
{
  const f = W.mkField(0, 0);
  // Rain for 60 simulated seconds…
  for (let n = 0; n < 30; n++) W.buildField(f, T({ rain: 0.8, dt: 2 }), flat);
  const rainyK = [...Array(W.WXF_N * W.WXF_N).keys()].find((k) => f.data[k * 4 + 1] > 150);
  check('somewhere it rained hard', rainyK !== undefined, null);
  const wetThere = f.wet[rainyK];
  check('…and the ground THERE soaked', wetThere > 0.5, +wetThere.toFixed(2));
  const dryK = [...Array(W.WXF_N * W.WXF_N).keys()].find((k) => f.data[k * 4 + 1] === 0);
  check('…while a cell with no rain stayed dry', dryK !== undefined && f.wet[dryK] < 0.05,
    dryK !== undefined ? +f.wet[dryK].toFixed(3) : null);
  // …then the sky clears, and the ground dries — slowly.
  for (let n = 0; n < 15; n++) W.buildField(f, T({ rain: 0, dt: 2 }), flat);
  const after30 = f.wet[rainyK];
  check('thirty dry seconds later it is still wet', after30 > 0.2, +after30.toFixed(2));
  for (let n = 0; n < 60; n++) W.buildField(f, T({ rain: 0, dt: 2 }), flat);
  check('…two more minutes and it has dried', f.wet[rainyK] < 0.08, +f.wet[rainyK].toFixed(3));
}
{
  // WORLD-ANCHORED: wet a spot, drive two cells north, recenter — the same
  // WORLD point must report the same wetness through the moved grid.
  const f = W.mkField(0, 0);
  for (let n = 0; n < 30; n++) W.buildField(f, T({ rain: 0.9, dt: 2 }), flat);
  let probe = null;
  for (let k = 0; k < W.WXF_N * W.WXF_N; k++) {
    if (f.wet[k] > 0.5) {
      const i = k % W.WXF_N, j = (k / W.WXF_N) | 0;
      // Away from the edges, so the shifted grid still holds it.
      if (i > 6 && i < W.WXF_N - 6 && j > 6 && j < W.WXF_N - 6) {
        probe = [f.ox + (i + 0.5) * W.WXF_M, f.oz + (j + 0.5) * W.WXF_M];
        break;
      }
    }
  }
  check('a wet probe point exists away from the rim', !!probe, null);
  const before = W.wxAt(f, probe[0], probe[1]).wet;
  const moved = W.recenter(f, probe[0] + 5 * W.WXF_M, probe[1] + 3 * W.WXF_M);
  W.buildField(f, T({ rain: 0, dt: 0.01 }), flat);
  const after = W.wxAt(f, probe[0], probe[1]).wet;
  check('recentring the grid does not move the puddles',
    moved && Math.abs(after - before) < 0.06, { before: +before.toFixed(3), after: +after.toFixed(3) });
}

console.log('\n── the mist ceiling ──');
{
  // A valley at 80m crossed by a pass at 700m: the ceiling must blanket the
  // floor and leave the pass in the clear.
  const valley = (x, z) => 80 + 620 * Math.min(1, Math.abs(x - W.WXF_SPAN / 2) / 4000);
  const f = W.mkField(0, 0);
  W.buildField(f, T({ fog: 0.8 }), valley);
  check('the ceiling sits above the valley floor', f.fogTop > 90, +f.fogTop.toFixed(0));
  check('…and well below the pass', f.fogTop < 500, +f.fogTop.toFixed(0));
  const anyFog = mean(f, 2);
  check('…and with mist asked for, banks exist', anyFog > 0.05, +anyFog.toFixed(3));
}

console.log(bad ? `\n${bad} FAILED` : '\nall good');
process.exit(bad ? 1 : 0);
