/**
 * createCellReader (ADR-0042 Inc 1) — the canonical cell-SSR reader.
 *
 * Proves the reader runs the SAME observed-state pipeline the gateway does
 * (salience-scored facts, authored + derived edges, key-encoded doc membership),
 * bound to one scope — so a cell can delete its hand-rolled raw-DDB SSR reads.
 * Also pins the honest `typeRules` degradation (ADR-0042 Inc 2's dependency):
 * without the type vocabulary, a doc's key-encoded membership resolves empty.
 * Backed by the in-memory store, so it runs without AWS.
 */
import { createMemoryStateStore, createCellReader } from '../platform/runtime';
import type { Identity, TypeRules } from '../platform/runtime';

const owner: Identity = { user: 'c15r', scopes: [] };

/** The `doc-order` decoration's key-encoded rule, exactly as `@c15r/lit`'s
 *  `types.json` declares it (`_doc/{doc}/{block}` → `block --inDoc--> doc:{doc}`).
 *  Keyed by type name, the shape `cells.describeTypes` → the gateway feeds the
 *  pipeline as `typeRules`. */
const LIT_TYPE_RULES: Record<string, TypeRules> = {
  'doc-order': {
    keyPattern: '_doc/{doc}/{block}',
    keyEdges: [{ from: '{block}', rel: 'inDoc', to: 'doc:{doc}' }],
  },
};

/** Seed a tiny lit-shaped slice: a doc, two blocks, their ordering decorations. */
async function seedDoc(scope: string) {
  const store = createMemoryStateStore();
  const reader = () => createCellReader(store, scope, { typeRules: LIT_TYPE_RULES });
  // Use a bound observed-state to seed (writes need identity); the reader wraps
  // the SAME store, so what we write is what it reads.
  const s = reader().state;
  await s.put({ scope, key: 'doc:guide', value: { title: 'Guide' }, type: 'doc' }, owner);
  await s.put({ scope, key: 'blk-1', value: { content: '# Guide\nfirst' }, type: 'doc-block', tags: ['doc:guide'] }, owner);
  await s.put({ scope, key: 'blk-2', value: { content: 'second' }, type: 'doc-block', tags: ['doc:guide'] }, owner);
  await s.put({ scope, key: '_doc/guide/blk-1', value: { seq: 1 }, type: 'doc-order', tags: ['doc:guide'] }, owner);
  await s.put({ scope, key: '_doc/guide/blk-2', value: { seq: 2 }, type: 'doc-order', tags: ['doc:guide'] }, owner);
  return store;
}

describe('createCellReader — peek / query / byType', () => {
  it('peek returns the raw stored record (no salience, no attention write)', async () => {
    const store = await seedDoc('c15r');
    const r = createCellReader(store, 'c15r');
    const rec = await r.peek('doc:guide');
    expect(rec?.value).toEqual({ title: 'Guide' });
    expect(rec?.type).toBe('doc');
    // peek must not add a `_meta.score` (it's the raw record, not a scored Entry).
    expect((rec as unknown as { _meta?: unknown })._meta).toBeUndefined();
    expect(await r.peek('doc:missing')).toBeNull();
  });

  it('query is salience-scored and honors a prefix filter', async () => {
    const store = await seedDoc('c15r');
    const r = createCellReader(store, 'c15r');
    const res = await r.query({ prefix: 'blk-' });
    expect(res.entries.map((e) => e.key).sort()).toEqual(['blk-1', 'blk-2']);
    // The pipeline scored them — a raw DDB scan could not.
    for (const e of res.entries) expect(typeof e._meta.score).toBe('number');
  });

  it('byType returns every fact of one type (the hub-collection read)', async () => {
    const store = await seedDoc('c15r');
    const r = createCellReader(store, 'c15r');
    const res = await r.byType('doc-block');
    expect(res.entries.map((e) => e.key).sort()).toEqual(['blk-1', 'blk-2']);
    expect(res.entries.every((e) => e._meta.type === 'doc-block')).toBe(true);
  });
});

describe('createCellReader — members (key-encoded), the $types dependency', () => {
  it('WITH typeRules, resolves a doc\'s blocks in decoration seq order', async () => {
    const store = await seedDoc('c15r');
    const r = createCellReader(store, 'c15r', { typeRules: LIT_TYPE_RULES });
    const res = await r.members('doc:guide');
    expect(res.membership).toBe('extensional');
    expect(res.order).toBe('seq');
    expect(res.members.map((m) => m.key)).toEqual(['blk-1', 'blk-2']);
    // Each member carries its placing decoration's seq — one read, membership+order.
    expect(res.members.map((m) => m.placement?.seq)).toEqual([1, 2]);
  });

  it('WITHOUT typeRules, membership resolves EMPTY (honest degradation, not error)', async () => {
    const store = await seedDoc('c15r');
    const r = createCellReader(store, 'c15r'); // no typeRules bound
    const res = await r.members('doc:guide');
    // The key-encoded inDoc edges can't be derived without the vocabulary, so a
    // wire-free SSR sees no members — the exact gap ADR-0042 Inc 2 closes.
    expect(res.members).toEqual([]);
  });
});

describe('createCellReader — neighbors (authored always, derived with typeRules)', () => {
  it('returns authored edges regardless of typeRules', async () => {
    const store = await seedDoc('c15r');
    const r = createCellReader(store, 'c15r');
    // Author a plain link between the two blocks.
    await r.state.link('c15r', 'blk-1', 'related', 'blk-2', null, owner);
    const res = await r.neighbors('blk-1');
    expect(res.outbound.some((e) => e.rel === 'related' && e.to === 'blk-2')).toBe(true);
  });

  it('surfaces the derived inDoc backbone only when typeRules is bound', async () => {
    const store = await seedDoc('c15r');
    const withRules = createCellReader(store, 'c15r', { typeRules: LIT_TYPE_RULES });
    const withOut = createCellReader(store, 'c15r');
    const key = 'doc:guide';
    const inWith = (await withRules.neighbors(key)).inbound.filter((e) => e.rel === 'inDoc');
    const inWithout = (await withOut.neighbors(key)).inbound.filter((e) => e.rel === 'inDoc');
    expect(inWith.map((e) => e.from).sort()).toEqual(['blk-1', 'blk-2']);
    expect(inWithout).toEqual([]);
  });
});
