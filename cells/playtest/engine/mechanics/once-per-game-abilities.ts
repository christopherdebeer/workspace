/**
 * Once Per Game Abilities Mechanic
 *
 * Provides special abilities that each player can use only once per game.
 * Common in many modern board games for comeback mechanics or special moments.
 *
 * Hooks used:
 * - initPlayerState: Initialize available abilities
 * - preValidateAction: Validate ability use
 * - onExecuteAction: Execute ability and mark as used
 * - getAvailableActions: Expose unused abilities
 * - describeAction: Describe abilities
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
  PlayerInitResult
} from './types';
import { GameAction, Card, UseAbilityAction } from '../types/game';
import { addToHand } from './core/hand';
import { drawFromDeck } from './core/card-piles';
import { addResource, spendResource } from './core/resources';

interface AbilityDefinition {
  /** Unique ability identifier */
  id: string;
  /** Display name */
  name: string;
  /** Description of what it does */
  description: string;
  /** Effect when activated */
  effect: AbilityEffect;
  /** Condition to use (optional) */
  condition?: AbilityCondition;
}

interface AbilityEffect {
  /** Effect type */
  type: 'draw' | 'resource' | 'extra_action' | 'skip_turn' | 'reroll' | 'teleport' | 'score' | 'custom';
  /** For draw: number of cards */
  count?: number;
  /** For resource: resource name and amount */
  resource?: string;
  amount?: number;
  /** For teleport: target state */
  target?: string;
  /** For custom: effect identifier */
  custom_id?: string;
}

interface AbilityCondition {
  /** Condition type */
  type: 'min_score' | 'max_hand' | 'state' | 'round' | 'losing';
  /** Threshold value */
  value?: number | string;
}

interface OncePerGameConfig {
  /** Available abilities */
  abilities: AbilityDefinition[];
  /** How abilities are assigned: 'all' (everyone gets all), 'choose' (pick one), 'random' */
  assignment?: 'all' | 'choose' | 'random';
  /** Number of abilities per player (for 'choose' or 'random') */
  abilities_per_player?: number;
}

function checkCondition(
  ctx: HookContext,
  condition: AbilityCondition | undefined
): { met: boolean; reason?: string } {
  if (!condition) return { met: true };

  switch (condition.type) {
    case 'min_score':
      const minScore = condition.value as number;
      if ((ctx.player.score ?? 0) < minScore) {
        return { met: false, reason: `Need at least ${minScore} score` };
      }
      break;

    case 'max_hand':
      const maxHand = condition.value as number;
      if ((ctx.player.hand ?? []).length > maxHand) {
        return { met: false, reason: `Hand must have ${maxHand} or fewer cards` };
      }
      break;

    case 'state':
      const requiredState = condition.value as string;
      if (ctx.player.state !== requiredState) {
        return { met: false, reason: `Must be in ${requiredState}` };
      }
      break;

    case 'round':
      const minRound = condition.value as number;
      if (ctx.state.round < minRound) {
        return { met: false, reason: `Can only use after round ${minRound}` };
      }
      break;

    case 'losing':
      // Check if player is behind
      const scores = Object.values(ctx.state.players).map(p => p.score ?? 0);
      const maxScore = Math.max(...scores);
      if ((ctx.player.score ?? 0) >= maxScore) {
        return { met: false, reason: 'Can only use when losing' };
      }
      break;
  }

  return { met: true };
}

