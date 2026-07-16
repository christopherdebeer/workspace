/**
 * ADR-0074 — principal-adopted goals, behaviour-preservation gate.
 *
 * Auth half: a posture {goal, lens, salience} is adopted onto a token
 * (`adoptGoal`/`dropGoal`, self or a child you own), persists on the record,
 * and rides `validateToken` — the same path effectiveScope takes.
 *
 * Workspace half: `read()` resolves its defaults THROUGH the principal
 * (`defaults ← config ← PRINCIPAL ← lens ← override`) — default-inert twice
 * over: a posture-free identity is byte-identical to before, and a postured
 * identity's reads deep-equal today's reads with the equivalent per-call
 * `text`/`lens` supplied. Posture biases parameters, never the SHAPE (a bare
 * read stays an overview) and never membership (scope is untouched).
 */
import { handler as auth } from '../services/auth/service';
import { createWorkspaceCommands } from '../services/workspace/handlers';
import { principalPosture, goalTextOf } from '../services/workspace/commands-read';
import { createObservedState, createMemoryStateStore } from '../platform/runtime';
import { createMemoryGrantStore } from '../services/workspace/grants';
import type { ServiceContext } from '../platform/runtime';

interface TestIdentity {
  user?: string;
  scopes?: string[];
  grantScopes?: string[];
  tokenId?: string;
  posture?: { goal?: string; lens?: string; salience?: Record<string, number> };
}
async function cmd<T = unknown>(command: string, payload: unknown, identity: TestIdentity = {}): Promise<T> {
  const res = (await auth({ __command: command, payload, ...identity } as never)) as { ok: boolean; result?: T; error?: string };
  if (!res.ok) throw new Error(res.error);
  return res.result as T;
}

describe('ADR-0074 — posture on the token (auth.adoptGoal / dropGoal)', () => {
  beforeEach(() => {
    process.env.SERVICE_NAME = 'auth';
    delete process.env.EVENT_BUS_NAME;
  });
  afterEach(() => {
    delete process.env.SERVICE_NAME;
  });

  const GRANT = ['workspace:read', 'workspace:write'];

  it('adopts, validates, and drops a posture on the session token', async () => {
    const minted = await cmd<{ id: string; token: string }>(
      'mintToken',
      { scope: GRANT.join(' ') },
      { user: 'alice', scopes: GRANT, grantScopes: GRANT },
    );
    const session: TestIdentity = { user: 'alice', scopes: GRANT, grantScopes: GRANT, tokenId: minted.id };

    // Fresh token: no posture.
    const v0 = await cmd<{ posture: unknown }>('validateToken', { token: minted.token });
    expect(v0.posture).toBeNull();

    // Adopt — the posture persists on the record and rides validateToken.
    const adopted = await cmd<{ adopted: boolean; posture: { goal: string; lens: string; adoptedAt: string } }>(
      'adoptGoal',
      { goal: 'goal/g1', lens: 'recent' },
      session,
    );
    expect(adopted.adopted).toBe(true);
    const v1 = await cmd<{ posture: { goal: string; lens: string } | null }>('validateToken', { token: minted.token });
    expect(v1.posture).toMatchObject({ goal: 'goal/g1', lens: 'recent' });

    // Drop — reads return to unbiased defaults.
    const dropped = await cmd<{ dropped: boolean }>('dropGoal', {}, session);
    expect(dropped.dropped).toBe(true);
    const v2 = await cmd<{ posture: unknown }>('validateToken', { token: minted.token });
    expect(v2.posture).toBeNull();
  });

  it('a minter postures a CHILD token it owns (delegation attenuates attention); strangers cannot', async () => {
    const child = await cmd<{ id: string; token: string }>(
      'mintToken',
      { scope: 'workspace:read', label: 'sub-agent' },
      { user: 'alice', scopes: GRANT, grantScopes: GRANT },
    );
    const parent: TestIdentity = { user: 'alice', scopes: GRANT, grantScopes: GRANT, tokenId: 'parent-token-id' };
    const adopted = await cmd<{ adopted: boolean }>('adoptGoal', { tokenId: child.id, goal: 'audit the backlog' }, parent);
    expect(adopted.adopted).toBe(true);
    const v = await cmd<{ posture: { goal: string } | null }>('validateToken', { token: child.token });
    expect(v.posture).toMatchObject({ goal: 'audit the backlog' });

    // A different principal cannot posture alice's token (owner-keyed, like setEffectiveScope).
    const mallory: TestIdentity = { user: 'mallory', scopes: GRANT, grantScopes: GRANT, tokenId: 'm1' };
    const refused = await cmd<{ adopted: boolean }>('adoptGoal', { tokenId: child.id, goal: 'exfiltrate' }, mallory);
    expect(refused.adopted).toBe(false);
  });

  it('rejects an empty posture', async () => {
    const session: TestIdentity = { user: 'alice', scopes: GRANT, grantScopes: GRANT, tokenId: 'whatever' };
    await expect(cmd('adoptGoal', {}, session)).rejects.toThrow(/at least one of/);
  });
});

