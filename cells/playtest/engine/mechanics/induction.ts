/**
 * Induction Mechanic
 *
 * One player creates a secret rule; others try to discover it by testing examples.
 * The rule-maker validates examples as matching or not matching the rule.
 *
 * Hooks used:
 * - initSharedState: Create induction game state
 * - getAvailableActions: 'set_rule', 'test_example', 'guess_rule'
 * - onExecuteAction: Handle rule setting, testing, guessing
 * - getPlayerView: Show examples and results
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

interface InductionConfig {
  points_correct_guess?: number;
  points_per_test?: number;
  max_tests?: number;
}

interface TestedExample {
  playerId: string;
  example: string;
  matches: boolean;
}

interface InductionState {
  ruleMaker: string | null;
  secretRule: string | null;
  testedExamples: TestedExample[];
  guesses: Record<string, string>;
  phase: 'setup' | 'testing' | 'guessing' | 'resolved';
}

function getConfig(config: GameConfig): InductionConfig | undefined {
  return config.engine_mechanics?.induction as InductionConfig | undefined;
}

function getInductionState(shared: Record<string, unknown>): InductionState | undefined {
  return shared.induction as InductionState | undefined;
}

export const inductionMechanic: MechanicHooks = {
  slug: 'induction',
  name: 'Induction',

  configSchema: {
    type: 'object',
    description: 'Discover secret rules by testing examples',
    properties: {
      points_correct_guess: { type: 'number', default: 5 },
      points_per_test: { type: 'number', default: -1 },
      max_tests: { type: 'number', default: 10 }
    }
  },

  initSharedState(ctx: SharedStateInitContext): SharedStateInitResult | null {
    const config = getConfig(ctx.config);
    if (!config) return null;

    return {
      induction: {
        ruleMaker: ctx.playerIds[0] ?? null,
        secretRule: null,
        testedExamples: [],
        guesses: {},
        phase: 'setup'
      } as InductionState
    };
  },

  getAvailableActions(ctx: HookContext): AvailableAction[] {
    if (!isMechanicEnabled(ctx.config, 'induction')) return [];

    const iState = getInductionState(ctx.state.shared);
    if (!iState) return [];

    const actions: AvailableAction[] = [];

    if (iState.phase === 'setup' && ctx.playerId === iState.ruleMaker) {
      actions.push({
        action: { type: 'set_rule', rule: '' } as unknown as GameAction,
        priority: 95,
        category: 'induction'
      });
    }

    if (iState.phase === 'testing' && ctx.playerId !== iState.ruleMaker) {
      const config = getConfig(ctx.config);
      const maxTests = config?.max_tests ?? 10;
      if (iState.testedExamples.length < maxTests) {
        actions.push({
          action: { type: 'test_example', example: '' } as unknown as GameAction,
          priority: 80,
          category: 'induction'
        });
      }
      actions.push({
        action: { type: 'guess_rule', guess: '' } as unknown as GameAction,
        priority: 75,
        category: 'induction'
      });
    }

    if (iState.phase === 'testing' && ctx.playerId === iState.ruleMaker) {
      // Rule maker validates pending examples
      const pending = iState.testedExamples.filter(e => e.matches === undefined);
      if (pending.length > 0) {
        actions.push({
          action: { type: 'validate_example', exampleIndex: 0, matches: true } as unknown as GameAction,
          priority: 90,
          category: 'induction'
        });
      }
    }

    return actions;
  },

  onExecuteAction(ctx: ActionExecutionContext): ActionExecutionResult | null {
    const validTypes = ['set_rule', 'test_example', 'guess_rule', 'validate_example'];
    if (!validTypes.includes(ctx.action.type as string)) return null;

    const config = getConfig(ctx.config);
    if (!config) return null;

    const iState = getInductionState(ctx.state.shared);
    if (!iState) return null;

    if (ctx.action.type === 'set_rule') {
      const ruleAction = ctx.action as unknown as { type: 'set_rule'; rule: string };
      return {
        handled: true,
        stateChanges: {
          sharedStateChanges: {
            induction: { ...iState, secretRule: ruleAction.rule, phase: 'testing' }
          }
        },
        advanceTurn: true,
        checkWin: false,
        logMessage: `Rule maker has set the secret rule.`,
        logData: { player: ctx.playerId }
      };
    }

    if (ctx.action.type === 'test_example') {
      const testAction = ctx.action as unknown as { type: 'test_example'; example: string };
      const pointsCost = config.points_per_test ?? -1;

      return {
        handled: true,
        stateChanges: {
          sharedStateChanges: {
            induction: {
              ...iState,
              testedExamples: [...iState.testedExamples, {
                playerId: ctx.playerId,
                example: testAction.example,
                matches: false // rule maker will validate
              }]
            }
          },
          playerStateChanges: pointsCost !== 0 ? {
            [ctx.playerId]: { score: (ctx.player.score ?? 0) + pointsCost }
          } : undefined
        },
        advanceTurn: false,
        checkWin: false,
        logMessage: `${ctx.playerId} tested an example.`,
        logData: { player: ctx.playerId, example: testAction.example }
      };
    }

    if (ctx.action.type === 'validate_example') {
      const valAction = ctx.action as unknown as { type: 'validate_example'; exampleIndex: number; matches: boolean };
      const updatedExamples = [...iState.testedExamples];
      if (valAction.exampleIndex < updatedExamples.length) {
        updatedExamples[valAction.exampleIndex] = {
          ...updatedExamples[valAction.exampleIndex],
          matches: valAction.matches
        };
      }

      return {
        handled: true,
        stateChanges: {
          sharedStateChanges: {
            induction: { ...iState, testedExamples: updatedExamples }
          }
        },
        advanceTurn: false,
        checkWin: false,
        logMessage: `Rule maker validated example: ${valAction.matches ? 'matches' : 'does not match'}.`,
        logData: { matches: valAction.matches }
      };
    }

    if (ctx.action.type === 'guess_rule') {
      const guessAction = ctx.action as unknown as { type: 'guess_rule'; guess: string };
      const pointsCorrect = config.points_correct_guess ?? 5;

      return {
        handled: true,
        stateChanges: {
          sharedStateChanges: {
            induction: {
              ...iState,
              guesses: { ...iState.guesses, [ctx.playerId]: guessAction.guess },
              phase: 'resolved'
            }
          },
          playerStateChanges: {
            [ctx.playerId]: { score: (ctx.player.score ?? 0) + pointsCorrect }
          }
        },
        advanceTurn: true,
        checkWin: true,
        logMessage: `${ctx.playerId} guessed the rule!`,
        logData: { player: ctx.playerId, guess: guessAction.guess }
      };
    }

    return null;
  },

  getPlayerView(ctx: HookContext): Record<string, unknown> | null {
    if (!isMechanicEnabled(ctx.config, 'induction')) return null;

    const iState = getInductionState(ctx.state.shared);
    if (!iState) return null;

    return {
      inductionPhase: iState.phase,
      isRuleMaker: ctx.playerId === iState.ruleMaker,
      testedExamples: iState.testedExamples,
      secretRule: ctx.playerId === iState.ruleMaker ? iState.secretRule : null
    };
  }
};
