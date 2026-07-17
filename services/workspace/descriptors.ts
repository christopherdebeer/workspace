/**
 * Workspace MCP tool descriptors (ADR-0044 Inc 5): how the `/mcp` gateway
 * discovers and advertises this cell's tools — the descriptor type, the shared
 * result-schema fragments, and the TOOL_DESCRIPTORS catalog.
 */
import { NOTE_MAX } from './grant-requests';

/** How the `/mcp` gateway discovers and advertises a cell's tools. */
export interface ToolDescriptor {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  /**
   * The result envelope, declared. Self-documentation has two directions: an
   * input schema teaches the call, a result schema teaches the read — and an
   * undeclared envelope is exactly where shapes drift apart. Kept shallow.
   */
  resultSchema?: Record<string, unknown>;
  /** Scope the gateway enforces before forwarding (null = any authenticated user). */
  scope: string | null;
  /** An any-of family gate (docs/auth-consent-plan.md §B): a token holding any scope
   *  under this pattern (e.g. `write:type:*`) passes the gateway gate, and this
   *  handler then enforces the concrete fact type. Lets a type-scoped token write
   *  only its declared types while coarse `write:workspace` tokens are unaffected. */
  scopeFamily?: string;
  /** `read` = side-effect-free (observe); `act` = may mutate. Routes read/act dispatch. */
  kind: 'read' | 'act';
}

// ── shared result-schema fragments (shallow on purpose — catalog weight is an
//    ergonomic budget; see docs/trajectory/2026-06-12-mcp-agent-ergonomics-review.md) ──

const META_SCHEMA = {
  type: 'object',
  description:
    'Provenance + salience: revision, version (content hash — the proof-of-read token to echo on an ifVersion write), seq, writer, via, createdAt, updatedAt, writers[], superseded, supersededBy, type, tags[], timer, score, velocity, standing, centrality, elided. With a read `explain:true`, also `explain: { signals, weights, contribution, degree }` — the score breakdown for tuning.',
} as const;

/** Per-call salience lens — an ergonomic bias over the tuned defaults. */
const LENS_SCHEMA = {
  type: 'string',
  enum: ['salience', 'recent', 'connected', 'durable', 'active'],
  description:
    'Salience lens (default salience): recent=freshness, connected=graph degree, durable=earned/cumulative, active=read/written now. Recomputes the score, so it shifts BOTH ranking and focus/peripheral/elided tiers.',
} as const;

/** ADR-0048: the uniform entry tier — dynamic response shaping, one vocabulary. */
const SHAPE_SCHEMA = {
  type: 'string',
  enum: ['refs', 'card', 'full'],
  description:
    'Entry tier (ADR-0048): "refs" = key + _meta essentials (no value); "card" = value truncated to a presentable preview (titles/first lines survive, bodies don\'t; `_meta.shaped` marks it); "full" = whole values. Lists, chips, and graphs want card; only a body renderer needs full — `peek` always returns the whole fact.',
} as const;

/** Import-only provenance: preserve a migrated fact's timestamps + earned counts. */
const IMPORT_SCHEMA = {
  type: 'object',
  description:
    'Import-only: { createdAt?, updatedAt? (ISO — preserve true age for recency), seedReads?, seedWrites? (cumulative legacy counts, folded into standing) }.',
  properties: {
    createdAt: { type: 'string' },
    updatedAt: { type: 'string' },
    seedReads: { type: 'number' },
    seedWrites: { type: 'number' },
  },
  additionalProperties: false,
} as const;

/** Raw per-call salience override (escape hatch); merges over the lens + defaults. */
const SALIENCE_OVERRIDE_SCHEMA = {
  type: 'object',
  description:
    'Precise salience override, merged over the lens + defaults: { halfLifeMs?, windowMs?, recencyWeight?, velocityWeight?, attentionWeight?, standingWeight?, centralityWeight?, standingSaturation?, centralitySaturation?, focusThreshold?, elideThreshold? }. Not auto-normalized — you own the weights.',
  additionalProperties: true,
} as const;

const ENTRY_SCHEMA = {
  type: 'object',
  properties: { value: { description: 'The stored JSON value' }, _meta: META_SCHEMA },
} as const;

const KEYED_ENTRY_SCHEMA = {
  type: 'object',
  properties: { key: { type: 'string' }, value: { description: 'The stored JSON value' }, _meta: META_SCHEMA },
} as const;

/** The inline affordance map a read carries for the types present in its result
 *  (ADR-0029 R1) — collapses `query → $types → correlate → act` into `query → act`. */
const TYPES_AFFORDANCE_SCHEMA = {
  type: 'object',
  description:
    "What you can DO with each type in this result, keyed by type name (present only when ≥1 returned type is declared). For a fact of type T: types[T].handlers[intent] (open/edit/render/create → an act target, cell surface, or renderer) and types[T].manager (the owning cell) — no separate read('$types') needed. `label` is the type's label path (e.g. value.title).",
  additionalProperties: {
    type: 'object',
    properties: {
      icon: { type: 'string' },
      label: { type: 'string', description: 'Label path (where a fact of this type gets its display label)' },
      render: { description: 'Render binding: a { hint } or { viewer } ref' },
      handlers: { type: 'object', description: 'intent → surface | act target | renderer | hint' },
      manager: { type: 'string', description: 'The cell that manages this type' },
    },
  },
} as const;

const EDGE_SCHEMA = {
  type: 'object',
  properties: {
    from: { type: 'string' },
    rel: { type: 'string' },
    to: { type: 'string' },
    strength: { type: ['number', 'null'] },
    createdAt: { type: 'string' },
    writer: { type: ['string', 'null'] },
    derived: { type: 'boolean', description: 'Present and true for a derived structural-backbone edge (instanceOf/managedBy/rendersWith/inView); absent for authored edges' },
  },
} as const;

/**
 * The workspace vocabulary as MCP tool descriptors. Every command operates on the
 * caller's own slice (or subsets explicitly granted to them) — ownership/slice
 * isolation is the primary boundary. On top of that, `describeTools` derives a
 * verb scope from `kind` (reads → `read:workspace`, acts → `write:workspace`) so
 * a token's read/write consent is actually enforced; `scope: null` here means
 * "no explicit scope — gate by verb". An explicit scope (e.g. `workspace:admin`)
 * overrides the verb default.
 */
