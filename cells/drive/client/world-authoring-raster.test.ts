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
  const redone = edit.redo();
  assert(redone.tileKeys.length === 2 && [...a.data, ...b.data].some((v) => v === 80),
    'redo did not restore the painted bytes');
  assert(edit.report().redoDepth === 0 && edit.report().undoDepth === 1,
    'redo did not move the stroke back to undo history');
  edit.undo();

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
  assert(edit.report().undoDepth === 0 && edit.report().redoDepth === 0,
    'reset did not clear history');

  // ── REDO ──
  // The raster AND the session record, or a redone cell stands in the world
  // and is missing from the authored entry the bank files off `edits()`.
  const r = new RasterPaintSession();
  const c = tile('c', 0);
  r.beginStroke();
  r.paint([c], 5, 5, 0, 70);
  r.endStroke();
  assert(r.report().redoDepth === 0, 'a fresh stroke offered a redo');
  const un = r.undo();
  assert(c.data[0] === 10 && r.report().redoDepth === 1, 'undo did not stack a redo');
  assert(un.cells?.length === 1, 'undo did not report the cell it moved');
  const re = r.redo();
  assert(c.data[0] === 70, 'redo did not put the byte back');
  assert(re.cells?.length === 1 && re.changed === 1, 'redo did not report its cells');
  assert(r.report().editedCells === 1 && r.report().undoDepth === 1 && r.report().redoDepth === 0,
    'redo did not restore the session record');
  assert(r.edits().length === 1 && r.edits()[0].after === 70,
    'a redone cell is missing from what the bank would file');
  // A NEW STROKE FORKS THE HISTORY: a redo recorded before it would restore
  // a value nothing on the screen ever showed.
  r.undo();
  r.beginStroke();
  r.paint([c], 5, 5, 0, 90);
  r.endStroke();
  assert(r.report().redoDepth === 0, 'a new stroke kept a stale redo');
  assert(r.redo().changed === 0 && c.data[0] === 90, 'a stale redo was applied');

  // The stroke in flight, as footprints the lab can draw before any rebuild.
  const live = new RasterPaintSession();
  const d = tile('d', 0);
  live.beginStroke();
  live.paint([d], 5, 5, 0, 50);
  const cells = live.strokeCells();
  assert(cells.length === 1, 'the live stroke reported no cells');
  assert(cells[0].w === 10 && cells[0].h === 10, 'a cell footprint is not the texel size');
  assert(Math.abs(cells[0].x - 5) < 1e-9 && Math.abs(cells[0].z - 5) < 1e-9,
    'a cell footprint is not centred on its texel');

  const sparse = tile('sparse', 0);
  edit.beginStroke();
  const none = edit.paint([sparse], 20, 20, 100, 80, 0);
  edit.endStroke();
  assert(none.changed === 0 && sparse.data.every((v) => v === 10),
    'zero fill changed categorical cells');
  edit.beginStroke();
  const partial = edit.paint([sparse], 20, 20, 100, 80, .5);
  edit.endStroke();
  assert(partial.changed > 0 && partial.changed < sparse.data.length,
    'partial fill did not mix painted and source cover cells');
  edit.beginStroke();
  edit.paint([sparse], 20, 20, 100, 80, 1);
  edit.endStroke();
  assert(sparse.data.every((v) => v === 80), 'full fill did not paint every covered cell');
}
