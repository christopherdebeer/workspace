import { elegance, expectedSecs, factOf, Memory, parseKey, quality, recall, solutionFor, Stretch } from '../cells/stillwater/client/learning';
import { layDrops, seeded } from '../cells/stillwater/client/world';

const MIN = 60_000;

describe('stillwater: facts', () => {
  test('a sum fact is its parts, in any order', () => {
    expect(factOf('sum', [4, 3]).key).toBe('s:3+4');
    expect(factOf('sum', [3, 4]).key).toBe('s:3+4');
    expect(parseKey('s:2+3+4')).toMatchObject({ rule: 'sum', value: 9, parts: [2, 3, 4] });
  });

  test('a product is one fact both ways round, but remembers the way it was made', () => {
    const a = factOf('groups', [4, 4, 4]); // three leaves of four
    const b = factOf('groups', [3, 3, 3, 3]); // four leaves of three
    expect(a.key).toBe('g:3x4');
    expect(b.key).toBe(a.key);
    expect(a.parts).toEqual([3, 4]);
    expect(b.parts).toEqual([4, 3]);
    const m = new Memory();
    expect(m.record(a, 1, 0).newWay).toBe(false);
    expect(m.record(a, 1, MIN).newWay).toBe(false);
    expect(m.record(b, 1, 2 * MIN).newWay).toBe(true);
    expect(m.record(b, 1, 3 * MIN).newWay).toBe(false);
  });
});

describe('stillwater: spaced memory', () => {
  const f = factOf('sum', [3, 4]);

  test('recall fades with time; a clean answer lengthens the half-life, a struggle shortens it', () => {
    const m = new Memory();
    m.record(f, 1, 0);
    const h0 = m.get(f.key)!.h;
    expect(recall(m.get(f.key)!, 0)).toBeCloseTo(1);
    expect(recall(m.get(f.key)!, h0 * 1000)).toBeCloseTo(0.5);
    m.record(f, 1, 5 * MIN);
    const h1 = m.get(f.key)!.h;
    expect(h1).toBeGreaterThan(h0 * 1.5);
    m.record(f, 0.3, 6 * MIN);
    expect(m.get(f.key)!.h).toBeLessThan(h1);
  });

  test('the spacing effect: recalling a nearly-forgotten fact strengthens it more than a fresh one', () => {
    const soon = new Memory();
    const late = new Memory();
    soon.record(f, 1, 0);
    late.record(f, 1, 0);
    soon.record(f, 1, 1 * MIN);
    late.record(f, 1, 20 * MIN);
    expect(late.get(f.key)!.h).toBeGreaterThan(soon.get(f.key)!.h);
  });

  test('a fact comes due once its recall has faded, not straight away, and only in band', () => {
    const m = new Memory();
    m.record(f, 1, 0);
    const all = () => true;
    expect(m.due(10_000, all)).toHaveLength(0);
    expect(m.due(30 * MIN, all).map((x) => x.key)).toEqual([f.key]);
    expect(m.due(30 * MIN, () => false)).toHaveLength(0);
  });

  test('shaky facts come before solid ones', () => {
    const m = new Memory();
    const shaky = factOf('sum', [2, 5]);
    m.record(shaky, 0.3, 0);
    for (let i = 0; i < 4; i++) m.record(f, 1, i * 10 * MIN);
    const due = m.due(10 * 86400_000, () => true);
    expect(due[0].key).toBe(shaky.key);
  });

  test('saved and restored', () => {
    const m = new Memory();
    m.record(f, 1, 0);
    const back = new Memory(JSON.parse(JSON.stringify(m)));
    expect(back.get(f.key)).toEqual(m.get(f.key));
  });
});

describe('stillwater: fluency', () => {
  test('a quick clean answer is fluent; slow, corrected or helped answers are not', () => {
    const base = { leaves: 2, value: 7, friction: 0, scaffold: 0, counting: false };
    const e = expectedSecs(base);
    expect(quality({ ...base, secs: e })).toBeGreaterThanOrEqual(0.85);
    expect(quality({ ...base, secs: e * 3 })).toBeLessThan(0.85);
    expect(quality({ ...base, secs: e, friction: 1 })).toBeLessThan(0.85);
    expect(quality({ ...base, secs: e, scaffold: 1 })).toBeLessThan(0.85);
  });

  test('counting stages allow time per drop', () => {
    expect(expectedSecs({ leaves: 2, value: 5, counting: true })).toBeGreaterThan(expectedSecs({ leaves: 2, value: 5, counting: false }));
  });
});

