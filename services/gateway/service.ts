/**
 * The platform MCP **gateway** — owns `/mcp`, the single authenticated MCP
 * surface (and the OAuth-protected resource the auth cell advertises).
 *
 * It exposes a deliberately tiny, **stable** tool surface: `whoami`, `read`, and
 * `act`. All platform capability lives in their *arguments*, not the tool list —
 * so a new cell, command, or dynamic-cell tool becomes callable the instant it
 * exists, with no `tools/list` change and no client reconnect. This is the "true
 * dynamism" the named-tool aggregation could not give (named tools are cached by
 * clients at connect). It mirrors the substrate's own read/put duality, lifted to
 * the whole platform: `read` observes, `act` effects.
 *
 *   read({ target?, input? })   — observe; side-effect-free. target "$catalog"
 *                                 (or omitted) returns the capability menu *as
 *                                 data*, always current.
 *   act ({ target, input? })    — invoke a mutating capability.
 *
 * A `target` is a dotted address:
 *   - `<cell>.<command>`        for tier-1 kernel cells (`workspace.recall`, …)
 *   - `@<owner>/<cell>.<tool>`  for tier-2 dynamic cells (`@alice/notes.add`)
 *
 * One capability registry, resolved per request from the same providers the cells
 * already describe (`describeTools` for tier-1, `describeCellTools` for tier-2);
 * `read`/`act` are two projections of it. The gateway is the policy enforcement
 * point: each capability's scope is checked against the caller before forwarding,
 * and `read`/`act` refuse to cross the read/act boundary.
 *
 * Identity arrives already validated (this cell lists `auth` in `allow[]`);
 * unauthenticated calls get `401 + WWW-Authenticate` so clients can discover the
 * auth server.
 */
import {
  defineMcpService,
  withIdentity,
  hasScope,
  hasGrantScope,
  holdsUnder,
  ServiceAuthError,
  McpToolDefinition,
  ServiceContext,
  ServiceHttpRequest,
  ServiceHttpResponse,
  buildTypeVocabulary,
} from '../../platform/runtime';
import { typeSignals } from '../../platform/ui/vocab';
import { resolveUiResource, listUiResources, CARD_URI, UI_MIME } from './widgets';
import { validateInput, withInputWarnings, acceptedKeys, type InputValidation } from './validate';

const NO_STORE = { 'cache-control': 'no-store' };

/** Tier-1 (kernel) cells whose commands are dispatchable. Few, reviewed, IAM-granted. */
// auth contributes only its small token-management vocabulary (tokens/mint/
// revoke) — the OAuth plumbing stays on its own HTTP routes.
const PROVIDERS = ['workspace', 'cells', 'auth'] as const;

/** Sentinel target for the capability menu. */
const CATALOG = '$catalog';
/** Sentinel target for the type vocabulary (docs/type-vocabulary.md). */
const TYPES = '$types';
const GRAPH = '$graph';
const GRANTS = '$grants';
const CELLS = '$cells';
const PLATFORM_LOGS = 'platform.logs';
/** Admin scope gating `platform.logs` — `platform:*` (held by operators) implies it. */
const PLATFORM_ADMIN_SCOPE = 'platform:admin';

/** A tier-1 tool as returned by a provider's `describeTools`. */
interface ProviderTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  /** The declared result envelope, when the provider documents it. */
  resultSchema?: Record<string, unknown>;
  scope: string | null;
  /** An any-of family gate: a token holding any scope under this pattern (e.g.
   *  `write:type:*`) satisfies the gate, which the provider's handler then refines
   *  per the concrete request (docs/auth-consent-plan.md §B). */
  scopeFamily?: string | null;
  kind: 'read' | 'act';
}

/** A tier-2 dynamic-cell tool as returned by `forge.describeCellTools`. */
interface CellTool {
  name: string;
  address: string; // `@<owner>/<slug>`
  description: string;
  inputSchema: Record<string, unknown>;
  resultSchema?: Record<string, unknown>;
  scope: string | null;
  kind: 'read' | 'act';
  cellId: string;
  tool: string;
  /** Third-party-author disclosure (set by cells for non-owner callers). */
  disclosure?: { author: string; reads: string[]; note: string };
  /** ADR-0039 Inc 2 / ADR-0041 Inc 3: a cell-authored renderer (output) and/or
   *  a cell-authored argument form (input) for this tool. */
  ui?: { renderer?: string; as?: string; form?: string };
}

/** A resolved, dispatchable capability. */
interface Capability {
  target: string;
  kind: 'read' | 'act';
  description: string;
  inputSchema: Record<string, unknown>;
  scope: string | null;
  /** Any-of family gate (see ProviderTool.scopeFamily). */
  scopeFamily?: string | null;
  /** ADR-0039 Inc 2 / ADR-0041 Inc 3: a cell-authored renderer/form for this capability. */
  ui?: { renderer?: string; as?: string; form?: string };
  forward: (input: unknown, ctx: ServiceContext) => Promise<unknown>;
}

/** One entry in the `read("$catalog")` menu. */
interface CatalogEntry {
  target: string;
  kind: 'read' | 'act';
  description: string;
  inputSchema: Record<string, unknown>;
  /** The declared result envelope — self-documentation's read direction. */
  resultSchema?: Record<string, unknown>;
  scope: string | null;
  /** Third-party-author disclosure for cell tools (docs/capability-consent.md). */
  disclosure?: { author: string; reads: string[]; note: string };
  /** ADR-0041 Inc 3: a cell-authored argument FORM for this capability, surfaced
   *  on the catalog entry (unlike `renderer`, a human must see this BEFORE
   *  invoking — it replaces the schema-form floor for THIS target). The output
   *  `renderer`/`as` aren't surfaced here; they apply post-invocation (`_render`
   *  on the result, ADR-0039 Inc 2) and a caller doesn't need them to decide
   *  whether/how to call. */
  ui?: { form?: string };
}

