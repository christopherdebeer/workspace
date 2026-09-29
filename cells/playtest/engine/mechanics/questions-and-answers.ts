/**
 * Questions and Answers Mechanic
 *
 * Players ask yes/no questions to deduce hidden information.
 * The answerer must respond truthfully within defined constraints.
 *
 * Hooks used:
 * - initSharedState: Create Q&A state
 * - getAvailableActions: 'ask_question', 'answer_question'
 * - onExecuteAction: Process questions and answers
 * - getPlayerView: Show question history
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

interface QAConfig {
  max_questions?: number;
  points_correct_answer?: number;
}

interface QAEntry {
  askerId: string;
  question: string;
  answer: 'yes' | 'no' | null;
  answeredBy: string | null;
}

interface QAState {
  questions: QAEntry[];
  phase: 'asking' | 'answering' | 'resolved';
  targetPlayerId: string | null;
}

function getConfig(config: GameConfig): QAConfig | undefined {
  return config.engine_mechanics?.questions_and_answers as QAConfig | undefined;
}

function getQAState(shared: Record<string, unknown>): QAState | undefined {
  return shared.questionsAndAnswers as QAState | undefined;
}

export const questionsAndAnswersMechanic: MechanicHooks = {
  slug: 'questions-and-answers',
  name: 'Questions and Answers',

  configSchema: {
    type: 'object',
    description: 'Ask yes/no questions to deduce hidden information',
    properties: {
      max_questions: { type: 'number', default: 20 },
      points_correct_answer: { type: 'number', default: 5 }
    }
  },

  initSharedState(ctx: SharedStateInitContext): SharedStateInitResult | null {
    const config = getConfig(ctx.config);
    if (!config) return null;

    return {
      questionsAndAnswers: {
        questions: [],
        phase: 'asking',
        targetPlayerId: ctx.playerIds.length > 1 ? ctx.playerIds[1] : null
      } as QAState
    };
  },

  getAvailableActions(ctx: HookContext): AvailableAction[] {
    if (!isMechanicEnabled(ctx.config, 'questions-and-answers')) return [];

    const qaState = getQAState(ctx.state.shared);
    if (!qaState || qaState.phase === 'resolved') return [];

    const config = getConfig(ctx.config);
    const maxQ = config?.max_questions ?? 20;
    const actions: AvailableAction[] = [];

    if (qaState.phase === 'asking' && ctx.playerId !== qaState.targetPlayerId) {
      if (qaState.questions.length < maxQ) {
        actions.push({
          action: { type: 'ask_question', question: '' } as unknown as GameAction,
          priority: 85,
          category: 'qa'
        });
      }
      actions.push({
        action: { type: 'final_answer', answer: '' } as unknown as GameAction,
        priority: 80,
        category: 'qa'
      });
    }

    if (qaState.phase === 'answering' && ctx.playerId === qaState.targetPlayerId) {
      actions.push({
        action: { type: 'answer_question', answer: 'yes' } as unknown as GameAction,
        priority: 90,
        category: 'qa'
      });
      actions.push({
        action: { type: 'answer_question', answer: 'no' } as unknown as GameAction,
        priority: 90,
        category: 'qa'
      });
    }

    return actions;
  },

  onExecuteAction(ctx: ActionExecutionContext): ActionExecutionResult | null {
    const validTypes = ['ask_question', 'answer_question', 'final_answer'];
    if (!validTypes.includes(ctx.action.type as string)) return null;

    const config = getConfig(ctx.config);
    if (!config) return null;

    const qaState = getQAState(ctx.state.shared);
    if (!qaState) return null;

    if (ctx.action.type === 'ask_question') {
      const askAction = ctx.action as unknown as { type: 'ask_question'; question: string };

      const newEntry: QAEntry = {
        askerId: ctx.playerId,
        question: askAction.question,
        answer: null,
        answeredBy: null
      };

      return {
        handled: true,
        stateChanges: {
          sharedStateChanges: {
            questionsAndAnswers: {
              ...qaState,
              questions: [...qaState.questions, newEntry],
              phase: 'answering'
            }
          }
        },
        advanceTurn: true,
        checkWin: false,
        logMessage: `${ctx.playerId} asked: "${askAction.question}"`,
        logData: { player: ctx.playerId, questionCount: qaState.questions.length + 1 }
      };
    }

    if (ctx.action.type === 'answer_question') {
      const ansAction = ctx.action as unknown as { type: 'answer_question'; answer: 'yes' | 'no' };
      const questions = [...qaState.questions];
      const lastQ = questions[questions.length - 1];
      if (lastQ) {
        questions[questions.length - 1] = {
          ...lastQ,
          answer: ansAction.answer,
          answeredBy: ctx.playerId
        };
      }

      return {
        handled: true,
        stateChanges: {
          sharedStateChanges: {
            questionsAndAnswers: { ...qaState, questions, phase: 'asking' }
          }
        },
        advanceTurn: true,
        checkWin: false,
        logMessage: `${ctx.playerId} answered: ${ansAction.answer}`,
        logData: { player: ctx.playerId, answer: ansAction.answer }
      };
    }

    if (ctx.action.type === 'final_answer') {
      const finalAction = ctx.action as unknown as { type: 'final_answer'; answer: string };
      const points = config.points_correct_answer ?? 5;

      return {
        handled: true,
        stateChanges: {
          sharedStateChanges: {
            questionsAndAnswers: { ...qaState, phase: 'resolved' }
          },
          playerStateChanges: {
            [ctx.playerId]: { score: (ctx.player.score ?? 0) + points }
          }
        },
        advanceTurn: true,
        checkWin: true,
        logMessage: `${ctx.playerId} gave their final answer: "${finalAction.answer}"`,
        logData: { player: ctx.playerId, answer: finalAction.answer, questionsUsed: qaState.questions.length }
      };
    }

    return null;
  },

  getPlayerView(ctx: HookContext): Record<string, unknown> | null {
    if (!isMechanicEnabled(ctx.config, 'questions-and-answers')) return null;

    const qaState = getQAState(ctx.state.shared);
    if (!qaState) return null;

    return {
      qaPhase: qaState.phase,
      questionHistory: qaState.questions.map(q => ({
        question: q.question,
        answer: q.answer,
        askedBy: q.askerId
      })),
      questionsAsked: qaState.questions.length,
      isAnswerer: ctx.playerId === qaState.targetPlayerId
    };
  }
};
