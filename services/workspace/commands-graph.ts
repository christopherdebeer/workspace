/**
 * Workspace command group (ADR-0044 Inc 5): links/edges/graph — link, unlink,
 * neighbors, links, graph, members (the Reference projection).
 */
import { requireUser, type StateStore, type ObservedState, type TypeRules } from '../../platform/runtime';
import { type DepsBuilder, typeDeclsFor, typeRulesFor, affordancesForTypes, typesOf } from './shared';
import { shapeEntryList, shapeEntryMap, scopeEdges, type ReadShape, type EdgeScopeInput } from './shape';
import { applicableGrants, grantCovers, type GrantStore } from './grants';
import type { WorkspaceCommands } from './handlers';

type Edge = Awaited<ReturnType<ObservedState['edges']>>[number];

/** The authored edges a viewer reaches through GRANTS — the graph twin of the
 *  recall fold (commands-read.ts). For each owner who shared to the viewer
 *  (directly, via `public`, or a group), read that owner's authored edges and
 *  keep only those whose BOTH endpoints fall under the viewer's grant patterns
 *  for that owner — a public→private edge would otherwise leak the private key.
 *  Kept edges are re-prefixed `owner/key`, matching how the recall fold keys the
 *  granted facts, so the client's node keys and these edge keys line up. Owner
 *  viewing their own slice gets `[]` (no foreign grants) — behaviour-preserving. */
async function grantedEdges(state: Pick<ObservedState, 'edges'>, viewer: string, grants: GrantStore): Promise<Edge[]> {
  const grantList = await applicableGrants(grants, viewer);
  const byOwner = new Map<string, string[]>();
  for (const g of grantList) {
    if (g.owner === viewer) continue;
    const pats = byOwner.get(g.owner) ?? [];
    pats.push(g.key);
    byOwner.set(g.owner, pats);
  }
  if (!byOwner.size) return [];
  const covered = (pats: string[], key: string): boolean => pats.some((p) => grantCovers(p, key));
  const out: Edge[] = [];
  for (const [owner, pats] of byOwner) {
    const es = await state.edges(owner);
    for (const e of es) {
      if (covered(pats, e.from) && covered(pats, e.to)) out.push({ ...e, from: `${owner}/${e.from}`, to: `${owner}/${e.to}` });
    }
  }
  return out;
}

/** The FULL-projection twin of {@link grantedEdges} (ADR-0092 follow-on): fold
 *  each granting owner's whole graph projection — authored edges AND the
 *  derived backbone (membership, instanceOf, …) AND the persisted `similarTo`
 *  constellation — kept only where BOTH endpoints fall under the viewer's
 *  grant patterns, re-prefixed `owner/key`. ADR-0091 folded only the
 *  `derived:false` links framing, but the home graph reads THIS framing — so
 *  a guest saw every public star and zero edges between them (validated live:
 *  210 nodes, 0 edges). The both-endpoint rule keeps the boundary: an edge to
 *  an uncovered key (a private fact, a `_types/` decl) never leaks its name. */
async function grantedGraphEdges(
  state: Pick<ObservedState, 'graph'>,
  viewer: string,
  grants: GrantStore,
  typeRules: Record<string, TypeRules> | undefined,
): Promise<Edge[]> {
  const grantList = await applicableGrants(grants, viewer);
  const byOwner = new Map<string, string[]>();
  for (const g of grantList) {
    if (g.owner === viewer) continue;
    const pats = byOwner.get(g.owner) ?? [];
    pats.push(g.key);
    byOwner.set(g.owner, pats);
  }
  if (!byOwner.size) return [];
  const covered = (pats: string[], key: string): boolean => pats.some((p) => grantCovers(p, key));
  const out: Edge[] = [];
  for (const [owner, pats] of byOwner) {
    const g = await state.graph(owner, { typeRules });
    for (const e of g.edges) {
      if (covered(pats, e.from) && covered(pats, e.to)) out.push({ ...e, from: `${owner}/${e.from}`, to: `${owner}/${e.to}` });
    }
  }
  return out;
}

/** Resolve an `owner/key`-spelled anchor (`around`) to the slice it lives in:
 *  the viewer's own (self-folded spelling — the /r/<owner>/<key> canonical
 *  address, ADR-0090) or a granting owner's, when a grant covers the bare key.
 *  `pats: null` = self (full access, no coverage filter). Returns null when the
 *  leading segment isn't a resolvable owner — the caller falls through to the
 *  own-slice read untouched (an own key like `file/docs/x` never matches). */