/** One capability in the summary catalog: enough to decide, not to call. */
interface CatalogSummaryEntry {
  target: string;
  kind: 'read' | 'act';
  /** First sentence of the description. */
  summary: string;
}

function baseUrl(req: ServiceHttpRequest): string {
  const u = new URL(req.url);
  return `${u.protocol}//${u.host}`;
}

function unauthorized(req: ServiceHttpRequest, error: string): ServiceHttpResponse {
  const metadata = `${baseUrl(req)}/.well-known/oauth-protected-resource/mcp`;
  return {
    statusCode: 401,
    headers: { ...NO_STORE, 'www-authenticate': `Bearer resource_metadata="${metadata}", error="${error}"` },
    body: { error },
  };
}

// ─── resolution ───────────────────────────────────────────────────

/**
 * Resolve a concrete `target` to a dispatchable capability, fetching only what
 * that target needs (its provider's describe, not the whole registry). Returns
 * `null` for an unknown/unaddressable target.
 */
async function resolveTarget(ctx: ServiceContext, target: string): Promise<Capability | null> {
  if (target.startsWith('@')) {
    // @<owner>/<slug>.<tool>
    const slash = target.indexOf('/');
    const dot = target.lastIndexOf('.');
    if (slash < 0 || dot < slash + 1) return null;
    const owner = target.slice(1, slash);
    const name = target.slice(slash + 1, dot);
    const tool = target.slice(dot + 1);
    if (!owner || !name || !tool) return null;
    const res = await ctx
      .serviceClient('cells')
      .command<{ tools: CellTool[] }>('describeCellTools', { owner, name });
    const d = res?.tools?.find((t) => t.tool === tool);
    if (!d) return null;
    return {
      target,
      kind: d.kind,
      description: d.description,
      inputSchema: d.inputSchema,
      scope: d.scope,
      ...(d.ui ? { ui: d.ui } : {}),
      forward: (input, c) => c.serviceClient('cells').command('callCellTool', { owner, name, tool, args: input ?? {} }),
    };
  }

  // <cell>.<command>
  const dot = target.indexOf('.');
  if (dot < 1) return null;
  const cell = target.slice(0, dot);
  const command = target.slice(dot + 1);
  if (!(PROVIDERS as readonly string[]).includes(cell) || !command) return null;
  const res = await ctx.serviceClient(cell).command<{ tools: ProviderTool[] }>('describeTools', {});
  const d = res?.tools?.find((t) => t.name === command);
  if (!d) return null;
  return {
    target,
    kind: d.kind,
    description: d.description,
    inputSchema: d.inputSchema,
    scope: d.scope,
    scopeFamily: d.scopeFamily ?? null,
    forward: (input, c) => c.serviceClient(cell).command(command, input ?? {}),
  };
}

/** The capability menu, aggregated from all providers and filtered to the caller's scopes. */
async function buildCatalog(ctx: ServiceContext): Promise<CatalogEntry[]> {
  const caps: CatalogEntry[] = [];

  for (const cell of PROVIDERS) {
    try {
      const res = await ctx.serviceClient(cell).command<{ tools: ProviderTool[] }>('describeTools', {});
      for (const t of res?.tools ?? []) {
        caps.push({
          target: `${cell}.${t.name}`,
          kind: t.kind,
          description: t.description,
          inputSchema: t.inputSchema,
          ...(t.resultSchema ? { resultSchema: t.resultSchema } : {}),
          scope: t.scope ?? null,
        });
      }
    } catch (err) {
      ctx.logger.warn('provider describeTools failed', { cell, error: (err as Error).message });
    }
  }

  try {
    const res = await ctx.serviceClient('cells').command<{ tools: CellTool[] }>('describeCellTools', {});
    for (const t of res?.tools ?? []) {
      caps.push({
        target: `${t.address}.${t.tool}`,
        kind: t.kind,
        description: t.description,
        inputSchema: t.inputSchema,
        ...(t.resultSchema ? { resultSchema: t.resultSchema } : {}),
        scope: t.scope ?? null,
        ...(t.disclosure ? { disclosure: t.disclosure } : {}),
        ...(t.ui?.form ? { ui: { form: t.ui.form } } : {}),
      });
    }
  } catch (err) {
    ctx.logger.warn('dynamic cell tools aggregation failed', { error: (err as Error).message });
  }

  // Advertise only what the caller is entitled to use.
  return caps.filter((c) => !c.scope || hasScope(ctx.identity, c.scope));
}

/** The cell-name half of a target (`workspace.recall` → `workspace`; `@a/b.t` → `@a/b`). */
function cellOf(target: string): string {
  const dot = target.startsWith('@') ? target.lastIndexOf('.') : target.indexOf('.');
  return dot > 0 ? target.slice(0, dot) : target;
}

/** First sentence of a description — enough to decide whether to drill in.
 *  Abbreviation-aware (membrane wave 1, F8): the naive first-period cut menu
 *  summaries at "e.g." ("…in your slice (e.") and inside filenames/versions
 *  ("tar." before "gz"). A terminator ends the sentence only when it isn't a
 *  known abbreviation and is followed by a space or the end of the text. */
function firstSentence(text: string): string {
  const re = /[.!?]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const head = text.slice(0, m.index + 1);
    if (/\b(?:e\.g|i\.e|etc|vs|cf)\.$/i.test(head)) continue;
    const next = text[m.index + 1];
    if (next !== undefined && next !== ' ' && next !== '\n') continue;
    return head.trim();
  }
  return text.trim();
}

/** Longest a grouped-menu summary line may run. Many descriptions pack a long
 *  first sentence (parentheticals + ADR refs + `∈`-lists before the first
 *  period), so the raw first sentence can be 300-400 chars — the grouped menu
 *  is a SKIM ("enough to decide whether to drill"), not the contract, so cap it
 *  to a real one-liner. The full sentence is one `detail:"full"` / target
 *  resolve away. */
