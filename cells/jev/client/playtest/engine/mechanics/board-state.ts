/**
 * Board State Mechanic
 *
 * Validates player movement on board games with defined states.
 * Players can only move to valid states defined in the board config.
 *
 * Hooks used:
 * - preValidateAction: Validate move target is a valid board state
 * - onExecuteAction: Handle move execution
 * - getAvailableActions: Expose move actions
 * - describeAction: Describe move action
 */

import {
  MechanicHooks,
  HookContext,
  ValidationResult,
  ActionExecutionContext,
  ActionExecutionResult,
  AvailableAction,
  ActionDescription,
  PlayerInitContext,
  PlayerInitResult,
  ActionSchema
} from './types';
import { GameAction, MoveAction, EdgeConfig, GameState, PlacedCard, BoardConfig, GameConfig } from '../types/game';
import { getCardsState } from './core/index';
import { getBoardConfigFromConfig } from './core/board';

/**
 * Get valid move targets from the player's current state
 */
function getValidMoveTargets(config: BoardConfig, currentState: string): string[] {
  const targets: string[] = [];

  for (const edge of config.edges) {
    const fromStates = Array.isArray(edge.from) ? edge.from : [edge.from];
    const toStates = Array.isArray(edge.to) ? edge.to : [edge.to];

    if (fromStates.includes(currentState)) {
      targets.push(...toStates);
    }
  }

  // Remove duplicates
  return [...new Set(targets)];
}

/**
 * Get all cards placed on a specific state.
 */
function getPlacedCardsOnState(state: GameState, targetState: string): PlacedCard[] {
  const placedCards = (state.shared.placedCards || []) as PlacedCard[];
  return placedCards.filter(pc => pc.state === targetState);
}

/**
 * Apply effects from placed cards when a player enters a state.
 * Returns the net probability modifier and any effects applied.
 */
function applyPlacedCardEffects(
  state: GameState,
  playerId: string,
  targetState: string
): { probabilityModifier: number; effectsApplied: string[] } {
  const placedCards = getPlacedCardsOnState(state, targetState);
  let probabilityModifier = 0;
  const effectsApplied: string[] = [];

  for (const pc of placedCards) {
    // Determine if this card affects this player
    let affectsPlayer = false;
    switch (pc.targetMode) {
      case 'owner':
        affectsPlayer = pc.placedBy === playerId;
        break;
      case 'opponents':
        affectsPlayer = pc.placedBy !== playerId;
        break;
      case 'all':
        affectsPlayer = true;
        break;
    }

    if (!affectsPlayer) continue;

    // Apply effect based on type
    switch (pc.effect.type) {
      case 'probability_boost':
        probabilityModifier += pc.effect.value ?? 0;
        effectsApplied.push(`${pc.cardName}: +${((pc.effect.value ?? 0) * 100).toFixed(0)}% probability (placed by ${pc.placedBy})`);
        break;

      case 'probability_penalty':
        probabilityModifier += pc.effect.value ?? 0;  // value should be negative
        effectsApplied.push(`${pc.cardName}: ${((pc.effect.value ?? 0) * 100).toFixed(0)}% probability (placed by ${pc.placedBy})`);
        break;

      case 'force_discard':
        // Force player to discard cards
        const discardCount = Math.abs(pc.effect.value ?? 1);
        const player = state.players[playerId];
        const playerHand = player.hand ?? [];
        const cardsState = getCardsState(state);
        for (let i = 0; i < discardCount && playerHand.length > 0; i++) {
          const discardedCard = playerHand.pop();
          if (discardedCard) {
            cardsState.discardPile.push(discardedCard);
            effectsApplied.push(`${pc.cardName}: Forced discard of ${discardedCard.name} (placed by ${pc.placedBy})`);
          }
        }
        break;

      default:
        // Add effect to player's effect list for other effect types
        const player2 = state.players[playerId];
        player2.effects.push({
          type: pc.effect.type,
          value: pc.effect.value,
          duration: pc.effect.duration ?? 1,
          source: pc.placedBy
        });
        effectsApplied.push(`${pc.cardName}: Applied ${pc.effect.type} effect (placed by ${pc.placedBy})`);
        break;
    }

    // Decrement triggers remaining if applicable
    if (pc.triggersRemaining !== undefined) {
      pc.triggersRemaining--;
    }
  }

  // Remove placed cards with no triggers remaining
  const allPlacedCards = (state.shared.placedCards || []) as PlacedCard[];
  state.shared.placedCards = allPlacedCards.filter(
    pc => pc.triggersRemaining === undefined || pc.triggersRemaining > 0
  );

  return { probabilityModifier, effectsApplied };
}

