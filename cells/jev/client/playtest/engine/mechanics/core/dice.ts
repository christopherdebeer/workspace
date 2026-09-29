/**
 * Dice Core Service
 *
 * Manages dice rolling operations with hook support.
 * Enables mechanics like:
 * - dice-rolling: Core dice rolling with modifiers
 * - different-dice-movement: Dice determine movement options
 * - die-icon-resolution: Symbol-based dice effects
 * - roll-spin-and-move: Classic board game movement
 * - re-rolling-and-locking: Yahtzee-style dice selection
 *
 * Fires dice-defined hooks:
 * - onBeforeDiceRoll: Modify dice count/sides or block roll (blocking)
 * - onDiceRolled: React to roll results, apply effects (merge)
 */

import { GameState } from '../../types/game';
import { mechanicRegistry, applyStateChanges } from '../registry';

/**
 * Result of a dice roll operation
 */
export interface DiceRollResult {
  /** Individual die results */
  results: number[];
  /** Sum of all dice */
  total: number;
  /** Whether roll was blocked by a hook */
  blocked?: boolean;
  /** Reason for blocking */
  blockReason?: string;
  /** Any modifier applied to the total */
  modifier?: number;
  /** Final total after modifier */
  finalTotal?: number;
  /** Dice that were kept (for re-roll mechanics) */
  keptDice?: number[];
  /** Dice that were re-rolled */
  rerolledDice?: number[];
}

/**
 * Options for dice rolling
 */
export interface DiceRollOptions {
  /** Number of dice to roll */
  diceCount: number;
  /** Number of sides per die */
  diceSides: number;
  /** Purpose of the roll (for hooks) */
  purpose?: string;
  /** Modifier to add to total */
  modifier?: number;
  /** Indices of dice to keep (for re-rolling) */
  keepIndices?: number[];
  /** Previous results (for re-rolling) */
  previousResults?: number[];
}

/**
 * Roll a single die with the specified number of sides
 */
function rollDie(sides: number): number {
  return Math.floor(Math.random() * sides) + 1;
}

/**
 * Roll multiple dice without hooks (internal use)
 */
function rollDiceInternal(diceCount: number, diceSides: number): number[] {
  const results: number[] = [];
  for (let i = 0; i < diceCount; i++) {
    results.push(rollDie(diceSides));
  }
  return results;
}

/**
 * Roll dice with hook support.
 * Calls onBeforeRoll and onAfterRoll hooks.
 *
 * @param state - Game state
 * @param playerId - Player rolling the dice
 * @param options - Roll options
 */
export function rollDice(
  state: GameState,
  playerId: string,
  options: DiceRollOptions
): DiceRollResult {
  const { diceCount, diceSides, purpose, modifier = 0, keepIndices, previousResults } = options;

  // Fire dice-defined onBeforeDiceRoll hook (blocking)
  let actualDiceCount = diceCount;
  let actualDiceSides = diceSides;
  let hookModifier = 0;

  const beforeResult = mechanicRegistry.fire('dice', 'onBeforeDiceRoll', state, playerId, {
    diceCount: actualDiceCount, diceSides: actualDiceSides, purpose
  });
  if (beforeResult && (beforeResult as Record<string, unknown>).blocked) {
    const blockReason = (beforeResult as Record<string, unknown>).blockReason as string | undefined;
    return { results: [], total: 0, blocked: true, blockReason };
  }
  if (beforeResult) {
    const dr = beforeResult as Record<string, unknown>;
    if (typeof dr.diceCount === 'number') actualDiceCount = dr.diceCount;
    if (typeof dr.diceSides === 'number') actualDiceSides = dr.diceSides;
    if (typeof dr.modifier === 'number') hookModifier += dr.modifier;
  }

  // Handle re-rolling (keep some dice from previous results)
  let results: number[];
  let keptDice: number[] | undefined;
  let rerolledDice: number[] | undefined;

  if (keepIndices && previousResults) {
    // Re-roll: keep specified dice, roll new ones for the rest
    results = [];
    keptDice = [];
    rerolledDice = [];

    for (let i = 0; i < previousResults.length; i++) {
      if (keepIndices.includes(i)) {
        results.push(previousResults[i]);
        keptDice.push(previousResults[i]);
      } else {
        const newRoll = rollDie(actualDiceSides);
        results.push(newRoll);
        rerolledDice.push(newRoll);
      }
    }
  } else {
    // Fresh roll
    results = rollDiceInternal(actualDiceCount, actualDiceSides);
  }

  const total = results.reduce((sum, val) => sum + val, 0);
  const totalModifier = modifier + hookModifier;
  const finalTotal = total + totalModifier;

  // Fire dice-defined onDiceRolled hook (merge)
  const afterChanges = mechanicRegistry.fire('dice', 'onDiceRolled', state, playerId, {
    results, total, diceCount: actualDiceCount, diceSides: actualDiceSides, purpose, keptDice
  });
  if (afterChanges) applyStateChanges(state, afterChanges);

  return {
    results,
    total,
    modifier: totalModifier !== 0 ? totalModifier : undefined,
    finalTotal: totalModifier !== 0 ? finalTotal : undefined,
    keptDice,
    rerolledDice
  };
}

