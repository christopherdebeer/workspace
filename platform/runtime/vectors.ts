/**
 * Vectors (ADR-0030) — the semantic-search substrate seam.
 *
 * Two pure interfaces — `Embedder` (text → vector) and `VectorStore` (k-NN index)
 * — plus the addressing/extraction helpers shared by the indexer and `workspace.query({text})` semantic reads.
 * The point of the seam is reversibility (ADR-0030 §2a): the production backend is
 * S3 Vectors + Bedrock Titan, but the contract is small enough that an in-memory
 * brute-force store + a deterministic hashing embedder satisfy it for tests and for a
 * no-external-prereq deploy. Swapping backends is a wiring change, never a rewrite.
 *
 * Crucially, a vector index is an *index, not an authority* (ADR-0030 Decision 1):
 * it yields candidate keys; the caller re-reads each authoritatively (scope + grant +
 * timer + supersession) before returning it. So nothing here makes an access decision.
 */

/** A dense embedding. Plain numbers — the store/embedder agree on dimension. */
export type Vector = number[];

/** Filterable metadata kept beside a vector (S3 Vectors `metadata` doc). Primitives
 *  only, so it maps cleanly onto the index's filterable-metadata budget. */
export type VectorMetadata = Record<string, string | number | boolean>;

export interface VectorRecord {
  key: string;
  vector: Vector;
  metadata?: VectorMetadata;
}

/** Equality predicate over metadata (subset of the S3 Vectors filter doc): a record
 *  matches when every listed key equals the record's metadata value. */
export type VectorFilter = Record<string, string | number | boolean>;

export interface VectorMatch {
  key: string;
  /** Cosine similarity in [-1, 1] (1 = identical) — the ranking signal. */
  score: number;
  /** The distance metric value the store reported (1 - score for cosine). */
  distance: number;
  metadata?: VectorMetadata;
}

/** A k-NN vector index. Indexes are created at runtime, create-if-absent (ADR-0030
 *  §3a — the data plane, like cells), so `ensureIndex` is idempotent. */
export interface VectorStore {
  ensureIndex(index: string, opts: { dimension: number; metric?: 'cosine' | 'euclidean' }): Promise<void>;
  put(index: string, records: VectorRecord[]): Promise<void>;
  query(index: string, vector: Vector, opts?: { topK?: number; filter?: VectorFilter }): Promise<VectorMatch[]>;
  remove(index: string, keys: string[]): Promise<void>;
  /** Bulk-read every vector in an index (key + data + metadata), paged
   *  internally — for whole-index analysis like a 2D semantic projection, which
   *  the kNN `query` can't serve. Empty for a never-created index. */
  list(index: string): Promise<VectorRecord[]>;
}

export interface Embedder {
  /** Fixed output dimension (the index is created with it). */
  readonly dimension: number;
  /** Batch embed — one vector per input text, same order. */
  embed(texts: string[]): Promise<Vector[]>;
}

// ── addressing ──────────────────────────────────────────────────────

/** The shared public corpus index (ADR-0027 docs / `public` shares) — a multi-user
 *  optimization so a viewer needn't re-query each owner's private index for public
 *  facts. In single-owner deployments it coincides with the owner's slice. */
export const PUBLIC_INDEX = 'slice-public';

/** The index a scope's facts live in — mirrors the `STATE#<scope>` partition so the
 *  isolation boundary is structural (ADR-0030 Decision 2). The single seam through
 *  which a future collapse/re-split is one function change (§2a).
 *
 *  `dim` (the active embedder's dimension) is appended so an embedding-model change —
 *  e.g. hashing 256-dim → Titan 1024-dim — lands in a *fresh* index (S3 Vectors fixes
 *  dimension at creation) rather than colliding with vectors from another space. The
 *  old index is simply orphaned (harmless; storage is cheap). This is the resolution
 *  to the "embedding drift" risk: a model swap is a `reindex` into a new namespace,
 *  callers stay consistent because they all derive `dim` from the same env-built embedder. */
export function indexForScope(scope: string, dim?: number): string {
  return dim ? `slice-${scope}-d${dim}` : `slice-${scope}`;
}

// ── text extraction ─────────────────────────────────────────────────

