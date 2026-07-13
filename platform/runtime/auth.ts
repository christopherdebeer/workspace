/**
 * Authentication.
 *
 * For HTTP requests the runtime derives identity from a validated
 * `Authorization: Bearer` token: `define-service` invokes the `auth` cell's
 * `validateToken` command and populates `ctx.identity` (see
 * `resolveHttpIdentity`). Client-supplied `x-auth-*` headers are NOT trusted —
 * CloudFront forwards all viewer headers, so trusting them would let any caller
 * spoof identity. For direct service-to-service invokes the caller's identity is
 * carried on the command envelope.
 *
 * `identityFromHeaders` remains for a future trusted-edge authorizer (one that
 * validates the bearer and injects these headers before the cell), but it is not
 * on the HTTP path today.
 */

/**
 * Coarse embodiment class of the acting principal (ADR-0050 × ADR-0022): the
 * person themselves, a mediated agent (an MCP client or cell acting
 * on-behalf-of via a minted token principal), or the platform's own machinery.
 * Salience weights attention by this, so an agent reading through your token
 * no longer reads AS you. When ADR-0024 delegation chains land, any `act`
 * chain stays `agent` regardless of depth.
 */
export type ActorClass = 'human' | 'agent' | 'platform';

/**
 * A principal's adopted posture (ADR-0074) — what this session is currently
 * *for*. Adopted via `auth.adoptGoal`, stored on the token record, threaded
 * here by the validated-token path. `goal` is a workspace fact key
 * (`goal/<id>`) or free text; `lens`/`salience` name a read bias. Readers
 * interpret it (the workspace read resolves `defaults ← config ← PRINCIPAL ←
 * lens ← override`); it biases ranking only, never scope or membership.
 */
export interface PrincipalPosture {
  goal?: string;
  lens?: string;
  salience?: Record<string, number>;
  adoptedAt?: string;
}

/**
 * A delegation-chain claim (ADR-0024, the RFC 8693 `act` shape): `sub` names
 * the ACTING principal at this hop, `act` nests the prior hop. The OUTERMOST
 * claim is the leaf — the principal actually doing the work — and unwinding
 * `act` reads "leaf, acting for …, acting for the subject". The token's
 * subject (`mintedBy`/`Identity.user`) stays the authorization anchor; the
 * chain is PROVENANCE, threaded into writer stamps, never into scope checks
 * (scope already clamps at each exchange — delegation only attenuates).
 */
export interface ActClaim {
  sub: string;
  act?: ActClaim;
}

/** The chain unwound leaf-first: `['sub-agent', 'agent']` — for audit views. */
export function unwindActChain(act: ActClaim | null | undefined): string[] {
  const out: string[] = [];
  for (let cur = act ?? undefined; cur; cur = cur.act) out.push(cur.sub);
  return out;
}

/** The leaf actor — the principal a delegated write is attributed to (ADR-0024 §3). */
export function leafActOf(identity: { act?: ActClaim } | null | undefined): string | null {
  return identity?.act?.sub ?? null;
}

export interface Identity {
  /** Authenticated principal, e.g. a username. Undefined for anonymous calls. */
  user?: string;
  /**
   * The embodiment class behind this call, when the auth layer can tell —
   * stamped from the validated token (a DCR `clientId` marks a connected
   * client = `agent`; a first-party session = `human`). Absent ⇒ classify by
   * principal name (`actorClassOf`).
   */
  actor?: ActorClass;
  /**
   * The session's **effective** scopes — what is enforced now. Defaults to the
   * token's full grant, but a session may narrow it (`auth.focusScope`) and widen
   * back up to the ceiling on demand (`auth.requestScope`) — incremental
   * authorization (docs/capability-consent.md). Enforcement (`hasScope`) reads
   * this; the grant ceiling lives in `grantScopes`.
   */
  scopes: string[];
  /**
   * The token's **granted** scopes — the immutable ceiling set at consent. The
   * effective scope can never exceed this. Absent ⇒ equal to `scopes` (the common
   * case, and back-compat for callers that never narrowed). Use `grantScopesOf`.
   */
  grantScopes?: string[];
  /** The id of the bearer token backing this session, when known — the handle the
   *  session uses to mutate its own effective scope. Absent for internal/event calls. */
  tokenId?: string;
  /** The adopted posture riding this session's token (ADR-0074), when any. */
  posture?: PrincipalPosture;
  /**
   * The delegation chain riding this session's token (ADR-0024), when the
   * credential was produced by `auth.exchangeToken` — outermost = the leaf
   * actor. Absent for root tokens (the principal acts as themselves).
   * Provenance only: `user`/`scopes` still drive every authorization check.
   */
  act?: ActClaim;
  /**
   * True when identity resolution ERRORED (auth service unreachable/throwing)
   * rather than returning a clean verdict — the caller's credential was never
   * actually checked. HTTP seams should answer `auth_unavailable`/503, never
   * `invalid_token`, so clients retry instead of discarding a token that may
   * be perfectly fine.
   */
  degraded?: boolean;
}

