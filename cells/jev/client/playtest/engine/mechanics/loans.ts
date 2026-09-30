/**
 * Loans Mechanic
 *
 * Players can take loans (gain resources now, pay back later with interest).
 * Loans can have repayment deadlines and VP penalties for unpaid loans at game end.
 *
 * Config (engine_mechanics.loans):
 * ```yaml
 * engine_mechanics:
 *   loans:
 *     loan_amount: 10
 *     interest_rate: 0.5
 *     resource: gold
 *     max_loans: 3
 *     repayment_deadline: 5  # turns to repay (0 = end of game)
 *     penalty: 3             # VP penalty per unpaid loan at game end
 * ```
 *
 * Hooks used:
 * - initPlayerState: Initialize active_loans array
 * - getAvailableActions: 'take_loan' and 'repay_loan' actions
 * - preValidateAction: Validate loan actions
 * - onExecuteAction: Handle take_loan and repay_loan
 * - onTurnStart: Check for loan deadlines, apply penalties
 * - getPlayerView: Show player loans
 * - describeAction: Describe loan actions
 */

import {
  MechanicHooks,
  HookContext,
  ValidationResult,
  ActionExecutionContext,
  ActionExecutionResult,
  AvailableAction,
  ActionDescription,
  TurnStartContext,
  StateChanges,
  PlayerInitContext,
  PlayerInitResult
} from './types';
import { GameAction, GameConfig, LoanInstance } from '../types/game';
import { addResource, getResource } from './core/resources';

interface LoanConfig {
  max_loans?: number;
  loan_amount: number;
  interest_rate: number;
  resource: string;
  repayment_deadline?: number;
  penalty?: number;
}

function getConfig(config: GameConfig): LoanConfig | undefined {
  return config.engine_mechanics?.loans as LoanConfig | undefined;
}

