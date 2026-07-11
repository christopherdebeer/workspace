/**
 * ADR-0078 — slice-declared lenses, behaviour-preservation gate.
 *
 * `_config/lenses` declares named presets; `lens` resolution becomes
 * floor-first (the compiled five, never shadowable) then declared, with
 * unknown names ignored — a lens can bias a read, never break one. Everything
 * that takes `lens` benefits at once (per-call + posture) because resolution
 * lives in callSalience. Default-inert: no config fact ⇒ byte-identical.
 */
import { createWorkspaceCommands } from '../services/workspace/handlers';
import { createObservedState, createMemoryStateStore, parseLensesConfig, LENSES_CONFIG_KEY } from '../platform/runtime';
import { createMemoryGrantStore } from '../services/workspace/grants';
import type { ServiceContext } from '../platform/runtime';

function ctxFor(user: string, posture?: { goal?: string; lens?: string }): ServiceContext {
  return {
    identity: { user, scopes: ['workspace:write', 'workspace:read'], ...(posture ? { posture } : {}) },
    config: { tableName: 'unused-in-memory' },
    events: { emit: async () => {} },
    logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
  } as unknown as ServiceContext;
}

const REVIEW = { rewardWeight: 0.5, recencyWeight: 0.1, velocityWeight: 0.1, attentionWeight: 0.1, standingWeight: 0.1, centralityWeight: 0.1 };

describe('ADR-0078 — parseLensesConfig', () => {
  it('sanitizes per-preset like _config/salience; the floor five are never shadowable', () => {
    expect(
      parseLensesConfig({ review: REVIEW, recent: { recencyWeight: 1 }, junk: 'nope', bad: { recencyWeight: -1 } }),
    ).toEqual({ review: REVIEW });
    expect(parseLensesConfig({ lenses: { review: { rewardWeight: 0.3 } } })).toEqual({ review: { rewardWeight: 0.3 } });
    expect(parseLensesConfig('garbage')).toBeNull();
    expect(parseLensesConfig({})).toBeNull();
  });
});

describe('ADR-0078 — declared lenses in the read path', () => {
  const store = createMemoryStateStore();
  const state = createObservedState(store);
  const cmds = createWorkspaceCommands(() => ({ state, grants: createMemoryGrantStore(), store }));
  const ctx = ctxFor('alice');

  beforeAll(async () => {
    await cmds.remember({ key: 'n/a', value: { t: 'alpha' }, type: 'note' }, ctx);
    await cmds.remember({ key: 'n/b', value: { t: 'beta' }, type: 'note' }, ctx);
    await cmds.remember({ key: LENSES_CONFIG_KEY, value: { review: REVIEW } }, ctx);
  });

  it('a declared lens ≡ the same weights as a raw per-call override (modulo the _shaping.lens echo)', async () => {
    // The lens NAME is echoed in _shaping (observability — ADR-0078 open
    // question 1 resolved yes); everything else must match the raw override.
    const stripEcho = (r: unknown) => {
      const { _shaping, ...rest } = r as { _shaping?: { lens?: string } & Record<string, unknown> };
      if (!_shaping) return rest;
      const { lens: _l, ...shaping } = _shaping;
      return { ...rest, _shaping: shaping };
    };
    expect(await cmds.query({ type: 'note', lens: 'review' }, ctx)).toEqual(
      await cmds.query({ type: 'note', salience: REVIEW }, ctx),
    );
    const viaLens = await cmds.recall({ view: 'full', lens: 'review' }, ctx);
    expect((viaLens as { _shaping: { lens?: string } })._shaping.lens).toBe('review');
    expect(stripEcho(viaLens)).toEqual(stripEcho(await cmds.recall({ view: 'full', salience: REVIEW }, ctx)));
  });

  it('the compiled floor still wins its own names, and unknown names stay inert', async () => {
    // 'recent' was also declared in the config fact (shadow attempt) — the
    // parser drops it, so lens:'recent' is the compiled preset exactly.
    await cmds.remember({ key: LENSES_CONFIG_KEY, value: { review: REVIEW, recent: { recencyWeight: 0 } } }, ctx);
    const viaLens = await cmds.query({ type: 'note', lens: 'recent' }, ctx);
    await cmds.supersede({ key: LENSES_CONFIG_KEY }, ctx);
    await cmds.remember({ key: LENSES_CONFIG_KEY, value: { review: REVIEW } }, ctx);
    expect(viaLens).toEqual(await cmds.query({ type: 'note', lens: 'recent' }, ctx));
    // Unknown ⇒ ignored ⇒ identical to no lens at all.
    expect(await cmds.query({ type: 'note', lens: 'no-such-lens' }, ctx)).toEqual(await cmds.query({ type: 'note' }, ctx));
  });

  it('a posture may adopt a DECLARED lens (0074 Q4 closed): postured ≡ per-call equivalent', async () => {
    const postured = ctxFor('alice', { lens: 'review' });
    expect(await cmds.read({ type: 'note' }, postured)).toEqual(await cmds.query({ type: 'note', lens: 'review' }, ctx));
  });

  it('default-inert: a slice with no _config/lenses reads byte-identically', async () => {
    const store2 = createMemoryStateStore();
    const state2 = createObservedState(store2);
    const cmds2 = createWorkspaceCommands(() => ({ state: state2, grants: createMemoryGrantStore(), store: store2 }));
    const ctx2 = ctxFor('bob');
    await cmds2.remember({ key: 'n/a', value: { t: 'alpha' }, type: 'note' }, ctx2);
    expect(await cmds2.query({ type: 'note', lens: 'review' }, ctx2)).toEqual(await cmds2.query({ type: 'note' }, ctx2));
  });
});