describe('ADR-0074 — read() resolves through the principal', () => {
  const store = createMemoryStateStore();
  const state = createObservedState(store);
  const cmds = createWorkspaceCommands(() => ({ state, grants: createMemoryGrantStore(), store }));

  const ctxFor = (posture?: TestIdentity['posture']): ServiceContext =>
    ({
      identity: { user: 'alice', scopes: ['workspace:write', 'workspace:read'], ...(posture ? { posture } : {}) },
      config: { tableName: 'unused-in-memory' },
      events: { emit: async () => {} },
      logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
    }) as unknown as ServiceContext;
  const bare = ctxFor();

  beforeAll(async () => {
    await cmds.remember({ key: 'n/a', value: { t: 'the contraction wave ships composed reads' }, type: 'note' }, bare);
    await cmds.remember({ key: 'n/b', value: { t: 'grocery list: apples' }, type: 'note' }, bare);
    await cmds.remember(
      { key: 'goal/g1', value: { title: 'Close the wave', detail: 'compose the read surface', id: 'g1', status: 'active' }, type: 'goal' },
      bare,
    );
  });

  it('principalPosture maps the identity; lens names pass through (ADR-0078: resolution is the state layer’s)', () => {
    expect(principalPosture({ user: 'a' })).toBeNull();
    expect(principalPosture({ user: 'a', posture: {} })).toBeNull();
    // A lens name the compiled floor doesn't know may be slice-DECLARED
    // (`_config/lenses`) — it passes through; an unknown name is ignored at
    // resolution, never fatal (gated in declared-lenses.test.ts).
    expect(principalPosture({ user: 'a', posture: { goal: 'x', lens: 'my-review-lens' } })).toEqual({
      goal: 'x',
      lens: 'my-review-lens',
    });
    expect(principalPosture({ user: 'a', posture: { goal: 'x', lens: 'recent', salience: { rewardWeight: 0.1 } } })).toEqual({
      goal: 'x',
      lens: 'recent',
      salience: { rewardWeight: 0.1 },
    });
  });

  it('goalTextOf prefers the tasks shape (title — detail)', () => {
    expect(goalTextOf({ title: 'Close the wave', detail: 'compose the read surface' })).toBe(
      'Close the wave — compose the read surface',
    );
    expect(goalTextOf({ title: 'Just a title' })).toBe('Just a title');
    expect(goalTextOf('free text')).toBe('free text');
    expect(goalTextOf(42)).toBeNull();
  });

  it('a postured read ≡ the same read with the equivalent per-call text/lens (the gate)', async () => {
    const postured = ctxFor({ goal: 'contraction wave', lens: 'recent' });
    expect(await cmds.read({ view: 'full' }, postured)).toEqual(
      await cmds.recall({ view: 'full', text: 'contraction wave', lens: 'recent' }, bare),
    );
    expect(await cmds.read({ type: 'note' }, postured)).toEqual(
      await cmds.query({ type: 'note', text: 'contraction wave', lens: 'recent' }, bare),
    );
  });

  it('a goal/<id> posture resolves the FACT to its title/detail (the goal graph, not a string)', async () => {
    const postured = ctxFor({ goal: 'goal/g1' });
    expect(await cmds.read({ type: 'note' }, postured)).toEqual(
      await cmds.query({ type: 'note', text: 'Close the wave — compose the read surface' }, bare),
    );
    // An unresolvable key passes through as free text (the degenerate case).
    const dangling = ctxFor({ goal: 'goal/nope' });
    expect(await cmds.read({ type: 'note' }, dangling)).toEqual(await cmds.query({ type: 'note', text: 'goal/nope' }, bare));
  });

  it('the caller always wins over the posture', async () => {
    const postured = ctxFor({ goal: 'contraction wave', lens: 'recent' });
    expect(await cmds.read({ view: 'full', text: 'grocery', lens: 'durable' }, postured)).toEqual(
      await cmds.recall({ view: 'full', text: 'grocery', lens: 'durable' }, bare),
    );
  });

  it('posture biases parameters, never the SHAPE: a bare read stays an overview', async () => {
    const postured = ctxFor({ goal: 'contraction wave' });
    const result = (await cmds.read(undefined, postured)) as Record<string, unknown>;
    expect(result.overview).toBeDefined(); // still recall's overview, goal-conditioned
    expect(result).toEqual(await cmds.recall({ text: 'contraction wave' }, bare));
  });

  it('default-inert: a posture-free identity is byte-identical to the presets', async () => {
    expect(await cmds.read({ view: 'full' }, bare)).toEqual(await cmds.recall({ view: 'full' }, bare));
    expect(await cmds.read({ type: 'note' }, bare)).toEqual(await cmds.query({ type: 'note' }, bare));
  });
});

