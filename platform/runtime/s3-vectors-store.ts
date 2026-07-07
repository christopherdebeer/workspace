/**
 * S3VectorsStore (ADR-0030 Increment 1) — the production `VectorStore`, over Amazon
 * S3 Vectors. The data-plane half of "CDK, but deployed at runtime" (§3a): the bucket
 * and per-slice indexes are created **at runtime, create-if-absent**, exactly as the
 * cells provisioner creates cells — there is no CDK for them. The only deploy-time
 * infra is this Lambda's IAM (`s3vectors:*` on the fixed bucket ARN) + the env var.
 *
 * The AWS SDK is **dynamically imported inside methods** (platform convention: the
 * runtime must not load the SDK at import time), so this module is free to import from
 * `services/workspace` without dragging the v3 client into tests or other bundles — a
 * test uses `MemoryVectorStore`, never this.
 */
import type { Vector, VectorFilter, VectorMatch, VectorRecord, VectorStore, Embedder } from './vectors';
import { HashingEmbedder } from './vectors';

// Lazily-bound client + command constructors (one dynamic import, cached).
type S3VectorsModule = typeof import('@aws-sdk/client-s3vectors');
let mod: S3VectorsModule | null = null;
async function sdk(): Promise<S3VectorsModule> {
  if (!mod) mod = await import('@aws-sdk/client-s3vectors');
  return mod;
}

const PUT_CHUNK = 200; // PutVectors batches; keep well under the service cap

export interface S3VectorsStoreOptions {
  bucket: string;
  region?: string;
}

export class S3VectorsStore implements VectorStore {
  private clientPromise: Promise<InstanceType<S3VectorsModule['S3VectorsClient']>> | null = null;
  /** Indexes confirmed present this process — skip redundant create-if-absent calls. */
  private ensured = new Set<string>();
  private bucketEnsured = false;

  constructor(private readonly opts: S3VectorsStoreOptions) {}

  private async client(): Promise<InstanceType<S3VectorsModule['S3VectorsClient']>> {
    if (!this.clientPromise) {
      this.clientPromise = sdk().then(({ S3VectorsClient }) => new S3VectorsClient(this.opts.region ? { region: this.opts.region } : {}));
    }
    return this.clientPromise;
  }

  /** Create-if-absent the bucket (once) then the index. Idempotent: a ConflictException
   *  ("already exists") is the success path of a concurrent create (ADR-0030 §3a). */
  async ensureIndex(index: string, opts: { dimension: number; metric?: 'cosine' | 'euclidean' }): Promise<void> {
    if (this.ensured.has(index)) return;
    const { CreateVectorBucketCommand, CreateIndexCommand } = await sdk();
    const client = await this.client();
    if (!this.bucketEnsured) {
      try {
        await client.send(new CreateVectorBucketCommand({ vectorBucketName: this.opts.bucket }));
      } catch (err) {
        if (!isConflict(err)) throw err;
      }
      this.bucketEnsured = true;
    }
    try {
      await client.send(
        new CreateIndexCommand({
          vectorBucketName: this.opts.bucket,
          indexName: index,
          dataType: 'float32',
          dimension: opts.dimension,
          distanceMetric: opts.metric ?? 'cosine',
        }),
      );
    } catch (err) {
      if (!isConflict(err)) throw err;
    }
    this.ensured.add(index);
  }

  async put(index: string, records: VectorRecord[]): Promise<void> {
    if (!records.length) return;
    const { PutVectorsCommand } = await sdk();
    const client = await this.client();
    for (let i = 0; i < records.length; i += PUT_CHUNK) {
      const chunk = records.slice(i, i + PUT_CHUNK);
      await client.send(
        new PutVectorsCommand({
          vectorBucketName: this.opts.bucket,
          indexName: index,
          vectors: chunk.map((r) => ({ key: r.key, data: { float32: r.vector }, metadata: r.metadata })),
        }),
      );
    }
  }

  async query(index: string, vector: Vector, opts?: { topK?: number; filter?: VectorFilter }): Promise<VectorMatch[]> {
    const { QueryVectorsCommand } = await sdk();
    const client = await this.client();
    try {
      const out = await client.send(
        new QueryVectorsCommand({
          vectorBucketName: this.opts.bucket,
          indexName: index,
          topK: opts?.topK ?? 10,
          queryVector: { float32: vector },
          filter: opts?.filter,
          returnMetadata: true,
          returnDistance: true,
        }),
      );
      return (out.vectors ?? []).map((v) => {
        const distance = typeof v.distance === 'number' ? v.distance : 1;
        return {
          key: v.key as string,
          distance,
          // S3 Vectors reports cosine *distance* (1 - similarity); invert for a ranking score.
          score: 1 - distance,
          metadata: (v.metadata as VectorMatch['metadata']) ?? undefined,
        };
      });
    } catch (err) {
      // A query against a never-created (empty) slice index is "not found" — treat as no hits.
      if (isNotFound(err)) return [];
      throw err;
    }
  }

