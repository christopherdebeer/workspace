/**
 * Auction Core Mechanic
 *
 * Defines the foundational auction domain hooks that auction-related leaf mechanics implement.
 * Any mechanic that works with auctions should declare `requires: ['auction']` and implement
 * the hooks defined here.
 *
 * This mechanic is always enabled via transitive dependency resolution.
 * Core auction services fire these hooks and only mechanics that declare
 * `requires: ['auction']` receive them.
 *
 * Defined hooks:
 * - onAuctionStart: After an auction begins (merge)
 * - onAuctionEnd: After an auction resolves (merge)
 * - onBid: After a bid is placed (merge)
 * - canBid: Before bidding, can block (blocking)
 * - getMinimumBid: Query minimum acceptable bid (first-wins)
 */

import { MechanicHooks, HookContext, StateChanges } from '../types';

// ============ Payload types for auction-defined hooks ============

export interface AuctionStartPayload {
  /** Unique ID for this auction instance */
  auctionId: string;
  /** The item being auctioned (name or object) */
  item: unknown;
  /** Starting bid amount (if any) */
  startingBid?: number;
  /** Auction type (english, sealed, dutch, etc.) */
  auctionType: string;
}

export interface AuctionEndPayload {
  /** Unique ID for this auction instance */
  auctionId: string;
  /** The winning bidder (null if no winner) */
  winnerId: string | null;
  /** The winning bid amount */
  amount: number;
  /** The item that was auctioned */
  item: unknown;
}

export interface BidPayload {
  /** Unique ID for this auction instance */
  auctionId: string;
  /** The player who placed the bid */
  bidderId: string;
  /** The bid amount */
  amount: number;
  /** Previous highest bid (if any) */
  previousBid?: number;
}

export interface CanBidPayload {
  /** Unique ID for this auction instance */
  auctionId: string;
  /** The player attempting to bid */
  playerId: string;
  /** The bid amount being attempted */
  amount: number;
}

export interface GetMinimumBidPayload {
  /** Unique ID for this auction instance */
  auctionId: string;
  /** Current highest bid (if any) */
  currentBid?: number;
}

// ============ Typed interface for dependents ============

/**
 * Hook methods defined by the auction core mechanic.
 * Mechanics that declare `requires: ['auction']` can implement these.
 *
 * Use intersection typing for type safety:
 * ```typescript
 * const myMechanic: MechanicHooks & AuctionHooks = { ... };
 * ```
 */
export interface AuctionHooks {
  onAuctionStart?(ctx: HookContext, payload: AuctionStartPayload): StateChanges | null;
  onAuctionEnd?(ctx: HookContext, payload: AuctionEndPayload): StateChanges | null;
  onBid?(ctx: HookContext, payload: BidPayload): StateChanges | null;
  canBid?(ctx: HookContext, payload: CanBidPayload): { blocked?: boolean; blockReason?: string } | null;
  getMinimumBid?(ctx: HookContext, payload: GetMinimumBidPayload): { minimumBid: number } | null;
}

// ============ The mechanic itself ============

export const auctionMechanic: MechanicHooks = {
  slug: 'auction',
  name: 'Auction Core',

  defines: {
    onAuctionStart: {
      description: 'After an auction begins. Initialize auction-specific state.',
      resolution: 'merge',
    },
    onAuctionEnd: {
      description: 'After an auction resolves. Apply post-auction effects.',
      resolution: 'merge',
    },
    onBid: {
      description: 'After a bid is placed. React to bids.',
      resolution: 'merge',
    },
    canBid: {
      description: 'Before bidding. Can block a bid attempt.',
      resolution: 'blocking',
    },
    getMinimumBid: {
      description: 'Query minimum acceptable bid for an auction.',
      resolution: 'first',
    },
  },
};
