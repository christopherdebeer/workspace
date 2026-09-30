/**
 * Acting Mechanic
 *
 * Players perform or describe actions non-verbally (charades-style).
 * Other players guess. Correct guesses score points for both actor and guesser.
 *
 * Hooks used:
 * - initSharedState: Create acting state
 * - getAvailableActions: 'perform' and 'guess' actions
 * - onExecuteAction: Handle performances and guesses
 * - getPlayerView: Show current performance info
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

interface ActingConfig {
  points_actor?: number;       // points for actor on correct guess
  points_guesser?: number;     // points for correct guesser
  max_guesses?: number;        // max guesses per performance
}

interface ActingState {
  phase: 'performing' | 'guessing' | 'idle';
  currentActor: string | null;
  currentPrompt: string | null;
  guesses: Record<string, string>;   // guesserId -> guess text
  correctGuesserId: string | null;
  performanceCount: number;
}

function getConfig(config: GameConfig): ActingConfig | undefined {
  return config.engine_mechanics?.acting as ActingConfig | undefined;
}

function getActingState(shared: Record<string, unknown>): ActingState | undefined {
  return shared.acting as ActingState | undefined;
}

export const actingMechanic: MechanicHooks = {
  slug: 'acting',
  name: 'Acting',
  requires: ['social'],

  configSchema: {
    type: 'object',
    description: 'Charades-style acting with guessing',
    properties: {
      points_actor: { type: 'number', description: 'Points for actor on correct guess', default: 2 },
      points_guesser: { type: 'number', description: 'Points for correct guesser', default: 3 },
      max_guesses: { type: 'number', description: 'Max guesses per performance', default: 5 }
    }
  },

  initSharedState(ctx: SharedStateInitContext): SharedStateInitResult | null {
    const config = getConfig(ctx.config);
    if (!config) return null;

    return {
      acting: {
        phase: 'performing',
        currentActor: ctx.playerIds[0] ?? null,
        currentPrompt: null,
        guesses: {},
        correctGuesserId: null,
        performanceCount: 0
      } as ActingState
    };
  },

  getAvailableActions(ctx: HookContext): AvailableAction[] {
    if (!isMechanicEnabled(ctx.config, 'acting')) return [];

    const actState = getActingState(ctx.state.shared);
    if (!actState) return [];

    const actions: AvailableAction[] = [];

    if (actState.phase === 'performing' && ctx.playerId === actState.currentActor) {
      actions.push({
        action: {
          type: 'perform',
          description: ''
        } as unknown as GameAction,
        priority: 90,
        category: 'acting'
      });
    }

    if (actState.phase === 'guessing' && ctx.playerId !== actState.currentActor) {
      if (!actState.guesses[ctx.playerId]) {
        actions.push({
          action: {
            type: 'guess',
            guess: ''
          } as unknown as GameAction,
          priority: 85,
          category: 'acting'
        });
      }
    }

    return actions;
  },

  onExecuteAction(ctx: ActionExecutionContext): ActionExecutionResult | null {
    if (ctx.action.type !== 'perform' && ctx.action.type !== 'guess') return null;

    const config = getConfig(ctx.config);
    if (!config) return null;

    const actState = getActingState(ctx.state.shared);
    if (!actState) return null;

    if (ctx.action.type === 'perform') {
      const performAction = ctx.action as unknown as { type: 'perform'; description: string };

      return {
        handled: true,
        stateChanges: {
          sharedStateChanges: {
            acting: {
              ...actState,
              phase: 'guessing' as const,
              currentPrompt: performAction.description,
              guesses: {},
              correctGuesserId: null
            }
          }
        },
        advanceTurn: false,
        checkWin: false,
        logMessage: `${ctx.playerId} is performing!`,
        logData: { player: ctx.playerId, phase: 'guessing' }
      };
    }

    // guess action
    const guessAction = ctx.action as unknown as { type: 'guess'; guess: string };
    const updatedGuesses = { ...actState.guesses, [ctx.playerId]: guessAction.guess };
    const maxGuesses = config.max_guesses ?? 5;
    const guessCount = Object.keys(updatedGuesses).length;
    const roundOver = guessCount >= maxGuesses ||
      guessCount >= Object.keys(ctx.state.players).length - 1;

    // Rotate actor on round end
    const turnOrder = ctx.state.turnOrder;
    const currentActorIndex = turnOrder.indexOf(actState.currentActor ?? '');
    const nextActor = turnOrder[(currentActorIndex + 1) % turnOrder.length];

    const updatedState: ActingState = {
      ...actState,
      guesses: updatedGuesses,
      phase: roundOver ? 'performing' : 'guessing',
      currentActor: roundOver ? nextActor : actState.currentActor,
      currentPrompt: roundOver ? null : actState.currentPrompt,
      performanceCount: roundOver ? actState.performanceCount + 1 : actState.performanceCount
    };

    return {
      handled: true,
      stateChanges: {
        sharedStateChanges: { acting: updatedState }
      },
      advanceTurn: roundOver,
      checkWin: roundOver,
      logMessage: roundOver
        ? `Guessing complete. Next actor: ${nextActor}`
        : `${ctx.playerId} made a guess.`,
      logData: { player: ctx.playerId, guessCount, roundOver }
    };
  },

  getPlayerView(ctx: HookContext): Record<string, unknown> | null {
    if (!isMechanicEnabled(ctx.config, 'acting')) return null;

    const actState = getActingState(ctx.state.shared);
    if (!actState) return null;

    return {
      actingPhase: actState.phase,
      currentActor: actState.currentActor,
      isActor: ctx.playerId === actState.currentActor,
      guessCount: Object.keys(actState.guesses).length,
      hasGuessed: !!actState.guesses[ctx.playerId]
    };
  }
};
