/**
 * Vectors (ADR-0030) — the semantic-search seam.
 *
 * Exercises the reference backend (HashingEmbedder + MemoryVectorStore) and the
 * pure helpers (cosine, text extraction, addressing). The same contract is what
 * S3VectorsStore + BedrockEmbedder implement, so these tests pin the seam.
 */
import { DynamoDB } from 'aws-sdk';
import {
  HashingEmbedder,
  MemoryVectorStore,
  cosineSimilarity,
  normalize,
  embeddableText,
  metadataForFact,
  indexForScope,
  PUBLIC_INDEX,
} from '../platform/runtime';
import { planStreamWork } from '../services/vector-indexer/handler';

describe('HashingEmbedder (deterministic lexical fallback)', () => {
  const e = new HashingEmbedder(128);

  it('is deterministic, fixed-dimension, and L2-normalized', async () => {
    const [a, b] = await e.embed(['the quick brown fox', 'the quick brown fox']);
    expect(a).toHaveLength(128);
    expect(a).toEqual(b); // deterministic
    const norm = Math.sqrt(a.reduce((s, x) => s + x * x, 0));
    expect(norm).toBeCloseTo(1, 5); // unit length
  });

  it('ranks lexically-related text above unrelated text by cosine', async () => {
    const [q, related, unrelated] = await e.embed([
      'dynamodb single table design for the substrate',
      'we chose a single dynamodb table to store substrate facts',
      'passkey webauthn login refresh cookie horizon',
    ]);
    expect(cosineSimilarity(q, related)).toBeGreaterThan(cosineSimilarity(q, unrelated));
  });

  it('empty text embeds to a zero vector (cosine 0 against anything)', async () => {
    const [z, any] = await e.embed(['', 'something']);
    expect(cosineSimilarity(z, any)).toBe(0);
  });
});

describe('cosineSimilarity / normalize', () => {
  it('is 1 for identical, 0 for orthogonal, -1 for opposite', () => {
    expect(cosineSimilarity([1, 0], [1, 0])).toBeCloseTo(1);
    expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0);
    expect(cosineSimilarity([1, 0], [-1, 0])).toBeCloseTo(-1);
  });
  it('normalize yields unit length and is a no-op on the zero vector', () => {
    const n = normalize([3, 4]);
    expect(Math.sqrt(n[0] ** 2 + n[1] ** 2)).toBeCloseTo(1);
    expect(normalize([0, 0])).toEqual([0, 0]);
  });
});

describe('embeddableText', () => {
  it('skips `_`-prefixed plumbing facts', () => {
    expect(embeddableText('_types/decision', { icon: '⚖️' })).toBeNull();
    expect(embeddableText('_config/salience', { focusThreshold: 0.6 })).toBeNull();
  });
  it('returns a string value directly', () => {
    expect(embeddableText('phase', 'planning')).toBe('planning');
  });
  it('prefers a file’s inline content, then known text fields, then JSON', () => {
    expect(embeddableText('file/docs/x.md', { path: 'docs/x.md', content: '# Title\nbody' })).toContain('# Title');
    expect(embeddableText('d1', { title: 'Choose Dynamo', extra: 1 })).toBe('Choose Dynamo');
    expect(embeddableText('odd', { a: 1, b: 2 })).toBe('{"a":1,"b":2}');
  });
  it('returns null for empty/whitespace and truncates very long text', () => {
    expect(embeddableText('k', '   ')).toBeNull();
    const long = 'x'.repeat(20000);
    expect((embeddableText('k', long) ?? '').length).toBe(8000);
  });
});

describe('metadataForFact', () => {
  it('always carries superseded; adds type + first tag when present', () => {
    expect(metadataForFact({ type: 'decision', tags: ['storage', 'substrate'], superseded: false })).toEqual({
      superseded: false,
      type: 'decision',
      tag: 'storage',
    });
    expect(metadataForFact({ superseded: true })).toEqual({ superseded: true });
  });
});

describe('indexForScope / PUBLIC_INDEX', () => {
  it('maps a scope to its slice index, namespaced by embedding dimension', () => {
    expect(indexForScope('c15r')).toBe('slice-c15r'); // no dim → bare (back-compat)
    expect(indexForScope('c15r', 1024)).toBe('slice-c15r-d1024'); // dim → fresh namespace on model change
    expect(indexForScope('c15r', 256)).toBe('slice-c15r-d256');
    expect(PUBLIC_INDEX).toBe('slice-public');
  });
});

