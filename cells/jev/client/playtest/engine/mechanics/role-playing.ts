/**
 * Role Playing Mechanic
 *
 * Players adopt character personas that influence their decisions and abilities.
 * Characters have traits, abilities, and backstories that shape gameplay.
 *
 * Hooks used:
 * - initPlayerState: Assign character personas
 * - getPlayerView: Show character info
 * - getAvailableActions: 'use_ability' for character-specific abilities
 * - onExecuteAction: Handle ability usage
 */

import {
  MechanicHooks,
  HookContext,
  ActionExecutionContext,
  ActionExecutionResult,
  AvailableAction,
  PlayerInitContext,
  PlayerInitResult,
  isMechanicEnabled
} from './types';
import { GameAction, GameConfig } from '../types/game';

interface CharacterDef {
  id: string;
  name: string;
  trait: string;
  ability?: string;
  ability_uses?: number;
}

interface RolePlayingConfig {
  characters?: CharacterDef[];
  random_assignment?: boolean;
}

function getConfig(config: GameConfig): RolePlayingConfig | undefined {
  return config.engine_mechanics?.role_playing as RolePlayingConfig | undefined;
}

export const rolePlayingMechanic: MechanicHooks = {
  slug: 'role-playing',
  name: 'Role Playing',
  requires: ['social'],

  configSchema: {
    type: 'object',
    description: 'Players adopt character personas with traits and abilities',
    properties: {
      characters: {
        type: 'array',
        description: 'Character definitions with id, name, trait, ability'
      },
      random_assignment: {
        type: 'boolean',
        description: 'Randomly assign characters to players',
        default: true
      }
    }
  },

  initPlayerState(ctx: PlayerInitContext): PlayerInitResult | null {
    const config = getConfig(ctx.config);
    if (!config?.characters?.length) return null;

    const chars = [...config.characters];
    const charIndex = ctx.playerIndex % chars.length;
    const character = config.random_assignment !== false
      ? chars[charIndex]
      : chars[charIndex];

    return {
      character: {
        id: character.id,
        name: character.name,
        trait: character.trait,
        ability: character.ability ?? null,
        abilityUsesRemaining: character.ability_uses ?? 1
      }
    };
  },

  getAvailableActions(ctx: HookContext): AvailableAction[] {
    if (!isMechanicEnabled(ctx.config, 'role-playing')) return [];

    const character = (ctx.player as unknown as Record<string, unknown>).character as { ability: string | null; abilityUsesRemaining: number } | undefined;
    if (!character?.ability || character.abilityUsesRemaining <= 0) return [];

    return [{
      action: {
        type: 'use_ability',
        abilityId: character.ability
      } as unknown as GameAction,
      priority: 50,
      category: 'role-playing'
    }];
  },

  onExecuteAction(ctx: ActionExecutionContext): ActionExecutionResult | null {
    if (ctx.action.type !== 'use_ability') return null;

    const character = (ctx.player as unknown as Record<string, unknown>).character as { ability: string | null; abilityUsesRemaining: number; name: string } | undefined;
    if (!character?.ability) return null;

    if (character.abilityUsesRemaining <= 0) {
      return {
        handled: true,
        logMessage: 'No ability uses remaining.',
        advanceTurn: false,
        checkWin: false
      };
    }

    return {
      handled: true,
      stateChanges: {
        playerStateChanges: {
          [ctx.playerId]: {
            character: {
              ...character,
              abilityUsesRemaining: character.abilityUsesRemaining - 1
            }
          }
        }
      },
      advanceTurn: false,
      checkWin: false,
      logMessage: `${ctx.playerId} (${character.name}) used ability: ${character.ability}`,
      logData: { player: ctx.playerId, character: character.name, ability: character.ability }
    };
  },

  getPlayerView(ctx: HookContext): Record<string, unknown> | null {
    if (!isMechanicEnabled(ctx.config, 'role-playing')) return null;

    const character = (ctx.player as unknown as Record<string, unknown>).character as Record<string, unknown> | undefined;
    if (!character) return null;

    return { character };
  }
};
