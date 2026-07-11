/**
 * Workspace command group (ADR-0044 Inc 5): links/edges/graph — link, unlink,
 * neighbors, links, graph, members (the Reference projection).
 */
import { requireUser, type StateStore } from '../../platform/runtime';
import { type DepsBuilder, typeDeclsFor, typeRulesFor, affordancesForTypes, typesOf } from './shared';
import { shapeEntryList, shapeEntryMap, scopeEdges, type ReadShape, type EdgeScopeInput } from './shape';
import type { WorkspaceCommands } from './handlers';

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
export function createGraphCommands(build: DepsBuilder): Pick<WorkspaceCommands, 'link' | 'unlink' | 'neighbors' | 'links' | 'graph' | 'members' | 'edges'> {
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

    async neighbors(input, ctx) {
      const scope = requireUser(ctx.identity);
      if (!input?.key) throw new Error('key is required');
      const { state } = build(ctx);
      const result = await state.neighbors(scope, input.key, { dir: input.dir, rel: input.rel, typeRules: await typeRulesFor(ctx) }, ctx.identity);
      const types = affordancesForTypes(typesOf(result.entries), await typeDeclsFor(ctx)); // R1 (ADR-0029)
      const shaped = { ...result, entries: shapeEntryMap(result.entries, input.shape) };
      return Object.keys(types).length ? { ...shaped, types } : shaped;
    },

    async links(input, ctx) {
      const scope = requireUser(ctx.identity);
      const { state } = build(ctx);
      const all = await state.edges(scope);
      const prefix = input?.prefix;
      const prefixed = prefix ? all.filter((e) => e.from.startsWith(prefix) || e.to.startsWith(prefix)) : all;
      return scopeEdges(prefixed, input); // ADR-0048: keys/rels scope + limit cap; total always counts
    },

    async graph(input, ctx) {
      const scope = requireUser(ctx.identity);
      const { state } = build(ctx);
      const result = await state.graph(scope, { typeRules: await typeRulesFor(ctx) });
      return scopeEdges(result.edges, input); // ADR-0048: `{keys}` = "edges around these facts", not the whole projection
    },

    async members(input, ctx) {
      const scope = requireUser(ctx.identity);
      if (!input?.key) throw new Error('key is required');
      const { state } = build(ctx);
      const result = await state.members(scope, input.key, { typeRules: await typeRulesFor(ctx) });
      const types = affordancesForTypes(typesOf(result.members), await typeDeclsFor(ctx)); // R1 (ADR-0029)
      const shaped = { ...result, members: shapeEntryList(result.members, input.shape) };
      return Object.keys(types).length ? { ...shaped, types } : shaped;
    },

    // ── ADR-0069 (C3): one edge query over the four framings ──────────────
    async edges(input, ctx) {
      const scope = requireUser(ctx.identity);
      const { state } = build(ctx);
      const around = input?.around;
      // around + membership → the `members` framing.
      if (around && input?.membership) {
        const result = await state.members(scope, around, { typeRules: await typeRulesFor(ctx) });
        const types = affordancesForTypes(typesOf(result.members), await typeDeclsFor(ctx));
        const shaped = { ...result, members: shapeEntryList(result.members, input?.shape) };
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
        const result = await state.neighbors(scope, around, { dir: input?.dir, rel: input?.rel, typeRules: await typeRulesFor(ctx) });
        const types = affordancesForTypes(typesOf(result.entries), await typeDeclsFor(ctx));
        const shaped = { ...result, entries: shapeEntryMap(result.entries, input?.shape) };
        return Object.keys(types).length ? { ...shaped, types } : shaped;
      }
      // derived:false → the authored-only `links` framing (+ optional prefix).
      if (input?.derived === false) {
        const all = await state.edges(scope);
        const prefix = input?.prefix;
        const prefixed = prefix ? all.filter((e) => e.from.startsWith(prefix) || e.to.startsWith(prefix)) : all;
        return scopeEdges(prefixed, edgeScope(input));
      }
      // default → the full `graph` projection (authored + derived), scoped.
      const result = await state.graph(scope, { typeRules: await typeRulesFor(ctx) });
      return scopeEdges(result.edges, edgeScope(input));
    },
  };
}

/** Fold a top-level `rel` into the `rels` scope filter, so `edges({ rel })` narrows
 *  the whole-projection paths the way `edges({ around, rel })` narrows neighbors. */
function edgeScope(input?: EdgesInput): EdgeScopeInput {
  if (!input) return {};
  const rels = input.rel ? [...(input.rels ?? []), input.rel] : input.rels;
  return { keys: input.keys, rels, limit: input.limit };
}
