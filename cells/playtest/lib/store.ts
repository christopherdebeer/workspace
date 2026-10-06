/* ---------------------------------------------------------------------------
 * The cell's own table (pk/sk, pay-per-request, no GSIs). Keys:
 *
 *   GAMES          <slug>             game index: head/best versions, climb state
 *   GAME#<slug>    DEF#0001           a definition version (RULES.md + provenance)
 *   GAME#<slug>    SUITE              train/test seeds × players, maxSteps, epsilon
 *   GAME#<slug>    EVAL#<ts>#<id>     eval summary (list by game)
 *   GAME#<slug>    ROUND#0001         one hill-climb round
 *   EVAL#<id>      meta               full eval (train run ids; test scores only)
 *   RUN#<id>       meta | c<i>        run summary | gzipped detail chunks (turns, log)
 *   BACKLOG        <kind>:<subject>   what evals keep hitting: missing / broken mechanics
 *   ENGINE         <version>          engine fingerprint (per-mechanic hashes), first seen
 *   SECRET#jev     v1                 the owner's gateway token for @c15r/jev (write-only)
 *   JOB#<id>       v1 | c<i>          async jobs (kernel cell-jobs)
 * ------------------------------------------------------------------------- */
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, PutCommand, QueryCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { gzipSync, gunzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';

export const TABLE = process.env.TABLE_NAME ?? '';
const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}), { marshallOptions: { removeUndefinedValues: true } });
const CHUNK = 300 * 1024;

export type Item = Record<string, unknown>;

export const pad = (n: number) => String(n).padStart(4, '0');
export const hash = (s: string) => createHash('sha256').update(s).digest('hex').slice(0, 12);
export const newId = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;

export async function get(pk: string, sk: string): Promise<Item | undefined> {
  return (await ddb.send(new GetCommand({ TableName: TABLE, Key: { pk, sk } }))).Item;
}
export async function put(item: Item): Promise<void> {
  await ddb.send(new PutCommand({ TableName: TABLE, Item: item }));
}
export async function query(pk: string, prefix = '', opts: { limit?: number; newestFirst?: boolean } = {}): Promise<Item[]> {
  const out: Item[] = [];
  let start: Record<string, unknown> | undefined;
  do {
    const r = await ddb.send(
      new QueryCommand({
        TableName: TABLE,
        KeyConditionExpression: prefix ? 'pk = :pk AND begins_with(sk, :p)' : 'pk = :pk',
        ExpressionAttributeValues: prefix ? { ':pk': pk, ':p': prefix } : { ':pk': pk },
        ScanIndexForward: !opts.newestFirst,
        ExclusiveStartKey: start,
        Limit: opts.limit,
      }),
    );
    out.push(...((r.Items ?? []) as Item[]));
    start = r.LastEvaluatedKey;
  } while (start && (!opts.limit || out.length < opts.limit));
  return opts.limit ? out.slice(0, opts.limit) : out;
}
export async function update(pk: string, sk: string, expr: string, values: Record<string, unknown>, names?: Record<string, string>): Promise<void> {
  await ddb.send(new UpdateCommand({ TableName: TABLE, Key: { pk, sk }, UpdateExpression: expr, ExpressionAttributeValues: values, ExpressionAttributeNames: names }));
}

/** Update and return the item as it is now (e.g. an atomic counter). */
export async function updateReturning(pk: string, sk: string, expr: string, values: Record<string, unknown>, names?: Record<string, string>): Promise<Item> {
  const r = await ddb.send(new UpdateCommand({ TableName: TABLE, Key: { pk, sk }, UpdateExpression: expr, ExpressionAttributeValues: values, ExpressionAttributeNames: names, ReturnValues: 'ALL_NEW' }));
  return ((r as { Attributes?: Item }).Attributes ?? {}) as Item;
}
/** Set `attr` once: true for the caller that set it, false if it was already set. */
export async function claimOnce(pk: string, sk: string, attr: string): Promise<boolean> {
  try {
    await ddb.send(new UpdateCommand({ TableName: TABLE, Key: { pk, sk }, UpdateExpression: 'SET #a = :t', ConditionExpression: 'attribute_not_exists(#a)', ExpressionAttributeNames: { '#a': attr }, ExpressionAttributeValues: { ':t': new Date().toISOString() } }));
    return true;
  } catch (e) {
    if ((e as { name?: string }).name === 'ConditionalCheckFailedException') return false;
    throw e;
  }
}

/* ── large values: gzip → base64 → ≤300KB rows ─────────────────────── */

export async function putBlob(pk: string, value: unknown): Promise<number> {
  const b64 = gzipSync(Buffer.from(JSON.stringify(value))).toString('base64');
  const n = Math.ceil(b64.length / CHUNK) || 1;
  for (let i = 0; i < n; i++) await put({ pk, sk: `c${i}`, data: b64.slice(i * CHUNK, (i + 1) * CHUNK) });
  return n;
}
export async function getBlob<T>(pk: string, chunks: number): Promise<T | null> {
  let b64 = '';
  for (let i = 0; i < chunks; i++) b64 += String((await get(pk, `c${i}`))?.data ?? '');
  if (!b64) return null;
  return JSON.parse(gunzipSync(Buffer.from(b64, 'base64')).toString('utf8')) as T;
}

/* ── games & definitions ─────────────────────────────────────────────── */

export interface GameIndex extends Item {
  slug: string;
  name: string;
  head: number;
  versions: number;
  best?: number;
  climb?: { rounds: number; stall: number; status: 'idle' | 'climbing' | 'stalled' };
  updatedAt: string;
}
export interface Definition extends Item {
  version: number;
  rules: string;
  hash: string;
  parent: number | null;
  rationale: string;
  author: string;
  status: 'head' | 'kept' | 'reverted' | 'candidate' | 'draft';
  createdAt: string;
}

