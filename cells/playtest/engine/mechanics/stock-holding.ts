/**
 * Stock Holding Mechanic
 *
 * Players buy/sell shares in companies. Share prices fluctuate based on company performance.
 * Dividends paid to shareholders.
 *
 * Hooks used:
 * - initSharedState: Create stock market
 * - getAvailableActions: 'buy_stock', 'sell_stock'
 * - onExecuteAction: Handle transactions
 * - onTurnStart: Pay dividends
 * - getPlayerView: Show portfolio
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

interface Company {
  id: string;
  name: string;
  price: number;
  dividend: number;
  totalShares: number;
}

interface StockConfig {
  companies?: Company[];
  starting_cash?: number;
}

interface StockState {
  companies: Company[];
  holdings: Record<string, Record<string, number>>; // playerId -> companyId -> shares
  cash: Record<string, number>;
}

function getConfig(config: GameConfig): StockConfig | undefined {
  return config.engine_mechanics?.stock_holding as StockConfig | undefined;
}

function getStockState(shared: Record<string, unknown>): StockState | undefined {
  return shared.stockMarket as StockState | undefined;
}

export const stockHoldingMechanic: MechanicHooks = {
  slug: 'stock-holding',
  name: 'Stock Holding',
  requires: ['resources'],

  configSchema: {
    type: 'object',
    description: 'Buy/sell company shares, earn dividends',
    properties: {
      companies: { type: 'array', description: 'Company definitions' },
      starting_cash: { type: 'number', default: 100 }
    }
  },

  initSharedState(ctx: SharedStateInitContext): SharedStateInitResult | null {
    const config = getConfig(ctx.config);
    if (!config) return null;

    const companies = config.companies ?? [
      { id: 'co-a', name: 'Company A', price: 10, dividend: 2, totalShares: 10 },
      { id: 'co-b', name: 'Company B', price: 20, dividend: 3, totalShares: 8 },
      { id: 'co-c', name: 'Company C', price: 15, dividend: 1, totalShares: 12 }
    ];

    const holdings: Record<string, Record<string, number>> = {};
    const cash: Record<string, number> = {};
    const startingCash = config.starting_cash ?? 100;

    for (const pid of ctx.playerIds) {
      holdings[pid] = {};
      cash[pid] = startingCash;
    }

    return { stockMarket: { companies, holdings, cash } as StockState };
  },

  onTurnStart(ctx: TurnStartContext): StateChanges | null {
    if (!isMechanicEnabled(ctx.config, 'stock-holding')) return null;
    if (!ctx.isNewRound) return null;

    const stockState = getStockState(ctx.state.shared);
    if (!stockState) return null;

    // Pay dividends to all shareholders
    const updatedCash = { ...stockState.cash };
    for (const [pid, portfolio] of Object.entries(stockState.holdings)) {
      for (const [companyId, shares] of Object.entries(portfolio)) {
        const company = stockState.companies.find(c => c.id === companyId);
        if (company && shares > 0) {
          updatedCash[pid] = (updatedCash[pid] ?? 0) + company.dividend * shares;
        }
      }
    }

    // Randomly adjust prices slightly
    const updatedCompanies = stockState.companies.map(c => ({
      ...c,
      price: Math.max(1, c.price + Math.floor(Math.random() * 5) - 2)
    }));

    return {
      sharedStateChanges: {
        stockMarket: { ...stockState, cash: updatedCash, companies: updatedCompanies }
      }
    };
  },

  getAvailableActions(ctx: HookContext): AvailableAction[] {
    if (!isMechanicEnabled(ctx.config, 'stock-holding')) return [];

    const stockState = getStockState(ctx.state.shared);
    if (!stockState) return [];

    const myCash = stockState.cash[ctx.playerId] ?? 0;
    const myHoldings = stockState.holdings[ctx.playerId] ?? {};
    const actions: AvailableAction[] = [];

    for (const company of stockState.companies) {
      if (myCash >= company.price) {
        actions.push({
          action: { type: 'buy_stock', companyId: company.id, shares: 1 } as unknown as GameAction,
          priority: 55,
          category: 'stock'
        });
      }
      if ((myHoldings[company.id] ?? 0) > 0) {
        actions.push({
          action: { type: 'sell_stock', companyId: company.id, shares: 1 } as unknown as GameAction,
          priority: 50,
          category: 'stock'
        });
      }
    }

    return actions;
  },

  onExecuteAction(ctx: ActionExecutionContext): ActionExecutionResult | null {
    if (ctx.action.type !== 'buy_stock' && ctx.action.type !== 'sell_stock') return null;

    const stockState = getStockState(ctx.state.shared);
    if (!stockState) return null;

    const action = ctx.action as unknown as { type: string; companyId: string; shares: number };
    const company = stockState.companies.find(c => c.id === action.companyId);
    if (!company) {
      return { handled: true, logMessage: 'Company not found.', advanceTurn: false, checkWin: false };
    }

    const myCash = stockState.cash[ctx.playerId] ?? 0;
    const myShares = stockState.holdings[ctx.playerId]?.[action.companyId] ?? 0;
    const shares = action.shares ?? 1;

    if (ctx.action.type === 'buy_stock') {
      const cost = company.price * shares;
      if (myCash < cost) {
        return { handled: true, logMessage: 'Not enough cash.', advanceTurn: false, checkWin: false };
      }

      const updatedHoldings = {
        ...stockState.holdings,
        [ctx.playerId]: {
          ...(stockState.holdings[ctx.playerId] ?? {}),
          [action.companyId]: myShares + shares
        }
      };
      const updatedCash = { ...stockState.cash, [ctx.playerId]: myCash - cost };

      return {
        handled: true,
        stateChanges: {
          sharedStateChanges: {
            stockMarket: { ...stockState, holdings: updatedHoldings, cash: updatedCash }
          }
        },
        advanceTurn: false,
        checkWin: false,
        logMessage: `${ctx.playerId} bought ${shares} share(s) of ${company.name} for ${cost}.`,
        logData: { player: ctx.playerId, company: company.name, shares, cost }
      };
    }

    // sell_stock
    if (myShares < shares) {
      return { handled: true, logMessage: 'Not enough shares.', advanceTurn: false, checkWin: false };
    }

    const revenue = company.price * shares;
    const updatedHoldings = {
      ...stockState.holdings,
      [ctx.playerId]: {
        ...(stockState.holdings[ctx.playerId] ?? {}),
        [action.companyId]: myShares - shares
      }
    };
    const updatedCash = { ...stockState.cash, [ctx.playerId]: myCash + revenue };

    return {
      handled: true,
      stateChanges: {
        sharedStateChanges: {
          stockMarket: { ...stockState, holdings: updatedHoldings, cash: updatedCash }
        }
      },
      advanceTurn: false,
      checkWin: false,
      logMessage: `${ctx.playerId} sold ${shares} share(s) of ${company.name} for ${revenue}.`,
      logData: { player: ctx.playerId, company: company.name, shares, revenue }
    };
  },

  getPlayerView(ctx: HookContext): Record<string, unknown> | null {
    if (!isMechanicEnabled(ctx.config, 'stock-holding')) return null;

    const stockState = getStockState(ctx.state.shared);
    if (!stockState) return null;

    return {
      stockCash: stockState.cash[ctx.playerId] ?? 0,
      portfolio: stockState.holdings[ctx.playerId] ?? {},
      stockPrices: stockState.companies.map(c => ({ id: c.id, name: c.name, price: c.price, dividend: c.dividend }))
    };
  }
};