/**
 * Fields that carry meaning, in the order they contribute to the embedding.
 *
 * `applies`/`when` lead deliberately. A field whose job is to say **when this
 * fact is relevant** is the strongest retrieval signal a fact has — it is the
 * substrate's equivalent of an Agent Skill's `description`, the cheap trigger
 * that answers "should I load this?" separately from the payload that answers
 * "what does it say?" (`docs/machine.md` §8 already borrowed the tiering for
 * machine rails; `machine-rail.when` is literally "Level-1 'when to use this
 * branch' descriptor"). Content tells you what a thing IS; applicability tells
 * you when it BITES, and cosine similarity over content cannot infer the latter.
 */
const TEXT_FIELDS = [
  // applicability — the trigger
  'applies',
  'when',
  // identity + one-liners
  'title',
  'name',
  'summary',
  'gloss',
  'description',
  // the payload
  'text',
  'content',
  'body',
  'detail',
  'note',
  'prompt',
  'value',
  'path',
];
const MAX_EMBED_CHARS = 8000;
/** A string long enough, and broken up enough, to be prose rather than a handle. */
const PROSE_MIN_CHARS = 24;
/** Never sweep these in as prose — high-entropy handles that only add noise. */
const NEVER_EMBED = new Set(['id', 'key', 'sha', 's3Key', 'url', 'href', 'version', 'writer', 'via', 'scope']);

/** Prose, as opposed to an identifier: long enough and containing whitespace.
 *  `"b8de1247a375626a..."` and `"docs/architecture/adr/0094.md"` are not prose;
 *  `"ask 'and then what?' of a decision's consequences"` is. */
const isProse = (v: unknown): v is string => typeof v === 'string' && v.length >= PROSE_MIN_CHARS && /\s/.test(v);

/** The text to embed for a fact, or `null` when there's nothing worth embedding.
 *  Skips `_`-prefixed plumbing facts (ADR-0030 Decision 4) — EXCEPT `_caps/`
 *  capability facts (ADR-0052), which exist precisely to be found by meaning
 *  (goal-conditioned recall matching an intent to a tool).
 *
 *  A PARTIAL MATCH USED TO SILENCE THE REMAINDER. The old rule collected the
 *  known fields and, only if it found none, fell back to the whole JSON — so a
 *  fact carrying exactly one known field had everything else dropped. Measured
 *  live: all 98 `mental-model` facts embed as `{name, gloss, category, source}`,
 *  and because `name` was the only listed field, each model was indexed as its
 *  two-word NAME alone — "Second-Order Thinking" — with its gloss never in the
 *  index at all. The latticework consequently clustered with itself and reached
 *  nothing (ADR-0045's "lens beside the work" never fired). `task` and `goal`
 *  lost their `detail`, `machine` its `context`, `log` everything but its title.
 *
 *  So: known fields first, in meaning order, then a sweep of any other field
 *  that reads like prose. Having one recognised field can no longer cost a fact
 *  the rest of its content. */
export function embeddableText(key: string, value: unknown): string | null {
  if (key.startsWith('_') && !key.startsWith('_caps/')) return null;
  let text: string | null = null;
  if (typeof value === 'string') {
    text = value;
  } else if (value && typeof value === 'object' && !Array.isArray(value)) {
    const o = value as Record<string, unknown>;
    const parts: string[] = [];
    const taken = new Set<string>();
    for (const f of TEXT_FIELDS) {
      if (typeof o[f] === 'string' && o[f]) {
        parts.push(o[f] as string);
        taken.add(f);
      }
    }
    // The sweep: everything else the fact says in prose. Bounded by the char cap
    // below, and by `isProse` — identifiers, hashes and paths stay out.
    for (const [f, v] of Object.entries(o)) {
      if (taken.has(f) || NEVER_EMBED.has(f) || !isProse(v)) continue;
      parts.push(v);
    }
    text = parts.length ? parts.join('\n') : safeJson(o);
  } else if (value != null) {
    text = safeJson(value);
  }
  if (!text) return null;
  text = text.trim();
  if (!text) return null;
  return text.length > MAX_EMBED_CHARS ? text.slice(0, MAX_EMBED_CHARS) : text;
}

/** What the index-membership rule inspects of a fact. `timerEffect` is the raw
 *  store field (`StateRecord.timerEffect`) or an `Entry`'s `_meta.timer?.effect`. */
export interface IndexableFact {
  key: string;
  value?: unknown;
  superseded?: boolean;
  timerEffect?: 'delete' | 'enable' | null;
}

