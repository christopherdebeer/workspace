/**
 * Workspace command group (ADR-0044 Inc 5): grants/sharing/groups — share,
 * unshare, shared, grants, group, groups, and the grant-request flow
 * (requestGrant, grantRequests, approveGrant, denyGrant).
 */
import { requireUser, grantScopesOf, type Identity, type ObservedState, ServiceContext } from '../../platform/runtime';
import { PUBLIC, GROUPS_NS, PUBLIC_NS, WHOLE_SLICE, type Grant, type GrantMode } from './grants';
import {
  parseResource,
  requestKey,
  answerKey,
  REQUESTS_PREFIX,
  ANSWERS_PREFIX,
  NOTE_MAX,
  type GrantRequestValue,
  type GrantAnswerValue,
} from './grant-requests';
import { type DepsBuilder } from './shared';
import type { WorkspaceCommands } from './handlers';

export interface ShareInput {
  /** The user to share with. */
  to: string;
  /** A fact key, a prefix (`inbox/*`), or omitted to share your whole slice. */
  key?: string;
  /** `read` (default) or `write` — write-through lets the grantee remember into the covered keys. */
  mode?: GrantMode;
}
export type UnshareInput = Omit<ShareInput, 'mode'>;
export interface SharedResult {
  /** Grants you have made to others. */
  shared: Grant[];
  /** Grants others have made to you. */
  receiving: Grant[];
}
/**
 * The authority self-model (ADR-0007): *what the caller may see and do*, resolving
 * the three enforcement layers into one inspectable surface — beside `$catalog`
 * (capabilities), `$types` (vocabulary), and `$graph` (references). No new
 * enforcement; this names the axis that gates Fact · Reference · Declaration.
 */
export interface GrantsSelfModel {
  /** The authenticated principal this authority belongs to. */
  principal: string;
  /** Layer 1 — token scope. `active` = what is enforced now; `ceiling` = the
   *  immutable grant set at consent (`active` can be widened up to it). */
  scope: { active: string[]; ceiling: string[] };
  /** Layer 3 — partition: the caller's own slice, where they hold full authority. */
  slice: string;
  /** Layer 2 — grant: the subsets you expose (`shared`) and receive (`receiving`),
   *  plus the named audiences you belong to or define (`groups`). */
  grant: { shared: Grant[]; receiving: Grant[]; groups: GroupResult[] };
  /** The contract the three layers compose to, as prose. */
  hint: string;
}
export interface GroupValue {
  /** Principals in this audience. */
  members: string[];
  label?: string;
  note?: string;
}
export interface GroupInput {
  /** Group name (the audience handle; share to it with `to: "group:<name>"`). */
  name: string;
  /** Replace the membership wholesale. */
  members?: string[];
  /** Add these principals (additive patch). */
  add?: string[];
  /** Remove these principals (additive patch). */
  remove?: string[];
  label?: string;
  note?: string;
}
export interface GroupResult {
  name: string;
  members: string[];
  label?: string;
  note?: string;
}
export interface GroupsResult {
  groups: Array<GroupResult>;
}
export interface RequestGrantInput {
  /** Grammar resource: `workspace:<owner>:<keyPattern>:<read|write>` or `cell:<owner>/<name>:<tool|*>`. */
  resource: string;
  note?: string;
}
export interface RequestGrantResult {
  requested: true;
  owner: string;
  resource: string;
  /** The request fact key in the owner's slice. */
  key: string;
}
export interface GrantRequestsResult {
  /** Pending requests on resources you own (your inbox). */
  incoming: Array<GrantRequestValue & { key: string }>;
  /** Outcomes of requests you made (written into your slice on resolve). */
  answers: Array<GrantAnswerValue & { key: string }>;
}
export interface ApproveGrantInput {
  /** The request fact key (from `grantRequests`). */
  key: string;
}
export interface DenyGrantInput {
  key: string;
  reason?: string;
}

