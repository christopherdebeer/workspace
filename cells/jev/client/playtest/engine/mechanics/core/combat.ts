/**
 * Combat Core Service
 *
 * Provides combat resolution infrastructure for wargame and conflict mechanics.
 * Supports various combat systems: ratio-based CRT, dice-based, card-based.
 */

import { GameState, GameConfig, PlayerState } from '../../types/game';
import { StateChanges } from '../types';

// ============ Combat Context Types ============

export interface CombatContext {
  state: GameState;
  attackerId: string;
  defenderId: string;
  attackerUnits?: string[];
  defenderUnits?: string[];
  territory?: string;
  combatType?: string;  // 'melee', 'ranged', 'siege', etc.
  config: GameConfig;
}

export interface CombatResult {
  winner: 'attacker' | 'defender' | 'draw';
  attackerLosses: number;
  defenderLosses: number;
  territoryChange: boolean;
  retreatRequired?: 'attacker' | 'defender' | 'both';
  criticalHit?: boolean;
  criticalFailure?: boolean;
}

export interface CombatModifier {
  modifier: number;
  reason: string;
  source?: string;  // mechanic slug
}

export interface Casualties {
  attacker: number;
  defender: number;
}

// ============ Combat Session State ============

export interface CombatSession {
  id: string;
  attackerId: string;
  defenderId: string;
  attackerUnits: string[];
  defenderUnits: string[];
  territory?: string;
  phase: 'setup' | 'commitment' | 'resolution' | 'casualties' | 'complete';
  attackModifiers: CombatModifier[];
  defenseModifiers: CombatModifier[];
  attackValue?: number;
  defenseValue?: number;
  result?: CombatResult;
  round: number;
}

// ============ Combat Unit Types ============

export interface CombatUnit {
  id: string;
  name: string;
  owner: string;
  attack: number;
  defense: number;
  health: number;
  maxHealth: number;
  position?: string;
  abilities?: string[];
  status?: 'ready' | 'committed' | 'retreating' | 'destroyed';
}

// ============ Combat Results Table ============

export interface CRTEntry {
  ratio: string;  // e.g., "1:2", "1:1", "2:1", "3:1"
  outcomes: Record<string, CombatResult>;  // roll -> result
}

// ============ Core Combat Functions ============

/**
 * Start a combat session
 */
export function startCombat(
  state: GameState,
  attackerId: string,
  defenderId: string,
  attackerUnits: string[] = [],
  defenderUnits: string[] = [],
  territory?: string
): { state: GameState; session: CombatSession } {
  const session: CombatSession = {
    id: `combat_${Date.now()}_${Math.random().toString(36).slice(2)}`,
    attackerId,
    defenderId,
    attackerUnits,
    defenderUnits,
    territory,
    phase: 'setup',
    attackModifiers: [],
    defenseModifiers: [],
    round: state.round
  };

  const newState = {
    ...state,
    shared: {
      ...state.shared,
      activeCombat: session,
      combatHistory: [...((state.shared.combatHistory as CombatSession[]) ?? []), session]
    }
  };

  return { state: newState, session };
}

/**
 * Add attack modifier
 */
export function addAttackModifier(
  state: GameState,
  modifier: CombatModifier
): GameState {
  const combat = state.shared.activeCombat as CombatSession | undefined;
  if (!combat) return state;

  return {
    ...state,
    shared: {
      ...state.shared,
      activeCombat: {
        ...combat,
        attackModifiers: [...combat.attackModifiers, modifier]
      }
    }
  };
}

/**
 * Add defense modifier
 */
export function addDefenseModifier(
  state: GameState,
  modifier: CombatModifier
): GameState {
  const combat = state.shared.activeCombat as CombatSession | undefined;
  if (!combat) return state;

  return {
    ...state,
    shared: {
      ...state.shared,
      activeCombat: {
        ...combat,
        defenseModifiers: [...combat.defenseModifiers, modifier]
      }
    }
  };
}

/**
 * Calculate total attack value
 */
export function calculateAttackValue(session: CombatSession, baseAttack: number): number {
  const modifierTotal = session.attackModifiers.reduce((sum, m) => sum + m.modifier, 0);
  return Math.max(0, baseAttack + modifierTotal);
}

/**
 * Calculate total defense value
 */
export function calculateDefenseValue(session: CombatSession, baseDefense: number): number {
  const modifierTotal = session.defenseModifiers.reduce((sum, m) => sum + m.modifier, 0);
  return Math.max(0, baseDefense + modifierTotal);
}

/**
 * Calculate combat ratio for CRT
 */
export function calculateCombatRatio(attack: number, defense: number): string {
  if (defense === 0) return 'auto';

  const ratio = attack / defense;

  if (ratio < 0.5) return '1:3';
  if (ratio < 0.75) return '1:2';
  if (ratio < 1) return '1:1';
  if (ratio < 1.5) return '1:1';
  if (ratio < 2) return '3:2';
  if (ratio < 3) return '2:1';
  if (ratio < 4) return '3:1';
  if (ratio < 5) return '4:1';
  return '5:1';
}

/**
 * Resolve combat using dice
 */
