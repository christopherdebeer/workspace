/**
 * ADR-0070 (C6) — the reward signal, default-inert gate.
 *
 * The seventh score signal must change NOTHING until opted into: with
 * `rewardWeight` at its default 0, a fact carrying a reward scores identically
 * to its twin without one. With a per-read override (or config) it contributes
 * exactly `rewardWeight × reward`, is clamped to [0,1], persists across rewrites
 * like the import seeds, and shows up in `_meta` + the explain breakdown.
 */
import { createWorkspaceCommands } from '../services/workspace/handlers';
import { createObservedState, createMemoryStateStore } from '../platform/runtime';
import { scoreParts } from '../platform/runtime/state';
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

describe('ADR-0070 — reward, the seventh signal', () => {
  const state = createObservedState(createMemoryStateStore());
  const cmds = createWorkspaceCommands(() => ({ state, grants: createMemoryGrantStore() }));
  const ctx = ctxFor('alice');

  beforeAll(async () => {
    // Twin facts: identical in every signal except the persisted reward.
    await cmds.remember({ key: 'plain', value: { n: 1 }, type: 'note' }, ctx);
    await cmds.remember({ key: 'earned', value: { n: 1 }, type: 'note', reward: 1 }, ctx);
  });

  it('is default-inert: with rewardWeight 0, the rewarded twin scores identically', async () => {
    const res = await state.read('alice', { elision: 'none' });
    expect(res.entries.earned._meta.score).toBe(res.entries.plain._meta.score);
    // …but the persisted term is visible, so the opt-in is legible.
    expect(res.entries.earned._meta.reward).toBe(1);
    expect(res.entries.plain._meta.reward).toBeUndefined();
  });

  it('contributes exactly rewardWeight × reward under a per-read override', async () => {
    const res = await state.read('alice', { elision: 'none', salience: { rewardWeight: 0.3 } });
    const lift = res.entries.earned._meta.score - res.entries.plain._meta.score;
    expect(lift).toBeCloseTo(0.3, 4);
  });

  it('rides outside the type prior (earned importance is fact-specific, like relevance)', async () => {
    const res = await state.read('alice', {
      elision: 'none',
      salience: { rewardWeight: 0.4, typePriors: { note: 0.1 } },
    });
    // The prior crushes the ambient blend for both; the reward lift survives whole.
    const lift = res.entries.earned._meta.score - res.entries.plain._meta.score;
    expect(lift).toBeCloseTo(0.4, 4);
  });

  it('persists across a rewrite that does not pass reward (the seeds carry rule) and clamps to [0,1]', async () => {
    await cmds.remember({ key: 'earned', value: { n: 2 } }, ctx); // no reward field
    let res = await state.read('alice', { elision: 'none' });
    expect(res.entries.earned._meta.reward).toBe(1); // preserved
    await cmds.remember({ key: 'earned', value: { n: 3 }, reward: 5 }, ctx); // out of range
    res = await state.read('alice', { elision: 'none' });
    expect(res.entries.earned._meta.reward).toBe(1); // clamped
  });

  it('appears in the explain breakdown (signals · weights · contribution)', async () => {
    const res = await state.read('alice', { elision: 'none', explain: true, salience: { rewardWeight: 0.25 } });
    const ex = res.entries.earned._meta.explain!;
    expect(ex.signals.reward).toBe(1);
    expect(ex.weights.reward).toBe(0.25);
    expect(ex.contribution.reward).toBeCloseTo(0.25, 4);
    expect(res.entries.plain._meta.explain!.signals.reward).toBe(0);
  });

  it('is settable through _config/salience (the substrate-native opt-in, no redeploy)', async () => {
    // Fresh twins written back-to-back so every other signal is equal (the
    // original pair diverged in touch counts from the rewrite test above).
    await cmds.remember({ key: 'cfgPlain', value: { n: 1 }, type: 'note' }, ctx);
    await cmds.remember({ key: 'cfgEarned', value: { n: 1 }, type: 'note', reward: 1 }, ctx);
    await cmds.remember({ key: '_config/salience', value: { rewardWeight: 0.2 } }, ctx);
    const res = await state.read('alice', { elision: 'none' });
    const lift = res.entries.cfgEarned._meta.score - res.entries.cfgPlain._meta.score;
    expect(lift).toBeCloseTo(0.2, 4);
    // clean up so other assertions in this suite aren't affected by config
    await cmds.supersede({ key: '_config/salience' }, ctx);
  });

  it('scoreParts is pure: the term is a straight weighted addition', () => {
    const base = { updatedAtMs: 0, nowMs: 0 };
    const s = { rewardWeight: 0.5 };
    const resolved = (w: object) =>
      // resolveSalience is internal; drive scoreParts through the public shape by
      // passing a fully-defaulted options object via computed defaults:
      ({ ...defaultsForTest, ...w }) as Parameters<typeof scoreParts>[1];
    const without = scoreParts({ ...base }, resolved(s));
    const withReward = scoreParts({ ...base, reward: 0.8 }, resolved(s));
    expect(withReward.score - without.score).toBeCloseTo(0.4, 6);
    expect(withReward.reward).toBe(0.8);
  });
});

/** The resolved defaults `scoreParts` expects — mirrors `resolveSalience`'s
 *  documented defaults so the pure-function test needs no internal import. */
const defaultsForTest = {
  halfLifeMs: 7 * 24 * 60 * 60 * 1000,
  windowMs: 60 * 60 * 1000,
  velocitySaturation: 5,
  attentionSaturation: 5,
  standingSaturation: 20,
  centralitySaturation: 50,
  recencyWeight: 0.35,
  velocityWeight: 0.1,
  attentionWeight: 0.15,
  standingWeight: 0.3,
  centralityWeight: 0.1,
  relevanceWeight: 0,
  rewardWeight: 0,
  humanTouchWeight: 1,
  agentTouchWeight: 0.25,
  platformTouchWeight: 0,
  typePriors: {},
  focusThreshold: 0.5,
  elideThreshold: 0.1,
};
