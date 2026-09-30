/**
 * Targeted Clues Mechanic
 *
 * Players give clues to specific other players about hidden information.
 *
 * Config:
 *   targeted_clues:
 *     clue_types: string[]
 *     clues_per_turn: number
 *     clue_cost?: Record<string, number>
 *     must_be_truthful: boolean
 */

import { MechanicHooks, HookContext, ValidationResult, ActionExecutionContext, ActionExecutionResult, AvailableAction, StateChanges } from './types';
import { GameAction, GiveClueAction, TargetedCluesConfig } from '../types/game';

interface ClueRecord {
  fromPlayer: string;
  toPlayer: string;
  clueType: string;
  clueValue: string | number;
  affectedItems: string[];
  turn: number;
}

export const targetedCluesMechanic: MechanicHooks = {
  slug: 'targeted-clues',
  name: 'Targeted Clues',

  configSchema: {
    type: 'object',
    description: 'Give targeted clues about hidden information',
    properties: {
      clue_types: {
        type: 'array',
        description: 'Types of clues that can be given',
        items: { type: 'string' },
        required: true
      },
      clues_per_turn: {
        type: 'number',
        description: 'Maximum clues a player can give per turn',
        default: 1
      },
      clue_cost: {
        type: 'object',
        description: 'Resource cost to give a clue'
      },
      must_be_truthful: {
        type: 'boolean',
        description: 'Whether clues must accurately reflect the target cards',
        default: true
      }
    },
    required: ['clue_types']
  },

  preValidateAction(ctx: HookContext, action: GameAction): ValidationResult | null {
    if (action.type !== 'give_clue') return null;

    const config = ctx.config.engine_mechanics?.targeted_clues;
    if (!config) {
      return { valid: false, error: 'Targeted clues are not enabled.' };
    }

    const clueAction = action as GiveClueAction;

    if (!config.clue_types.includes(clueAction.clueType)) {
      return { valid: false, error: `Invalid clue type: ${clueAction.clueType}` };
    }

    if (!ctx.state.players[clueAction.targetPlayer]) {
      return { valid: false, error: 'Target player does not exist.' };
    }

    if (clueAction.targetPlayer === ctx.playerId) {
      return { valid: false, error: 'Cannot give a clue to yourself.' };
    }

    const cluesThisTurn = (ctx.state.shared.cluesThisTurn as Record<string, number>) ?? {};
    const maxClues = config.clues_per_turn ?? 1;
    if ((cluesThisTurn[ctx.playerId] ?? 0) >= maxClues) {
      return { valid: false, error: `You have already given ${maxClues} clue(s) this turn.` };
    }

    if (config.clue_cost) {
      for (const [resource, amount] of Object.entries(config.clue_cost)) {
        if ((ctx.player.resources?.[resource] ?? 0) < amount) {
          return { valid: false, error: `Not enough ${resource} to give a clue.` };
        }
      }
    }

    return { valid: true };
  },

  onExecuteAction(ctx: ActionExecutionContext): ActionExecutionResult | null {
    const { action, state, playerId } = ctx;
    if (action.type !== 'give_clue') return null;

    const config = ctx.config.engine_mechanics?.targeted_clues;
    if (!config) return null;

    const clueAction = action as GiveClueAction;

    const clueHistory = (state.shared.clueHistory as ClueRecord[]) ?? [];
    const clueRecord: ClueRecord = {
      fromPlayer: playerId,
      toPlayer: clueAction.targetPlayer,
      clueType: clueAction.clueType,
      clueValue: clueAction.clueValue,
      affectedItems: clueAction.affectedItems ?? [],
      turn: state.turnNumber
    };

    const cluesThisTurn = { ...(state.shared.cluesThisTurn as Record<string, number>) ?? {} };
    cluesThisTurn[playerId] = (cluesThisTurn[playerId] ?? 0) + 1;

    const stateChanges: StateChanges = {
      sharedStateChanges: {
        clueHistory: [...clueHistory, clueRecord],
        cluesThisTurn,
        lastClue: clueRecord
      }
    };

    if (config.clue_cost) {
      const newResources = { ...state.players[playerId].resources };
      for (const [resource, amount] of Object.entries(config.clue_cost)) {
        newResources[resource] = (newResources[resource] ?? 0) - amount;
      }
      stateChanges.playerStateChanges = {
        [playerId]: { resources: newResources }
      };
    }

    const itemCount = clueAction.affectedItems?.length ?? 0;
    const itemsMsg = itemCount > 0 ? ` (${itemCount} cards)` : '';

    return {
      handled: true,
      stateChanges,
      advanceTurn: true,
      checkWin: false,
      logMessage: `${playerId} gave ${clueAction.targetPlayer} a ${clueAction.clueType} clue: "${clueAction.clueValue}"${itemsMsg}`
    };
  },

  onTurnStart(): StateChanges | null {
    return {
      sharedStateChanges: {
        cluesThisTurn: {}
      }
    };
  },

  getAvailableActions(ctx: HookContext): AvailableAction[] {
    const config = ctx.config.engine_mechanics?.targeted_clues;
    if (!config) return [];

    const cluesThisTurn = (ctx.state.shared.cluesThisTurn as Record<string, number>) ?? {};
    const maxClues = config.clues_per_turn ?? 1;
    if ((cluesThisTurn[ctx.playerId] ?? 0) >= maxClues) return [];

    if (config.clue_cost) {
      for (const [resource, amount] of Object.entries(config.clue_cost)) {
        if ((ctx.player.resources?.[resource] ?? 0) < amount) {
          return [];
        }
      }
    }

    const actions: AvailableAction[] = [];
    for (const clueType of config.clue_types) {
      actions.push({
        action: {
          type: 'give_clue',
          targetPlayer: '',
          clueType,
          clueValue: ''
        } as GiveClueAction,
        priority: 80,
        category: 'clue'
      });
    }

    return actions;
  }
};
