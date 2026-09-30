import {
  accepts,
  completable,
  Curriculum,
  equation,
  groupsNeed,
  LEVELS,
  levelName,
  makeChallenge,
  SYLLABI,
  overfull,
  padWitness,
  shown,
  TOP,
  YEARS,
  type Challenge,
} from '../cells/stillwater/client/challenges';

function seeded(seed: number) {
  let s = seed >>> 0;
  return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296);
}

/** The gathering that answers a challenge with dew. */
const answerOf = (c: Challenge): number[] => (c.mode !== 'groups' ? [c.answers[0]] : c.skill === 'pairs' ? [c.answers[0], c.answers[1]] : [c.a, c.b]);

describe('stillwater challenges: what is asked', () => {
  const rand = seeded(1234);
  const all: Challenge[] = [];
  for (let level = 0; level <= TOP; level++) {
    for (const skill of LEVELS[level].skills) {
      for (let form = 0; form <= 2; form++) for (let i = 0; i < 60; i++) all.push(makeChallenge(level, skill, rand, form, i / 60));
    }
  }

  test('every question is true when answered with its own dew', () => {
    for (const c of all) expect({ eq: equation(c), ok: accepts(c, answerOf(c)) }).toEqual({ eq: equation(c), ok: true });
  });

  test('the dew never has to count out more than twenty drops, nor more than six leaves of six', () => {
    for (const c of all) {
      if (c.mode !== 'groups') expect(c.answers[0]).toBeLessThanOrEqual(20);
      else {
        const { size, count } = groupsNeed(c);
        expect(size).toBeLessThanOrEqual(6);
        expect(count).toBeLessThanOrEqual(6);
      }
    }
  });

  test('times questions are equal groups or a group size, never a remainder dressed up (no "60 + ?")', () => {
    for (const c of all.filter((x) => x.mult)) {
      expect(equation(c)).not.toMatch(/\d+ \+ \? = \d+ ×|\d+ × \d+ = \d+ \+ \?$/);
      if (c.skill === 'groups') expect(c.mode).toBe('groups');
    }
  });

  test('levels follow the year: within 10, then 20, then 2/5/10 tables … all tables at Year 4', () => {
    const rand2 = seeded(9);
    for (let i = 0; i < 80; i++) {
      const b1 = makeChallenge(1, 'bond', rand2);
      expect(b1.total).toBeLessThanOrEqual(10);
      const b2 = makeChallenge(2, 'bond', rand2);
      expect(b2.total).toBeLessThanOrEqual(20);
      const t3 = makeChallenge(3, 'factor', rand2);
      expect([2, 5, 10]).toContain(t3.a);
      const t5 = makeChallenge(5, 'divide', rand2);
      expect([3, 4, 8]).toContain(t5.a);
    }
    expect(YEARS.find(([y]) => y === 'Year 1')![1]).toBe(1);
    expect(levelName(YEARS.find(([y]) => y === 'Year 4')![1], 'england')).toBe('Threes, fours and eights');
  });

  test('a new skill starts in its simplest form; the unknown moves and the equation turns round with practice', () => {
    const r = seeded(77);
    for (let i = 0; i < 40; i++) {
      const c = makeChallenge(1, 'bond', r, 0);
      expect(equation(c)).toMatch(/^\d+ \+ \? = \d+$/);
    }
    const forms = new Set<string>();
    for (let i = 0; i < 200; i++) forms.add(equation(makeChallenge(1, 'bond', r, 2)).replace(/\d+/g, 'n'));
    expect(forms).toEqual(new Set(['n + ? = n', '? + n = n', 'n = n + ?', 'n = ? + n']));
  });
});

