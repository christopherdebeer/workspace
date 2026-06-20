/**
 * Type schemas — advisory shape contracts. Validation never blocks a write; it
 * yields hints that nudge a fact (missing a recommended field) or a type (no
 * schema yet) toward improvement.
 */
import { parseTypeSchema, missingRequired, schemaHints, mergeTypeDecl } from '../platform/runtime/type-schema';

describe('mergeTypeDecl (the one type-kind resolver)', () => {
  it('merges per facet, slice wins — keeps canonical facets the slice omits', () => {
    const canonical = { manager: '@c15r/lit', handlers: { open: [{ path: '?doc=x' }] }, schema: { title: 'string' }, icon: '📄' };
    const slice = { icon: '⭐' }; // override only the icon
    // The latent-bug fix: gateway used to wholesale-replace (dropping handlers/schema);
    // now the override keeps them.
    expect(mergeTypeDecl(canonical, slice)).toEqual({
      manager: '@c15r/lit',
      handlers: { open: [{ path: '?doc=x' }] },
      schema: { title: 'string' },
      icon: '⭐',
    });
  });

  it('handles either side absent / non-object', () => {
    expect(mergeTypeDecl({ icon: '📄' }, undefined)).toEqual({ icon: '📄' });
    expect(mergeTypeDecl(undefined, { icon: '⭐' })).toEqual({ icon: '⭐' });
    expect(mergeTypeDecl('nope', ['nope'])).toEqual({});
  });
});

describe('parseTypeSchema', () => {
  it('reads the structured `fields` form', () => {
    const fields = parseTypeSchema({
      fields: [
        { name: 'title', type: 'string', required: true, description: 'the heading' },
        { name: 'note', type: 'markdown' },
        { name: 'junk' }, // no name-less/extra issues
      ],
    });
    expect(fields).toEqual([
      { name: 'title', type: 'string', required: true, description: 'the heading' },
      { name: 'note', type: 'markdown', required: false, description: undefined },
      { name: 'junk', type: undefined, required: false, description: undefined },
    ]);
  });

  it('reads the legacy prose map, deriving required from the `?` token', () => {
    const fields = parseTypeSchema({
      schema: {
        statement: 'string — the asserted proposition',
        method: 'string? — how it was derived',
        confidence: 'number 0..1 — calibrated belief',
        blocks: 'DEPRECATED — legacy inline array',
      },
    });
    const byName = Object.fromEntries((fields ?? []).map((f) => [f.name, f]));
    expect(byName.statement).toMatchObject({ type: 'string', required: true, description: 'the asserted proposition' });
    expect(byName.method.required).toBe(false); // string? → optional
    expect(byName.confidence).toMatchObject({ type: 'number', required: true });
    expect(byName.blocks.required).toBe(false); // DEPRECATED → optional
  });

  it('returns null when a declaration carries no schema', () => {
    expect(parseTypeSchema({ icon: '📝', manager: '@c15r/home' })).toBeNull();
    expect(parseTypeSchema(undefined)).toBeNull();
    expect(parseTypeSchema({ fields: [] })).toBeNull();
  });
});

describe('missingRequired', () => {
  const fields = parseTypeSchema({ schema: { statement: 'string — x', method: 'string? — y' } })!;
  it('flags absent or empty required fields only', () => {
    expect(missingRequired({ statement: 'the sky is blue' }, fields)).toEqual([]); // optional method absent → fine
    expect(missingRequired({ method: 'observation' }, fields).map((f) => f.name)).toEqual(['statement']);
    expect(missingRequired({ statement: '' }, fields).map((f) => f.name)).toEqual(['statement']); // empty counts as missing
    expect(missingRequired('not an object', fields).map((f) => f.name)).toEqual(['statement']);
  });
});

describe('schemaHints (advisory, never blocks)', () => {
  const claimDecl = { schema: { statement: 'string — the asserted proposition', confidence: 'number 0..1 — calibrated belief' } };

  it('hints each missing recommended field when the type has a schema', () => {
    const hints = schemaHints({ type: 'claim', value: { confidence: 0.9 }, decl: claimDecl });
    expect(hints).toHaveLength(1);
    expect(hints[0]).toContain('"claim"');
    expect(hints[0]).toContain('"statement"');
    expect(hints[0]).toContain('the asserted proposition');
  });

  it('is silent when all recommended fields are present', () => {
    expect(schemaHints({ type: 'claim', value: { statement: 'x', confidence: 0.9 }, decl: claimDecl })).toEqual([]);
  });

  it('nudges a schemaless type with a structured value to declare one', () => {
    const hints = schemaHints({ type: 'decision', value: { choice: 'dynamo', rationale: 'one table' }, decl: { icon: '⚖️', manager: '@c15r/home' } });
    expect(hints).toHaveLength(1);
    expect(hints[0]).toContain('has no schema');
    expect(hints[0]).not.toContain('undeclared'); // a declared type
  });

  it('marks an undeclared type as such, and stays quiet for trivial/untyped values', () => {
    expect(schemaHints({ type: 'gizmo', value: { a: 1 }, decl: undefined })[0]).toContain('undeclared');
    expect(schemaHints({ type: 'note', value: 'just a string', decl: undefined })).toEqual([]); // not structured
    expect(schemaHints({ type: null, value: { a: 1 } })).toEqual([]); // untyped
  });
});
