/**
 * Membrane input validation (wave-5) — the W3f principle enforced centrally:
 * a capability's declared inputSchema is checked at dispatch. Violations fail
 * fast with schema feedback; unrecognised keys warn on the result so a
 * silently-dropped argument can never read as "it applied". The checker is a
 * TOLERANT subset — anything it does not understand passes.
 */
import { validateInput, withInputWarnings, acceptedKeys } from '../services/gateway/validate';

// The real `changes` contract shape (the live instance that motivated this:
// `changes({since})` — the key is `sinceSeq` — silently returned the default).
const CHANGES = {
  type: 'object',
  properties: {
    sinceSeq: { oneOf: [{ type: 'number' }, { type: 'string', enum: ['head'] }] },
    limit: { type: 'number' },
    last: { type: 'number' },
    scope: { type: 'object', properties: { prefixes: { type: 'array' }, ops: { type: 'array' } }, additionalProperties: false },
    include: { type: 'string', enum: ['events', 'entries'] },
  },
  additionalProperties: false,
};

describe('validateInput — tolerant contract check', () => {
  it('flags an unrecognised key as ignored, never an error (the changes({since}) instance)', () => {
    const v = validateInput({ since: 68035, limit: 60 }, CHANGES);
    expect(v.errors).toEqual([]);
    expect(v.ignored).toEqual(['since']);
  });

  it('fails fast on a declared-key type mismatch, with schema feedback', () => {
    const v = validateInput({ limit: 'sixty' }, CHANGES);
    expect(v.errors).toHaveLength(1);
    expect(v.errors[0]).toMatch(/`limit` expects number, got string/);
  });

  it('oneOf passes when ANY branch fits (number or "head"), fails when none do', () => {
    expect(validateInput({ sinceSeq: 68035 }, CHANGES).errors).toEqual([]);
    expect(validateInput({ sinceSeq: 'head' }, CHANGES).errors).toEqual([]);
    const bad = validateInput({ sinceSeq: 'tail' }, CHANGES);
    expect(bad.errors[0]).toMatch(/`sinceSeq` expects number \| "head"/);
  });

  it('enum violations fail fast with the allowed values', () => {
    const v = validateInput({ include: 'entry' }, CHANGES);
    expect(v.errors[0]).toMatch(/"events" \| "entries"/);
  });

  it('enforces required keys even on a bare (undefined) input', () => {
    const REMEMBER = {
      type: 'object',
      properties: { key: { type: 'string' }, value: {} },
      required: ['key', 'value'],
    };
    const v = validateInput(undefined, REMEMBER);
    expect(v.errors).toEqual(expect.arrayContaining([expect.stringContaining('missing required `key`')]));
    // `value` is intentionally unconstrained (any JSON) — still required.
    expect(v.errors).toHaveLength(2);
  });

  it('is tolerant: no schema, non-object schema, or open schema (no properties) → no findings', () => {
    expect(validateInput({ anything: 1 }, undefined)).toEqual({ errors: [], ignored: [] });
    expect(validateInput({ anything: 1 }, { type: 'string' })).toEqual({ errors: [], ignored: [] });
    expect(validateInput({ anything: 1 }, { type: 'object' })).toEqual({ errors: [], ignored: [] });
  });

  it('an unconstrained declared property accepts any JSON value', () => {
    const S = { type: 'object', properties: { value: { description: 'any JSON' } } };
    expect(validateInput({ value: { nested: [1, 2] } }, S).errors).toEqual([]);
    expect(validateInput({ value: null }, S).errors).toEqual([]);
  });

  it('rejects a non-object input against an object contract', () => {
    const v = validateInput('a string', CHANGES);
    expect(v.errors[0]).toMatch(/input must be an object, got string/);
  });
});

describe('withInputWarnings — the caller learns the key had no effect', () => {
  it('attaches a named warning listing accepted keys to an object result', () => {
    const out = withInputWarnings({ events: [] }, ['since'], 'workspace.changes', CHANGES) as Record<string, unknown>;
    const warnings = out._inputWarnings as string[];
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(/`since` is not part of "workspace.changes"'s contract and had NO effect/);
    expect(warnings[0]).toMatch(/accepted keys: sinceSeq, limit, last, scope, include/);
    expect(out.events).toEqual([]); // result untouched otherwise
  });

  it('leaves the result alone when nothing was ignored, or when it cannot carry a warning', () => {
    const clean = { events: [] };
    expect(withInputWarnings(clean, [], 'workspace.changes', CHANGES)).toBe(clean);
    expect(withInputWarnings([1, 2], ['x'], 't', CHANGES)).toEqual([1, 2]);
    expect(withInputWarnings(null, ['x'], 't', CHANGES)).toBeNull();
  });
});

describe('acceptedKeys', () => {
  it('lists the contract keys, and is empty for open schemas', () => {
    expect(acceptedKeys(CHANGES)).toEqual(['sinceSeq', 'limit', 'last', 'scope', 'include']);
    expect(acceptedKeys({ type: 'object' })).toEqual([]);
    expect(acceptedKeys(undefined)).toEqual([]);
  });
});
