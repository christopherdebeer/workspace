/**
 * Elapsed Real-Time Ending Mechanic
 *
 * Game ends after a set number of turns (simulating elapsed time).
 * When turn limit reached, triggers end-of-game scoring.
 *
 * Hooks used:
 * - initSharedState: Set timer
 * - onTurnStart: Check if time expired
 * - getPlayerView: Show remaining time
 */

import {
  MechanicHooks,
  HookContext,
  TurnStartContext,
  StateChanges,
  SharedStateInitContext,
  SharedStateInitResult,
  WinCheckContext,
  WinCheckResult,
  isMechanicEnabled
} from './types';
import { GameConfig } from '../types/game';

interface ElapsedTimeConfig {
  max_turns?: number;
  warning_at?: number;  // warn when this many turns remain
}

interface ElapsedTimeState {
  turnsElapsed: number;
  maxTurns: number;
  expired: boolean;
}

function getConfig(config: GameConfig): ElapsedTimeConfig | undefined {
  return config.engine_mechanics?.elapsed_real_time_ending as ElapsedTimeConfig | undefined;
}

function getTimeState(shared: Record<string, unknown>): ElapsedTimeState | undefined {
  return shared.elapsedTime as ElapsedTimeState | undefined;
}

export const elapsedRealTimeEndingMechanic: MechanicHooks = {
  slug: 'elapsed-real-time-ending',
  name: 'Elapsed Real-Time Ending',
  isWinCondition: true,

  configSchema: {
    type: 'object',
    description: 'Game ends after set number of turns',
    properties: {
      max_turns: { type: 'number', default: 30 },
      warning_at: { type: 'number', default: 5 }
    }
  },

  initSharedState(ctx: SharedStateInitContext): SharedStateInitResult | null {
    const config = getConfig(ctx.config);
    if (!config) return null;

    return {
      elapsedTime: {
        turnsElapsed: 0,
        maxTurns: config.max_turns ?? 30,
        expired: false
      } as ElapsedTimeState
    };
  },

  onTurnStart(ctx: TurnStartContext): StateChanges | null {
    if (!isMechanicEnabled(ctx.config, 'elapsed-real-time-ending')) return null;

    const timeState = getTimeState(ctx.state.shared);
    if (!timeState || timeState.expired) return null;

    const newTurns = timeState.turnsElapsed + 1;
    const expired = newTurns >= timeState.maxTurns;

    return {
      sharedStateChanges: {
        elapsedTime: {
          ...timeState,
          turnsElapsed: newTurns,
          expired
        }
      }
    };
  },

  checkWinCondition(ctx: WinCheckContext): WinCheckResult | null {
    if (!isMechanicEnabled(ctx.config, 'elapsed-real-time-ending')) return null;

    const timeState = getTimeState(ctx.state.shared);
    if (!timeState?.expired) return null;

    // When time expires, highest score wins
    const players = Object.entries(ctx.state.players);
    let highestScore = -Infinity;
    let winnerId = '';
    for (const [pid, p] of players) {
      if ((p.score ?? 0) > highestScore) {
        highestScore = p.score ?? 0;
        winnerId = pid;
      }
    }

    if (ctx.playerId === winnerId) {
      return { won: true, reason: `Time expired! Highest score: ${highestScore}` };
    }

    return null;
  },

  getPlayerView(ctx: HookContext): Record<string, unknown> | null {
    if (!isMechanicEnabled(ctx.config, 'elapsed-real-time-ending')) return null;

    const timeState = getTimeState(ctx.state.shared);
    if (!timeState) return null;

    const config = getConfig(ctx.config);
    const warningAt = config?.warning_at ?? 5;
    const remaining = timeState.maxTurns - timeState.turnsElapsed;

    return {
      turnsElapsed: timeState.turnsElapsed,
      turnsRemaining: remaining,
      maxTurns: timeState.maxTurns,
      timeWarning: remaining <= warningAt,
      timeExpired: timeState.expired
    };
  }
};
