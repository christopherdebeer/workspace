/**
 * jev · lab — the pure halves of the experiments (cells/jev/client/lib):
 * free-text decoders and the Interface 00a spec builder. No network, no DOM.
 */
import {
  CHARSET,
  END,
  SPACE,
  WORDS,
  acceptLookahead,
  appendWord,
  collapse,
  glyph,
  lookaheadQuestions,
  superposeQuestions,
  wordQuestion,
  NONE,
  bestOfShards,
  gateLetters,
  parseLexicon,
  shardQuestions,
} from '../cells/jev/client/lib/decode';
import { chunkBySize, type Answers, type ChoiceQ, type Questions } from '../cells/jev/client/lib/types';
import * as A from '../cells/jev/client/lib/answer';
import * as P from '../cells/jev/client/lib/program';
import * as I from '../cells/jev/client/lib/image';

const choiceCount = (q: unknown) => Object.keys((q as ChoiceQ).criteria).length;

describe('decode: vocabularies fit a Jev choice (≤255 options)', () => {
  it('charset, word vocabulary and candidate lists stay within 255', () => {
    expect(CHARSET.length).toBeLessThanOrEqual(255);
    expect(choiceCount(wordQuestion())).toBeLessThanOrEqual(255);
    expect(new Set(WORDS).size).toBe(WORDS.length);
  });

  it('glyph maps control tokens to output text', () => {
    expect(glyph(SPACE)).toBe(' ');
    expect(glyph(END)).toBe('');
    expect(glyph('a')).toBe('a');
    expect(appendWord('', 'hello')).toBe('hello');
    expect(appendWord('hello', 'world')).toBe('hello world');
  });
});

describe('decode: lookahead acceptance', () => {
  const ans = (...xs: Array<[string, number]>) => Object.fromEntries(xs.map(([c, p], i) => [`c${i}`, { choice: c, confidence: p }]));

  it('always accepts the first position, then only confident ones', () => {
    const r = acceptLookahead(ans(['c', 0.3], ['a', 0.9], ['n', 0.4], ['b', 0.99]), 4, 0.6);
    expect(r.tokens.map((t) => t.tok).join('')).toBe('ca');
    expect(r.done).toBe(false);
  });

  it('stops at END and reports done', () => {
    const r = acceptLookahead(ans(['s', 0.9], [END, 0.9], ['x', 0.9]), 3, 0.5);
    expect(r.tokens.map((t) => t.tok)).toEqual(['s', END]);
    expect(r.done).toBe(true);
  });

  it('asks k named parallel questions', () => {
    expect(Object.keys(lookaheadQuestions(5))).toEqual(['c0', 'c1', 'c2', 'c3', 'c4']);
  });
});

describe('decode: superposition collapses to the winning kind', () => {
  it('asks every decoder in one question set', () => {
    const qs = superposeQuestions();
    expect(qs.kind).toBeDefined();
    expect(qs.d6).toBeDefined();
    expect(qs.y3).toBeDefined();
  });

  it('reads a number from its digit slots, stripping leading zeros', () => {
    const c = collapse({
      kind: { choice: 'number', confidence: 0.8 },
      ndigits: { choice: '3' },
      d0: { choice: '0' },
      d1: { choice: '4' },
      d2: { choice: '2' },
      negative: { noul: 0.1 },
    });
    expect(c.text).toBe('42');
  });

  it('reads yes/no and years; defers words to spelling', () => {
    expect(collapse({ kind: { choice: 'yesno' }, yes: { noul: 0.9 } }).text).toBe('yes');
    expect(collapse({ kind: { choice: 'year' }, y0: { choice: '1' }, y1: { choice: '9' }, y2: { choice: '8' }, y3: { choice: '9' }, ce: { choice: 'CE' } }).text).toBe('1989');
    const w = collapse({ kind: { choice: 'word' }, first: { choice: 'c' } });
    expect(w.text).toBeNull();
    expect(w.seed).toBe('c');
  });
});

