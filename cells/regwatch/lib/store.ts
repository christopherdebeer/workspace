/**
 * Storage layer — the val's SQLite tables on the cell's own DynamoDB table.
 *
 * Single-table layout (pk / sk):
 *   ITEM    / <collected_at>#<id>   full item (small — max body ~2KB)
 *   ITEMID  / <id>                  → { feedSk }   direct lookup
 *   URL     / <url>                 → { id }       dedupe guard (conditional put)
 *   REVIEW  / <item_id>             latest review, denormalized with the item's
 *                                   category/source/signals so feedback analysis
 *                                   never needs a join
 *   SOURCE  / <id>                  source registry entry
 *   PROMPT  / <name>#v<0000>        prompt version (active flag on the row)
 *   NOTE    / <created_at>#<id>     collector note
 *   NOTEID  / <id>                  → { noteSk }
 *
 * Timestamps keep the val's 'YYYY-MM-DD HH:MM:SS' UTC format so migrated and
 * new rows sort together lexicographically.
 */
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  QueryCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';
import { randomUUID } from 'node:crypto';

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}), {
  marshallOptions: { removeUndefinedValues: true },
});
const TABLE = process.env.TABLE_NAME ?? '';

export const now = (): string => new Date().toISOString().slice(0, 19).replace('T', ' ');
export const newId = (): string => randomUUID().replace(/-/g, '').slice(0, 16);

export interface Item {
  id: string;
  source_id: string | null;
  title: string;
  url: string;
  published_at: string | null;
  collected_at: string;
  body_md: string;
  summary: string;
  category: string;
  relevance_signals: Record<string, unknown>;
  status: 'unreviewed' | 'reviewed' | 'flagged' | 'archived';
  meta: Record<string, unknown>;
}

export interface Review {
  item_id: string;
  relevance: string;
  applicability: unknown;
  notes: string;
  action_required: boolean;
  reviewer: string;
  reviewed_at: string;
  // Denormalized from the item at review time:
  category: string;
  source_id: string | null;
  relevance_signals: Record<string, unknown>;
}

async function queryAll(
  pk: string,
  opts: { desc?: boolean; projection?: string; names?: Record<string, string>; max?: number } = {},
): Promise<Record<string, unknown>[]> {
  const out: Record<string, unknown>[] = [];
  let cursor: Record<string, unknown> | undefined;
  do {
    const res = await ddb.send(new QueryCommand({
      TableName: TABLE,
      KeyConditionExpression: 'pk = :pk',
      ExpressionAttributeValues: { ':pk': pk },
      ScanIndexForward: !opts.desc,
      ProjectionExpression: opts.projection,
      ExpressionAttributeNames: opts.names,
      ExclusiveStartKey: cursor,
    }));
    out.push(...((res.Items ?? []) as Record<string, unknown>[]));
    cursor = res.LastEvaluatedKey as Record<string, unknown> | undefined;
  } while (cursor && (!opts.max || out.length < opts.max));
  return opts.max ? out.slice(0, opts.max) : out;
}

/* ── items ──────────────────────────────────────────────────────── */

export async function insertItem(raw: Record<string, unknown>, collectedAt?: string): Promise<boolean> {
  const id = typeof raw.id === 'string' && raw.id ? raw.id : newId();
  const url = String(raw.url ?? '');
  if (!raw.title || !url) throw new Error('title and url are required');
  // URL row is the dedupe guard — first writer wins, like the val's UNIQUE(url).
  try {
    await ddb.send(new PutCommand({
      TableName: TABLE,
      Item: { pk: 'URL', sk: url, id },
      ConditionExpression: 'attribute_not_exists(pk)',
    }));
  } catch {
    return false; // duplicate URL — skip, matching INSERT OR IGNORE
  }
  const collected_at = collectedAt ?? now();
  const feedSk = `${collected_at}#${id}`;
  const item: Item = {
    id,
    source_id: (raw.source_id as string) || null,
    title: String(raw.title),
    url,
    published_at: (raw.published_at as string) || null,
    collected_at,
    body_md: String(raw.body_md ?? ''),
    summary: String(raw.summary ?? ''),
    category: String(raw.category ?? 'other'),
    relevance_signals: (raw.relevance_signals as Record<string, unknown>) ?? {},
    status: (raw.status as Item['status']) ?? 'unreviewed',
    meta: (raw.meta as Record<string, unknown>) ?? {},
  };
  await ddb.send(new PutCommand({ TableName: TABLE, Item: { pk: 'ITEM', sk: feedSk, ...item } }));
  await ddb.send(new PutCommand({ TableName: TABLE, Item: { pk: 'ITEMID', sk: id, feedSk } }));
  return true;
}

