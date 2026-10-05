/**
 * Market (Supply & Demand) Mechanic
 *
 * Dynamic pricing system where commodity prices fluctuate based on
 * player buying and selling activity.
 *
 * Config:
 *   market:
 *     commodities: CommodityDef[]     # Available commodities
 *     price_volatility: number         # How much prices change (0-1)
 *     price_floor: number              # Minimum price
 *     price_ceiling: number            # Maximum price
 *     currency: string                 # Currency resource
 */

import { MechanicHooks, HookContext, ValidationResult, ActionExecutionContext, ActionExecutionResult, AvailableAction, SharedStateInitContext, SharedStateInitResult } from './types';
import { GameAction, GameConfig } from '../types/game';

interface MarketConfig {
  commodities?: CommodityDef[];
  price_volatility?: number;
  price_floor?: number;
  price_ceiling?: number;
  currency?: string;
}

interface CommodityDef {
  id: string;
  name: string;
  base_price: number;
  supply?: number;
  demand_decay?: number;
}

interface MarketState {
  prices: Record<string, number>;
  supply: Record<string, number>;
  demandHistory: Record<string, number[]>;
  totalBuys: Record<string, number>;
  totalSells: Record<string, number>;
}

function getConfig(config: GameConfig): MarketConfig | undefined {
  return config.engine_mechanics?.market as MarketConfig | undefined;
}

function clampPrice(price: number, floor: number, ceiling: number): number {
  return Math.max(floor, Math.min(ceiling, Math.round(price * 100) / 100));
}

