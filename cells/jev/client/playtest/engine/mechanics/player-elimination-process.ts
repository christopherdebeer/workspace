/**
 * Player Elimination Process Mechanic
 *
 * Not a win condition but a gameplay mechanic. Removes players from the game
 * when they meet elimination criteria (zero score, zero resource, no cards).
 * Adds 'eliminated' effect and optionally removes from turn order.
 *
 * Config (engine_mechanics.player_elimination):
 * ```yaml
 * engine_mechanics:
 *   player_elimination:
 *     condition: zero_resource
 *     resource: gold
 *     remove_from_turn_order: true
 * ```
 *
 * Hooks used:
 * - postExecuteAction: After any action, check if any player meets elimination criteria
 */

import {
  MechanicHooks,
  HookContext,
  StateChanges
} from './types';
import { GameAction, PlayerState } from '../types/game';

interface PlayerEliminationConfig {
  condition: 'zero_score' | 'zero_resource' | 'no_cards';
  resource?: string;
  remove_from_turn_order?: boolean;
}

function shouldEliminate(player: PlayerState, config: PlayerEliminationConfig): boolean {
  // Skip already-eliminated players
  const hasEliminatedEffect = player.effects?.some(e => e.type === 'eliminated') ?? false;
  if (hasEliminatedEffect || player.state === 'eliminated') {
    return false;
  }

  switch (config.condition) {
    case 'zero_score':
      return (player.score ?? 0) <= 0;

    case 'zero_resource': {
      const resource = config.resource ?? 'gold';
      return (player.resources?.[resource] ?? 0) <= 0;
    }

    case 'no_cards':
      return (player.hand || []).length === 0;

    default:
      return false;
  }
}

export const playerEliminationProcessMechanic: MechanicHooks = {
  slug: 'player-elimination',
  name: 'Player Elimination Process',

  configSchema: {
    type: 'object',
    description: 'Eliminates players when they meet criteria during play',
    properties: {
      condition: {
        type: 'string',
        description: 'Condition that triggers elimination',
        enum: ['zero_score', 'zero_resource', 'no_cards']
      },
      resource: {
        type: 'string',
        description: 'Resource to check for zero_resource condition'
      },
      remove_from_turn_order: {
        type: 'boolean',
        description: 'Whether to remove eliminated players from turn order',
        default: true
      }
    },
    required: ['condition']
  },

  postExecuteAction(ctx: HookContext, _action: GameAction): StateChanges | null {
    const config = ctx.config.engine_mechanics?.player_elimination as PlayerEliminationConfig | undefined;
    if (!config) return null;

    const removeFromTurnOrder = config.remove_from_turn_order ?? true;
    const playerStateChanges: Record<string, Partial<PlayerState>> = {};
    let anyEliminated = false;

    // Check all players for elimination criteria
    for (const [playerId, player] of Object.entries(ctx.state.players)) {
      if (shouldEliminate(player, config)) {
        // Add eliminated effect
        const newEffects = [...(player.effects || []), {
          type: 'eliminated',
          duration: -1,  // Permanent
          source: 'player-elimination'
        }];

        playerStateChanges[playerId] = {
          effects: newEffects
        };

        anyEliminated = true;
      }
    }

    if (!anyEliminated) return null;

    const changes: StateChanges = {
      playerStateChanges
    };

    // Remove eliminated players from turn order
    if (removeFromTurnOrder) {
      const eliminatedIds = Object.keys(playerStateChanges);
      const newTurnOrder = ctx.state.turnOrder.filter(pid => !eliminatedIds.includes(pid));

      // Only update if turn order actually changed
      if (newTurnOrder.length < ctx.state.turnOrder.length) {
        changes.sharedStateChanges = {
          turnOrder: newTurnOrder
        };
      }
    }

    return changes;
  }
};
