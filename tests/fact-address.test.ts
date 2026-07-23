/**
 * ADR-0090 — the fact address is a path.
 *
 * The key↔path codec (`/` and `:` literal, other characters per-segment
 * percent-coded), and the peek SELF-folded-spelling fix: `<me>/key` resolves
 * for the owner themselves (applicableGrants excludes own grants, so the
 * canonical folded deep link previously returned a false null to its owner).
 */
import { encodeKeyPath, decodeKeyPath } from '../cells/home/client/urlstate';
import { createWorkspaceCommands } from '../services/workspace/handlers';
import { createMemoryGrantStore } from '../services/workspace/grants';
import { createObservedState, createMemoryStateStore } from '../platform/runtime';
import type { ServiceContext } from '../platform/runtime';

function ctxFor(user: string | null): ServiceContext {
  return {
    identity: user ? { user, scopes: ['workspace:write', 'workspace:read'] } : null,
    config: { tableName: 'unused-in-memory' },
    events: { emit: async () => undefined },
    logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
  } as unknown as ServiceContext;
}

describe('key ↔ path codec (ADR-0040/0090 contract)', () => {
  it('keeps / and : literal; round-trips plain keys', () => {
    expect(encodeKeyPath('doc:docs/architecture/adr/0018-x')).toBe('doc:docs/architecture/adr/0018-x');
    expect(decodeKeyPath('c15r/doc:docs/a/b')).toBe('c15r/doc:docs/a/b');
  });

  it('percent-codes other reserved characters per segment, round-trip exact', () => {
    const key = 'note:a b/§odd&seg?';
    expect(decodeKeyPath(encodeKeyPath(key))).toBe(key);
    expect(encodeKeyPath(key)).not.toContain(' ');
    expect(encodeKeyPath(key)).not.toContain('?');
  });

  it('tolerates malformed escapes on decode (returns the raw segment)', () => {
    expect(decodeKeyPath('doc:%E0%A4%A')).toBe('doc:%E0%A4%A');
  });
});

describe('peek resolves the SELF-folded spelling (`<me>/key`)', () => {
  const store = createMemoryStateStore();
  const grants = createMemoryGrantStore();
  const state = createObservedState(store);
  const cmds = createWorkspaceCommands(() => ({ state, grants }));

  it('the owner reads their own fact through the owner-qualified address', async () => {
    await cmds.remember({ key: 'doc:docs/x', value: { title: 'X' } }, ctxFor('alice'));
    const e = await cmds.peek({ key: 'alice/doc:docs/x' }, ctxFor('alice'));
    expect((e?.value as { title?: string })?.title).toBe('X');
  });

  it('a LITERAL own key that starts `<me>/` still wins over the stripped form', async () => {
    await cmds.remember({ key: 'bob/weird', value: 'literal' }, ctxFor('bob'));
    await cmds.remember({ key: 'weird', value: 'stripped' }, ctxFor('bob'));
    const e = await cmds.peek({ key: 'bob/weird' }, ctxFor('bob'));
    expect(e?.value).toBe('literal');
  });

  it('a foreign owner-qualified key still requires a covering grant', async () => {
    await cmds.remember({ key: 'doc:secret', value: 'private' }, ctxFor('carol'));
    const denied = await cmds.peek({ key: 'carol/doc:secret' }, ctxFor('alice'));
    expect(denied).toBeNull();
    await cmds.share({ to: 'public', key: 'doc:secret' }, ctxFor('carol'));
    const granted = await cmds.peek({ key: 'carol/doc:secret' }, ctxFor('alice'));
    expect(granted?.value).toBe('private');
  });
});
