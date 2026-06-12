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
});
