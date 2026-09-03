import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { AddBookInput, Availability, BookCopy, ReadingState, ShippingAddress, UserBookState } from './shared/types';
import { addBook, listBooks, listBorrowRequests, listDiscovery, removeBook, requestBook, updateBook, updateBorrowRequest } from './lib/store';
import { lookupIsbn } from './lib/isbn';
import { configureShipping, getShippingAddress, listShipments, purchaseTestLabel, quoteRequestShipping, saveShippingAddress, shippingStatus } from './lib/shipping';
import { browseFor, followProfile, getProfile, getPublicBook, listNotifications, listProfiles, listUserBooks, markNotificationRead, setUserBook, socialGraph, unfollowProfile, updateProfile } from './lib/social';

const OWNER = process.env.CELL_OWNER ?? 'c15r';
const readAsset = (path: string): string => readFileSync(join(__dirname, path), 'utf8');
const response = (statusCode: number, body: unknown, contentType = 'application/json', headers: Record<string, string> = {}) => ({ statusCode, headers: { 'content-type': contentType, ...headers }, body: typeof body === 'string' ? body : JSON.stringify(body) });
const jsonBody = (raw?: string): Record<string, unknown> => { try { return raw ? JSON.parse(raw) as Record<string, unknown> : {}; } catch { throw new Error('invalid JSON body'); } };
const authedCaller = (event: Event): string | null => { const caller = event.headers?.['x-cell-caller']; return caller && caller !== 'anonymous' ? caller : null; };

type Event = { rawPath?: string; requestContext?: { http?: { method?: string } }; headers?: Record<string, string | undefined>; body?: string };
type Args = Record<string, unknown>;
const readingStates: ReadingState[] = ['unread', 'reading', 'read', 'want'];
const availabilities: Availability[] = ['private', 'ask', 'lend', 'pass'];

