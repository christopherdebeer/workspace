/**
 * Chaining Mechanic
 *
 * Allows certain actions to trigger follow-up actions or effects.
 * Common in combo-based card games and engine-building games.
 *
 * Examples:
 * - Playing a card triggers drawing another card
 * - Moving to a location triggers an effect
 * - Collecting a set triggers bonus actions
 *
 * Hooks used:
 * - postExecuteAction: Check for and apply chain effects
 */

import {
  MechanicHooks,
  HookContext,
  StateChanges
} from './types';
import { GameAction, Card } from '../types/game';
import { addToHand } from './core/hand';
import { drawFromDeck } from './core/card-piles';
import { addResource } from './core/resources';

interface ChainTrigger {
  /** Trigger type */
  type: 'action' | 'card_type' | 'card_name' | 'state_enter' | 'state_leave' | 'resource_threshold';
  /** For action: action type that triggers */
  action_type?: string;
  /** For card_type/card_name: matching value */
  match?: string;
  /** For state: state name */
  state?: string;
  /** For resource_threshold: resource and threshold */
  resource?: string;
  threshold?: number;
  comparison?: '>=' | '>' | '<=' | '<' | '==';
}

interface ChainEffect {
  /** Effect type */
  type: 'draw' | 'resource' | 'extra_action' | 'score' | 'effect' | 'move';
  /** Count/amount */
  count?: number;
  amount?: number;
  /** Resource name */
  resource?: string;
  /** Effect to apply */
  effect?: {
    type: string;
    duration?: number;
    value?: number;
  };
  /** For move: target state */
  target?: string;
}

interface ChainRule {
  /** Rule identifier */
  id: string;
  /** Rule name for logging */
  name: string;
  /** What triggers this chain */
  trigger: ChainTrigger;
  /** Effect when triggered */
  effect: ChainEffect;
  /** Maximum times this can trigger per turn */
  max_per_turn?: number;
  /** Maximum times this can trigger per game */
  max_per_game?: number;
  /** Condition for trigger */
  condition?: {
    type: 'has_card' | 'has_resource' | 'in_state' | 'hand_size';
    match?: string;
    value?: number | string;
    comparison?: '>=' | '>' | '<=' | '<' | '==';
  };
}

interface ChainingConfig {
  /** Chain rules */
  rules: ChainRule[];
  /** Maximum chain depth per action */
  max_chain_depth?: number;
}

function checkCondition(
  ctx: HookContext,
  condition: ChainRule['condition']
): boolean {
  if (!condition) return true;

  switch (condition.type) {
    case 'has_card':
      return (ctx.player.hand ?? []).some(c =>
        c.name === condition.match || c.type === condition.match
      );

    case 'has_resource':
      const resources = ctx.player.resources || {};
      const amount = resources[condition.match!] || 0;
      const threshold = condition.value as number;
      const comp = condition.comparison || '>=';
      switch (comp) {
        case '>=': return amount >= threshold;
        case '>': return amount > threshold;
        case '<=': return amount <= threshold;
        case '<': return amount < threshold;
        case '==': return amount === threshold;
      }
      break;

    case 'in_state':
      return ctx.player.state === condition.value;

    case 'hand_size':
      const handSize = (ctx.player.hand ?? []).length;
      const targetSize = condition.value as number;
      const handComp = condition.comparison || '>=';
      switch (handComp) {
        case '>=': return handSize >= targetSize;
        case '>': return handSize > targetSize;
        case '<=': return handSize <= targetSize;
        case '<': return handSize < targetSize;
        case '==': return handSize === targetSize;
      }
      break;
  }

  return true;
}

function checkTrigger(
  trigger: ChainTrigger,
  action: GameAction,
  ctx: HookContext,
  previousState?: string
): boolean {
  switch (trigger.type) {
    case 'action':
      return action.type === trigger.action_type;

    case 'card_type':
      if (action.type === 'play_card') {
        const cardName = (action as { card: string }).card;
        const card = (ctx.player.hand ?? []).find(c => c.name === cardName);
        return card?.type === trigger.match;
      }
      return false;

    case 'card_name':
      if (action.type === 'play_card') {
        const cardName = (action as { card: string }).card;
        return cardName === trigger.match;
      }
      return false;

    case 'state_enter':
      if (action.type === 'move') {
        return ctx.player.state === trigger.state;
      }
      return false;

    case 'state_leave':
      if (action.type === 'move' && previousState) {
        return previousState === trigger.state;
      }
      return false;

    case 'resource_threshold':
      const resources = ctx.player.resources || {};
      const amount = resources[trigger.resource!] || 0;
      const threshold = trigger.threshold || 0;
      const comp = trigger.comparison || '>=';
      switch (comp) {
        case '>=': return amount >= threshold;
        case '>': return amount > threshold;
        case '<=': return amount <= threshold;
        case '<': return amount < threshold;
        case '==': return amount === threshold;
      }
      break;
  }

  return false;
}

