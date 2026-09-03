import * as React from 'react';
import styled, { ThemeProvider } from '../shared/styled';
import { GlobalStyle, theme } from '../shared/theme';
import type { AddBookInput, Availability, AvailabilityNotification, BookCopy, BorrowRequest, DiscoverCopy, Edition, PublicBookView, PublicProfile, ReadingState, ShipmentRecord, ShippingAddress, ShippingProviderStatus, ShippingRate, SocialGraph, UserBook, UserBookState } from '../shared/types';
import { Page, Shell } from '../shared/components/Layout';
import { ShelfHeader } from '../shared/components/ShelfHeader';
import { ShelfStats } from '../shared/components/ShelfStats';
import { BookCard } from '../shared/components/BookCard';
import { EmptyShelf } from '../shared/components/EmptyShelf';
import { IsbnCapture } from './components/IsbnCapture';
import { BrandNav } from './components/BrandNav';
import { Discover } from './components/Discover';
import { RequestsPanel } from './components/RequestsPanel';
import { CanonicalBookSheet } from './components/CanonicalBookSheet';
import { ReadersPage } from './components/ReadersPage';
import { ReadingPanel } from './components/ReadingPanel';
import { completeLoginIfReturning, login, logout } from './lib/auth';
import { act, read } from './lib/substrate';

const Grid = styled.div`display: grid; grid-template-columns: repeat(auto-fill, minmax(min(100%, 310px), 1fr)); gap: 12px;`;
const Loading = styled.p`padding: 80px 0; color: ${theme.quiet}; text-align: center;`;
const cellPath = (path: string): string => location.host.endsWith('.on.parc.land') ? path : `/@c15r/shelved${path}`;

async function loadBooks(): Promise<BookCopy[]> {
  const result = await read<{ books: BookCopy[] }>('@c15r/shelved.list_books', {});
  return result.books ?? [];
}

async function loadDiscovery(): Promise<DiscoverCopy[]> {
  const response = await fetch(cellPath('/api/discover'), { headers: { accept: 'application/json' } });
  if (!response.ok) throw new Error('Could not open the shared shelves.');
  const result = await response.json() as { books?: DiscoverCopy[] };
  return result.books ?? [];
}

async function loadProfiles(): Promise<PublicProfile[]> {
  const response = await fetch(cellPath('/api/profiles'), { headers: { accept: 'application/json' } });
  if (!response.ok) return [];
  const result = await response.json() as { profiles?: PublicProfile[] };
  return result.profiles ?? [];
}

async function loadCanonicalBook(workId: string, authed: boolean): Promise<PublicBookView> {
  if (authed) {
    const result = await read<{ book: PublicBookView | null }>('@c15r/shelved.get_book', { workId });
    if (result.book) return result.book;
  } else {
    const response = await fetch(cellPath(`/api/works/${encodeURIComponent(workId)}`), { headers: { accept: 'application/json' } });
    if (response.ok) return await response.json() as PublicBookView;
  }
  throw new Error('That book could not be opened.');
}

async function loadAccountData(): Promise<{ requests: { incoming: BorrowRequest[]; outgoing: BorrowRequest[] }; address: ShippingAddress | null; shipping: ShippingProviderStatus; shipments: ShipmentRecord[]; social: SocialGraph; userBooks: UserBook[]; notifications: AvailabilityNotification[]; browse: DiscoverCopy[] }> {
  const [requests, addressResult, shipping, shipmentResult, social, userBookResult, notificationResult, browseResult] = await Promise.all([
    read<{ incoming: BorrowRequest[]; outgoing: BorrowRequest[] }>('@c15r/shelved.list_borrow_requests', {}),
    read<{ address: ShippingAddress | null }>('@c15r/shelved.get_shipping_address', {}),
    read<ShippingProviderStatus>('@c15r/shelved.shipping_status', {}),
    read<{ shipments: ShipmentRecord[] }>('@c15r/shelved.list_shipments', {}),
    read<SocialGraph>('@c15r/shelved.my_social', {}),
    read<{ books: UserBook[] }>('@c15r/shelved.list_user_books', {}),
    read<{ notifications: AvailabilityNotification[] }>('@c15r/shelved.list_notifications', {}),
    read<{ books: DiscoverCopy[] }>('@c15r/shelved.browse_for_me', {}),
  ]);
  return { requests, address: addressResult.address, shipping, shipments: shipmentResult.shipments ?? [], social, userBooks: userBookResult.books ?? [], notifications: notificationResult.notifications ?? [], browse: browseResult.books ?? [] };
}

