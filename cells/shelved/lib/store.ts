import { createHash, randomUUID } from 'node:crypto';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, PutCommand, QueryCommand, TransactWriteCommand } from '@aws-sdk/lib-dynamodb';
import type { AddBookInput, BookCopy, BorrowRequest, DiscoverCopy, Edition } from '../shared/types';
import { ensureProfile, notifyAvailability, setUserBook, upsertWork, workIdFor } from './social';

const TABLE = process.env.TABLE_NAME ?? '';
const OWNER = process.env.CELL_OWNER ?? 'c15r';
const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}), { marshallOptions: { removeUndefinedValues: true } });
const userPk = (caller: string): string => `USER#${caller}`;
const copySk = (id: string): string => `COPY#${id}`;
const isPublic = (copy: BookCopy): boolean => copy.availability !== 'private';

function discovery(copy: BookCopy, shelfLabel?: string): DiscoverCopy {
  const shelfId = createHash('sha256').update(copy.ownerId).digest('hex').slice(0, 12);
  return {
    id: copy.id,
    workId: copy.workId || workIdFor(copy),
    shelfId,
    shelfLabel: shelfLabel ?? (copy.ownerId === OWNER ? 'Chris’s shelf' : 'A reader’s shelf'),
    isbn: copy.isbn,
    title: copy.title,
    authors: copy.authors,
    coverUrl: copy.coverUrl,
    publisher: copy.publisher,
    publishedDate: copy.publishedDate,
    genres: copy.genres,
    availability: copy.availability as DiscoverCopy['availability'],
    condition: copy.condition,
    addedAt: copy.addedAt,
  };
}

async function persist(input: BookCopy, announceAvailability = false): Promise<BookCopy> {
  const [work, profile] = await Promise.all([upsertWork(input), ensureProfile(input.ownerId)]);
  const copy: BookCopy = { ...input, workId: work.id };
  const publicCopy = discovery(copy, `${profile.displayName}’s shelf`);
  const publicAction = isPublic(copy)
    ? { Put: { TableName: TABLE, Item: { pk: 'DISCOVER', sk: copySk(copy.id), entity: 'discover-copy', ownerId: copy.ownerId, value: publicCopy } } }
    : { Delete: { TableName: TABLE, Key: { pk: 'DISCOVER', sk: copySk(copy.id) } } };
  const workCopyAction = isPublic(copy)
    ? { Put: { TableName: TABLE, Item: { pk: `WORK#${work.id}`, sk: copySk(copy.id), entity: 'work-copy', ownerId: copy.ownerId, value: publicCopy } } }
    : { Delete: { TableName: TABLE, Key: { pk: `WORK#${work.id}`, sk: copySk(copy.id) } } };
  await ddb.send(new TransactWriteCommand({ TransactItems: [
    { Put: { TableName: TABLE, Item: { pk: userPk(copy.ownerId), sk: copySk(copy.id), entity: 'copy', isbn: copy.isbn, value: copy } } },
    publicAction,
    workCopyAction,
  ] }));
  if (announceAvailability && isPublic(copy)) await notifyAvailability(publicCopy);
  return copy;
}

export async function listBooks(caller: string): Promise<BookCopy[]> {
  const res = await ddb.send(new QueryCommand({ TableName: TABLE, KeyConditionExpression: 'pk = :pk AND begins_with(sk, :copy)', ExpressionAttributeValues: { ':pk': userPk(caller), ':copy': 'COPY#' } }));
  return (res.Items ?? []).map((row) => row.value as BookCopy).sort((a, b) => b.addedAt.localeCompare(a.addedAt));
}

export async function listDiscovery(limit = 60): Promise<DiscoverCopy[]> {
  const res = await ddb.send(new QueryCommand({ TableName: TABLE, KeyConditionExpression: 'pk = :pk', ExpressionAttributeValues: { ':pk': 'DISCOVER' }, Limit: Math.min(Math.max(limit, 1), 100) }));
  return (res.Items ?? []).map((row) => row.value as DiscoverCopy).sort((a, b) => b.addedAt.localeCompare(a.addedAt));
}

export async function getBook(caller: string, id: string): Promise<BookCopy | null> {
  const res = await ddb.send(new GetCommand({ TableName: TABLE, Key: { pk: userPk(caller), sk: copySk(id) } }));
  return (res.Item?.value as BookCopy | undefined) ?? null;
}

export async function addBook(caller: string, input: AddBookInput): Promise<BookCopy> {
  const stamp = new Date().toISOString();
  const copy: BookCopy = { ...input, id: randomUUID(), ownerId: caller, readingState: input.readingState ?? 'unread', availability: input.availability ?? 'private', addedAt: stamp, updatedAt: stamp };
  const stored = await persist(copy, isPublic(copy));
  if (stored.readingState !== 'unread') await setUserBook(caller, stored.workId!, stored.readingState === 'want' ? 'want' : stored.readingState);
  return stored;
}

