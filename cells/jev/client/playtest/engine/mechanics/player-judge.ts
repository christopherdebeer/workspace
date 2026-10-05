/**
 * Player Judge Mechanic
 *
 * One player judges submissions from other players.
 *
 * Config:
 *   player_judge:
 *     judge_rotation: 'clockwise' | 'winner' | 'random'
 *     submissions_per_player: number
 *     anonymous_submissions: boolean
 *     judge_can_participate: boolean
 */

import { MechanicHooks, HookContext, ValidationResult, ActionExecutionContext, ActionExecutionResult, AvailableAction, TurnStartContext, StateChanges } from './types';
import { GameAction, Card, SubmitForJudgingAction, JudgeSelectAction, PlayerJudgeConfig } from '../types/game';

interface Submission {
  playerId: string;
  cards: Card[];
  index: number;
}

interface JudgingRound {
  judge: string;
  prompt?: string | Card;
  submissions: Submission[];
  submittedPlayers: string[];
  phase: 'submitting' | 'judging' | 'complete';
  winner?: string;
}

function shuffleArray<T>(array: T[]): T[] {
  const result = [...array];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

export const playerJudgeMechanic: MechanicHooks = {
  slug: 'player-judge',
  name: 'Player Judge',
  requires: ['social'],

  configSchema: {
    type: 'object',
    description: 'One player judges submissions from others',
    properties: {
      judge_rotation: {
        type: 'string',
        description: 'How the judge role rotates',
        enum: ['clockwise', 'winner', 'random'],
        default: 'clockwise'
      },
      submissions_per_player: {
        type: 'number',
        description: 'Cards each player submits',
        default: 1
      },
      anonymous_submissions: {
        type: 'boolean',
        description: 'Whether judge sees who submitted what',
        default: true
      },
      judge_can_participate: {
        type: 'boolean',
        description: 'Whether judge also submits',
        default: false
      }
    }
  },

  initPlayerState(): { isJudge: boolean } {
    return { isJudge: false };
  },

  preValidateAction(ctx: HookContext, action: GameAction): ValidationResult | null {
    if (action.type !== 'submit_for_judging' && action.type !== 'judge_select') return null;

    const config = ctx.config.engine_mechanics?.player_judge;
    if (!config) {
      return { valid: false, error: 'Player judge is not enabled.' };
    }

    const round = ctx.state.shared.judgingRound as JudgingRound | undefined;
    if (!round) {
      return { valid: false, error: 'No active judging round.' };
    }

    if (action.type === 'submit_for_judging') {
      if (round.judge === ctx.playerId && config.judge_can_participate !== true) {
        return { valid: false, error: 'The judge cannot submit.' };
      }

      if (round.phase !== 'submitting') {
        return { valid: false, error: 'Submission phase is over.' };
      }

      if (round.submittedPlayers.includes(ctx.playerId)) {
        return { valid: false, error: 'You have already submitted.' };
      }

      const submitAction = action as SubmitForJudgingAction;
      const requiredCount = config.submissions_per_player ?? 1;
      if (submitAction.cardIds.length !== requiredCount) {
        return { valid: false, error: `You must submit exactly ${requiredCount} card(s).` };
      }

      for (const cardId of submitAction.cardIds) {
        if (!ctx.player.hand?.some(c => c.id === cardId)) {
          return { valid: false, error: `Card ${cardId} is not in your hand.` };
        }
      }
    }

    if (action.type === 'judge_select') {
      if (round.judge !== ctx.playerId) {
        return { valid: false, error: 'Only the judge can select a winner.' };
      }

      if (round.phase !== 'judging') {
        return { valid: false, error: 'Not in judging phase.' };
      }

      const judgeAction = action as JudgeSelectAction;
      if (judgeAction.submissionIndex < 0 || judgeAction.submissionIndex >= round.submissions.length) {
        return { valid: false, error: 'Invalid submission index.' };
      }
    }

    return { valid: true };
  },

  onExecuteAction(ctx: ActionExecutionContext): ActionExecutionResult | null {
    const { action, state, playerId } = ctx;
    const config = ctx.config.engine_mechanics?.player_judge;
    if (!config) return null;

    if (action.type === 'submit_for_judging') {
      const submitAction = action as SubmitForJudgingAction;
      const round = state.shared.judgingRound as JudgingRound;

      const submittedCards = submitAction.cardIds
        .map(id => state.players[playerId].hand?.find(c => c.id === id))
        .filter((c): c is Card => c !== undefined);

      const submission: Submission = {
        playerId,
        cards: submittedCards,
        index: round.submissions.length
      };
      round.submissions.push(submission);
      round.submittedPlayers.push(playerId);

      const newHand = state.players[playerId].hand?.filter(
        c => !submitAction.cardIds.includes(c.id ?? '')
      ) ?? [];

      const eligiblePlayers = Object.keys(state.players).filter(pid =>
        state.players[pid].state !== 'eliminated' &&
        (config.judge_can_participate || pid !== round.judge)
      );
      const allSubmitted = eligiblePlayers.every(pid => round.submittedPlayers.includes(pid));

      if (allSubmitted) {
        round.phase = 'judging';
        if (config.anonymous_submissions !== false) {
          round.submissions = shuffleArray([...round.submissions])
            .map((s, i) => ({ ...s, index: i }));
        }
      }

      return {
        handled: true,
        stateChanges: {
          playerStateChanges: {
            [playerId]: { hand: newHand }
          },
          sharedStateChanges: {
            judgingRound: round
          }
        },
        advanceTurn: false,
        checkWin: false,
        logMessage: allSubmitted
          ? `${playerId} submitted. All submissions in - judging begins!`
          : `${playerId} submitted for judging`
      };
    }

    if (action.type === 'judge_select') {
      const judgeAction = action as JudgeSelectAction;
      const round = state.shared.judgingRound as JudgingRound;

      const winningSubmission = round.submissions[judgeAction.submissionIndex];
      round.winner = winningSubmission.playerId;
      round.phase = 'complete';

      const winnerScore = (state.players[winningSubmission.playerId].score ?? 0) + 1;

      return {
        handled: true,
        stateChanges: {
          playerStateChanges: {
            [winningSubmission.playerId]: { score: winnerScore }
          },
          sharedStateChanges: {
            judgingRound: round,
            lastRoundWinner: winningSubmission.playerId
          }
        },
        advanceTurn: true,
        checkWin: true,
        logMessage: `Judge ${playerId} selected ${winningSubmission.playerId}'s submission as the winner!`
      };
    }

    return null;
  },

  onTurnStart(ctx: TurnStartContext): StateChanges | null {
    const config = ctx.config.engine_mechanics?.player_judge;
    if (!config) return null;

    if (!ctx.isNewRound) return null;

    const round = ctx.state.shared.judgingRound as JudgingRound | undefined;
    if (round && round.phase !== 'complete') return null;

    let nextJudge: string;
    const activePlayers = ctx.state.turnOrder.filter(
      pid => ctx.state.players[pid].state !== 'eliminated'
    );

    if (config.judge_rotation === 'winner' && round?.winner) {
      nextJudge = round.winner;
    } else if (config.judge_rotation === 'random') {
      nextJudge = activePlayers[Math.floor(Math.random() * activePlayers.length)];
    } else {
      const prevJudgeIndex = round ? activePlayers.indexOf(round.judge) : -1;
      nextJudge = activePlayers[(prevJudgeIndex + 1) % activePlayers.length];
    }

    const newRound: JudgingRound = {
      judge: nextJudge,
      submissions: [],
      submittedPlayers: [],
      phase: 'submitting'
    };

    return {
      sharedStateChanges: {
        judgingRound: newRound
      },
      playerStateChanges: {
        ...Object.fromEntries(
          activePlayers.map(pid => [pid, { isJudge: pid === nextJudge }])
        )
      }
    };
  },

  getAvailableActions(ctx: HookContext): AvailableAction[] {
    const config = ctx.config.engine_mechanics?.player_judge;
    if (!config) return [];

    const round = ctx.state.shared.judgingRound as JudgingRound | undefined;
    if (!round) return [];

    if (round.phase === 'submitting') {
      const canSubmit = (config.judge_can_participate || round.judge !== ctx.playerId) &&
                        !round.submittedPlayers.includes(ctx.playerId);

      if (canSubmit && ctx.player.hand && ctx.player.hand.length >= (config.submissions_per_player ?? 1)) {
        return [{
          action: {
            type: 'submit_for_judging',
            cardIds: []
          } as SubmitForJudgingAction,
          priority: 90,
          category: 'judge'
        }];
      }
    }

    if (round.phase === 'judging' && round.judge === ctx.playerId) {
      return round.submissions.map((_, index) => ({
        action: {
          type: 'judge_select',
          submissionIndex: index
        } as JudgeSelectAction,
        priority: 95,
        category: 'judge'
      }));
    }

    return [];
  }
};