export function App(): React.JSX.Element {
  const returning = React.useMemo(() => new URLSearchParams(location.search).has('code'), []);
  const [ready, setReady] = React.useState(false);
  const [authed, setAuthed] = React.useState(false);
  const [books, setBooks] = React.useState<BookCopy[]>([]);
  const [available, setAvailable] = React.useState<DiscoverCopy[]>([]);
  const [capture, setCapture] = React.useState(false);
  const [requests, setRequests] = React.useState<{ incoming: BorrowRequest[]; outgoing: BorrowRequest[] }>({ incoming: [], outgoing: [] });
  const [shippingAddress, setShippingAddress] = React.useState<ShippingAddress | null>(null);
  const [shipping, setShipping] = React.useState<ShippingProviderStatus>({ provider: 'shippo', configured: false, mode: 'unconfigured' });
  const [shipments, setShipments] = React.useState<ShipmentRecord[]>([]);
  const [profiles, setProfiles] = React.useState<PublicProfile[]>([]);
  const [social, setSocial] = React.useState<SocialGraph | null>(null);
  const [userBooks, setUserBooks] = React.useState<UserBook[]>([]);
  const [notifications, setNotifications] = React.useState<AvailabilityNotification[]>([]);
  const [openBookView, setOpenBookView] = React.useState<PublicBookView | null>(null);
  const [view, setView] = React.useState<'discover' | 'shelf' | 'readers'>(returning ? 'shelf' : location.pathname.startsWith('/reader') || location.pathname === '/readers' ? 'readers' : 'discover');

  React.useEffect(() => { void (async () => {
    const [signedIn, discovered, publicProfiles] = await Promise.all([completeLoginIfReturning(), loadDiscovery().catch(() => []), loadProfiles()]);
    setAuthed(signedIn);
    setAvailable(discovered);
    setProfiles(publicProfiles);
    if (signedIn) {
      const [shelf, account] = await Promise.all([loadBooks(), loadAccountData()]);
      setBooks(shelf); setAvailable(account.browse); setRequests(account.requests); setShippingAddress(account.address); setShipping(account.shipping); setShipments(account.shipments); setSocial(account.social); setUserBooks(account.userBooks); setNotifications(account.notifications);
    }
    setReady(true);
    const match = location.pathname.match(/\/book\/([^/]+)/);
    if (match) setOpenBookView(await loadCanonicalBook(decodeURIComponent(match[1]), signedIn).catch(() => null));
  })(); }, []);

  // The sheet leaves the page mounted, so nothing reloads the authed data for
  // us the way the old full-page redirect did — sign-in folds its own result
  // back in. A dismissal (false) leaves the anonymous view exactly as it was.
  const afterSignIn = async (then: () => void | Promise<void>): Promise<void> => {
    if (!(await login())) return;
    setAuthed(true);
    await refresh();
    await then();
  };
  // Both entry points take NO arguments, deliberately. Every caller is a prop
  // wired straight onto `onClick` (`<SignIn onClick={onSignIn}>`), so React
  // hands a click event to the first parameter — a `then?: () => void` here
  // would be invoked as the SyntheticEvent. The prop types say `() => void`,
  // which does not catch it, because the extra argument is React's to pass.
  // Where the reader LANDS is therefore chosen by picking a function, not by
  // passing one.

  /** The redirect always dumped a reader on the shelf, a full reload having
   *  lost wherever they were. That stays the default. */
  const signIn = (): void => { void afterSignIn(() => setView('shelf')); };
  /** Sign in without leaving the open book, re-read as its owner — only
   *  possible now the page survives the ceremony. */
  const signInHere = (): void => { void afterSignIn(async () => {
    if (!openBookView) return;
    setOpenBookView(await loadCanonicalBook(openBookView.work.id, true).catch(() => openBookView));
  }); };
  const signOut = (): void => { void logout(); };
  const openShelf = (): void => { if (authed) setView('shelf'); else signIn(); };
  const openCapture = (): void => { if (authed) setCapture(true); else signIn(); };
  const refresh = async (): Promise<void> => {
    const [shelf, publicProfiles, account] = await Promise.all([loadBooks(), loadProfiles(), loadAccountData()]);
    setBooks(shelf); setAvailable(account.browse); setProfiles(publicProfiles); setRequests(account.requests); setShippingAddress(account.address); setShipping(account.shipping); setShipments(account.shipments); setSocial(account.social); setUserBooks(account.userBooks); setNotifications(account.notifications);
  };
  const addBook = async (book: AddBookInput): Promise<void> => { await act('@c15r/shelved.add_book', book); await refresh(); setView('shelf'); };
  const requestBook = async (book: DiscoverCopy, deliveryMethod: 'local' | 'post'): Promise<void> => { await act('@c15r/shelved.request_book', { copyId: book.id, deliveryMethod }); await refresh(); };
  const decideRequest = async (requestId: string, status: 'accepted' | 'declined' | 'cancelled'): Promise<void> => { await act('@c15r/shelved.update_borrow_request', { requestId, status }); await refresh(); };
  const saveAddress = async (address: ShippingAddress): Promise<void> => { await act('@c15r/shelved.set_shipping_address', address); await refresh(); };
  const quotePostage = async (requestId: string): Promise<ShippingRate[]> => { const result = await act<{ rates: ShippingRate[] }>('@c15r/shelved.quote_shipping', { requestId, parcel: 'single-book' }); return result.rates ?? []; };
  const purchaseTestLabel = async (requestId: string, rateId: string): Promise<void> => { await act('@c15r/shelved.purchase_test_label', { requestId, rateId }); await refresh(); };
  const configureShipping = async (token: string): Promise<void> => { await act('@c15r/shelved.configure_shipping', { token }); await refresh(); };
  const openCanonical = async (workId: string): Promise<void> => { const book = await loadCanonicalBook(workId, authed); setOpenBookView(book); history.pushState({}, '', `/book/${encodeURIComponent(workId)}`); };
  const closeCanonical = (): void => { setOpenBookView(null); if (location.pathname.startsWith('/book/')) history.pushState({}, '', '/'); };
  const lookupIsbn = async (isbn: string): Promise<void> => { const response = await fetch(cellPath(`/api/isbn/${encodeURIComponent(isbn)}`)); const result = await response.json() as { edition?: Edition; error?: string }; if (!response.ok || !result.edition?.workId) throw new Error(result.error || 'That ISBN was not found.'); await openCanonical(result.edition.workId); };
  const setReadingState = async (workId: string, state: UserBookState): Promise<void> => { await act('@c15r/shelved.set_user_book', { workId, state }); await refresh(); const book = await loadCanonicalBook(workId, true); setOpenBookView(book); };
  const saveProfile = async (patch: Partial<PublicProfile>): Promise<void> => { await act('@c15r/shelved.update_profile', patch); await refresh(); };
  const toggleFollow = async (profileId: string, follow: boolean): Promise<void> => { await act(follow ? '@c15r/shelved.follow_profile' : '@c15r/shelved.unfollow_profile', { profileId }); await refresh(); };
  const readNotification = async (notice: AvailabilityNotification): Promise<void> => { await act('@c15r/shelved.mark_notification_read', { workId: notice.workId, copyId: notice.copyId }); setNotifications((current) => current.map((item) => item.id === notice.id ? { ...item, read: true } : item)); };
  const viewProfile = (profileId: string): void => { setOpenBookView(null); setView('readers'); history.pushState({}, '', `/reader/${encodeURIComponent(profileId)}`); };
  const updateBook = async (id: string, patch: { readingState?: ReadingState; availability?: Availability }): Promise<void> => {
    const previous = books;
    setBooks((current) => current.map((book) => book.id === id ? { ...book, ...patch } : book));
    try { await act('@c15r/shelved.update_copy', { id, ...patch }); await refresh(); }
    catch (err) { setBooks(previous); throw err; }
  };

  const ownBookIds = React.useMemo(() => new Set(books.map((book) => book.id)), [books]);
  return <ThemeProvider theme={theme}><GlobalStyle /><Page><Shell><BrandNav view={view} authed={authed} onBrowse={() => { setView('discover'); history.pushState({}, '', '/'); }} onShelf={openShelf} onReaders={() => { setView('readers'); history.pushState({}, '', '/readers'); }} onSignIn={signIn} onSignOut={signOut} />{!ready ? <Loading>Opening the shelves…</Loading> : view === 'discover' ? <Discover books={available} authed={authed} onJoin={signIn} onAdd={openCapture} onManage={() => setView('shelf')} onOpenBook={(workId) => void openCanonical(workId)} onViewProfile={viewProfile} onLookupIsbn={lookupIsbn} /> : view === 'readers' ? <ReadersPage profiles={profiles} books={available} social={social} authed={authed} onSignIn={signIn} onSaveProfile={saveProfile} onFollow={toggleFollow} onOpenBook={(workId) => void openCanonical(workId)} /> : <><ShelfHeader onAdd={openCapture} /><ShelfStats books={books} />{books.length ? <Grid>{books.map((book) => <BookCard key={book.id} book={book} onChange={(patch) => void updateBook(book.id, patch)} />)}</Grid> : <EmptyShelf authed={authed} onAdd={openCapture} onLogin={signIn} />}<ReadingPanel books={userBooks} notifications={notifications} onOpenBook={(workId) => void openCanonical(workId)} onReadNotification={readNotification} /><RequestsPanel incoming={requests.incoming} outgoing={requests.outgoing} address={shippingAddress} shipping={shipping} shipments={shipments} onDecision={decideRequest} onSaveAddress={saveAddress} onQuote={quotePostage} onPurchaseTest={purchaseTestLabel} onConfigure={configureShipping} /></>}</Shell></Page>{capture ? <IsbnCapture onClose={() => setCapture(false)} onAdd={addBook} /> : null}{openBookView ? <CanonicalBookSheet view={openBookView} authed={authed} ownBookIds={ownBookIds} onClose={closeCanonical} onSignIn={signInHere} onManage={() => { closeCanonical(); setView('shelf'); }} onRequest={requestBook} onSetUserBook={setReadingState} onViewProfile={viewProfile} /> : null}</ThemeProvider>;
}
