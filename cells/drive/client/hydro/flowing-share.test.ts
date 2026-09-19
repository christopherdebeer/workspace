import { estimateFlowingCoverageShare } from './build-tile';
import { createHydroSystem } from './system';
import type { HydroFeature, HydroTileInput, WorldBounds } from './types';

const assert = (condition: unknown, message: string): void => {
  if (!condition) throw new Error(`hydro flowing share: ${message}`);
};

const TILE_SIZE = 2000;

function boundsAt(offsetX: number): WorldBounds {
  return { minX: offsetX, minZ: 0, maxX: offsetX + TILE_SIZE, maxZ: TILE_SIZE };
}

function elevation(n: number): { width: number; height: number; data: Float32Array } {
  const data = new Float32Array(n * n);
  data.fill(10);
  return { width: n, height: n, data };
}

/** `points` are LOCAL to a 0..TILE_SIZE frame; translated by `offsetX` here so
 * fixtures can sit at distinct, non-overlapping world locations — `fieldAt`
 * resolves a point to whichever tile's bounds contain it, so two fixtures
 * sharing one bounds would make that lookup ambiguous. */
function riverInput(
  key: string,
  offsetX: number,
  localPoints: number[],
  widthM: number,
  kind: HydroFeature['kind'] = 'river',
): HydroTileInput {
  const points = localPoints.map((v, i) => (i % 2 === 0 ? v + offsetX : v));
  const feature: HydroFeature = {
    id: `${key}:feature`,
    source: 'authored',
    kind,
    intermittent: false,
    tidal: false,
    geometry: { type: 'line', widthM, points: new Float64Array(points) },
  };
  return {
    key,
    revision: 1,
    bounds: boundsAt(offsetX),
    elevation: elevation(33),
    features: [feature],
    oceanCoverage: { status: 'unavailable' },
  };
}

/**
 * `estimateFlowingCoverageShare` is the pre-build stand-in for the field's
 * own post-build wet share — length of each flowing LINE feature clipped to
 * the tile's bounds, times its width, over the tile's area. These are the
 * shapes it has to get right: a thread clipping a corner (small), a river
 * spanning the whole tile (up to the "full" share the tier saturates at),
 * one whose points run off both edges (clipped, not the full polyline), one
 * entirely outside the tile (zero), and a standing body (never counted —
 * this tier is about flowing water only).
 */
function testEstimate(): void {
  // A thread: 6m wide, ~283m of diagonal inside a 2000x2000 tile.
  const thread = estimateFlowingCoverageShare(riverInput('thread', 0, [50, 50, 250, 250], 6));
  assert(thread > 0 && thread < 0.001,
    `a thread clipping a corner should read a small share, got ${thread}`);

  // A river 300m wide crossing the tile corner to corner: exactly 15% —
  // the FLOWING_FULL_SHARE the tier saturates at.
  const full = estimateFlowingCoverageShare(riverInput('full', 0, [0, 1000, 2000, 1000], 300));
  assert(Math.abs(full - 0.15) < 1e-9,
    `a river spanning the tile should read its own area share, got ${full}`);

  // A line running off BOTH edges of the tile: only the 2000m clipped to the
  // tile counts, not the full 4000m polyline (which would read 0.02).
  const clipped = estimateFlowingCoverageShare(
    riverInput('clipped', 0, [-1000, 1000, 3000, 1000], 20));
  assert(Math.abs(clipped - 0.01) < 1e-9,
    `an out-of-bounds line should be clipped to the tile, got ${clipped}`);

  // Entirely outside the tile: zero, not a fraction of the whole polyline.
  const outside = estimateFlowingCoverageShare(
    riverInput('outside', 0, [3000, 3000, 4000, 3000], 20));
  assert(outside === 0, `a feature entirely outside the tile should read 0, got ${outside}`);

  // A standing body is not this tier's concern, whatever its footprint.
  const lake: HydroTileInput = {
    key: 'lake',
    revision: 1,
    bounds: boundsAt(0),
    elevation: elevation(33),
    features: [{
      id: 'lake:feature',
      source: 'authored',
      kind: 'lake',
      intermittent: false,
      tidal: false,
      geometry: { type: 'area', polygons: [{
        outer: new Float64Array([100, 100, 1900, 100, 1900, 1900, 100, 1900]),
        holes: [],
      }] },
    }],
    oceanCoverage: { status: 'unavailable' },
  };
  assert(estimateFlowingCoverageShare(lake) === 0,
    'a standing-water area must not count toward the flowing share');

  // A degenerate (zero-width) tile must not divide by zero.
  const flat = estimateFlowingCoverageShare({
    ...riverInput('flat', 0, [5, 5, 5, 400], 6),
    bounds: { minX: 5, minZ: 5, maxX: 5, maxZ: 400 },
  });
  assert(Number.isFinite(flat) && flat === 0,
    `a zero-width tile must not produce NaN/Infinity, got ${flat}`);
}

/**
 * The system's own tier selection: sized from the share, not from "any
 * flowing observation". A thread stays at the base resolution; a river
 * filling the tile earns the full tier; one in between gets a proportional
 * fraction of it. Values here are the exact arithmetic of
 * `resolveFieldResolution`, checked end to end through `upsertTile`. Each
 * fixture sits at its own offset so `fieldAt` cannot confuse one tile's
 * field for another's.
 */
async function testTierSelection(): Promise<void> {
  const hydro = createHydroSystem({
    fieldResolution: 100,
    flowingFieldResolution: 200,
    deferRendering: true,
    meshResolution: 8,
  });
  try {
    await hydro.upsertTile(riverInput('tier-thread', 0, [50, 50, 250, 250], 6));
    const thread = hydro.fieldAt(150, 150);
    assert(thread?.resolution === 100 && thread.gutter === 6,
      `a thread should round to the base tier, got ${thread?.resolution}/${thread?.gutter}`);

    await hydro.upsertTile(riverInput('tier-full', 10_000, [0, 1000, 2000, 1000], 300));
    const full = hydro.fieldAt(11_000, 1000);
    assert(full?.resolution === 200 && full.gutter === 12,
      `a river filling the tile should reach the full tier, got ${full?.resolution}/${full?.gutter}`);

    await hydro.upsertTile(riverInput('tier-mid', 20_000, [-1000, 1000, 3000, 1000], 20));
    const mid = hydro.fieldAt(21_000, 1000);
    assert(mid?.resolution === 107 && mid.gutter === 7,
      `an in-between share should scale proportionally, got ${mid?.resolution}/${mid?.gutter}`);

    // A tile with no flowing water at all keeps the base tier exactly.
    await hydro.upsertTile({
      key: 'tier-dry',
      revision: 1,
      bounds: boundsAt(30_000),
      elevation: elevation(33),
      features: [],
      oceanCoverage: { status: 'unavailable' },
    });
    const dry = hydro.fieldAt(31_000, 1000);
    assert(dry?.resolution === 100 && dry.gutter === 6,
      `a dry tile must not pay any part of the flowing tier, got ${dry?.resolution}`);
  } finally {
    hydro.dispose();
  }
}

export async function runHydroFlowingShareTest(): Promise<void> {
  testEstimate();
  await testTierSelection();
}