const TOOLS = [
  { name: 'list_books', kind: 'read', description: 'List the authenticated caller’s physical book copies.', inputSchema: { type: 'object', properties: {} } },
  { name: 'browse_available', kind: 'read', description: 'Browse copies readers have made available to ask for, borrow, or pass on.', inputSchema: { type: 'object', properties: { limit: { type: 'number' } } } },
  { name: 'list_borrow_requests', kind: 'read', description: 'List the authenticated caller’s incoming and outgoing borrow requests.', inputSchema: { type: 'object', properties: {} } },
  { name: 'list_shipments', kind: 'read', description: 'List shipments visible to the authenticated caller.', inputSchema: { type: 'object', properties: {} } },
  { name: 'shipping_status', kind: 'read', description: 'Report whether the Shippo carrier adapter is configured, without exposing credentials.', inputSchema: { type: 'object', properties: {} } },
  { name: 'get_shipping_address', kind: 'read', description: 'Read the authenticated caller’s own private postal address.', inputSchema: { type: 'object', properties: {} } },
  { name: 'my_social', kind: 'read', description: 'Read the caller’s public profile and follow graph.', inputSchema: { type: 'object', properties: {} } },
  { name: 'list_profiles', kind: 'read', description: 'Browse public reader profiles.', inputSchema: { type: 'object', properties: {} } },
  { name: 'get_book', kind: 'read', description: 'Open a canonical book with available copies and the caller’s reading state.', inputSchema: { type: 'object', properties: { workId: { type: 'string' } }, required: ['workId'] } },
  { name: 'list_user_books', kind: 'read', description: 'List the caller’s want, reading, read, and DNF books independently of ownership.', inputSchema: { type: 'object', properties: {} } },
  { name: 'list_notifications', kind: 'read', description: 'List availability notifications for wanted books.', inputSchema: { type: 'object', properties: {} } },
  { name: 'browse_for_me', kind: 'read', description: 'Browse available copies ranked by wants, followed readers, and reading taste.', inputSchema: { type: 'object', properties: {} } },
  { name: 'lookup_isbn', kind: 'read', description: 'Resolve an ISBN to canonical edition metadata, backed by the cell’s edition cache.', inputSchema: { type: 'object', properties: { isbn: { type: 'string' } }, required: ['isbn'] } },
  { name: 'add_book', kind: 'act', description: 'Add one physical copy to the authenticated caller’s shelf.', inputSchema: { type: 'object', properties: { isbn: { type: 'string' }, title: { type: 'string' }, authors: { type: 'array', items: { type: 'string' } }, coverUrl: { type: 'string' }, publisher: { type: 'string' }, publishedDate: { type: 'string' }, genres: { type: 'array', items: { type: 'string' } }, readingState: { type: 'string', enum: readingStates }, availability: { type: 'string', enum: availabilities }, condition: { type: 'string', enum: ['new', 'very-good', 'good', 'fair'] }, note: { type: 'string' } }, required: ['isbn', 'title', 'authors'] } },
  { name: 'update_copy', kind: 'act', description: 'Change a copy’s reading state, availability, condition, note, or edition metadata.', inputSchema: { type: 'object', properties: { id: { type: 'string' }, title: { type: 'string' }, authors: { type: 'array', items: { type: 'string' } }, coverUrl: { type: 'string' }, genres: { type: 'array', items: { type: 'string' } }, readingState: { type: 'string', enum: readingStates }, availability: { type: 'string', enum: availabilities }, condition: { type: 'string', enum: ['new', 'very-good', 'good', 'fair'] }, note: { type: 'string' } }, required: ['id'] } },
  { name: 'remove_copy', kind: 'act', description: 'Remove one copy from the authenticated caller’s shelf.', inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] } },
  { name: 'request_book', kind: 'act', description: 'Ask the owner to borrow or receive an available copy.', inputSchema: { type: 'object', properties: { copyId: { type: 'string' }, deliveryMethod: { type: 'string', enum: ['local', 'post'] }, message: { type: 'string' } }, required: ['copyId'] } },
  { name: 'update_borrow_request', kind: 'act', description: 'Accept, decline, or cancel a borrow request.', inputSchema: { type: 'object', properties: { requestId: { type: 'string' }, status: { type: 'string', enum: ['accepted', 'declined', 'cancelled'] } }, required: ['requestId', 'status'] } },
  { name: 'configure_shipping', kind: 'act', description: 'Cell-owner-only, write-only configuration of a Shippo test or live token.', inputSchema: { type: 'object', properties: { token: { type: 'string' } }, required: ['token'] } },
  { name: 'set_shipping_address', kind: 'act', description: 'Save the authenticated caller’s private UK postal address in their cell partition.', inputSchema: { type: 'object', properties: { name: { type: 'string' }, street1: { type: 'string' }, street2: { type: 'string' }, city: { type: 'string' }, postcode: { type: 'string' }, email: { type: 'string' }, phone: { type: 'string' } }, required: ['name', 'street1', 'city', 'postcode'] } },
  { name: 'quote_shipping', kind: 'act', description: 'Get live UK postage rates for an accepted postal request using both readers’ private saved addresses.', inputSchema: { type: 'object', properties: { requestId: { type: 'string' }, parcel: { type: 'string', enum: ['single-book', 'book-box'] } }, required: ['requestId'] } },
  { name: 'purchase_test_label', kind: 'act', description: 'Purchase a non-chargeable Shippo test label for a quoted rate. Live purchases are blocked until payment confirmation exists.', inputSchema: { type: 'object', properties: { requestId: { type: 'string' }, rateId: { type: 'string' } }, required: ['requestId', 'rateId'] } },
  { name: 'update_profile', kind: 'act', description: 'Update the caller’s public reader profile.', inputSchema: { type: 'object', properties: { handle: { type: 'string' }, displayName: { type: 'string' }, bio: { type: 'string' }, location: { type: 'string' }, favouriteGenres: { type: 'array', items: { type: 'string' } } } } },
  { name: 'follow_profile', kind: 'act', description: 'Follow a public reader profile.', inputSchema: { type: 'object', properties: { profileId: { type: 'string' } }, required: ['profileId'] } },
  { name: 'unfollow_profile', kind: 'act', description: 'Stop following a reader profile.', inputSchema: { type: 'object', properties: { profileId: { type: 'string' } }, required: ['profileId'] } },
  { name: 'set_user_book', kind: 'act', description: 'Set want, reading, read, or DNF state for a canonical book; wanting also watches for availability.', inputSchema: { type: 'object', properties: { workId: { type: 'string' }, state: { type: 'string', enum: ['want', 'reading', 'read', 'dnf'] } }, required: ['workId', 'state'] } },
  { name: 'mark_notification_read', kind: 'act', description: 'Mark one availability notification read.', inputSchema: { type: 'object', properties: { workId: { type: 'string' }, copyId: { type: 'string' } }, required: ['workId', 'copyId'] } },
];

function validAddress(value: unknown): ShippingAddress {
  const raw = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  const text = (key: string): string => typeof raw[key] === 'string' ? (raw[key] as string).trim() : '';
  const address: ShippingAddress = { name: text('name'), street1: text('street1'), street2: text('street2') || undefined, city: text('city'), postcode: text('postcode').toUpperCase(), country: 'GB', email: text('email') || undefined, phone: text('phone') || undefined };
  if (!address.name || !address.street1 || !address.city || !address.postcode) throw new Error('name, street1, city and postcode are required');
  return address;
}