const ANONYMOUS: Identity = { user: undefined, scopes: [] };

function headerValue(
  headers: Record<string, string | undefined> | undefined,
  name: string,
): string | undefined {
  if (!headers) return undefined;
  // HTTP headers are case-insensitive; Function URL lowercases them, but be safe.
  const direct = headers[name] ?? headers[name.toLowerCase()];
  if (direct !== undefined) return direct;
  const match = Object.keys(headers).find((k) => k.toLowerCase() === name.toLowerCase());
  return match ? headers[match] : undefined;
}

/** Build an Identity from the trusted, edge-normalised request headers. */
export function identityFromHeaders(
  headers: Record<string, string | undefined> | undefined,
): Identity {
  const user = headerValue(headers, 'x-auth-user');
  if (!user) return ANONYMOUS;
  const scopesRaw = headerValue(headers, 'x-auth-scopes');
  const scopes = scopesRaw ? scopesRaw.split(',').map((s) => s.trim()).filter(Boolean) : [];
  return { user, scopes };
}

export function requireUser(identity: Identity): string {
  if (!identity.user) {
    throw new ServiceAuthError('Authentication required');
  }
  return identity.user;
}

// ─── the scope grammar (docs/scope-grants.md) ────────────────────
//
// A scope is a `:`-separated pattern over one resource grammar:
//   workspace:<owner>:<keyPrefix|*>:<read|write>   facts
//   cell:<owner>/<name>:<tool|*>                    tools
//   platform:<verb>                                 kernel verbs
// `*` as the final segment matches one-or-more remaining segments (so `a:b:*`
// covers `a:b:c` and `a:b:c:d`, but not `a:b` itself — today's behaviour);
// `*` mid-pattern matches exactly one segment (`workspace:*:read`).

/** Whether `pattern` covers the concrete (or narrower) `scope`. */
export function matchesScope(pattern: string, scope: string): boolean {
  if (pattern === scope) return true;
  const p = pattern.split(':');
  const s = scope.split(':');
  for (let i = 0; i < p.length; i++) {
    const last = i === p.length - 1;
    if (p[i] === '*' && last) return s.length > i; // rest wildcard: ≥1 more segment
    if (i >= s.length) return false;
    if (p[i] !== '*' && p[i] !== s[i]) return false;
  }
  return p.length === s.length;
}

/**
 * Intersect two scope patterns — the `effective = grants ∩ token` rule's unit.
 * Returns the narrower pattern both cover, or null when they are disjoint.
 * E.g. `workspace:*:read` ∩ `workspace:c15r:inbox/*:*` = `workspace:c15r:read`
 * is NOT a thing — segments align positionally: `a:*:c` ∩ `a:b:*` = `a:b:c`.
 */
export function intersectScopePatterns(a: string, b: string): string | null {
  const segsA = a.split(':');
  const segsB = b.split(':');
  const restA = segsA[segsA.length - 1] === '*' && segsA.length > 0 ? !!segsA.pop() : false;
  const restB = segsB[segsB.length - 1] === '*' && segsB.length > 0 ? !!segsB.pop() : false;
  const out: string[] = [];
  const len = Math.max(segsA.length, segsB.length);
  for (let i = 0; i < len; i++) {
    const inA = i < segsA.length;
    const inB = i < segsB.length;
    if (inA && inB) {
      const sa = segsA[i];
      const sb = segsB[i];
      if (sa === '*') out.push(sb);
      else if (sb === '*' || sa === sb) out.push(sa);
      else return null;
    } else if (inA) {
      if (!restB) return null; // B is exhausted and does not cover deeper
      out.push(segsA[i]);
    } else {
      if (!restA) return null;
      out.push(segsB[i]);
    }
  }
  if (restA && restB) return [...out, '*'].join(':');
  // One side demands ≥1 more segment the other cannot provide → disjoint.
  if (restA !== restB && segsA.length === segsB.length) return null;
  return out.join(':');
}