async function foldedAnchor(
  grants: GrantStore,
  viewer: string,
  around: string,
): Promise<{ owner: string; rest: string; pats: string[] | null } | null> {
  const slash = around.indexOf('/');
  if (slash <= 0) return null;
  const owner = around.slice(0, slash);
  const rest = around.slice(slash + 1);
  if (owner === viewer) return { owner, rest, pats: null };
  const pats = (await applicableGrants(grants, viewer)).filter((g) => g.owner === owner).map((g) => g.key);
  return pats.some((p) => grantCovers(p, rest)) ? { owner, rest, pats } : null;
}

export interface LinkInput {
  from: string;
  rel: string;
  to: string;
  strength?: number;
}
export type UnlinkInput = Omit<LinkInput, 'strength'>;
export interface NeighborsInput {
  key: string;
  dir?: 'in' | 'out' | 'both';
  rel?: string;
  /** Entry tier for the neighbor `entries` map (ADR-0048): refs/card/full.
   *  Default full; chips/lists want card. Edges are always complete. */
  shape?: ReadShape;
}

export interface LinksInput extends EdgeScopeInput {
  /** Only edges whose `from` or `to` starts with this prefix. */
  prefix?: string;
}

export interface MembersInput {
  key: string;
  /** Entry tier for `members` (ADR-0048): refs/card/full. Default full. */
  shape?: ReadShape;
}

// ── ADR-0069 (C3): the one edge query ───────────────────────────────────
// neighbors/graph/members/links are four filters over the same edge set. `edges`
// exposes them as one, by parameter. The legacy verbs remain as aliases during the
// deprecation window. (State-layer `edgeSet` dedup — collapsing the shared
// `[...authored, ...deriveBackboneEdges]` reduction — is a separable follow-on;
// this command dispatches to the existing state methods, so it is behaviour-
// preserving by construction.)
export interface EdgesInput extends EdgeScopeInput {
  /** Edges incident to this key (→ neighbors / members). Absent = the whole projection. */
  around?: string;
  /** Alias for `around` (W4d) — the peek/neighbors spelling drivers reach for. */
  key?: string;
  dir?: 'in' | 'out' | 'both';
  /** Restrict to this rel. */
  rel?: string;
  /** With `around`: only membership edges pointing at it (→ members). */
  membership?: boolean;
  /** Include derived backbone edges (default true). `false` = authored only (→ links). */
  derived?: boolean;
  /** Authored-only prefix filter (links' path). */
  prefix?: string;
  /** Entry tier for hydrated neighbours/members (ADR-0048): refs/card/full. */
  shape?: ReadShape;
  /** ADR-0075 (C4): with `around`, walk transitively this many hops (2–6). 1 or
   *  absent = today's one-hop framings, byte-identical. */
  depth?: number;
  /** Walk direction (ADR-0075): 'out' follows from→to ("downstream of X"),
   *  'in' follows to→from ("what leads to X"). Default 'out'. Only meaningful
   *  with `depth` ≥ 2. */
  direction?: 'out' | 'in';
}

// ── ADR-0075 (C4): the directional walk — the simulation affordance ─────────
// Causal rels (`causes · enables · predicts · prevents · contradicts` — the
// documented floor; the family is open vocabulary, nothing here enumerates it)
// are ordinary authored edges: `rel` is a free string and confidence rides the
// existing authored `strength` (0..1, default 1 — already feeding weighted
// centrality proportionally). The one new affordance is the transitive walk:
// all maximal simple paths from `around`, following AUTHORED edges only (a
// simulation follows asserted claims — the derived backbone is type plumbing),
// compound confidence = the product of step strengths, cycle-guarded, capped.

export interface WalkStep {
  from: string;
  rel: string;
  to: string;
  strength: number | null;
}
export interface WalkPath {
  /** Node sequence, root first. */
  nodes: string[];
  steps: WalkStep[];
  /** Compound confidence: Π step strength (authored null = 1). */
  confidence: number;
}
export interface WalkResult {
  root: string;
  direction: 'out' | 'in';
  depth: number;
  rel?: string;
  /** All maximal simple paths (confidence-descending), each ≤ `depth` steps. */
  paths: WalkPath[];
  total: number;
  /** Present when a cap (paths/expansions) cut the enumeration short. */
  truncated?: boolean;
}

const WALK_MAX_DEPTH = 6;
const WALK_MAX_PATHS = 200;
const WALK_MAX_EXPANSIONS = 500;

