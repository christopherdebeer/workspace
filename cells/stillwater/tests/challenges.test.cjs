// Run after bundling client/challenges.ts to /tmp/stillwater-challenges.cjs:
//   esbuild client/challenges.ts --bundle --platform=node --format=cjs --outfile=/tmp/stillwater-challenges.cjs
// The fuller suite is tests/stillwater-challenges.test.ts in the workspace (jest).
const assert = require('node:assert/strict');
const C = require('/tmp/stillwater-challenges.cjs');
let seed = 67890;
const rand = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);
const answerOf = (c) => (c.mode === 'sum' ? [c.answers[0]] : c.skill === 'pairs' ? c.answers : [c.a, c.b]);
let tested = 0;
for (let level = 1; level <= C.TOP; level++)
  for (const skill of C.LEVELS[level].skills)
    for (let form = 0; form <= 2; form++)
      for (let i = 0; i < 100; i++) {
        const c = C.makeChallenge(level, skill, rand, form, i / 100);
        assert(C.accepts(c, answerOf(c)), C.equation(c));
        if (c.mode === 'sum') assert(c.answers[0] <= 20 && !C.accepts(c, [c.answers[0] + 1]), C.equation(c));
        else {
          const n = C.groupsNeed(c);
          assert(n.size <= 6 && n.count <= 6, C.equation(c));
        }
        tested++;
      }
// promotion needs more than one day; a year places the child
const cur = new C.Curriculum();
cur.setYear(1);
for (let i = 0; i < 40; i++) cur.record(cur.next(rand), true, '2026-09-30');
assert.equal(cur.data.level, 1, 'one day of clean answers is not enough to move on');
for (let i = 0; i < 40 && cur.data.level === 1; i++) cur.record(cur.next(rand), true, '2026-10-01');
assert.equal(cur.data.level, 2);
console.log(`PASS ${tested} generated questions; year placement; promotion across days`);
