import { createHash, randomUUID } from 'node:crypto';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { BatchWriteCommand, DynamoDBDocumentClient, GetCommand, PutCommand, QueryCommand, TransactWriteCommand } from '@aws-sdk/lib-dynamodb';
import type { AvailabilityNotification, DiscoverCopy, Edition, PublicBookView, PublicProfile, SocialGraph, UserBook, UserBookState, Work } from '../shared/types';

const TABLE = process.env.TABLE_NAME ?? '';
const OWNER = process.env.CELL_OWNER ?? 'c15r';
const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}), { marshallOptions: { removeUndefinedValues: true } });
const userPk = (caller: string): string => `USER#${caller}`;
export const profileIdFor = (caller: string): string => createHash('sha256').update(caller).digest('hex').slice(0, 12);
export const workIdFor = (edition: Pick<Edition, 'title' | 'authors'>): string => `w_${createHash('sha256').update(`${edition.title.trim().toLowerCase()}|${(edition.authors[0] ?? '').trim().toLowerCase()}`).digest('hex').slice(0, 16)}`;

export async function upsertWork(edition: Edition): Promise<Work> {
  const id = edition.workId || workIdFor(edition);
  const current = await ddb.send(new GetCommand({ TableName: TABLE, Key: { pk: 'CATALOG', sk: `WORK#${id}` } }));
  const previous = current.Item?.value as Work | undefined;
  const work: Work = {
    id,
    title: edition.title,
    authors: edition.authors,
    coverUrl: edition.coverUrl || previous?.coverUrl,
    genres: edition.genres?.length ? edition.genres : previous?.genres,
    firstPublished: edition.publishedDate || previous?.firstPublished,
    editionIsbns: Array.from(new Set([...(previous?.editionIsbns ?? []), edition.isbn])),
  };
  await ddb.send(new PutCommand({ TableName: TABLE, Item: { pk: 'CATALOG', sk: `WORK#${id}`, entity: 'work', value: work } }));
  return work;
}

export async function getPublicBook(workId: string, caller?: string | null): Promise<PublicBookView | null> {
  const [workResult, copiesResult, userResult] = await Promise.all([
    ddb.send(new GetCommand({ TableName: TABLE, Key: { pk: 'CATALOG', sk: `WORK#${workId}` } })),
    ddb.send(new QueryCommand({ TableName: TABLE, KeyConditionExpression: 'pk = :pk AND begins_with(sk, :copy)', ExpressionAttributeValues: { ':pk': `WORK#${workId}`, ':copy': 'COPY#' } })),
    caller ? ddb.send(new GetCommand({ TableName: TABLE, Key: { pk: userPk(caller), sk: `USERBOOK#${workId}` } })) : Promise.resolve({}),
  ]);
  const work = workResult.Item?.value as Work | undefined;
  if (!work) return null;
  return { work, copies: (copiesResult.Items ?? []).map((row) => row.value as DiscoverCopy), userBook: (userResult as { Item?: { value?: UserBook } }).Item?.value };
}

export async function ensureProfile(caller: string): Promise<PublicProfile> {
  const existing = await ddb.send(new GetCommand({ TableName: TABLE, Key: { pk: userPk(caller), sk: 'PROFILE' } }));
  if (existing.Item?.value) return existing.Item.value as PublicProfile;
  const id = profileIdFor(caller);
  const profile: PublicProfile = { id, handle: caller === OWNER ? 'c15r' : `reader-${id.slice(0, 6)}`, displayName: caller === OWNER ? 'Chris' : 'A reader', joinedAt: new Date().toISOString() };
  await ddb.send(new TransactWriteCommand({ TransactItems: [
    { Put: { TableName: TABLE, Item: { pk: userPk(caller), sk: 'PROFILE', entity: 'private-profile', value: profile } } },
    { Put: { TableName: TABLE, Item: { pk: 'PROFILES', sk: `PROFILE#${id}`, entity: 'public-profile', ownerId: caller, value: profile } } },
  ] }));
  return profile;
}

export async function updateProfile(caller: string, patch: Partial<Pick<PublicProfile, 'handle' | 'displayName' | 'bio' | 'location' | 'favouriteGenres'>>): Promise<PublicProfile> {
  const current = await ensureProfile(caller);
  const cleanHandle = patch.handle?.toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 28);
  const next: PublicProfile = { ...current, handle: cleanHandle || current.handle, displayName: patch.displayName?.trim().slice(0, 60) || current.displayName, bio: patch.bio?.trim().slice(0, 280) || undefined, location: patch.location?.trim().slice(0, 80) || undefined, favouriteGenres: patch.favouriteGenres?.map((value) => value.trim()).filter(Boolean).slice(0, 8) };
  await ddb.send(new TransactWriteCommand({ TransactItems: [
    { Put: { TableName: TABLE, Item: { pk: userPk(caller), sk: 'PROFILE', entity: 'private-profile', value: next } } },
    { Put: { TableName: TABLE, Item: { pk: 'PROFILES', sk: `PROFILE#${next.id}`, entity: 'public-profile', ownerId: caller, value: next } } },
  ] }));
  return next;
}

