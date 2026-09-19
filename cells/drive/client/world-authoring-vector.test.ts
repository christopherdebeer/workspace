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

  restored.load([{ nope: true }, ...saved]);
  assert(restored.report().features === 1, 'invalid persisted entries were not ignored');
  assert(restored.reset().changed === 2 && restored.report().features === 0,
    'reset did not clear source features');
}