const ITEM_LIST_PROJECTION = 'id, source_id, title, #u, published_at, collected_at, category, summary, #st, relevance_signals';
const ITEM_LIST_NAMES = { '#st': 'status', '#u': 'url' };

export async function listItems(opts: { status?: string; since?: string; limit?: number } = {}): Promise<Record<string, unknown>[]> {
  const limit = Math.min(opts.limit ?? 50, 200);
  const out: Record<string, unknown>[] = [];
  let cursor: Record<string, unknown> | undefined;
  do {
    const res = await ddb.send(new QueryCommand({
      TableName: TABLE,
      KeyConditionExpression: opts.since ? 'pk = :pk AND sk >= :since' : 'pk = :pk',
      ExpressionAttributeValues: { ':pk': 'ITEM', ...(opts.since ? { ':since': opts.since } : {}) },
      ScanIndexForward: false,
      ProjectionExpression: ITEM_LIST_PROJECTION,
      ExpressionAttributeNames: ITEM_LIST_NAMES,
      ExclusiveStartKey: cursor,
    }));
    for (const it of (res.Items ?? []) as Record<string, unknown>[]) {
      if (opts.status && it.status !== opts.status) continue;
      out.push(it);
      if (out.length >= limit) return out;
    }
    cursor = res.LastEvaluatedKey as Record<string, unknown> | undefined;
  } while (cursor);
  return out;
}

async function feedSkOf(id: string): Promise<string | null> {
  const res = await ddb.send(new GetCommand({ TableName: TABLE, Key: { pk: 'ITEMID', sk: id } }));
  return (res.Item as { feedSk?: string } | undefined)?.feedSk ?? null;
}

export async function getItem(id: string): Promise<Item | null> {
  const feedSk = await feedSkOf(id);
  if (!feedSk) return null;
  const res = await ddb.send(new GetCommand({ TableName: TABLE, Key: { pk: 'ITEM', sk: feedSk } }));
  return (res.Item as Item | undefined) ?? null;
}

export async function setItemStatus(id: string, status: Item['status']): Promise<void> {
  const feedSk = await feedSkOf(id);
  if (!feedSk) throw new Error(`unknown item "${id}"`);
  await ddb.send(new UpdateCommand({
    TableName: TABLE,
    Key: { pk: 'ITEM', sk: feedSk },
    UpdateExpression: 'SET #st = :s',
    ExpressionAttributeNames: { '#st': 'status' },
    ExpressionAttributeValues: { ':s': status },
  }));
}

/* ── reviews ────────────────────────────────────────────────────── */

export async function putReview(
  item: Item,
  r: { relevance: string; applicability?: unknown; notes?: string; action_required?: boolean },
  reviewer: string,
): Promise<Review> {
  const review: Review = {
    item_id: item.id,
    relevance: r.relevance,
    applicability: r.applicability ?? null,
    notes: r.notes ?? '',
    action_required: !!r.action_required,
    reviewer,
    reviewed_at: now(),
    category: item.category,
    source_id: item.source_id,
    relevance_signals: item.relevance_signals,
  };
  await ddb.send(new PutCommand({ TableName: TABLE, Item: { pk: 'REVIEW', sk: item.id, ...review } }));
  return review;
}

export async function getReview(itemId: string): Promise<Review | null> {
  const res = await ddb.send(new GetCommand({ TableName: TABLE, Key: { pk: 'REVIEW', sk: itemId } }));
  return (res.Item as Review | undefined) ?? null;
}

export const listReviews = (): Promise<Record<string, unknown>[]> => queryAll('REVIEW');

/* ── sources ────────────────────────────────────────────────────── */

export interface Source {
  id: string;
  name: string;
  url: string;
  search_queries: string[];
  fetch_urls: string[];
  frequency: string;
  category: string;
  active: boolean;
  last_checked?: string | null;
}

export async function putSource(s: Source): Promise<void> {
  await ddb.send(new PutCommand({ TableName: TABLE, Item: { pk: 'SOURCE', sk: s.id, ...s } }));
}

export async function getSource(id: string): Promise<Source | null> {
  const res = await ddb.send(new GetCommand({ TableName: TABLE, Key: { pk: 'SOURCE', sk: id } }));
  return (res.Item as Source | undefined) ?? null;
}

export const listSources = (): Promise<Record<string, unknown>[]> => queryAll('SOURCE');

