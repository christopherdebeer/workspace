/**
 * @parc/ui present resolvers — the ONE client label/title/icon resolver
 * (platform/ui/present.ts) that home/home-next/kernel/lit converge on.
 *
 * The load-bearing case is envelope rooting: declared label paths are
 * `value.*`-headed, and the pre-collapse home/home-next fork resolved them
 * against the VALUE (`e.value.value.*` → undefined), silently defeating every
 * declared label. These tests pin the rooting rule to the runtime's
 * `resolveLabel` semantics.
 */
import { labelOf, titleOf, iconOf, heuristicTitle } from '../platform/ui/present';

describe('labelOf — envelope-rooted path resolution', () => {
  const entry = { key: 'claim:1', value: { statement: 'Salience is the loudness function', n: 7, title: 'T' }, _meta: { type: 'claim' } };

  it('roots value.* paths at the fact envelope (the home-fork regression)', () => {
    // The fork did pathInto(e.value, 'value.statement') → e.value.value.statement → undefined.
    expect(labelOf(entry, 'value.statement')).toBe('Salience is the loudness function');
  });

  it('resolves key and meta.* heads from the envelope', () => {
    expect(labelOf(entry, 'key')).toBe('claim:1');
    expect(labelOf(entry, 'meta.type')).toBe('claim');
  });

  it('roots a bare legacy titlePath token at the value', () => {
    expect(labelOf(entry, 'statement')).toBe('Salience is the loudness function');
  });

  it('stringifies numbers/booleans, rejects objects, caps strings at 80', () => {
    expect(labelOf(entry, 'value.n')).toBe('7');
    expect(labelOf(entry, 'value')).toBeUndefined(); // object — not a label
    expect(labelOf({ key: 'k', value: { t: 'x'.repeat(100) } }, 'value.t')).toHaveLength(80);
  });

  it('is undefined for a missing path or no path', () => {
    expect(labelOf(entry, 'value.nope')).toBeUndefined();
    expect(labelOf(entry, undefined)).toBeUndefined();
  });
});

describe('titleOf — declared path → heuristic → key', () => {
  it('prefers the declared label path over the heuristic', () => {
    const e = { key: 'claim:1', value: { statement: 'The declared one', title: 'The heuristic one' } };
    expect(titleOf(e, { label: 'value.statement' })).toBe('The declared one');
  });

  it('resolves the decl ladder present.label ← label ← titlePath', () => {
    const e = { key: 'k', value: { a: 'A', b: 'B', c: 'C' } };
    expect(titleOf(e, { present: { label: 'value.a' }, label: 'value.b', titlePath: 'c' })).toBe('A');
    expect(titleOf(e, { label: 'value.b', titlePath: 'c' })).toBe('B');
    expect(titleOf(e, { titlePath: 'c' })).toBe('C');
  });

  it('falls to the heuristic when the declared path misses, then to the key', () => {
    expect(titleOf({ key: 'k', value: { name: 'Named' } }, { label: 'value.nope' })).toBe('Named');
    expect(titleOf({ key: 'the-key', value: { unrelated: 1 } }, null)).toBe('the-key');
  });
});

describe('heuristicTitle', () => {
  it('takes a string value directly, capped at 80', () => {
    expect(heuristicTitle('plain text')).toBe('plain text');
    expect(heuristicTitle('y'.repeat(100))).toHaveLength(80);
  });

  it('prefers title, then name, then the first content line (markdown stripped)', () => {
    expect(heuristicTitle({ title: 'T', name: 'N', content: '# C' })).toBe('T');
    expect(heuristicTitle({ name: 'N', content: '# C' })).toBe('N');
    expect(heuristicTitle({ content: '# Heading line\nbody' })).toBe('Heading line');
    expect(heuristicTitle({ content: '- [x] done a thing\nrest' })).toBe('done a thing');
  });

  it("returns '' when nothing is usable", () => {
    expect(heuristicTitle({ n: 1 })).toBe('');
    expect(heuristicTitle(null)).toBe('');
    expect(heuristicTitle(undefined)).toBe('');
  });
});

describe('iconOf — present.icon ← icon ← floor', () => {
  it('walks the ladder', () => {
    expect(iconOf({ present: { icon: '🧭' }, icon: '📄' })).toBe('🧭');
    expect(iconOf({ icon: '📄' })).toBe('📄');
    expect(iconOf({})).toBe('');
    expect(iconOf(undefined, '•')).toBe('•');
  });
});