/** Load and validate a pending grant request fact from the owner's slice. */
async function pendingRequest(
  state: ObservedState,
  owner: string,
  key: string | undefined,
  identity: Identity,
): Promise<GrantRequestValue> {
  if (!key || !key.startsWith(REQUESTS_PREFIX)) {
    throw new Error(`key must be a grant-request fact key (see read("workspace.grantRequests"))`);
  }
  const entry = await state.get(owner, key, identity);
  const req = entry?.value as GrantRequestValue | undefined;
  if (!entry || entry._meta.superseded || req?.status !== 'pending') {
    throw new Error(`not_found: no pending grant request at "${key}"`);
  }
  if (parseResource(req.resource).owner !== owner) {
    throw new Error('only the resource owner can resolve this request');
  }
  return req;
}

/** Mark a request resolved and write the outcome into the requester's slice. */
async function resolveRequest(
  state: ObservedState,
  ctx: ServiceContext,
  owner: string,
  key: string,
  req: GrantRequestValue,
  status: 'approved' | 'denied',
  reason?: string,
): Promise<void> {
  const at = new Date().toISOString();
  const resolved: GrantRequestValue = { ...req, status, resolvedAt: at, ...(reason ? { reason } : {}) };
  await state.put(
    { scope: owner, key, value: resolved, via: `grants:${status}`, type: 'grant-request', tags: ['grants'] },
    ctx.identity,
  );
  // Resolved requests leave the pending inbox but stay in history.
  await state.supersede(owner, key, null, ctx.identity, {});
  const answer: GrantAnswerValue = { resource: req.resource, status, by: owner, at, ...(reason ? { reason } : {}) };
  await state.put(
    {
      scope: req.requester,
      key: answerKey(owner, req.resource),
      value: answer,
      via: `grants:${status}`,
      type: 'grant-answer',
      tags: ['grants'],
    },
    ctx.identity,
  );
  await ctx.events.emit('workspace.grant.resolved', {
    owner,
    requester: req.requester,
    resource: req.resource,
    status,
  });
  ctx.logger.info('grant request resolved', { owner, requester: req.requester, resource: req.resource, status });
}