  async remove(index: string, keys: string[]): Promise<void> {
    if (!keys.length) return;
    const { DeleteVectorsCommand } = await sdk();
    const client = await this.client();
    try {
      await client.send(new DeleteVectorsCommand({ vectorBucketName: this.opts.bucket, indexName: index, keys }));
    } catch (err) {
      if (!isNotFound(err)) throw err;
    }
  }

  /** Page ListVectors (returnData) to pull the whole index. S3 Vectors caps a
   *  page at ~1 MB regardless of `maxResults`, so this follows `nextToken` to the
   *  end. A never-created index is "not found" → empty. */
  async list(index: string): Promise<VectorRecord[]> {
    const { ListVectorsCommand } = await sdk();
    const client = await this.client();
    const out: VectorRecord[] = [];
    let nextToken: string | undefined;
    try {
      do {
        const res = await client.send(
          new ListVectorsCommand({
            vectorBucketName: this.opts.bucket,
            indexName: index,
            returnData: true,
            returnMetadata: true,
            maxResults: 500,
            nextToken,
          }),
        );
        for (const v of res.vectors ?? []) {
          const data = (v.data as { float32?: number[] } | undefined)?.float32;
          if (v.key && data) out.push({ key: v.key, vector: data, metadata: (v.metadata as VectorRecord['metadata']) ?? undefined });
        }
        nextToken = res.nextToken;
      } while (nextToken);
    } catch (err) {
      if (isNotFound(err)) return [];
      throw err;
    }
    return out;
  }
}

function errName(err: unknown): string {
  return (err as { name?: string })?.name ?? '';
}
function isConflict(err: unknown): boolean {
  return /Conflict|AlreadyExists/i.test(errName(err));
}
function isNotFound(err: unknown): boolean {
  return /NotFound|NoSuch/i.test(errName(err));
}

/**
 * BedrockEmbedder (ADR-0030 Increment 4) — real semantic embeddings via Bedrock Titan
 * Text Embeddings v2. Drop-in for `HashingEmbedder` once Titan model access is enabled
 * on the account. SDK dynamically imported (lazy convention).
 */
export class BedrockEmbedder implements Embedder {
  readonly dimension: number;
  private modelId: string;
  private region?: string;
  private clientPromise: Promise<unknown> | null = null;

  constructor(opts?: { modelId?: string; dimension?: number; region?: string }) {
    this.modelId = opts?.modelId ?? 'amazon.titan-embed-text-v2:0';
    this.dimension = opts?.dimension ?? 1024;
    this.region = opts?.region;
  }

  private async client(): Promise<{ send: (cmd: unknown) => Promise<{ body: Uint8Array }> }> {
    if (!this.clientPromise) {
      this.clientPromise = import('@aws-sdk/client-bedrock-runtime').then(
        ({ BedrockRuntimeClient }) => new BedrockRuntimeClient(this.region ? { region: this.region } : {}),
      );
    }
    return this.clientPromise as Promise<{ send: (cmd: unknown) => Promise<{ body: Uint8Array }> }>;
  }

  async embed(texts: string[]): Promise<Vector[]> {
    const { InvokeModelCommand } = await import('@aws-sdk/client-bedrock-runtime');
    const client = await this.client();
    const out: Vector[] = [];
    for (const text of texts) {
      const res = await client.send(
        new InvokeModelCommand({
          modelId: this.modelId,
          contentType: 'application/json',
          accept: 'application/json',
          body: JSON.stringify({ inputText: text.slice(0, 8000), dimensions: this.dimension, normalize: true }),
        }) as unknown,
      );
      const parsed = JSON.parse(new TextDecoder().decode(res.body)) as { embedding: number[] };
      out.push(parsed.embedding);
    }
    return out;
  }
}

/**
 * Wire the production vector backend from the Lambda environment (ADR-0030). Returns
 * `undefined` (→ `search` degrades to a hint) when `VECTOR_BUCKET` is unset, so the
 * feature is dark until infra + env land. `VECTOR_EMBEDDER=bedrock` flips to Titan
 * (Increment 4); default is the deterministic `HashingEmbedder` (Increment 1, no
 * model-access prerequisite). Dimension is pinned in env so it matches the index.
 */
export function vectorsFromEnv(env: NodeJS.ProcessEnv = process.env): { store: VectorStore; embedder: Embedder } | undefined {
  const bucket = env.VECTOR_BUCKET;
  if (!bucket) return undefined;
  const region = env.VECTOR_REGION ?? env.AWS_REGION;
  const useBedrock = (env.VECTOR_EMBEDDER ?? 'hashing').toLowerCase() === 'bedrock';
  const dimension = Number(env.VECTOR_DIM ?? (useBedrock ? 1024 : 256));
  const embedder: Embedder = useBedrock
    ? new BedrockEmbedder({ dimension, region, modelId: env.VECTOR_MODEL })
    : new HashingEmbedder(dimension);
  return { store: new S3VectorsStore({ bucket, region }), embedder };
}