async function walkFrom(
  store: StateStore,
  scope: string,
  root: string,
  opts: { rel?: string; direction: 'out' | 'in'; depth: number },
): Promise<WalkResult> {
  const depth = Math.min(Math.max(Math.floor(opts.depth), 2), WALK_MAX_DEPTH);
  const paths: WalkPath[] = [];
  let expansions = 0;
  let truncated = false;

  async function extend(node: string, nodes: string[], steps: WalkStep[], confidence: number): Promise<void> {
    if (paths.length >= WALK_MAX_PATHS || expansions >= WALK_MAX_EXPANSIONS) {
      truncated = true;
      if (steps.length) paths.push({ nodes, steps, confidence });
      return;
    }
    if (steps.length >= depth) {
      paths.push({ nodes, steps, confidence });
      return;
    }
    expansions++;
    const incident =
      opts.direction === 'out' ? await store.edgesFrom(scope, node, opts.rel) : await store.edgesTo(scope, node, opts.rel);
    // Simple paths only: never revisit a node already on this path (cycle guard).
    const onward = incident.filter((e) => !nodes.includes(opts.direction === 'out' ? e.to : e.from));
    if (!onward.length) {
      if (steps.length) paths.push({ nodes, steps, confidence });
      return;
    }
    for (const e of onward) {
      const next = opts.direction === 'out' ? e.to : e.from;
      const step: WalkStep = { from: e.from, rel: e.rel, to: e.to, strength: e.strength ?? null };
      await extend(next, [...nodes, next], [...steps, step], confidence * (e.strength ?? 1));
    }
  }

  await extend(root, [root], [], 1);
  paths.sort((a, b) => b.confidence - a.confidence || a.nodes.join('→').localeCompare(b.nodes.join('→')));
  return {
    root,
    direction: opts.direction,
    depth,
    ...(opts.rel ? { rel: opts.rel } : {}),
    paths,
    total: paths.length,
    ...(truncated ? { truncated: true } : {}),
  };
}

/** The links/edges/graph command handlers (ADR-0044 Inc 5) + the composed `edges`
 *  query (ADR-0069). */