/** The ONE index-membership rule, shared by BOTH vector writers (the live
 *  stream indexer and the `reindex` backfill): a fact belongs in the index iff
 *  it is live (not superseded), not ephemeral-by-declaration (a delete-effect
 *  timer — a lease/presence row — must never be embedded: it mints `similarTo`
 *  kinship between coordination artefacts and leads the contested/suggestions
 *  views), and has embeddable text. Returns that text, or `null` for a
 *  non-member. Keeping this in the shared contract is what stops the two
 *  writers' membership predicates drifting apart (the reindex worker once
 *  gated only on `!!text`, so a full reindex re-embedded live delete-timer
 *  leases the stream had deliberately dropped). */
export function indexableText(fact: IndexableFact): string | null {
  if (fact.superseded) return null;
  if (fact.timerEffect === 'delete') return null;
  return embeddableText(fact.key, fact.value);
}

/** Content types whose bytes are UTF-8 text we can embed directly (ADR-0030 Inc 4
 *  follow-on — blob text extraction). Binary types (images, PDF, audio) are NOT
 *  text-like and need an extraction lane (Textract) to become searchable. */
export function isTextLikeContentType(contentType?: string): boolean {
  if (!contentType) return false;
  const ct = contentType.split(';')[0].trim().toLowerCase();
  if (ct.startsWith('text/')) return true;
  return [
    'application/json',
    'application/ld+json',
    'application/xml',
    'application/yaml',
    'application/x-yaml',
    'application/csv',
    'application/markdown',
    'application/javascript',
    'application/typescript',
    'application/x-ndjson',
    'image/svg+xml',
  ].includes(ct);
}

/** The byte ceiling under which a text blob's content is inlined for search
 *  (ADR-0027 §1 "small text stores content inline"); larger text stays a pointer. */
export const BLOB_INLINE_MAX_BYTES = 64 * 1024;

// ── inferred similarity edges (ADR-0031 Option A) ───────────────────

/** The relation for an inferred semantic-similarity edge, and the writer it's
 *  stamped with — so these are distinguishable from authored edges (`workspace.link`)
 *  and fully regenerable by the indexer. They are persisted authored-style edges, so
 *  they feed `centrality` (a salience signal) and surface in `neighbors`/`$graph`. */
export const SIMILAR_REL = 'similarTo';
export const SIMILAR_WRITER = 'platform/vectors';

/** From a fact's ranked vector matches, the neighbours to link `similarTo`: drop the
 *  fact itself, keep matches at/above the score floor, cap at k (matches are
 *  score-descending, so this is the top-k above τ). */
export function selectNeighbors(matches: VectorMatch[], selfKey: string, opts: { k: number; minScore: number }): VectorMatch[] {
  return matches.filter((m) => m.key !== selfKey && m.score >= opts.minScore).slice(0, Math.max(0, opts.k));
}

export interface SimilarConfig {
  enabled: boolean;
  k: number;
  minScore: number;
  strength: number;
}

/** Inferred-edge knobs from the environment (ADR-0031): `VECTOR_SIMILAR=off` disables;
 *  `VECTOR_SIMILAR_K` neighbours per fact (default 5); `VECTOR_SIMILAR_MIN_SCORE` the
 *  cosine floor τ (default 0.35 — Titan cosines run compressed); `VECTOR_SIMILAR_STRENGTH`
 *  the edge weight (default 0.3 — above structural 0.2, below membership 0.4, so inferred
 *  kinship never outweighs authored structure). Tunable without a code redeploy. */
export function similarConfig(env: NodeJS.ProcessEnv = process.env): SimilarConfig {
  return {
    enabled: (env.VECTOR_SIMILAR ?? 'on').toLowerCase() !== 'off',
    k: Number(env.VECTOR_SIMILAR_K ?? 5),
    minScore: Number(env.VECTOR_SIMILAR_MIN_SCORE ?? 0.35),
    strength: Number(env.VECTOR_SIMILAR_STRENGTH ?? 0.3),
  };
}

function safeJson(v: unknown): string {
  try {
    return JSON.stringify(v) ?? '';
  } catch {
    return '';
  }
}

/** The filterable metadata for a fact's vector — the in-index granular filters
 *  (`type` for ADR-0023, `tag`, `superseded`). Kept primitive + small. */