describe('decode: recognise (gate + sharded lexicon)', () => {
  it('parses the lexicon: alphabetic, deduped, frequency order kept, blocklist dropped', () => {
    expect(parseLexicon('the\nOf\nof\nfuck\ncanberra\nx-ray\n\n')).toEqual(['the', 'of', 'canberra']);
  });

  it('gates on the letters covering most of the probability mass, or ends', () => {
    expect(gateLetters({ probabilities: { c: 0.43, a: 0.12, s: 0.06, n: 0.05, [END]: 0.01 } }, 0.5, 3).letters).toEqual(['c', 'a']);
    expect(gateLetters({ probabilities: { c: 0.2, a: 0.2, s: 0.2, n: 0.2 } }, 0.9, 3).letters).toHaveLength(3);
    expect(gateLetters({ probabilities: { [END]: 0.7, a: 0.3 } }).end).toBe(true);
  });

  it('shards matching words into ≤255-option choices with a (none) escape, capped', () => {
    const lex = Array.from({ length: 600 }, (_, i) => `c${'x'.repeat(i % 7)}${i}`.replace(/\d/g, (d) => 'abcdefghij'[Number(d)]));
    const { questions, shards } = shardQuestions(['apple', ...lex, 'zebra'], ['c']);
    expect(shards.map((s) => s.length)).toEqual([254, 254, 92]);
    expect(Object.keys(questions)).toEqual(['s0', 's1', 's2']);
    for (const q of Object.values(questions)) {
      expect(Object.keys((q as ChoiceQ).criteria).length).toBeLessThanOrEqual(255);
      expect((q as ChoiceQ).criteria).toHaveProperty(NONE);
    }
    expect(shardQuestions(lex, ['c'], 1).shards).toHaveLength(1);
  });

  it('takes the most confident real word; abstaining shards are ignored (live canberra shape)', () => {
    expect(bestOfShards({ s0: { choice: NONE, confidence: 0.75 }, s1: { choice: 'canberra', confidence: 0.99 } }, 2)).toEqual({ tok: 'canberra', p: 0.99 });
    expect(bestOfShards({ s0: { choice: NONE, confidence: 0.9 } }, 1)).toBeNull();
  });
});

/* ── answer: the free-text engine, driven by a scripted fake Jev ─────── */

/** A fake Jev that knows one answer: it recognises its words in any list and verifies it exactly. */
function fakeJev(truth: string, kind: A.Kind = 'word') {
  const words = truth.split(' ');
  const answerQ = (q: Questions[string]): Answers[string] => {
    const inst = q.instructions ?? '';
    if (q.type === 'noul') {
      const m = inst.match(/"(.+?)" EXACTLY right/);
      return { noul: m ? (m[1] === truth ? 0.95 : words.every((w) => m[1].split(' ').includes(w)) ? 0.6 : 0.1) : 0.5 };
    }
    const opts = q.type === 'choice' ? Object.keys(q.criteria) : q.criteria;
    if (inst.startsWith('What kind of answer')) return { choice: kind, confidence: 0.9, probabilities: { [kind]: 0.9 } };
    // Like the real model: probability spread over EVERY answer word in the list.
    const hits = opts.filter((o) => words.includes(o));
    if (hits.length) return { choice: hits[0], confidence: 0.9 / hits.length, probabilities: { ...Object.fromEntries(hits.map((h) => [h, 0.9 / hits.length])), '(none)': 0.1 } };
    return { choice: '(none)', confidence: 0.8, probabilities: { '(none)': 0.8 } };
  };
  const calls: string[] = [];
  const deps: A.Deps = {
    lexicon: async () => ['the', 'of', ...words, 'paris', 'river', 'thomas'],
    decide: async (_s, qs, label) => (calls.push(label), Object.fromEntries(Object.entries(qs).map(([k, q]) => [k, answerQ(q)]))),
    decideMany: async (items, label) => (calls.push(label), items.map((it) => Object.fromEntries(Object.entries(it.questions).map(([k, q]) => [k, answerQ(q)])))),
  };
  return { deps, calls };
}

