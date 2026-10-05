/**
 * Prisoner's Dilemma Mechanic
 *
 * Simultaneous secret choice between cooperate/defect with payoff matrix.
 * Classic game theory mechanic for trust and betrayal dynamics.
 *
 * Hooks used:
 * - initSharedState: Create dilemma rounds
 * - canPlayerActNow: Allow simultaneous choices
 * - getAvailableActions: 'dilemma_choice' (cooperate/defect)
 * - onExecuteAction: Record choices, resolve when all submitted
 * - getPlayerView: Show results after resolution
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

interface PayoffMatrix {
  both_cooperate: number;      // reward for mutual cooperation
  both_defect: number;         // punishment for mutual defection
  cooperate_vs_defect: number; // sucker's payoff
  defect_vs_cooperate: number; // temptation payoff
}

interface DilemmaConfig {
  payoff?: PayoffMatrix;
  rounds?: number;
}

interface DilemmaState {
  round: number;
  maxRounds: number;
  choices: Record<string, 'cooperate' | 'defect'>;  // current round
  history: Array<{
    round: number;
    choices: Record<string, 'cooperate' | 'defect'>;
    scores: Record<string, number>;
  }>;
  resolved: boolean;
}

function getConfig(config: GameConfig): DilemmaConfig | undefined {
  return config.engine_mechanics?.prisoners_dilemma as DilemmaConfig | undefined;
}

function getDilemmaState(shared: Record<string, unknown>): DilemmaState | undefined {
  return shared.prisonersDilemma as DilemmaState | undefined;
}

const DEFAULT_PAYOFF: PayoffMatrix = {
  both_cooperate: 3,
  both_defect: 1,
  cooperate_vs_defect: 0,
  defect_vs_cooperate: 5
};

export const prisonersDilemmaMechanic: MechanicHooks = {
  slug: 'prisoners-dilemma',
  name: "Prisoner's Dilemma",
  requires: ['social'],

  configSchema: {
    type: 'object',
    description: 'Simultaneous cooperate/defect choices with payoff matrix',
    properties: {
      payoff: {
        type: 'object',
        description: 'Payoff matrix values'
      },
      rounds: {
        type: 'number',
        description: 'Number of dilemma rounds',
        default: 5
      }
    }
  },

  initSharedState(ctx: SharedStateInitContext): SharedStateInitResult | null {
    const config = getConfig(ctx.config);
    if (!config) return null;

    return {
      prisonersDilemma: {
        round: 1,
        maxRounds: config.rounds ?? 5,
        choices: {},
        history: [],
        resolved: false
      } as DilemmaState
    };
  },

  canPlayerActNow(ctx: HookContext): boolean | null {
    if (!isMechanicEnabled(ctx.config, 'prisoners-dilemma')) return null;

    const dState = getDilemmaState(ctx.state.shared);
    if (!dState || dState.resolved) return null;

    // Allow simultaneous choices - everyone can act if they haven't chosen
    if (!dState.choices[ctx.playerId]) return true;

    return null;
  },

  getAvailableActions(ctx: HookContext): AvailableAction[] {
    if (!isMechanicEnabled(ctx.config, 'prisoners-dilemma')) return [];

    const dState = getDilemmaState(ctx.state.shared);
    if (!dState || dState.resolved) return [];
    if (dState.choices[ctx.playerId]) return [];

    return [
      {
        action: { type: 'dilemma_choice', choice: 'cooperate' } as unknown as GameAction,
        priority: 95,
        category: 'dilemma'
      },
      {
        action: { type: 'dilemma_choice', choice: 'defect' } as unknown as GameAction,
        priority: 95,
        category: 'dilemma'
      }
    ];
  },

  onExecuteAction(ctx: ActionExecutionContext): ActionExecutionResult | null {
    if (ctx.action.type !== 'dilemma_choice') return null;

    const config = getConfig(ctx.config);
    if (!config) return null;

    const dState = getDilemmaState(ctx.state.shared);
    if (!dState) return null;

    const choiceAction = ctx.action as unknown as { type: 'dilemma_choice'; choice: 'cooperate' | 'defect' };
    const updatedChoices = { ...dState.choices, [ctx.playerId]: choiceAction.choice };
    const allPlayers = Object.keys(ctx.state.players);
    const allChosen = allPlayers.every(p => updatedChoices[p] !== undefined);

    if (!allChosen) {
      // Advance turn only when the currentPlayer submits (moves to next player).
      // Out-of-turn submissions (via canPlayerActNow) don't disturb turn order.
      const isCurrentPlayer = ctx.playerId === ctx.state.currentPlayer;
      return {
        handled: true,
        stateChanges: {
          sharedStateChanges: {
            prisonersDilemma: { ...dState, choices: updatedChoices }
          }
        },
        advanceTurn: true,
        checkWin: false,
        logMessage: `${ctx.playerId} has made their choice.`,
        logData: { player: ctx.playerId, waiting: allPlayers.filter(p => !updatedChoices[p]).length }
      };
    }

    // Resolve round - calculate payoffs
    const payoff = config.payoff ?? DEFAULT_PAYOFF;
    const roundScores: Record<string, number> = {};
    const playerIds = Object.keys(updatedChoices);

    // Pairwise scoring for all player pairs
    for (const p of playerIds) {
      roundScores[p] = 0;
      for (const q of playerIds) {
        if (p === q) continue;
        const pChoice = updatedChoices[p];
        const qChoice = updatedChoices[q];
        if (pChoice === 'cooperate' && qChoice === 'cooperate') {
          roundScores[p] += payoff.both_cooperate;
        } else if (pChoice === 'defect' && qChoice === 'defect') {
          roundScores[p] += payoff.both_defect;
        } else if (pChoice === 'cooperate' && qChoice === 'defect') {
          roundScores[p] += payoff.cooperate_vs_defect;
        } else {
          roundScores[p] += payoff.defect_vs_cooperate;
        }
      }
    }

    const historyEntry = { round: dState.round, choices: updatedChoices, scores: roundScores };
    const newRound = dState.round + 1;
    const maxRounds = dState.maxRounds;
    const gameOver = newRound > maxRounds;

    // Apply scores
    const playerStateChanges: Record<string, { score: number }> = {};
    for (const [pid, pts] of Object.entries(roundScores)) {
      playerStateChanges[pid] = { score: (ctx.state.players[pid]?.score ?? 0) + pts };
    }

    return {
      handled: true,
      stateChanges: {
        sharedStateChanges: {
          prisonersDilemma: {
            round: newRound,
            maxRounds,
            choices: {},
            history: [...dState.history, historyEntry],
            resolved: gameOver
          }
        },
        playerStateChanges
      },
      advanceTurn: true,
      checkWin: gameOver,
      logMessage: `Round ${dState.round} resolved! ${Object.entries(updatedChoices).map(([p, c]) => `${p}:${c}`).join(', ')}`,
      logData: { round: dState.round, choices: updatedChoices, scores: roundScores, gameOver }
    };
  },

  getPlayerView(ctx: HookContext): Record<string, unknown> | null {
    if (!isMechanicEnabled(ctx.config, 'prisoners-dilemma')) return null;

    const dState = getDilemmaState(ctx.state.shared);
    if (!dState) return null;

    return {
      dilemmaRound: dState.round,
      maxRounds: dState.maxRounds,
      hasChosen: !!dState.choices[ctx.playerId],
      playersChosen: Object.keys(dState.choices).length,
      history: dState.history,
      resolved: dState.resolved
    };
  }
};
