/**
 * Selector (ADR-0011) — the one structural predicate over a fact.
 *
 * A Collection's intensional membership (a View's `query`), a `query` filter, and a
 * Subscription's `match` all ask the same question: *does this fact satisfy
 * type/tag/prefix?* — differing only in what they range over (state vs. the change
 * stream). This is that predicate, named once, so "matches a view", "matches a query",
 * and "triggers a subscription" can never drift in their structural semantics.
 *
 * CEL (`match.cel`) is a richer, subscription-side clause layered *on top* of this
 * structural core — it stays in the service layer where its evaluator lives; this
 * primitive is the shared, dependency-free floor.
 */
export interface Selector {
  /** Fact type must equal this. */
  type?: string;
  /** Fact must carry this tag. */
  tag?: string;
  /** Fact must carry AT LEAST ONE of these tags (match-any). The plural
   *  spelling a caller naturally reaches for (wave-4 W4i: `query{tags:[…]}`
   *  used to be a silently-ignored unknown arg that returned the whole slice). */
  tags?: string[];
  /** Fact key must start with this prefix. (Subscriptions spell it `keyPrefix`.) */
  prefix?: string;
}

/** A fact, reduced to what a Selector inspects. */
export interface Selectable {
  key: string;
  type?: string | null;
  tags?: string[];
}

/** Does `fact` satisfy every constraint the selector sets? An empty selector matches
 *  everything (callers that treat "unconstrained" as too coarse guard that themselves). */
export function matchesSelector(fact: Selectable, sel: Selector): boolean {
  if (sel.type !== undefined && fact.type !== sel.type) return false;
  if (sel.tag !== undefined && !(fact.tags ?? []).includes(sel.tag)) return false;
  if (sel.tags !== undefined && sel.tags.length && !sel.tags.some((t) => (fact.tags ?? []).includes(t))) return false;
  if (sel.prefix !== undefined && !fact.key.startsWith(sel.prefix)) return false;
  return true;
}