const CATALOG_SUMMARY_MAX = 120;
function summaryLine(text: string): string {
  const s = firstSentence(text);
  if (s.length <= CATALOG_SUMMARY_MAX) return s;
  const cut = s.slice(0, CATALOG_SUMMARY_MAX);
  const sp = cut.lastIndexOf(' ');
  return `${(sp > 60 ? cut.slice(0, sp) : cut).replace(/[\s([{.,;:—-]+$/, '')}…`;
}

/**
 * The summary catalog: capabilities grouped by cell, one line each, no schemas
 * — a fraction of the full catalog's weight. Progressive disclosure for the
 * menu itself: skim here, then `read("$catalog")` or a single target resolve
 * for the full contract.
 */
function summarizeCatalog(caps: CatalogEntry[]): {
  cells: Array<{ cell: string; count: number; capabilities: CatalogSummaryEntry[] }>;
  deprecated?: string[];
  hint: string;
} {
  // Deprecated aliases (each description opens "DEPRECATED (…) — prefer …") are
  // the wrong thing for a fresh agent to meet in its first menu: they steer to
  // a superseded verb and cost a full summary line each. List them by NAME only
  // (still discoverable, still callable, still in detail:"full") instead of
  // spelling out a dozen redundant "prefer edges(...)"-style lines.
  const byCell = new Map<string, CatalogSummaryEntry[]>();
  const deprecated: string[] = [];
  for (const c of caps) {
    if (/^DEPRECATED\b/.test(c.description)) {
      deprecated.push(c.target);
      continue;
    }
    const cell = cellOf(c.target);
    const list = byCell.get(cell) ?? [];
    list.push({ target: c.target, kind: c.kind, summary: summaryLine(c.description) });
    byCell.set(cell, list);
  }
  return {
    cells: [...byCell.entries()].map(([cell, capabilities]) => ({ cell, count: capabilities.length, capabilities })),
    ...(deprecated.length ? { deprecated } : {}),
    hint:
      'Grouped menu (the default). One target\'s full contract: read("$catalog", { resolve: "<target>" }); every schema: { detail: "full" }. Holding a fact? { for: "<key>" } returns just what can act on it (ADR-0049). Know your GOAL instead? workspace.query({ text: "<goal>" }) surfaces the relevant capabilities and facts directly, by meaning (ADR-0085) — usually a better first move than reading this menu.' +
      (deprecated.length ? ' `deprecated` lists superseded aliases by name (still callable) — read({detail:"full"}) for their contracts.' : ''),
  };
}

// ─── contextual capabilities (ADR-0049) ───────────────────────────

/** The workspace verbs that act on ANY fact — the floor of a contextual menu. */
const CORE_FACT_VERBS = new Set([
  'workspace.peek',
  'workspace.neighbors',
  'workspace.members',
  'workspace.link',
  'workspace.unlink',
  'workspace.remember',
  'workspace.supersede',
  'workspace.share',
]);

/** A type's `manager` ref, normalised to the catalog's cell-name form
 *  (`c15r/machine` → `@c15r/machine`; tier-1 names pass through). */
function managerCell(ref: unknown): string | null {
  if (typeof ref !== 'string' || !ref) return null;
  return ref.includes('/') ? (ref.startsWith('@') ? ref : `@${ref}`) : ref;
}

/**
 * `$catalog {for: <key>}` / `{forType: <type>}` — the catalog shaped by what
 * the caller is holding (ADR-0049). Capabilities are INFERRED by type: the
 * fact's type signals (declared type → key prefix → tag prefixes, the same
 * ladder the render floor walks) resolve to declarations, each declaration's
 * manager cell contributes its tools WITH schemas (the escalation tier, small
 * because it's scoped), and the generally-applicable workspace verbs ride
 * along as one-liners. A filter over what the token could already call —
 * presentation, never authority.
 */
export function buildContextualCatalog(
  caps: CatalogEntry[],
  types: Record<string, unknown>,
  subject: { key?: string; type?: string; meta?: { type?: string | null; tags?: string[] } },
): {
  for: string;
  signals: string[];
  types: Record<string, unknown>;
  capabilities: CatalogEntry[];
  workspace: CatalogSummaryEntry[];
  hint: string;
} {
  const signals = subject.type
    ? [{ type: subject.type, match: '' }]
    : typeSignals({ key: subject.key ?? '', _meta: subject.meta ?? undefined });
  const matched: Record<string, unknown> = {};
  const managers = new Set<string>();
  for (const s of signals) {
    const d = types[s.type] as { icon?: unknown; label?: unknown; manager?: unknown; handlers?: unknown } | undefined;
    if (!d || matched[s.type]) continue;
    matched[s.type] = { icon: d.icon, label: d.label, manager: d.manager, handlers: d.handlers };
    const cell = managerCell(d.manager);
    if (cell) managers.add(cell);
  }
  const capabilities = caps.filter((c) => managers.has(cellOf(c.target)));
  const workspace = caps
    .filter((c) => CORE_FACT_VERBS.has(c.target))
    .map((c) => ({ target: c.target, kind: c.kind, summary: summaryLine(c.description) }));
  return {
    for: subject.key ?? subject.type ?? '',
    signals: signals.map((s) => s.type),
    types: matched,
    capabilities,
    workspace,
    hint: 'What can act on THIS: the type declarations it matches, the managing cells\' tools (full schemas), and the always-applicable workspace verbs (one-liners — resolve or read("$catalog",{detail:"full"}) for their schemas).',
  };
}

// ─── the two tools ────────────────────────────────────────────────

interface DispatchInput {
  target?: string;
  input?: unknown;
  /** The participant key (ADR-0086): which embodied actor within this
   *  connection is acting. Provenance-grade, never authority. */
  as?: string;
}

/** Participant keys are short path-ish names (`membrane-probe/CI-d1`,
 *  `steward/weave`). Anything else is rejected LOUDLY (membrane principle
 *  W3f: a silently-ignored input is worse than an error). */