describe('stillwater: solutions and elegance', () => {
  test('finds the fewest-leaf answer, or one with exactly n leaves', () => {
    const counts = [1, 2, 3, 4, 0, 6];
    const s = solutionFor('sum', counts, 10, 4)!;
    expect(s.map((i) => counts[i]).reduce((a, b) => a + b, 0)).toBe(10);
    expect(s).toHaveLength(2);
    const three = solutionFor('sum', counts, 10, 4, 3)!;
    expect(three).toHaveLength(3);
    expect(solutionFor('sum', counts, 30, 4)).toBeNull();
  });

  test('groups need matching leaves', () => {
    const counts = [3, 4, 3, 4, 4, 2];
    const s = solutionFor('groups', counts, 12, 4)!;
    expect(s.map((i) => counts[i])).toEqual([4, 4, 4]);
    expect(solutionFor('groups', [3, 4, 2], 12, 4)).toBeNull();
  });

  test('notices a bond, a double, bridging through ten and a product made the other way', () => {
    const e1 = elegance('sum', [6, 4], [1, 2, 3], 4, 1, false);
    expect(e1.fewest).toBe(true);
    expect(e1.double).toBe(false);
    expect(elegance('sum', [4, 4], [], 4, 1, false).double).toBe(true);
    expect(elegance('sum', [7, 3, 2], [], 4, 1, false).ten).toBe(true);
    expect(elegance('sum', [7, 2, 3], [], 4, 1, false).ten).toBe(false);
    expect(elegance('groups', [3, 3, 3, 3], [], 4, 1, true).bothWays).toBe(true);
    // a pile of small leaves when one pair would have done is not the fewest
    expect(elegance('sum', [2, 3, 5], [6, 4], 4, 1, false).fewest).toBe(false);
  });
});

describe('stillwater: stretches', () => {
  test('warm, reach, consolidate, relief, finale', () => {
    const s = new Stretch(null);
    const seen: string[] = [];
    while (!s.done) {
      seen.push(s.phase);
      if (s.phase === 'finale') s.finished();
      else s.answered({ q: 1, friction: 0 });
    }
    expect(seen).toEqual(['warm', 'reach', 'consolidate', 'relief', 'relief', 'finale']);
  });

  test('a smooth stretch reaches twice next time; a hard reach earns another breather', () => {
    const a = new Stretch(null);
    while (a.phase !== 'finale') a.answered({ q: 1, friction: 0 });
    const b = new Stretch(a);
    expect(b.phases.filter((p) => p === 'reach')).toHaveLength(2);
    const c = new Stretch(null);
    c.answered({ q: 1, friction: 0 }); // warm
    c.answered({ q: 0.3, friction: 2 }); // reach, struggled
    expect(c.phases.filter((p) => p === 'relief')).toHaveLength(3);
  });

  test('coming back after a gap starts with a longer warm-up', () => {
    expect(new Stretch(null, true).phases.slice(0, 2)).toEqual(['warm', 'warm']);
  });
});


describe('stillwater: patterned dew (P8)', () => {
  test('1–7 drops laid as a pattern: all there, on the leaf, clear of the notch, not touching', () => {
    const rand = seeded(5);
    for (let n = 1; n <= 7; n++) {
      for (const r of [22, 30, 44]) {
        const drops = layDrops(n, r, rand, true);
        expect(drops).toHaveLength(n);
        for (const d of drops) {
          expect(Math.hypot(d.x, d.y) + d.r).toBeLessThanOrEqual(0.75);
          const inNotch = Math.hypot(d.x, d.y) > 0.12 && Math.abs(Math.atan2(d.x, d.y)) < 0.42;
          expect(inNotch).toBe(false);
        }
        for (let i = 0; i < n; i++)
          for (let j = i + 1; j < n; j++) expect(Math.hypot(drops[i].x - drops[j].x, drops[i].y - drops[j].y)).toBeGreaterThan(drops[i].r + drops[j].r);
      }
    }
  });
});
