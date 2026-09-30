/**
 * Commodity Speculation Mechanic
 *
 * Buy/sell commodities with fluctuating prices to profit from market changes.
 * Prices change each round based on supply/demand.
 *
 * Hooks used:
 * - initSharedState: Create commodity market
 * - getAvailableActions: 'buy_commodity', 'sell_commodity'
 * - onExecuteAction: Execute trades
 * - onTurnStart: Fluctuate prices
 * - getPlayerView: Show market prices and inventory
 */

import {
  MechanicHooks,
  HookContext,
  ActionExecutionContext,
  ActionExecutionResult,
  AvailableAction,
  SharedStateInitContext,
  SharedStateInitResult,
  TurnStartContext,
  StateChanges,
  isMechanicEnabled
} from './types';
import { GameAction, GameConfig } from '../types/game';

interface Commodity {
  id: string;
  name: string;
  price: number;
  minPrice: number;
  maxPrice: number;
  volatility: number;
}

interface CommodityConfig {
  commodities?: Commodity[];
  starting_cash?: number;
}

interface CommodityState {
  commodities: Commodity[];
  inventories: Record<string, Record<string, number>>; // playerId -> commodityId -> quantity
  cash: Record<string, number>;
  priceHistory: Array<Record<string, number>>;
}

function getConfig(config: GameConfig): CommodityConfig | undefined {
  return config.engine_mechanics?.commodity_speculation as CommodityConfig | undefined;
}

function getCommodityState(shared: Record<string, unknown>): CommodityState | undefined {
  return shared.commodityMarket as CommodityState | undefined;
}