const PARTICIPANT_RE = /^[\w@][\w@/.:-]{0,63}$/;

/** Resolve the dispatch's effective context: with a valid `as`, a derived
 *  context whose identity (and downstream envelope) carries the participant
 *  key. Authority is untouched — same principal, same scopes, same token.
 *
 *  Two slots (membrane wave 3, W3g): the top-level `as` is primary, but a
 *  connection whose CACHED tool schema predates the `as` deploy cannot
 *  express it (`additionalProperties:false` rejects unknown args client-side)
 *  — wave-3 probes tucked the key inside the capability `input`, where it was
 *  silently swallowed: presence stayed dark and lease holders collapsed to
 *  the principal, the exact W3f failure ADR-0086 legislated against. So
 *  `input.as` is honored as a fallback and ALWAYS stripped before forwarding
 *  (no capability's own schema owns `as`; leaking it downstream would make
 *  every handler grow an accidental parameter). */
function dispatchContext(input: DispatchInput, ctx: ServiceContext): ServiceContext {
  let as = typeof input?.as === 'string' ? input.as.trim() : '';
  const nested = input?.input as Record<string, unknown> | undefined;
  if (nested && typeof nested.as === 'string') {
    if (!as) as = nested.as.trim();
    delete nested.as; // stripped in both cases — the key is membrane metadata, never a capability arg
  }
  if (!as) return ctx;
  if (!PARTICIPANT_RE.test(as)) {
    throw new Error(
      `Invalid participant key "${as}" — use a short path-ish name (letters/digits/@/_ then up to 63 of [word @ / . : -]), e.g. "steward/weave".`,
    );
  }
  return withIdentity(ctx, { participant: as });
}

/**
 * Enforce a capability's scope as a *teaching* denial, distinguishing three cases
 * (docs/capability-consent.md, docs/scope-grants.md §5):
 *
 *  1. effective scope covers it           → allow.
 *  2. within the token's GRANT ceiling but not the session's current focus
 *     → `scope_offer`: a self-serve widen (`auth.requestScope`), no re-consent —
 *       this is incremental authorization (a session starts minimal, widens on
 *       demand).
 *  3. outside the grant ceiling entirely   → `scope_denied`: the token is the
 *       ceiling, so the fix is a wider credential (human re-consent at
 *       /oauth/authorize, or `auth.mintToken`).
 */
function enforceScope(ctx: ServiceContext, target: string, scope: string, family?: string | null): void {
  if (hasScope(ctx.identity, scope)) return;
  // Any-of family gate: a token scoped to specific members of a family (e.g.
  // `write:type:note`) passes here; the provider's handler then refines against the
  // concrete request (the exact fact type). Coarse tokens satisfy `scope` above; a
  // token holding neither falls through to the offer/denied paths.
  if (family && holdsUnder(ctx.identity, family)) return;
  if (hasGrantScope(ctx.identity, scope)) {
    throw new ServiceAuthError(
      `scope_offer: "${target}" needs "${scope}", which is within your grant but not your session's active scope [${
        ctx.identity.scopes.join(' ') || 'none'
      }]. Widen it (no re-consent): act("auth.requestScope", { scopes: ["${scope}"] }), then retry.`,
    );
  }
  // In-band scope elevation (docs/token-as-principal-plan.md §C): hand back a ready
  // elevation URL so a connected agent can present the human a one-click widen
  // (passkey → approve → a wider token), instead of just naming the endpoint.
  const base = process.env.PUBLIC_BASE_URL ?? '';
  const q = new URLSearchParams({ scope });
  if (ctx.identity.tokenId) q.set('elevate', ctx.identity.tokenId);
  const elevateUrl = `${base}/oauth/authorize?${q.toString()}`;
  throw new ServiceAuthError(
    `scope_denied: "${target}" requires scope "${scope}" and your grant is [${
      (ctx.identity.grantScopes ?? ctx.identity.scopes).join(' ') || 'none'
    }]. A token is a ceiling. Elevate (passkey → approve): ${elevateUrl} — open it (humans), or hand it to your human (agents); then retry. (Agents may instead mint a wider token via auth.mintToken.)`,
  );
}

/**
 * The type vocabulary as data — `$catalog` for *facts* rather than
 * capabilities. Returns the caller's `_types/<type>` declarations (icon /
 * label / manager / handlers), so an agent handed a fact can resolve "how do I
 * open / edit / render this type, and in which cell" uniformly. The keys are
 * the bare type names. (docs/type-vocabulary.md)
 */
async function buildTypes(ctx: ServiceContext): Promise<{ types: Record<string, unknown>; hint: string }> {
  // Canonical (global, from the cell registry) merged under the caller's
  // per-user `_types/` overrides (docs/type-vocabulary.md). The canonical half
  // is unauthenticated-friendly; the slice read fails closed for anonymous
  // callers, who simply get the global vocabulary.
  const [global, slice] = await Promise.all([
    ctx.serviceClient('cells').command<{ types?: Record<string, unknown> }>('describeTypes', {}).catch(() => ({ types: {} })),
    ctx.identity.user
      ? ctx
          .serviceClient('workspace')
          .command<{ entries?: Array<{ key: string; value: unknown }> }>('query', { prefix: '_types/', limit: 200 })
          .catch(() => ({ entries: [] }))
      : Promise.resolve({ entries: [] }),
  ]);
  // The MERGE is a library now (ADR-0044 Inc 2 — `buildTypeVocabulary`,
  // platform/runtime): per-facet slice-override resolution (mergeTypeDecl) plus
  // the additively-attached `fields`/`present` facets, ONE resolver shared with
  // cell SSR via the cell SDK — so `$types` stopped being wire-only. The
  // gateway keeps only its transport (the two service reads above).
  const types = buildTypeVocabulary(global?.types, slice?.entries as Array<{ key: string; value: unknown }> | undefined);
  return {
    types,
    hint: 'A fact of type T resolves through types[T].handlers[intent] (open/edit/render/create) — a surface (a cell URL), an act target, or a renderer; templated with ${id}/${match}/${value.path}.',
  };
}

