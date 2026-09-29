/**
 * Deduction Mechanic
 *
 * Players gather clues and deduce hidden information through elimination.
 *
 * Config:
 *   deduction:
 *     hidden_info_types: string[]    # Types of hidden info
 *     clue_action_cost?: Record<string, number>
 *     max_guesses?: number
 */

import { MechanicHooks, HookContext, ValidationResult, ActionExecutionContext, ActionExecutionResult, AvailableAction, PlayerInitContext, PlayerInitResult, VisibilityContext, StateChanges } from './types';
import { GameAction, InvestigateAction, AccuseAction, DeductionConfig, DeductionNotes } from '../types/game';

export const deductionMechanic: MechanicHooks = {
  slug: 'deduction',
  name: 'Deduction',
  requires: ['visibility'],

  configSchema: {
    type: 'object',
    description: 'Clue-gathering and deduction mechanics',
    properties: {
      hidden_info_types: {
        type: 'array',
        description: 'Types of hidden information to deduce',
        items: { type: 'string' },
        required: true
      },
      clue_action_cost: {
        type: 'object',
        description: 'Resource cost to investigate'
      },
      max_guesses: {
        type: 'number',
        description: 'Maximum wrong accusations before elimination',
        default: 1
      }
    },
    required: ['hidden_info_types']
  },

  initPlayerState(ctx: PlayerInitContext): PlayerInitResult | null {
    const config = ctx.config.engine_mechanics?.deduction;
    if (!config) return null;

    const notes: DeductionNotes = {
      known: {},
      eliminated: {},
      suspicions: {},
      wrongGuesses: 0
    };

    for (const infoType of config.hidden_info_types) {
      notes.known[infoType] = [];
      notes.eliminated[infoType] = [];
      notes.suspicions[infoType] = [];
    }

    return { deductionNotes: notes };
  },

  preValidateAction(ctx: HookContext, action: GameAction): ValidationResult | null {
    if (action.type !== 'investigate' && action.type !== 'accuse') return null;

    const config = ctx.config.engine_mechanics?.deduction;
    if (!config) {
      return { valid: false, error: 'Deduction is not enabled.' };
    }

    if (action.type === 'investigate') {
      const investAction = action as InvestigateAction;

      if (!config.hidden_info_types.includes(investAction.infoType)) {
        return { valid: false, error: `Invalid information type: ${investAction.infoType}` };
      }

      if (!ctx.state.players[investAction.target]) {
        return { valid: false, error: 'Target player does not exist.' };
      }

      if (config.clue_action_cost) {
        for (const [resource, amount] of Object.entries(config.clue_action_cost)) {
          if ((ctx.player.resources?.[resource] ?? 0) < amount) {
            return { valid: false, error: `Not enough ${resource} to investigate.` };
          }
        }
      }
    }

    if (action.type === 'accuse') {
      const accuseAction = action as AccuseAction;

      for (const infoType of config.hidden_info_types) {
        if (!accuseAction.accusation[infoType]) {
          return { valid: false, error: `Accusation must include ${infoType}.` };
        }
      }

      const notes = ctx.player.deductionNotes;
      const maxGuesses = config.max_guesses ?? 1;
      if (notes && notes.wrongGuesses >= maxGuesses) {
        return { valid: false, error: 'You have no more accusation attempts.' };
      }
    }

    return { valid: true };
  },

  onExecuteAction(ctx: ActionExecutionContext): ActionExecutionResult | null {
    const { action, state, playerId } = ctx;
    const config = ctx.config.engine_mechanics?.deduction;
    if (!config) return null;

    if (action.type === 'investigate') {
      const investAction = action as InvestigateAction;
      const stateChanges: StateChanges = {};

      if (config.clue_action_cost) {
        const newResources = { ...state.players[playerId].resources };
        for (const [resource, amount] of Object.entries(config.clue_action_cost)) {
          newResources[resource] = (newResources[resource] ?? 0) - amount;
        }
        stateChanges.playerStateChanges = {
          [playerId]: { resources: newResources }
        };
      }

      const targetPlayer = state.players[investAction.target];
      const targetHand = targetPlayer.hand ?? [];
      const hasItem = investAction.specificItem
        ? targetHand.some(c => c.id === investAction.specificItem || c.type === investAction.specificItem)
        : targetHand.length > 0;

      stateChanges.sharedStateChanges = {
        lastInvestigation: {
          investigator: playerId,
          target: investAction.target,
          infoType: investAction.infoType,
          item: investAction.specificItem,
          result: hasItem ? 'has_item' : 'no_item'
        }
      };

      return {
        handled: true,
        stateChanges,
        advanceTurn: true,
        checkWin: false,
        logMessage: `${playerId} investigated ${investAction.target} about ${investAction.infoType}`
      };
    }

    if (action.type === 'accuse') {
      const accuseAction = action as AccuseAction;

      const solution = state.shared.deductionSolution as Record<string, string> | undefined;
      if (!solution) {
        return {
          handled: true,
          stateChanges: {},
          advanceTurn: true,
          checkWin: false,
          logMessage: 'No solution set - accusation ignored'
        };
      }

      const isCorrect = config.hidden_info_types.every(
        infoType => accuseAction.accusation[infoType] === solution[infoType]
      );

      if (isCorrect) {
        return {
          handled: true,
          stateChanges: {
            sharedStateChanges: {
              deductionWinner: playerId,
              deductionSolved: true
            }
          },
          advanceTurn: false,
          checkWin: true,
          logMessage: `${playerId} made a correct accusation and wins!`
        };
      } else {
        const notes = state.players[playerId].deductionNotes;
        const newNotes: DeductionNotes = notes
          ? { ...notes, wrongGuesses: notes.wrongGuesses + 1 }
          : { known: {}, eliminated: {}, suspicions: {}, wrongGuesses: 1 };
        const maxGuesses = config.max_guesses ?? 1;

        const stateChanges: StateChanges = {
          playerStateChanges: {
            [playerId]: { deductionNotes: newNotes }
          }
        };

        if (newNotes.wrongGuesses >= maxGuesses) {
          stateChanges.playerStateChanges![playerId].state = 'eliminated';
        }

        return {
          handled: true,
          stateChanges,
          advanceTurn: true,
          checkWin: true,
          logMessage: `${playerId} made a wrong accusation (${newNotes.wrongGuesses}/${maxGuesses} attempts used)`
        };
      }
    }

    return null;
  },

  getAvailableActions(ctx: HookContext): AvailableAction[] {
    const config = ctx.config.engine_mechanics?.deduction;
    if (!config) return [];

    const actions: AvailableAction[] = [];

    let canAfford = true;
    if (config.clue_action_cost) {
      for (const [resource, amount] of Object.entries(config.clue_action_cost)) {
        if ((ctx.player.resources?.[resource] ?? 0) < amount) {
          canAfford = false;
          break;
        }
      }
    }

    if (canAfford) {
      for (const infoType of config.hidden_info_types) {
        actions.push({
          action: {
            type: 'investigate',
            target: '',
            infoType
          } as InvestigateAction,
          priority: 70,
          category: 'deduction'
        });
      }
    }

    const notes = ctx.player.deductionNotes;
    const maxGuesses = config.max_guesses ?? 1;
    if (!notes || notes.wrongGuesses < maxGuesses) {
      actions.push({
        action: {
          type: 'accuse',
          accusation: {}
        } as AccuseAction,
        priority: 50,
        category: 'deduction'
      });
    }

    return actions;
  },

  canSeeInfo(ctx: VisibilityContext, infoType: string, targetPlayerId?: string): boolean | undefined {
    const config = ctx.config.engine_mechanics?.deduction;
    if (!config) return undefined;

    if (!config.hidden_info_types.includes(infoType)) return undefined;

    if (infoType === 'solution') return false;

    if (targetPlayerId && targetPlayerId !== ctx.viewerPlayerId) {
      return false;
    }

    return undefined;
  }
};
