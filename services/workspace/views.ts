/**
 * Registered views — the read-side of the declared vocabulary (v1).
 *
 * sync's counterpart to declared actions: a view is **data, not code** — a
 * named, stored projection over the slice, evaluated by the substrate at read
 * time, carrying an optional **render hint** so the same declaration is a
 * dashboard surface for humans and an affordance for agents ("the dashboard
 * is a view query"). Stored as a fact at `_views/<id>`; vocabulary is state.
 *
 * v1 deliberately mirrors the actions tier's stance: a structured, decidable
 * model instead of CEL — a view is a `query` (the existing projection
 * primitive) plus an optional `reduce`. A CEL upgrade can replace the
 * evaluator without changing the stored model.
 */
import type { Identity } from '../../platform/runtime';
import type { ObservedState, Entry, QueryOptions } from '../../platform/runtime';

/** Reserved key prefix where a slice's registered views live. */
export const VIEWS_PREFIX = '_views/';

export interface RenderHint {
  /** Surface type for the human projection (home renders by this). */
  type: 'metric' | 'table' | 'feed' | 'list' | 'markdown';
  label?: string;
  [extra: string]: unknown;
}

export interface ViewDefinition {
  id: string;
  description?: string;
  /** The projection: the substrate's `query` options, stored as data. */
  query: QueryOptions;
  /**
   * Optional reduction over the query result:
   *   - `list` (default) — the ranked entries
   *   - `count` — how many matched
   *   - `latest` — the single most recently written entry
   *   - `sum` — numeric sum of each entry's value (at `path`, if given)
   */
  reduce?: 'list' | 'count' | 'latest' | 'sum';
  /** Dot-path into each value for `sum`. */
  path?: string;
  /** Render hint — makes this view a surface. */
  render?: RenderHint;
}

export interface ViewResult {
  id: string;
  description?: string;
  render: RenderHint | null;
  /** The evaluated value, per `reduce`. */
  value: unknown;
  count: number;
}

const REDUCERS = new Set(['list', 'count', 'latest', 'sum']);

function resolvePath(value: unknown, path?: string): unknown {
  if (!path) return value;
  let cur: unknown = value;
  for (const part of path.split('.')) {
    if (cur === null || typeof cur !== 'object') return undefined;
    cur = (cur as Record<string, unknown>)[part];
  }
  return cur;
}

function validateView(def: ViewDefinition): void {
  if (!def?.id || typeof def.id !== 'string') throw new Error('view requires a string `id`');
  if (def.id.includes('/')) throw new Error('view `id` must not contain "/"');
  if (!def.query || typeof def.query !== 'object') throw new Error('view requires a `query` object');
  if (def.reduce !== undefined && !REDUCERS.has(def.reduce)) {
    throw new Error(`view \`reduce\` must be one of ${[...REDUCERS].join('/')}`);
  }
  if (def.render && typeof def.render.type !== 'string') {
    throw new Error('view `render` requires a `type`');
  }
}

export interface RegisteredViews {
  register(scope: string, def: ViewDefinition, identity?: Identity): Promise<ViewDefinition>;
  list(scope: string): Promise<ViewDefinition[]>;
  remove(scope: string, id: string, identity?: Identity): Promise<{ ok: true }>;
  /** Evaluate one registered view against the current slice. */
  evaluate(scope: string, id: string, identity?: Identity): Promise<ViewResult>;
}

export function createRegisteredViews(state: ObservedState): RegisteredViews {
  async function load(scope: string, id: string): Promise<ViewDefinition> {
    const entry = await state.get(scope, `${VIEWS_PREFIX}${id}`);
    if (!entry || entry._meta.superseded) throw new Error(`not_found: view "${id}" not found`);
    return entry.value as ViewDefinition;
  }

  return {
    async register(scope, def, identity): Promise<ViewDefinition> {
      validateView(def);
      await state.put(
        { scope, key: `${VIEWS_PREFIX}${def.id}`, value: def, via: 'registerView', type: 'view' },
        identity,
      );
      return def;
    },

    async list(scope): Promise<ViewDefinition[]> {
      const res = await state.query(scope, { prefix: VIEWS_PREFIX, rankBy: 'recency' });
      return res.entries.map((e) => e.value as ViewDefinition).filter((d): d is ViewDefinition => !!d?.id);
    },

    async remove(scope, id, identity): Promise<{ ok: true }> {
      await load(scope, id); // throws not_found
      await state.supersede(scope, `${VIEWS_PREFIX}${id}`, null, identity);
      return { ok: true };
    },

    async evaluate(scope, id, _identity): Promise<ViewResult> {
      const def = await load(scope, id);
      // Views must not observe the vocabulary itself unless they ask to —
      // exclude reserved keys when the view has no explicit prefix.
      const result = await state.query(scope, def.query);
      const entries = def.query.prefix
        ? result.entries
        : result.entries.filter((e) => !e.key.startsWith('_actions/') && !e.key.startsWith(VIEWS_PREFIX));
      const reduce = def.reduce ?? 'list';
      let value: unknown;
      switch (reduce) {
        case 'list':
          value = entries;
          break;
        case 'count':
          value = entries.length;
          break;
        case 'latest': {
          const latest = [...entries].sort(
            (a, b) => Date.parse(b._meta.updatedAt) - Date.parse(a._meta.updatedAt),
          )[0];
          value = latest ?? null;
          break;
        }
        case 'sum': {
          let sum = 0;
          for (const e of entries as Array<{ key: string } & Entry>) {
            const n = resolvePath(e.value, def.path);
            if (typeof n === 'number') sum += n;
          }
          value = sum;
          break;
        }
      }
      return {
        id: def.id,
        description: def.description,
        render: def.render ?? null,
        value,
        count: entries.length,
      };
    },
  };
}