describe('answer: bag → compose → verify', () => {
  it('composes every ordering of ≤3 distinct bag words', () => {
    const c = A.compose(['a', 'b', 'c']);
    expect(c).toHaveLength(3 + 6 + 6);
    expect(c).toContain('c a b');
    expect(A.compose(Array.from({ length: 8 }, (_, i) => `w${i}`))).toHaveLength(8 + 56 + 336);
  });

  it('recovers a multi-word answer in three round trips (route, bag scan, verify)', async () => {
    const { deps, calls } = fakeJev('leonardo da vinci');
    const r = await A.answer('Who painted the Mona Lisa?', deps);
    expect(r.answer.text).toBe('leonardo da vinci');
    expect(calls).toEqual(['route', 'bag scan', 'compose+verify ×400'.replace('400', String(A.compose(['leonardo', 'da', 'vinci']).length))]);
  });

  it('ranks by verification, preferring the shorter answer only on a near-tie', () => {
    const r = A.rank([
      { text: 'carbon dioxide gas', score: 0.9, verified: 0.93 },
      { text: 'carbon dioxide', score: 0.8, verified: 0.95 },
      { text: 'dioxide', score: 0.9, verified: 0.95 },
    ]);
    expect(r.map((c) => c.text)).toEqual(['dioxide', 'carbon dioxide', 'carbon dioxide gas']);
  });

  it('ranks scan words by their share among real words, so a word losing only to (none) survives', () => {
    const c = A.candidatesFromScan([{ s0: { probabilities: { graham: 0.24, '(none)': 0.33, bi: 0.1 } }, s1: { probabilities: { scott: 0.5, '(none)': 0.0 } } }], 4);
    // graham loses its shard to (none) (0.24 vs 0.33) yet is kept, at its share among real words.
    expect(c.find((x) => x.word === 'graham')?.p).toBeCloseTo(0.24 / 0.67, 2);
    expect(c.map((x) => x.word)).toEqual(['scott', 'graham']);
  });

  it('cloze blanks cover insertions and substitutions without repeating kept words', () => {
    const t = A.clozeTemplates('alexander thomas bell');
    expect(t.map((x) => x.template)).toEqual(
      expect.arrayContaining(['alexander ___ bell', '___ alexander thomas bell', 'alexander thomas bell ___']),
    );
    const sub = t.find((x) => x.template === 'alexander ___ bell')!;
    expect(sub.fill('graham')).toBe('alexander graham bell');
    expect(sub.keep).toEqual(['alexander', 'bell']);
  });

  it('numbers: ≤254 buckets per level, recursing to a single value', () => {
    expect(A.buckets(0, 9)).toHaveLength(10);
    const b = A.buckets(1000, 9999);
    expect(b.length).toBeLessThanOrEqual(254);
    expect(b[0]).toMatchObject({ lo: 1000 });
    expect(b[b.length - 1].hi).toBe(9999);
  });

  it('merges bags by max confidence', () => {
    expect(A.mergeBags([{ word: 'jane', p: 0.9 }, { word: 'austin', p: 0.6 }], [{ word: 'austen', p: 0.8 }]).map((b) => b.word)).toEqual(['jane', 'austen', 'austin']);
  });
});

describe('transport: size-capped envelopes', () => {
  it('splits by serialized size and item count, preserving order', () => {
    const items = Array.from({ length: 10 }, (_, i) => ({ i, pad: 'x'.repeat(100) }));
    const g = chunkBySize(items, 350, 200);
    expect(g.flat()).toEqual(items.map((_, i) => i));
    expect(g.every((x) => x.length <= 3)).toBe(true);
    expect(chunkBySize(items, 1e9, 4).map((x) => x.length)).toEqual([4, 4, 2]);
  });
});

/* ── program: synthesis, the reducer, commands and edits ──────────────── */

const spec = (over: Partial<P.AppSpec> = {}): P.AppSpec => ({
  title: 'T',
  mood: 'calm',
  noun: 'task',
  fields: [
    { id: 'status', label: 'Status', type: 'enum', options: ['todo', 'doing', 'done'] },
    { id: 'amount', label: 'Amount', type: 'money' },
  ],
  scalars: [],
  stats: [],
  actions: [],
  ...over,
});

