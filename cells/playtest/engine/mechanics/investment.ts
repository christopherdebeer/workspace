/**
 * Investment Mechanic
 *
 * Spend resources now for future returns. Investments mature over rounds
 * and pay out multiplied returns.
 *
 * Hooks used:
 * - initSharedState: Create investment tracking
 * - getAvailableActions: 'invest' action
 * - onExecuteAction: Place investments
 * - onTurnStart: Mature investments
 * - getPlayerView: Show active investments
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

interface InvestmentConfig {
  maturity_rounds?: number;
  return_multiplier?: number;
  max_investments?: number;
}

interface Investment {
  id: string;
  playerId: string;
  amount: number;
  roundPlaced: number;
  maturesAt: number;
  returned: boolean;
}

interface InvestmentState {
  investments: Investment[];
  nextId: number;
  currentRound: number;
}

function getConfig(config: GameConfig): InvestmentConfig | undefined {
  return config.engine_mechanics?.investment as InvestmentConfig | undefined;
}

function getInvestState(shared: Record<string, unknown>): InvestmentState | undefined {
  return shared.investments as InvestmentState | undefined;
}

export const investmentMechanic: MechanicHooks = {
  slug: 'investment',
  name: 'Investment',
  requires: ['resources'],

  configSchema: {
    type: 'object',
    description: 'Spend resources now for multiplied future returns',
    properties: {
      maturity_rounds: { type: 'number', default: 3 },
      return_multiplier: { type: 'number', default: 2 },
      max_investments: { type: 'number', default: 5 }
    }
  },

  initSharedState(ctx: SharedStateInitContext): SharedStateInitResult | null {
    const config = getConfig(ctx.config);
    if (!config) return null;

    return {
      investments: { investments: [], nextId: 1, currentRound: 1 } as InvestmentState
    };
  },

  onTurnStart(ctx: TurnStartContext): StateChanges | null {
    if (!isMechanicEnabled(ctx.config, 'investment')) return null;
    if (!ctx.isNewRound) return null;

    const invState = getInvestState(ctx.state.shared);
    if (!invState) return null;

    const config = getConfig(ctx.config);
    const multiplier = config?.return_multiplier ?? 2;
    // Use game round for consistency, falling back to internal tracking
    const newRound = ctx.state.round ?? (invState.currentRound + 1);

    // Find matured investments
    const maturedInvestments = invState.investments.filter(
      inv => !inv.returned && inv.maturesAt <= newRound
    );

    const playerChanges: Record<string, { score: number }> = {};
    const updatedInvestments = invState.investments.map(inv => {
      if (!inv.returned && inv.maturesAt <= newRound) {
        const returnAmount = inv.amount * multiplier;
        const pid = inv.playerId;
        const currentScore = ctx.state.players[pid]?.score ?? 0;
        const existing = playerChanges[pid]?.score ?? currentScore;
        playerChanges[pid] = { score: existing + returnAmount };
        return { ...inv, returned: true };
      }
      return inv;
    });

    if (maturedInvestments.length === 0) {
      return {
        sharedStateChanges: {
          investments: { ...invState, currentRound: newRound }
        }
      };
    }

    return {
      sharedStateChanges: {
        investments: { ...invState, investments: updatedInvestments, currentRound: newRound }
      },
      playerStateChanges: playerChanges
    };
  },

  getAvailableActions(ctx: HookContext): AvailableAction[] {
    if (!isMechanicEnabled(ctx.config, 'investment')) return [];

    const config = getConfig(ctx.config);
    const invState = getInvestState(ctx.state.shared);
    if (!invState) return [];

    const myInvestments = invState.investments.filter(
      inv => inv.playerId === ctx.playerId && !inv.returned
    );
    const maxInv = config?.max_investments ?? 5;

    if (myInvestments.length >= maxInv) return [];

    return [{
      action: { type: 'invest', amount: 1 } as unknown as GameAction,
      priority: 45,
      category: 'economic'
    }];
  },

  onExecuteAction(ctx: ActionExecutionContext): ActionExecutionResult | null {
    if (ctx.action.type !== 'invest') return null;

    const config = getConfig(ctx.config);
    if (!config) return null;

    const invState = getInvestState(ctx.state.shared);
    if (!invState) return null;

    const investAction = ctx.action as unknown as { type: 'invest'; amount: number; resource?: string };
    const amount = investAction.amount ?? 1;
    const maturityRounds = config.maturity_rounds ?? 3;
    const currentRound = ctx.state.round ?? invState.currentRound;

    const newInvestment: Investment = {
      id: `inv-${invState.nextId}`,
      playerId: ctx.playerId,
      amount,
      roundPlaced: currentRound,
      maturesAt: currentRound + maturityRounds,
      returned: false
    };

    // Deduct cost from resources (not score)
    const resourceKey = investAction.resource || 'coins';
    const currentResources = { ...(ctx.player.resources || {}) };
    const currentAmount = currentResources[resourceKey] ?? 0;
    currentResources[resourceKey] = currentAmount - amount;

    return {
      handled: true,
      stateChanges: {
        sharedStateChanges: {
          investments: {
            ...invState,
            investments: [...invState.investments, newInvestment],
            nextId: invState.nextId + 1,
            currentRound
          }
        },
        playerStateChanges: {
          [ctx.playerId]: { resources: currentResources }
        }
      },
      advanceTurn: false,
      checkWin: false,
      logMessage: `${ctx.playerId} invested ${amount} (matures in ${maturityRounds} rounds).`,
      logData: { player: ctx.playerId, amount, maturesAt: newInvestment.maturesAt }
    };
  },

  getPlayerView(ctx: HookContext): Record<string, unknown> | null {
    if (!isMechanicEnabled(ctx.config, 'investment')) return null;

    const invState = getInvestState(ctx.state.shared);
    if (!invState) return null;

    const config = getConfig(ctx.config);
    const myInvestments = invState.investments
      .filter(inv => inv.playerId === ctx.playerId)
      .map(inv => ({
        id: inv.id,
        amount: inv.amount,
        maturesAt: inv.maturesAt,
        returned: inv.returned,
        expectedReturn: inv.amount * (config?.return_multiplier ?? 2)
      }));

    return {
      activeInvestments: myInvestments.filter(i => !i.returned),
      currentRound: invState.currentRound
    };
  }
};