/**
 * Roll a single die (convenience function)
 */
export function rollSingleDie(
  state: GameState,
  playerId: string,
  sides: number,
  purpose?: string
): DiceRollResult {
  return rollDice(state, playerId, {
    diceCount: 1,
    diceSides: sides,
    purpose
  });
}

/**
 * Roll standard six-sided dice
 */
export function rollD6(
  state: GameState,
  playerId: string,
  count: number = 1,
  purpose?: string
): DiceRollResult {
  return rollDice(state, playerId, {
    diceCount: count,
    diceSides: 6,
    purpose
  });
}

/**
 * Roll for movement (common pattern in board games)
 */
export function rollForMovement(
  state: GameState,
  playerId: string,
  diceCount: number = 1,
  diceSides: number = 6
): DiceRollResult {
  return rollDice(state, playerId, {
    diceCount,
    diceSides,
    purpose: 'movement'
  });
}

/**
 * Check if a roll meets or exceeds a target
 */
export function rollCheck(
  state: GameState,
  playerId: string,
  target: number,
  options: Omit<DiceRollOptions, 'modifier'> & { modifier?: number }
): { success: boolean; roll: DiceRollResult; margin: number } {
  const roll = rollDice(state, playerId, options);
  const value = roll.finalTotal ?? roll.total;
  const success = value >= target;
  const margin = value - target;

  return { success, roll, margin };
}

/**
 * Roll with advantage (roll twice, take higher)
 */
export function rollWithAdvantage(
  state: GameState,
  playerId: string,
  options: DiceRollOptions
): DiceRollResult {
  const roll1 = rollDice(state, playerId, { ...options, purpose: `${options.purpose ?? 'roll'}_advantage_1` });
  const roll2 = rollDice(state, playerId, { ...options, purpose: `${options.purpose ?? 'roll'}_advantage_2` });

  if (roll1.blocked) return roll1;
  if (roll2.blocked) return roll2;

  const total1 = roll1.finalTotal ?? roll1.total;
  const total2 = roll2.finalTotal ?? roll2.total;

  return total1 >= total2 ? roll1 : roll2;
}

/**
 * Roll with disadvantage (roll twice, take lower)
 */
export function rollWithDisadvantage(
  state: GameState,
  playerId: string,
  options: DiceRollOptions
): DiceRollResult {
  const roll1 = rollDice(state, playerId, { ...options, purpose: `${options.purpose ?? 'roll'}_disadvantage_1` });
  const roll2 = rollDice(state, playerId, { ...options, purpose: `${options.purpose ?? 'roll'}_disadvantage_2` });

  if (roll1.blocked) return roll1;
  if (roll2.blocked) return roll2;

  const total1 = roll1.finalTotal ?? roll1.total;
  const total2 = roll2.finalTotal ?? roll2.total;

  return total1 <= total2 ? roll1 : roll2;
}

/**
 * Exploding dice: re-roll and add on max value
 */
export function rollExploding(
  state: GameState,
  playerId: string,
  diceCount: number,
  diceSides: number,
  maxExplosions: number = 10
): DiceRollResult {
  const allResults: number[] = [];
  let explosions = 0;
  let currentCount = diceCount;

  while (currentCount > 0 && explosions < maxExplosions) {
    const roll = rollDice(state, playerId, {
      diceCount: currentCount,
      diceSides,
      purpose: 'exploding'
    });

    if (roll.blocked) return roll;

    allResults.push(...roll.results);

    // Count how many dice "exploded" (rolled max)
    currentCount = roll.results.filter(r => r === diceSides).length;
    if (currentCount > 0) explosions++;
  }

  const total = allResults.reduce((sum, val) => sum + val, 0);

  return {
    results: allResults,
    total
  };
}

/**
 * Count successes (dice meeting or exceeding threshold)
 */
export function countSuccesses(
  state: GameState,
  playerId: string,
  diceCount: number,
  diceSides: number,
  threshold: number
): { successes: number; roll: DiceRollResult } {
  const roll = rollDice(state, playerId, {
    diceCount,
    diceSides,
    purpose: 'count_successes'
  });

  if (roll.blocked) {
    return { successes: 0, roll };
  }

  const successes = roll.results.filter(r => r >= threshold).length;

  return { successes, roll };
}

/**
 * Parse dice notation (e.g., "2d6+3", "3d8-1")
 */
export function parseDiceNotation(notation: string): DiceRollOptions | null {
  const match = notation.match(/^(\d+)d(\d+)([+-]\d+)?$/i);
  if (!match) return null;

  const diceCount = parseInt(match[1], 10);
  const diceSides = parseInt(match[2], 10);
  const modifier = match[3] ? parseInt(match[3], 10) : 0;

  return { diceCount, diceSides, modifier };
}

/**
 * Roll from dice notation string
 */
export function rollFromNotation(
  state: GameState,
  playerId: string,
  notation: string,
  purpose?: string
): DiceRollResult | null {
  const options = parseDiceNotation(notation);
  if (!options) return null;

  return rollDice(state, playerId, { ...options, purpose });
}