function validAdd(args: Args): AddBookInput {
  const isbn = typeof args.isbn === 'string' ? args.isbn.replace(/[^0-9X]/gi, '') : '';
  const title = typeof args.title === 'string' ? args.title.trim() : '';
  const authors = Array.isArray(args.authors) ? args.authors.filter((x): x is string => typeof x === 'string').map((x) => x.trim()).filter(Boolean) : [];
  if ((isbn.length !== 10 && isbn.length !== 13) || !title) throw new Error('isbn and title are required');
  const readingState = readingStates.includes(args.readingState as ReadingState) ? args.readingState as ReadingState : 'unread';
  const availability = availabilities.includes(args.availability as Availability) ? args.availability as Availability : 'private';
  return { isbn, title, authors, coverUrl: typeof args.coverUrl === 'string' ? args.coverUrl : undefined, publisher: typeof args.publisher === 'string' ? args.publisher : undefined, publishedDate: typeof args.publishedDate === 'string' ? args.publishedDate : undefined, genres: Array.isArray(args.genres) ? args.genres.filter((x): x is string => typeof x === 'string').slice(0, 8) : undefined, readingState, availability, condition: args.condition as BookCopy['condition'], note: typeof args.note === 'string' ? args.note.slice(0, 1000) : undefined };
}

async function tool(name: string, caller: string, args: Args): Promise<unknown> {
  if (name === 'list_books') { const books = await listBooks(caller); return { books, count: books.length }; }
  if (name === 'browse_available') { const books = await listDiscovery(typeof args.limit === 'number' ? args.limit : 60); return { books, count: books.length }; }
  if (name === 'list_borrow_requests') return await listBorrowRequests(caller);
  if (name === 'list_shipments') return { shipments: await listShipments(caller) };
  if (name === 'shipping_status') return await shippingStatus(caller);
  if (name === 'get_shipping_address') return { address: await getShippingAddress(caller) };
  if (name === 'my_social') return await socialGraph(caller);
  if (name === 'list_profiles') return { profiles: await listProfiles() };
  if (name === 'get_book') return { book: await getPublicBook(String(args.workId ?? ''), caller) };
  if (name === 'list_user_books') return { books: await listUserBooks(caller) };
  if (name === 'list_notifications') return { notifications: await listNotifications(caller) };
  if (name === 'browse_for_me') return { books: await browseFor(caller) };
  if (name === 'lookup_isbn') return { edition: await lookupIsbn(args.isbn) };
  if (name === 'add_book') return { copy: await addBook(caller, validAdd(args)) };
  if (name === 'update_copy') {
    const id = typeof args.id === 'string' ? args.id : '';
    if (!id) throw new Error('id is required');
    const patch: Partial<BookCopy> = {};
    if (readingStates.includes(args.readingState as ReadingState)) patch.readingState = args.readingState as ReadingState;
    if (availabilities.includes(args.availability as Availability)) patch.availability = args.availability as Availability;
    if (['new', 'very-good', 'good', 'fair'].includes(args.condition as string)) patch.condition = args.condition as BookCopy['condition'];
    if (typeof args.note === 'string') patch.note = args.note.slice(0, 1000);
    if (typeof args.title === 'string' && args.title.trim()) patch.title = args.title.trim();
    if (Array.isArray(args.authors)) patch.authors = args.authors.filter((x): x is string => typeof x === 'string').map((x) => x.trim()).filter(Boolean);
    if (typeof args.coverUrl === 'string') patch.coverUrl = args.coverUrl;
    if (Array.isArray(args.genres)) patch.genres = args.genres.filter((x): x is string => typeof x === 'string').slice(0, 8);
    const copy = await updateBook(caller, id, patch); if (!copy) throw Object.assign(new Error('copy not found'), { statusCode: 404 }); return { copy };
  }
  if (name === 'remove_copy') { const id = typeof args.id === 'string' ? args.id : ''; return { removed: id ? await removeBook(caller, id) : false }; }
  if (name === 'request_book') { const copyId = typeof args.copyId === 'string' ? args.copyId : ''; if (!copyId) throw new Error('copyId is required'); const deliveryMethod = args.deliveryMethod === 'post' ? 'post' : 'local'; return { request: await requestBook(caller, copyId, deliveryMethod, typeof args.message === 'string' ? args.message : undefined) }; }
  if (name === 'update_borrow_request') { const requestId = typeof args.requestId === 'string' ? args.requestId : ''; const status = args.status; if (!requestId || !['accepted', 'declined', 'cancelled'].includes(status as string)) throw new Error('requestId and a valid status are required'); return { request: await updateBorrowRequest(caller, requestId, status as 'accepted' | 'declined' | 'cancelled') }; }
  if (name === 'configure_shipping') return { shipping: await configureShipping(caller, typeof args.token === 'string' ? args.token : '') };
  if (name === 'set_shipping_address') { const address = validAddress(args); await saveShippingAddress(caller, address); return { saved: true, address }; }
  if (name === 'quote_shipping') return { rates: await quoteRequestShipping(caller, String(args.requestId ?? ''), args.parcel === 'book-box' ? 'book-box' : 'single-book') };
  if (name === 'purchase_test_label') return { shipment: await purchaseTestLabel(caller, String(args.requestId ?? ''), String(args.rateId ?? '')) };
  if (name === 'update_profile') return { profile: await updateProfile(caller, { handle: typeof args.handle === 'string' ? args.handle : undefined, displayName: typeof args.displayName === 'string' ? args.displayName : undefined, bio: typeof args.bio === 'string' ? args.bio : undefined, location: typeof args.location === 'string' ? args.location : undefined, favouriteGenres: Array.isArray(args.favouriteGenres) ? args.favouriteGenres.filter((value): value is string => typeof value === 'string') : undefined }) };
  if (name === 'follow_profile') { await followProfile(caller, String(args.profileId ?? '')); return { followed: true }; }
  if (name === 'unfollow_profile') { await unfollowProfile(caller, String(args.profileId ?? '')); return { followed: false }; }
  if (name === 'set_user_book') { const state = args.state as UserBookState; if (!['want', 'reading', 'read', 'dnf'].includes(state)) throw new Error('a valid reading state is required'); return { book: await setUserBook(caller, String(args.workId ?? ''), state) }; }
  if (name === 'mark_notification_read') { await markNotificationRead(caller, String(args.workId ?? ''), String(args.copyId ?? '')); return { read: true }; }
  throw Object.assign(new Error(`unknown tool ${name}`), { statusCode: 404 });
}