describe('program: synthesis', () => {
  it('the joint shape decides structure: a counter app gets no list', () => {
    const d = P.draftFrom({ shape: { choice: 'counter' }, noun: { choice: 'glass' }, 'f:done': { noul: 0.9 }, title: { choice: 'Water' } });
    expect(d).toMatchObject({ noun: '', fields: [], scalars: ['counter'] });
  });

  it('status subsumes done', () => {
    const d = P.draftFrom({ shape: { choice: 'list' }, noun: { choice: 'task' }, 'f:done': { noul: 0.9 }, 'f:status': { noul: 0.9 } });
    expect(d.fields.map((f) => f.id)).toEqual(['status']);
  });

  it('only type-valid stats and actions are ever offered', () => {
    const d = { title: 'T', mood: 'calm', noun: 'expense', fields: [{ id: 'amount', label: 'Amount', type: 'money' as const }], scalars: ['budget' as const] };
    const ids = P.possibleStats(d).map((s) => s.id);
    expect(ids).toEqual(expect.arrayContaining(['count', 'sum:amount', 'avg:amount', 'remaining']));
    expect(ids).not.toContain('progress:done');
    expect(P.possibleActions(d).map((a) => a.id)).toEqual(['sort:amount']);
  });

  it('synthesizes a spec end to end from two parallel passes', async () => {
    const decide: P.Decide = async (_s, qs) =>
      Object.fromEntries(
        Object.entries(qs).map(([k, q]) => {
          if (k === 'shape') return [k, { choice: 'list+budget' }];
          if (k === 'noun') return [k, { choice: 'expense' }];
          if (k === 'f:amount' || k === 'f:category') return [k, { noul: 0.9 }];
          if (k.startsWith('cat')) return [k, { noul: /food|transport/.test(q.instructions ?? '') ? 0.9 : 0.1 }];
          if (k === 't:budget') return [k, { choice: '500' }];
          if (k.startsWith('st:')) return [k, { noul: 0.9 }];
          return [k, q.type === 'noul' ? { noul: 0.1 } : { choice: q.type === 'choice' ? Object.keys(q.criteria)[0] : undefined }];
        }),
      );
    const s = await P.synthesize('track spending on food and transport against a budget', decide);
    expect(s.noun).toBe('expense');
    expect(s.fields.find((f) => f.id === 'category')?.options).toEqual(expect.arrayContaining(['food', 'transport']));
    expect(s.scalars).toEqual([expect.objectContaining({ kind: 'budget', target: 500 })]);
    expect(s.stats.map((x) => x.id)).toContain('remaining');
  });
});

describe('program: the reducer is the type gate', () => {
  it('adds, coerces, sets and removes', () => {
    const sp = spec();
    let st = P.apply(sp, P.initialState(sp), { op: 'add', name: 'coffee', values: { amount: '4.5', status: 'bogus' } });
    const it = st.items[0];
    expect(it).toMatchObject({ name: 'coffee', amount: 4.5, status: 'todo' });
    st = P.apply(sp, st, { op: 'set', id: it.id, field: 'status', value: 'done' });
    expect(st.items[0].status).toBe('done');
    expect(P.apply(sp, st, { op: 'set', id: it.id, field: 'status', value: 'nope' })).toBe(st);
    expect(P.apply(sp, st, { op: 'remove', id: it.id }).items).toHaveLength(0);
  });

  it('counters floor at zero; timers tick down and count cycles', () => {
    const sp = spec({ noun: '', fields: [], scalars: [{ id: 'counter', kind: 'counter', label: 'Water', target: 8 }, { id: 'timer', kind: 'timer', label: 'Focus', target: 1 }] });
    let st = P.initialState(sp);
    st = P.apply(sp, st, { op: 'inc', scalar: 'counter', by: -3 });
    expect(st.scalars.counter).toBe(0);
    st = P.apply(sp, st, { op: 'timer', scalar: 'timer', action: 'start' });
    for (let i = 0; i < 60; i++) st = P.apply(sp, st, { op: 'timer', scalar: 'timer', action: 'tick' });
    expect(st.timers.timer).toMatchObject({ remaining: 0, running: false, cycles: 1 });
  });

  it('stats compute from state', () => {
    const sp = spec({ scalars: [{ id: 'budget', kind: 'budget', label: 'B', target: 100 }] });
    let st = P.initialState(sp);
    st = P.apply(sp, st, { op: 'add', name: 'a', values: { amount: 30 } });
    st = P.apply(sp, st, { op: 'add', name: 'b', values: { amount: 20 } });
    expect(P.statValue(sp, st, { id: 'r', label: 'left', op: 'remaining', scalar: 'budget', field: 'amount' })).toEqual({ value: 50, of: 100 });
    expect(P.statValue(sp, st, { id: 'a', label: 'avg', op: 'avg', field: 'amount' }).value).toBe(25);
  });
});

