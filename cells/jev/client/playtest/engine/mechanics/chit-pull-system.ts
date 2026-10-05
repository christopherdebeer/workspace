/**
 * Chit Pull System Mechanic
 *
 * Random activation order determined by pulling chits from a cup.
 *
 * Config:
 *   chit_pull:
 *     chits_per_player: number      # Chits per player
 *     formation_chits: boolean      # Include formation/unit type chits
 *     event_chits: boolean          # Include event chits
 *     return_after_pull: boolean    # Return chits after being pulled
 */

import { MechanicHooks, TurnOrderContext, TurnOrderResult, StateChanges, TurnStartContext } from './types';

interface ChitPullConfig {
  chits_per_player?: number;
  formation_chits?: boolean;
  event_chits?: boolean;
  return_after_pull?: boolean;
}

interface Chit {
  id: string;
  type: 'player' | 'formation' | 'event';
  playerId?: string;
  formationType?: string;
  eventId?: string;
}

interface ChitPullState {
  cup: Chit[];
  pulledThisRound: Chit[];
  currentChit: Chit | null;
}

export const chitPullSystemMechanic: MechanicHooks = {
  slug: 'chit-pull-system',
  name: 'Chit Pull System',
  requires: ['combat'],

  configSchema: {
    type: 'object',
    description: 'Random activation via chit drawing',
    properties: {
      chits_per_player: {
        type: 'number',
        description: 'Number of chits per player',
        default: 2
      },
      formation_chits: {
        type: 'boolean',
        description: 'Include formation/unit type chits',
        default: false
      },
      event_chits: {
        type: 'boolean',
        description: 'Include random event chits',
        default: false
      },
      return_after_pull: {
        type: 'boolean',
        description: 'Return chits to cup after pulling',
        default: false
      }
    }
  },

  onTurnStart(ctx: TurnStartContext): StateChanges | null {
    const config = ctx.config.engine_mechanics?.chit_pull as ChitPullConfig | undefined;
    if (!config) return null;

    const chitPullState = ctx.state.shared.chitPullState as ChitPullState | undefined;

    // If cup is empty or doesn't exist, initialize it
    if (!chitPullState || chitPullState.cup.length === 0) {
      const chits: Chit[] = [];
      const chitsPerPlayer = config.chits_per_player ?? 2;

      // Add player chits
      for (const playerId of Object.keys(ctx.state.players)) {
        for (let i = 0; i < chitsPerPlayer; i++) {
          chits.push({
            id: `${playerId}-${i}`,
            type: 'player',
            playerId
          });
        }
      }

      // Add event chits if enabled
      if (config.event_chits) {
        chits.push({
          id: 'event-1',
          type: 'event',
          eventId: 'random_event'
        });
      }

      // Shuffle the cup
      const shuffled = [...chits].sort(() => Math.random() - 0.5);

      return {
        sharedStateChanges: {
          chitPullState: {
            cup: shuffled,
            pulledThisRound: [],
            currentChit: null
          }
        }
      };
    }

    return null;
  },

  onDetermineTurnOrder(ctx: TurnOrderContext): TurnOrderResult | null {
    const config = ctx.config.engine_mechanics?.chit_pull as ChitPullConfig | undefined;
    if (!config) return null;

    const chitPullState = ctx.state.shared.chitPullState as ChitPullState | undefined;
    if (!chitPullState || chitPullState.cup.length === 0) return null;

    // Pull a chit from the cup
    const cup = [...chitPullState.cup];
    const pulledChit = cup.shift()!;

    // Determine next player based on pulled chit
    let nextPlayer: string | undefined;
    if (pulledChit.type === 'player') {
      nextPlayer = pulledChit.playerId;
    } else if (pulledChit.type === 'formation') {
      // Find player with matching formation
      for (const [playerId] of Object.entries(ctx.state.players)) {
        const units = (ctx.state.shared.units as Record<string, { formation?: string }[]>)?.[playerId] ?? [];
        if (units.some(u => u.formation === pulledChit.formationType)) {
          nextPlayer = playerId;
          break;
        }
      }
    }

    // If return_after_pull, add back to cup
    if (config.return_after_pull) {
      cup.push(pulledChit);
    }

    // Note: State changes for chit pull should be handled by onTurnStart
    // This hook only returns the new turn order
    return {
      order: nextPlayer ? [nextPlayer, ...ctx.state.turnOrder.filter(p => p !== nextPlayer)] : ctx.state.turnOrder
    };
  }
};
