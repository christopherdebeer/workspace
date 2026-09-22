import { PolylinePaintSession } from './world-authoring-vector';

const assert = (condition: unknown, message: string): void => {
  if (!condition) throw new Error(message);
};

export function runWorldAuthoringVectorSelfTest(): void {
  let id = 0;
  const edit = new PolylinePaintSession(() => `test-${++id}`);
  edit.begin('residential', 8, 0, 0);
  edit.sample(.5, 0);
  edit.sample(10, 0);
  edit.sample(20, .1);
  const line = edit.end();
  assert(line.feature?.id === 'test-1', 'accepted line did not produce a stable feature');
  assert(line.feature?.points.length === 2, 'straight pointer samples were not simplified');
  assert(edit.report().features === 1, 'feature was not retained');

  edit.begin('service', 5, 0, 0);
  edit.sample(2, 0);
  assert(!edit.end().feature, 'too-short gesture became a road');
  assert(edit.report().features === 1, 'rejected gesture changed history');

  const saved = edit.snapshot();
  const restored = new PolylinePaintSession();
  restored.load(JSON.parse(JSON.stringify(saved)));
  assert(restored.report().features === 1 && restored.snapshot()[0].points.length === 2,
    'serialized features did not restore');
  assert(restored.undo().feature?.id === 'test-1' && restored.report().features === 0,
    'undo did not remove the last source feature');
  assert(restored.redo().feature?.id === 'test-1' && restored.report().features === 1,
    'redo did not restore the last source feature');
  restored.undo();
  const history = restored.save();
  const reloadedHistory = new PolylinePaintSession();
  reloadedHistory.load(JSON.parse(JSON.stringify(history)));
  assert(reloadedHistory.report().redoDepth === 1
    && reloadedHistory.redo().feature?.id === 'test-1',
  'serialized history did not preserve redo across a rebuild');

  restored.load([{ nope: true }, ...saved]);
  assert(restored.report().features === 1, 'invalid persisted entries were not ignored');
  assert(restored.reset().changed === 2 && restored.report().features === 0,
    'reset did not clear source features');

  // ── REDO, AND IT HAS TO SURVIVE A RELOAD ──
  // Removing a built road is the one edit the lab cannot do in place, so the
  // adapter reloads the page after an undo. An in-memory redo would be gone
  // before a thumb could reach it, so the stack is part of the saved record.
  const r = new PolylinePaintSession(() => 'road-r');
  r.begin('residential', 8, 0, 0);
  r.sample(40, 0);
  r.end();
  assert(r.report().features === 1 && r.report().redoDepth === 0, 'a fresh line offered a redo');
  r.undo();
  assert(r.report().features === 0 && r.report().redoDepth === 1, 'undo did not stack a redo');
  assert(r.redo().feature?.id === 'road-r' && r.report().features === 1,
    'redo did not put the line back');
  assert(r.report().redoDepth === 0, 'redo left its own entry on the stack');
  r.undo();
  const reloaded = new PolylinePaintSession();
  reloaded.load(JSON.parse(JSON.stringify(r.save())));
  assert(reloaded.report().features === 0 && reloaded.report().redoDepth === 1,
    'the redo stack did not survive the record the adapter saves');
  assert(reloaded.redo().feature?.id === 'road-r' && reloaded.report().features === 1,
    'a redo restored from storage did not apply');
  // A v1 record is a bare array of features and still loads.
  const v1 = new PolylinePaintSession();
  v1.load(JSON.parse(JSON.stringify(saved)));
  assert(v1.report().features === 1 && v1.report().redoDepth === 0, 'a v1 record did not load');
  // A new line forks the history.
  r.redo();
  r.undo();
  r.begin('track', 5, 0, 0); r.sample(30, 0); r.end();
  assert(r.report().redoDepth === 0, 'a new line kept a stale redo');
}
