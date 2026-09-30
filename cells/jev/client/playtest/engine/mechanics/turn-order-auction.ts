/**
 * Turn Order Auction Mechanic
 *
 * Players bid for turn order position. Higher bids get earlier positions.
 *
 * Config:
 *   turn_order_auction:
 *     currency: string          # Resource used for bidding
 *     when: 'round_start' | 'game_start'  # When to hold auction
 *     tie_breaker: 'current_order' | 'random'  # How to break ties
 *
 * Hooks used:
 * - onDetermineTurnOrder: Trigger auction at round start
 * - onExecuteAction: Handle turn order bid
 * - getAvailableActions: Expose turn order bid action
 */

import { MechanicHooks, HookContext, ValidationResult, ActionExecutionContext, ActionExecutionResult, AvailableAction, TurnOrderContext, TurnOrderResult, StateChanges } from './types';
import { GameAction, TurnOrderBidAction, TurnOrderAuctionConfig } from '../types/game';
import { spendResource } from './core/resources';

interface TurnOrderAuction {
  bids: Record<string, number>;
  resolved: boolean;
  resultOrder?: string[];
}

export const turnOrderAuctionMechanic: MechanicHooks = {
  slug: 'turn-order-auction',
  name: 'Turn Order: Auction',
  requires: ['auction', 'resources'],

  configSchema: {
    type: 'object',
    description: 'Bid for turn order position',
    properties: {
      currency: {
        type: 'string',
        description: 'Resource used for bidding',
        required: true
      },
      when: {
        type: 'string',
        description: 'When to hold the auction',
        enum: ['round_start', 'game_start'],
        default: 'round_start'
      },
      tie_breaker: {
        type: 'string',
        description: 'How to break ties',
        enum: ['current_order', 'random'],
        default: 'current_order'
      }
    },
    required: ['currency']
  },

  preValidateAction(ctx: HookContext, action: GameAction): ValidationResult | null {
    if (action.type !== 'turn_order_bid') return null;

    const config = ctx.config.engine_mechanics?.turn_order_auction;
    if (!config) {
      return { valid: false, error: 'Turn order auction is not enabled.' };
    }

    const auction = ctx.state.shared.turnOrderAuction as TurnOrderAuction | undefined;
    if (!auction || auction.resolved) {
      return { valid: false, error: 'No active turn order auction.' };
    }

    if (auction.bids[ctx.playerId] !== undefined) {
      return { valid: false, error: 'You have already bid in this auction.' };
    }

    const bidAction = action as TurnOrderBidAction;
    const available = ctx.player.resources?.[config.currency] ?? 0;

    if (bidAction.amount < 0) {
      return { valid: false, error: 'Bid cannot be negative.' };
    }

    if (bidAction.amount > available) {
      return {
        valid: false,
        error: `Not enough ${config.currency}. You have ${available}.`
      };
    }

    return { valid: true };
  },

  onExecuteAction(ctx: ActionExecutionContext): ActionExecutionResult | null {
    const { action, state, playerId } = ctx;
    if (action.type !== 'turn_order_bid') return null;

    const config = ctx.config.engine_mechanics?.turn_order_auction;
    if (!config) return null;

    const auction = state.shared.turnOrderAuction as TurnOrderAuction;
    const bidAction = action as TurnOrderBidAction;

    // Record bid
    auction.bids[playerId] = bidAction.amount;

    // Check if all players have bid
    const activePlayers = Object.keys(state.players).filter(
      pid => state.players[pid].state !== 'eliminated'
    );
    const allBidsIn = activePlayers.every(pid => auction.bids[pid] !== undefined);

    const stateChanges: StateChanges = {};

    if (allBidsIn) {
      // Resolve auction - sort by bid (descending), then by tie breaker
      const playerBids = Object.entries(auction.bids);

      playerBids.sort((a, b) => {
        const bidDiff = b[1] - a[1];
        if (bidDiff !== 0) return bidDiff;

        // Tie breaker
        if (config.tie_breaker === 'random') {
          return Math.random() - 0.5;
        }
        // Default: current order
        return state.turnOrder.indexOf(a[0]) - state.turnOrder.indexOf(b[0]);
      });

      const newOrder = playerBids.map(([pid]) => pid);
      auction.resolved = true;
      auction.resultOrder = newOrder;

      // Deduct bids from all players via resource service (fires hooks)
      for (const [pid, bid] of playerBids) {
        if (bid > 0) {
          spendResource(state, pid, config.currency, bid);
        }
      }

      stateChanges.sharedStateChanges = {
        turnOrderAuction: auction,
        pendingTurnOrder: newOrder
      };

      return {
        handled: true,
        stateChanges,
        advanceTurn: false,
        checkWin: false,
        logMessage: `Turn order auction resolved: ${newOrder.join(' -> ')}`
      };
    }

    stateChanges.sharedStateChanges = { turnOrderAuction: auction };

    return {
      handled: true,
      stateChanges,
      advanceTurn: false,
      checkWin: false,
      logMessage: `${playerId} bid ${bidAction.amount} for turn order`
    };
  },

  onDetermineTurnOrder(ctx: TurnOrderContext): TurnOrderResult | null {
    const config = ctx.config.engine_mechanics?.turn_order_auction;
    if (!config) return null;

    if (ctx.reason !== 'round_start') return null;

    const auction = ctx.state.shared.turnOrderAuction as TurnOrderAuction | undefined;

    // If there's a resolved auction with a pending order, apply it
    if (auction?.resolved && auction.resultOrder) {
      return { order: auction.resultOrder };
    }

    return null;
  },

  getAvailableActions(ctx: HookContext): AvailableAction[] {
    const config = ctx.config.engine_mechanics?.turn_order_auction;
    if (!config) return [];

    const auction = ctx.state.shared.turnOrderAuction as TurnOrderAuction | undefined;
    if (!auction || auction.resolved) return [];

    if (auction.bids[ctx.playerId] !== undefined) return [];

    return [{
      action: {
        type: 'turn_order_bid',
        amount: 0
      } as TurnOrderBidAction,
      priority: 95,
      category: 'turn_order'
    }];
  }
};