/* ── prompts ────────────────────────────────────────────────────── */

export interface PromptVersion {
  name: string;
  version: number;
  prompt_text: string;
  notes: string;
  created_at: string;
  active: boolean;
}

const promptSk = (name: string, version: number): string => `${name}#v${String(version).padStart(4, '0')}`;

export async function putPromptVersion(p: PromptVersion): Promise<void> {
  await ddb.send(new PutCommand({ TableName: TABLE, Item: { pk: 'PROMPT', sk: promptSk(p.name, p.version), ...p } }));
}

export async function listPromptVersions(name: string): Promise<PromptVersion[]> {
  const all = (await queryAll('PROMPT', { desc: true })) as unknown as PromptVersion[];
  return all.filter((p) => p.name === name);
}

export async function getActivePrompt(name: string): Promise<PromptVersion | null> {
  return (await listPromptVersions(name)).find((p) => p.active) ?? null;
}

export async function createPromptVersion(name: string, prompt_text: string, notes: string): Promise<{ name: string; version: number }> {
  const versions = await listPromptVersions(name);
  for (const v of versions.filter((p) => p.active)) {
    await ddb.send(new UpdateCommand({
      TableName: TABLE,
      Key: { pk: 'PROMPT', sk: promptSk(v.name, v.version) },
      UpdateExpression: 'SET active = :f',
      ExpressionAttributeValues: { ':f': false },
    }));
  }
  const version = (versions[0]?.version ?? 0) + 1;
  await putPromptVersion({ name, version, prompt_text, notes, created_at: now(), active: true });
  return { name, version };
}

/* ── collector notes ────────────────────────────────────────────── */

export interface Note {
  id: string;
  content: string;
  status: 'open' | 'resolved' | 'dismissed';
  resolution: string;
  created_at: string;
  resolved_at: string | null;
}

export async function putNote(note: Note): Promise<void> {
  const noteSk = `${note.created_at}#${note.id}`;
  await ddb.send(new PutCommand({ TableName: TABLE, Item: { pk: 'NOTE', sk: noteSk, ...note } }));
  await ddb.send(new PutCommand({ TableName: TABLE, Item: { pk: 'NOTEID', sk: note.id, noteSk } }));
}

export async function listNotes(status: 'open' | 'resolved' | 'all' = 'open'): Promise<Note[]> {
  const all = (await queryAll('NOTE', { desc: true, max: 400 })) as unknown as Note[];
  const filtered = status === 'all' ? all : all.filter((n) => (status === 'resolved' ? n.status !== 'open' : n.status === status));
  return filtered.slice(0, 200);
}

export async function resolveNote(id: string, resolution: string): Promise<{ ok: boolean; status: string }> {
  const ptr = await ddb.send(new GetCommand({ TableName: TABLE, Key: { pk: 'NOTEID', sk: id } }));
  const noteSk = (ptr.Item as { noteSk?: string } | undefined)?.noteSk;
  if (!noteSk) throw new Error(`unknown note "${id}"`);
  const trimmed = resolution.trim();
  const status = trimmed ? 'resolved' : 'dismissed';
  await ddb.send(new UpdateCommand({
    TableName: TABLE,
    Key: { pk: 'NOTE', sk: noteSk },
    UpdateExpression: 'SET #st = :s, resolution = :r, resolved_at = :t',
    ExpressionAttributeNames: { '#st': 'status' },
    ExpressionAttributeValues: { ':s': status, ':r': trimmed, ':t': now() },
  }));
  return { ok: true, status };
}

/* ── stats ──────────────────────────────────────────────────────── */

export async function stats(): Promise<Record<string, unknown>> {
  const items = await queryAll('ITEM', {
    projection: '#st, category, source_id',
    names: { '#st': 'status' },
  });
  const count = (key: string): Record<string, number> => {
    const acc: Record<string, number> = {};
    for (const it of items) {
      const k = String(it[key] ?? 'unknown');
      acc[k] = (acc[k] ?? 0) + 1;
    }
    return acc;
  };
  const reviews = await listReviews();
  const weekAgo = new Date(Date.now() - 7 * 86400_000).toISOString().slice(0, 19).replace('T', ' ');
  const notes = await listNotes('open');
  return {
    total: items.length,
    by_status: count('status'),
    by_category: count('category'),
    by_source: count('source_id'),
    reviews_total: reviews.length,
    reviews_last_7d: reviews.filter((r) => String(r.reviewed_at ?? '') >= weekAgo).length,
    open_notes: notes.length,
  };
}
