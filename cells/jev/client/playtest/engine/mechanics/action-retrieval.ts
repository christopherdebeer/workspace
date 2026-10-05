/**
 * Action Retrieval Mechanic
 *
 * Players can retrieve previously played cards/actions back to their hand.
 * Instead of drawing new cards, they pick up their discard or played cards.
 * Examples: Concordia (Tribune action retrieves all played cards)
 *
 * Hooks used:
 * - getAvailableActions: Expose 'retrieve_actions' when player has played cards
 * - onExecuteAction: Handle retrieval
 * - initPlayerState: Track played cards separately
 * - getPlayerView: Show retrievable cards
 */

import {
  MechanicHooks,
  HookContext,
  AvailableAction,
  ActionExecutionContext,
  ActionExecutionResult,
  PlayerInitContext,
  PlayerInitResult,
} from './types';
import { GameAction, Card } from '../types/game';

interface ActionRetrievalConfig {
  source?: 'played' | 'discard';  // Where to retrieve from (default 'played')
  retrieve_all?: boolean;          // Must retrieve all at once (default true)
  max_retrieve?: number;           // Max cards to retrieve (if not all)
  costs_action?: boolean;          // Retrieving costs your whole turn (default true)
}

export const actionRetrievalMechanic: MechanicHooks = {
  slug: 'action-retrieval',
  name: 'Action Retrieval',

  configSchema: {
    type: 'object',
    description: 'Retrieve previously played cards/actions back to hand',
    properties: {
      source: { type: 'string', description: 'Where to retrieve from', enum: ['played', 'discard'], default: 'played' },
      retrieve_all: { type: 'boolean', description: 'Must retrieve all at once', default: true },
      max_retrieve: { type: 'number', description: 'Max cards to retrieve' },
      costs_action: { type: 'boolean', description: 'Costs your entire turn', default: true },
    },
  },

  initPlayerState(ctx: PlayerInitContext): PlayerInitResult | null {
    const config = ctx.config.engine_mechanics?.action_retrieval as ActionRetrievalConfig | undefined;
    if (!config) return null;
    return { playedCards: [] };
  },

  getAvailableActions(ctx: HookContext): AvailableAction[] {
    const config = ctx.config.engine_mechanics?.action_retrieval as ActionRetrievalConfig | undefined;
    if (!config) return [];

    const source = config.source || 'played';
    let retrievable: unknown[];

    if (source === 'played') {
      retrievable = (ctx.player.playedCards as unknown[]) || [];
    } else {
      retrievable = (ctx.state.shared.discard as unknown[]) || [];
    }

    if (retrievable.length === 0) return [];

    if (config.retrieve_all !== false) {
      return [{
        action: {
          type: 'retrieve_actions',
        } as GameAction,
        priority: 30,
        category: 'retrieval',
      }];
    }

    // Selective retrieval - still return a single retrieve_actions action
    // (agent chooses which card via game interaction)
    return [{
      action: {
        type: 'retrieve_actions',
      } as GameAction,
      priority: 30,
      category: 'retrieval',
    }];
  },

  onExecuteAction(ctx: ActionExecutionContext): ActionExecutionResult | null {
    if (ctx.action.type !== 'retrieve_actions') return null;

    const config = ctx.config.engine_mechanics?.action_retrieval as ActionRetrievalConfig | undefined;
    if (!config) return null;

    const source = config.source || 'played';
    const player = ctx.state.players[ctx.playerId];
    const hand = [...(player?.hand || [])];

    if (config.retrieve_all !== false) {
      // Retrieve all
      if (source === 'played') {
        const cards = (player?.playedCards as string[]) || [];
        // Convert played card IDs back to cards for hand
        // playedCards is string[] (card names/IDs), retrieve by finding in hand context
        return {
          handled: true,
          stateChanges: {
            playerStateChanges: {
              [ctx.playerId]: {
                hand: [...hand, ...(cards as unknown as Card[])],
                playedCards: [],
              },
            },
          },
          advanceTurn: config.costs_action !== false,
          logMessage: `retrieved ${cards.length} played cards`,
        };
      } else {
        const cards = (ctx.state.shared.discard as Card[]) || [];
        return {
          handled: true,
          stateChanges: {
            playerStateChanges: {
              [ctx.playerId]: { hand: [...hand, ...cards] },
            },
            sharedStateChanges: { discard: [] },
          },
          advanceTurn: config.costs_action !== false,
          logMessage: `retrieved ${cards.length} cards from discard`,
        };
      }
    }

    // Single card retrieval
    const actionAny = ctx.action as unknown as Record<string, unknown>;
    const cardId = actionAny.cardId as string;
    if (!cardId) return null;

    if (source === 'played') {
      const played = [...((player?.playedCards as string[]) || [])];
      const idx = played.findIndex((c: string) => c === cardId);
      if (idx === -1) return null;
      played.splice(idx, 1);
      return {
        handled: true,
        stateChanges: {
          playerStateChanges: {
            [ctx.playerId]: {
              hand: [...hand, ...([ cardId ] as unknown as Card[])],
              playedCards: played,
            },
          },
        },
        advanceTurn: config.costs_action !== false,
        logMessage: `retrieved ${cardId}`,
      };
    } else {
      const discard = [...((ctx.state.shared.discard as Card[]) || [])];
      const idx = discard.findIndex((c: Card) => (c.id || c.name) === cardId);
      if (idx === -1) return null;
      const card = discard.splice(idx, 1)[0];
      return {
        handled: true,
        stateChanges: {
          playerStateChanges: {
            [ctx.playerId]: { hand: [...hand, card] },
          },
          sharedStateChanges: { discard },
        },
        advanceTurn: config.costs_action !== false,
        logMessage: `retrieved ${card.name || cardId} from discard`,
      };
    }
  },

  getPlayerView(ctx: HookContext): Record<string, unknown> {
    const config = ctx.config.engine_mechanics?.action_retrieval as ActionRetrievalConfig | undefined;
    if (!config) return {};
    return {
      playedCards: ctx.player.playedCards || [],
    };
  },
};