export function resolveDiceCombat(
  attackValue: number,
  defenseValue: number,
  diceSides: number = 6
): CombatResult {
  const attackRoll = Math.floor(Math.random() * diceSides) + 1;
  const defenseRoll = Math.floor(Math.random() * diceSides) + 1;

  const attackTotal = attackValue + attackRoll;
  const defenseTotal = defenseValue + defenseRoll;

  const criticalHit = attackRoll === diceSides;
  const criticalFailure = attackRoll === 1;

  if (criticalHit) {
    return {
      winner: 'attacker',
      attackerLosses: 0,
      defenderLosses: 2,
      territoryChange: true,
      criticalHit: true
    };
  }

  if (criticalFailure) {
    return {
      winner: 'defender',
      attackerLosses: 2,
      defenderLosses: 0,
      territoryChange: false,
      criticalFailure: true
    };
  }

  if (attackTotal > defenseTotal) {
    const margin = attackTotal - defenseTotal;
    return {
      winner: 'attacker',
      attackerLosses: Math.floor(margin / 4),
      defenderLosses: Math.ceil(margin / 2),
      territoryChange: true
    };
  } else if (defenseTotal > attackTotal) {
    const margin = defenseTotal - attackTotal;
    return {
      winner: 'defender',
      attackerLosses: Math.ceil(margin / 2),
      defenderLosses: Math.floor(margin / 4),
      territoryChange: false
    };
  }

  // Draw
  return {
    winner: 'draw',
    attackerLosses: 1,
    defenderLosses: 1,
    territoryChange: false
  };
}

/**
 * Resolve combat using CRT
 */
export function resolveCRTCombat(
  ratio: string,
  roll: number,
  crt: Record<string, CRTEntry>
): CombatResult | null {
  const entry = crt[ratio];
  if (!entry) return null;

  const rollStr = roll.toString();
  return entry.outcomes[rollStr] ?? entry.outcomes['default'] ?? null;
}

/**
 * Apply casualties to units
 */
export function applyCasualties(
  state: GameState,
  casualties: Casualties,
  session: CombatSession
): GameState {
  // Get units
  const attackerUnits = (state.shared.units as Record<string, CombatUnit[]>)?.[session.attackerId] ?? [];
  const defenderUnits = (state.shared.units as Record<string, CombatUnit[]>)?.[session.defenderId] ?? [];

  // Apply attacker casualties (remove from weakest first)
  let attackerRemaining = casualties.attacker;
  const newAttackerUnits = attackerUnits.filter(unit => {
    if (session.attackerUnits.includes(unit.id) && attackerRemaining > 0) {
      if (unit.health <= attackerRemaining) {
        attackerRemaining -= unit.health;
        return false;  // Unit destroyed
      } else {
        unit.health -= attackerRemaining;
        attackerRemaining = 0;
      }
    }
    return true;
  });

  // Apply defender casualties
  let defenderRemaining = casualties.defender;
  const newDefenderUnits = defenderUnits.filter(unit => {
    if (session.defenderUnits.includes(unit.id) && defenderRemaining > 0) {
      if (unit.health <= defenderRemaining) {
        defenderRemaining -= unit.health;
        return false;  // Unit destroyed
      } else {
        unit.health -= defenderRemaining;
        defenderRemaining = 0;
      }
    }
    return true;
  });

  return {
    ...state,
    shared: {
      ...state.shared,
      units: {
        ...((state.shared.units as Record<string, CombatUnit[]>) ?? {}),
        [session.attackerId]: newAttackerUnits,
        [session.defenderId]: newDefenderUnits
      }
    }
  };
}

/**
 * Complete combat and record result
 */
export function completeCombat(
  state: GameState,
  result: CombatResult
): GameState {
  const combat = state.shared.activeCombat as CombatSession | undefined;
  if (!combat) return state;

  const completedCombat: CombatSession = {
    ...combat,
    phase: 'complete',
    result
  };

  // Update combat history
  const history = (state.shared.combatHistory as CombatSession[]) ?? [];
  const updatedHistory = history.map(c =>
    c.id === combat.id ? completedCombat : c
  );

  return {
    ...state,
    shared: {
      ...state.shared,
      activeCombat: null,
      combatHistory: updatedHistory,
      lastCombatResult: result
    }
  };
}

/**
 * Check if player has zone of control over a location
 */
export function hasZoneOfControl(
  state: GameState,
  playerId: string,
  location: string
): boolean {
  const units = (state.shared.units as Record<string, CombatUnit[]>)?.[playerId] ?? [];
  const board = state.shared.board as { adjacency?: Record<string, string[]> } | undefined;

  if (!board?.adjacency) return false;

  // Check if any unit is in the location or adjacent
  return units.some(unit =>
    unit.position === location ||
    (board.adjacency![unit.position ?? '']?.includes(location) ?? false)
  );
}

/**
 * Get all locations under zone of control
 */
export function getControlledZones(
  state: GameState,
  playerId: string
): string[] {
  const units = (state.shared.units as Record<string, CombatUnit[]>)?.[playerId] ?? [];
  const board = state.shared.board as { adjacency?: Record<string, string[]> } | undefined;

  if (!board?.adjacency) return [];

  const zones = new Set<string>();

  for (const unit of units) {
    if (unit.position) {
      zones.add(unit.position);
      const adjacent = board.adjacency[unit.position] ?? [];
      adjacent.forEach(loc => zones.add(loc));
    }
  }

  return Array.from(zones);
}

/**
 * Get active combat session
 */
export function getActiveCombat(state: GameState): CombatSession | null {
  return (state.shared.activeCombat as CombatSession) ?? null;
}

/**
 * Get combat history
 */
export function getCombatHistory(state: GameState): CombatSession[] {
  return (state.shared.combatHistory as CombatSession[]) ?? [];
}
