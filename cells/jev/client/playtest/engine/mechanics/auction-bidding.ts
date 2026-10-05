/**
 * Auction Bidding Mechanic (generic)
 *
 * Core bidding mechanic - players bid resources to win items.
 * Supports configurable bid increments and reserve prices.
 *
 * Hooks used:
 * - initSharedState: Create auction state
 * - getAvailableActions: 'auction_bid', 'auction_pass'
 * - onExecuteAction: Handle bids
 * - getPlayerView: Show current auction
 */

import {
  MechanicHooks,
  HookContext,
  ActionExecutionContext,
  ActionExecutionResult,
  AvailableAction,
  SharedStateInitContext,
  SharedStateInitResult,
  isMechanicEnabled
} from './types';
import { GameAction, GameConfig } from '../types/game';

interface AuctionBiddingConfig {
  min_increment?: number;
  reserve_price?: number;
  items_per_round?: number;
}

interface BiddingState {
  currentItem: string | null;
  highBid: number;
  highBidder: string | null;
  passedPlayers: string[];
  round: number;
}

function getConfig(config: GameConfig): AuctionBiddingConfig | undefined {
  return config.engine_mechanics?.auction_bidding as AuctionBiddingConfig | undefined;
}

function getBiddingState(shared: Record<string, unknown>): BiddingState | undefined {
  return shared.auctionBidding as BiddingState | undefined;
}

export const auctionBiddingMechanic: MechanicHooks = {
  slug: 'auction-bidding',
  name: 'Auction: Bidding',
  requires: ['auction'],

  configSchema: {
    type: 'object',
    description: 'Generic bidding auction mechanic',
    properties: {
      min_increment: { type: 'number', default: 1 },
      reserve_price: { type: 'number', default: 0 },
      items_per_round: { type: 'number', default: 1 }
    }
  },

  initSharedState(ctx: SharedStateInitContext): SharedStateInitResult | null {
    const config = getConfig(ctx.config);
    if (!config) return null;

    return {
      auctionBidding: {
        currentItem: 'item-1',
        highBid: config.reserve_price ?? 0,
        highBidder: null,
        passedPlayers: [],
        round: 1
      } as BiddingState
    };
  },

  getAvailableActions(ctx: HookContext): AvailableAction[] {
    if (!isMechanicEnabled(ctx.config, 'auction-bidding')) return [];

    const bState = getBiddingState(ctx.state.shared);
    if (!bState?.currentItem) return [];
    if (bState.passedPlayers.includes(ctx.playerId)) return [];

    const config = getConfig(ctx.config);
    const minIncrement = config?.min_increment ?? 1;

    return [
      {
        action: {
          type: 'auction_bid',
          amount: bState.highBid + minIncrement
        } as unknown as GameAction,
        priority: 70,
        category: 'auction'
      },
      {
        action: { type: 'auction_pass' } as unknown as GameAction,
        priority: 65,
        category: 'auction'
      }
    ];
  },

  onExecuteAction(ctx: ActionExecutionContext): ActionExecutionResult | null {
    if (ctx.action.type !== 'auction_bid' && ctx.action.type !== 'auction_pass') return null;

    const config = getConfig(ctx.config);
    if (!config) return null;

    const bState = getBiddingState(ctx.state.shared);
    if (!bState) return null;

    if (ctx.action.type === 'auction_pass') {
      const updatedPassed = [...bState.passedPlayers, ctx.playerId];
      const activePlayers = Object.keys(ctx.state.players).filter(p => !updatedPassed.includes(p));

      // If only one active player remains, they win
      if (activePlayers.length <= 1 && bState.highBidder) {
        return {
          handled: true,
          stateChanges: {
            sharedStateChanges: {
              auctionBidding: {
                ...bState,
                passedPlayers: updatedPassed,
                currentItem: `item-${bState.round + 1}`,
                highBid: config.reserve_price ?? 0,
                highBidder: null,
                round: bState.round + 1
              }
            },
            playerStateChanges: {
              [bState.highBidder]: {
                score: (ctx.state.players[bState.highBidder]?.score ?? 0) - bState.highBid
              }
            }
          },
          advanceTurn: true,
          checkWin: false,
          logMessage: `${bState.highBidder} wins ${bState.currentItem} for ${bState.highBid}!`,
          logData: { winner: bState.highBidder, bid: bState.highBid, item: bState.currentItem }
        };
      }

      return {
        handled: true,
        stateChanges: {
          sharedStateChanges: {
            auctionBidding: { ...bState, passedPlayers: updatedPassed }
          }
        },
        advanceTurn: true,
        checkWin: false,
        logMessage: `${ctx.playerId} passed on the auction.`,
        logData: { player: ctx.playerId }
      };
    }

    // auction_bid
    const bidAction = ctx.action as unknown as { type: 'auction_bid'; amount: number };
    const minIncrement = config.min_increment ?? 1;

    if (bidAction.amount < bState.highBid + minIncrement) {
      return {
        handled: true,
        logMessage: `Bid must be at least ${bState.highBid + minIncrement}.`,
        advanceTurn: false,
        checkWin: false
      };
    }

    return {
      handled: true,
      stateChanges: {
        sharedStateChanges: {
          auctionBidding: {
            ...bState,
            highBid: bidAction.amount,
            highBidder: ctx.playerId
          }
        }
      },
      advanceTurn: true,
      checkWin: false,
      logMessage: `${ctx.playerId} bid ${bidAction.amount}.`,
      logData: { player: ctx.playerId, amount: bidAction.amount }
    };
  },

  getPlayerView(ctx: HookContext): Record<string, unknown> | null {
    if (!isMechanicEnabled(ctx.config, 'auction-bidding')) return null;

    const bState = getBiddingState(ctx.state.shared);
    if (!bState) return null;

    return {
      auctionItem: bState.currentItem,
      highBid: bState.highBid,
      highBidder: bState.highBidder,
      hasPassed: bState.passedPlayers.includes(ctx.playerId),
      auctionRound: bState.round
    };
  }
};