export async function listProfiles(): Promise<PublicProfile[]> {
  const result = await ddb.send(new QueryCommand({ TableName: TABLE, KeyConditionExpression: 'pk = :pk', ExpressionAttributeValues: { ':pk': 'PROFILES' } }));
  return (result.Items ?? []).map((row) => row.value as PublicProfile);
}

export async function getProfile(profileId: string): Promise<{ profile: PublicProfile; books: DiscoverCopy[]; reading: UserBook[] } | null> {
  const [profileResult, booksResult, readingResult] = await Promise.all([
    ddb.send(new GetCommand({ TableName: TABLE, Key: { pk: 'PROFILES', sk: `PROFILE#${profileId}` } })),
    ddb.send(new QueryCommand({ TableName: TABLE, KeyConditionExpression: 'pk = :pk', ExpressionAttributeValues: { ':pk': 'DISCOVER' } })),
    ddb.send(new QueryCommand({ TableName: TABLE, KeyConditionExpression: 'pk = :pk AND begins_with(sk, :prefix)', ExpressionAttributeValues: { ':pk': `PROFILE#${profileId}`, ':prefix': 'USERBOOK#' } })),
  ]);
  const profile = profileResult.Item?.value as PublicProfile | undefined;
  if (!profile) return null;
  return { profile, books: (booksResult.Items ?? []).map((row) => row.value as DiscoverCopy).filter((book) => book.shelfId === profileId), reading: (readingResult.Items ?? []).map((row) => row.value as UserBook) };
}

export async function followProfile(caller: string, targetProfileId: string): Promise<void> {
  const me = await ensureProfile(caller);
  const target = await ddb.send(new GetCommand({ TableName: TABLE, Key: { pk: 'PROFILES', sk: `PROFILE#${targetProfileId}` } }));
  const profile = target.Item?.value as PublicProfile | undefined;
  if (!profile || !target.Item?.ownerId) throw Object.assign(new Error('reader not found'), { statusCode: 404 });
  if (profile.id === me.id) throw new Error('you cannot follow yourself');
  await ddb.send(new TransactWriteCommand({ TransactItems: [
    { Put: { TableName: TABLE, Item: { pk: userPk(caller), sk: `FOLLOWING#${profile.id}`, entity: 'following', value: profile } } },
    { Put: { TableName: TABLE, Item: { pk: `PROFILE#${profile.id}`, sk: `FOLLOWER#${me.id}`, entity: 'follower', value: me } } },
  ] }));
}

export async function unfollowProfile(caller: string, targetProfileId: string): Promise<void> {
  const me = await ensureProfile(caller);
  await ddb.send(new TransactWriteCommand({ TransactItems: [
    { Delete: { TableName: TABLE, Key: { pk: userPk(caller), sk: `FOLLOWING#${targetProfileId}` } } },
    { Delete: { TableName: TABLE, Key: { pk: `PROFILE#${targetProfileId}`, sk: `FOLLOWER#${me.id}` } } },
  ] }));
}

export async function socialGraph(caller: string): Promise<SocialGraph> {
  const profile = await ensureProfile(caller);
  const query = (pk: string, prefix: string) => ddb.send(new QueryCommand({ TableName: TABLE, KeyConditionExpression: 'pk = :pk AND begins_with(sk, :prefix)', ExpressionAttributeValues: { ':pk': pk, ':prefix': prefix } }));
  const [following, followers] = await Promise.all([query(userPk(caller), 'FOLLOWING#'), query(`PROFILE#${profile.id}`, 'FOLLOWER#')]);
  return { profile, following: (following.Items ?? []).map((row) => row.value as PublicProfile), followers: (followers.Items ?? []).map((row) => row.value as PublicProfile) };
}