export const slugify = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 48) || 'game';

export async function getGame(slug: string): Promise<GameIndex | undefined> {
  return (await get('GAMES', slug)) as GameIndex | undefined;
}
export async function listGames(): Promise<GameIndex[]> {
  return (await query('GAMES')) as GameIndex[];
}
export async function getDefinition(slug: string, version?: number): Promise<Definition | undefined> {
  const g = await getGame(slug);
  if (!g) return undefined;
  return (await get(`GAME#${slug}`, `DEF#${pad(version ?? g.head)}`)) as Definition | undefined;
}

/** Store a new definition version. `asHead` moves the game's head to it. */
export async function putDefinition(slug: string, name: string, rules: string, opts: { rationale: string; author: string; parent: number | null; asHead: boolean; status: Definition['status'] }): Promise<Definition> {
  const g = await getGame(slug);
  const version = (g?.versions ?? 0) + 1;
  const def: Definition = { pk: `GAME#${slug}`, sk: `DEF#${pad(version)}`, version, rules, hash: hash(rules), parent: opts.parent, rationale: opts.rationale, author: opts.author, status: opts.status, createdAt: new Date().toISOString() };
  await put(def);
  const next: GameIndex = {
    pk: 'GAMES',
    sk: slug,
    slug,
    name,
    head: opts.asHead || !g ? version : g.head,
    versions: version,
    best: g?.best,
    climb: g?.climb ?? { rounds: 0, stall: 0, status: 'idle' },
    updatedAt: def.createdAt,
  };
  await put(next);
  return def;
}
export async function setGame(g: GameIndex): Promise<void> {
  await put({ ...g, pk: 'GAMES', sk: g.slug, updatedAt: new Date().toISOString() });
}
export async function setDefinitionStatus(slug: string, version: number, status: Definition['status']): Promise<void> {
  await update(`GAME#${slug}`, `DEF#${pad(version)}`, 'SET #s = :s', { ':s': status }, { '#s': 'status' });
}

/* ── suites ──────────────────────────────────────────────────────────── */

export interface Suite extends Item {
  train: { seeds: number[]; players: number[] };
  test: { seeds: number[]; players: number[] };
  maxSteps: number;
  /** Smallest score change acted on (the post's noise floor). */
  epsilon: number;
  noise?: number;
  /** engine/harness/suite-hash the noise was measured under */
  noiseContext?: string;
  /** v4.3: the bot split — seeded games played by the greedy stand-in (no judge), in volume, for
   *  the measures and targets; default thirty seeds × the train player counts */
  bot?: { seeds: number[]; players: number[] };
}
export function botSplit(s: Suite): { seeds: number[]; players: number[] } {
  return s.bot ?? { seeds: Array.from({ length: 30 }, (_, i) => i + 1), players: s.train.players };
}
export const DEFAULT_SUITE: Suite = { train: { seeds: [1, 2, 3], players: [2, 3] }, test: { seeds: [101, 102, 103], players: [2, 3] }, maxSteps: 150, epsilon: 0.01 };
/** Canonical JSON (sorted keys): DynamoDB returns map keys in any order, so a
 *  plain JSON.stringify would give one suite two hashes and orphan baselines. */
export function canonical(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonical).join(',')}]`;
  if (v && typeof v === 'object') return `{${Object.keys(v as object).sort().map((k) => `${JSON.stringify(k)}:${canonical((v as Record<string, unknown>)[k])}`).join(',')}}`;
  return JSON.stringify(v);
}
export const suiteHash = (s: Suite) => hash(canonical({ train: s.train, test: s.test, maxSteps: s.maxSteps }));

export async function getSuite(slug: string): Promise<Suite> {
  const s = (await get(`GAME#${slug}`, 'SUITE')) as Suite | undefined;
  return s ? { train: s.train, test: s.test, maxSteps: s.maxSteps, epsilon: s.epsilon, noise: s.noise, noiseContext: s.noiseContext } : DEFAULT_SUITE;
}
export async function setSuite(slug: string, s: Suite): Promise<void> {
  await put({ pk: `GAME#${slug}`, sk: 'SUITE', ...s });
}

/* ── backlog ─────────────────────────────────────────────────────────── */

export async function bumpBacklog(kind: string, subject: string, severity: string, detail: string, game: string, engine: string): Promise<void> {
  const now = new Date().toISOString();
  await update(
    'BACKLOG',
    `${kind}:${subject}`,
    'SET #k = :k, #s = :s, #v = :v, #d = :d, #l = :n, #e = :e, #f = if_not_exists(#f, :n) ADD #h :one, #g :g',
    { ':k': kind, ':s': subject, ':v': severity, ':d': detail, ':n': now, ':e': engine, ':one': 1, ':g': new Set([game]) },
    { '#k': 'kind', '#s': 'subject', '#v': 'severity', '#d': 'detail', '#l': 'lastSeen', '#e': 'engine', '#f': 'firstSeen', '#h': 'hits', '#g': 'games' },
  );
}

/* ── secret custody ──────────────────────────────────────────────────── */

export async function getJevToken(): Promise<string | null> {
  return (((await get('SECRET#jev', 'v1')) as { token?: string } | undefined)?.token ?? null);
}
export async function putJevToken(token: string): Promise<void> {
  await put({ pk: 'SECRET#jev', sk: 'v1', token, updatedAt: new Date().toISOString() });
}