describe('stillwater challenges: answering with dew', () => {
  const c = { ...makeChallenge(3, 'groups', seeded(3)), a: 3, b: 4, total: 12, answers: [12] };

  test('equal groups either way round; the blank shows the total', () => {
    expect(accepts(c, [3, 4])).toBe(true);
    expect(accepts(c, [4, 3])).toBe(true);
    expect(accepts(c, [2, 6])).toBe(false);
    expect(shown(c, [2, 4])).toEqual([8]);
  });

  test('too much, or the wrong size of group, is overfull', () => {
    expect(overfull(c, [1, 5])).toBe(true);
    expect(overfull(c, [4, 4])).toBe(true);
    expect(overfull(c, [2, 4])).toBe(false);
  });

  test('pairs: any equal groups that make the total', () => {
    const p = { ...makeChallenge(6, 'pairs', seeded(4)), total: 12, answers: [3, 4] };
    for (const g of [[2, 6], [6, 2], [3, 4], [4, 3]]) expect(accepts(p, g)).toBe(true);
    expect(accepts(p, [1, 12])).toBe(false);
    expect(overfull(p, [1, 5])).toBe(true);
  });

  test('completable: the rest of the drops, or enough more leaves of the size begun', () => {
    const bond = { ...makeChallenge(1, 'bond', seeded(5)), answers: [5] };
    expect(completable(bond, [2], [1, 2])).toBe(true);
    expect(completable(bond, [2], [2, 2])).toBe(false);
    expect(completable(c, [1, 4], [4, 4, 1])).toBe(true);
    expect(completable(c, [1, 4], [4, 1])).toBe(false);
    expect(padWitness([6, 1, 3], 4)).toEqual([1, 2]);
  });
});

describe('stillwater challenges: the child moves through the levels', () => {
  test('a year places the child; promotion needs clean answers on more than one day', () => {
    const cur = new Curriculum();
    cur.setYear(1); // Year 1
    expect(cur.data.level).toBe(1);
    const rand = seeded(21);
    for (let i = 0; i < 30; i++) cur.record(cur.next(rand), true, '2026-09-30');
    expect(cur.data.level).toBe(1); // one day is not enough
    for (let i = 0; i < 30 && cur.data.level === 1; i++) cur.record(cur.next(rand), true, '2026-10-01');
    expect(cur.data.level).toBe(2);
  });

  test('a level that is not holding steps back, but not below the placement', () => {
    const cur = new Curriculum();
    cur.setSyllabus('england');
    cur.setYear(3); // Year 3 → tens and ones
    const rand = seeded(8);
    // review questions (the level before) never move the level; only this level's count
    for (let i = 0; i < 12 && cur.data.level === 4; i++) cur.record(cur.next(rand), false, '2026-09-30');
    expect(cur.data.level).toBe(3);
    for (let i = 0; i < 30; i++) cur.record(cur.next(rand), false, '2026-09-30');
    expect(cur.data.level).toBe(3); // placement 4, floor 3
  });

  test('the picture fades as the skill is learned', () => {
    const cur = new Curriculum();
    cur.setLevel(1);
    const rand = seeded(2);
    const first = cur.next(rand);
    expect(first.support).toBe(1);
    for (let i = 0; i < 20; i++) cur.record(cur.next(rand), true, '2026-09-30');
    const later = cur.next(rand);
    expect(later.support).toBeLessThan(0.5);
  });

  test('old saves move to the new levels; counting still leads in', () => {
    expect(new Curriculum({ band: 4 } as never).data.level).toBe(6);
    expect(new Curriculum(null, 0.8).data.level).toBe(3);
    const cur = new Curriculum();
    cur.counted(true);
    cur.counted(true);
    cur.counted(true);
    expect(cur.data.level).toBe(0); // counting alone is not enough: the numerals too
    const rand = seeded(6);
    for (let i = 0, found = 0; i < 60 && found < 2; i++) {
      const c = cur.next(rand);
      cur.record(c, true, '2026-09-30');
      if (c.skill === 'identify') found++;
    }
    cur.counted(true);
    expect(cur.data.level).toBe(1);
    const round = new Curriculum(JSON.parse(JSON.stringify(cur.data)));
    expect(round.data).toEqual(cur.data);
  });
});

