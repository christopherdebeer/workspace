/**
 * Substrate subscriptions — the generic reaction primitive (tier-1).
 *
 * A subscription is **data, not code**: `{ match, invoke, params }` stored as a
 * fact at `_subscriptions/<id>` and interpreted by a small fixed reactor. When a
 * fact write matches `match` (type / key-prefix / a CEL predicate over the
 * changed fact), the reactor invokes the declared action `invoke` with `params`
 * templated from the event. Because reactions invoke *declared actions* — which
 * are themselves bounded, guarded, auditable data — the whole loop stays in the
 * declarative tier: no opaque callbacks, no cell knows about "reactions".
 *
 * This is what lets a tier-2 cell (e.g. `@c15r/machine`) become reactive purely
 * by registering vocabulary: an auto-rail's transition action + a subscription
 * tying it to `machine-run/*` changes. The action's own `if` guard decides
 * whether it fires; the reactor re-emits the write so the next rail can react —
 * a bounded fixpoint. tier-1 stays generic; the machine concept stays tier-2.
 */
import { evaluate as celEvaluate, parse as celParse } from '@marcbachmann/cel-js';
import type { Identity, ObservedState } from '../../platform/runtime';
import { createDeclarationRegistry, matchesSelector, type DeclarationKind } from '../../platform/runtime';

/** Reserved key prefix where a slice's reaction subscriptions live. */
export const SUBSCRIPTIONS_PREFIX = '_subscriptions/';

/** A predicate over a changed fact (AND of the present clauses). */
export interface SubscriptionMatch {
  /** Fact type must equal this. */
  type?: string;
  /** Fact key must start with this. Also defines `${keySuffix}` for params. */
  keyPrefix?: string;
  /** CEL over `{ key, value, meta }` — must evaluate to boolean true. */
  cel?: string;
}

export interface SubscriptionDefinition {
  id: string;
  /** When this holds for a changed fact, the reaction fires. */
  match: SubscriptionMatch;
  /**
   * What to fire. Exactly one of:
   *   invoke  — a declared action id in the same slice (in-process, no I/O)
   *   deliver — a cell tool address "@owner/name.tool" (called AS the slice
   *             owner via cells.callCellTool, for reactions that need a cell's
   *             capabilities, e.g. a model deciding an agent rail)
   */
  invoke?: string;
  deliver?: string;
  /**
   * Args for the action/tool, each a template over the event:
   *   ${key} ${keySuffix} ${scope} ${value} ${value.<dotpath>}
   * A value that is exactly one placeholder keeps the source's JSON type.
   */
  params?: Record<string, string>;
  /**
   * Loop bound: skip the reaction when the triggering fact's revision exceeds
   * this (a run fact's revision = the number of transitions, so this caps an
   * auto-advance chain generically). Default 50.
   */
  maxDepth?: number;
  label?: string;
}

/** Provenance options, mirroring the actions/views registries. */
export interface RegisterSubscriptionOptions {
  via?: string;
  tags?: string[];
}

// ── param templating over the event ────────────────────────────────

const PLACEHOLDER = /\$\{(key|keySuffix|scope|value(?:\.[A-Za-z0-9_]+)*)\}/g;

function resolveOne(token: string, key: string, keySuffix: string, scope: string, value: unknown): unknown {
  if (token === 'key') return key;
  if (token === 'keySuffix') return keySuffix;
  if (token === 'scope') return scope;
  if (token === 'value') return value;
  // value.<dotpath>
  let cur: unknown = value;
  for (const part of token.slice('value.'.length).split('.')) {
    if (cur === null || typeof cur !== 'object') return undefined;
    cur = (cur as Record<string, unknown>)[part];
  }
  return cur;
}

const EXACT_PLACEHOLDER = /^\$\{(key|keySuffix|scope|value(?:\.[A-Za-z0-9_]+)*)\}$/;

/** Substitute `${…}` templates in any param value — recursing into objects and
 *  arrays so NESTED string leaves template too (e.g. an `onError.key`). A string
 *  that is exactly one placeholder keeps the resolved JSON type; non-strings
 *  (number/boolean/null) pass through unchanged. */
function substituteValue(tpl: unknown, key: string, keySuffix: string, scope: string, value: unknown): unknown {
  if (typeof tpl === 'string') {
    const exact = EXACT_PLACEHOLDER.exec(tpl);
    if (exact) return resolveOne(exact[1], key, keySuffix, scope, value) ?? null;
    return tpl.replace(PLACEHOLDER, (_m, token: string) => {
      const v = resolveOne(token, key, keySuffix, scope, value);
      return v === undefined || v === null ? '' : typeof v === 'string' ? v : JSON.stringify(v);
    });
  }
  if (Array.isArray(tpl)) return tpl.map((x) => substituteValue(x, key, keySuffix, scope, value));
  if (tpl && typeof tpl === 'object') {
    const o: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(tpl as Record<string, unknown>)) o[k] = substituteValue(v, key, keySuffix, scope, value);
    return o;
  }
  return tpl;
}