export async function setUserBook(caller: string, workId: string, state: UserBookState): Promise<UserBook> {
  const profile = await ensureProfile(caller);
  const workResult = await ddb.send(new GetCommand({ TableName: TABLE, Key: { pk: 'CATALOG', sk: `WORK#${workId}` } }));
  const work = workResult.Item?.value as Work | undefined;
  if (!work) throw Object.assign(new Error('book not found'), { statusCode: 404 });
  const current = await ddb.send(new GetCommand({ TableName: TABLE, Key: { pk: userPk(caller), sk: `USERBOOK#${workId}` } }));
  const stamp = new Date().toISOString();
  const userBook: UserBook = { workId, state, work, createdAt: (current.Item?.value as UserBook | undefined)?.createdAt ?? stamp, updatedAt: stamp };
  const watch = state === 'want'
    ? { Put: { TableName: TABLE, Item: { pk: `WATCH#${workId}`, sk: `USER#${caller}`, entity: 'availability-watch', userId: caller } } }
    : { Delete: { TableName: TABLE, Key: { pk: `WATCH#${workId}`, sk: `USER#${caller}` } } };
  await ddb.send(new TransactWriteCommand({ TransactItems: [
    { Put: { TableName: TABLE, Item: { pk: userPk(caller), sk: `USERBOOK#${workId}`, entity: 'user-book', value: userBook } } },
    { Put: { TableName: TABLE, Item: { pk: `PROFILE#${profile.id}`, sk: `USERBOOK#${workId}`, entity: 'public-user-book', value: userBook } } },
    watch,
  ] }));
  return userBook;
}

export async function listUserBooks(caller: string): Promise<UserBook[]> {
  const result = await ddb.send(new QueryCommand({ TableName: TABLE, KeyConditionExpression: 'pk = :pk AND begins_with(sk, :prefix)', ExpressionAttributeValues: { ':pk': userPk(caller), ':prefix': 'USERBOOK#' } }));
  return (result.Items ?? []).map((row) => row.value as UserBook).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export async function notifyAvailability(book: DiscoverCopy): Promise<void> {
  if (!book.workId) return;
  const watchers = await ddb.send(new QueryCommand({ TableName: TABLE, KeyConditionExpression: 'pk = :pk', ExpressionAttributeValues: { ':pk': `WATCH#${book.workId}` }, Limit: 50 }));
  const requests = (watchers.Items ?? []).flatMap((watcher) => {
    const userId = watcher.userId as string | undefined;
    if (!userId || profileIdFor(userId) === book.shelfId) return [];
    const notice: AvailabilityNotification = { id: randomUUID(), type: 'available', workId: book.workId!, copyId: book.id, title: book.title, coverUrl: book.coverUrl, shelfLabel: book.shelfLabel, read: false, createdAt: new Date().toISOString() };
    return [{ PutRequest: { Item: { pk: userPk(userId), sk: `NOTICE#${book.workId}#${book.id}`, entity: 'notification', value: notice } } }];
  });
  if (requests.length) await ddb.send(new BatchWriteCommand({ RequestItems: { [TABLE]: requests.slice(0, 25) } }));
}

export async function listNotifications(caller: string): Promise<AvailabilityNotification[]> {
  const result = await ddb.send(new QueryCommand({ TableName: TABLE, KeyConditionExpression: 'pk = :pk AND begins_with(sk, :prefix)', ExpressionAttributeValues: { ':pk': userPk(caller), ':prefix': 'NOTICE#' } }));
  return (result.Items ?? []).map((row) => row.value as AvailabilityNotification).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function markNotificationRead(caller: string, workId: string, copyId: string): Promise<void> {
  const key = { pk: userPk(caller), sk: `NOTICE#${workId}#${copyId}` };
  const current = await ddb.send(new GetCommand({ TableName: TABLE, Key: key }));
  if (!current.Item?.value) return;
  await ddb.send(new PutCommand({ TableName: TABLE, Item: { ...current.Item, value: { ...(current.Item.value as AvailabilityNotification), read: true } } }));
}

export async function browseFor(caller: string): Promise<DiscoverCopy[]> {
  const [booksResult, graph, userBooks] = await Promise.all([
    ddb.send(new QueryCommand({ TableName: TABLE, KeyConditionExpression: 'pk = :pk', ExpressionAttributeValues: { ':pk': 'DISCOVER' } })),
    socialGraph(caller),
    listUserBooks(caller),
  ]);
  const following = new Set(graph.following.map((profile) => profile.id));
  const wants = new Set(userBooks.filter((book) => book.state === 'want').map((book) => book.workId));
  const taste = new Set(userBooks.filter((book) => book.state === 'read').flatMap((book) => book.work.genres ?? []));
  return (booksResult.Items ?? []).map((row) => row.value as DiscoverCopy).sort((a, b) => {
    const score = (book: DiscoverCopy) => (book.workId && wants.has(book.workId) ? 100 : 0) + (following.has(book.shelfId) ? 50 : 0) + (book.genres?.some((genre) => taste.has(genre)) ? 10 : 0);
    return score(b) - score(a) || b.addedAt.localeCompare(a.addedAt);
  });
}
