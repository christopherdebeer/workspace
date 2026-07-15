/**
 * ADR-0071 (C2) — the composed read, behaviour-preservation gate.
 *
 * `read(source, …)` must deep-equal its presets (recall/query/peek/changes) —
 * including inferred sources — the `context:'refs'` periphery must attach
 * capped, value-free neighbour refs without disturbing parity when absent, and
 * the ADR-0074 principal layer must be reserved-but-inert.
 */
import { createWorkspaceCommands } from '../services/workspace/handlers';
import { principalPosture, inferSource } from '../services/workspace/commands-read';
import { createObservedState, createMemoryStateStore } from '../platform/runtime';
import { createMemoryGrantStore } from '../services/workspace/grants';
import type { ServiceContext } from '../platform/runtime';

function ctxFor(user: string): ServiceContext {
  return {
    identity: { user, scopes: ['workspace:write', 'workspace:read'] },
    config: { tableName: 'unused-in-memory' },
    events: { emit: async () => {} },
    logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
  } as unknown as ServiceContext;
}

describe('ADR-0071 — read(source, shape) parity', () => {
  const store = createMemoryStateStore();
  const state = createObservedState(store);
  const cmds = createWorkspaceCommands(() => ({ state, grants: createMemoryGrantStore(), store }));
  const ctx = ctxFor('alice');

  beforeAll(async () => {
    await cmds.remember({ key: 'n/a', value: { t: 'alpha' }, type: 'note' }, ctx);
    await cmds.remember({ key: 'n/b', value: { t: 'beta' }, type: 'note' }, ctx);
    await cmds.remember({ key: 'd/1', value: { t: 'gamma' }, type: 'decision' }, ctx);
    await cmds.link({ from: 'n/a', rel: 'refines', to: 'd/1' }, ctx);
    await cmds.link({ from: 'n/b', rel: 'grounds', to: 'n/a' }, ctx);
  });

  it('source inference: key → key, filters → store, text → vector, trajectory → changes, bare → slice', () => {
    expect(inferSource({ key: 'x' })).toBe('key');
    expect(inferSource({ type: 'note' })).toBe('store');
    expect(inferSource({ text: 'meaning' })).toBe('vector');
    expect(inferSource({ last: 10 })).toBe('changes');
    expect(inferSource(undefined)).toBe('slice');
    expect(inferSource({ source: 'store', text: 'x' })).toBe('store'); // explicit wins
  });

  it('read() bare ≡ recall() overview; read({view:"full"}) ≡ recall({view:"full"})', async () => {
    expect(await cmds.read(undefined, ctx)).toEqual(await cmds.recall(undefined, ctx));
    expect(await cmds.read({ view: 'full' }, ctx)).toEqual(await cmds.recall({ view: 'full' }, ctx));
  });

  it('recall overview card-shapes the focus band; recall({shape:"full"}) restores whole focus bodies', async () => {
    // A long-bodied, high-salience fact lands in focus — the orientation read
    // must not inline its whole body (a driven-machine probe hit a ~10KB ADR
    // shipped in full here, and twice with its doc-block slice).
    const body = 'y'.repeat(4000);
    await cmds.remember({ key: 'big/doc', value: { content: body, title: 'Big' }, type: 'note' }, ctx);
    // Bump salience so it sits in the focus band.
    for (let i = 0; i < 3; i++) await cmds.peek({ key: 'big/doc' }, ctx);

    const ov = (await cmds.recall(undefined, ctx)) as { focus: Record<string, { value: { content?: string }; _meta: { shaped?: string } }> };
    const card = ov.focus['big/doc'];
    expect(card).toBeDefined();
    expect(card._meta.shaped).toBe('card'); // marked truncated
    expect((card.value.content ?? '').length).toBeLessThan(body.length); // body cut

    const full = (await cmds.recall({ shape: 'full' }, ctx)) as { focus: Record<string, { value: { content?: string }; _meta: { shaped?: string } }> };
    expect(full.focus['big/doc'].value.content).toBe(body); // whole body on request
    expect(full.focus['big/doc']._meta.shaped).toBeUndefined();
  });

  it('read({type}) ≡ query({type}); read({text}) ≡ query({text}) (the search fix)', async () => {
    expect(await cmds.read({ type: 'note' }, ctx)).toEqual(await cmds.query({ type: 'note' }, ctx));
    expect(await cmds.read({ text: 'alpha' }, ctx)).toEqual(await cmds.query({ text: 'alpha' }, ctx));
  });

  it('read({key}) ≡ peek({key}); read({source:"changes", last}) ≡ changes({last})', async () => {
    // peek TOUCHES (a read bumps attention/standing), so two sequential calls
    // can never be byte-equal — strip the touch-derived signals; everything
    // else (value, provenance, type, tags, version) must match exactly.
    const norm = (e: unknown) => {
      const { _meta, ...rest } = e as { _meta: Record<string, unknown> };
      const { score: _s, standing: _st, velocity: _v, ...meta } = _meta;
      return { ...rest, _meta: meta };
    };
    expect(norm(await cmds.read({ key: 'n/a' }, ctx))).toEqual(norm(await cmds.peek({ key: 'n/a' }, ctx)));
    expect(await cmds.read({ source: 'changes', last: 5 }, ctx)).toEqual(await cmds.changes({ last: 5 }, ctx));
  });

  it("context:'refs' attaches capped, value-free periphery to a keyed read", async () => {
    const bare = (await cmds.read({ key: 'n/a' }, ctx)) as Record<string, unknown>;
    const rich = (await cmds.read({ key: 'n/a', context: 'refs' }, ctx)) as { _context?: Array<Record<string, unknown>> };
    expect(bare._context).toBeUndefined(); // default none → parity
    const refs = rich._context!;
    expect(refs.length).toBeGreaterThanOrEqual(2); // refines→d/1 (out) + grounds←n/b (in), + derived backbone
    const out = refs.find((r) => r.rel === 'refines');
    const inn = refs.find((r) => r.rel === 'grounds');
    expect(out).toMatchObject({ key: 'd/1', dir: 'out', type: 'decision' });
    expect(inn).toMatchObject({ key: 'n/b', dir: 'in', type: 'note' });
    for (const r of refs) expect('value' in r).toBe(false); // periphery is a hint, never values
  });

  it("context:'refs' on a store read decorates each entry and respects contextLimit", async () => {
    const res = (await cmds.read({ type: 'note', context: 'refs', contextLimit: 1 }, ctx)) as {
      entries: Array<{ key: string; _context?: unknown[] }>;
    };
    const a = res.entries.find((e) => e.key === 'n/a')!;
    expect(a._context).toHaveLength(1); // capped
    // and parity holds structurally aside from _context
    const plain = await cmds.query({ type: 'note' }, ctx);
    expect(res.entries.map((e) => e.key)).toEqual(plain.entries.map((e) => e.key));
  });

  it('the principal layer is reserved but inert (ADR-0074 lands here later)', async () => {
    expect(principalPosture({ user: 'alice', scopes: [] })).toBeNull();
    // and therefore: composed ≡ preset even for salience-bearing reads
    expect(await cmds.read({ view: 'full', lens: 'recent' }, ctx)).toEqual(await cmds.recall({ view: 'full', lens: 'recent' }, ctx));
  });
});
