/**
 * StateStore wire codec (ADR-0042 Inc 1, part of the platform-SDK-for-cells) —
 * the PURE item⇄record mapping and key grammar the DynamoDB-backed `StateStore`
 * uses. `dynamo-state-store-v3.ts` is the ONE Dynamo consumer today; the codec
 * exists so that marshalling stays unit-testable WITHOUT a DynamoDB client or
 * the AWS SDK (the part of a store port most likely to drift is the field
 * coercion, not the `send` wiring), and so the memory store has an explicit
 * parity target. `itemToRecord`/`itemToEdge` are hand-maintained field
 * allowlists — a new `StateRecord`/`EdgeRecord` field wired through `put()` but
 * not added here is silently dropped in production while the
 * structurally-spreading memory store preserves it; the round-trip suite in
 * `tests/state-store-parity.test.ts` is the canary that catches that.
 *
 * No AWS import, no I/O — safe to bundle anywhere.
 */
import type { StateRecord, EdgeRecord, TouchCounters, TouchWindow } from './state';

/** The substrate table's key grammar. `pk` repeats the scope so IAM
 *  `dynamodb:LeadingKeys` conditions cover base-table AND index reads. */
export const key = {
  statePk: (scope: string): string => `STATE#${scope}`,
  factSk: (k: string): string => `KEY#${k}`,
  edgeSk: (from: string, rel: string, to: string): string => `EDGE#${from}|${rel}|${to}`,
  trajPk: (scope: string): string => `TRAJ#${scope}`,
  seqPk: (scope: string): string => `SEQ#${scope}`,
  inPk: (scope: string, to: string): string => `IN#${scope}#${to}`,
  inSk: (rel: string, from: string): string => `${rel}|${from}`,
  typePk: (scope: string, type: string): string => `TYPE#${scope}#${type}`,
  trajSk: (at: string, seq: number): string => `${at}#${String(seq).padStart(12, '0')}`,
} as const;

/** How long trajectory events live (s). The trajectory is a WRITE ledger for
 *  `changes` (ADR-0050) — salience no longer scans it (lifetime terms live as
 *  counters on the fact), so the TTL bounds only how far back `changes` reaches. */
export const TRAJECTORY_TTL_SEC = 24 * 60 * 60;

/** The actor-classed counter keys (ADR-0050), in one canonical order. */
export const TOUCH_KEYS = ['hr', 'hw', 'ar', 'aw', 'pr', 'pw'] as const;

/** Item attribute for a lifetime counter (`hr` → `t_hr`) / window counter (`w_hr`).
 *  FLAT top-level attributes, because `recordTouch` bumps one with a single
 *  DynamoDB `ADD` — which only works on top-level attributes. */
export const touchAttr = (k: (typeof TOUCH_KEYS)[number]): string => `t_${k}`;
export const windowAttr = (k: (typeof TOUCH_KEYS)[number]): string => `w_${k}`;
/** Item attribute holding the window's bucket ordinal. */
export const WINDOW_BUCKET_ATTR = 'w_b';

/** A record's nested `touches`/`window` → the flat item attributes. */
export function touchesToItem(rec: Pick<StateRecord, 'touches' | 'window'>): Item {
  const out: Item = {};
  for (const k of TOUCH_KEYS) {
    const t = rec.touches?.[k];
    if (t !== undefined) out[touchAttr(k)] = t;
    const w = rec.window?.[k];
    if (w !== undefined) out[windowAttr(k)] = w;
  }
  if (rec.window) out[WINDOW_BUCKET_ATTR] = rec.window.b;
  return out;
}

/** The flat item attributes → nested `touches`/`window` (absent when unset). */
export function itemToTouches(item: Item): Pick<StateRecord, 'touches' | 'window'> {
  let touches: TouchCounters | undefined;
  let window: TouchWindow | undefined;
  for (const k of TOUCH_KEYS) {
    const t = item[touchAttr(k)];
    if (typeof t === 'number') (touches ??= {})[k] = t;
    const w = item[windowAttr(k)];
    if (typeof w === 'number') (window ??= { b: 0 })[k] = w;
  }
  if (item[WINDOW_BUCKET_ATTR] !== undefined) (window ??= { b: 0 }).b = Number(item[WINDOW_BUCKET_ATTR]);
  return { ...(touches ? { touches } : {}), ...(window ? { window } : {}) };
}

type Item = Record<string, unknown>;
const num = (v: unknown): number => Number(v);
const arr = (v: unknown): string[] => (Array.isArray(v) ? (v as string[]) : []);

/** A stored item → the `StateRecord` the observed-state pipeline reads. */
export function itemToRecord(item: Item): StateRecord {
  return {
    scope: item.scope as string,
    key: item.key as string,
    value: item.value ?? null,
    revision: num(item.revision),
    // Proof-of-read token (ADR-0066); absent on facts written before it.
    ...(item.version !== undefined ? { version: item.version as string } : {}),
    seq: num(item.seq),
    firstSeq: num(item.firstSeq),
    writer: (item.writer as string | null) ?? null,
    via: (item.via as string | null) ?? null,
    // Participant key (ADR-0086) — provenance beside `via`; absent when none declared.
    ...(typeof item.as === 'string' && item.as ? { as: item.as } : {}),
    createdAt: item.createdAt as string,
    updatedAt: item.updatedAt as string,
    writers: arr(item.writers),
    superseded: !!item.superseded,
    supersededBy: (item.supersededBy as string | null) ?? null,
    type: (item.type as string | null) ?? null,
    tags: arr(item.tags),
    timerExpiresAt: (item.timerExpiresAt as string | null) ?? null,
    timerEffect: (item.timerEffect as StateRecord['timerEffect']) ?? null,
    ...(item.seedReads !== undefined ? { seedReads: num(item.seedReads) } : {}),
    ...(item.seedWrites !== undefined ? { seedWrites: num(item.seedWrites) } : {}),
    // Earned salience (ADR-0070) — absent on facts that never earned one.
    ...(item.reward !== undefined ? { reward: num(item.reward) } : {}),
    ...itemToTouches(item),
  };
}

/** A stored edge item → an `EdgeRecord`. `score` (the persisted cosine, ADR-0032)
 *  rides along only when present, distinct from the fixed `strength`. */
export function itemToEdge(item: Item): EdgeRecord {
  return {
    scope: item.scope as string,
    from: item.from as string,
    rel: item.rel as string,
    to: item.to as string,
    strength: (item.strength as number | null) ?? null,
    createdAt: item.createdAt as string,
    writer: (item.writer as string | null) ?? null,
    ...(item.score !== undefined && item.score !== null ? { score: num(item.score) } : {}),
  };
}

/**
 * Recursively drop `undefined` before an item reaches DynamoDB. A stored fact
 * never legitimately carries `undefined` (absent === undefined on read), so
 * stripping is loss-free — and it prevents a single absent field from failing
 * the whole write (the v2 marshaller's silent-failure trap). This is the SDK
 * equivalent of v3's `marshallOptions.removeUndefinedValues:true`; keep it so a
 * store built without that option is still safe.
 */
export function stripUndefined<T>(v: T): T {
  if (v === null || typeof v !== 'object') return v;
  if (Array.isArray(v)) return v.map((x) => stripUndefined(x)) as unknown as T;
  const out: Record<string, unknown> = {};
  for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
    if (val !== undefined) out[k] = stripUndefined(val);
  }
  return out as T;
}
