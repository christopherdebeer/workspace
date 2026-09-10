/**
 * PRODUCTION SUBSTRATE VISUAL REVIEW — same world, light, cameras and post.
 *
 *   node cells/drive/devtools/substrate-visual-review.mjs
 *
 * Writes six images under /tmp/drive-tools:
 *
 *   substrate-visual-production-{bank,top,wake}.png
 *   substrate-visual-render-{bank,top,wake}.png
 *
 * The production control is the ordinary production renderer: canonical
 * substrate contact, with HydroSystem still admitting the visible world. The
 * render candidate uses `?substrate=render`, where the matching immutable tile
 * admits terrain, drive, structures, hydro detail and hydro as one revision.
 *
 * Nothing disables or replaces the composite. Dither and palette quantisation
 * therefore remain exactly where production owns them: in global post.
 */
import { join } from 'node:path';
import { openDrive, report, WORK } from './harness.mjs';

const ALL_MODES = [
  { label: 'production', query: '' },
  { label: 'render', query: '&substrate=render' },
];
const requestedMode = process.argv.find((arg) => arg.startsWith('--mode='))?.slice(7);
const MODES = requestedMode
  ? ALL_MODES.filter((mode) => mode.label === requestedMode)
  : ALL_MODES;
if (!MODES.length) throw new Error(`unknown visual mode ${requestedMode}`);

async function waitForSettledWorld(page, requireRender) {
  let stableSignature = '';
  let stableSince = 0;
  let state = null;
  const deadline = Date.now() + 70000;
  while (Date.now() < deadline) {
    state = await page.evaluate(() => ({
      substrate: window.__substrate?.(),
      hydro: window.__hydro?.(),
      hydroTiles: window.__hydrotiles?.() ?? [],
      waterPoints: window.__substrateWaterPoints?.(96, 3000) ?? [],
    }));
    const hydro = state.hydro?.stats;
    const render = state.substrate?.render;
    const common = state.substrate?.tiles?.tiles > 0
      && state.substrate?.tiles?.waters > 0
      && state.waterPoints.length > 0
      && hydro?.pendingBuilds === 0
      && hydro?.dirtyTiles === 0;
    const committed = !requireRender || (
      render?.terrainCandidates > 0
      && render.terrainCandidates === render.terrainCommitted
      && render.retainedTerrainSourceMeshes === 0
      && render.pendingReconciliations === 0
      && render.uncommittedVisibleTerrain === 0
      && render.uncommittedVisibleRoads === 0
      && render.uncommittedVisibleStructures === 0
      && render.uncommittedVisibleHydroDetails === 0
    );
    const signature = JSON.stringify([
      state.substrate?.tiles?.revision,
      state.substrate?.tiles?.tiles,
      state.substrate?.tiles?.waters,
      hydro?.tiles,
      hydro?.visibleTiles,
      render?.atomicCommits,
      render?.terrainCommitted,
      render?.roadCommittedTiles,
      render?.visibleHydroDetails,
      state.waterPoints.length,
    ]);
    if (common && committed && signature === stableSignature) {
      if (Date.now() - stableSince >= 1800) return state;
    } else {
      stableSignature = signature;
      stableSince = Date.now();
    }
    await page.waitForTimeout(300);
  }
  throw new Error(`visual world did not settle: ${JSON.stringify(state)}`);
}

