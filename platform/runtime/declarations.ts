/**
 * The Declaration registry (docs/architecture/adr/0001-declaration-registry.md).
 *
 * A *declaration* is a fact at `_<ns>/<id>` that the runtime reads to configure
 * itself — a view, an action, a subscription, a type, a renderer, a config. They
 * all share one lifecycle: validate → write (typed) → list (by prefix) → get →
 * remove (supersede). This is that lifecycle, **once**, parameterised by a kind
 * descriptor, so the per-kind code is only its *validation* and (later) its
 * layered *resolution* — never the storage boilerplate again.
 *
 * Boundary (ADR-0001): the registry owns **storage + resolution only**. A kind's
 * *evaluate* — a view's query/reduce, an action's guarded writes, a subscription's
 * match — is NOT here; it operates on an already-resolved declaration.
 */
import type { ObservedState } from './state';
import type { Identity } from './auth';

/** What makes a declaration kind: where it lives, how it's typed/validated. */
export interface DeclarationKind<D> {
  /** Reserved key prefix, e.g. `_subscriptions/`. */
  ns: string;
  /** Indexable fact type stamped on the stored declaration. */
  factType: string;
  /** `via` label for the write when the caller gives none. */
  defaultVia?: string;
  /** The declaration's id (its key suffix). */
  idOf(def: D): string;
  /** Throw on an invalid declaration (the "parse" step, surfaced at register). */
  validate(def: D): void;
  /** List filter / type guard for stored values (e.g. has an id). */
  isStored(value: unknown): value is D;
}

export interface RegisterOptions {
  via?: string;
  tags?: string[];
}

export interface DeclarationRegistry<D> {
  register(scope: string, def: D, identity?: Identity, opts?: RegisterOptions): Promise<D>;
  list(scope: string): Promise<D[]>;
  /** The stored declaration in this slice (live only), or null. */
  get(scope: string, id: string): Promise<D | null>;
  remove(scope: string, id: string, identity?: Identity): Promise<{ ok: true }>;
}

/** One registry over a `StateStore`-backed `ObservedState`, for a given kind. */
export function createDeclarationRegistry<D>(state: ObservedState, kind: DeclarationKind<D>): DeclarationRegistry<D> {
  const keyOf = (id: string): string => `${kind.ns}${id}`;
  return {
    async register(scope, def, identity, opts): Promise<D> {
      kind.validate(def);
      await state.put(
        { scope, key: keyOf(kind.idOf(def)), value: def, via: opts?.via ?? kind.defaultVia ?? 'register', type: kind.factType, tags: opts?.tags },
        identity,
      );
      return def;
    },

    async list(scope): Promise<D[]> {
      const res = await state.query(scope, { prefix: kind.ns, rankBy: 'recency', limit: 200 });
      return res.entries.map((e) => e.value).filter(kind.isStored);
    },

    async get(scope, id): Promise<D | null> {
      const e = await state.get(scope, keyOf(id));
      return e && !e._meta.superseded ? (e.value as D) : null;
    },

    async remove(scope, id, identity): Promise<{ ok: true }> {
      const e = await state.get(scope, keyOf(id));
      if (!e || e._meta.superseded) throw new Error(`not_found: ${kind.factType} "${id}" not found`);
      await state.supersede(scope, keyOf(id), null, identity);
      return { ok: true };
    },
  };
}
