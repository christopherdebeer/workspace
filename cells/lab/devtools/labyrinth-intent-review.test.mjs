import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { review, writeJSON, readJSON } from './labyrinth-intent-review.mjs';
function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'intent-review-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  writeJSON(join(root, 'manifest.json'), { schema: 'labyrinth-intent/2', complete: true, ids: ['land3-1', 'land3-2'] });
  for (const id of ['land3-1', 'land3-2']) {
    const dir = join(root, 'sealed', id); mkdirSync(dir, { recursive: true });
    writeJSON(join(dir, 'before.json'), { id, gesture: 'a stroke' });
    writeFileSync(join(dir, 'before.jpg'), 'BEFORE'); writeFileSync(join(dir, 'after.jpg'), 'SECRET RESULT');
    writeJSON(join(dir, 'result.json'), { id, why: 'SECRET RESULT' });
  }
  return root;
}
function expectation(root) {
  const next = review(root, 'next');
  const e = { id: next.id, reviewer: 'test', blind: true, sceneReading: 'Two terraces', hypotheses: [{ id: 'h1', intent: 'Join them', visibleEvidence: 'Stroke starts and ends on terraces', plausibility: 0.8, successCriteria: ['A continuous route'] }], preferred: 'h1', mustPreserve: ['The court'], unacceptable: ['A blocked entrance'], ambiguities: [], expectedFeedback: 'A route preview' };
  writeJSON(next.expectation, e); review(root, 'expect'); return e;
}
test('before stage exposes no result and reveal is gated', t => {
  const root = fixture(t), next = review(root, 'next');
  assert(!JSON.stringify(next).includes('SECRET'));
  assert(!existsSync(join(root, 'reviews', 'land3-1', 'after.jpg')));
  assert.throws(() => review(root, 'reveal'));
  assert.throws(() => review(root, 'expect'), /reviewer/);
});
test('expectation is exclusive and packet tampering prevents reveal', t => {
  const root = fixture(t); expectation(root);
  assert.throws(() => review(root, 'expect'), /EEXIST/);
  writeFileSync(join(root, 'sealed', 'land3-1', 'before.jpg'), 'CHANGED');
  assert.throws(() => review(root, 'reveal'), /changed/);
});
test('reveal requires critique before exposing the next cumulative scene', t => {
  const root = fixture(t); expectation(root);
  const revealed = review(root, 'reveal'); assert(existsSync(revealed.image));
  assert.throws(() => review(root, 'next'), /Finish/);
  assert.throws(() => review(root, 'expect'), /already revealed/);
  assert.equal(review(root, 'status').active, 'land3-1');
});
test('criterion validation and complete workflow advance only after commitment', t => {
  const root = fixture(t); expectation(root);
  const revealed = review(root, 'reveal'), c = readJSON(revealed.critique);
  Object.assign(c, { reviewer: 'test', verdict: 'partial', matchedHypothesis: 'h1', observed: 'A route stops short', delta: 'Destination missed', evidence: 'after.jpg endpoint', preservation: 'Court remains', feedback: 'Unknown: no video', recovery: 'Not exercised', nextExperiment: 'Try a straighter stroke' });
  writeJSON(revealed.critique, c);
  assert.throws(() => review(root, 'critique'), /criterion needs/);
  c.criteria[0].result = 'missed'; c.criteria[0].evidence = 'Visible gap';
  writeJSON(revealed.critique, c); review(root, 'critique');
  assert.equal(review(root, 'next').id, 'land3-2');
  assert.equal(review(root, 'status').reviewed, 1);
});
test('result changes after reveal are detected', t => {
  const root = fixture(t); expectation(root); review(root, 'reveal');
  writeFileSync(join(root, 'sealed', 'land3-1', 'after.jpg'), 'CHANGED');
  assert.throws(() => review(root, 'reveal'), /changed/);
});
test('incomplete captures cannot be reviewed', t => {
  const root = fixture(t), m = readJSON(join(root, 'manifest.json')); m.complete = false;
  writeJSON(join(root, 'manifest.json'), m); assert.throws(() => review(root, 'next'), /incomplete/);
});
test('an authored intent is shown only after the critique is locked, and the next gesture waits on its judgment', t => {
  const root = fixture(t);
  writeJSON(join(root, 'sealed', 'land3-1', 'authored.json'), { id: 'land3-1', recipe: 'cross', intent: 'SECRET INTENT: a way across the stream' });
  const next = review(root, 'next'); assert(!JSON.stringify(next).includes('SECRET'));
  assert(!existsSync(join(root, 'reviews', 'land3-1', 'authored.json')));
  expectation(root);
  assert.throws(() => review(root, 'author'), /critique/);
  const revealed = review(root, 'reveal'), c = readJSON(revealed.critique);
  Object.assign(c, { reviewer: 'test', verdict: 'partial', matchedHypothesis: 'h1', observed: 'o', delta: 'd', evidence: 'e', preservation: 'p', feedback: 'f', recovery: 'r', nextExperiment: 'n' });
  c.criteria[0].result = 'met'; c.criteria[0].evidence = 'seen'; writeJSON(revealed.critique, c);
  assert.match(review(root, 'critique').instruction, /author/);
  assert.match(review(root, 'next').instruction, /author/);
  assert.equal(review(root, 'status').reviewed, 0);
  const a = review(root, 'author'), j = readJSON(a.judgment);
  assert.match(JSON.stringify(readJSON(a.authored)), /a way across/);
  assert.throws(() => review(root, 'judge'), /reviewer/);
  Object.assign(j, { reviewer: 'test', recovered: 'partly', recoveredBy: 'h1', toyVerdict: 'partial', evidence: 'e', gap: 'g' }); writeJSON(a.judgment, j);
  review(root, 'judge');
  assert.equal(review(root, 'next').id, 'land3-2');
  assert.equal(review(root, 'status').reviewed, 1);
});