async function frame(mode) {
  const d = await openDrive({
    spot: `fixture=at-senqu-ford&cam=chase&time=NOON&sunalt=55&wx=clear${mode.query}`,
    tag: `substrate-visual-${mode.label}`,
    viewport: { width: 1280, height: 720 },
    settle: 12000,
    bootTimeout: 90000,
  });
  try {
    const settled = await waitForSettledWorld(d.page, mode.label === 'render');
    const placement = await d.page.evaluate(() => {
      window.__hide?.('critters');
      const points = (window.__substrateWaterPoints?.(96, 3000) ?? [])
        .filter((point) => point.fluid)
        .sort((a, b) => {
          const af = a.crossing === 'ford' ? 0 : 1;
          const bf = b.crossing === 'ford' ? 0 : 1;
          return af - bf
            || (b.depthAboveSupportM ?? 0) - (a.depthAboveSupportM ?? 0)
            || a.x - b.x || a.z - b.z;
        });
      const wet = points[0] ?? null;
      if (!wet) return null;

      // Find nearby dry support and face back toward the exact wet probe. This
      // makes the bank frame inspect the waterline rather than merely proving
      // that some water exists somewhere behind the chase camera.
      let bank = null;
      for (let radius = 8; radius <= 72 && !bank; radius += 4) {
        for (let octant = 0; octant < 24; octant++) {
          const angle = octant * Math.PI / 12;
          const x = wet.x + Math.cos(angle) * radius;
          const z = wet.z + Math.sin(angle) * radius;
          const water = window.__waterinfo?.(x, z);
          if (water?.surface === 'water') continue;
          bank = { x, z, radius };
          break;
        }
      }
      if (!bank) return null;
      const heading = Math.atan2(wet.x - bank.x, -(wet.z - bank.z));
      return { wet, bank, heading };
    });
    if (!placement) throw new Error('could not resolve deterministic wet/bank viewpoints');

    await d.page.evaluate(({ bank, heading }) => {
      window.__drive.x = bank.x;
      window.__drive.z = bank.z;
      window.__drive.heading = heading;
      window.__drive.speed = 0;
      window.__setcam?.('chase');
    }, placement);
    await d.page.waitForTimeout(2500);
    await d.shot(`substrate-visual-${mode.label}-bank`);

    await d.page.evaluate(({ wet, heading }) => {
      window.__drive.x = wet.x;
      window.__drive.z = wet.z;
      window.__drive.heading = heading;
      window.__drive.speed = 0;
      window.__setcam?.('top');
      window.__zoom?.(.58);
    }, placement);
    await d.page.waitForTimeout(2500);
    await d.shot(`substrate-visual-${mode.label}-top`);
    if (mode.label === 'render') {
      // Layer-separated witnesses for a failed cohesion review. These remain
      // normal production pixels unless the filename says which diagnostic
      // layer was intentionally isolated.
      await d.page.evaluate(() => window.__hydroshow?.(false));
      await d.page.waitForTimeout(400);
      await d.shot('substrate-visual-render-top-ground');
      await d.page.evaluate(() => window.__hydroshow?.(true));

      await d.page.evaluate(() => window.__hide?.('sward'));
      await d.page.waitForTimeout(400);
      await d.shot('substrate-visual-render-top-no-sward');
      await d.page.evaluate(() => window.__hide?.('sward', false));

      for (const view of ['coverage', 'shore', 'depth']) {
        await d.page.evaluate((name) => window.__hydroview?.(name), view);
        await d.page.waitForTimeout(400);
        await d.shot(`substrate-visual-render-top-${view}`);
      }
      await d.page.evaluate(() => window.__hydroview?.('surface'));

      // Term ablations keep a failed bank review actionable: terrain/sward,
      // shallow-bed reveal and the wet edge can be judged independently.
      for (const [name, tuning] of [
        ['no-bed', { shallowBedStrength: 0, riverEdgeStrength: 1 }],
        ['no-edge', { shallowBedStrength: 1, riverEdgeStrength: 0 }],
        ['no-bed-edge', { shallowBedStrength: 0, riverEdgeStrength: 0 }],
      ]) {
        await d.page.evaluate((patch) => window.__hydrotune?.(patch), tuning);
        await d.page.waitForTimeout(400);
        await d.shot(`substrate-visual-render-top-${name}`);
      }
      await d.page.evaluate(() => window.__hydrotune?.({
        shallowBedStrength: 1,
        riverEdgeStrength: 1,
      }));
    }

    await d.page.evaluate(({ wet, heading }) => {
      window.__drive.x = wet.x;
      window.__drive.z = wet.z;
      window.__drive.heading = heading;
      window.__drive.speed = 3.2;
      window.__setcam?.('chase');
    }, placement);
    await d.simWait(1.1);
    await d.shot(`substrate-visual-${mode.label}-wake`);

    const diagnostics = await d.page.evaluate(() => ({
      substrate: window.__substrate?.(),
      evidence: window.__waterEvidence?.(),
      camera: window.__cam?.(),
      dither: window.__dither?.(),
    }));
    console.log(`${mode.label}:`, JSON.stringify({
      placement,
      mode: diagnostics.substrate?.mode,
      renderAuthority: diagnostics.substrate?.renderAuthority,
      contactAuthority: diagnostics.substrate?.contactAuthority,
      revision: diagnostics.substrate?.tiles?.revision,
      atomicCommits: diagnostics.substrate?.render?.atomicCommits,
      retainedSources: {
        terrain: diagnostics.substrate?.render?.retainedTerrainSourceMeshes,
        road: diagnostics.substrate?.render?.retainedRoadSourceMeshes,
        hydroDetail: diagnostics.substrate?.render?.retainedHydroDetailSourceMeshes,
      },
      evidence: diagnostics.evidence,
      camera: diagnostics.camera,
      dither: diagnostics.dither,
      settledWaterPoints: settled.waterPoints.length,
    }));
    report(d.errors);
    if (d.errors.length) process.exitCode = 1;
  } finally {
    await d.close();
  }
}

for (const mode of MODES) await frame(mode);

console.log('visual review images:');
for (const mode of MODES) {
  for (const view of ['bank', 'top', 'wake']) {
    console.log(`  ${join(WORK, `substrate-visual-${mode.label}-${view}.png`)}`);
  }
}
