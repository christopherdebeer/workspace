/**
 * Auction Compensation Mechanic
 *
 * Losing bidders receive compensation for their bids. Creates interesting
 * tension between winning and benefiting from losing.
 *
 * Hooks used:
 * - initSharedState: Create auction state
 * - getAvailableActions: 'bid_compensated'
 * - onExecuteAction: Handle bids, resolve with compensation
 * - getPlayerView: Show auction state
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

interface AuctionCompConfig {
  compensation_rate?: number;  // fraction of bid returned as compensation
  min_bid?: number;
}

interface CompensationAuctionState {
  currentLot: string | null;
  bids: Record<string, number>;
  phase: 'bidding' | 'resolved' | 'idle';
  lotNumber: number;
}

function getConfig(config: GameConfig): AuctionCompConfig | undefined {
  return config.engine_mechanics?.auction_compensation as AuctionCompConfig | undefined;
}

function getAuctionState(shared: Record<string, unknown>): CompensationAuctionState | undefined {
  return shared.compensationAuction as CompensationAuctionState | undefined;
}

export const auctionCompensationMechanic: MechanicHooks = {
  slug: 'auction-compensation',
  name: 'Auction: Compensation',
  requires: ['auction'],

  configSchema: {
    type: 'object',
    description: 'Auction where losers receive compensation',
    properties: {
      compensation_rate: { type: 'number', default: 0.5 },
      min_bid: { type: 'number', default: 1 }
    }
  },

  initSharedState(ctx: SharedStateInitContext): SharedStateInitResult | null {
    const config = getConfig(ctx.config);
    if (!config) return null;

    return {
      compensationAuction: {
        currentLot: 'lot-1',
        bids: {},
        phase: 'bidding',
        lotNumber: 1
      } as CompensationAuctionState
    };
  },

  getAvailableActions(ctx: HookContext): AvailableAction[] {
    if (!isMechanicEnabled(ctx.config, 'auction-compensation')) return [];

    const aState = getAuctionState(ctx.state.shared);
    if (!aState || aState.phase !== 'bidding') return [];
    if (aState.bids[ctx.playerId] !== undefined) return [];

    return [{
      action: {
        type: 'bid_compensated',
        amount: 0
      } as unknown as GameAction,
      priority: 70,
      category: 'auction'
    }];
  },

  onExecuteAction(ctx: ActionExecutionContext): ActionExecutionResult | null {
    if (ctx.action.type !== 'bid_compensated') return null;

    const config = getConfig(ctx.config);
    if (!config) return null;

    const aState = getAuctionState(ctx.state.shared);
    if (!aState) return null;

    const bidAction = ctx.action as unknown as { type: 'bid_compensated'; amount: number };
    const updatedBids = { ...aState.bids, [ctx.playerId]: bidAction.amount };
    const allPlayers = Object.keys(ctx.state.players);
    const allBid = allPlayers.every(p => updatedBids[p] !== undefined);

    if (!allBid) {
      return {
        handled: true,
        stateChanges: {
          sharedStateChanges: {
            compensationAuction: { ...aState, bids: updatedBids }
          }
        },
        advanceTurn: true,
        checkWin: false,
        logMessage: `${ctx.playerId} placed a bid.`,
        logData: { player: ctx.playerId }
      };
    }

    // Resolve auction
    const entries = Object.entries(updatedBids);
    entries.sort(([, a], [, b]) => b - a);
    const winnerId = entries[0][0];
    const winningBid = entries[0][1];
    const compRate = config.compensation_rate ?? 0.5;

    const playerChanges: Record<string, { score: number }> = {};
    // Winner pays bid
    playerChanges[winnerId] = {
      score: (ctx.state.players[winnerId]?.score ?? 0) - winningBid
    };

    // Losers get compensation
    for (const [pid, bid] of entries.slice(1)) {
      const compensation = Math.floor(bid * compRate);
      playerChanges[pid] = {
        score: (ctx.state.players[pid]?.score ?? 0) + compensation
      };
    }

    return {
      handled: true,
      stateChanges: {
        sharedStateChanges: {
          compensationAuction: {
            currentLot: `lot-${aState.lotNumber + 1}`,
            bids: {},
            phase: 'bidding',
            lotNumber: aState.lotNumber + 1
          }
        },
        playerStateChanges: playerChanges
      },
      advanceTurn: true,
      checkWin: false,
      logMessage: `Auction resolved! ${winnerId} won with bid ${winningBid}. Losers compensated.`,
      logData: { winner: winnerId, bid: winningBid, compensationRate: compRate }
    };
  },

  getPlayerView(ctx: HookContext): Record<string, unknown> | null {
    if (!isMechanicEnabled(ctx.config, 'auction-compensation')) return null;

    const aState = getAuctionState(ctx.state.shared);
    if (!aState) return null;

    return {
      auctionLot: aState.currentLot,
      auctionPhase: aState.phase,
      hasBid: aState.bids[ctx.playerId] !== undefined,
      bidCount: Object.keys(aState.bids).length
    };
  }
};