/**
 * ADR-0039 Inc 2 — stamp a capability's declared renderer onto its (object) result
 * as `_render`, so the conversation card runs the cell-authored renderer for the
 * TOOL result (the per-tool analogue of a type's `handlers.render`). Static
 * declaration on the tool, delivery on the result — parc can't bind per-tool widgets
 * in `tools/list` (3 tools, one card). Only objects are stamped; arrays/scalars pass
 * through untouched, and a renderer-less capability is unchanged.
 */
function withRender(result: unknown, cap: Capability): unknown {
  if (!cap.ui?.renderer || !result || typeof result !== 'object' || Array.isArray(result)) return result;
  return { ...(result as Record<string, unknown>), _render: { renderer: cap.ui.renderer, as: cap.ui.as ?? cap.target } };
}

async function read(input: DispatchInput, ctx: ServiceContext): Promise<unknown> {
  ctx = dispatchContext(input, ctx); // ADR-0086: `as` rides identity, never authority
  const target = (input?.target ?? '').trim();
  if (!target || target === CATALOG) {
    const caps = await buildCatalog(ctx);
    const opts = input?.input as { detail?: string; for?: string; forType?: string; resolve?: string; cell?: string } | undefined;
    // Membrane principle (W3f): a $catalog option we don't understand must fail
    // loudly, not silently widen a narrow read into the whole menu (W3d — a
    // probe's `{resolve}` was swallowed and it got 500 lines it didn't ask for).
    if (opts && typeof opts === 'object') {
      const KNOWN = new Set(['detail', 'for', 'forType', 'resolve', 'cell']);
      const unknown = Object.keys(opts).filter((k) => !KNOWN.has(k));
      if (unknown.length) {
        throw new Error(
          `$catalog does not understand {${unknown.join(', ')}} — valid options: {resolve:"<target>"} (one capability, full schema), {detail:"full"} (all schemas), {for:"<factKey>"} / {forType:"<type>"} (contextual menu), or none (grouped one-line menu).`,
        );
      }
    }
    // W3d: `{resolve: "<target>"}` — one capability's full contract, the narrow
    // read between the skim (grouped menu) and the dump (detail:"full").
    if (opts?.resolve) {
      const t = String(opts.resolve).trim();
      const hit = caps.find((c) => c.target === t);
      if (!hit) throw new Error(`$catalog {resolve}: unknown target "${t}" — read("$catalog") for the grouped menu of what you can call.`);
      return { capability: hit };
    }
    // ADR-0049: `{for: <key>}` / `{forType: <type>}` — the contextual menu, a
    // few KB inferred from the fact's type signals instead of the whole surface.
    if (opts?.for || opts?.forType) {
      const { types } = await buildTypes(ctx);
      let meta: { type?: string | null; tags?: string[] } | undefined;
      if (opts.for && !opts.forType) {
        const fact = await ctx
          .serviceClient('workspace')
          .command<{ _meta?: { type?: string | null; tags?: string[] } } | null>('peek', { key: opts.for })
          .catch(() => null);
        meta = fact?._meta;
      }
      return buildContextualCatalog(caps, types, { key: opts.for, type: opts.forType, meta });
    }
    // ADR-0033: progressive disclosure by default — a bare `$catalog` returns the
    // grouped one-line menu (skim), not every input/result schema. `detail:"full"`
    // (or "schemas") returns the heavy full contract.
    if (opts?.detail === 'full' || opts?.detail === 'schemas') {
      // SWARM-D (wave-5): the UNFILTERED full dump is ~130KB across every cell —
      // it overflows the read token cap, so a naive driver reaching for the
      // sledgehammer got a raw transport error, not schemas. Scope it: `{cell}`
      // returns one cell's full schemas; an over-budget dump (whole OR a single
      // large cell — W6-A: workspace alone is ~80KB) fails LOUD with the way to
      // narrow, never a silent truncation (the F7/W3f lesson).
      const FULL_BUDGET = 60_000; // bytes — comfortably under the read cap
      const overBudget = (r: unknown): boolean => JSON.stringify(r).length > FULL_BUDGET;
      if (opts?.cell) {
        const cell = String(opts.cell).trim();
        const scoped = caps.filter((c) => cellOf(c.target) === cell);
        if (!scoped.length) {
          const cells = [...new Set(caps.map((c) => cellOf(c.target)))].join(', ');
          throw new Error(`$catalog {cell}: no capabilities in cell "${cell}" — cells: ${cells}.`);
        }
        const scopedResult = { capabilities: scoped };
        if (!overBudget(scopedResult)) return scopedResult;
        // Even one cell's full schemas can exceed the cap — the only finer grain
        // is per-capability, so point there and list the targets to pick from.
        const targets = scoped.map((c) => c.target).join(', ');
        throw new Error(
          `$catalog {detail:"full", cell:"${cell}"} is still too large (${scoped.length} capabilities over the read budget). Full schemas are one grain finer only per capability: {resolve:"<target>"}. Or read the grouped menu ($catalog, no options) for one-liners. Targets: ${targets}.`,
        );
      }
      const full = { capabilities: caps };
      if (!overBudget(full)) return full;
      const sizes = [...caps.reduce((m, c) => m.set(cellOf(c.target), (m.get(cellOf(c.target)) ?? 0) + 1), new Map<string, number>())]
        .map(([cell, n]) => `${cell}(${n})`)
        .join(', ');
      throw new Error(
        `$catalog {detail:"full"} is too large to return whole (${caps.length} capabilities over the read budget). Scope it: {detail:"full", cell:"<name>"} for one cell's schemas, or {resolve:"<target>"} for one capability. Cells: ${sizes}.`,
      );
    }
    return summarizeCatalog(caps);
  }
  if (target === TYPES) return buildTypes(ctx);
  // $graph — the Reference projection (authored + derived), the self-model's third surface.
  if (target === GRAPH) return ctx.serviceClient('workspace').command('graph', {});
  // $grants — the authority self-model (ADR-0007), the self-model's fourth surface:
  // what the caller may see and do (scope · grant · partition).
  if (target === GRANTS) return ctx.serviceClient('workspace').command('grants', {});
  // $cells — the Cell axis (ADR-0008): each accessible cell's contract — what it
  // publishes (types), backs (surfaces), and may touch (ssr/caller). The infra axis.
  if (target === CELLS) return ctx.serviceClient('cells').command('contracts', {});
  // platform.logs — admin diagnostics: tail a TIER-1 service's CloudWatch logs
  // (the analogue of cells.logs for gateway/dispatch/workspace/auth/cells/home).
  // Gated on platform:admin; the cells service resolves + redacts.
  if (target === PLATFORM_LOGS) {
    enforceScope(ctx, target, PLATFORM_ADMIN_SCOPE);
    return ctx.serviceClient('cells').command('platformLogs', (input?.input as Record<string, unknown>) ?? {});
  }
  const cap = await resolveTarget(ctx, target);
  if (!cap) throw new Error(`Unknown capability: ${target}. Use read("${CATALOG}") to list what's available.`);
  if (cap.kind !== 'read') throw new Error(`"${target}" may mutate — invoke it with act, not read.`);
  if (cap.scope) enforceScope(ctx, target, cap.scope, cap.scopeFamily);
  const check = enforceInput(target, input, cap.inputSchema);
  const out = await cap.forward(input?.input, ctx);
  await touchCapability(ctx, target, cap.kind);
  return withRender(withInputWarnings(out, check.ignored, target, cap.inputSchema), cap);
}

