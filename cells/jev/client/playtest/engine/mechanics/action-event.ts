/**
 * Action / Event Mechanic
 *
 * Cards or actions serve dual purpose as either an action (play for effect)
 * or an event (triggered by game conditions). Players choose which mode.
 * Examples: Twilight Struggle (cards as events or ops)
 *
 * Hooks used:
 * - getAvailableActions: Expose 'play_as_event' option for eligible cards
 * - onExecuteAction: Handle event resolution
 * - preValidateAction: Validate event plays
 */

import {
  MechanicHooks,
  HookContext,
  AvailableAction,
  ActionExecutionContext,
  ActionExecutionResult,
  ValidationResult,
} from './types';
import { GameAction, Card } from '../types/game';

interface ActionEventConfig {
  event_field?: string;        // Card field that contains event data (default 'event')
  action_field?: string;       // Card field for action value (default 'value')
  mandatory_events?: boolean;  // Must play card as event if conditions met (default false)
}

export const actionEventMechanic: MechanicHooks = {
  slug: 'action-event',
  name: 'Action / Event',

  configSchema: {
    type: 'object',
    description: 'Cards serve dual purpose as actions or events',
    properties: {
      event_field: { type: 'string', description: 'Card field containing event data', default: 'event' },
      action_field: { type: 'string', description: 'Card field for action value', default: 'value' },
      mandatory_events: { type: 'boolean', description: 'Must play as event when conditions met', default: false },
    },
  },

  getAvailableActions(ctx: HookContext): AvailableAction[] {
    const config = ctx.config.engine_mechanics?.action_event as ActionEventConfig | undefined;
    if (!config) return [];

    const hand = ctx.player.hand || [];
    const eventField = config.event_field || 'event';
    const actions: AvailableAction[] = [];

    for (const card of hand) {
      const cardAny = card as unknown as Record<string, unknown>;
      if (cardAny[eventField]) {
        actions.push({
          action: {
            type: 'play_as_event',
            card: card.id || card.name,
          } as GameAction,
          priority: 40,
          category: 'event',
        });
      }
    }

    return actions;
  },

  preValidateAction(ctx: HookContext, action: GameAction): ValidationResult | null {
    if (action.type !== 'play_as_event') return null;

    const config = ctx.config.engine_mechanics?.action_event as ActionEventConfig | undefined;
    if (!config) return null;

    const cardId = action.card;
    const hand = ctx.player.hand || [];
    const card = hand.find((c: Card) => (c.id || c.name) === cardId);

    if (!card) {
      return { valid: false, error: 'Card not in hand' };
    }

    return { valid: true };
  },

  onExecuteAction(ctx: ActionExecutionContext): ActionExecutionResult | null {
    if (ctx.action.type !== 'play_as_event') return null;

    const config = ctx.config.engine_mechanics?.action_event as ActionEventConfig | undefined;
    if (!config) return null;

    const cardId = ctx.action.card;
    const hand = [...(ctx.state.players[ctx.playerId]?.hand || [])];
    const cardIndex = hand.findIndex((c: Card) => (c.id || c.name) === cardId);

    if (cardIndex === -1) return null;

    const card = hand[cardIndex];
    const eventField = config.event_field || 'event';
    const cardAny = card as unknown as Record<string, unknown>;
    const eventData = cardAny[eventField] as Record<string, unknown> | undefined;

    // Remove card from hand
    hand.splice(cardIndex, 1);

    // Add to discard pile
    const discard = [...(ctx.state.shared.discard as Card[] || []), card];

    return {
      handled: true,
      stateChanges: {
        playerStateChanges: { [ctx.playerId]: { hand } },
        sharedStateChanges: { discard },
      },
      advanceTurn: false,
      logMessage: `played ${card.name || cardId} as event`,
      logData: { eventData },
    };
  },
};
