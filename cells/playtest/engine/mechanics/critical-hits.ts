/**
 * Critical Hits and Failures Mechanic
 *
 * Implements special outcomes for extreme dice rolls in combat.
 *
 * Config:
 *   critical_hits:
 *     critical_hit_roll: number      # Roll that triggers critical hit
 *     critical_fail_roll: number     # Roll that triggers critical failure
 *     critical_hit_multiplier: number # Damage multiplier on crit
 *     critical_fail_penalty: number  # Self-damage on fail
 */

import { MechanicHooks, CombatHookContext, CombatHookResult, StateChanges } from './types';
import { GameConfig } from '../types/game';

interface CriticalHitsConfig {
  critical_hit_roll?: number;
  critical_fail_roll?: number;
  critical_hit_multiplier?: number;
  critical_fail_penalty?: number;
}

export const criticalHitsMechanic: MechanicHooks = {
  slug: 'critical-hits-and-failures',
  name: 'Critical Hits and Failures',
  requires: ['combat'],

  configSchema: {
    type: 'object',
    description: 'Special outcomes for extreme combat rolls',
    properties: {
      critical_hit_roll: {
        type: 'number',
        description: 'Roll that triggers critical hit (usually max)',
        default: 6
      },
      critical_fail_roll: {
        type: 'number',
        description: 'Roll that triggers critical failure (usually 1)',
        default: 1
      },
      critical_hit_multiplier: {
        type: 'number',
        description: 'Damage multiplier on critical hit',
        default: 2
      },
      critical_fail_penalty: {
        type: 'number',
        description: 'Self-damage on critical failure',
        default: 1
      }
    }
  },

  onResolveCombat(
    ctx: CombatHookContext,
    attackValue: number,
    defenseValue: number
  ): CombatHookResult | null {
    const config = ctx.config.engine_mechanics?.critical_hits as CriticalHitsConfig | undefined;
    if (!config) return null;

    // Check if there's a combat roll in state
    const lastRoll = ctx.state.shared.lastCombatRoll as number | undefined;
    if (lastRoll === undefined) return null;

    const critHitRoll = config.critical_hit_roll ?? 6;
    const critFailRoll = config.critical_fail_roll ?? 1;
    const critMultiplier = config.critical_hit_multiplier ?? 2;
    const critPenalty = config.critical_fail_penalty ?? 1;

    // Critical hit
    if (lastRoll === critHitRoll) {
      const baseDamage = Math.max(1, attackValue - defenseValue);
      return {
        winner: 'attacker',
        attackerLosses: 0,
        defenderLosses: baseDamage * critMultiplier,
        territoryChange: true,
        criticalHit: true
      };
    }

    // Critical failure
    if (lastRoll === critFailRoll) {
      return {
        winner: 'defender',
        attackerLosses: critPenalty,
        defenderLosses: 0,
        territoryChange: false,
        criticalFailure: true
      };
    }

    return null;  // Normal resolution
  },

  onCombatEnd(ctx: CombatHookContext, result: CombatHookResult): StateChanges | null {
    // Log critical outcomes
    if (result.criticalHit || result.criticalFailure) {
      return {
        sharedStateChanges: {
          lastCombatCritical: result.criticalHit ? 'hit' : 'failure'
        }
      };
    }
    return null;
  }
};
