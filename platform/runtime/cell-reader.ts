/**
 * createCellReader (ADR-0042 Inc 1) — the canonical way a CELL reads the shared
 * substrate from its OWN Lambda (SSR, an organ, a scheduled job) WITHOUT a
 * gateway round-trip. It runs the SAME observed-state pipeline the workspace
 * handler runs — select → score → shape, reference derivation, membership,
 * salience — against the cell's IAM-scoped partition, so a cell stops
 * hand-rolling raw `STATE#<owner>` / `KEY#` / `gsi-*` queries and re-deriving
 * edges, salience, and membership by hand (the six-fold duplication ADR-0042
 * found across lit/canvas/starter SSR and machine/models/run bindings).
 *
 * **Store-injected** (a `StateStore`, e.g. `createDynamoStateStore(table)`), so
 * it is pure and unit-testable against the memory store, and so a cell supplies
 * whichever DynamoDB client its runtime actually bundles (the v2/v3 choice stays
 * the cell's, not the library's).
 *
 * **Read-only by construction.** It surfaces only the pipeline's
 * non-attention read methods — `query` / `byType` / `neighbors` / `members` /
 * `graph` — plus a raw single-fact `peek`. None of these write the trajectory,
 * so the reader is safe under a read-only (`dynamodb:LeadingKeys` read) SSR
 * role. The attention-recording `get` / `read` are deliberately NOT exposed
 * (recording a write from an SSR read path would both need write IAM and inflate
 * salience on every page view).
 *
 * **`typeRules` honesty (the `$types` dependency — ADR-0042 Inc 2).** The
 * Reference projection's structural / embedded / **key-encoded** edges — how a
 * doc's `_doc/<doc>/<block>` decoration becomes an `inDoc` membership edge — are
 * derived from the type vocabulary (`deriveBackboneEdges(records, typeRules)`).
 * A cell's SSR can't assemble `$types` without a wire hop *today*, so `typeRules`
 * is OPTIONAL: supply it (once fetched/cached) for full membership + derived-edge
 * centrality; omit it and the reader still returns real, salience-scored facts
 * and AUTHORED edges — strictly better than raw DDB — but extensional
 * key-encoded membership (a doc's blocks) resolves empty. Inc 2 will give cells a
 * wire-free way to build `typeRules`; this reader is the seam it plugs into.
 */
import {
  createObservedState,
  isTimerLive,
  type StateStore,
  type ObservedState,
  type StateRecord,
  type QueryOptions,
  type QueryResult,
  type NeighborsOptions,
  type NeighborsResult,
  type MembersResult,
  type TypeRules,
  type SalienceOptions,
  type AnnotatedEdge,
} from './state';

export interface CellReaderDefaults {
  /** The resolved type vocabulary. Enables key-encoded / structural / embedded
   *  edge derivation (doc membership, the backbone). Omit → authored edges only
   *  (see the module doc's `$types`-dependency note). */
  typeRules?: Record<string, TypeRules>;
  /** Instance salience policy. The scope's own `_config/salience` and the
   *  built-in defaults still apply per call; this only sets the instance base. */
  salience?: SalienceOptions;
}

/** A cell's read-only view of its own substrate slice — the pipeline, bound to
 *  one scope, minus the attention-writing methods. */
export interface CellReader {
  /** One fact, RAW (the stored record — no salience, no attention write). The
   *  SSR-safe `peek`: a doc's body, a single fact by key. */
  peek(key: string): Promise<StateRecord | null>;
  /** CHEAP list of live records, RAW and UNRANKED — a prefix-scoped partition
   *  read (`begins_with KEY#<prefix>`, so it reads ONLY that namespace, not the
   *  whole slice), NO salience. Use this for "just the facts" cell SSR (a notes
   *  list `list('note:')`, a doc's decorations `list('_doc/<id>/')`). Prefer it
   *  over `query` on a large slice: `query` scans the whole trajectory + every
   *  edge to compute salience, which times out an SSR Lambda on a big slice —
   *  and even a prefix-less whole-slice read can, so pass a prefix. Reach for
   *  `query` only when you actually need the ranking. */
  list(prefix?: string): Promise<StateRecord[]>;
  /** Salience-ranked projection over the slice (filter by type/tag/prefix/contains).
   *  Heavier than `list` — computes salience over the WHOLE slice (trajectory +
   *  all edges). Use only when the ranking matters; else use `list`. */
  query(opts?: QueryOptions): Promise<QueryResult>;
  /** Every fact of one type, salience-ranked — `query({ type })` with the
   *  bound `typeRules`. The hub-collection read. */
  byType(type: string, opts?: QueryOptions): Promise<QueryResult>;
  /** Edges + neighbor entries around a key: authored edges always; the derived
   *  backbone only when `typeRules` is bound. */
  neighbors(key: string, opts?: NeighborsOptions): Promise<NeighborsResult>;
  /** A collection's members (a doc's blocks, ordered by decoration `seq`).
   *  Key-encoded membership needs `typeRules` — empty without it. */
  members(key: string): Promise<MembersResult>;
  /** The full Reference projection for the slice (authored + derived). */
  graph(): Promise<{ edges: AnnotatedEdge[] }>;
  /** The underlying `ObservedState` and the bound scope, for the rare call the
   *  bound surface doesn't cover (kept read-only in spirit). */
  readonly state: ObservedState;
  readonly scope: string;
}

/**
 * Bind the observed-state read pipeline to one cell's scope + type vocabulary.
 * `store` is any `StateStore` (dynamo in a cell, memory in a test); `scope` is
 * the cell owner's partition (`process.env.CELL_OWNER`).
 */
export function createCellReader(
  store: StateStore,
  scope: string,
  defaults: CellReaderDefaults = {},
): CellReader {
  const state = createObservedState(store, defaults.salience);
  const typeRules = defaults.typeRules;
  return {
    state,
    scope,
    peek: (key) => store.get(scope, key),
    list: async (prefix) => {
      const nowMs = Date.now();
      // Prefix pushed to the store's partition query (`begins_with KEY#<prefix>`),
      // so a cell reading a small namespace never scans the whole slice.
      const recs = await store.list(scope, prefix);
      return recs.filter((r) => !r.superseded && isTimerLive(r, nowMs));
    },
    query: (opts) => state.query(scope, { ...opts, typeRules: opts?.typeRules ?? typeRules }),
    byType: (type, opts) => state.query(scope, { ...opts, type, typeRules: opts?.typeRules ?? typeRules }),
    neighbors: (key, opts) => state.neighbors(scope, key, { ...opts, typeRules: opts?.typeRules ?? typeRules }),
    members: (key) => state.members(scope, key, { typeRules }),
    graph: () => state.graph(scope, { typeRules }),
  };
}
