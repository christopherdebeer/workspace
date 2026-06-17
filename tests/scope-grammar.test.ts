/**
 * The scope grammar + ∩ algebra (docs/scope-grants.md §3) — pure functions in
 * platform/runtime/auth.ts. `hasScope` keeps its historic semantics (trailing
 * `:*` is a prefix wildcard); `intersectScopes` is the `effective = grants ∩
 * token` rule: narrow, never widen.
 */
import { hasScope, matchesScope, intersectScopePatterns, intersectScopes } from '../platform/runtime';

describe('matchesScope', () => {
  it('matches exact scopes', () => {
    expect(matchesScope('workspace:read', 'workspace:read')).toBe(true);
    expect(matchesScope('workspace:read', 'workspace:write')).toBe(false);
  });

  it('trailing * covers one-or-more deeper segments, not the bare prefix', () => {
    expect(matchesScope('platform:*', 'platform:cells:create')).toBe(true);
    expect(matchesScope('a:b:*', 'a:b:c')).toBe(true);
    expect(matchesScope('a:b:*', 'a:b:c:d')).toBe(true);
    expect(matchesScope('a:b:*', 'a:b')).toBe(false);
  });

  it('mid-pattern * matches exactly one segment', () => {
    expect(matchesScope('workspace:*:read', 'workspace:c15r:read')).toBe(true);
    expect(matchesScope('workspace:*:read', 'workspace:c15r:write')).toBe(false);
    expect(matchesScope('workspace:*:read', 'workspace:c15r:inbox:read')).toBe(false);
  });

  it('a longer pattern never covers a shorter scope', () => {
    expect(matchesScope('a:b:c', 'a:b')).toBe(false);
  });
});

describe('hasScope (back-compat over the matcher)', () => {
  const identity = { user: 'u', scopes: ['workspace:read', 'platform:*'] };
  it('exact and wildcard-parent both satisfy', () => {
    expect(hasScope(identity, 'workspace:read')).toBe(true);
    expect(hasScope(identity, 'platform:cells:create')).toBe(true);
    expect(hasScope(identity, 'workspace:write')).toBe(false);
  });
});

describe('granular scope back-compat (coarse grant ⊇ granular family)', () => {
  it('coarse grant satisfies the granular family — only widens, never locks out', () => {
    const reader = { user: 'u', scopes: ['workspace:read'] };
    expect(hasScope(reader, 'read:workspace')).toBe(true); // migrated read tool
    expect(hasScope(reader, 'read:@c15r/lit')).toBe(true);
    expect(hasScope(reader, 'write:type:note')).toBe(false); // read ≠ write
    const writer = { user: 'u', scopes: ['workspace:write'] };
    expect(hasScope(writer, 'write:type:note')).toBe(true);
    expect(hasScope(writer, 'act:@c15r/lit.publish')).toBe(true);
    expect(hasScope(writer, 'read:workspace')).toBe(false); // write does not imply read
    const maker = { user: 'u', scopes: ['platform:cells:create'] };
    expect(hasScope(maker, 'cells:create')).toBe(true);
    expect(hasScope({ user: 'u', scopes: ['platform:*'] }, 'write:type:note')).toBe(true);
  });

  it('is inert for coarse requirements (today: tools declare coarse) — no behavior change', () => {
    const reader = { user: 'u', scopes: ['workspace:read'] };
    expect(hasScope(reader, 'workspace:read')).toBe(true);
    expect(hasScope(reader, 'workspace:write')).toBe(false); // unchanged
  });
});

describe('intersectScopePatterns', () => {
  it('literal ∩ literal', () => {
    expect(intersectScopePatterns('a:b', 'a:b')).toBe('a:b');
    expect(intersectScopePatterns('a:b', 'a:c')).toBeNull();
  });

  it('the narrower side wins', () => {
    expect(intersectScopePatterns('workspace:*', 'workspace:read')).toBe('workspace:read');
    expect(intersectScopePatterns('a:b:*', 'a:b:c')).toBe('a:b:c');
    expect(intersectScopePatterns('a:b:c', 'a:b:*')).toBe('a:b:c');
  });

  it('mid-segment wildcards align positionally', () => {
    expect(intersectScopePatterns('a:*:c', 'a:b:*')).toBe('a:b:c');
    expect(intersectScopePatterns('a:*:c', 'a:b:d')).toBeNull();
  });

  it('rest ∩ rest stays a rest pattern', () => {
    expect(intersectScopePatterns('a:*', 'a:b:*')).toBe('a:b:*');
    expect(intersectScopePatterns('platform:*', 'platform:*')).toBe('platform:*');
  });

  it('a rest pattern is disjoint from its own bare prefix', () => {
    expect(intersectScopePatterns('a:b:*', 'a:b')).toBeNull();
  });

  it('the universal pattern narrows to anything', () => {
    expect(intersectScopePatterns('*', 'workspace:read')).toBe('workspace:read');
  });
});

describe('intersectScopes (effective access)', () => {
  it('narrows a request to the holder ceiling', () => {
    expect(intersectScopes(['workspace:read', 'platform:cells:create'], ['workspace:*'])).toEqual([
      'workspace:read',
    ]);
  });

  it('is empty when the sets are disjoint — a token cannot widen', () => {
    expect(intersectScopes(['platform:*'], ['workspace:read'])).toEqual([]);
  });

  it('dedupes the meet', () => {
    expect(intersectScopes(['workspace:read', 'workspace:*'], ['workspace:read'])).toEqual([
      'workspace:read',
    ]);
  });

  it('a coarse ceiling covers a granular request — the narrower (granular) survives', () => {
    // The cell-host ceiling is coarse (`workspace:read/write`); a client may now
    // request the granular vocabulary. Without the impliesScope crossover the
    // meet would be empty and the cell token would carry no scope at all.
    const ceiling = ['workspace:read', 'workspace:write', 'cell:o/n:*'];
    expect(intersectScopes(['read:workspace', 'write:workspace'], ceiling).sort()).toEqual([
      'read:workspace',
      'write:workspace',
    ]);
    // Read-only request against the same ceiling stays read-only (no write leak).
    expect(intersectScopes(['read:workspace'], ceiling)).toEqual(['read:workspace']);
  });

  it('does not let the crossover widen a disjoint pair', () => {
    // platform:* and workspace:read remain disjoint — impliesScope only fires for
    // GRANULAR requirements, so coarse∩coarse is unaffected.
    expect(intersectScopes(['platform:*'], ['workspace:read'])).toEqual([]);
  });
});
