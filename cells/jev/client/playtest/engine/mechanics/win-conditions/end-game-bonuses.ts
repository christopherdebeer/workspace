/**
 * End-Game Bonuses Win Condition
 *
 * End-game bonus scoring. On game end (trigger === 'timeout' or 'game_end'),
 * calculates bonus points from configured criteria (e.g. set bonuses, majority
 * bonuses, objective bonuses). Adds them to player score, then checks if this
 * player has the highest score.
 *
 * Config (engine_mechanics.win_end_game_bonuses):
 * ```yaml
 * engine_mechanics:
 *   win_end_game_bonuses:
 *     bonuses:
 *       - type: set_count
 *         name: "Set Bonus"
 *         points: 5
 *         set_type: "gems"
 *       - type: majority
 *         name: "Gold Majority"
 *         points: 10
 *         resource: "gold"
 *       - type: per_resource
 *         name: "Per Silver"
 *         points: 2
 *         resource: "silver"
 *       - type: per_card
 *         name: "Per Treasure"
 *         points: 3
 *         card_type: "treasure"
 *       - type: flat
 *         name: "Completion Bonus"
 *         points: 15
 * ```
 *
 * Hooks used:
 * - onCheckWin: On trigger 'timeout' or 'game_end', apply bonuses to player
 *   scores first (via stateChanges), then check if this player has the highest score.
 */

import {
  MechanicHooks,
  WinCheckContext,
  WinCheckResult
} from '../types';

interface BonusEntry {
  type: 'set_count' | 'majority' | 'per_resource' | 'per_card' | 'flat';
  name: string;
  points: number;
  resource?: string;
  card_type?: string;
  set_type?: string;
}

interface EndGameBonusesConfig {
  bonuses: BonusEntry[];
}

function isEndGameBonusesConfig(config: unknown): config is EndGameBonusesConfig {
  return (
    typeof config === 'object' &&
    config !== null &&
    Array.isArray((config as EndGameBonusesConfig).bonuses)
  );
}

function calculateBonusForPlayer(
  bonus: BonusEntry,
  playerId: string,
  ctx: WinCheckContext
): number {
  const player = ctx.state.players[playerId];
  if (!player) return 0;

  switch (bonus.type) {
    case 'set_count': {
      // Points per completed set of the given type
      const sets = player.collectedSets || [];
      const matchingSets = bonus.set_type
        ? sets.filter(s => s === bonus.set_type)
        : sets;
      return matchingSets.length * bonus.points;
    }

    case 'majority': {
      // Points if this player has the most of the specified resource
      if (!bonus.resource) return 0;
      const myAmount = player.resources?.[bonus.resource] ?? 0;
      let isMajority = true;
      for (const [otherId, otherPlayer] of Object.entries(ctx.state.players)) {
        if (otherId === playerId) continue;
        const otherAmount = otherPlayer.resources?.[bonus.resource] ?? 0;
        if (otherAmount >= myAmount) {
          isMajority = false;
          break;
        }
      }
      return isMajority ? bonus.points : 0;
    }

    case 'per_resource': {
      // Points per unit of the specified resource
      if (!bonus.resource) return 0;
      const amount = player.resources?.[bonus.resource] ?? 0;
      return amount * bonus.points;
    }

    case 'per_card': {
      // Points per card of the specified type in hand
      const hand = player.hand || [];
      const matchingCards = bonus.card_type
        ? hand.filter(c => c.type === bonus.card_type)
        : hand;
      return matchingCards.length * bonus.points;
    }

    case 'flat': {
      // Flat bonus points
      return bonus.points;
    }

    default:
      return 0;
  }
}

export const endGameBonusesMechanic: MechanicHooks = {
  slug: 'win-end-game-bonuses',
  name: 'End-Game Bonuses Win Condition',

  configSchema: {
    type: 'object',
    description: 'End-game bonus scoring with configurable criteria',
    properties: {
      bonuses: {
        type: 'array',
        description: 'Array of bonus scoring criteria',
        required: true
      }
    },
    required: ['bonuses']
  },

  onCheckWin(ctx: WinCheckContext): WinCheckResult | null {
    const config = ctx.config.engine_mechanics?.win_end_game_bonuses;

    // Only handle if this mechanic is configured
    if (!isEndGameBonusesConfig(config)) return null;

    // Only apply on game end triggers
    if (ctx.trigger !== 'timeout' && ctx.trigger !== 'game_end') return null;

    // Calculate total bonus for each player and determine highest score
    let highestTotal = -Infinity;
    let highestPlayerId: string | null = null;

    for (const playerId of ctx.state.turnOrder) {
      const player = ctx.state.players[playerId];
      if (!player) continue;

      const baseScore = player.score ?? 0;
      let bonusTotal = 0;

      for (const bonus of config.bonuses) {
        bonusTotal += calculateBonusForPlayer(bonus, playerId, ctx);
      }

      const totalScore = baseScore + bonusTotal;
      if (totalScore > highestTotal) {
        highestTotal = totalScore;
        highestPlayerId = playerId;
      }
    }

    // Check if the current player is the winner
    if (highestPlayerId === ctx.playerId) {
      const baseScore = ctx.player.score ?? 0;
      let bonusTotal = 0;
      for (const bonus of config.bonuses) {
        bonusTotal += calculateBonusForPlayer(bonus, ctx.playerId, ctx);
      }
      return {
        won: true,
        reason: `${ctx.playerId} wins with ${baseScore} + ${bonusTotal} bonus = ${baseScore + bonusTotal} points`
      };
    }

    return null;
  }
};