/**
 * Effective access: the pairwise intersection of two scope sets. A token's
 * scopes are a ceiling over the principal's standing — intersection can only
 * narrow, never widen (docs/scope-grants.md §3).
 */
export function intersectScopes(a: string[], b: string[]): string[] {
  const out = new Set<string>();
  for (const sa of a) {
    for (const sb of b) {
      const meet = intersectScopePatterns(sa, sb);
      if (meet !== null) {
        out.add(meet);
        continue;
      }
      // Structurally disjoint, but the coarse⊇granular back-compat (`impliesScope`)
      // crosses the two grammars: a coarse ceiling (`workspace:write`) covers a
      // granular request (`write:workspace`). The meet is then the NARROWER
      // (granular) of the two — so a cell ceiling cannot zero out a token that
      // legitimately asked for granular scopes. Mirrors `hasScope`, which already
      // honours `impliesScope` on the enforcement side; without it here the mint
      // path would silently drop migrated scopes (docs/capability-consent.md).
      if (impliesScope(sa, sb)) out.add(sb);
      else if (impliesScope(sb, sa)) out.add(sa);
    }
  }
  return [...out];
}

/**
 * Back-compat for the granular scope vocabulary (Phase 2, docs/capability-consent.md):
 * a coarse grant implies its granular family, so a legacy `workspace:read` token
 * still satisfies a tool that has migrated to require `read:…`/`write:…`/`act:…`.
 * Only fires for GRANULAR required scopes (which no tool declares yet), so it is
 * inert today; and it only ever WIDENS what a held scope satisfies, so it can
 * never lock out an existing token. Granular→coarse is deliberately NOT implied
 * (granular tokens aren't issued until tools migrate).
 */
export function impliesScope(held: string, required: string): boolean {
  const isRead = required.startsWith('read:');
  const isWrite = required.startsWith('write:') || required.startsWith('act:');
  if (!isRead && !isWrite && required !== 'cells:create') return false; // coarse req → matchesScope only
  switch (held) {
    case 'platform:*':
      return true;
    case 'workspace:admin':
      return isRead || isWrite;
    case 'workspace:read':
      return isRead;
    case 'workspace:write':
      return isWrite;
    case 'platform:cells:create':
      return required === 'cells:create';
    default:
      return false;
  }
}

/**
 * Whether the identity holds `scope` (or a broader wildcard parent). A held
 * scope `a:b:*` satisfies a required `a:b:c`; an exact match always satisfies;
 * and a coarse grant satisfies its granular family (`impliesScope`). Pure
 * predicate — use for filtering (e.g. which tools to advertise); use
 * `requireScope` to enforce.
 */
export function hasScope(identity: Identity, scope: string): boolean {
  return identity.scopes.some((held) => matchesScope(held, scope) || impliesScope(held, scope));
}

/** The grant ceiling for an identity — `grantScopes` when present, else the
 *  effective `scopes` (back-compat: a session that never narrowed). */
export function grantScopesOf(identity: Identity): string[] {
  return identity.grantScopes ?? identity.scopes;
}

/**
 * Whether the identity holds at least one scope UNDER a family pattern — e.g. any
 * `write:type:*`. This is the REVERSE of `hasScope`: `hasScope` asks "does a held
 * scope COVER the required one?"; this asks "is some held scope covered BY the
 * family?". It backs an *any-of* gate ("may write SOME type") that a downstream
 * handler then refines against the concrete fact type (docs/auth-consent-plan.md §B).
 */
export function holdsUnder(identity: Identity, family: string): boolean {
  return identity.scopes.some((held) => matchesScope(family, held));
}

/**
 * Whether the identity's **grant ceiling** covers `scope` — i.e. the token was
 * consented for it, even if the session has narrowed it out of the effective set.
 * This is the line between a self-serve widen (`scope_offer` → `auth.requestScope`,
 * within the ceiling) and a hard `scope_denied` (outside it → human re-consent).
 */
export function hasGrantScope(identity: Identity, scope: string): boolean {
  return grantScopesOf(identity).some((held) => matchesScope(held, scope) || impliesScope(held, scope));
}

/**
 * Enforce that the identity carries `scope` (or a broader wildcard parent).
 * Returns the authenticated user.
 */
export function requireScope(identity: Identity, scope: string): string {
  const user = requireUser(identity);
  if (!hasScope(identity, scope)) {
    throw new ServiceAuthError(`Missing required scope: ${scope}`);
  }
  return user;
}

export class ServiceAuthError extends Error {
  readonly statusCode = 401;
  constructor(message: string) {
    super(message);
    this.name = 'ServiceAuthError';
  }
}