export const boardStateMechanic: MechanicHooks = {
  slug: 'board-state',
  name: 'Board State',
  requires: ['board'],

  getActionSchema(action: GameAction): ActionSchema | null {
    if (action.type !== 'move') return null;
    return {
      required: ['target'],
      fields: {
        target: { type: 'string' },
      },
    };
  },

  initPlayerState(ctx: PlayerInitContext): PlayerInitResult | null {
    const boardConfig = getBoardConfigFromConfig(ctx.config);
    if (!boardConfig) return null;
    return { state: boardConfig.start ?? 'start' };
  },

  preValidateAction(ctx: HookContext, action: GameAction): ValidationResult | null {
    // Only validate move actions
    if (action.type !== 'move') return null;

    // Only for board games (not grid games)
    const boardConfig = getBoardConfigFromConfig(ctx.config);
    if (!boardConfig) return null;
    if (ctx.config.engine_mechanics?.grid) return null; // Grid takes precedence

    const moveAction = action as MoveAction;
    const validStates = boardConfig.states || [];

    // Check target is a valid state name
    if (!validStates.includes(moveAction.target)) {
      return {
        valid: false,
        error: `Invalid move target "${moveAction.target}". Valid states: ${validStates.join(', ')}`
      };
    }

    // Check target is reachable from current state via edges
    if (boardConfig.edges && boardConfig.edges.length > 0) {
      const reachable = getValidMoveTargets(boardConfig, ctx.player.state);
      if (!reachable.includes(moveAction.target)) {
        return {
          valid: false,
          error: `Cannot move from "${ctx.player.state}" to "${moveAction.target}". Reachable states: ${reachable.join(', ')}`
        };
      }
    }

    return { valid: true };
  },

  onExecuteAction(ctx: ActionExecutionContext): ActionExecutionResult | null {
    const { action, player, playerId, state } = ctx;

    if (action.type !== 'move') return null;

    // Only for board games (not grid games)
    const boardConfig = getBoardConfigFromConfig(ctx.config);
    if (!boardConfig) return null;
    if (ctx.config.engine_mechanics?.grid) return null;

    const moveAction = action as MoveAction;

    // Apply effects from placed cards at the destination state
    const placedCardEffects = applyPlacedCardEffects(state, playerId, moveAction.target);

    // Update player's state
    player.state = moveAction.target;

    return {
      handled: true,
      stateChanges: {
        playerStateChanges: {
          [playerId]: {
            state: moveAction.target
          }
        }
      },
      advanceTurn: false, // Game.ts auto-advances if no multi-action mechanic
      checkWin: true, // Board games often check win after move
      logMessage: 'player_moved',
      logData: {
        target: moveAction.target,
        placedCardEffects: placedCardEffects.effectsApplied,
        probabilityModifier: placedCardEffects.probabilityModifier
      }
    };
  },

  getAvailableActions(ctx: HookContext): AvailableAction[] {
    // Only for board games (not grid games)
    const boardConfig = getBoardConfigFromConfig(ctx.config);
    if (!boardConfig) return [];
    if (ctx.config.engine_mechanics?.grid) return [];

    const currentState = ctx.player.state;

    // Get valid targets based on edges from current state
    let validTargets = getValidMoveTargets(boardConfig, currentState);

    // If no edges defined, allow move to any state except current
    if (validTargets.length === 0) {
      validTargets = boardConfig.states.filter(s => s !== currentState);
    }

    const examples = validTargets.slice(0, 2).map(target => ({
      type: 'move',
      target
    } as unknown as GameAction));

    return [{
      action: { type: 'move', target: validTargets[0] || '' } as unknown as GameAction,
      priority: 50,
      category: 'movement',
      enabled: validTargets.length > 0 ? undefined : false,
      reason: validTargets.length === 0 ? 'No valid move targets from current position' : undefined,
      description: 'Move to an adjacent state on the board',
      required: { target: 'The state to move to' },
      optional: { reasoning: 'Explanation of your move choice' },
      examples,
      targets: validTargets,
    }];
  },

  describeAction(action: GameAction): ActionDescription | null {
    if (action.type !== 'move') return null;

    const moveAction = action as MoveAction;
    return {
      type: 'move',
      label: 'Move',
      description: `Move to a different location on the board.${moveAction.target ? ` Target: ${moveAction.target}` : ''}`,
      examples: ['move target:"Forest"', 'move target:"Castle"']
    };
  }
};
