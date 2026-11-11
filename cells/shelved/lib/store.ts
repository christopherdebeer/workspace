import { createHash, randomUUID } from 'node:crypto';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, PutCommand, QueryCommand, TransactWriteCommand } from '@aws-sdk/lib-dynamodb';
import type { AddBookInput, BookCopy, BorrowRequest, DiscoverCopy, Edition, Loan } from '../shared/types';
import { ensureProfile, notifyAvailability, setUserBook, upsertWork, workIdFor } from './social';

const TABLE = process.env.TABLE_NAME ?? '';
const OWNER = process.env.CELL_OWNER ?? 'c15r';
const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}), { marshallOptions: { removeUndefinedValues: true } });
const userPk = (caller: string): string => `USER#${caller}`;
const copySk = (id: string): string => `COPY#${id}`;
/**
 * Is this copy actually offerable right now?
 *
 * `availability` alone was the test, which conflated the owner's standing
 * intent with whether the book is free — so a copy stayed in the discover
 * index after its request was accepted, and a second reader could be accepted
 * for the same physical book. A live loan takes it out of circulation until it
 * comes back (or, for a pass, for good).
 */
const isPublic = (copy: BookCopy): boolean => copy.availability !== 'private' && !copy.loan;

/** Read one of the owner's copies. */
async function ownedCopy(ownerId: string, copyId: string): Promise<BookCopy | null> {
  const row = await ddb.send(new GetCommand({ TableName: TABLE, Key: { pk: userPk(ownerId), sk: copySk(copyId) } }));
  return (row.Item?.value as BookCopy | undefined) ?? null;
}

/** Re-persist a copy with its loan set or cleared, which moves it in/out of discovery. */
async function setLoan(ownerId: string, copyId: string, loan: Loan | undefined): Promise<void> {
  const copy = await ownedCopy(ownerId, copyId);
  if (!copy) return; // the copy was removed underneath the request; nothing to reserve
  const next: BookCopy = { ...copy, updatedAt: new Date().toISOString() };
  if (loan) next.loan = loan; else delete next.loan;
  // `announceAvailability` false: coming back from a loan is not a new arrival,
  // and notifying every watcher each time a book is returned would be noise.
  await persist(next, false);
}

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

/**
 * Who may move a request where.
 *
 * There used to be no way OUT of `accepted`: the owner could accept and then
 * the request sat there permanently, the copy never left the discover index,
 * and a posted book was indistinguishable from one still on the shelf. Each
 * entry is `from -> [to, who]`, because most of these are only sensible from
 * one side — the owner says it is on its way, the borrower says it arrived.
 */
export const TRANSITIONS: Record<string, Array<{ to: BorrowRequest['status']; by: 'owner' | 'requester' | 'either' }>> = {
  pending: [
    { to: 'accepted', by: 'owner' },
    { to: 'declined', by: 'owner' },
    { to: 'cancelled', by: 'requester' },
  ],
  // Still recallable until it moves: plans change, and a copy stuck reserved
  // forever because someone went quiet is worse than an ungraceful cancel.
  accepted: [
    { to: 'shipped', by: 'owner' },
    { to: 'cancelled', by: 'either' },
  ],
  shipped: [{ to: 'delivered', by: 'requester' }],
  // A lend goes back; a pass is done when it lands. Which of these is offered
  // depends on the copy's kind, enforced below rather than here.
  delivered: [
    { to: 'returned', by: 'either' },
    { to: 'completed', by: 'either' },
  ],
  returned: [{ to: 'completed', by: 'either' }],
};