/** The grants/sharing/groups command handlers (ADR-0044 Inc 5). */
export function createSharingCommands(build: DepsBuilder): Pick<WorkspaceCommands, 'share' | 'unshare' | 'shared' | 'grants' | 'group' | 'groups' | 'requestGrant' | 'grantRequests' | 'approveGrant' | 'denyGrant'> {
  return {
    async share(input, ctx) {
      const owner = requireUser(ctx.identity);
      if (!input?.to) throw new Error('to is required');
      if (input.to === owner) throw new Error('cannot share with yourself');
      const mode = input.mode ?? 'read';
      if (mode !== 'read' && mode !== 'write') throw new Error('mode must be "read" or "write"');
      // `public` is the universal audience (anyone, including anonymous): read-only,
      // never write — an open-write public grant would be an unbounded ingress.
      if (input.to === PUBLIC && mode !== 'read') throw new Error('public shares are read-only');
      const { grants } = build(ctx);
      const grant: Grant = {
        owner,
        grantee: input.to,
        key: input.key ?? WHOLE_SLICE,
        mode,
        createdAt: new Date().toISOString(),
      };
      await grants.put(grant);
      // Reflect public shares into the owner's slice so their own cells (which
      // read the slice under an IAM scope blind to the grant index) can serve
      // only public keys. The grant index stays the enforcement truth.
      if (input.to === PUBLIC) {
        const { state } = build(ctx);
        await state.put(
          { scope: owner, key: `${PUBLIC_NS}${grant.key}`, value: { pattern: grant.key, sharedAt: grant.createdAt }, via: 'share:public', type: 'public-share', tags: ['public'] },
          ctx.identity,
        );
      }
      await ctx.events.emit('workspace.shared', { owner, grantee: grant.grantee, key: grant.key, mode });
      ctx.logger.info('workspace shared', { owner, grantee: grant.grantee, key: grant.key, mode });
      return grant;
    },

    async unshare(input, ctx) {
      const owner = requireUser(ctx.identity);
      if (!input?.to) throw new Error('to is required');
      const { state, grants } = build(ctx);
      const key = input.key ?? WHOLE_SLICE;
      await grants.remove(owner, input.to, key);
      if (input.to === PUBLIC) await state.supersede(owner, `${PUBLIC_NS}${key}`, null, ctx.identity, {});
      return { ok: true };
    },

    async shared(_input, ctx) {
      const me = requireUser(ctx.identity);
      const { grants } = build(ctx);
      const [shared, receiving] = await Promise.all([grants.listByOwner(me), grants.listForGrantee(me)]);
      return { shared, receiving };
    },

    /**
     * The authority self-model (ADR-0007): one read that resolves the three
     * enforcement layers — token scope, the grant subsets, and the caller's own
     * partition — into "what may I see and do." Pure projection over the existing
     * machinery (identity scopes + the grant store); changes no enforcement.
     */
    async grants(_input, ctx) {
      const me = requireUser(ctx.identity);
      const { state, grants } = build(ctx);
      const [shared, receiving, groupsRes] = await Promise.all([
        grants.listByOwner(me),
        grants.listForGrantee(me),
        state.query(me, { prefix: GROUPS_NS, limit: 200 }, ctx.identity),
      ]);
      const groups = groupsRes.entries.map((e) => {
        const v = e.value as GroupValue;
        return { name: e.key.slice(GROUPS_NS.length), members: v.members ?? [], ...(v.label ? { label: v.label } : {}), ...(v.note ? { note: v.note } : {}) };
      });
      return {
        principal: me,
        scope: { active: ctx.identity.scopes ?? [], ceiling: grantScopesOf(ctx.identity) },
        slice: me,
        grant: { shared, receiving, groups },
        hint:
          'may(you, verb, resource) holds when all three gates pass: (1) scope — your active token covers the capability; (2) grant — the resource is your own slice, or a grant in `receiving` covers it (read) or grants write; (3) partition — IAM isolates each slice. Widen scope with auth.requestScope; ask for access with workspace.requestGrant.',
      };
    },

    /**
     * Define or patch a named audience (a group of principals) in your slice.
     * The group is a `_groups/<name>` fact (the record); the membership index is
     * written through so recall can resolve group grants without a slice scan.
     * Share to it with `workspace.share { to: "group:<name>" }`.
     */
    async group(input, ctx) {
      const owner = requireUser(ctx.identity);
      const name = (input?.name ?? '').trim();
      if (!name) throw new Error('name is required');
      if (name.includes('/') || name.startsWith('_')) throw new Error('group name must be a bare handle');
      const { state, grants } = build(ctx);
      const key = `${GROUPS_NS}${name}`;
      const existing = (await state.get(owner, key, ctx.identity))?.value as GroupValue | undefined;
      const before = new Set(existing?.members ?? []);
      const next = new Set(input.members !== undefined ? input.members : existing?.members ?? []);
      for (const p of input.add ?? []) next.add(p);
      for (const p of input.remove ?? []) next.delete(p);
      next.delete(owner); // the owner is implicitly in every one of their audiences
      next.delete(PUBLIC); // `public` is the reserved universal group, not a member
      const members = [...next].sort();
      // A patch (add/remove) preserves the existing label/note unless overridden.
      const label = input.label ?? existing?.label;
      const note = input.note ?? existing?.note;
      const value: GroupValue = {
        members,
        ...(label ? { label } : {}),
        ...(note ? { note } : {}),
      };
      await state.put({ scope: owner, key, value, via: 'groups:set', type: 'group', tags: ['groups'] }, ctx.identity);
      // Reconcile the membership index against the previous membership.
      await Promise.all([
        ...members.filter((p) => !before.has(p)).map((p) => grants.addMember(owner, name, p)),
        ...[...before].filter((p) => !next.has(p)).map((p) => grants.removeMember(owner, name, p)),
      ]);
      ctx.logger.info('workspace group set', { owner, group: name, members: members.length });
      return { name, ...value };
    },

    async groups(_input, ctx) {
      const owner = requireUser(ctx.identity);
      const { state } = build(ctx);
      const res = await state.query(owner, { prefix: GROUPS_NS, rankBy: 'recency', limit: 200 }, ctx.identity);
      return {
        groups: res.entries.map((e) => {
          const v = e.value as GroupValue;
          return { name: e.key.slice(GROUPS_NS.length), members: v.members ?? [], ...(v.label ? { label: v.label } : {}), ...(v.note ? { note: v.note } : {}) };
        }),
      };
    },

    async requestGrant(input, ctx) {
      const requester = requireUser(ctx.identity);
      const parsed = parseResource(input?.resource ?? '');
      if (parsed.owner === requester) {
        throw new Error('you own this resource — grant it directly (workspace.share or cells.grant)');
      }
      const note = input.note ? String(input.note).slice(0, NOTE_MAX) : undefined;
      const { state } = build(ctx);
      const key = requestKey(requester, parsed.raw);
      const value: GrantRequestValue = {
        requester,
        resource: parsed.raw,
        ...(note ? { note } : {}),
        status: 'pending',
        requestedAt: new Date().toISOString(),
      };
      // One open request per (requester, resource): a re-request bumps the
      // same fact's revision (and revives it after a deny) rather than piling up.
      await state.put(
        { scope: parsed.owner, key, value, via: 'grants:request', type: 'grant-request', tags: ['grants'] },
        ctx.identity,
      );
      await ctx.events.emit('workspace.grant.requested', { owner: parsed.owner, requester, resource: parsed.raw });
      ctx.logger.info('grant requested', { owner: parsed.owner, requester, resource: parsed.raw });
      return { requested: true, owner: parsed.owner, resource: parsed.raw, key };
    },

    async grantRequests(_input, ctx) {
      const me = requireUser(ctx.identity);
      const { state } = build(ctx);
      const [incoming, answers] = await Promise.all([
        state.query(me, { prefix: REQUESTS_PREFIX, rankBy: 'recency', limit: 100 }, ctx.identity),
        state.query(me, { prefix: ANSWERS_PREFIX, rankBy: 'recency', limit: 100 }, ctx.identity),
      ]);
      return {
        incoming: incoming.entries
          .map((e) => ({ key: e.key, ...(e.value as GrantRequestValue) }))
          .filter((r) => r.status === 'pending'),
        answers: answers.entries.map((e) => ({ key: e.key, ...(e.value as GrantAnswerValue) })),
      };
    },

    async approveGrant(input, ctx) {
      const me = requireUser(ctx.identity);
      const req = await pendingRequest(build(ctx).state, me, input?.key, ctx.identity);
      const parsed = parseResource(req.resource);
      const { state, grants } = build(ctx);
      if (parsed.family === 'workspace') {
        await grants.put({
          owner: me,
          grantee: req.requester,
          key: parsed.keyPattern as string,
          mode: parsed.mode,
          createdAt: new Date().toISOString(),
        });
      } else {
        // Cell-family resources are applied by the cells service (its registry
        // owns tool grants); workspace already holds the allow() for lifecycle.
        await ctx.serviceClient('cells').command('grant', {
          owner: me,
          name: parsed.cellName,
          principal: req.requester,
          ...(parsed.tool && parsed.tool !== '*' ? { tools: [parsed.tool] } : {}),
        });
      }
      await resolveRequest(state, ctx, me, input.key, req, 'approved');
      return { approved: true, resource: req.resource, grantee: req.requester };
    },

    async denyGrant(input, ctx) {
      const me = requireUser(ctx.identity);
      const req = await pendingRequest(build(ctx).state, me, input?.key, ctx.identity);
      const reason = input.reason ? String(input.reason).slice(0, NOTE_MAX) : undefined;
      const { state } = build(ctx);
      await resolveRequest(state, ctx, me, input.key, req, 'denied', reason);
      return { denied: true, resource: req.resource, grantee: req.requester };
    },
  };
}