function applyChainEffect(
  effect: ChainEffect,
  ctx: HookContext,
  stateChanges: StateChanges
): void {
  const playerId = ctx.playerId;
  const state = ctx.state;

  switch (effect.type) {
    case 'draw':
      const count = effect.count ?? 1;
      const { cards } = drawFromDeck(state, count, playerId);
      if (cards.length > 0) {
        addToHand(state, playerId, cards);
      }
      break;

    case 'resource':
      if (effect.resource) {
        addResource(state, playerId, effect.resource, effect.amount ?? 1);
      }
      break;

    case 'score':
      const scoreBonus = effect.amount ?? 1;
      stateChanges.playerStateChanges = stateChanges.playerStateChanges || {};
      stateChanges.playerStateChanges[playerId] = {
        ...stateChanges.playerStateChanges[playerId],
        score: (ctx.player.score ?? 0) + scoreBonus
      };
      break;

    case 'extra_action':
      stateChanges.playerStateChanges = stateChanges.playerStateChanges || {};
      stateChanges.playerStateChanges[playerId] = {
        ...stateChanges.playerStateChanges[playerId],
        extraActions: ((ctx.player.extraActions as number) || 0) + (effect.count ?? 1)
      };
      break;

    case 'effect':
      if (effect.effect) {
        const currentEffects = [...ctx.player.effects];
        currentEffects.push({
          type: effect.effect.type,
          duration: effect.effect.duration ?? 1,
          value: effect.effect.value,
          source: 'chain'
        });
        stateChanges.playerStateChanges = stateChanges.playerStateChanges || {};
        stateChanges.playerStateChanges[playerId] = {
          ...stateChanges.playerStateChanges[playerId],
          effects: currentEffects
        };
      }
      break;

    case 'move':
      if (effect.target) {
        stateChanges.playerStateChanges = stateChanges.playerStateChanges || {};
        stateChanges.playerStateChanges[playerId] = {
          ...stateChanges.playerStateChanges[playerId],
          state: effect.target
        };
      }
      break;
  }
}

export const chainingMechanic: MechanicHooks = {
  slug: 'chaining',
  name: 'Chaining',
  requires: ['resources'],

  configSchema: {
    type: 'object',
    description: 'Actions that trigger follow-up effects',
    properties: {
      rules: {
        type: 'array',
        description: 'Chain rules',
        required: true
      },
      max_chain_depth: {
        type: 'number',
        description: 'Maximum chain depth per action',
        default: 3
      }
    },
    required: ['rules']
  },

  postExecuteAction(ctx: HookContext, action: GameAction): StateChanges | null {
    const chainConfig = ctx.config.engine_mechanics?.chaining as ChainingConfig | undefined;
    if (!chainConfig?.rules) return null;

    const stateChanges: StateChanges = {};
    const triggeredChains: string[] = [];

    // Track chain usage
    const turnChainCounts = ((ctx.state.shared.turnChainCounts as Record<string, number>) || {});
    const gameChainCounts = ((ctx.state.shared.gameChainCounts as Record<string, number>) || {});

    // Get previous state from shared state (set by move handler)
    const previousState = ctx.state.shared.previousPlayerState as string | undefined;

    for (const rule of chainConfig.rules) {
      // Check max per turn
      if (rule.max_per_turn !== undefined) {
        const turnCount = turnChainCounts[rule.id] || 0;
        if (turnCount >= rule.max_per_turn) continue;
      }

      // Check max per game
      if (rule.max_per_game !== undefined) {
        const gameCount = gameChainCounts[rule.id] || 0;
        if (gameCount >= rule.max_per_game) continue;
      }

      // Check trigger
      if (!checkTrigger(rule.trigger, action, ctx, previousState)) continue;

      // Check condition
      if (!checkCondition(ctx, rule.condition)) continue;

      // Apply effect
      applyChainEffect(rule.effect, ctx, stateChanges);
      triggeredChains.push(rule.name);

      // Update counters
      turnChainCounts[rule.id] = (turnChainCounts[rule.id] || 0) + 1;
      gameChainCounts[rule.id] = (gameChainCounts[rule.id] || 0) + 1;
    }

    if (triggeredChains.length === 0) return null;

    stateChanges.sharedStateChanges = {
      ...stateChanges.sharedStateChanges,
      turnChainCounts,
      gameChainCounts,
      lastTriggeredChains: triggeredChains
    };

    return stateChanges;
  }
};