export function createGraphCommands(build: DepsBuilder): Pick<WorkspaceCommands, 'link' | 'unlink' | 'edges'> {
  return {
    async link(input, ctx) {
      const scope = requireUser(ctx.identity);
      if (!input?.from || !input?.rel || !input?.to) throw new Error('from, rel, and to are required');
      const { state } = build(ctx);
      const edge = await state.link(scope, input.from, input.rel, input.to, input.strength ?? null, ctx.identity);
      ctx.logger.info('workspace edge linked', { scope, from: edge.from, rel: edge.rel, to: edge.to });
      return edge;
    },

    async unlink(input, ctx) {
      const scope = requireUser(ctx.identity);
      if (!input?.from || !input?.rel || !input?.to) throw new Error('from, rel, and to are required');
      const { state } = build(ctx);
      return state.unlink(scope, input.from, input.rel, input.to, ctx.identity);
    },


    // ── ADR-0069 (C3): one edge query over the four framings ──────────────
    async edges(input, ctx) {
      const scope = requireUser(ctx.identity);
      const { state, grants } = build(ctx);
      // W4d (wave-4, 3 drivers): `around` is the key-scoped anchor, but drivers
      // reached for `key` (the peek/neighbors spelling) and `edges({key, depth})`
      // fell through to the WHOLE-graph projection or errored. Honor `key` as the
      // alias it structurally is — the same fact-scoped neighbourhood read.
      const around = input?.around ?? input?.key;
      // A grant-folded anchor (`owner/key` — how folded reads key foreign facts,
      // and the canonical /r/<owner>/<key> address) resolves against THAT
      // owner's slice, results coverage-filtered and re-prefixed. Null for
      // ordinary own keys — those paths are byte-identical to before.
      const anchor = around ? await foldedAnchor(grants, scope, around) : null;
      const anchorCovered = (key: string): boolean => !anchor?.pats || anchor.pats.some((p) => grantCovers(p, key));
      // around + membership → the `members` framing.
      if (around && input?.membership) {
        if (anchor) {
          const result = await state.members(anchor.owner, anchor.rest, { typeRules: await typeRulesFor(ctx) });
          // Coverage on every emitted member (an uncovered member never leaks
          // its key), re-prefixed so the caller's node keys line up.
          const members = result.members
            .filter((m) => anchorCovered(m.key))
            .map((m) => ({ ...m, key: `${anchor.owner}/${m.key}` }));
          const types = affordancesForTypes(typesOf(members), await typeDeclsFor(ctx));
          const shaped = { ...result, key: around, members: shapeEntryList(members, input?.shape ?? 'card') };
          return Object.keys(types).length ? { ...shaped, types } : shaped;
        }
        const result = await state.members(scope, around, { typeRules: await typeRulesFor(ctx) });
        const types = affordancesForTypes(typesOf(result.members), await typeDeclsFor(ctx));
        const shaped = { ...result, members: shapeEntryList(result.members, input?.shape ?? 'card') };
        return Object.keys(types).length ? { ...shaped, types } : shaped;
      }
      // around + depth ≥ 2 → the directional walk (ADR-0075, C4): transitive
      // paths over authored edges, compound confidence, cycle-guarded.
      if (around && (input?.depth ?? 1) >= 2) {
        const { store } = build(ctx);
        if (!store) throw new Error('the walk needs the raw edge index (store unavailable in this deployment)');
        return walkFrom(store, scope, around, {
          rel: input?.rel,
          direction: input?.direction ?? 'out',
          depth: input!.depth!,
        });
      }
      // around → the `neighbors` framing (key-scoped, index-backed).
      if (around) {
        if (anchor) {
          const r = await state.neighbors(anchor.owner, anchor.rest, { dir: input?.dir, rel: input?.rel, typeRules: await typeRulesFor(ctx) });
          // Both-endpoint coverage (the far end of an edge to a private fact
          // must never leak), re-prefix edges + entries to `owner/key`.
          const fold = (es: typeof r.outbound): typeof r.outbound =>
            es.filter((e) => anchorCovered(e.from) && anchorCovered(e.to))
              .map((e) => ({ ...e, from: `${anchor.owner}/${e.from}`, to: `${anchor.owner}/${e.to}` }));
          const entries: typeof r.entries = {};
          for (const [k, v] of Object.entries(r.entries)) {
            if (anchorCovered(k)) entries[`${anchor.owner}/${k}`] = v;
          }
          const result = { outbound: fold(r.outbound), inbound: fold(r.inbound), entries };
          const types = affordancesForTypes(typesOf(result.entries), await typeDeclsFor(ctx));
          const shaped = { ...result, entries: shapeEntryMap(result.entries, input?.shape ?? 'card') };
          return Object.keys(types).length ? { ...shaped, types } : shaped;
        }
        const result = await state.neighbors(scope, around, { dir: input?.dir, rel: input?.rel, typeRules: await typeRulesFor(ctx) });
        const types = affordancesForTypes(typesOf(result.entries), await typeDeclsFor(ctx));
        const shaped = { ...result, entries: shapeEntryMap(result.entries, input?.shape ?? 'card') };
        return Object.keys(types).length ? { ...shaped, types } : shaped;
      }
      // derived:false → the authored-only `links` framing (+ optional prefix).
      // Fold in edges reached through grants (public/shared subgraphs), keyed
      // `owner/key` like the recall fold — so a viewer sees the CONSTELLATIONS of
      // the slices shared to them, not just isolated shared stars.
      if (input?.derived === false) {
        const started = Date.now();
        const own = await state.edges(scope);
        const granted = await grantedEdges(state, scope, grants);
        const all = granted.length ? [...own, ...granted] : own;
        const prefix = input?.prefix;
        const prefixed = prefix ? all.filter((e) => e.from.startsWith(prefix) || e.to.startsWith(prefix)) : all;
        const scoped = scopeEdges(prefixed, edgeScope(input));
        logEdgeRead(ctx, 'edges(links)', scope, input, scoped, started);
        return scoped;
      }
      // default → the full `graph` projection (authored + derived), scoped —
      // PLUS the grant fold (the framing the home graph reads: without it a
      // guest saw every public star and zero edges between them).
      const started = Date.now();
      const typeRules = await typeRulesFor(ctx);
      const result = await state.graph(scope, { typeRules });
      const granted = await grantedGraphEdges(state, scope, grants, typeRules);
      const scoped = scopeEdges(granted.length ? [...result.edges, ...granted] : result.edges, edgeScope(input));
      logEdgeRead(ctx, 'edges(graph)', scope, input, scoped, started);
      return scoped;
    },
  };
}

/** Observability (ADR-0081 home-cell incident): the unbounded `graph`/`edges`/
 *  `links` read caused a silent CloudFront 30s timeout / Lambda 6MB payload
 *  failure with nothing in the logs to diagnose it from. Every edge-projection
 *  read now logs its shape and latency so a future regression is visible
 *  without manual CloudWatch log archaeology. */
function logEdgeRead(
  ctx: Parameters<DepsBuilder>[0],
  command: string,
  scope: string,
  input: EdgeScopeInput | undefined,
  result: { edges: unknown[]; total: number; nextCursor?: string },
  started: number,
): void {
  ctx.logger.info(`workspace.${command} complete`, {
    scope,
    edges: result.edges.length,
    total: result.total,
    cursor: !!input?.cursor,
    nextCursor: !!result.nextCursor,
    durationMs: Date.now() - started,
  });
}

/** Fold a top-level `rel` into the `rels` scope filter, so `edges({ rel })` narrows
 *  the whole-projection paths the way `edges({ around, rel })` narrows neighbors. */
function edgeScope(input?: EdgesInput): EdgeScopeInput {
  if (!input) return {};
  const rels = input.rel ? [...(input.rels ?? []), input.rel] : input.rels;
  return { keys: input.keys, rels, limit: input.limit, cursor: input.cursor, edgeShape: input.edgeShape };
}
