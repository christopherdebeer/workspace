import { createHydroSystem } from './system';
import type { HydroFeature, HydroTileField, HydroTileInput } from './types';

const assert = (condition: unknown, message: string): void => {
  if (!condition) throw new Error(`hydro render cutover: ${message}`);
};

const ring = (...values: number[]): Float64Array => new Float64Array(values);

function input(revision: number, roughness: number): HydroTileInput {
  const n = 33;
  const elevation = new Float32Array(n * n);
  for (let iz = 0; iz < n; iz++) for (let ix = 0; ix < n; ix++) {
    elevation[iz * n + ix] = 18 - iz * .08 + Math.abs(ix - 16) * .03;
  }
  const river: HydroFeature = {
    id: 'cutover:river',
    source: 'authored',
    kind: 'river',
    intermittent: false,
    tidal: false,
    roughness,
    turbidity: .2,
    geometry: {
      type: 'line',
      widthM: 18,
      points: ring(300, 20, 292, 180, 315, 320, 300, 580),
    },
  };
  return {
    key: 'cutover/0/0',
    revision,
    bounds: { minX: 0, minZ: 0, maxX: 600, maxZ: 600 },
    elevation: { width: n, height: n, data: elevation },
    features: [river],
    oceanCoverage: { status: 'unavailable' },
  };
}

function oceanInput(): HydroTileInput {
  const n = 33;
  const elevation = new Float32Array(n * n);
  const coverage = new Uint8Array(n * n);
  for (let iz = 0; iz < n; iz++) for (let ix = 0; ix < n; ix++) {
    elevation[iz * n + ix] = -8 + ix * .04;
    coverage[iz * n + ix] = ix < 5 ? 0 : 255;
  }
  return {
    key: 'cutover/ocean',
    revision: 1,
    bounds: { minX: 0, minZ: 0, maxX: 600, maxZ: 600 },
    elevation: { width: n, height: n, data: elevation },
    features: [],
    oceanCoverage: {
      status: 'ready',
      grid: { width: n, height: n, data: coverage },
    },
  };
}

export async function runHydroRenderCutoverTest(): Promise<void> {
  const hydro = createHydroSystem({
    fieldResolution: 128,
    flowingFieldResolution: 256,
    deferRendering: true,
    meshResolution: 8,
  });
  try {
    await hydro.upsertTile(input(1, .4));
    const first = hydro.fieldAt(300, 300);
    assert(first, 'first field was not retained');
    assert(first?.resolution === 256 && first.gutter === 12,
      'flowing field did not use the adaptive tier');
    assert(hydro.object3d.children.length === 0,
      'deferred build created GPU meshes before substrate commit');
    assert(hydro.canRenderField(first as HydroTileField),
      'matching first revision failed non-mutating preflight');
    assert(hydro.object3d.children.length === 0,
      'render preflight created GPU resources');
    assert(hydro.renderField(first as HydroTileField),
      'matching first revision was refused');
    assert(hydro.object3d.children.length > 0,
      'matching first revision did not create render resources');
    hydro.unrenderTile(first!.key);
    assert(hydro.object3d.children.length === 0,
      'substrate invalidation did not remove render resources');
    assert(hydro.fieldAt(300, 300) === first,
      'substrate invalidation discarded the retained field');
    assert(hydro.renderField(first as HydroTileField),
      'retained field could not be recommitted after invalidation');

    // The first field's picture is up when the second arrives, and it STAYS
    // up — the substrate admits the second with the rest of its tile, and
    // only that admission swaps the parts. Dropping them here is what took
    // the water off the map at every re-feed in render mode.
    const stale = [...hydro.object3d.children];
    assert(stale.length > 0, 'first field was not rendered before the second arrived');
    await hydro.upsertTile(input(2, .8));
    const second = hydro.fieldAt(300, 300);
    assert(second && second !== first && second.revision === 2,
      'second immutable field did not replace the first');
    assert(hydro.object3d.children.length === stale.length
      && hydro.object3d.children.every((c) => stale.includes(c)),
      'new field revision dropped the previous picture before admission');
    assert(!hydro.canRenderField(first as HydroTileField),
      'superseded substrate field passed render preflight');
    assert(!hydro.renderField(first as HydroTileField),
      'superseded substrate field was allowed to commit');
    assert(hydro.object3d.children.length === stale.length
      && hydro.object3d.children.every((c) => stale.includes(c)),
      'refused stale field changed render state');
    assert(hydro.renderField(second as HydroTileField),
      'matching second revision was refused');
    assert(hydro.object3d.children.length > 0
      && !hydro.object3d.children.some((c) => stale.includes(c)),
      'matching second revision did not swap the picture for its own');
    assert(hydro.renderField(second as HydroTileField)
      && hydro.object3d.children.length > 0,
      'a second admission of the same field rebuilt or dropped its picture');

    const foreign = { ...(second as HydroTileField) };
    assert(!hydro.canRenderField(foreign),
      'equal-looking foreign field passed render preflight');
    assert(!hydro.renderField(foreign),
      'equal-looking foreign field bypassed identity locking');

    const riverDebug = hydro.debugTiles()[0] as {
      coastalMesh?: boolean;
    };
    assert(riverDebug.coastalMesh === false,
      'a river-only tile paid the coastal geometry tier');
  } finally {
    hydro.dispose();
  }

  const ocean = createHydroSystem({
    fieldResolution: 64,
    meshResolution: 8,
    coastalMeshMultiplier: 3,
  });
  try {
    await ocean.upsertTile(oceanInput());
    const debug = ocean.debugTiles()[0] as {
      coastalMesh?: boolean;
      meshSegments?: [number, number];
      meshTriangles?: number;
    };
    assert(debug.coastalMesh === true,
      'an ocean tile did not select the coastal geometry tier');
    assert((debug.meshSegments?.[0] ?? 0) >= 20
      && (debug.meshSegments?.[1] ?? 0) >= 20,
    `the 8-cell base did not become a dense coastal lattice (${debug.meshSegments})`);
    assert((debug.meshTriangles ?? 0) > 500,
      `the coastal surface did not retain enough geometry for swell (${debug.meshTriangles} triangles)`);
    const surface = ocean.object3d.children.find((child) =>
      child.name.startsWith('hydro-tile:cutover/ocean')) as {
        material?: { uniforms?: Record<string, { value: unknown }> };
      } | undefined;
    assert(surface?.material?.uniforms?.uWaveChop?.value === 1,
      'the coastal material did not bind the crest-chop uniform');
  } finally {
    ocean.dispose();
  }
}
