/**
 * Auction Multiple Lot Mechanic
 *
 * Multiple items auctioned simultaneously. Players distribute bids across lots.
 *
 * Hooks used:
 * - initSharedState: Create lots
 * - getAvailableActions: 'bid_multi_lot'
 * - onExecuteAction: Distribute bids, resolve
 * - getPlayerView: Show lots
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

interface Lot {
  id: string;
  name: string;
  value: number;
}

interface MultiLotConfig {
  lots?: Lot[];
  bid_budget?: number;
}

interface MultiLotState {
  lots: Lot[];
  bids: Record<string, Record<string, number>>; // playerId -> lotId -> bid
  budget: number;
  resolved: boolean;
}

function getConfig(config: GameConfig): MultiLotConfig | undefined {
  return config.engine_mechanics?.auction_multiple_lot as MultiLotConfig | undefined;
}

function getMultiLotState(shared: Record<string, unknown>): MultiLotState | undefined {
  return shared.multiLotAuction as MultiLotState | undefined;
}

export const auctionMultipleLotMechanic: MechanicHooks = {
  slug: 'auction-multiple-lot',
  name: 'Auction: Multiple Lot',
  requires: ['auction'],

  configSchema: {
    type: 'object',
    description: 'Multiple items auctioned simultaneously',
    properties: {
      lots: { type: 'array', description: 'Lot definitions' },
      bid_budget: { type: 'number', default: 10 }
    }
  },

  initSharedState(ctx: SharedStateInitContext): SharedStateInitResult | null {
    const config = getConfig(ctx.config);
    if (!config) return null;

    const lots = config.lots ?? [
      { id: 'lot-a', name: 'Lot A', value: 5 },
      { id: 'lot-b', name: 'Lot B', value: 3 },
      { id: 'lot-c', name: 'Lot C', value: 4 }
    ];

    return {
      multiLotAuction: {
        lots,
        bids: {},
        budget: config.bid_budget ?? 10,
        resolved: false
      } as MultiLotState
    };
  },

  getAvailableActions(ctx: HookContext): AvailableAction[] {
    if (!isMechanicEnabled(ctx.config, 'auction-multiple-lot')) return [];

    const mlState = getMultiLotState(ctx.state.shared);
    if (!mlState || mlState.resolved) return [];
    if (mlState.bids[ctx.playerId]) return [];

    return [{
      action: {
        type: 'bid_multi_lot',
        allocations: {}  // lotId -> amount
      } as unknown as GameAction,
      priority: 70,
      category: 'auction'
    }];
  },

  onExecuteAction(ctx: ActionExecutionContext): ActionExecutionResult | null {
    if (ctx.action.type !== 'bid_multi_lot') return null;

    const config = getConfig(ctx.config);
    if (!config) return null;

    const mlState = getMultiLotState(ctx.state.shared);
    if (!mlState) return null;

    const bidAction = ctx.action as unknown as { type: 'bid_multi_lot'; allocations: Record<string, number> };
    const allocations = bidAction.allocations ?? {};

    // Validate total bid doesn't exceed budget
    const totalBid = Object.values(allocations).reduce((sum, v) => sum + v, 0);
    if (totalBid > mlState.budget) {
      return { handled: true, logMessage: `Total bids (${totalBid}) exceed budget (${mlState.budget}).`, advanceTurn: false, checkWin: false };
    }

    const updatedBids = { ...mlState.bids, [ctx.playerId]: allocations };
    const allPlayers = Object.keys(ctx.state.players);
    const allBid = allPlayers.every(p => updatedBids[p] !== undefined);

    if (!allBid) {
      return {
        handled: true,
        stateChanges: {
          sharedStateChanges: {
            multiLotAuction: { ...mlState, bids: updatedBids }
          }
        },
        advanceTurn: true,
        checkWin: false,
        logMessage: `${ctx.playerId} submitted bid allocations.`,
        logData: { player: ctx.playerId }
      };
    }

    // Resolve - highest bidder per lot wins
    const playerChanges: Record<string, { score: number }> = {};
    for (const lot of mlState.lots) {
      let highestBid = 0;
      let winner = '';
      for (const [pid, allocs] of Object.entries(updatedBids)) {
        const bid = allocs[lot.id] ?? 0;
        if (bid > highestBid) {
          highestBid = bid;
          winner = pid;
        }
      }
      if (winner) {
        const current = playerChanges[winner]?.score ?? (ctx.state.players[winner]?.score ?? 0);
        playerChanges[winner] = { score: current + lot.value - highestBid };
      }
    }

    return {
      handled: true,
      stateChanges: {
        sharedStateChanges: {
          multiLotAuction: { ...mlState, bids: updatedBids, resolved: true }
        },
        playerStateChanges: playerChanges
      },
      advanceTurn: true,
      checkWin: true,
      logMessage: 'Multi-lot auction resolved!',
      logData: { bids: updatedBids }
    };
  },

  getPlayerView(ctx: HookContext): Record<string, unknown> | null {
    if (!isMechanicEnabled(ctx.config, 'auction-multiple-lot')) return null;

    const mlState = getMultiLotState(ctx.state.shared);
    if (!mlState) return null;

    return {
      auctionLots: mlState.lots,
      bidBudget: mlState.budget,
      hasBid: !!mlState.bids[ctx.playerId],
      resolved: mlState.resolved
    };
  }
};