export function metadataForFact(meta: { type?: string | null; tags?: string[]; superseded?: boolean }): VectorMetadata {
  const m: VectorMetadata = { superseded: !!meta.superseded };
  if (meta.type) m.type = meta.type;
  // S3 Vectors filters are equality/range over scalar keys; collapse the first tag for
  // a cheap server-side filter and rely on the authoritative re-read for the rest.
  if (Array.isArray(meta.tags) && meta.tags.length && typeof meta.tags[0] === 'string') m.tag = meta.tags[0];
  return m;
}

// ── math ────────────────────────────────────────────────────────────

export function normalize(v: Vector): Vector {
  let norm = 0;
  for (const x of v) norm += x * x;
  norm = Math.sqrt(norm);
  if (norm === 0) return v;
  return v.map((x) => x / norm);
}

/** Cosine similarity. Assumes nothing about normalization (computes both norms). */
export function cosineSimilarity(a: Vector, b: Vector): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

// ── reference embedder: deterministic lexical hashing ────────────────

/** FNV-1a 32-bit. */
function hash32(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

function tokenize(text: string): string[] {
  return (text.toLowerCase().match(/[a-z0-9]+/g) ?? []).filter((t) => t.length >= 2);
}

/**
 * A dependency-free, deterministic embedder: signed feature-hashing of token
 * frequencies into a fixed-dim, L2-normalized vector. It captures *lexical* overlap
 * (shared terms → higher cosine), NOT true semantics — its role is to exercise the
 * whole pipeline (index → put → query → re-read → R1 envelope) on real infra before
 * Bedrock Titan model access is wired (ADR-0030 Increment 0 / the `Embedder` seam).
 * `BedrockEmbedder` is the drop-in real backend (Increment 4).
 */
export class HashingEmbedder implements Embedder {
  constructor(readonly dimension: number = 256) {}

  async embed(texts: string[]): Promise<Vector[]> {
    return texts.map((t) => this.embedOne(t));
  }

  private embedOne(text: string): Vector {
    const v = new Array<number>(this.dimension).fill(0);
    const counts = new Map<string, number>();
    for (const tok of tokenize(text)) counts.set(tok, (counts.get(tok) ?? 0) + 1);
    for (const [tok, c] of counts) {
      const bucket = hash32(tok) % this.dimension;
      const sign = hash32(`${tok}#sign`) & 1 ? 1 : -1; // signed hashing curbs collision bias
      v[bucket] += sign * (1 + Math.log(c)); // sublinear tf
    }
    return normalize(v);
  }
}

// ── reference store: in-memory brute-force k-NN ──────────────────────

/**
 * An in-memory `VectorStore` (brute-force cosine). For unit tests and local runs; not
 * shared across Lambda invocations, so not a production backend — `S3VectorsStore` is
 * (ADR-0030 Increment 1). Brute force is fine at the scales it serves (a test slice).
 */
export class MemoryVectorStore implements VectorStore {
  private indexes = new Map<string, Map<string, VectorRecord>>();

  async ensureIndex(index: string): Promise<void> {
    if (!this.indexes.has(index)) this.indexes.set(index, new Map());
  }

  async put(index: string, records: VectorRecord[]): Promise<void> {
    await this.ensureIndex(index);
    const idx = this.indexes.get(index)!;
    for (const r of records) idx.set(r.key, r);
  }

  async query(index: string, vector: Vector, opts?: { topK?: number; filter?: VectorFilter }): Promise<VectorMatch[]> {
    const idx = this.indexes.get(index);
    if (!idx) return [];
    const topK = opts?.topK ?? 10;
    const filter = opts?.filter;
    const matches: VectorMatch[] = [];
    for (const r of idx.values()) {
      if (filter && !matchesFilter(r.metadata, filter)) continue;
      const score = cosineSimilarity(vector, r.vector);
      matches.push({ key: r.key, score, distance: 1 - score, metadata: r.metadata });
    }
    matches.sort((a, b) => b.score - a.score);
    return matches.slice(0, topK);
  }

  async remove(index: string, keys: string[]): Promise<void> {
    const idx = this.indexes.get(index);
    if (!idx) return;
    for (const k of keys) idx.delete(k);
  }

  async list(index: string): Promise<VectorRecord[]> {
    const idx = this.indexes.get(index);
    return idx ? [...idx.values()] : [];
  }
}

function matchesFilter(metadata: VectorMetadata | undefined, filter: VectorFilter): boolean {
  const m = metadata ?? {};
  for (const [k, v] of Object.entries(filter)) if (m[k] !== v) return false;
  return true;
}
