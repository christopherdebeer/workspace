import { RasterPaintSession, type EditableRasterTile } from './world-authoring-raster';

const assert = (condition: unknown, message: string): void => {
  if (!condition) throw new Error(message);
};

const tile = (key: string, xs: number, value = 10): EditableRasterTile => ({
  key, xs, zs: 0, w: 40, h: 40, columns: 4, rows: 4,
  data: new Uint8Array(16).fill(value),
});

export function runWorldAuthoringRasterSelfTest(): void {
  const a = tile('a', 0);
  const b = tile('b', 40);
  const edit = new RasterPaintSession();

  edit.beginStroke();
  const first = edit.paint([a, b], 40, 20, 8, 80);
  edit.paint([a, b], 40, 20, 8, 80);
  const stroke = edit.endStroke();
  assert(first.changed > 0, 'brush changed no cells');
  assert(first.tileKeys.length === 2, 'cross-tile brush did not touch both tiles');
  assert(stroke.changed === first.changed, 'repeated samples duplicated one stroke');
  assert(edit.report().undoDepth === 1, 'one drag did not produce one undo entry');

  const undone = edit.undo();
  assert(undone.tileKeys.length === 2, 'undo did not report both affected tiles');
  assert([...a.data, ...b.data].every((v) => v === 10), 'undo did not restore source bytes');
  assert(edit.report().editedCells === 0, 'undo left restored cells marked edited');

  edit.beginStroke();
  edit.paint([a], 5, 5, 0, 30);
  edit.paint([a], 5, 5, 0, 10);
  edit.endStroke();
  assert(edit.report().editedCells === 0 && edit.report().undoDepth === 0,
    'a stroke that returned to its starting value retained a phantom edit');

  edit.beginStroke();
  edit.paint([a], 5, 5, 0, 30);
  edit.endStroke();
  assert(a.data[0] === 30, 'zero-radius click did not paint the containing texel');
  const outside = edit.paint([a], 1000, 1000, 20, 60);
  edit.endStroke();
  assert(outside.changed === 0, 'brush outside loaded rasters changed data');
  const reset = edit.reset();
  assert(reset.changed === 1 && a.data[0] === 10, 'reset did not restore the session source');
  assert(edit.report().undoDepth === 0, 'reset did not clear history');
}