export const handler = async (event: Event) => {
  const method = event.requestContext?.http?.method ?? 'GET';
  const path = event.rawPath ?? '/';
  const caller = authedCaller(event);
  try {
    if (method === 'GET' && path === '/_tools') return response(200, { tools: TOOLS });
    if (method === 'POST' && path.startsWith('/_tools/')) {
      if (!caller) return response(401, { error: 'sign in through parc.land' });
      const out = await tool(path.slice('/_tools/'.length), caller, jsonBody(event.body));
      return response(200, out);
    }
    if (method === 'GET' && path === '/app.js') return response(200, readAsset('app.js'), 'application/javascript; charset=utf-8', { 'access-control-allow-origin': '*' });
    if (path.startsWith('/api/')) {
      if (method === 'GET' && path === '/api/discover') { const books = await listDiscovery(); return response(200, { books, count: books.length }, 'application/json', { 'cache-control': 'public, max-age=30' }); }
      if (method === 'GET' && path.startsWith('/api/isbn/')) return response(200, await tool('lookup_isbn', caller ?? OWNER, { isbn: decodeURIComponent(path.slice('/api/isbn/'.length)) }), 'application/json', { 'cache-control': 'public, max-age=86400' });
      if (method === 'GET' && path === '/api/profiles') return response(200, { profiles: await listProfiles() }, 'application/json', { 'cache-control': 'public, max-age=30' });
      const profileMatch = path.match(/^\/api\/profiles\/([^/]+)$/);
      if (method === 'GET' && profileMatch) { const profile = await getProfile(profileMatch[1]); return response(profile ? 200 : 404, profile ?? { error: 'reader not found' }, 'application/json', { 'cache-control': 'public, max-age=30' }); }
      const workMatch = path.match(/^\/api\/works\/([^/]+)$/);
      if (method === 'GET' && workMatch) { const book = await getPublicBook(workMatch[1], caller); return response(book ? 200 : 404, book ?? { error: 'book not found' }, 'application/json', { 'cache-control': caller ? 'private, no-store' : 'public, max-age=30' }); }
      if (!caller) return response(401, { error: 'sign in through parc.land' });
      if (method === 'GET' && path === '/api/books') return response(200, await tool('list_books', caller, {}));
      if (method === 'POST' && path === '/api/books') return response(201, await tool('add_book', caller, jsonBody(event.body)));
      const match = path.match(/^\/api\/books\/([^/]+)$/);
      if (match && method === 'PATCH') return response(200, await tool('update_copy', caller, { ...jsonBody(event.body), id: match[1] }));
      if (match && method === 'DELETE') return response(200, await tool('remove_copy', caller, { id: match[1] }));
      return response(404, { error: `no API route for ${method} ${path}` });
    }
    if (method === 'GET' && (path === '/' || path === '' || path === '/readers' || path.startsWith('/book/') || path.startsWith('/reader/'))) {
      return response(200, readAsset('static/index.html'), 'text/html; charset=utf-8');
    }
    return response(404, { error: `no route for ${method} ${path}` });
  } catch (err) {
    const status = typeof (err as { statusCode?: unknown }).statusCode === 'number' ? (err as { statusCode: number }).statusCode : /required|invalid/i.test((err as Error).message) ? 400 : 500;
    console.error('[shelved]', method, path, err);
    return response(status, { error: (err as Error).message });
  }
};
