/**
 * Workspace command group (ADR-0044 Inc 5): links/edges/graph — link, unlink,
 * neighbors, links, graph, members (the Reference projection).
 */
import { requireUser } from '../../platform/runtime';
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

/** The links/edges/graph command handlers (ADR-0044 Inc 5). */
export function createGraphCommands(build: DepsBuilder): Pick<WorkspaceCommands, 'link' | 'unlink' | 'neighbors' | 'links' | 'graph' | 'members'> {
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
  };
}
