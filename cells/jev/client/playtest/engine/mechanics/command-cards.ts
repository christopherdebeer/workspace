/**
 * Command Cards Mechanic
 *
 * Cards that issue commands to units/elements. Playing a command card
 * activates specific game elements.
 *
 * Hooks used:
 * - getAvailableActions: 'play_command' from hand
 * - onExecuteAction: Execute command effect
 * - getPlayerView: Show available commands
 */

import {
  MechanicHooks,
  HookContext,
  ActionExecutionContext,
  ActionExecutionResult,
  AvailableAction,
  isMechanicEnabled
} from './types';
import { GameAction, GameConfig } from '../types/game';

interface CommandCardConfig {
  commands?: Record<string, { name: string; effect: string; power: number }>;
}

function getConfig(config: GameConfig): CommandCardConfig | undefined {
  return config.engine_mechanics?.command_cards as CommandCardConfig | undefined;
}

export const commandCardsMechanic: MechanicHooks = {
  slug: 'command-cards',
  name: 'Command Cards',
  requires: ['cards'],

  configSchema: {
    type: 'object',
    description: 'Cards that issue commands to game elements',
    properties: {
      commands: { type: 'object', description: 'Command definitions' }
    }
  },

  getAvailableActions(ctx: HookContext): AvailableAction[] {
    if (!isMechanicEnabled(ctx.config, 'command-cards')) return [];

    const hand = (ctx.player.hand || []) as Array<{ id: string; type?: string; name?: string }>;
    const commandCards = hand.filter(c => c.type === 'command');

    return commandCards.map(card => ({
      action: {
        type: 'play_command',
        cardId: card.id
      } as unknown as GameAction,
      priority: 75,
      category: 'command'
    }));
  },

  onExecuteAction(ctx: ActionExecutionContext): ActionExecutionResult | null {
    if (ctx.action.type !== 'play_command') return null;

    const config = getConfig(ctx.config);
    const cmdAction = ctx.action as unknown as { type: 'play_command'; cardId: string; target?: string };
    const hand = (ctx.player.hand || []) as Array<{ id: string; type?: string; name?: string; power?: number }>;
    const card = hand.find(c => c.id === cmdAction.cardId);

    if (!card) {
      return { handled: true, logMessage: 'Command card not in hand.', advanceTurn: false, checkWin: false };
    }

    // Remove card from hand
    const newHand = hand.filter(c => c.id !== cmdAction.cardId);
    const power = card.power ?? 1;

    return {
      handled: true,
      stateChanges: {
        playerStateChanges: {
          [ctx.playerId]: {
            hand: newHand as unknown as import('../types/game').Card[],
            score: (ctx.player.score ?? 0) + power
          }
        }
      },
      advanceTurn: false,
      checkWin: false,
      logMessage: `${ctx.playerId} played command: ${card.name ?? card.id} (power ${power}).`,
      logData: { player: ctx.playerId, card: card.id, name: card.name, power }
    };
  },

  getPlayerView(ctx: HookContext): Record<string, unknown> | null {
    if (!isMechanicEnabled(ctx.config, 'command-cards')) return null;

    const hand = (ctx.player.hand || []) as Array<{ id: string; type?: string }>;
    const commandCards = hand.filter(c => c.type === 'command');

    return {
      commandCardsInHand: commandCards.length
    };
  }
};