describe('ADR-0086 Inc 4 — per-participant posture (_posture/<participant>)', () => {
  const store = createMemoryStateStore();
  const state = createObservedState(store);
  const cmds = createWorkspaceCommands(() => ({ state, grants: createMemoryGrantStore(), store }));

  const ctxAs = (participant?: string, posture?: TestIdentity['posture']): ServiceContext =>
    ({
      identity: {
        user: 'alice',
        scopes: ['workspace:write', 'workspace:read'],
        ...(participant ? { participant } : {}),
        ...(posture ? { posture } : {}),
      },
      config: { tableName: 'unused-in-memory' },
      events: { emit: async () => {} },
      logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
    }) as unknown as ServiceContext;
  const bare = ctxAs();

  beforeAll(async () => {
    await cmds.remember({ key: 'n/a', value: { t: 'the contraction wave ships composed reads' }, type: 'note' }, bare);
    await cmds.remember({ key: 'n/b', value: { t: 'grocery list: apples' }, type: 'note' }, bare);
    // The participant adopts its OWN posture: a plain fact, sibling of _presence/*.
    await cmds.remember({ key: '_posture/driver/weave', value: { goal: 'contraction wave', lens: 'recent' } }, bare);
  });

  it("a participant's _posture fact overrides the token posture; the finer key wins", async () => {
    // Token says groceries; the participant's own posture says contraction wave.
    const ctx = ctxAs('driver/weave', { goal: 'grocery' });
    expect(await cmds.read({ type: 'note' }, ctx)).toEqual(
      await cmds.query({ type: 'note', text: 'contraction wave', lens: 'recent' }, bare),
    );
  });

  it('a participant with no posture fact falls back to the token posture; caller args still win', async () => {
    const ctx = ctxAs('driver/other', { goal: 'grocery' });
    expect(await cmds.read({ type: 'note' }, ctx)).toEqual(await cmds.query({ type: 'note', text: 'grocery' }, bare));
    // Per-call args beat both layers.
    const explicit = ctxAs('driver/weave', { goal: 'grocery' });
    expect(await cmds.read({ type: 'note', text: 'apples' }, explicit)).toEqual(
      await cmds.query({ type: 'note', text: 'apples' }, bare),
    );
  });

  it('a lapsed posture fact reads as absent (timer physics — a posture can expire with its task)', async () => {
    await cmds.remember({ key: '_posture/driver/brief', value: { goal: 'contraction wave' }, timer: { ms: 60_000, effect: 'delete' } }, bare);
    const ctx = ctxAs('driver/brief');
    // Live: biases the read.
    expect(await cmds.read({ type: 'note' }, ctx)).toEqual(await cmds.query({ type: 'note', text: 'contraction wave' }, bare));
    // Force-expire by rewriting with a past timer (the release idiom).
    await cmds.remember({ key: '_posture/driver/brief', value: { goal: 'contraction wave' }, timer: { at: new Date(Date.now() - 1000).toISOString(), effect: 'delete' } }, bare);
    expect(await cmds.read({ type: 'note' }, ctx)).toEqual(await cmds.query({ type: 'note' }, bare));
  });
});
