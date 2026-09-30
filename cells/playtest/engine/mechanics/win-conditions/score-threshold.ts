/**
 * Score Threshold Win Condition
 *
 * Win by reaching a score threshold.
 *
 * Config (engine_mechanics.win_score_threshold):
 * ```yaml
 * engine_mechanics:
 *   win_score_threshold:
 *     threshold: 100
 *     operator: ">="  # Optional, defaults to ">="
 * ```
 *
 * Supported operators: ">=", ">", "==", "="
 *
 * Can be composed with other win conditions.
 *
 * Hooks used:
 * - onCheckWin: Check if player score meets threshold
 */

import {
  MechanicHooks,
  WinCheckContext,
  WinCheckResult
} from '../types';

type ScoreOperator = '>=' | '>' | '==' | '=';

interface ScoreThresholdConfig {
  threshold: number;
  operator?: ScoreOperator;
}

function isScoreThresholdConfig(config: unknown): config is ScoreThresholdConfig {
  return (
    typeof config === 'object' &&
    config !== null &&
    typeof (config as ScoreThresholdConfig).threshold === 'number'
  );
}

function evaluateCondition(score: number, threshold: number, operator: ScoreOperator): boolean {
  switch (operator) {
    case '>=': return score >= threshold;
    case '>': return score > threshold;
    case '==':
    case '=': return score === threshold;
  }
}

export const scoreThresholdWinMechanic: MechanicHooks = {
  slug: 'win-score-threshold',
  name: 'Score Threshold Win Condition',

  // Config schema for validation and documentation
  configSchema: {
    type: 'object',
    description: 'Win by reaching a score threshold',
    properties: {
      threshold: {
        type: 'number',
        description: 'Score threshold to reach',
        required: true
      },
      operator: {
        type: 'string',
        description: 'Comparison operator',
        enum: ['>=', '>', '==', '='],
        default: '>='
      }
    },
    required: ['threshold']
  },

  onCheckWin(ctx: WinCheckContext): WinCheckResult | null {
    const winConfig = ctx.config.engine_mechanics?.win_score_threshold;

    // Only handle if this mechanic is configured
    if (!isScoreThresholdConfig(winConfig)) return null;

    // Check if player has a score
    if (ctx.player.score === undefined) return null;

    const operator = winConfig.operator || '>=';

    // Check if score meets threshold
    if (evaluateCondition(ctx.player.score, winConfig.threshold, operator)) {
      return {
        won: true,
        reason: `${ctx.playerId} reached score ${ctx.player.score}`
      };
    }

    return null;
  }
};
