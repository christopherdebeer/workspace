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
} from '../cells/jev/client/lib/decode';
import { assemble, candidates, slotsFrom, stage1Questions, stage2Questions, LABELS } from '../cells/jev/client/lib/ui-spec';
import type { ChoiceQ } from '../cells/jev/client/lib/types';

const choiceCount = (q: unknown) => Object.keys((q as ChoiceQ).criteria).length;

describe('decode: vocabularies fit a Jev choice (≤255 options)', () => {
  it('charset, word vocabulary and candidate lists stay within 255', () => {
    expect(CHARSET.length).toBeLessThanOrEqual(255);
    expect(choiceCount(wordQuestion())).toBeLessThanOrEqual(255);
    expect(new Set(WORDS).size).toBe(WORDS.length);
    const long = Array.from({ length: 400 }, (_, i) => `word${i}`).join(' ');
    expect(candidates(long).length).toBeLessThanOrEqual(250);
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

describe('interface 00a: request → spec', () => {
  it('lifts content phrases from the request ahead of the generic labels', () => {
    const c = candidates('a pomodoro timer with a task list');
    expect(c.slice(0, 5)).toEqual(expect.arrayContaining(['Pomodoro Timer', 'Task List']));
    expect(c).toContain('Start');
    expect(c.indexOf('Pomodoro Timer')).toBeLessThan(c.indexOf(LABELS[0]));
  });

  it('stage 1 asks layout, mood, title and a count per component', () => {
    const qs = stage1Questions(['A', 'B']);
    expect(qs.layout.type).toBe('choice');
    expect(qs['n:button'].type).toBe('score');
  });

  it('turns count distributions into ordered, capped slots', () => {
    const slots = slotsFrom({
      'n:button': { probabilities: { '0': 0.1, '1': 0.2, '2': 0.7, '3': 0 } },
      'n:timer': { probabilities: { '0': 0.1, '1': 0.9 } },
      'n:heading': { probabilities: { '0': 0.95, '1': 0.05 } },
    });
    expect(slots.map((s) => s.id)).toEqual(['timer0', 'button0', 'button1']);
    const many = slotsFrom(Object.fromEntries(['text', 'textInput', 'slider', 'toggle', 'button'].map((k) => [`n:${k}`, { probabilities: { '3': 1 } }])), 12);
    expect(many).toHaveLength(12);
  });

  it('stage 2 asks per-slot labels, ranges, options and actions', () => {
    const slots = [
      { id: 'slider0', kind: 'slider' as const, index: 0 },
      { id: 'select0', kind: 'select' as const, index: 0 },
      { id: 'button0', kind: 'button' as const, index: 0 },
    ];
    const qs = stage2Questions(slots, ['A', 'B']);
    expect(Object.keys(qs)).toEqual(
      expect.arrayContaining(['slider0:label', 'slider0:min', 'slider0:max', 'select0:opt3', 'button0:action']),
    );
  });

  it('assembles a renderable spec, repairing an inverted range and de-duplicating options', () => {
    const slots = [
      { id: 'slider0', kind: 'slider' as const, index: 0 },
      { id: 'select0', kind: 'select' as const, index: 0 },
      { id: 'button0', kind: 'button' as const, index: 0 },
    ];
    const spec = assemble(
      { title: { choice: 'Pomodoro Timer' }, layout: { choice: 'card' }, mood: { choice: 'calm' } },
      slots,
      {
        'slider0:label': { choice: 'Minutes', confidence: 0.7 },
        'slider0:min': { choice: '60' },
        'slider0:max': { choice: '5' },
        'select0:opt0': { choice: 'Low' },
        'select0:opt1': { choice: 'Low' },
        'select0:opt2': { choice: 'High' },
        'button0:action': { choice: 'start' },
      },
    );
    expect(spec).toMatchObject({ title: 'Pomodoro Timer', layout: 'card', mood: 'calm' });
    const slider = spec.widgets.find((w) => w.id === 'slider0')!;
    expect(slider.min).toBeLessThan(slider.max!);
    expect(spec.widgets.find((w) => w.id === 'select0')!.options).toEqual(['Low', 'High']);
    expect(spec.widgets.find((w) => w.id === 'button0')!.action).toBe('start');
  });
});
