export type ReadingState = 'unread' | 'reading' | 'read' | 'want';
export type Availability = 'private' | 'ask' | 'lend' | 'pass';

export interface Edition {
  metadataVersion?: number;
  workId?: string;
  isbn: string;
  title: string;
  authors: string[];
  coverUrl?: string;
  publisher?: string;
  publishedDate?: string;
  genres?: string[];
}

/**
 * A live commitment on a copy: someone has been accepted for it.
 *
 * `availability` is the owner's standing INTENT ("I'd lend this"), which is a
 * different thing from whether the book is free right now. Conflating them is
 * what let an accepted copy stay in the discover index, so two readers could
 * both be accepted for the same physical book.
 */
export interface Loan {
  requestId: string;
  /** The other reader — who is receiving it, or has it. */
  withId: string;
  /** Whether the book is expected back. */
  kind: 'lend' | 'pass';
  status: 'reserved' | 'in-transit' | 'held' | 'returning';
  since: string;
}

export interface BookCopy extends Edition {
  id: string;
  ownerId: string;
  readingState: ReadingState;
  /** The owner's standing intent. Not "is it free" — see `loan`. */
  availability: Availability;
  /** Set while a request is live. Absent means the copy is actually free. */
  loan?: Loan;
  condition?: 'new' | 'very-good' | 'good' | 'fair';
  note?: string;
  addedAt: string;
  updatedAt: string;
}

export interface AddBookInput extends Edition {
  readingState?: ReadingState;
  availability?: Availability;
  condition?: BookCopy['condition'];
  note?: string;
}

export interface ShelfViewModel {
  authed: boolean;
  ownerName?: string;
  books: BookCopy[];
}

export interface DiscoverCopy extends Edition {
  id: string;
  shelfId: string;
  shelfLabel: string;
  availability: Exclude<Availability, 'private'>;
  condition?: BookCopy['condition'];
  addedAt: string;
}

export type UserBookState = 'want' | 'reading' | 'read' | 'dnf';

export interface Work {
  id: string;
  title: string;
  authors: string[];
  coverUrl?: string;
  genres?: string[];
  firstPublished?: string;
  editionIsbns: string[];
}

export interface UserBook {
  workId: string;
  state: UserBookState;
  work: Work;
  createdAt: string;
  updatedAt: string;
}

export interface PublicProfile {
  id: string;
  handle: string;
  displayName: string;
  bio?: string;
  location?: string;
  favouriteGenres?: string[];
  joinedAt: string;
}

export interface SocialGraph {
  profile: PublicProfile;
  following: PublicProfile[];
  followers: PublicProfile[];
}

export interface AvailabilityNotification {
  id: string;
  type: 'available';
  workId: string;
  copyId: string;
  title: string;
  coverUrl?: string;
  shelfLabel: string;
  read: boolean;
  createdAt: string;
}

export interface PublicBookView {
  work: Work;
  copies: DiscoverCopy[];
  userBook?: UserBook;
}

export interface BorrowRequest {
  id: string;
  copyId: string;
  title: string;
  coverUrl?: string;
  requesterId: string;
  ownerId: string;
  /**
   * The lifecycle used to stop at `accepted`, with no transition out of it, so
   * a posted book stayed "accepted" forever and the copy never came back.
   * `shipped`/`delivered` are the journey; `returned` closes a lend;
   * `completed` is terminal for both kinds.
   */
  status: 'pending' | 'accepted' | 'declined' | 'cancelled' | 'shipped' | 'delivered' | 'returned' | 'completed';
  deliveryMethod: 'local' | 'post';
  message?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ShippingProviderStatus {
  provider: 'shippo';
  configured: boolean;
  mode: 'test' | 'live' | 'unconfigured';
  canConfigure?: boolean;
}

export interface ShippingAddress {
  name: string;
  street1: string;
  street2?: string;
  city: string;
  postcode: string;
  country: 'GB';
  email?: string;
  phone?: string;
}

export interface ShippingRate {
  id: string;
  provider: string;
  service: string;
  amount: string;
  currency: string;
  estimatedDays?: number;
  duration?: string;
}

export interface ShipmentRecord {
  id: string;
  requestId: string;
  provider: 'shippo';
  direction: 'outbound' | 'return';
  status: 'quoted' | 'label-created' | 'pre-transit' | 'in-transit' | 'delivered' | 'returned' | 'failed';
  rateId?: string;
  carrier?: string;
  service?: string;
  amount?: string;
  currency?: string;
  labelUrl?: string;
  qrCodeUrl?: string;
  trackingNumber?: string;
  trackingUrl?: string;
  createdAt: string;
  updatedAt: string;
}