describe('stillwater challenges: numerals on the leaves, only where the numeral is the question', () => {
  test('numeral questions live at the early levels only', () => {
    for (let level = 0; level <= TOP; level++) {
      const picks = LEVELS[level].skills.filter((k) => k === 'identify' || k === 'sequence');
      if (level <= 1) expect(picks.length).toBeGreaterThan(0);
      else expect(picks).toEqual([]);
    }
  });

  test('which numeral says how many: the answer among near neighbours, all single numerals', () => {
    const r = seeded(31);
    for (let i = 0; i < 200; i++) {
      const c = makeChallenge(0, 'identify', r, i % 3, (i % 10) / 10);
      expect(c.mode).toBe('pick');
      expect(c.dots).toBe(c.answers[0]);
      expect(c.choices).toContain(c.answers[0]);
      expect(new Set(c.choices).size).toBe(c.choices!.length);
      for (const n of c.choices!) expect(n >= 1 && n <= 9).toBe(true);
      expect(accepts(c, [c.answers[0]])).toBe(true);
      expect(accepts(c, [c.choices!.find((n) => n !== c.answers[0])!])).toBe(false);
    }
  });

  test('before, after and between: the gap is the answer, and it is among the leaves', () => {
    const r = seeded(32);
    const kinds = new Set<number>();
    for (let i = 0; i < 300; i++) {
      const c = makeChallenge(1, 'sequence', r, 2);
      const at = c.seq!.indexOf(null);
      kinds.add(at);
      const run = c.seq!.map((n, j) => n ?? (j === at ? c.answers[0] : NaN));
      expect(run[1] - run[0]).toBe(1);
      expect(run[2] - run[1]).toBe(1);
      expect(c.choices).toContain(c.answers[0]);
      for (const n of c.choices!) expect(n >= 1 && n <= 9).toBe(true);
    }
    expect(kinds).toEqual(new Set([0, 1, 2]));
    // a new child starts with "what comes next"
    for (let i = 0; i < 40; i++) expect(makeChallenge(0, 'sequence', r, 0).seq![2]).toBeNull();
  });
});

describe('stillwater challenges: the syllabus is data', () => {
  test('Scotland and the US go to 10 × 10; England to 12 × 12', () => {
    expect(SYLLABI.scotland.top).toBe(10);
    expect(SYLLABI.us.top).toBe(10);
    expect(SYLLABI.england.top).toBe(12);
    const r = seeded(40);
    for (let i = 0; i < 300; i++) {
      const c = makeChallenge(6, 'factor', r, 2, 1, undefined, 'scotland');
      expect(c.a).toBeLessThanOrEqual(10);
      expect(c.b).toBeLessThanOrEqual(10);
    }
    expect(levelName(6, 'scotland')).toBe('Tables to 10');
    expect(levelName(6, 'england')).toBe('Tables to 12');
  });

  test('a Scottish P2 starts at facts within 10; the school system can change', () => {
    const cur = new Curriculum();
    expect(cur.data.syllabus).toBe('scotland');
    cur.setYear(1);
    expect(cur.syllabus.years[1][0]).toBe('P2');
    expect(cur.data.level).toBe(1);
    expect(cur.describe()).toBe('Facts within 10 · First level (P2)');
    cur.setSyllabus('us');
    expect(cur.describe()).toBe('Facts within 10 · Grade 1');
  });
});

describe('stillwater challenges: dew first, then numerals', () => {
  test("a skill's leaves stay dew until it is answered cleanly with dew, then show numerals", () => {
    const cur = new Curriculum();
    cur.setSyllabus('england');
    cur.setLevel(1);
    const rand = seeded(50);
    const seen: Record<string, Array<'dew' | 'numerals'>> = {};
    for (let i = 0; i < 60; i++) {
      const c = cur.next(rand);
      (seen[c.skill] ??= []).push(c.leaves);
      cur.record(c, true, '2026-09-30');
      if (cur.data.level !== 1) break;
    }
    const bond = seen.bond;
    expect(bond.slice(0, 4)).toEqual(['dew', 'dew', 'dew', 'dew']);
    expect(bond.slice(4).every((l) => l === 'numerals')).toBe(true);
  });

  test('help or a slip does not count as proof with dew', () => {
    const cur = new Curriculum();
    cur.setLevel(1);
    const rand = seeded(51);
    for (let i = 0; i < 20; i++) cur.record(cur.next(rand), false, '2026-09-30');
    expect(cur.next(rand).leaves).toBe('dew');
  });

  test('as numerals, equal groups can be sevens, eights and nines (never more than six leaves)', () => {
    const r = seeded(52);
    const sizes = new Set<number>();
    for (let i = 0; i < 400; i++) {
      const c = makeChallenge(6, 'groups', r, 2, 1, undefined, 'england', true);
      const { size, count } = groupsNeed(c);
      expect(size).toBeLessThanOrEqual(9);
      expect(count).toBeLessThanOrEqual(6);
      expect(accepts(c, [count, size])).toBe(true);
      sizes.add(size);
    }
    expect([7, 8, 9].every((n) => sizes.has(n))).toBe(true);
  });
});