export const TOOL_DESCRIPTORS: ToolDescriptor[] = [
  {
    name: 'remember',
    description:
      'Write a fact to your workspace at `key`. REPLACE semantics: the new `value` overwrites the prior one WHOLESALE — there is NO field-level merge (the old value is recoverable via revision history, which is preserved, but it is not visible in the current fact). To change one field, read the fact first and write the whole value back with your edit. CAUTION on SHARED keys written by more than one producer (e.g. a platform cron AND an agent both writing the same key): a blind write clobbers the other producer\'s value until it next writes — read-then-write with `ifVersion` (proof-of-read CAS) to make the write conditional on the value you actually saw, or write to your own distinct key instead. `type`/`tags` make it queryable; `ifRevision`/`ifVersion`/`ifAbsent` make the write conditional (fails if the precondition does not hold). Pass `owner` to write into another user\'s slice under their write grant (write-through — your identity is stamped as the writer).',
    scope: null,
    scopeFamily: 'write:type:*',
    kind: 'act',
    inputSchema: {
      type: 'object',
      properties: {
        key: { type: 'string', description: 'Fact key within your slice' },
        owner: { type: 'string', description: "Write-through: the slice owner to write into (requires their `write` grant covering the key)" },
        value: { description: 'Any JSON value to remember' },
        via: { type: 'string', description: 'Optional label for how this was written (e.g. an action name)' },
        type: { type: 'string', description: 'Optional indexable fact type (e.g. "decision", "todo")' },
        tags: { type: 'array', items: { type: 'string' }, description: 'Optional tags (filterable in query)' },
        ifRevision: { type: 'number', description: 'Only write if the stored revision equals this (0 = key must not exist)' },
        ifVersion: { type: 'string', description: 'Proof-of-read CAS: only write if the stored content hash (a read\'s `_meta.version`) equals this ("" = key must not exist). Unlike ifRevision, it cannot be supplied without having read the value — use it for contended keys.' },
        ifAbsent: { type: 'boolean', description: 'Only write if the key does not exist (treats an expired lease as absent)' },
        timer: {
          type: 'object',
          description:
            'Lease/reveal timer, evaluated at read: effect "delete" = live now, vanishes at expiry (a lease); "enable" = dormant until expiry.',
          properties: {
            ms: { type: 'number', description: 'Relative expiry in ms' },
            at: { type: 'string', description: 'Absolute ISO expiry (exactly one of ms/at)' },
            effect: { type: 'string', enum: ['delete', 'enable'] },
          },
          required: ['effect'],
          additionalProperties: false,
        },
        import: IMPORT_SCHEMA,
        reward: {
          type: 'number',
          description:
            'Earned salience in [0,1] (ADR-0070): a persisted per-fact reward term, normally written by the consolidation pass when work involving this fact paid off. Omit to preserve what is stored. Inert unless `rewardWeight` is set (`_config/salience` or a per-read salience override).',
        },
      },
      required: ['key', 'value'],
      additionalProperties: false,
    },
    resultSchema: {
      ...ENTRY_SCHEMA,
      description: 'The written fact, plus optional advisory `hints` (the write always succeeds)',
      properties: {
        ...((ENTRY_SCHEMA as { properties?: Record<string, unknown> }).properties ?? {}),
        hints: {
          type: 'array',
          items: { type: 'string' },
          description: 'Advisory notes — missing recommended fields for the type, or that the type could declare a schema. Never blocks the write.',
        },
      },
    },
  },
  {
    name: 'ingest',
    description:
      'Bulk intake: write up to 100 facts in one call (imports, capture backfills). Each fact takes the same fields as `remember` (no `ifRevision`); failures are reported per-fact, the rest are written. May not write `_actions/` or `_views/`.',
    scope: null,
    scopeFamily: 'write:type:*',
    kind: 'act',
    inputSchema: {
      type: 'object',
      properties: {
        facts: {
          type: 'array',
          maxItems: 100,
          items: {
            type: 'object',
            properties: {
              key: { type: 'string' },
              value: {},
              via: { type: 'string' },
              type: { type: 'string' },
              tags: { type: 'array', items: { type: 'string' } },
              ifAbsent: { type: 'boolean' },
              import: IMPORT_SCHEMA,
            },
            required: ['key', 'value'],
            additionalProperties: false,
          },
        },
        via: { type: 'string', description: 'Default `via` for facts that do not set their own' },
        edges: {
          type: 'array',
          description: 'Edges to write after the facts (bulk graph import): { from, rel, to, strength? }',
          items: {
            type: 'object',
            properties: { from: { type: 'string' }, rel: { type: 'string' }, to: { type: 'string' }, strength: { type: 'number' } },
            required: ['from', 'rel', 'to'],
            additionalProperties: false,
          },
        },
      },
      required: ['facts'],
      additionalProperties: false,
    },
    resultSchema: {
      type: 'object',
      properties: {
        ingested: { type: 'number' },
        errors: { type: 'array', items: { type: 'object', properties: { key: { type: 'string' }, error: { type: 'string' } } } },
      },
    },
  },
  {
    name: 'recall',
    description:
      'Orient in your workspace. BY DEFAULT (bare call) returns a broad, succinct OVERVIEW — total + granted counts, salience bands, top types & key-prefixes, and the top ~12 focus facts in full — plus `hints` on how to drill (query/search/peek/neighbors). Pass `text` to orient RELATIVE TO A GOAL (ADR-0051): relevance to your text joins the salience blend, so the focus band and counts answer "what matters about THIS?" instead of "what matters lately?". This is progressive disclosure: skim here, then narrow. For the WHOLE shaped view pass `view:"full"` (or any shaping arg): focus/peripheral facts in full, low-salience collapsed to `{key,type,score}` stubs under `elided` (re-read with `expand:[keys]` or `peek`). For a targeted subset prefer `query`. Granted facts appear under `<owner>/<key>`. Tune shaping by writing a `_config/salience` fact; precedence is defaults ← that config ← `lens` ← per-call `salience`.',
    scope: null,
    kind: 'read',
    inputSchema: {
      type: 'object',
      properties: {
        view: { type: 'string', enum: ['overview', 'full'], description: "'overview' (default for a bare call) = succinct orientation + drill hints; 'full' = the whole salience-shaped view" },
        text: { type: 'string', description: 'Orient relative to a goal: free text, matched by MEANING. Relevance becomes the leading salience signal for this read (focus, counts, and elision all condition on it). Keeps the overview default — recall({text}) is "what do I have, and what can I do, about X?"' },
        elision: { type: 'string', enum: ['auto', 'none'], description: "(implies view:full) 'auto' collapses low-salience entries to stubs; 'none' returns every entry in full (heavy on a large slice)" },
        expand: { type: 'array', items: { type: 'string' }, description: 'Keys to force into focus' },
        includeSuperseded: { type: 'boolean', description: 'Include retired facts' },
        lens: LENS_SCHEMA,
        salience: SALIENCE_OVERRIDE_SCHEMA,
        explain: { type: 'boolean', description: 'Attach `_meta.explain` to each entry — the salience breakdown (signals · weights · contributions · degree) so you can see *why* a fact scored, and tune accordingly' },
      },
      additionalProperties: false,
    },
    resultSchema: {
      type: 'object',
      description: 'Default (bare): an overview — { overview: { total, granted, bands, byType[], byPrefix[] }, focus: {key→entry}, hints[] }. With view:"full"/any shaping arg: the shaped view below.',
      properties: {
        overview: {
          type: 'object',
          description: 'Default orientation: counts by type & key-prefix, salience bands, totals',
          properties: {
            total: { type: 'number' },
            granted: { type: 'number', description: 'Facts merged in from grants' },
            bands: { type: 'object', properties: { focus: { type: 'number' }, peripheral: { type: 'number' }, elided: { type: 'number' } } },
            byType: { type: 'array', items: { type: 'object', properties: { type: { type: ['string', 'null'] }, count: { type: 'number' } } } },
            byPrefix: { type: 'array', items: { type: 'object', properties: { prefix: { type: 'string' }, count: { type: 'number' } } } },
          },
        },
        focus: { type: 'object', description: 'Top facts by salience, orientation-shaped (overview mode): a card-truncated value preview + the refs `_meta` slice (type/tags/score/updatedAt/superseded) — `_meta.shaped:"card"` marks it. `peek` or `recall({shape:"full"})` for the whole entry (full value + provenance)', additionalProperties: ENTRY_SCHEMA },
        hints: { type: 'array', items: { type: 'string' }, description: 'How to drill deeper (overview mode)' },
        entries: { type: 'object', description: 'key → { value, _meta } for focus/peripheral facts (full mode)', additionalProperties: ENTRY_SCHEMA },
        elided: {
          type: 'array',
          description: 'Stubs for withheld entries, score-descending (full mode)',
          items: { type: 'object', properties: { key: { type: 'string' }, type: { type: ['string', 'null'] }, score: { type: 'number' } } },
        },
        _shaping: { type: 'object', description: 'Thresholds + counts: { focus, peripheral, elided, total } (full mode)' },
        types: TYPES_AFFORDANCE_SCHEMA,
      },
    },
  },
  {
    name: 'peek',
    description: 'Read one fact by key from your slice (no salience shaping). Returns null when the key is absent — including a lapsed lease — so it doubles as an existence probe. Pass `owner` to read a fact another user granted you.',
    scope: null,
    scopeFamily: 'read:type:*',
    kind: 'read',
    inputSchema: {
      type: 'object',
      properties: {
        key: { type: 'string', description: 'Fact key to read' },
        owner: { type: 'string', description: 'Read-through: the slice owner to read from (requires a grant covering the key)' },
      },
      required: ['key'],
      additionalProperties: false,
    },
    resultSchema: { ...ENTRY_SCHEMA, properties: { ...ENTRY_SCHEMA.properties, types: TYPES_AFFORDANCE_SCHEMA }, description: 'The fact (with an inline `types` affordance map), or null when absent' },
  },
  {
    name: 'query',
    description:
      'Projection over your slice: filter facts by type, tag, and/or key prefix; rank by salience (default) or recency; limit + cursor/offset to page. Pass `text` to rank by MEANING (ADR-0051/0085): `query({text})` alone is semantic search; `query({type, text})` is the structural+semantic hybrid. Intent queries (`text` present) are RELEVANCE-ORDERED — cosine drives the ranking, salience breaks ties, and entries the intent never reached are dropped rather than padded in — and default to a top-20 shortlist of orientation-shaped entries (value preview + trimmed `_meta` incl. `relevance`). Pass explicit `limit`/`shape`/`rankBy` to override. Use this instead of recall when you want a targeted subset.',
    scope: null,
    scopeFamily: 'read:type:*',
    kind: 'read',
    inputSchema: {
      type: 'object',
      properties: {
        type: { type: 'string', description: 'Only facts of this type' },
        tag: { type: 'string', description: 'Only facts carrying this tag' },
        tags: { type: 'array', items: { type: 'string' }, description: 'Only facts carrying at least one of these tags (match-any)' },
        prefix: { type: 'string', description: 'Only keys with this prefix' },
        text: { type: 'string', description: 'Rank by meaning: free text, embedded and matched semantically. Relevance leads the salience blend for this call (intent preset; an explicit `salience` override still wins). Prefer this over `search` — same candidates, but salience-aware ranking and full query filters' },
        contains: { type: 'string', description: 'Find a fact by what is INSIDE it: keep only facts whose key or value (stringified) contains this substring, case-insensitively — full-text search over value content, so you need not page a partition to find "the fact that mentions X"' },
        rankBy: { type: 'string', enum: ['salience', 'recency', 'relevance'], description: 'Ranking (default salience; intent queries with `text` default to relevance — cosine first, salience tiebreak, no-relevance tail dropped)' },
        lens: LENS_SCHEMA,
        salience: SALIENCE_OVERRIDE_SCHEMA,
        explain: { type: 'boolean', description: 'Attach `_meta.explain` (signals · weights · contributions · degree) to each entry, for salience tuning' },
        shape: SHAPE_SCHEMA,
        limit: { type: 'number', description: 'Max entries to return (intent queries with `text` default to 20)' },
        cursor: { type: 'string', description: "A previous page's nextCursor (best-effort resume over a fresh ranking)" },
        offset: { type: 'number', description: 'Numeric paging alias for `cursor` (which is a plain offset into the fresh ranking)' },
        includeSuperseded: { type: 'boolean', description: 'Include retired facts' },
      },
      additionalProperties: false,
    },
    resultSchema: {
      type: 'object',
      properties: {
        entries: { type: 'array', items: KEYED_ENTRY_SCHEMA },
        count: { type: 'number', description: 'Entries in this page' },
        total: { type: 'number', description: 'Entries matching overall' },
        nextCursor: { type: 'string', description: 'Present when more pages remain' },
        types: TYPES_AFFORDANCE_SCHEMA,
      },
    },
  },
  {
    name: 'read',
    description:
      "One read, by candidate source (ADR-0071): `source` ∈ slice (the assembled view; = recall) · store (type/tag/prefix/contains; = query) · vector (semantic, salience-aware — the fixed form of the deprecated `search`) · key (= peek) · changes (the trajectory). Inferred from the args when omitted. `context:'refs'` folds each result's one-hop neighbourhood (refs tier — key/rel/dir/type, no values) into `_context` — perception with a periphery. Defaults resolve through the principal (ADR-0074, live): a posture adopted via auth.adoptGoal (a `goal/<id>` fact or free text, + lens/salience) conditions every read — ranking only, never membership — and your per-call args always win. Check `whoami` for your active posture.",
    scope: null,
    kind: 'read',
    inputSchema: {
      type: 'object',
      properties: {
        source: { type: 'string', enum: ['slice', 'store', 'vector', 'key', 'changes'], description: 'Candidate source (inferred from args when omitted)' },
        context: { type: 'string', enum: ['none', 'refs'], description: "Secondary context: 'refs' attaches each result's elided one-hop neighbourhood as `_context`" },
        contextLimit: { type: 'number', description: 'Cap on _context refs per entry (default 8, max 24)' },
        key: { type: 'string', description: 'source:key — the fact to read (peek preset)' },
        owner: { type: 'string', description: 'source:key — read-through owner (grant required)' },
        text: { type: 'string', description: 'Semantic intent (vector source alone; hybrid with store filters)' },
        type: { type: 'string' },
        tag: { type: 'string' },
        prefix: { type: 'string' },
        contains: { type: 'string' },
        rankBy: { type: 'string', enum: ['salience', 'recency', 'relevance'] },
        limit: { type: 'number' },
        cursor: { type: 'string' },
        view: { type: 'string', enum: ['overview', 'full'], description: 'source:slice — overview (default) or the full shaped view' },
        elision: { type: 'string', enum: ['auto', 'none'] },
        expand: { type: 'array', items: { type: 'string' } },
        lens: { type: 'string', enum: ['salience', 'recent', 'connected', 'durable', 'active'] },
        salience: { type: 'object', description: 'Per-call salience override (merges over lens + principal + config + defaults)' },
        explain: { type: 'boolean' },
        shape: SHAPE_SCHEMA,
        sinceSeq: { description: 'source:changes — tail from this seq (or "head")' },
        last: { type: 'number', description: 'source:changes — the newest n events' },
        include: { type: 'string', enum: ['events', 'entries'] },
        includeSuperseded: { type: 'boolean' },
      },
      additionalProperties: false,
    },
    resultSchema: { type: 'object', description: "Per source: the preset's envelope (recall overview/full · query projection · peek entry · changes feed), each entry optionally carrying `_context` refs when requested." },
  },
  {
    name: 'search',
    description:
      'DEPRECATED alias (ADR-0051) — prefer `query({ text })`, which matches the same candidates by meaning but ranks salience-aware and composes with type/tag/prefix filters. This older surface ranks by raw cosine only (salience-blind): embeds your text, ranks by similarity across your slice + everything shared with you, then re-reads each hit authoritatively. If the deployment has no vector backend, returns empty with a `hint`.',
    scope: null,
    scopeFamily: 'read:type:*',
    kind: 'read',
    inputSchema: {
      type: 'object',
      properties: {
        text: { type: 'string', description: 'Natural-language query, matched by meaning' },
        type: { type: 'string', description: 'Only facts of this type (also the granular read:type pin)' },
        tag: { type: 'string', description: 'Only facts carrying this (primary) tag' },
        limit: { type: 'number', description: 'Max results (1–50, default 10)' },
      },
      required: ['text'],
      additionalProperties: false,
    },
    resultSchema: {
      type: 'object',
      properties: {
        entries: {
          type: 'array',
          description: 'Ranked hits — { key, value, _meta, score } where score is cosine similarity (1 = closest)',
          items: { type: 'object', properties: { key: { type: 'string' }, value: {}, _meta: META_SCHEMA, score: { type: 'number' } } },
        },
        count: { type: 'number' },
        total: { type: 'number' },
        types: TYPES_AFFORDANCE_SCHEMA,
        hint: { type: 'string', description: 'Present only when semantic search is not configured (degraded to query/contains)' },
      },
    },
  },
  {
    name: 'link',
    description:
      'Add a typed, directed edge `from --rel--> to` between two fact keys in your slice (e.g. rel: "grounds", "refines", "relates"). The result carries `fromExists`/`toExists` hints — a dangling edge is allowed, but you learn at write time, not at the next tending pass.',
    scope: null,
    kind: 'act',
    inputSchema: {
      type: 'object',
      properties: {
        from: { type: 'string', description: 'Source fact key' },
        rel: { type: 'string', description: 'Edge type (a verb, e.g. "grounds")' },
        to: { type: 'string', description: 'Target fact key' },
        strength: { type: 'number', description: 'Optional edge strength' },
      },
      required: ['from', 'rel', 'to'],
      additionalProperties: false,
    },
    resultSchema: {
      ...EDGE_SCHEMA,
      properties: {
        ...EDGE_SCHEMA.properties,
        fromExists: { type: 'boolean', description: 'from resolves to a live fact' },
        toExists: { type: 'boolean', description: 'to resolves to a live fact' },
      },
    },
  },
  {
    name: 'suggestions',
    description:
      'List ratification candidates (ADR-0032): the inferred `similarTo` kinship the vector index proposed but no authored edge yet connects — "a link you might want". Each is an unordered pair (reciprocals collapse) with both endpoints\' type + a short label, ranked by cosine similarity (most relevant first). Pairs whose endpoints are BYTE-IDENTICAL (same content hash) carry `identical:true`; pairs mechanically derived from ONE SOURCE (sibling blocks of a doc, a block vs its own parent, a copy vs its original) carry `degenerate` — in both, the ~1.0 score is construction, not a relationship: dedupe/prune material, not connections to ratify. Pairs another participant is currently adjudicating carry `leasedBy`/`leasedUntil` (a live `lease/suggestion/<pairHash>`, ADR-0086) — skip those. `genuineOnly:true` drops all three classes server-side; `offset` pages the ranked list. High-volume runtime/machine facts (transcripts, agent-runs, cells) are filtered out by default — pass `includeRuntime:true` to see them. These already feed salience weakly (centrality); `ratify` promotes one to a typed, authored, full-weight edge. Returns the recommended relation `vocab`.',
    scope: null,
    kind: 'read',
    inputSchema: {
      type: 'object',
      properties: {
        limit: { type: 'number', description: 'Cap on candidates returned (default 25)' },
        offset: { type: 'number', description: 'Skip this many ranked candidates first (paging)' },
        includeRuntime: { type: 'boolean', description: 'Include runtime/machine facts (transcripts, agent-runs, cells) filtered out by default' },
        genuineOnly: { type: 'boolean', description: 'Only pairs worth judging: drop byte-identical pairs, same-source degeneracies, and pairs another participant holds a lease on' },
      },
      additionalProperties: false,
    },
    resultSchema: {
      type: 'object',
      properties: {
        suggestions: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              from: { type: 'string' },
              to: { type: 'string' },
              fromLabel: { type: 'string' },
              fromType: { type: 'string' },
              toLabel: { type: 'string' },
              toType: { type: 'string' },
              strength: { type: 'number' },
              createdAt: { type: 'string' },
              pairHash: { type: 'string', description: 'The pair\'s stable id — lease it before adjudicating: lease({domain:"suggestion", item: pairHash}) (ADR-0086)' },
              identical: { type: 'boolean', description: 'Endpoints share a content hash (byte-identical text) — prune, don\'t ratify' },
              degenerate: { type: 'string', enum: ['same-source', 'contains'], description: 'Mechanically derived from one source (sibling blocks of a doc; a block vs its own parent; a copy vs its original) — structure the graph already knows, not a connection to ratify' },
              leasedBy: { type: ['string', 'null'], description: 'A participant currently holds this pair (skip it — in-flight, ADR-0086)' },
              leasedUntil: { type: ['string', 'null'] },
            },
          },
        },
        vocab: { type: 'array', items: { type: 'string' }, description: 'Recommended relations to ratify into' },
        total: { type: 'number', description: 'Candidates before limit' },
      },
    },
  },
  {
    name: 'contested',
    description:
      "Contradiction-candidate read (ADR-0072, Stage A of the contested view): semantically-near pairs (inferred `similarTo` kinship ≥ minScore) that NO authored edge connects, sharing a type or tag, and not yet adjudicated. Each candidate carries a pair `hash` + both facts' content-hash `versions`. Adjudicate (any agent): verdict contradict → remember `contested/<hash>` {a,b,why} + link a --contradicts--> b; duplicate → consider supersede; subsumes → a refines edge; ALWAYS remember `checked/<hash>` {a,b,verdict,versions} — the idempotence marker; the pair re-surfaces only when either fact's version drifts. Semantic debt for the consolidation pass; the wiki's 'detect contradictions', made a standing read.",
    scope: null,
    kind: 'read',
    inputSchema: {
      type: 'object',
      properties: {
        limit: { type: 'number', description: 'Cap on candidates returned (1–50, default 10) — adjudication is metered' },
        minScore: { type: 'number', description: 'Cosine floor (default 0.5) — contradiction candidates should be close, not merely related' },
        includeRuntime: { type: 'boolean', description: 'Include format-clustered noise types. The noise set is slice-declared: `_config/suggestions` `{ noiseTypes?, admitTypes? }` over a built-in floor, plus any type whose `_types/<name>` decl carries `{operational:true}` — vocabulary, not hardcoding. Ephemeral facts (delete-timer rows: leases, presence) are excluded unconditionally.' },
      },
      additionalProperties: false,
    },
    resultSchema: {
      type: 'object',
      properties: {
        candidates: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              a: { type: 'string' },
              b: { type: 'string' },
              score: { type: 'number', description: 'Cosine similarity between the pair' },
              aLabel: { type: 'string' },
              bLabel: { type: 'string' },
              aType: { type: 'string' },
              bType: { type: 'string' },
              sharedTags: { type: 'array', items: { type: 'string' } },
              hash: { type: 'string', description: 'Unordered pair hash — the checked/<hash> and contested/<hash> key suffix, AND the lease item: lease({domain:"suggestion", item:hash}) before adjudicating in parallel' },
              versions: { type: 'object', description: "Both facts' current content-hash versions — echo onto the checked/<hash> marker" },
            },
          },
        },
        total: { type: 'number', description: 'Candidates before the limit cap' },
        checked: { type: 'number', description: 'Pairs skipped: already adjudicated and unchanged since' },
        degenerate: { type: 'number', description: 'Pairs skipped: mechanically degenerate (same-source/containment — cannot contradict)' },
        ephemeral: { type: 'number', description: 'Pairs skipped: an endpoint is ephemeral machinery (a delete-timer fact — lease/presence — live or lapsed-awaiting-TTL). Coordination exhaust, never a candidate' },
        hint: { type: 'string', description: 'How to write a verdict back (existing verbs only) + the parallel-lease recipe' },
      },
    },
  },
  {
    name: 'ratify',
    description:
      'Accept a suggested connection (ADR-0032): write a typed, directed, authored edge `from --rel--> to` (full weight — you assert it, not the machine) and drop the redundant inferred `similarTo` between the pair. `rel` should be one of refines/grounds/duplicates/contradicts/elaborates/relatesTo (any string accepted). The substrate-native way to graduate a machine hint into curated structure; pairs come from `suggestions`.',
    scope: null,
    kind: 'act',
    inputSchema: {
      type: 'object',
      properties: {
        from: { type: 'string', description: 'Source fact key' },
        to: { type: 'string', description: 'Target fact key' },
        rel: { type: 'string', description: 'Relation to assert (refines/grounds/duplicates/contradicts/elaborates/relatesTo)' },
        strength: { type: 'number', description: 'Optional edge strength (default full authored weight)' },
      },
      required: ['from', 'to', 'rel'],
      additionalProperties: false,
    },
    resultSchema: {
      type: 'object',
      properties: {
        edge: { ...EDGE_SCHEMA },
        dropped: { type: 'number', description: 'Inferred similarTo edges removed between the pair' },
        ratified: { type: 'boolean' },
      },
    },
  },
  {
    name: 'unlink',
    description: 'Remove an edge previously added with `link`.',
    scope: null,
    kind: 'act',
    inputSchema: {
      type: 'object',
      properties: {
        from: { type: 'string' },
        rel: { type: 'string' },
        to: { type: 'string' },
      },
      required: ['from', 'rel', 'to'],
      additionalProperties: false,
    },
    resultSchema: { type: 'object', properties: { ok: { type: 'boolean' } } },
  },
  // ── ADR-0069 (C3): the one edge query ───────────────────────────────────
  {
    name: 'edges',
    description:
      "One edge query over the Reference projection (ADR-0069) — the unified form of neighbors/links/graph/members. `around` = edges incident to a key (+ `dir`/`rel`; `membership:true` = that collection's members); no `around` = the whole projection, `derived:false` = authored only (+ `prefix`). Scope with `keys`/`rels`/`limit` (ADR-0048). Derived backbone edges carry `derived:true`. With `depth` ≥ 2 (ADR-0075): the DIRECTIONAL WALK — all transitive simple paths from `around` over AUTHORED edges, compound confidence = Π step strength, cycle-guarded, capped. This is the simulation read for causal rels (`causes · enables · predicts · prevents · contradicts` — a documented floor, not a closed set: any rel walks; confidence is the edge's `strength`, set at `link`).",
    scope: null,
    kind: 'read',
    inputSchema: {
      type: 'object',
      properties: {
        around: { type: 'string', description: 'Edges incident to this fact key (→ neighbours; with `membership` → its members; with `depth` → the walk root). Hydrated neighbour entries default to `card` (preview values) — pass `shape:"full"` for whole bodies.' },
        dir: { type: 'string', enum: ['in', 'out', 'both'], description: 'With `around` (one hop): direction (default both)' },
        rel: { type: 'string', description: 'Only edges of this rel type (for a walk: the rel family to follow, e.g. "enables")' },
        membership: { type: 'boolean', description: "With `around`: only membership edges pointing at it (the collection's members)" },
        derived: { type: 'boolean', description: 'Include derived backbone edges (default true); false = authored only' },
        prefix: { type: 'string', description: 'Authored-only: only edges whose from/to starts with this prefix' },
        keys: { type: 'array', items: { type: 'string' }, description: 'Only edges touching ANY of these keys (either end)' },
        rels: { type: 'array', items: { type: 'string' }, description: 'Only these rel types' },
        limit: { type: 'number', description: 'Cap returned edges; `total` still counts every match (0 = count only)' },
        depth: { type: 'number', description: 'ADR-0075: walk this many hops from `around` (2–6). 1/absent = one-hop framings' },
        direction: { type: 'string', enum: ['out', 'in'], description: "Walk direction: 'out' = downstream of the root (what X leads to), 'in' = upstream (what leads to X). Default out" },
        shape: SHAPE_SCHEMA,
      },
      additionalProperties: false,
    },
    resultSchema: { type: 'object', description: 'Per framing: `{ edges, total }` (projection / authored), `{ outbound, inbound, entries, types }` (around), the members result (membership), or `{ root, direction, depth, paths: [{nodes, steps, confidence}], total, truncated? }` (walk).' },
  },
  {
    name: 'neighbors',
    description: "DEPRECATED (ADR-0069) — prefer `edges({ around })`. The edges around a fact (outbound and/or inbound, optionally one rel) plus the neighbor entries — graph traversal, one hop. Includes the derived structural backbone (edges flagged `derived:true`): a fact `instanceOf` its `_types/<type>`, a type `managedBy` its cell and `rendersWith` its renderer, and a fact `inView` any view whose query selects it — so even an unlinked fact has a direction to explore.",
    scope: null,
    kind: 'read',
    inputSchema: {
      type: 'object',
      properties: {
        key: { type: 'string', description: 'The fact key to look around' },
        dir: { type: 'string', enum: ['in', 'out', 'both'], description: 'Direction (default both)' },
        rel: { type: 'string', description: 'Only edges of this type' },
        shape: SHAPE_SCHEMA,
      },
      required: ['key'],
      additionalProperties: false,
    },
    resultSchema: {
      type: 'object',
      properties: {
        outbound: { type: 'array', items: EDGE_SCHEMA },
        inbound: { type: 'array', items: EDGE_SCHEMA },
        entries: { type: 'object', description: 'neighbor key → { value, _meta } for neighbors that exist (card-shaped preview values by default; `shape:"full"` for whole bodies)', additionalProperties: ENTRY_SCHEMA },
        types: TYPES_AFFORDANCE_SCHEMA,
      },
    },
  },
  {
    name: 'links',
    description: 'DEPRECATED (ADR-0069) — prefer `edges({ derived: false })`. Every edge in your slice — boards and graph surfaces project their edges from this. Scope it (ADR-0048): `keys` = only edges touching those facts, `rels` = only those rel types, `prefix` = from/to key prefix, `limit` caps the list (`{limit: 0}` = just the `total` count). Bare calls return everything — prefer scoping.',
    scope: null,
    kind: 'read',
    inputSchema: {
      type: 'object',
      properties: {
        prefix: { type: 'string', description: 'Only edges whose from or to starts with this prefix' },
        keys: { type: 'array', items: { type: 'string' }, description: 'Only edges touching ANY of these keys (either end)' },
        rels: { type: 'array', items: { type: 'string' }, description: 'Only these rel types' },
        limit: { type: 'number', description: 'Cap the returned edges; `total` still counts every match (0 = count only)' },
      },
      additionalProperties: false,
    },
    resultSchema: { type: 'object', properties: { edges: { type: 'array', items: EDGE_SCHEMA }, total: { type: 'number', description: 'matches before the limit cap' } } },
  },
  {
    name: 'graph',
    description:
      "DEPRECATED (ADR-0069) — prefer `edges({ derived: true })`. The full Reference projection (also `read(\"$graph\")`): authored edges plus the derived rule edges — the structural backbone (instanceOf/managedBy/rendersWith/inView), embedded `ref` fields (e.g. a claim's `support`), and key-encoded membership (e.g. `_doc/<doc>/<block>` → inDoc). Derived edges carry `derived:true`. The graph half of the self-model beside `$catalog` (capabilities) and `$types` (vocabulary).",
    scope: null,
    kind: 'read',
    inputSchema: {
      type: 'object',
      properties: {
        keys: { type: 'array', items: { type: 'string' }, description: 'Only edges touching ANY of these keys (either end) — "the edges around these facts" instead of the whole projection (ADR-0048)' },
        rels: { type: 'array', items: { type: 'string' }, description: 'Only these rel types' },
        limit: { type: 'number', description: 'Cap the returned edges; `total` still counts every match (0 = count only)' },
      },
      additionalProperties: false,
    },
    resultSchema: { type: 'object', properties: { edges: { type: 'array', items: EDGE_SCHEMA }, total: { type: 'number', description: 'matches before the limit cap' } } },
  },
  {
    name: 'members',
    description:
      "DEPRECATED (ADR-0069) — prefer `edges({ around, membership: true })`. A collection's member facts (ADR-0005). **Intensional** when the fact carries a `query` (a view) — its query is evaluated (`order:\"query\"`); **extensional** otherwise — the facts with an inbound membership edge (`inView`/`inDoc`) in the Reference projection (e.g. a doc's blocks). Extensional members come back in **narrative order** when placed by an ordering decoration (a doc-order `seq` → `order:\"seq\"`), else salience-ranked (`order:\"salience\"`). One read for 'a view's facts' and 'a doc's members' alike.",
    scope: null,
    kind: 'read',
    inputSchema: {
      type: 'object',
      properties: { key: { type: 'string', description: 'The collection fact key (a view, a doc, …)' }, shape: SHAPE_SCHEMA },
      required: ['key'],
      additionalProperties: false,
    },
    resultSchema: {
      type: 'object',
      properties: {
        key: { type: 'string' },
        membership: { type: 'string', enum: ['intensional', 'extensional'] },
        order: { type: 'string', enum: ['seq', 'salience', 'query'], description: 'how members are ordered: narrative seq, salience rank, or the view query' },
        members: { type: 'array', items: ENTRY_SCHEMA, description: 'member facts (key + value + _meta); extensional members also carry `placement` {seq, fold} from their ordering decoration' },
        types: TYPES_AFFORDANCE_SCHEMA,
      },
    },
  },
  {
    name: 'changes',
    description:
      'Tail your slice’s trajectory: events (write/read/supersede/link/unlink) after `sinceSeq`, plus the current head seq to resume from. Pass sinceSeq:"head" to get just the head seq and start tailing in one call. `last: n` returns the NEWEST n (ascending) — the "recent activity" read; a bare call defaults to `last: 200` (ADR-0048) instead of the whole trajectory. `scope` (ADR-0055) filters server-side by key prefixes and/or ops, so a surface pays only for its slice; link/unlink events carry `rel`/`to` endpoints and match a prefix on either end.',
    scope: null,
    kind: 'read',
    inputSchema: {
      type: 'object',
      properties: {
        sinceSeq: {
          description: 'Return events with seq greater than this number (default 0), or "head" for no events + the current head seq',
          oneOf: [{ type: 'number' }, { type: 'string', enum: ['head'] }],
        },
        limit: { type: 'number', description: 'Max events, paged FORWARD from sinceSeq (tailing)' },
        last: { type: 'number', description: 'The NEWEST n events, ascending — recent activity (bare calls default to 200)' },
        scope: {
          type: 'object',
          description: 'Server-side slice (ADR-0055): only matching events ship; filtering precedes limit/last windowing and the head seq stays global (an empty page with an advanced seq is progress)',
          properties: {
            prefixes: { type: 'array', items: { type: 'string' }, description: 'Key prefixes, e.g. ["el:", "_canvas/parcland/"]; link/unlink match on key (from) OR to' },
            ops: { type: 'array', items: { type: 'string', enum: ['read', 'write', 'supersede', 'link', 'unlink'] }, description: 'Only these ops, e.g. ["write","supersede"]' },
          },
          additionalProperties: false,
        },
        include: {
          type: 'string',
          enum: ['events', 'entries'],
          description:
            '"entries" inlines the CURRENT card-shaped entry per written/superseded key on the page (touch-free — never inflates salience), replacing a follow-up fetch per event; null = gone, _meta.superseded = tombstone',
        },
      },
      additionalProperties: false,
    },
    resultSchema: {
      type: 'object',
      properties: {
        events: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              op: { type: 'string' },
              key: { type: ['string', 'null'] },
              rel: { type: 'string', description: 'link/unlink only: the edge relation' },
              to: { type: 'string', description: 'link/unlink only: the edge target (key is the source)' },
              at: { type: 'string' },
              seq: { type: 'number' },
            },
          },
        },
        seq: { type: 'number', description: 'Current head — resume from here' },
        entries: {
          type: 'object',
          description: 'Only with include:"entries": key → current card-shaped entry (null = gone; _meta.superseded = tombstone)',
        },
      },
    },
  },
  {
    name: 'attention',
    description:
      'What needs tending, as a derived read: stale facts (old AND unearned — settled knowledge with authored structure or standing is counted separately, not flagged), unlinked facts (no authored edge, embedded-ref edge, or placement membership — inferred `similarTo` and the pure type backbone never count), and dangling edges. The arrays are illustrative SAMPLES capped at `limit` (default 8); the `*Total` fields are the real counts — read those for magnitude, pass a larger `limit` for the fuller list. `_`-prefixed system namespaces are excluded unless includeSystem. The just-in-time cron — read it at session start and act on what surfaces.',
    scope: null,
    kind: 'read',
    inputSchema: {
      type: 'object',
      properties: {
        staleMs: { type: 'number', description: 'Staleness threshold in ms (default 14 days)' },
        limit: { type: 'number', description: 'Max SAMPLE items per category (default 8) — the `*Total` fields still report the uncapped counts' },
        includeSystem: { type: 'boolean', description: 'Also surface `_`-prefixed system namespaces (default false)' },
        settledStanding: { type: 'number', description: 'Standing at/above which an old fact is settled, not stale (default 0.25)' },
      },
      additionalProperties: false,
    },
    resultSchema: {
      type: 'object',
      properties: {
        stale: { type: 'array', items: { type: 'object', properties: { key: { type: 'string' }, updatedAt: { type: 'string' }, type: { type: ['string', 'null'] } } } },
        unlinked: { type: 'array', items: { type: 'string' } },
        dangling: { type: 'array', items: { type: 'object', properties: { from: { type: 'string' }, rel: { type: 'string' }, to: { type: 'string' }, reason: { type: 'string' } } } },
        staleTotal: { type: 'number', description: 'Uncapped count of stale (old + unearned) facts' },
        unlinkedTotal: { type: 'number', description: 'Uncapped count of unlinked facts' },
        danglingTotal: { type: 'number', description: 'Uncapped count of dangling edge endpoints' },
        settled: { type: 'number', description: 'Old facts recognised as settled and not flagged' },
      },
    },
  },
  {
    name: 'registerAction',
    description:
      'DEPRECATED (ADR-0068) — prefer `declare({ kind: "action", def })`. Declare a no-code action: `{ id, if?, enabled?, writes[], params? }` stored as a fact at `_actions/<id>` and applied by the substrate when invoked. Writes are declared (bounded, auditable); competing write targets are surfaced, not blocked. Templates support ${params.x}/${self}/${now}; per-write ifAbsent + timer expresses an atomic lease (time-bounded exclusivity — a "claim" in this substrate is an epistemic assertion, ADR-0086).',
    scope: null,
    kind: 'act',
    inputSchema: {
      type: 'object',
      properties: {
        action: {
          type: 'object',
          description: 'The action definition',
          properties: {
            id: { type: 'string' },
            description: { type: 'string' },
            if: { type: 'array', description: 'Preconditions (AND): [{ key, path?, op: exists|absent|eq|ne|gt|lt, value? }]', items: { type: 'object' } },
            enabled: { type: 'array', description: 'Availability conditions (same shape as if)', items: { type: 'object' } },
            writes: {
              type: 'array',
              description: 'Declared writes: [{ key, value?, ifAbsent?, ifVersion?, timer?, type?, tags? }]. ifVersion is proof-of-read CAS (a content hash, "" = create-only); supports ${params.*} so the caller can pass a token they read.',
              items: { type: 'object' },
            },
            params: { type: 'object', description: 'Param schema: { <name>: { type?, description?, enum?, required? } }' },
          },
          required: ['id', 'writes'],
        },
      },
      required: ['action'],
      additionalProperties: false,
    },
    resultSchema: {
      type: 'object',
      properties: {
        action: { type: 'object', description: 'The registered definition, echoed' },
        contested: { type: 'array', description: 'Other actions declaring writes to the same keys (surfaced, not blocked)' },
      },
    },
  },
  {
    name: 'actions',
    description: 'List the declared actions in your slice (the registered no-code vocabulary).',
    scope: null,
    kind: 'read',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    resultSchema: { type: 'object', properties: { actions: { type: 'array', items: { type: 'object', description: 'Action definitions' } } } },
  },
  {
    name: 'deleteAction',
    description: 'Retire a declared action (supersedes its `_actions/<id>` fact).',
    scope: null,
    kind: 'act',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'string' } },
      required: ['id'],
      additionalProperties: false,
    },
    resultSchema: { type: 'object', properties: { ok: { type: 'boolean' } } },
  },
  {
    name: 'invoke',
    description:
      'DEPRECATED (ADR-0068) — prefer `evaluate({ kind: "action", id, params })`. Invoke a declared action by id with params. Checks enabled + if conditions (a failed precondition is a 409-style error), then applies the declared writes with substitution. The substrate interprets; no code runs.',
    scope: null,
    kind: 'act',
    inputSchema: {
      type: 'object',
      properties: {
        action: { type: 'string', description: 'The action id' },
        params: { type: 'object', description: 'Arguments for the action' },
      },
      required: ['action'],
      additionalProperties: false,
    },
    resultSchema: {
      type: 'object',
      properties: {
        invoked: { type: 'boolean' },
        action: { type: 'string' },
        params: { type: 'object' },
        writes: { type: 'array', description: 'The applied writes, each `{ key, value, _meta }`', items: KEYED_ENTRY_SCHEMA },
      },
    },
  },
  {
    name: 'reindex',
    description:
      'Backfill semantic search (ADR-0030/0031): scan your slice (optionally by type/prefix), embed each text-bearing fact into your vector index, then wire inferred `similarTo` edges. Runs ASYNC + CHUNKED — a full slice far exceeds the sync request budget, so this dispatches and returns immediately; poll the `_reindex/<you>` status fact for { status: running|done, phase: embed|edges, indexed, edges }. The batch replay beside the live stream indexer; use after enabling search or changing the embedding model. Admin-only.',
    scope: 'workspace:admin',
    kind: 'act',
    inputSchema: {
      type: 'object',
      properties: {
        type: { type: 'string', description: 'Only reindex facts of this type' },
        prefix: { type: 'string', description: 'Only reindex keys with this prefix' },
        max: { type: 'number', description: 'Optional cap on facts processed in the embed phase' },
      },
      additionalProperties: false,
    },
    resultSchema: {
      type: 'object',
      properties: {
        status: { type: 'string', description: "'started' (async dispatched), or 'unconfigured'" },
        poll: { type: 'string', description: 'Status fact key to peek for progress' },
        hint: { type: 'string' },
      },
    },
  },
  {
    name: 'project',
    description:
      'Compute the 2D SEMANTIC layout (ADR-0047 stage 2): read every vector in your slice index and project it (PCA) to a plane, so a fact\'s position becomes its place in meaning-space rather than a force-of-edges equilibrium. Writes the coords to `_home/embed2d` (peek it; the home graph places nodes from it). Synchronous — projection is cheap (no per-fact embedding; the index is already built). Run after `reindex` (it needs the vectors present) and re-run to refresh as the slice drifts. Admin-only.',
    scope: 'workspace:admin',
    kind: 'act',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    resultSchema: {
      type: 'object',
      properties: {
        status: { type: 'string', description: "'ok', 'empty' (too few vectors), or 'unconfigured'" },
        count: { type: 'number', description: 'Facts projected' },
        method: { type: 'string', description: 'Projection method (pca)' },
        key: { type: 'string', description: 'The fact the layout was written to' },
        hint: { type: 'string' },
      },
    },
  },
  {
    name: 'pruneSimilar',
    description:
      'Prune redundant inferred `similarTo` edges (ADR-0031/0032): delete every `platform/vectors`-written kinship edge whose endpoints are ALREADY connected by an authored edge (in either direction) — a real link a person/grant asserted makes the machine-inferred hint redundant, both as structure and as a salience signal. Synchronous, vector-free (pure edge scan + deletes). The live indexer/reindex now skip these on create (dedup-on-create); this is the one-time backfill for edges written before that. Admin-only.',
    scope: 'workspace:admin',
    kind: 'act',
    inputSchema: {
      type: 'object',
      properties: {
        max: { type: 'number', description: 'Cap on edges deleted in one pass (default: all redundant)' },
      },
      additionalProperties: false,
    },
    resultSchema: {
      type: 'object',
      properties: {
        status: { type: 'string', description: "'pruned' or 'unconfigured'" },
        scanned: { type: 'number', description: 'Inferred similarTo edges examined' },
        pruned: { type: 'number', description: 'Redundant edges deleted' },
        remaining: { type: 'number', description: 'Redundant edges left (when capped by max)' },
      },
    },
  },
  {
    name: 'tend',
    description:
      'Run a tending pass now: attention() distilled into a `tending/latest` audit fact (uncapped stale / unlinked / dangling / settled counts, samples, and a `delta` vs the prior audit — a zero delta over a non-zero backlog is chronic debt) — the just-in-time cron made manual. A daily schedule writes the same report.',
    scope: 'workspace:admin',
    kind: 'act',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    resultSchema: {
      type: 'object',
      description: 'The tending report (also written to `tending/latest`)',
      properties: {
        at: { type: 'string' },
        scope: { type: 'string' },
        stale: { type: 'number' },
        unlinked: { type: 'number' },
        dangling: { type: 'number' },
        staleSample: { type: 'array' },
        unlinkedSample: { type: 'array' },
        danglingSample: { type: 'array' },
      },
    },
  },
  {
    name: 'registerView',
    description:
      'DEPRECATED (ADR-0068) — prefer `declare({ kind: "view", def })`. Register a named view: `{ id, query, reduce?, path?, render? }` stored as a fact at `_views/<id>`. A view is a stored projection (the query primitive as data) with an optional reduction (list|count|latest|sum) and a render hint — the same declaration is a dashboard surface for humans and an affordance for agents.',
    scope: null,
    kind: 'act',
    inputSchema: {
      type: 'object',
      properties: {
        view: {
          type: 'object',
          description: 'The view definition',
          properties: {
            id: { type: 'string' },
            description: { type: 'string' },
            query: { type: 'object', description: 'Query options: { type?, tag?, prefix?, rankBy?, limit?, includeSuperseded? }' },
            reduce: { type: 'string', enum: ['list', 'count', 'latest', 'sum'] },
            path: { type: 'string', description: 'Dot-path into each value, for sum' },
            render: { type: 'object', description: 'Render hint: { type: metric|table|feed|list|markdown, label?, ... }' },
          },
          required: ['id', 'query'],
        },
      },
      required: ['view'],
      additionalProperties: false,
    },
    resultSchema: { type: 'object', description: 'The registered view definition, echoed' },
  },
  {
    name: 'views',
    description: 'List the registered views in your slice.',
    scope: null,
    kind: 'read',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    resultSchema: { type: 'object', properties: { views: { type: 'array', items: { type: 'object', description: 'View definitions' } } } },
  },
  {
    name: 'view',
    description: 'DEPRECATED (ADR-0068) — prefer `evaluate({ kind: "view", id })`. Evaluate a registered view against the current slice — returns its value, count, and render hint.',
    scope: null,
    kind: 'read',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'string', description: 'The view id' } },
      required: ['id'],
      additionalProperties: false,
    },
    resultSchema: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        description: { type: 'string' },
        render: { type: ['object', 'null'], description: 'The render hint' },
        value: { description: 'The evaluated value, per the view’s reduce' },
        count: { type: 'number' },
      },
    },
  },
  {
    name: 'deleteView',
    description: 'Retire a registered view (supersedes its `_views/<id>` fact).',
    scope: null,
    kind: 'act',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'string' } },
      required: ['id'],
      additionalProperties: false,
    },
    resultSchema: { type: 'object', properties: { ok: { type: 'boolean' } } },
  },
  {
    name: 'registerSubscription',
    description:
      'DEPRECATED (ADR-0068) — prefer `declare({ kind: "subscription", def })`. Register a reaction: `{ id, match:{type?,keyPrefix?,cel?}, invoke|deliver, params?, maxDepth? }` stored as a fact at `_subscriptions/<id>`. When a fact write matches `match`, the reactor fires — either `invoke` (a declared action id, in-process) or `deliver` (a cell tool "@owner/name.tool", called AS you, for reactions that need a cell, e.g. a model deciding an agent rail) — with `params` templated from the event (${key} ${keySuffix} ${scope} ${value.<path>}). The generic primitive behind reactive machines — a tier-2 cell makes a process reactive by registering subscriptions, no platform change needed.',
    scope: null,
    kind: 'act',
    inputSchema: {
      type: 'object',
      properties: {
        subscription: {
          type: 'object',
          description: 'The subscription definition',
          properties: {
            id: { type: 'string' },
            match: { type: 'object', description: 'Predicate over the changed fact: { type?, keyPrefix?, cel? }' },
            invoke: { type: 'string', description: 'Declared action id to invoke when matched (exactly one of invoke/deliver)' },
            deliver: { type: 'string', description: 'Cell tool address "@owner/name.tool" to call as the slice owner (exactly one of invoke/deliver)' },
            params: { type: 'object', description: 'Arg templates over the event: { name: "${keySuffix}" | "${value.x}" | … }' },
            maxDepth: { type: 'number', description: 'Loop bound: skip when the triggering fact revision exceeds this (default 50)' },
            label: { type: 'string' },
          },
          required: ['id', 'match'],
        },
      },
      required: ['subscription'],
      additionalProperties: false,
    },
    resultSchema: { type: 'object', description: 'The registered subscription definition, echoed' },
  },
  {
    name: 'subscriptions',
    description: 'List the reaction subscriptions in your slice.',
    scope: null,
    kind: 'read',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    resultSchema: { type: 'object', properties: { subscriptions: { type: 'array', items: { type: 'object', description: 'Subscription definitions' } } } },
  },
  {
    name: 'deleteSubscription',
    description: 'Retire a reaction subscription (supersedes its `_subscriptions/<id>` fact).',
    scope: null,
    kind: 'act',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'string' } },
      required: ['id'],
      additionalProperties: false,
    },
    resultSchema: { type: 'object', properties: { ok: { type: 'boolean' } } },
  },
  // ── ADR-0068 (C1): the one declaration surface ──────────────────────────
  {
    name: 'declare',
    description:
      'Declare a no-code vocabulary entry of `kind` (action | view | subscription) — the one lifecycle behind registerAction/registerView/registerSubscription. `def` is that kind’s definition; storage is unified (ADR-0001), the kind’s meaning stays specific. Returns the registered def (for action: `{ action, contested }`).',
    scope: null,
    kind: 'act',
    inputSchema: {
      type: 'object',
      properties: {
        kind: { type: 'string', enum: ['action', 'view', 'subscription'], description: 'The declaration kind' },
        def: { type: 'object', description: 'The kind’s definition (an action/view/subscription object, as its register* verb takes)' },
      },
      required: ['kind', 'def'],
      additionalProperties: false,
    },
    resultSchema: { type: 'object', description: 'The registered definition (action → `{ action, contested }`; view/subscription → the def, echoed)' },
  },
  {
    name: 'declarations',
    description: 'List declared vocabulary. With `kind`, the entries of that kind (as actions/views/subscriptions do); without, the union across all three, each entry tagged with its `kind`.',
    scope: null,
    kind: 'read',
    inputSchema: {
      type: 'object',
      properties: { kind: { type: 'string', enum: ['action', 'view', 'subscription'], description: 'Optional: restrict to one kind' } },
      additionalProperties: false,
    },
    resultSchema: { type: 'object', properties: { declarations: { type: 'array', items: { type: 'object', description: 'Declaration definitions (tagged with `kind` when unfiltered)' } } } },
  },
  {
    name: 'undeclare',
    description: 'Retire a declared vocabulary entry of `kind` by id (supersedes its `_<kind>s/<id>` fact) — the one lifecycle behind deleteAction/deleteView/deleteSubscription.',
    scope: null,
    kind: 'act',
    inputSchema: {
      type: 'object',
      properties: {
        kind: { type: 'string', enum: ['action', 'view', 'subscription'], description: 'The declaration kind' },
        id: { type: 'string', description: 'The declaration id' },
      },
      required: ['kind', 'id'],
      additionalProperties: false,
    },
    resultSchema: { type: 'object', properties: { ok: { type: 'boolean' } } },
  },
  {
    name: 'evaluate',
    description:
      'Run a declared entry — the per-kind essence. `kind:"action"` invokes it (checks enabled+if, applies declared writes with substitution; = invoke); `kind:"view"` evaluates its query/reduce against the slice (= view). Subscriptions have no evaluate (they match in the reactor).',
    scope: null,
    kind: 'act',
    inputSchema: {
      type: 'object',
      properties: {
        kind: { type: 'string', enum: ['action', 'view'], description: 'action → invoke · view → evaluate' },
        id: { type: 'string', description: 'The declaration id' },
        params: { type: 'object', description: 'Arguments (actions only)' },
      },
      required: ['kind', 'id'],
      additionalProperties: false,
    },
    resultSchema: { type: 'object', description: 'For action: the invoke result `{ invoked, action, params, writes }`; for view: `{ id, value, count, render }`' },
  },
  {
    name: 'supersede',
    description:
      'Retire a fact (it stops surfacing in recall but is not deleted). Optionally point it at a successor key; `migrateLinks` carries its edges to the successor so the graph does not rot. Returns the retired fact, or null when the key never existed.',
    scope: null,
    kind: 'act',
    inputSchema: {
      type: 'object',
      properties: {
        key: { type: 'string', description: 'Fact key to retire' },
        by: { type: 'string', description: 'Optional successor key' },
        migrateLinks: { type: 'boolean', description: 'Re-point edges at the successor (requires `by`)' },
      },
      required: ['key'],
      additionalProperties: false,
    },
    resultSchema: { ...ENTRY_SCHEMA, description: 'The retired fact, or null when the key never existed' },
  },
  {
    name: 'lease',
    description:
      'Take a WORK LEASE on a contended item (ADR-0086): time-bounded exclusivity, atomically acquired (`lease/<domain>/<item>` written ifAbsent with a delete-at-expiry timer), so parallel participants do not double-work the same thing — e.g. `{domain:"suggestion", item:"<pairHash>"}` before adjudicating a proposal. A lease asserts nothing (that would be a claim — the epistemic word) and expires on its own: a crashed holder releases by silence. Returns `held:false` with the current holder when contended. Exclusivity is COOPERATIVE — the participant key never carries authority; provenance is the accountability.',
    scope: null,
    kind: 'act',
    inputSchema: {
      type: 'object',
      properties: {
        domain: { type: 'string', description: 'Contention domain, e.g. "suggestion", "run"' },
        item: { type: 'string', description: 'The item within it, e.g. a pair hash or run id' },
        minutes: { type: 'number', description: 'Lease duration (default 5, clamped 1–120). Must exceed honest work duration' },
        seconds: { type: 'number', description: 'Seconds alias for `minutes` (converted; `minutes` wins if both given)' },
        ttlSeconds: { type: 'number', description: 'Seconds alias for `minutes` (converted; `minutes` wins if both given)' },
        note: { type: 'string', description: 'Optional: what the holder intends' },
      },
      required: ['domain', 'item'],
      additionalProperties: false,
    },
    resultSchema: {
      type: 'object',
      properties: {
        held: { type: 'boolean' },
        key: { type: 'string' },
        holder: { type: ['string', 'null'], description: 'Your participant key/principal when held; the CURRENT holder when not' },
        expiresAt: { type: ['string', 'null'] },
        grantedMinutes: { type: 'number', description: 'Duration actually granted (shows the 1–120 clamp was applied)' },
      },
    },
  },
  {
    name: 'release',
    description:
      'Release a work lease early (expires the `lease/<domain>/<item>` fact now — a lapsed timer IS "released" in the vocabulary acquirers understand). Letting it lapse is equally valid — release is a courtesy to waiting participants. Releasing a lease another participant holds is permitted but noted in the result (cooperative exclusivity, ADR-0086).',
    scope: null,
    kind: 'act',
    inputSchema: {
      type: 'object',
      properties: {
        domain: { type: 'string' },
        item: { type: 'string' },
      },
      required: ['domain', 'item'],
      additionalProperties: false,
    },
    resultSchema: {
      type: 'object',
      properties: {
        released: { type: 'boolean' },
        key: { type: 'string' },
        reason: { type: 'string', description: 'Present when not released (e.g. no live lease)' },
        note: { type: 'string', description: "Present when you released another participant's lease" },
      },
    },
  },
  {
    name: 'share',
    description:
      'Grant access to a fact, a key prefix (`inbox/*`), or your whole slice (omit `key`). Share `to` a user, to `public` (the universal audience — anyone, including unauthenticated readers; read-only), or to `group:<name>` (a named audience you define with `workspace.group`). mode "read" (default) makes it appear in their recall; mode "write" additionally lets them remember into the covered keys of your slice (write-through — their identity is stamped as the writer).',
    scope: null,
    kind: 'act',
    inputSchema: {
      type: 'object',
      properties: {
        to: { type: 'string', description: 'A username, "public" (anyone), or "group:<name>" (a named audience)' },
        key: { type: 'string', description: 'A fact key, a prefix ending in `*` (e.g. "inbox/*"), or omit for your whole slice' },
        mode: { type: 'string', enum: ['read', 'write'], description: 'read (default) = visibility; write = write-through too (not allowed for public)' },
      },
      required: ['to'],
      additionalProperties: false,
    },
    resultSchema: {
      type: 'object',
      properties: { owner: { type: 'string' }, grantee: { type: 'string' }, key: { type: 'string', description: '"*" = whole slice' }, mode: { type: 'string' }, createdAt: { type: 'string' } },
    },
  },
  {
    name: 'unshare',
    description: 'Revoke a share previously made with `share`.',
    scope: null,
    kind: 'act',
    inputSchema: {
      type: 'object',
      properties: {
        to: { type: 'string', description: 'The user to revoke' },
        key: { type: 'string', description: 'The fact key, or omit for the whole-slice share' },
      },
      required: ['to'],
      additionalProperties: false,
    },
    resultSchema: { type: 'object', properties: { ok: { type: 'boolean' } } },
  },
  {
    name: 'shared',
    description: 'List what you have shared with others and what others have shared with you (each grant: owner, grantee, key pattern, mode).',
    scope: null,
    kind: 'read',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    resultSchema: {
      type: 'object',
      properties: {
        shared: { type: 'array', description: 'Grants you have made' },
        receiving: { type: 'array', description: 'Grants made to you' },
      },
    },
  },
  {
    name: 'grants',
    description:
      'The authority self-model (also `read("$grants")`): *what you may see and do*, resolving the three enforcement layers into one surface — `scope` (token: active + ceiling), `slice` (your own partition, full authority), and `grant` (the subsets you `shared`/`receiving` + the `groups` you belong to or define). The authority surface beside `$catalog` (capabilities), `$types` (vocabulary), and `$graph` (references). Inspect-only — it reports authority, it does not change it.',
    scope: null,
    kind: 'read',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    resultSchema: {
      type: 'object',
      properties: {
        principal: { type: 'string' },
        scope: { type: 'object', description: '{ active: enforced now, ceiling: the grant max }' },
        slice: { type: 'string', description: 'Your own slice — full authority' },
        grant: { type: 'object', description: '{ shared[], receiving[], groups[] }' },
        hint: { type: 'string' },
      },
    },
  },
  {
    name: 'group',
    description:
      'Define or patch a named audience (a group of principals) you can then `share` to with `to: "group:<name>"`. Pass `members` to set the membership wholesale, or `add`/`remove` to patch it. The group is stored as a `_groups/<name>` fact in your slice; recall resolves group shares for members without scanning. You are always implicitly in your own audiences.',
    scope: null,
    kind: 'act',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'The audience handle (bare name)' },
        members: { type: 'array', items: { type: 'string' }, description: 'Replace the membership with exactly these principals' },
        add: { type: 'array', items: { type: 'string' }, description: 'Add these principals' },
        remove: { type: 'array', items: { type: 'string' }, description: 'Remove these principals' },
        label: { type: 'string' },
        note: { type: 'string' },
      },
      required: ['name'],
      additionalProperties: false,
    },
    resultSchema: {
      type: 'object',
      properties: {
        name: { type: 'string' },
        members: { type: 'array', items: { type: 'string' } },
        label: { type: 'string' },
        note: { type: 'string' },
      },
    },
  },
  {
    name: 'groups',
    description: 'List the named audiences you have defined, each with its current membership.',
    scope: null,
    kind: 'read',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    resultSchema: {
      type: 'object',
      properties: { groups: { type: 'array', description: 'Your audiences: { name, members[], label?, note? }' } },
    },
  },
  {
    name: 'requestGrant',
    description:
      'Ask a resource owner for access you were denied. The request lands as a fact in the owner\'s slice (provenance-stamped as you), surfaces in their grantRequests inbox, and the outcome is written back into your slice under `_grants/answers/`. Resources use the scope grammar: "workspace:<owner>:<keyPattern>:<read|write>" or "cell:<owner>/<name>:<tool|*>".',
    scope: null,
    kind: 'act',
    inputSchema: {
      type: 'object',
      properties: {
        resource: { type: 'string', description: 'e.g. "workspace:alice:inbox/*:write" or "cell:alice/regwatch:save_prompt"' },
        note: { type: 'string', description: `Why you need it (≤${NOTE_MAX} chars)` },
      },
      required: ['resource'],
      additionalProperties: false,
    },
    resultSchema: {
      type: 'object',
      properties: {
        requested: { type: 'boolean' },
        owner: { type: 'string' },
        resource: { type: 'string' },
        key: { type: 'string', description: "The request fact key in the owner's slice" },
      },
    },
  },
  {
    name: 'grantRequests',
    description:
      'Your grant inbox: pending requests on resources you own (resolve with approveGrant/denyGrant), plus the outcomes of requests you made (answers land in your slice when the owner resolves).',
    scope: null,
    kind: 'read',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    resultSchema: {
      type: 'object',
      properties: {
        incoming: {
          type: 'array',
          description: 'Pending requests: [{ key, requester, resource, note?, requestedAt }]',
        },
        answers: {
          type: 'array',
          description: 'Outcomes of your requests: [{ key, resource, status, by, at, reason? }]',
        },
      },
    },
  },
  {
    name: 'approveGrant',
    description:
      'Approve a pending grant request (by its fact key from grantRequests): applies the grant — workspace resources via share, cell resources via cells.grant — then resolves the request and notifies the requester.',
    scope: null,
    kind: 'act',
    inputSchema: {
      type: 'object',
      properties: { key: { type: 'string', description: 'The request fact key' } },
      required: ['key'],
      additionalProperties: false,
    },
    resultSchema: {
      type: 'object',
      properties: { approved: { type: 'boolean' }, resource: { type: 'string' }, grantee: { type: 'string' } },
    },
  },
  {
    name: 'denyGrant',
    description: 'Deny a pending grant request (by its fact key), optionally with a reason the requester will see.',
    scope: null,
    kind: 'act',
    inputSchema: {
      type: 'object',
      properties: {
        key: { type: 'string', description: 'The request fact key' },
        reason: { type: 'string', description: `Optional reason (≤${NOTE_MAX} chars)` },
      },
      required: ['key'],
      additionalProperties: false,
    },
    resultSchema: {
      type: 'object',
      properties: { denied: { type: 'boolean' }, resource: { type: 'string' }, grantee: { type: 'string' } },
    },
  },
  {
    name: 'athena',
    description:
      'Run a read-only SQL query over the substrate analytics lake (docs/substrate-analytics.md) and return rows. The `substrate_<env>.facts` table is the whole substrate’s change history as columns (scope/key/type/tags/revision/writer/…) plus the fact body as `value_json` (use json_extract). ADMIN ONLY (platform:*): it reads across every scope, so it is gated until the lake is partitioned per-slice. Read-only — WITH/SELECT/SHOW/DESCRIBE/EXPLAIN, single statement.',
    scope: 'platform:*',
    kind: 'read',
    inputSchema: {
      type: 'object',
      properties: {
        sql: { type: 'string', description: 'A single read-only statement (WITH/SELECT/SHOW/DESCRIBE/EXPLAIN). Constrain `dt` to prune scan cost.' },
        maxRows: { type: 'number', description: 'Row cap 1–1000 (default 100)' },
      },
      required: ['sql'],
      additionalProperties: false,
    },
    resultSchema: {
      type: 'object',
      properties: {
        columns: { type: 'array', items: { type: 'string' } },
        rows: { type: 'array', items: { type: 'object' } },
        rowCount: { type: 'number' },
        scannedBytes: { type: 'number' },
        queryExecutionId: { type: 'string' },
      },
    },
  },
];