async function act(input: DispatchInput, ctx: ServiceContext): Promise<unknown> {
  ctx = dispatchContext(input, ctx); // ADR-0086: `as` rides identity, never authority
  const target = (input?.target ?? '').trim();
  if (!target) throw new Error(`act requires a \`target\`. Use read("${CATALOG}") to list capabilities.`);
  const cap = await resolveTarget(ctx, target);
  if (!cap) throw new Error(`Unknown capability: ${target}. Use read("${CATALOG}") to list what's available.`);
  if (cap.kind !== 'act') throw new Error(`"${target}" is read-only — invoke it with read, not act.`);
  if (cap.scope) enforceScope(ctx, target, cap.scope, cap.scopeFamily);
  const check = enforceInput(target, input, cap.inputSchema);
  const out = await cap.forward(input?.input, ctx);
  await touchCapability(ctx, target, cap.kind);
  return withRender(withInputWarnings(out, check.ignored, target, cap.inputSchema), cap);
}

/** Membrane input validation (wave-5 — W3f enforced centrally): violations of
 *  the capability's DECLARED contract fail fast with schema feedback; keys the
 *  contract does not know pass through but come back as a result warning, so a
 *  silently-dropped filter can never read as "the filter applied". Runs AFTER
 *  `dispatchContext` (the `as` slot is membrane metadata, already stripped). */
function enforceInput(target: string, input: DispatchInput, schema: Record<string, unknown> | undefined): InputValidation {
  const check = validateInput(input?.input, schema);
  if (check.errors.length) {
    const accepted = acceptedKeys(schema);
    throw new Error(
      `"${target}" input invalid: ${check.errors.join('; ')}.` +
        (accepted.length ? ` Accepted keys: ${accepted.join(', ')}.` : '') +
        ` Full contract: read("${CATALOG}", { resolve: "${target}" }).`,
    );
  }
  return check;
}

/**
 * ADR-0085 Inc 0: invocation feeds salience. Every successful dispatch touches
 * the target's `_caps/<target>` capability fact in the CALLER's scope, via a
 * platform event the workspace applies as one actor-classed counter bump
 * (ADR-0050). A target whose projection fact doesn't exist (yet, or in this
 * scope — e.g. a granted foreign cell's tool, whose fact lives in the owner's
 * slice) is a silent no-op downstream, so firing unconditionally is safe.
 * Best-effort by design: a salience signal must never fail the dispatch it
 * measures. Only real capability dispatches touch — the self-model surfaces
 * ($catalog/$types/…) are projections, not invocations, and recording them
 * would make salience a mirror of orientation reads (ADR-0050's own caution).
 */
async function touchCapability(ctx: ServiceContext, target: string, kind: 'read' | 'act'): Promise<void> {
  if (!ctx.identity.user) return;
  try {
    await ctx.events.emit('capability.invoked', {
      scope: ctx.identity.user,
      target,
      kind,
      // The embodiment stamp (ADR-0022 mediation): the touch counts as agent vs
      // human attention, so per-actor salience weighting sees who uses which verbs.
      ...(ctx.identity.actor ? { actor: ctx.identity.actor } : {}),
      // The participant key (ADR-0086): which embodied actor within the
      // connection used the verb — per-participant usage telemetry.
      ...(ctx.identity.participant ? { participant: ctx.identity.participant } : {}),
    });
  } catch (err) {
    ctx.logger.warn('capability touch emit failed', { target, error: (err as Error).message });
  }
}

/** One live participant row in whoami's ambient frame (ADR-0086 Inc 2). */
interface PresenceRow {
  participant: string;
  actor?: string;
  lastTarget?: string;
  lastSeen?: string;
  until?: string | null;
}

/** The ambient frame's presence read (ADR-0086 Inc 2): live `_presence/*`
 *  leases in the caller's slice — who else is acting on this substrate right
 *  now, through what verb. Lapsed leases are already excluded at read (the
 *  timer IS the liveness). Best-effort: an ambient frame must never fail
 *  the identity call it decorates, and it arrives as a few thin rows, not a
 *  roster dump (the membrane lesson cuts both ways). */
