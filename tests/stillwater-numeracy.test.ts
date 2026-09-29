import { canSum, chooseTarget, groupings, judge, repair, solvable, STAGES, numberWord } from '../cells/stillwater/client/numeracy';

const stage = (id: string) => STAGES.find((s) => s.id === id)!;
const seq = (...xs: number[]) => {
  let i = 0;
  return () => xs[i++ % xs.length];
};
const lcg = (seed: number) => () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);

describe('stillwater numeracy', () => {
  test('canSum respects the part limit', () => {
    expect(canSum([1, 2, 3], 6, 3)).toBe(true);
    expect(canSum([1, 2, 3], 6, 2)).toBe(false);
    expect(canSum([4, 4], 8, 2)).toBe(true);
    expect(canSum([4], 8, 3)).toBe(false); // each leaf counts once
    expect(canSum([0, 0, 5], 5, 1)).toBe(true);
  });

  test('groupings finds every equal split the leaves support', () => {
    // three leaves of 3 cover 3×2; two leaves of 2 cannot make 2×3
    expect(groupings([3, 3, 3, 2, 2], 6, 4)).toEqual([[3, 2]]);
    expect(groupings([2, 2, 2, 3, 3], 6, 4)).toEqual(expect.arrayContaining([[2, 3], [3, 2]]));
    expect(groupings([1, 1, 1, 1], 4, 4)).toEqual([]); // groups of one are not groups
    expect(groupings([5, 5], 15, 4)).toEqual([]);
  });

  test('chooseTarget only asks for what the leaves in view can make', () => {
    for (const st of STAGES) {
      const rand = lcg(st.id.length * 97);
      for (let trial = 0; trial < 200; trial++) {
        const counts = Array.from({ length: 8 }, () => (rand() < 0.4 ? 0 : 1 + Math.floor(rand() * st.maxDrops)));
        const t = chooseTarget(st, counts, rand);
        if (!t) continue;
        expect(t.value).toBeGreaterThanOrEqual(st.min);
        expect(t.value).toBeLessThanOrEqual(st.max);
        expect(solvable(st, counts, t.value)).toBe(true);
        if (st.rule === 'groups') expect(t.rows! * t.cols!).toBe(t.value);
      }
    }
  });

  test('chooseTarget avoids repeating the last target when it can', () => {
    const st = stage('add');
    const t = chooseTarget(st, [3, 4, 5, 2], seq(0.1, 0.9, 0.3, 0.6, 0.2), 7);
    expect(t?.value).not.toBe(7);
  });

  test('repair condenses dew on empty leaves until the target is makeable', () => {
    for (const st of STAGES) {
      const rand = lcg(11 + st.max);
      for (let trial = 0; trial < 200; trial++) {
        const counts = Array.from({ length: 10 }, () => (rand() < 0.6 ? 0 : 1 + Math.floor(rand() * st.maxDrops)));
        const value = st.min + Math.floor(rand() * (st.max - st.min + 1));
        const fix = repair(st, counts, value);
        if (!fix) continue;
        const after = counts.slice();
        for (const [i, c] of fix) {
          expect(counts[i]).toBe(0); // only dry leaves take new dew
          expect(c).toBeGreaterThanOrEqual(1);
          expect(c).toBeLessThanOrEqual(st.maxDrops);
          after[i] = c;
        }
        expect(solvable(st, after, value)).toBe(true);
      }
    }
  });

  test('judge: sums', () => {
    const st = stage('add');
    expect(judge(st, 7, [3])).toEqual({ kind: 'partial', gathered: 3 });
    expect(judge(st, 7, [3, 4])).toEqual({ kind: 'solved', gathered: 7 });
    expect(judge(st, 7, [3, 5])).toEqual({ kind: 'over', gathered: 8 });
  });

  test('judge: equal groups', () => {
    const st = stage('groups');
    expect(judge(st, 12, [4, 4])).toEqual({ kind: 'partial', gathered: 8 });
    expect(judge(st, 12, [4, 4, 4])).toEqual({ kind: 'solved', gathered: 12 });
    expect(judge(st, 12, [4, 3])).toEqual({ kind: 'mismatch', gathered: 3 });
    expect(judge(st, 4, [4]).kind).toBe('over'); // one leaf is not a group
    expect(judge(stage('times'), 18, [6, 6, 6]).kind).toBe('solved');
    expect(judge(stage('times'), 18, [3, 3, 3, 3, 3, 3]).kind).toBe('solved');
  });

  test('numberWord', () => {
    expect(numberWord(7)).toBe('seven');
    expect(numberWord(20)).toBe('twenty');
    expect(numberWord(24)).toBe('twenty-four');
    expect(numberWord(30)).toBe('thirty');
  });
});