describe('MemoryVectorStore (brute-force k-NN reference)', () => {
  const e = new HashingEmbedder(128);

  it('ensureIndex is idempotent; put then query ranks by cosine, honours topK + filter', async () => {
    const store = new MemoryVectorStore();
    await store.ensureIndex('slice-x', { dimension: 128 });
    await store.ensureIndex('slice-x', { dimension: 128 }); // idempotent — no throw
    const texts = ['dynamodb table substrate', 'passkey webauthn refresh', 'dynamodb stream indexer'];
    const vecs = await e.embed(texts);
    await store.put('slice-x', [
      { key: 'a', vector: vecs[0], metadata: { type: 'decision', superseded: false } },
      { key: 'b', vector: vecs[1], metadata: { type: 'note', superseded: false } },
      { key: 'c', vector: vecs[2], metadata: { type: 'decision', superseded: false } },
    ]);
    const [q] = await e.embed(['dynamodb substrate storage']);

    const all = await store.query('slice-x', q, { topK: 3 });
    expect(all[0].key === 'a' || all[0].key === 'c').toBe(true); // a dynamodb fact ranks first
    expect(all[0].score).toBeGreaterThan(all[2].score);

    const limited = await store.query('slice-x', q, { topK: 1 });
    expect(limited).toHaveLength(1);

    const decisionsOnly = await store.query('slice-x', q, { topK: 5, filter: { type: 'decision' } });
    expect(decisionsOnly.map((m) => m.key).sort()).toEqual(['a', 'c']); // 'b' (note) filtered out

    const live = await store.query('slice-x', q, { topK: 5, filter: { superseded: false } });
    expect(live).toHaveLength(3);
  });

  it('remove drops a key; querying a missing index returns []', async () => {
    const store = new MemoryVectorStore();
    const [v] = await e.embed(['x']);
    await store.put('slice-y', [{ key: 'k', vector: v }]);
    await store.remove('slice-y', ['k']);
    expect(await store.query('slice-y', v, { topK: 5 })).toEqual([]);
    expect(await store.query('slice-missing', v, { topK: 5 })).toEqual([]);
  });
});

describe('planStreamWork (ADR-0030 Inc 2 — DDB-stream record → per-index work)', () => {
  // DynamoDB stream images are attribute-value typed; build them with the v2 marshaller.
  const M = (obj: Record<string, unknown>) => DynamoDB.Converter.marshall(obj);
  const fact = (scope: string, key: string, extra: Record<string, unknown> = {}) => ({ sk: `KEY#${key}`, scope, key, ...extra });

  it('routes a live fact create to a put on its slice index, skipping non-facts', () => {
    const plans = planStreamWork({
      Records: [
        { eventName: 'INSERT', dynamodb: { NewImage: M(fact('alice', 'd1', { value: { title: 'dynamodb decision' }, type: 'decision', tags: ['storage'] })) } },
        // an edge item (sk EDGE#…) — must be ignored
        { eventName: 'INSERT', dynamodb: { NewImage: M({ sk: 'EDGE#a|rel|b', scope: 'alice', from: 'a', rel: 'rel', to: 'b' }) } },
        // a `_`-prefixed plumbing fact — no embeddable text, skipped
        { eventName: 'INSERT', dynamodb: { NewImage: M(fact('alice', '_config/salience', { value: { focusThreshold: 0.6 } })) } },
      ],
    });
    expect([...plans.keys()]).toEqual(['slice-alice-d256']); // DIM defaults to 256 (no VECTOR_* env in tests)
    const p = plans.get('slice-alice-d256')!;
    expect(p.puts.map((x) => x.key)).toEqual(['d1']);
    expect(p.puts[0].meta).toMatchObject({ type: 'decision', tag: 'storage' });
  });

  it('drops the vector on supersession and on REMOVE', () => {
    const plans = planStreamWork({
      Records: [
        { eventName: 'MODIFY', dynamodb: { NewImage: M(fact('bob', 'g1', { value: 'x', superseded: true })), OldImage: M(fact('bob', 'g1', { value: 'x' })) } },
        { eventName: 'REMOVE', dynamodb: { OldImage: M(fact('bob', 'g2', { value: 'y' })) } },
      ],
    });
    const p = plans.get('slice-bob-d256')!;
    expect([...p.removes].sort()).toEqual(['g1', 'g2']);
    expect(p.puts).toHaveLength(0);
  });

  it('sha-skips a metadata-only rewrite (same embeddable text, still live)', () => {
    const same = { value: { title: 'unchanged title' } };
    const plans = planStreamWork({
      Records: [
        { eventName: 'MODIFY', dynamodb: { NewImage: M(fact('alice', 'k', { ...same, tags: ['new-tag'] })), OldImage: M(fact('alice', 'k', { ...same, tags: ['old-tag'] })) } },
      ],
    });
    expect(plans.size).toBe(0); // text unchanged → no re-embed
  });
});