export const marketMechanic: MechanicHooks = {
  slug: 'market',
  name: 'Market (Supply & Demand)',
  requires: ['resources'],

  configSchema: {
    type: 'object',
    description: 'Dynamic commodity pricing system',
    properties: {
      commodities: {
        type: 'array',
        description: 'Available commodities with base prices'
      },
      price_volatility: {
        type: 'number',
        description: 'Price change rate (0-1)',
        default: 0.1
      },
      price_floor: {
        type: 'number',
        description: 'Minimum commodity price',
        default: 1
      },
      price_ceiling: {
        type: 'number',
        description: 'Maximum commodity price',
        default: 100
      },
      currency: {
        type: 'string',
        description: 'Currency resource for transactions',
        default: 'gold'
      }
    }
  },

  initSharedState(ctx: SharedStateInitContext): SharedStateInitResult | null {
    const config = getConfig(ctx.config);
    if (!config || !config.commodities) return null;

    const prices: Record<string, number> = {};
    const supply: Record<string, number> = {};
    const demandHistory: Record<string, number[]> = {};
    const totalBuys: Record<string, number> = {};
    const totalSells: Record<string, number> = {};

    for (const commodity of config.commodities) {
      prices[commodity.id] = commodity.base_price;
      supply[commodity.id] = commodity.supply ?? 10;
      demandHistory[commodity.id] = [];
      totalBuys[commodity.id] = 0;
      totalSells[commodity.id] = 0;
    }

    const marketState: MarketState = {
      prices,
      supply,
      demandHistory,
      totalBuys,
      totalSells
    };

    return { market: marketState };
  },

  preValidateAction(ctx: HookContext, action: GameAction): ValidationResult | null {
    if (action.type !== 'buy_market' && action.type !== 'sell_market') return null;

    const config = getConfig(ctx.config);
    if (!config) return { valid: false, error: 'Market not enabled.' };

    const marketAction = action as unknown as {
      type: 'buy_market' | 'sell_market';
      commodity: string;
      quantity: number;
    };

    if (!marketAction.commodity) {
      return { valid: false, error: 'Must specify commodity.' };
    }

    const quantity = marketAction.quantity ?? 1;
    if (quantity < 1) {
      return { valid: false, error: 'Quantity must be at least 1.' };
    }

    const marketState = ctx.state.shared.market as MarketState | undefined;
    if (!marketState) return { valid: false, error: 'Market not initialized.' };

    const price = marketState.prices[marketAction.commodity];
    if (price === undefined) {
      return { valid: false, error: `Unknown commodity: ${marketAction.commodity}.` };
    }

    const currency = config.currency ?? 'gold';
    const resources = (ctx.player.resources as Record<string, number>) ?? {};

    if (action.type === 'buy_market') {
      const totalCost = price * quantity;
      const available = resources[currency] ?? 0;
      if (available < totalCost) {
        return { valid: false, error: `Not enough ${currency}. Need ${totalCost}, have ${available}.` };
      }

      if (marketState.supply[marketAction.commodity] < quantity) {
        return { valid: false, error: `Not enough supply. Only ${marketState.supply[marketAction.commodity]} available.` };
      }
    }

    if (action.type === 'sell_market') {
      const playerStock = resources[marketAction.commodity] ?? 0;
      if (playerStock < quantity) {
        return { valid: false, error: `Not enough ${marketAction.commodity} to sell. Have ${playerStock}, need ${quantity}.` };
      }
    }

    return { valid: true };
  },

  onExecuteAction(ctx: ActionExecutionContext): ActionExecutionResult | null {
    if (ctx.action.type !== 'buy_market' && ctx.action.type !== 'sell_market') return null;

    const config = getConfig(ctx.config);
    if (!config) return null;

    const marketAction = ctx.action as unknown as {
      type: 'buy_market' | 'sell_market';
      commodity: string;
      quantity: number;
    };

    const quantity = marketAction.quantity ?? 1;
    const currency = config.currency ?? 'gold';
    const volatility = config.price_volatility ?? 0.1;
    const floor = config.price_floor ?? 1;
    const ceiling = config.price_ceiling ?? 100;

    const marketState = { ...(ctx.state.shared.market as MarketState) };
    const prices = { ...marketState.prices };
    const supplyState = { ...marketState.supply };
    const totalBuys = { ...marketState.totalBuys };
    const totalSells = { ...marketState.totalSells };

    const currentPrice = prices[marketAction.commodity];
    const resources = { ...((ctx.state.players[ctx.playerId]?.resources as Record<string, number>) ?? {}) };

    let logMessage: string;

    if (ctx.action.type === 'buy_market') {
      const totalCost = currentPrice * quantity;
      resources[currency] = (resources[currency] ?? 0) - totalCost;
      resources[marketAction.commodity] = (resources[marketAction.commodity] ?? 0) + quantity;
      supplyState[marketAction.commodity] -= quantity;
      totalBuys[marketAction.commodity] += quantity;

      // Price increases when buying (demand goes up)
      prices[marketAction.commodity] = clampPrice(
        currentPrice * (1 + volatility * quantity),
        floor,
        ceiling
      );

      logMessage = `${ctx.playerId} bought ${quantity} ${marketAction.commodity} for ${totalCost} ${currency}. Price now ${prices[marketAction.commodity]}.`;
    } else {
      // Selling
      const totalRevenue = currentPrice * quantity;
      resources[currency] = (resources[currency] ?? 0) + totalRevenue;
      resources[marketAction.commodity] = (resources[marketAction.commodity] ?? 0) - quantity;
      supplyState[marketAction.commodity] += quantity;
      totalSells[marketAction.commodity] += quantity;

      // Price decreases when selling (supply goes up)
      prices[marketAction.commodity] = clampPrice(
        currentPrice * (1 - volatility * quantity),
        floor,
        ceiling
      );

      logMessage = `${ctx.playerId} sold ${quantity} ${marketAction.commodity} for ${totalRevenue} ${currency}. Price now ${prices[marketAction.commodity]}.`;
    }

    marketState.prices = prices;
    marketState.supply = supplyState;
    marketState.totalBuys = totalBuys;
    marketState.totalSells = totalSells;

    return {
      handled: true,
      stateChanges: {
        sharedStateChanges: { market: marketState },
        playerStateChanges: {
          [ctx.playerId]: { resources }
        }
      },
      advanceTurn: false,
      checkWin: false,
      logMessage
    };
  },

  getAvailableActions(ctx: HookContext): AvailableAction[] {
    const config = getConfig(ctx.config);
    if (!config) return [];

    const marketState = ctx.state.shared.market as MarketState | undefined;
    if (!marketState) return [];

    const actions: AvailableAction[] = [];
    const currency = config.currency ?? 'gold';
    const resources = (ctx.player.resources as Record<string, number>) ?? {};
    const available = resources[currency] ?? 0;

    for (const [commodityId, price] of Object.entries(marketState.prices)) {
      // Buy action (if can afford at least 1)
      if (available >= price && marketState.supply[commodityId] > 0) {
        actions.push({
          action: {
            type: 'buy_market',
            commodity: commodityId,
            quantity: 1
          } as unknown as GameAction,
          priority: 70,
          category: 'market'
        });
      }

      // Sell action (if player has any)
      const playerStock = resources[commodityId] ?? 0;
      if (playerStock > 0) {
        actions.push({
          action: {
            type: 'sell_market',
            commodity: commodityId,
            quantity: 1
          } as unknown as GameAction,
          priority: 65,
          category: 'market'
        });
      }
    }

    return actions;
  },

  getPlayerView(ctx: HookContext): Record<string, unknown> | null {
    const config = getConfig(ctx.config);
    if (!config) return null;

    const marketState = ctx.state.shared.market as MarketState | undefined;
    if (!marketState) return null;

    return {
      marketPrices: marketState.prices,
      marketSupply: marketState.supply
    };
  },

  describeAction(action: GameAction): { type: string; label: string; description: string; examples?: string[] } | null {
    if (action.type === 'buy_market') {
      return {
        type: 'buy_market',
        label: 'Buy from Market',
        description: 'Purchase a commodity at the current market price.',
        examples: ['buy_market commodity:"wheat" quantity:2']
      };
    }
    if (action.type === 'sell_market') {
      return {
        type: 'sell_market',
        label: 'Sell to Market',
        description: 'Sell a commodity at the current market price.',
        examples: ['sell_market commodity:"wheat" quantity:1']
      };
    }
    return null;
  }
};