export const commoditySpeculationMechanic: MechanicHooks = {
  slug: 'commodity-speculation',
  name: 'Commodity Speculation',
  requires: ['resources'],

  configSchema: {
    type: 'object',
    description: 'Trade commodities with fluctuating prices',
    properties: {
      commodities: { type: 'array', description: 'Commodity definitions' },
      starting_cash: { type: 'number', default: 50 }
    }
  },

  initSharedState(ctx: SharedStateInitContext): SharedStateInitResult | null {
    const config = getConfig(ctx.config);
    if (!config) return null;

    const commodities = config.commodities ?? [
      { id: 'wheat', name: 'Wheat', price: 5, minPrice: 2, maxPrice: 15, volatility: 2 },
      { id: 'ore', name: 'Ore', price: 8, minPrice: 3, maxPrice: 20, volatility: 3 },
      { id: 'silk', name: 'Silk', price: 12, minPrice: 5, maxPrice: 25, volatility: 4 }
    ];

    const inventories: Record<string, Record<string, number>> = {};
    const cash: Record<string, number> = {};
    const startCash = config.starting_cash ?? 50;

    for (const pid of ctx.playerIds) {
      inventories[pid] = {};
      cash[pid] = startCash;
    }

    return {
      commodityMarket: {
        commodities,
        inventories,
        cash,
        priceHistory: [Object.fromEntries(commodities.map(c => [c.id, c.price]))]
      } as CommodityState
    };
  },

  onTurnStart(ctx: TurnStartContext): StateChanges | null {
    if (!isMechanicEnabled(ctx.config, 'commodity-speculation')) return null;
    if (!ctx.isNewRound) return null;

    const cmState = getCommodityState(ctx.state.shared);
    if (!cmState) return null;

    const updatedCommodities = cmState.commodities.map(c => {
      const change = Math.floor(Math.random() * (c.volatility * 2 + 1)) - c.volatility;
      const newPrice = Math.max(c.minPrice, Math.min(c.maxPrice, c.price + change));
      return { ...c, price: newPrice };
    });

    const priceSnapshot = Object.fromEntries(updatedCommodities.map(c => [c.id, c.price]));

    return {
      sharedStateChanges: {
        commodityMarket: {
          ...cmState,
          commodities: updatedCommodities,
          priceHistory: [...cmState.priceHistory, priceSnapshot]
        }
      }
    };
  },

  getAvailableActions(ctx: HookContext): AvailableAction[] {
    if (!isMechanicEnabled(ctx.config, 'commodity-speculation')) return [];

    const cmState = getCommodityState(ctx.state.shared);
    if (!cmState) return [];

    const myCash = cmState.cash[ctx.playerId] ?? 0;
    const myInv = cmState.inventories[ctx.playerId] ?? {};
    const actions: AvailableAction[] = [];

    for (const c of cmState.commodities) {
      if (myCash >= c.price) {
        actions.push({
          action: { type: 'buy_commodity', commodityId: c.id, quantity: 1 } as unknown as GameAction,
          priority: 50,
          category: 'commodity'
        });
      }
      if ((myInv[c.id] ?? 0) > 0) {
        actions.push({
          action: { type: 'sell_commodity', commodityId: c.id, quantity: 1 } as unknown as GameAction,
          priority: 50,
          category: 'commodity'
        });
      }
    }

    return actions;
  },

  onExecuteAction(ctx: ActionExecutionContext): ActionExecutionResult | null {
    if (ctx.action.type !== 'buy_commodity' && ctx.action.type !== 'sell_commodity') return null;

    const cmState = getCommodityState(ctx.state.shared);
    if (!cmState) return null;

    const tradeAction = ctx.action as unknown as { type: string; commodityId: string; quantity: number };
    const commodity = cmState.commodities.find(c => c.id === tradeAction.commodityId);
    if (!commodity) {
      return { handled: true, logMessage: 'Commodity not found.', advanceTurn: false, checkWin: false };
    }

    const qty = tradeAction.quantity ?? 1;
    const myCash = cmState.cash[ctx.playerId] ?? 0;
    const myQty = cmState.inventories[ctx.playerId]?.[tradeAction.commodityId] ?? 0;

    if (ctx.action.type === 'buy_commodity') {
      const cost = commodity.price * qty;
      if (myCash < cost) {
        return { handled: true, logMessage: 'Not enough cash.', advanceTurn: false, checkWin: false };
      }

      return {
        handled: true,
        stateChanges: {
          sharedStateChanges: {
            commodityMarket: {
              ...cmState,
              cash: { ...cmState.cash, [ctx.playerId]: myCash - cost },
              inventories: {
                ...cmState.inventories,
                [ctx.playerId]: {
                  ...(cmState.inventories[ctx.playerId] ?? {}),
                  [tradeAction.commodityId]: myQty + qty
                }
              }
            }
          }
        },
        advanceTurn: false,
        checkWin: false,
        logMessage: `${ctx.playerId} bought ${qty} ${commodity.name} for ${cost}.`,
        logData: { player: ctx.playerId, commodity: commodity.name, qty, cost }
      };
    }

    // sell
    if (myQty < qty) {
      return { handled: true, logMessage: 'Not enough inventory.', advanceTurn: false, checkWin: false };
    }

    const revenue = commodity.price * qty;
    return {
      handled: true,
      stateChanges: {
        sharedStateChanges: {
          commodityMarket: {
            ...cmState,
            cash: { ...cmState.cash, [ctx.playerId]: myCash + revenue },
            inventories: {
              ...cmState.inventories,
              [ctx.playerId]: {
                ...(cmState.inventories[ctx.playerId] ?? {}),
                [tradeAction.commodityId]: myQty - qty
              }
            }
          }
        }
      },
      advanceTurn: false,
      checkWin: false,
      logMessage: `${ctx.playerId} sold ${qty} ${commodity.name} for ${revenue}.`,
      logData: { player: ctx.playerId, commodity: commodity.name, qty, revenue }
    };
  },

  getPlayerView(ctx: HookContext): Record<string, unknown> | null {
    if (!isMechanicEnabled(ctx.config, 'commodity-speculation')) return null;

    const cmState = getCommodityState(ctx.state.shared);
    if (!cmState) return null;

    return {
      commodityCash: cmState.cash[ctx.playerId] ?? 0,
      commodityInventory: cmState.inventories[ctx.playerId] ?? {},
      commodityPrices: cmState.commodities.map(c => ({ id: c.id, name: c.name, price: c.price })),
      priceHistory: cmState.priceHistory.slice(-5)
    };
  }
};
