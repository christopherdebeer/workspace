/**
 * Reproducible visual evidence for docs/substrate-material.md.
 *
 *   node devtools/substrate-doc-shots.mjs
 *   FIX=at-campsbay OUT=/tmp/substrate-doc node devtools/substrate-doc-shots.mjs
 *
 * One deterministic fixture, one settled boot, and live uniform/debug-view
 * changes between frames. This keeps every A/B under the same terrain,
 * weather, clock, streaming order and vegetation phase.
 */
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { openDrive } from './harness.mjs';

const FIX = process.env.FIX ?? 'at-yosemite';
const OUT = process.env.OUT ?? join(process.cwd(), 'docs/images/substrate-material');
mkdirSync(OUT, { recursive: true });

const d = await openDrive({
  spot: `fixture=${FIX}&cam=chase&time=NOON&wx=clear&nodraw=1`,
  tag: 'substrate-doc',
  viewport: { width: 1024, height: 640 },
  settle: 0,
  bootTimeout: 420000,
  dpr: 1,
});
const q = (f, ...a) => d.page.evaluate(f, ...a);

async function settleWorld() {
  let quiet = 0;
  let previous = '';
  for (let i = 0; i < 100; i++) {
    await d.page.waitForTimeout(2000);
    const stats = await q(() => window.__tstats());
    const signature = JSON.stringify([
      stats.dirty, stats.builds, stats.seenWays, stats.roadCells,
    ]);
    quiet = stats.dirty === 0 && stats.builds > 0 && signature === previous
      ? quiet + 1 : 0;
    previous = signature;
    if (quiet >= 3) return stats;
  }
  throw new Error(`fixture did not settle: ${previous}`);
}

async function waitForFrames(count = 3) {
  const first = await q(() => window.__clock().frames);
  await d.page.waitForFunction(
    ({ first, count }) => window.__clock().frames >= first + count,
    { first, count },
    { timeout: 300000, polling: 250 },
  );
}

async function shot(name) {
  await waitForFrames();
  const path = join(OUT, `${name}.png`);
  await d.page.screenshot({ path, timeout: 300000 });
  console.log(`shot ${path}`);
}

async function camera(mode, zoom) {
  await q((m) => window.__cam(m), mode);
  if (zoom !== undefined) {
    let previous = -1;
    for (let i = 0; i < 30; i++) {
      await q((v) => window.__zoom(v), zoom);
      await d.page.waitForTimeout(300);
      const current = await q(() => window.__cam().dist);
      if (current !== null && current === previous) break;
      previous = current;
    }
  }
  await waitForFrames(4);
}

try {
  const stats = await settleWorld();
  console.log(`settled ${FIX}: ${JSON.stringify(stats)}`);
  await q(() => {
    window.__hud(false);
    window.__hide('rig');
    window.__hide('critters');
    window.__draw(true);
    window.__groundview('off');
    window.__tdetail({ sub: 1, micro: 1, relief: 0.35, nrm: 1 });
  });

  await camera('chase');
  await shot('01-material-default-chase');

  await camera('top', 0.42);
  await shot('02-material-default-top');

  await q(() => window.__tdetail({ sub: 0 }));
  await shot('03-material-off-top');
  await q(() => window.__tdetail({ sub: 1 }));

  await q(() => window.__groundview('substrate'));
  await shot('04-material-shares-top');

  for (const [index, channel] of [
    ['05', 'exposure'],
    ['06', 'debris'],
    ['07', 'soil'],
    ['08', 'grass'],
  ]) {
    await q((name) => window.__groundview(name), channel);
    await shot(`${index}-field-${channel}-top`);
  }
  await q(() => window.__groundview('off'));

  await q(() => window.__tdetail({ micro: 0, relief: 0.35 }));
  await shot('09-microstructure-off-top');
  await q(() => window.__tdetail({ micro: 2, relief: 0.35 }));
  await shot('10-microstructure-2x-top');

  await q(() => window.__tdetail({ micro: 1, relief: 0 }));
  await shot('11-material-relief-off-top');
  await q(() => window.__tdetail({ relief: 1.4 }));
  await shot('12-material-relief-4x-top');
  await q(() => window.__tdetail({ relief: 0.35 }));

  await camera('chase');
  await q(() => window.__swardev(0));
  await shot('13-sward-nearest-cover-chase');
  const rawSward = await q(() => window.__swardev());
  await q(() => window.__swardev(1));
  await shot('14-sward-neighbourhood-chase');
  const smoothSward = await q(() => window.__swardev());

  const diagnostics = await q(() => ({
    material: window.__tdetail(),
    field: window.__substrateField(),
    errors: window.__errors?.() ?? [],
  }));
  console.log(`sward raw: ${JSON.stringify(rawSward)}`);
  console.log(`sward neighbourhood: ${JSON.stringify(smoothSward)}`);
  console.log(`diagnostics: ${JSON.stringify(diagnostics)}`);
  console.log(`pageerrors: ${JSON.stringify(d.errors)}`);
  if (d.errors.length || diagnostics.errors.length) process.exitCode = 1;
} finally {
  await d.close();
}