describe('program: commands are type-masked', () => {
  it('masks ops the app cannot execute ("add 2 glasses" in a counter app → +2)', () => {
    const sp = spec({ noun: '', fields: [], scalars: [{ id: 'counter', kind: 'counter', label: 'Water', target: 8 }] });
    const st = P.initialState(sp);
    const pl = P.planCommand(sp, st, 'add 2 glasses', { op: { choice: 'add', probabilities: { add: 0.6, inc: 0.35, none: 0.05 } } });
    expect(pl.op).toEqual({ op: 'inc', scalar: 'counter', by: 2 });
  });

  it('completion uses a status enum when there is no bool field', () => {
    const sp = spec();
    const st = P.apply(sp, P.initialState(sp), { op: 'add', name: 'write the report', values: {} });
    const id = st.items[0].id;
    const pl = P.planCommand(sp, st, 'mark write the report as done', { op: { choice: 'complete', probabilities: { complete: 1 } }, item: { choice: `${id}: write the report` } });
    expect(pl.op).toEqual({ op: 'set', id, field: 'status', value: 'done' });
  });

  it('numbers come from the text, never from the model', () => {
    const sp = spec();
    const pl = P.planCommand(sp, P.initialState(sp), 'add coffee 4.50', { op: { choice: 'add', probabilities: { add: 1 } }, numfield: { choice: 'amount' } });
    expect(pl.op).toEqual({ op: 'add', name: 'coffee', values: { amount: 4.5 } });
    expect(P.nameFrom('please add a task: call the bank at 3', 'task')).toBe('call the bank');
  });
});

describe('program: edits keep it well-typed', () => {
  it('adds and removes fields; stats that lose their field disappear', () => {
    let sp = spec({ stats: [{ id: 'sum:amount', label: 'Total', op: 'sum', field: 'amount' }] });
    sp = P.applyEdit(sp, 'add a priority', { edit: { choice: 'addField' }, addField: { choice: 'priority' } }).spec;
    expect(sp.fields.map((f) => f.id)).toContain('priority');
    sp = P.applyEdit(sp, 'remove the amount', { edit: { choice: 'removeField' }, removeField: { choice: 'amount' } }).spec;
    expect(sp.stats).toEqual([]);
  });

  it('targets change only to numbers the user wrote; new scalars use the kind default', () => {
    const sp = spec({ scalars: [{ id: 'timer', kind: 'timer', label: 'T', target: 25 }] });
    expect(P.applyEdit(sp, 'make the timer 50 minutes', { edit: { choice: 'setTarget' }, scalar: { choice: 'timer' } }).spec.scalars[0].target).toBe(50);
    const added = P.applyEdit(spec(), 'add a timer', { edit: { choice: 'addScalar' }, scalar: { choice: 'timer' }, target: { choice: '1' } }).spec;
    expect(added.scalars[0].target).toBe(25);
  });

  it('state migrates across edits', () => {
    const sp = spec({ scalars: [{ id: 'counter', kind: 'counter', label: 'C', target: 8 }] });
    const st = P.apply(sp, P.initialState(sp), { op: 'inc', scalar: 'counter', by: 3 });
    const sp2 = { ...sp, scalars: [...sp.scalars, { id: 'timer', kind: 'timer' as const, label: 'T', target: 25 }] };
    const st2 = P.migrate(sp2, st);
    expect(st2.scalars.counter).toBe(3);
    expect(st2.timers.timer).toMatchObject({ remaining: 1500, running: false });
  });
});