async function livePresence(ctx: ServiceContext): Promise<PresenceRow[] | undefined> {
  if (!ctx.identity.user) return undefined;
  try {
    const res = await ctx
      .serviceClient('workspace')
      .command<{ entries?: Array<{ key: string; value?: unknown; _meta?: { updatedAt?: string; timer?: { expiresAt?: string } | null } }> }>(
        'query',
        { prefix: '_presence/', limit: 12 },
      );
    if (!Array.isArray(res?.entries) || !res.entries.length) return undefined;
    const rows = res.entries.map((e) => {
      const v = (e.value ?? {}) as { participant?: string; actor?: string; lastTarget?: string };
      return {
        participant: v.participant ?? e.key.slice('_presence/'.length),
        ...(v.actor ? { actor: v.actor } : {}),
        ...(v.lastTarget ? { lastTarget: v.lastTarget } : {}),
        ...(e._meta?.updatedAt ? { lastSeen: e._meta.updatedAt } : {}),
        ...(e._meta?.timer?.expiresAt ? { until: e._meta.timer.expiresAt } : {}),
      };
    });
    return rows.length ? rows : undefined;
  } catch {
    return undefined; // ambient frame is decoration, never a failure
  }
}

async function whoamiTool(
  _input: unknown,
  ctx: ServiceContext,
): Promise<{ user: string; scopes: string[]; grant?: string[]; actor?: string; posture?: unknown; participants?: PresenceRow[] }> {
  // `scopes` is the session's effective focus (what's enforced now); `grant` is the
  // token ceiling. They differ only once a session narrows/widens (incremental
  // auth), so `grant` is surfaced ONLY when it actually differs — otherwise it's
  // a byte-identical echo of `scopes` on every call.
  // `actor` is the embodiment class (ADR-0022 mediation): a connected client is
  // an `agent` acting on-behalf-of, and its attention weighs accordingly.
  // `posture` is the adopted goal (ADR-0074): what this session is FOR — every
  // workspace read resolves through it (adopt/drop via auth.adoptGoal/dropGoal).
  const scopes = ctx.identity.scopes;
  const g = ctx.identity.grantScopes;
  const grantDiffers = !!g && (g.length !== scopes.length || [...g].sort().join(' ') !== [...scopes].sort().join(' '));
  // The ambient frame (ADR-0086 Inc 2): whoami stops answering only "who am I"
  // and starts answering "who is here, holding what" — awareness through the
  // board, the only way the blackboard tradition says specialists see each other.
  const participants = await livePresence(ctx);
  return {
    user: ctx.identity.user ?? 'anonymous',
    scopes,
    ...(grantDiffers ? { grant: g } : {}),
    ...(ctx.identity.actor ? { actor: ctx.identity.actor } : {}),
    ...(ctx.identity.posture ? { posture: ctx.identity.posture } : {}),
    ...(participants ? { participants } : {}),
  };
}

const TARGET_PROP = {
  type: 'string',
  description:
    'Dotted capability address: "<cell>.<command>" (e.g. workspace.recall) or "@<owner>/<cell>.<tool>" (e.g. @alice/notes.add).',
};
const INPUT_PROP = { type: 'object', description: 'Arguments for the capability.', additionalProperties: true };

/** ADR-0086: the optional participant key on both dispatch verbs. */
const AS_PROP = {
  type: 'string',
  description:
    'Optional participant key (ADR-0086): which embodied actor within this connection is acting (e.g. "steward/weave", "probe/IP-1"). Recorded as provenance beside `via` on writes and in usage telemetry — never an authority input. Short path-ish names only. A participant may adopt its OWN posture by remembering `_posture/<its key>` {goal?, lens?, salience?} — composed reads carrying its `as` then rank through that lens (the token posture is the fallback).',
};
const READ_SCHEMA = {
  type: 'object',
  properties: {
    target: { ...TARGET_PROP, description: `${TARGET_PROP.description} Omit or pass "${CATALOG}" to list everything you can read/act on.` },
    input: {
      ...INPUT_PROP,
      description: `${INPUT_PROP.description} For "${CATALOG}": the grouped one-line menu is the default; { resolve: "<target>" } returns one capability's full contract; { detail: "full" } returns every input/result schema; { for: "<factKey>" } (or { forType: "<type>" }) returns the CONTEXTUAL menu — just what can act on that fact, inferred from its type signals (ADR-0049).`,
    },
    as: AS_PROP,
  },
  additionalProperties: false,
};
const ACT_SCHEMA = {
  type: 'object',
  properties: { target: TARGET_PROP, input: INPUT_PROP, as: AS_PROP },
  required: ['target'],
  additionalProperties: false,
};

