/**
 * Auction (Sealed Bid) Mechanic
 *
 * All players submit hidden bids simultaneously, then bids are revealed.
 * Highest bidder wins the item.
 *
 * Config:
 *   auction_sealed_bid:
 *     currency: string          # Resource used for bidding
 *     allow_tie_winning: boolean # If true, ties are resolved by turn order
 *     reveal_all_bids: boolean  # If true, all bids are revealed; if false, only winner
 *
 * Hooks used:
 * - preValidateAction: Validate sealed bid submission
 * - onExecuteAction: Handle sealed bid submission and resolution
 * - getAvailableActions: Expose sealed bid action
 */

import { MechanicHooks, HookContext, ValidationResult, ActionExecutionContext, ActionExecutionResult, AvailableAction, StateChanges } from './types';
import { GameAction, SealedBidAction, AuctionSealedBidConfig } from '../types/game';
import { spendResource } from './core/resources';

interface SealedAuction {
  id: string;
  item: unknown;
  bids: Record<string, number>;  // playerId -> bid amount
  resolved: boolean;
  winner?: string;
  winningBid?: number;
}

function resolveAuction(
  ctx: ActionExecutionContext,
  auction: SealedAuction,
  config: AuctionSealedBidConfig
): {
  auction: SealedAuction;
  result: { winner: string | null; winningBid: number; allBids?: Record<string, number> };
} {
  // Find highest bid
  let highestBid = -1;
  let highestBidders: string[] = [];

  for (const [pid, bid] of Object.entries(auction.bids)) {
    if (bid > highestBid) {
      highestBid = bid;
      highestBidders = [pid];
    } else if (bid === highestBid) {
      highestBidders.push(pid);
    }
  }

  // Resolve ties by turn order if enabled
  let winner: string | null = null;
  if (highestBidders.length === 1) {
    winner = highestBidders[0];
  } else if (highestBidders.length > 1 && config.allow_tie_winning !== false) {
    // Use turn order to break tie
    for (const pid of ctx.state.turnOrder) {
      if (highestBidders.includes(pid)) {
        winner = pid;
        break;
      }
    }
  }

  auction.resolved = true;
  auction.winner = winner ?? undefined;
  auction.winningBid = highestBid;

  const result: { winner: string | null; winningBid: number; allBids?: Record<string, number> } = {
    winner,
    winningBid: highestBid
  };

  if (config.reveal_all_bids !== false) {
    result.allBids = { ...auction.bids };
  }

  // Deduct winning bid from winner via resource service (fires hooks)
  if (winner && highestBid > 0) {
    spendResource(ctx.state, winner, config.currency, highestBid);
  }

  return { auction, result };
}

export const auctionSealedBidMechanic: MechanicHooks = {
  slug: 'auction-sealed-bid',
  name: 'Auction (Sealed Bid)',
  requires: ['auction', 'resources'],

  configSchema: {
    type: 'object',
    description: 'Sealed bid auctions where all players bid simultaneously and hidden',
    properties: {
      currency: {
        type: 'string',
        description: 'Resource used for bidding',
        required: true
      },
      allow_tie_winning: {
        type: 'boolean',
        description: 'If true, ties are resolved by turn order',
        default: true
      },
      reveal_all_bids: {
        type: 'boolean',
        description: 'If true, all bids are revealed after auction; if false, only winner',
        default: true
      }
    },
    required: ['currency']
  },

  preValidateAction(ctx: HookContext, action: GameAction): ValidationResult | null {
    if (action.type !== 'sealed_bid') return null;

    const config = ctx.config.engine_mechanics?.auction_sealed_bid;
    if (!config) {
      return { valid: false, error: 'Sealed bid auctions are not enabled for this game.' };
    }

    const bidAction = action as SealedBidAction;
    const currency = config.currency;
    const available = ctx.player.resources?.[currency] ?? 0;

    // Check if there's an active auction
    const activeAuction = ctx.state.shared.activeAuction as SealedAuction | undefined;
    if (!activeAuction || activeAuction.resolved) {
      return { valid: false, error: 'No active auction to bid on.' };
    }

    // Check if player already bid
    if (activeAuction.bids[ctx.playerId] !== undefined) {
      return { valid: false, error: 'You have already submitted a bid for this auction.' };
    }

    // Validate bid amount
    if (bidAction.amount < 0) {
      return { valid: false, error: 'Bid amount cannot be negative.' };
    }

    if (bidAction.amount > available) {
      return {
        valid: false,
        error: `Not enough ${currency} to bid. You have ${available}, trying to bid ${bidAction.amount}.`
      };
    }

    return { valid: true };
  },

  onExecuteAction(ctx: ActionExecutionContext): ActionExecutionResult | null {
    const { action, state, playerId } = ctx;
    if (action.type !== 'sealed_bid') return null;

    const config = ctx.config.engine_mechanics?.auction_sealed_bid;
    if (!config) return null;

    const bidAction = action as SealedBidAction;
    const activeAuction = state.shared.activeAuction as SealedAuction;

    // Record the bid
    activeAuction.bids[playerId] = bidAction.amount;

    // Check if all players have bid
    const activePlayers = Object.keys(state.players).filter(
      pid => state.players[pid].state !== 'eliminated'
    );
    const allBidsIn = activePlayers.every(pid => activeAuction.bids[pid] !== undefined);

    const stateChanges: StateChanges = {
      sharedStateChanges: {
        activeAuction
      }
    };

    // If all bids are in, resolve the auction (spendResource called inside)
    if (allBidsIn) {
      const resolved = resolveAuction(ctx, activeAuction, config);
      stateChanges.sharedStateChanges = {
        activeAuction: resolved.auction,
        lastAuctionResult: resolved.result
      };
    }

    return {
      handled: true,
      stateChanges,
      advanceTurn: false,  // Don't advance turn on bid submission
      checkWin: false,
      logMessage: allBidsIn
        ? `${playerId} submitted bid, auction resolved`
        : `${playerId} submitted sealed bid`
    };
  },

  getAvailableActions(ctx: HookContext): AvailableAction[] {
    const config = ctx.config.engine_mechanics?.auction_sealed_bid;
    if (!config) return [];

    const activeAuction = ctx.state.shared.activeAuction as SealedAuction | undefined;
    if (!activeAuction || activeAuction.resolved) return [];

    // Check if player already bid
    if (activeAuction.bids[ctx.playerId] !== undefined) return [];

    return [{
      action: {
        type: 'sealed_bid',
        amount: 0  // Player must specify amount
      } as SealedBidAction,
      priority: 90,
      category: 'auction'
    }];
  }
};