export const oncePerGameAbilitiesMechanic: MechanicHooks = {
  slug: 'once-per-game-abilities',
  name: 'Once Per Game Abilities',
  requires: ['resources'],

  configSchema: {
    type: 'object',
    description: 'Special abilities usable once per game',
    properties: {
      abilities: {
        type: 'array',
        description: 'Available abilities',
        required: true
      },
      assignment: {
        type: 'string',
        description: 'How abilities are assigned',
        enum: ['all', 'choose', 'random'],
        default: 'all'
      },
      abilities_per_player: {
        type: 'number',
        description: 'Abilities per player (for choose/random)',
        default: 1
      }
    },
    required: ['abilities']
  },

  initPlayerState(ctx: PlayerInitContext): PlayerInitResult | null {
    const opgConfig = ctx.config.engine_mechanics?.once_per_game_abilities as OncePerGameConfig | undefined;
    if (!opgConfig?.abilities) return null;

    const assignment = opgConfig.assignment ?? 'all';
    let assignedAbilities: string[];

    if (assignment === 'all') {
      assignedAbilities = opgConfig.abilities.map(a => a.id);
    } else if (assignment === 'random') {
      const count = opgConfig.abilities_per_player ?? 1;
      const shuffled = [...opgConfig.abilities].sort(() => Math.random() - 0.5);
      assignedAbilities = shuffled.slice(0, count).map(a => a.id);
    } else {
      // 'choose' - for now, assign first N (actual choosing would need UI)
      const count = opgConfig.abilities_per_player ?? 1;
      assignedAbilities = opgConfig.abilities.slice(0, count).map(a => a.id);
    }

    return {
      availableAbilities: assignedAbilities,
      usedAbilities: [] as string[]
    };
  },

  preValidateAction(ctx: HookContext, action: GameAction): ValidationResult | null {
    if (action.type !== 'use_ability') return null;

    const opgConfig = ctx.config.engine_mechanics?.once_per_game_abilities as OncePerGameConfig | undefined;
    if (!opgConfig?.abilities) {
      return { valid: false, error: 'Once per game abilities not enabled.' };
    }

    const abilityAction = action as UseAbilityAction;
    const availableAbilities = (ctx.player.availableAbilities as string[]) || [];
    const usedAbilities = (ctx.player.usedAbilities as string[]) || [];

    // Check if player has this ability
    if (!availableAbilities.includes(abilityAction.ability)) {
      return { valid: false, error: `You don't have the ability "${abilityAction.ability}".` };
    }

    // Check if already used
    if (usedAbilities.includes(abilityAction.ability)) {
      return { valid: false, error: `You have already used "${abilityAction.ability}" this game.` };
    }

    // Find ability definition
    const abilityDef = opgConfig.abilities.find(a => a.id === abilityAction.ability);
    if (!abilityDef) {
      return { valid: false, error: `Unknown ability "${abilityAction.ability}".` };
    }

    // Check condition
    const conditionResult = checkCondition(ctx, abilityDef.condition);
    if (!conditionResult.met) {
      return { valid: false, error: conditionResult.reason || 'Condition not met.' };
    }

    return { valid: true };
  },

  onExecuteAction(ctx: ActionExecutionContext): ActionExecutionResult | null {
    const { action, playerId, state, player } = ctx;

    if (action.type !== 'use_ability') return null;

    const opgConfig = ctx.config.engine_mechanics?.once_per_game_abilities as OncePerGameConfig | undefined;
    if (!opgConfig?.abilities) return null;

    const abilityAction = action as UseAbilityAction;
    const abilityDef = opgConfig.abilities.find(a => a.id === abilityAction.ability);
    if (!abilityDef) return null;

    // Mark as used
    const usedAbilities = [...((player.usedAbilities as string[]) || []), abilityAction.ability];

    const stateChanges: { playerStateChanges: Record<string, Partial<typeof player>> } = {
      playerStateChanges: {
        [playerId]: {
          usedAbilities
        }
      }
    };

    // Apply effect
    const effect = abilityDef.effect;
    let logData: Record<string, unknown> = {
      ability: abilityDef.name,
      effect: effect.type
    };

    switch (effect.type) {
      case 'draw':
        const count = effect.count ?? 1;
        const { cards } = drawFromDeck(state, count, playerId);
        if (cards.length > 0) {
          addToHand(state, playerId, cards);
        }
        logData.drawnCards = cards.length;
        break;

      case 'resource':
        if (effect.resource && effect.amount) {
          addResource(state, playerId, effect.resource, effect.amount);
        }
        logData.resource = effect.resource;
        logData.amount = effect.amount;
        break;

      case 'score':
        const scoreBonus = effect.amount ?? 0;
        stateChanges.playerStateChanges[playerId].score = (player.score ?? 0) + scoreBonus;
        logData.scoreBonus = scoreBonus;
        break;

      case 'teleport':
        if (effect.target) {
          stateChanges.playerStateChanges[playerId].state = effect.target;
          logData.destination = effect.target;
        }
        break;

      case 'extra_action':
        stateChanges.playerStateChanges[playerId].extraActions =
          ((player.extraActions as number) || 0) + (effect.count ?? 1);
        logData.extraActions = effect.count ?? 1;
        break;

      case 'skip_turn':
        // Apply skip effect to target or next player
        const targetId = abilityAction.target || state.turnOrder[
          (state.turnOrder.indexOf(playerId) + 1) % state.turnOrder.length
        ];
        const targetEffects = [...(state.players[targetId]?.effects || [])];
        targetEffects.push({
          type: 'skip_turn',
          duration: effect.count ?? 1,
          source: `ability:${abilityDef.id}`
        });
        stateChanges.playerStateChanges[targetId] = {
          ...stateChanges.playerStateChanges[targetId],
          effects: targetEffects
        };
        logData.target = targetId;
        break;

      case 'reroll':
        // Store that player can reroll
        stateChanges.playerStateChanges[playerId].canReroll = true;
        break;
    }

    return {
      handled: true,
      stateChanges,
      advanceTurn: false, // Ability use doesn't end turn
      checkWin: effect.type === 'score',
      logMessage: 'ability_used',
      logData
    };
  },

  getAvailableActions(ctx: HookContext): AvailableAction[] {
    const opgConfig = ctx.config.engine_mechanics?.once_per_game_abilities as OncePerGameConfig | undefined;
    if (!opgConfig?.abilities) return [];

    const availableAbilities = (ctx.player.availableAbilities as string[]) || [];
    const usedAbilities = (ctx.player.usedAbilities as string[]) || [];
    const actions: AvailableAction[] = [];

    for (const abilityId of availableAbilities) {
      if (usedAbilities.includes(abilityId)) continue;

      const abilityDef = opgConfig.abilities.find(a => a.id === abilityId);
      if (!abilityDef) continue;

      // Check condition
      const conditionResult = checkCondition(ctx, abilityDef.condition);
      if (!conditionResult.met) continue;

      actions.push({
        action: { type: 'use_ability', ability: abilityId } as unknown as GameAction,
        priority: 80, // High priority - special ability
        category: 'once-per-game'
      });
    }

    return actions;
  },

  describeAction(action: GameAction): ActionDescription | null {
    if (action.type !== 'use_ability') return null;

    return {
      type: 'use_ability',
      label: 'Use Special Ability',
      description: 'Activate a once-per-game special ability.',
      examples: ['use_ability ability:"emergency_draw"']
    };
  }
};
