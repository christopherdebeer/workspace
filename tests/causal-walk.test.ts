/**
 * ADR-0075 (C4) — causal relations: the directional walk, behaviour-preservation
 * gate.
 *
 * Zero schema: causal rels are ordinary authored edges (`rel` free string,
 * confidence = `strength`). The one new affordance is `edges({around, depth ≥ 2,
 * direction})` — all maximal simple paths over AUTHORED edges, compound
 * confidence = Π step strength, cycle-guarded, capped. depth 1/absent must stay
 * byte-identical to the C3 framings.
 */
import { createWorkspaceCommands } from '../services/workspace/handlers';
import type { WalkResult } from '../services/workspace/commands-graph';
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

describe('ADR-0075 — the directional walk on edges', () => {
  const store = createMemoryStateStore();
  const state = createObservedState(store);
  const cmds = createWorkspaceCommands(() => ({ state, grants: createMemoryGrantStore(), store }));
  const ctx = ctxFor('alice');

  beforeAll(async () => {
    // A causal chain with confidences, a branch, an unrelated rel, and a cycle:
    //   a --causes(0.9)--> b --causes(0.8)--> c --causes(0.5)--> d
    //   b --causes(0.6)--> e
    //   a --refines------> x          (different family — not followed under rel filter)
    //   c --causes(1.0)--> a          (cycle back to the root)
    for (const k of ['ev/a', 'ev/b', 'ev/c', 'ev/d', 'ev/e', 'kb/x']) {
      await cmds.remember({ key: k, value: { name: k }, type: 'note' }, ctx);
    }
    await cmds.link({ from: 'ev/a', rel: 'causes', to: 'ev/b', strength: 0.9 }, ctx);
    await cmds.link({ from: 'ev/b', rel: 'causes', to: 'ev/c', strength: 0.8 }, ctx);
    await cmds.link({ from: 'ev/c', rel: 'causes', to: 'ev/d', strength: 0.5 }, ctx);
    await cmds.link({ from: 'ev/b', rel: 'causes', to: 'ev/e', strength: 0.6 }, ctx);
    await cmds.link({ from: 'ev/a', rel: 'refines', to: 'kb/x' }, ctx);
    await cmds.link({ from: 'ev/c', rel: 'causes', to: 'ev/a', strength: 1.0 }, ctx);
  });

  it('depth 1 / absent stays byte-identical to the one-hop framing (the gate)', async () => {
    // depth:1 and absent-depth must be the SAME read — the walk only engages at depth ≥ 2.
    expect(await cmds.edges({ around: 'ev/a', depth: 1 }, ctx)).toEqual(await cmds.edges({ around: 'ev/a' }, ctx));
  });

  it('walks downstream with compound confidence, sorted confidence-descending', async () => {
    const w = (await cmds.edges({ around: 'ev/a', rel: 'causes', depth: 3, direction: 'out' }, ctx)) as WalkResult;
    expect(w.root).toBe('ev/a');
    expect(w.direction).toBe('out');
    const byNodes = Object.fromEntries(w.paths.map((p) => [p.nodes.join('→'), p.confidence]));
    // a→b→c→d: 0.9·0.8·0.5 = 0.36 ; a→b→e: 0.9·0.6 = 0.54
    expect(byNodes['ev/a→ev/b→ev/e']).toBeCloseTo(0.54, 10);
    expect(byNodes['ev/a→ev/b→ev/c→ev/d']).toBeCloseTo(0.36, 10);
    expect(w.paths[0].confidence).toBeGreaterThanOrEqual(w.paths[w.paths.length - 1].confidence);
    // Steps carry the raw edges (from/rel/to/strength) so the path is auditable.
    const chain = w.paths.find((p) => p.nodes.join('→') === 'ev/a→ev/b→ev/c→ev/d')!;
    expect(chain.steps).toEqual([
      { from: 'ev/a', rel: 'causes', to: 'ev/b', strength: 0.9 },
      { from: 'ev/b', rel: 'causes', to: 'ev/c', strength: 0.8 },
      { from: 'ev/c', rel: 'causes', to: 'ev/d', strength: 0.5 },
    ]);
  });

  it('the rel filter names the family: refines is not followed; without a rel every authored edge walks', async () => {
    const causal = (await cmds.edges({ around: 'ev/a', rel: 'causes', depth: 2 }, ctx)) as WalkResult;
    expect(causal.paths.every((p) => p.steps.every((s) => s.rel === 'causes'))).toBe(true);
    const any = (await cmds.edges({ around: 'ev/a', depth: 2 }, ctx)) as WalkResult;
    expect(any.paths.some((p) => p.steps.some((s) => s.rel === 'refines'))).toBe(true);
  });

  it('cycles are guarded: c→a exists, but no path revisits a node', async () => {
    const w = (await cmds.edges({ around: 'ev/a', rel: 'causes', depth: 6 }, ctx)) as WalkResult;
    for (const p of w.paths) expect(new Set(p.nodes).size).toBe(p.nodes.length);
    // The c→a edge is walkable from b (b→c→a is a simple path) —
    const fromB = (await cmds.edges({ around: 'ev/b', rel: 'causes', depth: 3 }, ctx)) as WalkResult;
    expect(fromB.paths.some((p) => p.nodes.join('→') === 'ev/b→ev/c→ev/a')).toBe(true);
  });

  it("direction 'in' walks upstream (what leads to X)", async () => {
    const w = (await cmds.edges({ around: 'ev/d', rel: 'causes', depth: 4, direction: 'in' }, ctx)) as WalkResult;
    const nodes = w.paths.map((p) => p.nodes.join('→'));
    expect(nodes).toContain('ev/d→ev/c→ev/b→ev/a');
    const full = w.paths.find((p) => p.nodes.join('→') === 'ev/d→ev/c→ev/b→ev/a')!;
    expect(full.confidence).toBeCloseTo(0.5 * 0.8 * 0.9, 10);
    // Steps stay in stored from→to orientation even when walking inbound.
    expect(full.steps[0]).toEqual({ from: 'ev/c', rel: 'causes', to: 'ev/d', strength: 0.5 });
  });

  it('depth clamps to the cap; a missing/leaf root walks to an empty path set', async () => {
    const w = (await cmds.edges({ around: 'ev/a', rel: 'causes', depth: 99 }, ctx)) as WalkResult;
    expect(w.depth).toBeLessThanOrEqual(6);
    const leaf = (await cmds.edges({ around: 'ev/d', rel: 'causes', depth: 3, direction: 'out' }, ctx)) as WalkResult;
    expect(leaf.paths).toEqual([]);
    expect(leaf.total).toBe(0);
  });
});
