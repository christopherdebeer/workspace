/**
 * Ratio Combat Results Table (CRT) Mechanic
 *
 * Classic wargame combat resolution using attack:defense ratios.
 *
 * Config:
 *   ratio_crt:
 *     die_sides: number          # Die type for resolution
 *     crt: Record<string, CRTRow>  # The actual CRT
 */

import { MechanicHooks, CombatHookContext, CombatHookResult, StateChanges } from './types';

interface CRTRow {
  [roll: string]: {
    winner: 'attacker' | 'defender' | 'draw';
    attackerLosses: number;
    defenderLosses: number;
    retreat?: 'attacker' | 'defender' | 'both';
    exchange?: boolean;
  };
}

interface RatioCRTConfig {
  die_sides?: number;
  crt?: Record<string, CRTRow>;
}

// Default CRT based on classic wargame conventions
const DEFAULT_CRT: Record<string, CRTRow> = {
  '1:3': {
    '1': { winner: 'defender', attackerLosses: 2, defenderLosses: 0, retreat: 'attacker' },
    '2': { winner: 'defender', attackerLosses: 2, defenderLosses: 0, retreat: 'attacker' },
    '3': { winner: 'defender', attackerLosses: 1, defenderLosses: 0, retreat: 'attacker' },
    '4': { winner: 'defender', attackerLosses: 1, defenderLosses: 0 },
    '5': { winner: 'draw', attackerLosses: 1, defenderLosses: 0 },
    '6': { winner: 'draw', attackerLosses: 0, defenderLosses: 0 }
  },
  '1:2': {
    '1': { winner: 'defender', attackerLosses: 2, defenderLosses: 0, retreat: 'attacker' },
    '2': { winner: 'defender', attackerLosses: 1, defenderLosses: 0, retreat: 'attacker' },
    '3': { winner: 'defender', attackerLosses: 1, defenderLosses: 0 },
    '4': { winner: 'draw', attackerLosses: 1, defenderLosses: 0 },
    '5': { winner: 'draw', attackerLosses: 0, defenderLosses: 1 },
    '6': { winner: 'attacker', attackerLosses: 0, defenderLosses: 1 }
  },
  '1:1': {
    '1': { winner: 'defender', attackerLosses: 1, defenderLosses: 0, retreat: 'attacker' },
    '2': { winner: 'defender', attackerLosses: 1, defenderLosses: 0 },
    '3': { winner: 'draw', attackerLosses: 1, defenderLosses: 1, exchange: true },
    '4': { winner: 'draw', attackerLosses: 0, defenderLosses: 1 },
    '5': { winner: 'attacker', attackerLosses: 0, defenderLosses: 1 },
    '6': { winner: 'attacker', attackerLosses: 0, defenderLosses: 1, retreat: 'defender' }
  },
  '2:1': {
    '1': { winner: 'defender', attackerLosses: 1, defenderLosses: 0 },
    '2': { winner: 'draw', attackerLosses: 1, defenderLosses: 1, exchange: true },
    '3': { winner: 'attacker', attackerLosses: 0, defenderLosses: 1 },
    '4': { winner: 'attacker', attackerLosses: 0, defenderLosses: 1, retreat: 'defender' },
    '5': { winner: 'attacker', attackerLosses: 0, defenderLosses: 2, retreat: 'defender' },
    '6': { winner: 'attacker', attackerLosses: 0, defenderLosses: 2, retreat: 'defender' }
  },
  '3:1': {
    '1': { winner: 'draw', attackerLosses: 1, defenderLosses: 1, exchange: true },
    '2': { winner: 'attacker', attackerLosses: 0, defenderLosses: 1 },
    '3': { winner: 'attacker', attackerLosses: 0, defenderLosses: 1, retreat: 'defender' },
    '4': { winner: 'attacker', attackerLosses: 0, defenderLosses: 2, retreat: 'defender' },
    '5': { winner: 'attacker', attackerLosses: 0, defenderLosses: 2, retreat: 'defender' },
    '6': { winner: 'attacker', attackerLosses: 0, defenderLosses: 3, retreat: 'defender' }
  },
  '4:1': {
    '1': { winner: 'attacker', attackerLosses: 0, defenderLosses: 1 },
    '2': { winner: 'attacker', attackerLosses: 0, defenderLosses: 1, retreat: 'defender' },
    '3': { winner: 'attacker', attackerLosses: 0, defenderLosses: 2, retreat: 'defender' },
    '4': { winner: 'attacker', attackerLosses: 0, defenderLosses: 2, retreat: 'defender' },
    '5': { winner: 'attacker', attackerLosses: 0, defenderLosses: 3, retreat: 'defender' },
    '6': { winner: 'attacker', attackerLosses: 0, defenderLosses: 3, retreat: 'defender' }
  }
};

function calculateRatio(attack: number, defense: number): string {
  if (defense === 0) return '4:1';

  const ratio = attack / defense;

  if (ratio < 0.5) return '1:3';
  if (ratio < 0.75) return '1:2';
  if (ratio < 1.5) return '1:1';
  if (ratio < 2.5) return '2:1';
  if (ratio < 3.5) return '3:1';
  return '4:1';
}

export const ratioCRTMechanic: MechanicHooks = {
  slug: 'ratio-combat-results-table',
  name: 'Ratio Combat Results Table',
  requires: ['combat'],

  configSchema: {
    type: 'object',
    description: 'Classic wargame CRT combat resolution',
    properties: {
      die_sides: {
        type: 'number',
        description: 'Die type for resolution',
        default: 6
      },
      crt: {
        type: 'object',
        description: 'Custom CRT (uses default if not provided)'
      }
    }
  },

  onCombatStart(ctx: CombatHookContext): StateChanges | null {
    const config = ctx.config.engine_mechanics?.ratio_crt as RatioCRTConfig | undefined;
    if (!config) return null;

    // Roll the combat die
    const dieSides = config.die_sides ?? 6;
    const roll = Math.floor(Math.random() * dieSides) + 1;

    return {
      sharedStateChanges: {
        lastCombatRoll: roll
      }
    };
  },

  onResolveCombat(
    ctx: CombatHookContext,
    attackValue: number,
    defenseValue: number
  ): CombatHookResult | null {
    const config = ctx.config.engine_mechanics?.ratio_crt as RatioCRTConfig | undefined;
    if (!config) return null;

    const crt = config.crt ?? DEFAULT_CRT;
    const ratio = calculateRatio(attackValue, defenseValue);
    const roll = ctx.state.shared.lastCombatRoll as number | undefined;

    if (roll === undefined) return null;

    const crtRow = crt[ratio];
    if (!crtRow) return null;

    const result = crtRow[roll.toString()];
    if (!result) return null;

    return {
      winner: result.winner,
      attackerLosses: result.attackerLosses,
      defenderLosses: result.defenderLosses,
      territoryChange: result.winner === 'attacker' && result.retreat === 'defender',
      retreatRequired: result.retreat
    };
  }
};