export async function updateBook(caller: string, id: string, patch: Partial<BookCopy>): Promise<BookCopy | null> {
  const current = await getBook(caller, id);
  if (!current) return null;
  const next: BookCopy = { ...current, ...patch, id: current.id, ownerId: caller, addedAt: current.addedAt, updatedAt: new Date().toISOString() };
  const stored = await persist(next, !isPublic(current) && isPublic(next));
  if (patch.readingState && patch.readingState !== 'unread') await setUserBook(caller, stored.workId!, patch.readingState === 'want' ? 'want' : patch.readingState);
  return stored;
}

export async function removeBook(caller: string, id: string): Promise<boolean> {
  const current = await getBook(caller, id);
  if (!current) return false;
  await ddb.send(new TransactWriteCommand({ TransactItems: [
    { Delete: { TableName: TABLE, Key: { pk: userPk(caller), sk: copySk(id) } } },
    { Delete: { TableName: TABLE, Key: { pk: 'DISCOVER', sk: copySk(id) } } },
    { Delete: { TableName: TABLE, Key: { pk: `WORK#${current.workId || workIdFor(current)}`, sk: copySk(id) } } },
  ] }));
  return true;
}

export async function requestBook(caller: string, copyId: string, deliveryMethod: BorrowRequest['deliveryMethod'] = 'local', message?: string): Promise<BorrowRequest> {
  const publicCopy = await ddb.send(new GetCommand({ TableName: TABLE, Key: { pk: 'DISCOVER', sk: copySk(copyId) } }));
  const book = publicCopy.Item?.value as DiscoverCopy | undefined;
  const ownerId = publicCopy.Item?.ownerId as string | undefined;
  if (!book || !ownerId) throw Object.assign(new Error('This book is no longer available.'), { statusCode: 404 });
  if (ownerId === caller) throw Object.assign(new Error('This is your own copy.'), { statusCode: 400 });
  const stamp = new Date().toISOString();
  const request: BorrowRequest = { id: randomUUID(), copyId, title: book.title, coverUrl: book.coverUrl, requesterId: caller, ownerId, status: 'pending', deliveryMethod, message: message?.trim().slice(0, 500) || undefined, createdAt: stamp, updatedAt: stamp };
  await ddb.send(new TransactWriteCommand({ TransactItems: [
    { Put: { TableName: TABLE, Item: { pk: userPk(ownerId), sk: `REQUEST#${copyId}#${caller}`, entity: 'borrow-request', value: request } } },
    { Put: { TableName: TABLE, Item: { pk: userPk(caller), sk: `SENT#${copyId}#${ownerId}`, entity: 'borrow-request-sent', value: request } } },
  ] }));
  return request;
}

export async function updateBorrowRequest(caller: string, requestId: string, status: BorrowRequest['status']): Promise<BorrowRequest> {
  const lists = await listBorrowRequests(caller);
  const current = [...lists.incoming, ...lists.outgoing].find((request) => request.id === requestId);
  if (!current) throw Object.assign(new Error('request not found'), { statusCode: 404 });
  const isOwner = current.ownerId === caller;
  const allowed = isOwner ? ['accepted', 'declined'] : ['cancelled'];
  if (current.status !== 'pending' || !allowed.includes(status)) throw Object.assign(new Error('that request cannot make this transition'), { statusCode: 400 });
  const next: BorrowRequest = { ...current, status, updatedAt: new Date().toISOString() };
  await ddb.send(new TransactWriteCommand({ TransactItems: [
    { Put: { TableName: TABLE, Item: { pk: userPk(current.ownerId), sk: `REQUEST#${current.copyId}#${current.requesterId}`, entity: 'borrow-request', value: next } } },
    { Put: { TableName: TABLE, Item: { pk: userPk(current.requesterId), sk: `SENT#${current.copyId}#${current.ownerId}`, entity: 'borrow-request-sent', value: next } } },
  ] }));
  return next;
}

export async function listBorrowRequests(caller: string): Promise<{ incoming: BorrowRequest[]; outgoing: BorrowRequest[] }> {
  const query = (prefix: string) => ddb.send(new QueryCommand({ TableName: TABLE, KeyConditionExpression: 'pk = :pk AND begins_with(sk, :prefix)', ExpressionAttributeValues: { ':pk': userPk(caller), ':prefix': prefix } }));
  const [incoming, outgoing] = await Promise.all([query('REQUEST#'), query('SENT#')]);
  return {
    incoming: (incoming.Items ?? []).map((row) => row.value as BorrowRequest),
    outgoing: (outgoing.Items ?? []).map((row) => row.value as BorrowRequest),
  };
}

export async function getEdition(isbn: string): Promise<Edition | null> {
  const res = await ddb.send(new GetCommand({ TableName: TABLE, Key: { pk: 'EDITION', sk: `ISBN#${isbn}` } }));
  return (res.Item?.value as Edition | undefined) ?? null;
}

export async function putEdition(edition: Edition): Promise<void> {
  await ddb.send(new PutCommand({ TableName: TABLE, Item: { pk: 'EDITION', sk: `ISBN#${edition.isbn}`, entity: 'edition', cachedAt: new Date().toISOString(), value: edition } }));
}
