/**
 * Random Production Mechanic
 *
 * Dice/random mechanics determine resource production (like Catan).
 * Requires resources and dice core mechanics.
 *
 * Hooks used:
 * - onTurnStart: Roll production dice, distribute resources based on result
 */

import {
  MechanicHooks,
  TurnStartContext,
  StateChanges,
  isMechanicEnabled
} from './types';
import { GameConfig } from '../types/game';
import { rollDice } from './core/dice';
import { addResource } from './core/resources';

interface RandomProductionConfig {
  dice_count?: number;
  dice_sides?: number;
  production_table: Record<string, Record<string, number>>;  // roll result -> resource -> amount
  per_player?: boolean;  // each player rolls separately (default: one roll for all)
}

function getConfig(config: GameConfig): RandomProductionConfig | undefined {
  return config.engine_mechanics?.random_production as RandomProductionConfig | undefined;
}

export const randomProductionMechanic: MechanicHooks = {
  slug: 'random-production',
  name: 'Random Production',
  requires: ['resources', 'dice'],

  configSchema: {
    type: 'object',
    description: 'Dice-based resource production (like Catan)',
    properties: {
      dice_count: {
        type: 'number',
        description: 'Number of dice to roll for production',
        default: 2
      },
      dice_sides: {
        type: 'number',
        description: 'Sides per die',
        default: 6
      },
      production_table: {
        type: 'object',
        description: 'Maps roll results to resource production (e.g., {"7": {"gold": 1}})',
        required: true
      },
      per_player: {
        type: 'boolean',
        description: 'Each player rolls separately (default: one roll for all)',
        default: false
      }
    },
    required: ['production_table']
  },

  /**
   * Roll production dice at turn start and distribute resources
   */
  onTurnStart(ctx: TurnStartContext): StateChanges | null {
    const config = getConfig(ctx.config);
    if (!config?.production_table) return null;

    const diceCount = config.dice_count ?? 2;
    const diceSides = config.dice_sides ?? 6;
    const perPlayer = config.per_player ?? false;

    // For shared roll: only process once per round (first player of the round)
    if (!perPlayer && !ctx.isNewRound) return null;
    if (!perPlayer && ctx.state.turnOrder[0] !== ctx.playerId) return null;

    // Roll the production dice
    const rollResult = rollDice(ctx.state, ctx.playerId, { diceCount, diceSides, purpose: 'production' });
    const rollTotal = String(rollResult.total);

    // Look up production for this roll
    const production = config.production_table[rollTotal];
    if (!production) {
      // No production for this roll result
      return {
        sharedStateChanges: {
          lastProductionRoll: {
            total: rollResult.total,
            results: rollResult.results,
            production: null
          }
        }
      };
    }

    // Distribute resources
    if (perPlayer) {
      // Only give to the current player
      for (const [resource, amount] of Object.entries(production)) {
        if (amount > 0) {
          addResource(ctx.state, ctx.playerId, resource, amount);
        }
      }
    } else {
      // Give to all players
      for (const playerId of Object.keys(ctx.state.players)) {
        for (const [resource, amount] of Object.entries(production)) {
          if (amount > 0) {
            addResource(ctx.state, playerId, resource, amount);
          }
        }
      }
    }

    // Record the roll for display (state already mutated by addResource)
    return {
      sharedStateChanges: {
        lastProductionRoll: {
          total: rollResult.total,
          results: rollResult.results,
          production,
          perPlayer
        }
      }
    };
  }
};
