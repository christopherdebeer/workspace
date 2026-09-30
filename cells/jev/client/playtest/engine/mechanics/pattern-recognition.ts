/**
 * Pattern Recognition Mechanic
 *
 * Players identify matching patterns among visible game elements.
 * First to identify a valid pattern scores points.
 *
 * Hooks used:
 * - initSharedState: Generate patterns
 * - getAvailableActions: 'identify_pattern'
 * - onExecuteAction: Validate pattern identification
 * - getPlayerView: Show visible elements
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

interface PatternRecognitionConfig {
  points_per_match?: number;
  penalty_wrong?: number;
  pattern_size?: number;
}

interface PatternState {
  visibleElements: string[];
  foundPatterns: Array<{ playerId: string; elements: number[]; round: number }>;
  round: number;
}

function getConfig(config: GameConfig): PatternRecognitionConfig | undefined {
  return config.engine_mechanics?.pattern_recognition as PatternRecognitionConfig | undefined;
}

function getPatternState(shared: Record<string, unknown>): PatternState | undefined {
  return shared.patternRecognition as PatternState | undefined;
}

export const patternRecognitionMechanic: MechanicHooks = {
  slug: 'pattern-recognition',
  name: 'Pattern Recognition',

  configSchema: {
    type: 'object',
    description: 'Identify matching patterns among visible elements',
    properties: {
      points_per_match: { type: 'number', default: 3 },
      penalty_wrong: { type: 'number', default: -1 },
      pattern_size: { type: 'number', default: 3 }
    }
  },

  initSharedState(ctx: SharedStateInitContext): SharedStateInitResult | null {
    const config = getConfig(ctx.config);
    if (!config) return null;

    // Generate initial visible elements
    const shapes = ['circle', 'square', 'triangle', 'diamond'];
    const colors = ['red', 'blue', 'green', 'yellow'];
    const elements: string[] = [];
    for (let i = 0; i < 12; i++) {
      elements.push(`${colors[i % colors.length]}-${shapes[Math.floor(i / colors.length) % shapes.length]}`);
    }

    return {
      patternRecognition: {
        visibleElements: elements,
        foundPatterns: [],
        round: 1
      } as PatternState
    };
  },

  getAvailableActions(ctx: HookContext): AvailableAction[] {
    if (!isMechanicEnabled(ctx.config, 'pattern-recognition')) return [];

    const pState = getPatternState(ctx.state.shared);
    if (!pState) return [];

    return [{
      action: {
        type: 'identify_pattern',
        elementIndices: []
      } as unknown as GameAction,
      priority: 80,
      category: 'pattern-recognition'
    }];
  },

  onExecuteAction(ctx: ActionExecutionContext): ActionExecutionResult | null {
    if (ctx.action.type !== 'identify_pattern') return null;

    const config = getConfig(ctx.config);
    if (!config) return null;

    const pState = getPatternState(ctx.state.shared);
    if (!pState) return null;

    const idAction = ctx.action as unknown as { type: 'identify_pattern'; elementIndices: number[] };
    const patternSize = config.pattern_size ?? 3;
    const indices = idAction.elementIndices ?? [];

    if (indices.length !== patternSize) {
      return {
        handled: true,
        logMessage: `Pattern must contain exactly ${patternSize} elements.`,
        advanceTurn: false,
        checkWin: false
      };
    }

    // Check if all indices are valid
    const validIndices = indices.every(i => i >= 0 && i < pState.visibleElements.length);
    if (!validIndices) {
      const penalty = config.penalty_wrong ?? -1;
      return {
        handled: true,
        stateChanges: penalty !== 0 ? {
          playerStateChanges: {
            [ctx.playerId]: { score: (ctx.player.score ?? 0) + penalty }
          }
        } : undefined,
        advanceTurn: false,
        checkWin: false,
        logMessage: `Invalid element indices.`,
        logData: { player: ctx.playerId }
      };
    }

    // Check for shared attribute (color or shape)
    const selected = indices.map(i => pState.visibleElements[i]);
    const colors = selected.map(e => e.split('-')[0]);
    const shapes = selected.map(e => e.split('-')[1]);
    const sameColor = colors.every(c => c === colors[0]);
    const sameShape = shapes.every(s => s === shapes[0]);

    if (!sameColor && !sameShape) {
      const penalty = config.penalty_wrong ?? -1;
      return {
        handled: true,
        stateChanges: penalty !== 0 ? {
          playerStateChanges: {
            [ctx.playerId]: { score: (ctx.player.score ?? 0) + penalty }
          }
        } : undefined,
        advanceTurn: false,
        checkWin: false,
        logMessage: `No matching pattern found in selected elements.`,
        logData: { player: ctx.playerId, selected }
      };
    }

    const points = config.points_per_match ?? 3;
    return {
      handled: true,
      stateChanges: {
        sharedStateChanges: {
          patternRecognition: {
            ...pState,
            foundPatterns: [...pState.foundPatterns, {
              playerId: ctx.playerId,
              elements: indices,
              round: pState.round
            }]
          }
        },
        playerStateChanges: {
          [ctx.playerId]: { score: (ctx.player.score ?? 0) + points }
        }
      },
      advanceTurn: false,
      checkWin: true,
      logMessage: `${ctx.playerId} found a pattern! (${sameColor ? 'color' : 'shape'} match)`,
      logData: { player: ctx.playerId, selected, matchType: sameColor ? 'color' : 'shape' }
    };
  },

  getPlayerView(ctx: HookContext): Record<string, unknown> | null {
    if (!isMechanicEnabled(ctx.config, 'pattern-recognition')) return null;

    const pState = getPatternState(ctx.state.shared);
    if (!pState) return null;

    return {
      visibleElements: pState.visibleElements,
      foundPatterns: pState.foundPatterns.length,
      round: pState.round
    };
  }
};