/* ── image: typed scenes, rendered, recognised ──────────────────────────── */

describe('image: scene choice → renderable layers', () => {
  it('a face implies a head; background-coloured and duplicate layers are dropped', () => {
    const sc = I.sceneFrom({ bg: { choice: 'black' }, shape0: { choice: 'face' }, color0: { choice: 'yellow' }, shape1: { choice: 'face' }, color1: { choice: 'black' }, shape2: { choice: 'cross' }, color2: { choice: 'black' } });
    expect(sc).toEqual({ bg: '.', layers: [{ shape: 'disc', color: 'Y' }, { shape: 'face', color: '.' }] });
  });

  it('renders shapes onto an 8×8 grid of palette symbols', () => {
    const g = I.render({ bg: '.', layers: [{ shape: 'disc', color: 'R', cx: 4, cy: 4, size: 3 }] });
    expect(g).toHaveLength(8);
    expect(g[4][4]).toBe('R');
    expect(g[0][0]).toBe('.');
    const cross = I.rows(I.render({ bg: '.', layers: [{ shape: 'cross', color: '#', cx: 4, cy: 4, size: 3 }] }));
    expect(cross[4]).toMatch(/#{5,}/);
  });

  it('variants enumerate placements, deduplicated by picture; face heads stay big', () => {
    const vs = I.variants({ bg: '.', layers: [{ shape: 'disc', color: 'Y' }, { shape: 'face', color: '.' }] });
    expect(vs.length).toBeGreaterThan(5);
    expect(new Set(vs.map((v) => I.key(I.render(v)))).size).toBe(vs.length);
    expect(vs.every((v) => v.layers[0].size >= I.MIN_FACE_HEAD)).toBe(true);
  });

  it('mutations are local moves that never shrink a face head below the floor', () => {
    const s: I.Scene = { bg: '.', layers: [{ shape: 'disc', color: 'Y', cx: 4, cy: 4, size: 3 }, { shape: 'face', color: '.', cx: 4, cy: 4, size: 1 }] };
    const ms = I.mutations(s);
    expect(ms.length).toBeGreaterThan(4);
    expect(ms.every((g) => g.length === 8 && g.every((r) => r.length === 8))).toBe(true);
  });

  it('scores whole pictures, ≤32 nouls per item, and reads the scores back in order', () => {
    const grids = Array.from({ length: 40 }, (_, i) => I.render({ bg: '.', layers: [{ shape: 'disc', color: 'R', cx: 3 + (i % 3), cy: 4, size: 2 }] }));
    const items = I.scoreItems('a red circle', grids);
    expect(items.map((it) => Object.keys(it.questions).length)).toEqual([32, 8]);
    const res = items.map((it) => Object.fromEntries(Object.keys(it.questions).map((k) => [k, { noul: Number(k.slice(1)) / 100 }])));
    expect(I.scoresFrom(res, 40)[39]).toBeCloseTo(0.39);
  });

  it('the contrastive final picks by probability; draw trusts it only when decisive', async () => {
    expect(I.finalPick({ best: { probabilities: { A: 0.1, B: 0.7, C: 0.2 } } }, 3)).toEqual({ index: 1, p: 0.7 });
    const d: I.ImageDeps = {
      decide: async (_s, qs) =>
        qs.best
          ? { best: { choice: 'B', probabilities: { A: 0.3, B: 0.35, C: 0.35 } } }
          : { bg: { choice: 'black' }, shape0: { choice: 'disc' }, color0: { choice: 'red' }, shape1: { choice: 'none' } },
      decideMany: async (items) => items.map((it) => Object.fromEntries(Object.keys(it.questions).map((k, j) => [k, { noul: j === 0 ? 0.9 : 0.2 }]))),
    };
    const r = await I.draw('a red circle', d);
    expect(r.scene.layers).toEqual([{ shape: 'disc', color: 'R' }]);
    expect(r.best.score).toBe(0.9); // indecisive final (0.35 < 0.4) keeps the noul winner
  });
});
