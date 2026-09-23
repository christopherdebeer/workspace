import { DemPaintSession, type EditableDemTile } from './world-authoring-dem';

const assert = (condition: unknown, message: string): void => {
  if (!condition) throw new Error(message);
};

const tile = (key: string, xs: number, values?: number[]): EditableDemTile => ({
  key, xs, zs: 0, w: 40, h: 40, columns: 4, rows: 4,
  data: new Float32Array(values ?? new Array(16).fill(100)),
});

export function runWorldAuthoringDemSelfTest(): void {
  const a = tile('a', 0);
  const b = tile('b', 40);
  const edit = new DemPaintSession();

  edit.beginStroke('raise');
  const first = edit.paint([a, b], 40, 20, 8, 2);
  edit.paint([a, b], 40, 20, 8, 2);
  const stroke = edit.endStroke();
  assert(first.changed > 0 && first.tileKeys.length === 2,
    'raise brush did not cross the tile boundary');
  assert(stroke.changed === first.changed,
    'stationary pointer samples accumulated elevation within one stroke');
  assert(Math.max(...a.data, ...b.data) <= 102.001,
    'raise exceeded its per-stroke strength');
  edit.undo();
  assert([...a.data, ...b.data].every((value) => value === 100),
    'undo did not restore DEM source values');
  edit.redo();
  assert(Math.max(...a.data, ...b.data) > 100,
    'redo did not restore the sculpted DEM values');
  edit.undo();

  const slope = tile('slope', 0, [
    90, 90, 90, 90,
    90, 100, 110, 90,
    90, 100, 110, 90,
    90, 90, 90, 90,
  ]);
  edit.beginStroke('flatten');
  edit.paint([slope], 15, 15, 20, 10);
  edit.endStroke();
  assert(Math.abs(slope.data[6] - 100) < 0.01,
    'flatten did not converge touched cells on the first sampled elevation');
  edit.undo();

  const spike = tile('spike', 0, [
    100, 100, 100, 100,
    100, 100, 140, 100,
    100, 100, 100, 100,
    100, 100, 100, 100,
  ]);
  edit.beginStroke('smooth');
  edit.paint([spike], 25, 15, 0, 2);
  edit.endStroke();
  assert(spike.data[6] < 140 && spike.data[6] > 100,
    'smooth did not reduce a local spike');
  const reset = edit.reset();
  assert(reset.changed > 0 && spike.data[6] === 140,
    'reset did not restore the authored DEM session');
  assert(edit.report().undoDepth === 0 && edit.report().redoDepth === 0,
    'DEM reset did not clear both history stacks');
}
