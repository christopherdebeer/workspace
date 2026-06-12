/**
 * Grant requests — the agent half of the escalation loop (docs/scope-grants.md §5).
 *
 * A denied caller asks the resource owner for access by writing a request fact
 * into the **owner's** slice (the one cross-slice write the platform performs
 * itself, server-stamped with the requester as writer — provenance is the
 * anti-spoofing). The owner sees it in `grantRequests` (and home's inbox),
 * resolves it with `approveGrant`/`denyGrant`, and the outcome is written back
 * into the **requester's** slice under `_grants/answers/` so they can observe
 * it without any new notification machinery.
 *
 * Resources use the scope grammar:
 *   workspace:<owner>:<keyPattern>:<read|write>   facts (key, prefix `inbox/*`, or `*`)
 *   cell:<owner>/<name>:<tool|*>                   tools
 */
import type { GrantMode } from './grants';

/** Reserved namespace for grant requests/answers — never writable through grants. */
export const GRANTS_NS = '_grants/';
export const REQUESTS_PREFIX = '_grants/requests/';
export const ANSWERS_PREFIX = '_grants/answers/';

export const NOTE_MAX = 500;

export interface ParsedResource {
  family: 'workspace' | 'cell';
  /** The principal who can grant this resource. */
  owner: string;
  /** workspace family: the key, prefix (`inbox/*`), or `*`. */
  keyPattern?: string;
  /** workspace family: the requested verb. */
  mode?: GrantMode;
  /** cell family: the cell name. */
  cellName?: string;
  /** cell family: a tool name, trailing-`*` pattern, or `*` for every tool. */
  tool?: string;
  raw: string;
}

/** Parse a grammar resource string; throws a teaching error when malformed. */
export function parseResource(resource: string): ParsedResource {
  const malformed = () =>
    new Error(
      `Malformed resource "${resource}". Expected "workspace:<owner>:<keyPattern>:<read|write>" or "cell:<owner>/<name>:<tool|*>".`,
    );
  if (typeof resource !== 'string' || !resource) throw malformed();

  if (resource.startsWith('workspace:')) {
    const parts = resource.split(':');
    if (parts.length !== 4) throw malformed();
    const [, owner, keyPattern, mode] = parts;
    if (!owner || !keyPattern || (mode !== 'read' && mode !== 'write')) throw malformed();
    return { family: 'workspace', owner, keyPattern, mode, raw: resource };
  }

  if (resource.startsWith('cell:')) {
    const parts = resource.split(':');
    if (parts.length !== 3) throw malformed();
    const [, address, tool] = parts;
    const slash = address.indexOf('/');
    if (slash < 1 || slash === address.length - 1 || !tool) throw malformed();
    return {
      family: 'cell',
      owner: address.slice(0, slash),
      cellName: address.slice(slash + 1),
      tool,
      raw: resource,
    };
  }

  throw malformed();
}

/** Deterministic request key: one open request per (requester, resource). */
export function requestKey(requester: string, resource: string): string {
  return `${REQUESTS_PREFIX}${requester}/${resource}`;
}

/** Where the outcome lands in the requester's slice. */
export function answerKey(owner: string, resource: string): string {
  return `${ANSWERS_PREFIX}${owner}/${resource}`;
}

export interface GrantRequestValue {
  requester: string;
  resource: string;
  note?: string;
  status: 'pending' | 'approved' | 'denied';
  requestedAt: string;
  resolvedAt?: string;
  reason?: string;
}

export interface GrantAnswerValue {
  resource: string;
  status: 'approved' | 'denied';
  by: string;
  at: string;
  reason?: string;
}