export async function updateBorrowRequest(caller: string, requestId: string, status: BorrowRequest['status']): Promise<BorrowRequest> {
  const lists = await listBorrowRequests(caller);
  const current = [...lists.incoming, ...lists.outgoing].find((request) => request.id === requestId);
  if (!current) throw Object.assign(new Error('request not found'), { statusCode: 404 });
  const isOwner = current.ownerId === caller;
  const move = (TRANSITIONS[current.status] ?? []).find((t) => t.to === status);
  if (!move) throw Object.assign(new Error(`a ${current.status} request cannot become ${status}`), { statusCode: 400 });
  if (move.by !== 'either' && (move.by === 'owner') !== isOwner) {
    throw Object.assign(new Error(move.by === 'owner' ? 'only the owner can do that' : 'only the borrower can do that'), { statusCode: 403 });
  }
  const next: BorrowRequest = { ...current, status, updatedAt: new Date().toISOString() };
  await ddb.send(new TransactWriteCommand({ TransactItems: [
    { Put: { TableName: TABLE, Item: { pk: userPk(current.ownerId), sk: `REQUEST#${current.copyId}#${current.requesterId}`, entity: 'borrow-request', value: next } } },
    { Put: { TableName: TABLE, Item: { pk: userPk(current.requesterId), sk: `SENT#${current.copyId}#${current.ownerId}`, entity: 'borrow-request-sent', value: next } } },
  ] }));
  await applyLoanFor(next);
  return next;
}

/**
 * Keep the copy in step with its request.
 *
 * Written after the request, not inside its transaction: the two live under
 * different partition keys and a copy that lags its request by a moment is
 * recoverable, whereas a request that cannot be accepted because the copy row
 * moved is not. Worst case the copy stays reserved a beat too long.
 */
async function applyLoanFor(request: BorrowRequest): Promise<void> {
  const copy = await ownedCopy(request.ownerId, request.copyId);
  if (!copy) return;
  const kind: Loan['kind'] = copy.availability === 'pass' ? 'pass' : 'lend';
  const base = { requestId: request.id, withId: request.requesterId, kind, since: request.updatedAt };
  switch (request.status) {
    case 'accepted': return setLoan(request.ownerId, request.copyId, { ...base, status: 'reserved' });
    case 'shipped': return setLoan(request.ownerId, request.copyId, { ...base, status: 'in-transit' });
    case 'delivered': return setLoan(request.ownerId, request.copyId, { ...base, status: 'held' });
    case 'returned': return setLoan(request.ownerId, request.copyId, { ...base, status: 'returning' });
    // Terminal, and the two kinds end differently: a lend comes back into
    // circulation, a pass has changed hands.
    case 'completed': return kind === 'pass'
      ? transferCopy(request)
      : setLoan(request.ownerId, request.copyId, undefined);
    case 'declined':
    case 'cancelled': return setLoan(request.ownerId, request.copyId, undefined);
    default: return;
  }
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

/**
 * Move a passed-on copy to the reader who received it.
 *
 * "Pass on" means the book is theirs now, so the record follows the object
 * rather than being deleted — deleting would throw away the edition data we
 * looked up from the ISBN and leave the new owner re-scanning a book they are
 * holding. The copy keeps its id, so the request history still points at it.
 *
 * The new row is written BEFORE the old one is removed. Neither order is
 * atomic across two partition keys, and of the two failure modes a book that
 * briefly exists twice is recoverable while one that exists nowhere is not.
 *
 * What does not travel: the previous owner's lending intent, their private
 * note, and their reading state. Those were about them.
 */
async function transferCopy(request: BorrowRequest): Promise<void> {
  const copy = await ownedCopy(request.ownerId, request.copyId);
  if (!copy) return;
  const stamp = new Date().toISOString();
  const moved: BookCopy = { ...copy, ownerId: request.requesterId, availability: 'private', readingState: 'unread', addedAt: stamp, updatedAt: stamp };
  delete moved.loan;
  delete moved.note;
  await persist(moved, false);
  await ddb.send(new TransactWriteCommand({ TransactItems: [
    { Delete: { TableName: TABLE, Key: { pk: userPk(request.ownerId), sk: copySk(request.copyId) } } },
  ] }));
}