export const loansMechanic: MechanicHooks = {
  slug: 'loans',
  name: 'Loans',
  requires: ['resources'],

  configSchema: {
    type: 'object',
    description: 'Loan/debt system with interest and repayment',
    properties: {
      max_loans: {
        type: 'number',
        description: 'Maximum simultaneous loans',
        default: 3
      },
      loan_amount: {
        type: 'number',
        description: 'Amount of resource gained per loan'
      },
      interest_rate: {
        type: 'number',
        description: 'Interest rate (e.g. 0.5 = 50% interest)'
      },
      resource: {
        type: 'string',
        description: 'Resource used for loans'
      },
      repayment_deadline: {
        type: 'number',
        description: 'Turns to repay (0 = end of game)',
        default: 0
      },
      penalty: {
        type: 'number',
        description: 'VP penalty per unpaid loan at game end',
        default: 0
      }
    },
    required: ['loan_amount', 'interest_rate', 'resource']
  },

  initPlayerState(ctx: PlayerInitContext): PlayerInitResult | null {
    const config = getConfig(ctx.config);
    if (!config) return null;

    return {
      active_loans: []
    };
  },

  preValidateAction(ctx: HookContext, action: GameAction): ValidationResult | null {
    if (action.type !== 'take_loan' && action.type !== 'repay_loan') return null;

    const config = getConfig(ctx.config);
    if (!config) return { valid: false, error: 'Loans not enabled.' };

    const playerLoans = (ctx.player.active_loans as LoanInstance[]) || [];

    if (action.type === 'take_loan') {
      const maxLoans = config.max_loans ?? 3;
      if (playerLoans.length >= maxLoans) {
        return { valid: false, error: `Already at maximum loans (${maxLoans}).` };
      }
    }

    if (action.type === 'repay_loan') {
      const loanAction = action as unknown as { type: string; loan_index: number };
      const loanIndex = loanAction.loan_index ?? 0;

      if (loanIndex < 0 || loanIndex >= playerLoans.length) {
        return { valid: false, error: `Invalid loan index: ${loanIndex}. You have ${playerLoans.length} loans.` };
      }

      const loan = playerLoans[loanIndex];
      const playerAmount = getResource(ctx.state, ctx.playerId, config.resource);
      if (playerAmount < loan.repayment) {
        return {
          valid: false,
          error: `Not enough ${config.resource} to repay loan. Need ${loan.repayment}, have ${playerAmount}.`
        };
      }
    }

    return { valid: true };
  },

  onExecuteAction(ctx: ActionExecutionContext): ActionExecutionResult | null {
    if (ctx.action.type !== 'take_loan' && ctx.action.type !== 'repay_loan') return null;

    const config = getConfig(ctx.config);
    if (!config) return null;

    if (ctx.action.type === 'take_loan') {
      const repayment = Math.ceil(config.loan_amount * (1 + config.interest_rate));
      const currentTurn = ctx.state.turnNumber ?? 0;
      const deadlineTurn = config.repayment_deadline
        ? currentTurn + config.repayment_deadline
        : 0;

      // Add resources to the player
      addResource(ctx.state, ctx.playerId, config.resource, config.loan_amount);

      // Create loan instance
      const newLoan: LoanInstance = {
        amount: config.loan_amount,
        repayment,
        taken_on_turn: currentTurn,
        deadline_turn: deadlineTurn || undefined
      };

      const playerLoans = [...((ctx.state.players[ctx.playerId]?.active_loans as LoanInstance[]) || [])];
      playerLoans.push(newLoan);

      return {
        handled: true,
        stateChanges: {
          playerStateChanges: {
            [ctx.playerId]: { active_loans: playerLoans }
          }
        },
        advanceTurn: false,
        checkWin: false,
        logMessage: `${ctx.playerId} took a loan of ${config.loan_amount} ${config.resource} (repay ${repayment}).`
      };
    }

    if (ctx.action.type === 'repay_loan') {
      const loanAction = ctx.action as unknown as { type: string; loan_index: number };
      const loanIndex = loanAction.loan_index ?? 0;
      const playerLoans = [...((ctx.state.players[ctx.playerId]?.active_loans as LoanInstance[]) || [])];

      if (loanIndex < 0 || loanIndex >= playerLoans.length) return null;

      const loan = playerLoans[loanIndex];

      // Spend the repayment amount (resource operations already fire hooks)
      const currentAmount = getResource(ctx.state, ctx.playerId, config.resource);
      if (currentAmount < loan.repayment) return null;

      // Directly mutate resources since we need to spend
      const player = ctx.state.players[ctx.playerId];
      if (player?.resources) {
        player.resources[config.resource] = (player.resources[config.resource] ?? 0) - loan.repayment;
      }

      // Remove the loan
      playerLoans.splice(loanIndex, 1);

      return {
        handled: true,
        stateChanges: {
          playerStateChanges: {
            [ctx.playerId]: { active_loans: playerLoans }
          }
        },
        advanceTurn: false,
        checkWin: false,
        logMessage: `${ctx.playerId} repaid a loan of ${loan.repayment} ${config.resource}.`
      };
    }

    return null;
  },

  onTurnStart(ctx: TurnStartContext): StateChanges | null {
    const config = getConfig(ctx.config);
    if (!config) return null;

    const playerLoans = (ctx.player.active_loans as LoanInstance[]) || [];
    if (playerLoans.length === 0) return null;

    const currentTurn = ctx.state.turnNumber ?? 0;
    const penalty = config.penalty ?? 0;

    // Check for overdue loans
    let scoreDeduction = 0;
    const remainingLoans: LoanInstance[] = [];

    for (const loan of playerLoans) {
      if (loan.deadline_turn && loan.deadline_turn > 0 && currentTurn > loan.deadline_turn) {
        // Loan is overdue - apply penalty
        if (penalty > 0) {
          scoreDeduction += penalty;
        }
        // Keep the loan (it doesn't disappear, just accrues penalty each turn)
        remainingLoans.push(loan);
      } else {
        remainingLoans.push(loan);
      }
    }

    if (scoreDeduction > 0) {
      const currentScore = ctx.player.score ?? 0;
      return {
        playerStateChanges: {
          [ctx.playerId]: {
            score: currentScore - scoreDeduction,
            active_loans: remainingLoans
          }
        }
      };
    }

    return null;
  },

  getAvailableActions(ctx: HookContext): AvailableAction[] {
    const config = getConfig(ctx.config);
    if (!config) return [];

    const actions: AvailableAction[] = [];
    const playerLoans = (ctx.player.active_loans as LoanInstance[]) || [];
    const maxLoans = config.max_loans ?? 3;

    // Take loan action
    if (playerLoans.length < maxLoans) {
      actions.push({
        action: {
          type: 'take_loan'
        } as unknown as GameAction,
        priority: 40,
        category: 'loans'
      });
    }

    // Repay loan actions
    for (let i = 0; i < playerLoans.length; i++) {
      const loan = playerLoans[i];
      const playerAmount = getResource(ctx.state, ctx.playerId, config.resource);

      if (playerAmount >= loan.repayment) {
        actions.push({
          action: {
            type: 'repay_loan',
            loan_index: i
          } as unknown as GameAction,
          priority: 50,
          category: 'loans'
        });
      }
    }

    return actions;
  },

  getPlayerView(ctx: HookContext): Record<string, unknown> | null {
    const config = getConfig(ctx.config);
    if (!config) return null;

    const playerLoans = (ctx.player.active_loans as LoanInstance[]) || [];

    return {
      loans: playerLoans,
      loanTerms: {
        amount: config.loan_amount,
        interest_rate: config.interest_rate,
        repayment: Math.ceil(config.loan_amount * (1 + config.interest_rate)),
        resource: config.resource,
        deadline: config.repayment_deadline ?? 0,
        penalty: config.penalty ?? 0
      }
    };
  },

  describeAction(action: GameAction): { type: string; label: string; description: string; examples?: string[] } | null {
    if (action.type === 'take_loan') {
      return {
        type: 'take_loan',
        label: 'Take Loan',
        description: 'Take a loan to gain resources now, must repay later with interest.',
        examples: ['take_loan']
      };
    }
    if (action.type === 'repay_loan') {
      return {
        type: 'repay_loan',
        label: 'Repay Loan',
        description: 'Repay an active loan (principal + interest).',
        examples: ['repay_loan loan_index:0']
      };
    }
    return null;
  }
};
