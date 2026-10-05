/**
 * Die Icon Resolution Mechanic
 *
 * Dice with symbols/icons instead of numbers, where each symbol triggers
 * a specific effect.
 *
 * Config:
 *   die_icon_resolution:
 *     dice_count: number        # Number of dice to roll
 *     icons: Record<string, {   # Icon definitions
 *       weight: number          # Probability weight (faces with this icon)
 *       effect: string          # Effect type to trigger
 *       value?: number          # Optional numeric value for the effect
 *     }>
 *
 * Hooks used:
 * - onAfterRoll: Resolve icon effects
 * - onExecuteAction: Handle icon dice roll action
 * - getAvailableActions: Expose icon dice roll action
 */

import { MechanicHooks, HookContext, ActionExecutionContext, ActionExecutionResult, AvailableAction, StateChanges } from './types';
import { GameAction, IconRollAction, DieIconResolutionConfig } from '../types/game';
import { addResource } from './core/resources';
import type { DiceHooks, DiceRolledPayload } from './core/dice-mechanic';

interface IconRollResult {
  icons: string[];
  effects: Array<{ icon: string; effect: string; value?: number }>;
}

/**
 * Build a lookup table where each icon appears according to its weight
 */
function buildIconTable(icons: Record<string, { weight: number; effect: string; value?: number }>): string[] {
  const table: string[] = [];

  for (const [iconName, iconDef] of Object.entries(icons)) {
    for (let i = 0; i < iconDef.weight; i++) {
      table.push(iconName);
    }
  }

  if (table.length === 0) {
    return ['blank'];
  }

  return table;
}

export const dieIconResolutionMechanic: MechanicHooks & DiceHooks = {
  slug: 'die-icon-resolution',
  name: 'Die Icon Resolution',
  requires: ['dice', 'resources'],

  configSchema: {
    type: 'object',
    description: 'Symbol-based dice with icon effects',
    properties: {
      dice_count: {
        type: 'number',
        description: 'Number of icon dice to roll',
        default: 1
      },
      icons: {
        type: 'object',
        description: 'Icon definitions with weights and effects'
      }
    },
    required: ['icons']
  },

  onExecuteAction(ctx: ActionExecutionContext): ActionExecutionResult | null {
    const { action, state, playerId } = ctx;
    if (action.type !== 'icon_roll') return null;

    const config = ctx.config.engine_mechanics?.die_icon_resolution;
    if (!config) return null;

    // Build the icon lookup table based on weights
    const iconTable = buildIconTable(config.icons);
    const diceCount = config.dice_count ?? 1;

    // Roll dice and resolve to icons
    const rolledIcons: string[] = [];
    for (let i = 0; i < diceCount; i++) {
      const roll = Math.floor(Math.random() * iconTable.length);
      rolledIcons.push(iconTable[roll]);
    }

    // Resolve effects
    const effects: Array<{ icon: string; effect: string; value?: number }> = [];
    const effectCounts: Record<string, number> = {};

    for (const icon of rolledIcons) {
      const iconDef = config.icons[icon];
      if (iconDef) {
        effects.push({
          icon,
          effect: iconDef.effect,
          value: iconDef.value
        });
        effectCounts[iconDef.effect] = (effectCounts[iconDef.effect] ?? 0) + (iconDef.value ?? 1);
      }
    }

    // Apply effects to state
    const stateChanges: StateChanges = {
      sharedStateChanges: {
        lastIconRoll: {
          playerId,
          icons: rolledIcons,
          effects,
          effectCounts
        } as IconRollResult & { playerId: string; effectCounts: Record<string, number> }
      }
    };

    // Apply resource effects via resource service (fires hooks)
    for (const [effect, count] of Object.entries(effectCounts)) {
      if (effect.startsWith('gain_')) {
        const resource = effect.replace('gain_', '');
        addResource(state, playerId, resource, count);
      }
    }

    return {
      handled: true,
      stateChanges,
      advanceTurn: true,
      checkWin: true,
      logMessage: `${playerId} rolled icons: ${rolledIcons.join(', ')}`,
      logData: { icons: rolledIcons, effects }
    };
  },

  getAvailableActions(ctx: HookContext): AvailableAction[] {
    const config = ctx.config.engine_mechanics?.die_icon_resolution;
    if (!config) return [];

    return [{
      action: {
        type: 'icon_roll'
      } as IconRollAction,
      priority: 70,
      category: 'dice'
    }];
  },

  onDiceRolled(ctx: HookContext, payload: DiceRolledPayload): StateChanges | null {
    const config = ctx.config.engine_mechanics?.die_icon_resolution;
    if (!config) return null;

    // Only intercept if purpose indicates icon resolution
    if (payload.purpose !== 'icon') return null;

    const iconTable = buildIconTable(config.icons);

    // Convert numeric results to icons
    const icons: string[] = payload.results.map(result => {
      const index = (result - 1) % iconTable.length;
      return iconTable[index];
    });

    return {
      sharedStateChanges: {
        lastRollIcons: icons
      }
    };
  }
};