/** Build an action's params from a subscription's templates + the changed fact. */
export function resolveParams(
  sub: SubscriptionDefinition,
  key: string,
  scope: string,
  value: unknown,
): Record<string, unknown> {
  const keySuffix = sub.match.keyPrefix && key.startsWith(sub.match.keyPrefix) ? key.slice(sub.match.keyPrefix.length) : key;
  const out: Record<string, unknown> = {};
  for (const [name, tpl] of Object.entries(sub.params ?? {})) {
    out[name] = substituteValue(tpl, key, keySuffix, scope, value);
  }
  return out;
}

/** Parse a `deliver` address "@owner/name.tool" into its parts (null if malformed). */
export function parseCellTarget(address: string): { owner: string; name: string; tool: string } | null {
  const m = /^@([^/]+)\/([^.]+)\.(.+)$/.exec(address);
  return m ? { owner: m[1], name: m[2], tool: m[3] } : null;
}

// ── validation ─────────────────────────────────────────────────────

function validateSubscription(def: SubscriptionDefinition): void {
  if (!def?.id || typeof def.id !== 'string') throw new Error('subscription requires a string `id`');
  if (def.id.includes('/')) throw new Error('subscription `id` must not contain "/"');
  const hasInvoke = typeof def.invoke === 'string' && def.invoke.length > 0;
  const hasDeliver = typeof def.deliver === 'string' && def.deliver.length > 0;
  if (hasInvoke === hasDeliver) {
    throw new Error('subscription requires exactly one of `invoke` (a declared action id) or `deliver` (a cell tool "@owner/name.tool")');
  }
  if (hasDeliver && !parseCellTarget(def.deliver as string)) {
    throw new Error('subscription `deliver` must be a cell tool address "@owner/name.tool"');
  }
  if (!def.match || typeof def.match !== 'object') throw new Error('subscription requires a `match` object');
  const { type, keyPrefix, cel } = def.match;
  if (type === undefined && keyPrefix === undefined && cel === undefined) {
    throw new Error('subscription `match` must constrain at least one of type/keyPrefix/cel');
  }
  if (type !== undefined && typeof type !== 'string') throw new Error('subscription `match.type` must be a string');
  if (keyPrefix !== undefined && typeof keyPrefix !== 'string') throw new Error('subscription `match.keyPrefix` must be a string');
  if (cel !== undefined) {
    if (typeof cel !== 'string') throw new Error('subscription `match.cel` must be a CEL string');
    try {
      celParse(cel);
    } catch (err) {
      throw new Error(`subscription \`match.cel\` is invalid CEL: ${(err as Error).message}`);
    }
  }
  if (def.params !== undefined && (typeof def.params !== 'object' || def.params === null || Array.isArray(def.params))) {
    throw new Error('subscription `params` must be an object of template strings');
  }
}

/** Does a subscription's match hold for a changed fact? Total (eval errors → false).
 *  The structural part (type / keyPrefix) is the shared Selector predicate (ADR-0011) —
 *  the same one View membership and `query` use; CEL is the subscription-side clause on top. */
export function matches(def: SubscriptionDefinition, fact: { key: string; value: unknown; type?: string; meta?: unknown }): boolean {
  const m = def.match;
  if (!matchesSelector({ key: fact.key, type: fact.type }, { type: m.type, prefix: m.keyPrefix })) return false;
  if (m.cel !== undefined) {
    try {
      return celEvaluate(m.cel, { key: fact.key, value: fact.value, meta: fact.meta ?? null }) === true;
    } catch {
      return false;
    }
  }
  return true;
}

// ── the registry ───────────────────────────────────────────────────

export interface Subscriptions {
  register(scope: string, def: SubscriptionDefinition, identity?: Identity, opts?: RegisterSubscriptionOptions): Promise<SubscriptionDefinition>;
  list(scope: string): Promise<SubscriptionDefinition[]>;
  remove(scope: string, id: string, identity?: Identity): Promise<{ ok: true }>;
}

/**
 * The subscription *kind* (ADR-0001): storage + validation only. `match`/`invoke`
 * (the evaluate side) stay the exported `matches`/`resolveParams` helpers above.
 */
const subscriptionKind: DeclarationKind<SubscriptionDefinition> = {
  ns: SUBSCRIPTIONS_PREFIX,
  factType: 'subscription',
  defaultVia: 'registerSubscription',
  idOf: (d) => d.id,
  validate: validateSubscription,
  isStored: (v): v is SubscriptionDefinition => !!(v as { id?: unknown })?.id,
  listLimit: 200,
};

export function createSubscriptions(state: ObservedState): Subscriptions {
  // Thin wrapper over the shared Declaration registry — the storage lifecycle is
  // identical for every declaration kind; only `subscriptionKind` is bespoke.
  const reg = createDeclarationRegistry(state, subscriptionKind);
  return {
    register: (scope, def, identity, opts) => reg.register(scope, def, identity, opts),
    list: (scope) => reg.list(scope),
    remove: (scope, id, identity) => reg.remove(scope, id, identity),
  };
}