const tools: Record<string, McpToolDefinition> = {
  whoami: {
    title: 'Who am I',
    description: 'Return the authenticated principal and granted scopes on the parc.land substrate.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    outputSchema: {
      type: 'object',
      properties: {
        user: { type: 'string' },
        scopes: { type: 'array' },
        grant: { type: 'array' },
        participants: {
          type: 'array',
          description: 'The ambient frame (ADR-0086): other embodied actors live on this substrate right now — each a `_presence/*` lease {participant, actor, lastTarget, lastSeen, until}. Absent when you are alone.',
          items: { type: 'object' },
        },
      },
    },
    annotations: { readOnlyHint: true },
    handler: whoamiTool,
    // The simplest MCP-Apps canary (ADR-0034): a tiny deterministic result rendered
    // by the generic card — the first thing to confirm the host renders ui:// at all.
    ui: { resourceUri: CARD_URI },
  },
  read: {
    title: 'Observe the substrate',
    description:
      'Observe a parc.land substrate capability (side-effect-free), or discover them. Pass target="$catalog" (or omit target) to list every capability you can read/act on, as data — always current, no reconnect; the grouped one-line menu is the default, {detail:"full"} adds every schema. The self-model surfaces: "$catalog" (capabilities), "$types" (the type vocabulary — how to open/edit/render a fact of each type, and which cell manages it), "$graph" (the Reference projection — authored + derived edges), "$grants" (the authority self-model — what you may see and do), and "$cells" (each accessible cell\'s contract — the types it publishes, surfaces it backs, and substrate it may touch). Admins (platform:* scope): read("platform.logs", { service }) tails a tier-1 service\'s logs (auth/workspace/gateway/dispatch/cells), redacted.',
    inputSchema: READ_SCHEMA,
    // Permissive outputSchema so spec-strict clients surface `structuredContent`
    // (read returns a different object per target — a generic object shape).
    outputSchema: { type: 'object', description: 'The observed capability result (shape varies by target).' },
    annotations: { readOnlyHint: true },
    handler: read as McpToolDefinition['handler'],
    // ADR-0034 tier-0: the generic card widget renders the read's structuredContent
    // in the conversation. Static tool→UI binding per the MCP-Apps spec (the host
    // preloads it); the card handles the empty/non-object case gracefully.
    ui: { resourceUri: CARD_URI },
  },
  act: {
    title: 'Act on the substrate',
    description:
      'Invoke a parc.land substrate capability that may mutate (e.g. workspace.remember, cells.create, @owner/cell.tool). Discover targets with read("$catalog").',
    inputSchema: ACT_SCHEMA,
    // No destructiveHint:false — cells.delete is genuinely destructive; the
    // substrate side supersedes-not-deletes, but act spans both.
    annotations: { readOnlyHint: false },
    handler: act as McpToolDefinition['handler'],
    // ADR-0039 Inc 2: act must ALSO bind the card, or an act result's widget never
    // fires. `toContent` already returns structuredContent for every tool, but the
    // host only renders a widget for a tool that declares `_meta.ui.resourceUri` in
    // tools/list — which whoami/read had and act did not. Without this, a tool
    // renderer for an act-kind capability (e.g. define_machine's `_render` stamp) is
    // invisible: the data path exists but no shell hosts it. The card handles
    // mutation results additively (it never replaces the model's text channel).
    ui: { resourceUri: CARD_URI },
  },
};

// ─── human/browser discovery ─────────────────────────────────────

function whoamiHttp(req: ServiceHttpRequest, ctx: ServiceContext): ServiceHttpResponse {
  // Auth errored ≠ token invalid: answer retryable 503 so the caller doesn't
  // discard a credential that was never actually checked.
  if (!ctx.identity.user && ctx.identity.degraded) {
    return { statusCode: 503, headers: { ...NO_STORE, 'retry-after': '2' }, body: { error: 'auth_unavailable' } };
  }
  if (!ctx.identity.user) return unauthorized(req, 'invalid_token');
  return { statusCode: 200, headers: NO_STORE, body: { user: ctx.identity.user, scopes: ctx.identity.scopes } };
}

function info(req: ServiceHttpRequest): ServiceHttpResponse {
  const origin = baseUrl(req);
  return {
    statusCode: 200,
    headers: NO_STORE,
    body: {
      resource: `${origin}/mcp`,
      authorization_servers: [origin],
      transport: 'streamable-http',
      mcp_endpoint: `${origin}/mcp`,
      name: 'parc.land substrate',
      tools: ['whoami', 'read', 'act'],
      note: 'Stable surface: whoami/read/act. Capability lives in arguments — call read("$catalog") with a bearer for the grouped one-line menu of what you can do ({detail:"full"} adds schemas).',
    },
  };
}

export const handler = defineMcpService({
  name: 'gateway',
  mcpPath: '/mcp',
  // ADR-0085 Inc 0: every successful read/act dispatch announces itself so the
  // workspace can bump the target's `_caps/<target>` attention counters.
  events: { emits: ['capability.invoked'] },
  serverInfo: { name: 'parc-substrate', title: 'parc.land substrate', version: '1.0.0' },
  // The spec's `instructions` field: the server's self-introduction, surfaced
  // into the model's context at connect — discovery must not depend on a
  // client knowing what "read/act" means here.
  instructions:
    'The parc.land substrate: a personal productivity workspace of facts `{value, _meta}` with provenance, salience, links, declared actions/views, and deployable cells. ' +
    'Three verbs: whoami (identity), read (observe), act (mutate). All capability lives in the `target` argument. Know your goal? read("workspace.query", {input:{text:"<goal>"}}) surfaces the relevant facts AND capabilities by meaning (ADR-0085) — the intent-first move. ' +
    'Browsing instead? read("$catalog") is the grouped one-line menu ({resolve:"<target>"} for one full contract, {detail:"full"} for every schema). Targets look like workspace.query or @owner/cell.tool. ' +
    'To orient in your data, read("workspace.recall") returns a succinct overview (counts + top facts + drill hints) by default — then narrow with workspace.query (filtered, paged), workspace.search (semantic), or workspace.peek (one fact); recall({view:"full"}) is the whole shaped view. ' +
    'read("$types") returns the type vocabulary — how to open/edit/render a fact of a given type, and which cell manages it.',
  tools,
  // ADR-0034: declare the MCP-Apps UI extension (spec 2026-01-26 nests it under
  // `capabilities.extensions` with the supported `mimeTypes`) + serve the `ui://`
  // widget resources the tools bind to via their `_meta.ui.resourceUri`.
  capabilities: { extensions: { 'io.modelcontextprotocol/ui': { mimeTypes: [UI_MIME] } } },
  resources: {
    read: (uri: string, ctx: ServiceContext) => resolveUiResource(uri, ctx),
    list: () => listUiResources(),
  },
  http: [
    { method: 'GET', path: '/mcp', handler: info },
    { method: 'GET', path: '/mcp/whoami', handler: whoamiHttp },
  ],
});

export default handler;
