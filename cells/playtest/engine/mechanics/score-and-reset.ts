/**
 * Score and Reset Game Mechanic
 *
 * Multi-round play with score tallying and state reset between rounds.
 * Total score across rounds determines winner.
 *
 * Hooks used:
 * - initSharedState: Create round tracking
 * - getAvailableActions: 'end_round' when conditions met
 * - onExecuteAction: Score round and reset
 * - getPlayerView: Show round info
 */

import {
  MechanicHooks,
  HookContext,
  ActionExecutionContext,
  ActionExecutionResult,
  AvailableAction,
  SharedStateInitContext,
  SharedStateInitResult,
  isMechanicEnabled
} from './types';
import { GameAction, GameConfig } from '../types/game';

interface ScoreResetConfig {
  total_rounds?: number;
  bonus_per_round_win?: number;
}

interface RoundResult {
  round: number;
  scores: Record<string, number>;
  winner: string;
}

interface ScoreResetState {
  currentRound: number;
  totalRounds: number;
  roundHistory: RoundResult[];
  cumulativeScores: Record<string, number>;
}

function getConfig(config: GameConfig): ScoreResetConfig | undefined {
  return config.engine_mechanics?.score_and_reset_game as ScoreResetConfig | undefined;
}

function getResetState(shared: Record<string, unknown>): ScoreResetState | undefined {
  return shared.scoreAndReset as ScoreResetState | undefined;
}

export const scoreAndResetMechanic: MechanicHooks = {
  slug: 'score-and-reset-game',
  name: 'Score and Reset Game',

  configSchema: {
    type: 'object',
    description: 'Multi-round play with scoring between rounds',
    properties: {
      total_rounds: { type: 'number', default: 3 },
      bonus_per_round_win: { type: 'number', default: 5 }
    }
  },

  initSharedState(ctx: SharedStateInitContext): SharedStateInitResult | null {
    const config = getConfig(ctx.config);
    if (!config) return null;

    const cumulativeScores: Record<string, number> = {};
    for (const pid of ctx.playerIds) {
      cumulativeScores[pid] = 0;
    }

    return {
      scoreAndReset: {
        currentRound: 1,
        totalRounds: config.total_rounds ?? 3,
        roundHistory: [],
        cumulativeScores
      } as ScoreResetState
    };
  },

  getAvailableActions(ctx: HookContext): AvailableAction[] {
    if (!isMechanicEnabled(ctx.config, 'score-and-reset-game')) return [];

    return [{
      action: { type: 'end_round' } as unknown as GameAction,
      priority: 30,
      category: 'scoring'
    }];
  },

  onExecuteAction(ctx: ActionExecutionContext): ActionExecutionResult | null {
    if (ctx.action.type !== 'end_round') return null;

    const config = getConfig(ctx.config);
    if (!config) return null;

    const resetState = getResetState(ctx.state.shared);
    if (!resetState) return null;

    // Tally round scores
    const roundScores: Record<string, number> = {};
    let roundWinner = '';
    let highestScore = -Infinity;

    for (const [pid, player] of Object.entries(ctx.state.players)) {
      roundScores[pid] = player.score ?? 0;
      if ((player.score ?? 0) > highestScore) {
        highestScore = player.score ?? 0;
        roundWinner = pid;
      }
    }

    const bonus = config.bonus_per_round_win ?? 5;
    const roundResult: RoundResult = {
      round: resetState.currentRound,
      scores: roundScores,
      winner: roundWinner
    };

    // Update cumulative scores
    const updatedCumulative = { ...resetState.cumulativeScores };
    for (const [pid, score] of Object.entries(roundScores)) {
      updatedCumulative[pid] = (updatedCumulative[pid] ?? 0) + score;
    }
    updatedCumulative[roundWinner] = (updatedCumulative[roundWinner] ?? 0) + bonus;

    const nextRound = resetState.currentRound + 1;
    const gameOver = nextRound > resetState.totalRounds;

    // Reset player scores for next round
    const playerChanges: Record<string, { score: number }> = {};
    for (const pid of Object.keys(ctx.state.players)) {
      playerChanges[pid] = {
        score: gameOver ? (updatedCumulative[pid] ?? 0) : 0
      };
    }

    return {
      handled: true,
      stateChanges: {
        sharedStateChanges: {
          scoreAndReset: {
            ...resetState,
            currentRound: nextRound,
            roundHistory: [...resetState.roundHistory, roundResult],
            cumulativeScores: updatedCumulative
          }
        },
        playerStateChanges: playerChanges
      },
      advanceTurn: true,
      checkWin: gameOver,
      logMessage: gameOver
        ? `Final round complete! Game over.`
        : `Round ${resetState.currentRound} complete! ${roundWinner} wins the round (+${bonus} bonus). Starting round ${nextRound}.`,
      logData: { round: resetState.currentRound, winner: roundWinner, scores: roundScores, gameOver }
    };
  },

  getPlayerView(ctx: HookContext): Record<string, unknown> | null {
    if (!isMechanicEnabled(ctx.config, 'score-and-reset-game')) return null;

    const resetState = getResetState(ctx.state.shared);
    if (!resetState) return null;

    return {
      currentRound: resetState.currentRound,
      totalRounds: resetState.totalRounds,
      cumulativeScore: resetState.cumulativeScores[ctx.playerId] ?? 0,
      roundHistory: resetState.roundHistory
    };
  }
};
