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

    await hydro.upsertTile(input(2, .8));
    const second = hydro.fieldAt(300, 300);
    assert(second && second !== first && second.revision === 2,
      'second immutable field did not replace the first');
    assert(hydro.object3d.children.length === 0,
      'new field revision retained stale render resources');
    assert(!hydro.canRenderField(first as HydroTileField),
      'superseded substrate field passed render preflight');
    assert(!hydro.renderField(first as HydroTileField),
      'superseded substrate field was allowed to commit');
    assert(hydro.object3d.children.length === 0,
      'refused stale field changed render state');
    assert(hydro.renderField(second as HydroTileField),
      'matching second revision was refused');
    assert(hydro.object3d.children.length > 0,
      'matching second revision did not restore rendering');

    const foreign = { ...(second as HydroTileField) };
    assert(!hydro.canRenderField(foreign),
      'equal-looking foreign field passed render preflight');
    assert(!hydro.renderField(foreign),
      'equal-looking foreign field bypassed identity locking');
  } finally {
    hydro.dispose();
  }
}
