/**
 * Auction Dutch Priority Mechanic
 *
 * Dutch auction with priority rules - price descends, first claimer wins.
 * Priority order determines who gets to claim first at each price.
 *
 * Hooks used:
 * - initSharedState: Set up descending price
 * - getAvailableActions: 'claim_at_price' or 'pass_price'
 * - onExecuteAction: Claim item or pass
 * - getPlayerView: Show current price
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

interface DutchPriorityConfig {
  start_price?: number;
  price_decrement?: number;
  min_price?: number;
}

interface DutchPriorityState {
  currentPrice: number;
  currentItem: string;
  claimed: boolean;
  claimedBy: string | null;
  passedAtPrice: Record<string, number[]>; // playerId -> prices they passed at
  round: number;
}

function getConfig(config: GameConfig): DutchPriorityConfig | undefined {
  return config.engine_mechanics?.auction_dutch_priority as DutchPriorityConfig | undefined;
}

function getDutchState(shared: Record<string, unknown>): DutchPriorityState | undefined {
  return shared.dutchPriorityAuction as DutchPriorityState | undefined;
}

export const auctionDutchPriorityMechanic: MechanicHooks = {
  slug: 'auction-dutch-priority',
  name: 'Auction: Dutch Priority',
  requires: ['auction'],

  configSchema: {
    type: 'object',
    description: 'Dutch auction with priority claiming',
    properties: {
      start_price: { type: 'number', default: 20 },
      price_decrement: { type: 'number', default: 2 },
      min_price: { type: 'number', default: 1 }
    }
  },

  initSharedState(ctx: SharedStateInitContext): SharedStateInitResult | null {
    const config = getConfig(ctx.config);
    if (!config) return null;

    return {
      dutchPriorityAuction: {
        currentPrice: config.start_price ?? 20,
        currentItem: 'item-1',
        claimed: false,
        claimedBy: null,
        passedAtPrice: {},
        round: 1
      } as DutchPriorityState
    };
  },

  getAvailableActions(ctx: HookContext): AvailableAction[] {
    if (!isMechanicEnabled(ctx.config, 'auction-dutch-priority')) return [];

    const dpState = getDutchState(ctx.state.shared);
    if (!dpState || dpState.claimed) return [];

    return [
      {
        action: { type: 'claim_at_price', price: dpState.currentPrice } as unknown as GameAction,
        priority: 70,
        category: 'auction'
      },
      {
        action: { type: 'pass_price' } as unknown as GameAction,
        priority: 65,
        category: 'auction'
      }
    ];
  },

  onExecuteAction(ctx: ActionExecutionContext): ActionExecutionResult | null {
    if (ctx.action.type !== 'claim_at_price' && ctx.action.type !== 'pass_price') return null;

    const config = getConfig(ctx.config);
    if (!config) return null;

    const dpState = getDutchState(ctx.state.shared);
    if (!dpState) return null;

    if (ctx.action.type === 'claim_at_price') {
      return {
        handled: true,
        stateChanges: {
          sharedStateChanges: {
            dutchPriorityAuction: {
              ...dpState,
              claimed: true,
              claimedBy: ctx.playerId
            }
          },
          playerStateChanges: {
            [ctx.playerId]: { score: (ctx.player.score ?? 0) - dpState.currentPrice }
          }
        },
        advanceTurn: true,
        checkWin: false,
        logMessage: `${ctx.playerId} claimed ${dpState.currentItem} at price ${dpState.currentPrice}!`,
        logData: { player: ctx.playerId, price: dpState.currentPrice, item: dpState.currentItem }
      };
    }

    // pass_price - decrease price
    const decrement = config.price_decrement ?? 2;
    const minPrice = config.min_price ?? 1;
    const newPrice = Math.max(minPrice, dpState.currentPrice - decrement);

    const passed = { ...dpState.passedAtPrice };
    passed[ctx.playerId] = [...(passed[ctx.playerId] ?? []), dpState.currentPrice];

    return {
      handled: true,
      stateChanges: {
        sharedStateChanges: {
          dutchPriorityAuction: {
            ...dpState,
            currentPrice: newPrice,
            passedAtPrice: passed
          }
        }
      },
      advanceTurn: true,
      checkWin: false,
      logMessage: `${ctx.playerId} passed. Price drops to ${newPrice}.`,
      logData: { player: ctx.playerId, newPrice }
    };
  },

  getPlayerView(ctx: HookContext): Record<string, unknown> | null {
    if (!isMechanicEnabled(ctx.config, 'auction-dutch-priority')) return null;

    const dpState = getDutchState(ctx.state.shared);
    if (!dpState) return null;

    return {
      dutchCurrentPrice: dpState.currentPrice,
      dutchItem: dpState.currentItem,
      dutchClaimed: dpState.claimed,
      dutchClaimedBy: dpState.claimedBy
    };
  }
};
