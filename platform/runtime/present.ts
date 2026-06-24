/**
 * Present (ADR-0012) — the affordance stage of the Projection.
 *
 * The Projection is `select → score → shape → present`. `select` (ADR-0004) and
 * `score` (ADR-0006) are named; this is `present`: a pure function from a *fact* (with
 * its resolved Type) to an **Affordance set** — `{ icon, label, render, handlers }` —
 * the answer to "how do I show this, and what can I do with it?". home/lit/canvas each
 * hand-roll a version of this today; naming it here lets them converge (the consumer
 * migration is the Eliminate-phase follow-on).
 *
 * `label` in a type declaration is a path: `value.title` (rooted at the fact envelope)
 * or a bare `name`/`content` (rooted at the value, from the legacy `titlePath`). Both
 * resolve here; a fact with no usable label falls back to its key.
 */
import { resolveType } from './type-schema';

export interface Affordance {
  /** Glyph for the type (static). */
  icon?: string;
  /** Display label resolved from the fact (never empty — falls back to the key). */
  label: string;
  /** The render binding: a `{ hint }` (e.g. markdown/fields) or a `{ viewer }` ref. */
  render?: unknown;
  /** The affordance table: open/edit/create/render/embed → surface | act | renderer | hint. */
  handlers?: Record<string, unknown>;
}

/** A fact, reduced to what Present inspects. */
export interface Presentable {
  key: string;
  value: unknown;
  type?: string | null;
  meta?: unknown;
}

function pluck(root: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((acc, seg) => (acc && typeof acc === 'object' ? (acc as Record<string, unknown>)[seg] : undefined), root);
}

/** Resolve a declaration's `label` path against a fact. `value.*`/`key`/`meta.*` read the
 *  envelope; a bare token reads the value (legacy `titlePath`). Non-strings → undefined. */
export function resolveLabel(fact: Presentable, path?: string): string | undefined {
  if (!path) return undefined;
  const head = path.split('.')[0];
  const root = head === 'value' || head === 'key' || head === 'meta' ? { value: fact.value, key: fact.key, meta: fact.meta } : fact.value;
  const v = pluck(root, path);
  return typeof v === 'string' ? v : typeof v === 'number' || typeof v === 'boolean' ? String(v) : undefined;
}

/** The affordance set for a concrete fact, given its (merged) type declaration. Pure.
 *  An undeclared type still resolves — to the generic floor (key as label, no handlers). */
export function resolvePresent(fact: Presentable, decl?: unknown): Affordance {
  const t = resolveType(decl, fact.type ?? undefined);
  return {
    icon: t.present.icon,
    label: resolveLabel(fact, t.present.label) ?? fact.key,
    render: t.present.render,
    handlers: t.handlers,
  };
}
