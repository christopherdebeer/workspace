/**
 * Rondel Mechanic
 *
 * Circular action wheel - players move clockwise, selecting actions.
 * Movement distance determines action cost (further = more expensive).
 *
 * Hooks used:
 * - initSharedState: Create rondel
 * - getAvailableActions: 'rondel_move' to available segments
 * - onExecuteAction: Move on rondel and execute action
 * - getPlayerView: Show rondel positions
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

interface RondelSegment {
  id: string;
  name: string;
  action: string;
}

interface RondelConfig {
  segments?: RondelSegment[];
  free_steps?: number;
  cost_per_extra_step?: number;
}

interface RondelState {
  segments: RondelSegment[];
  positions: Record<string, number>; // playerId -> segment index
}

function getConfig(config: GameConfig): RondelConfig | undefined {
  return config.engine_mechanics?.rondel as RondelConfig | undefined;
}

function getRondelState(shared: Record<string, unknown>): RondelState | undefined {
  return shared.rondel as RondelState | undefined;
}

export const rondelMechanic: MechanicHooks = {
  slug: 'rondel',
  name: 'Rondel',
  requires: ['board'],

  configSchema: {
    type: 'object',
    description: 'Circular action wheel with distance-based cost',
    properties: {
      segments: { type: 'array', description: 'Rondel segment definitions' },
      free_steps: { type: 'number', default: 3 },
      cost_per_extra_step: { type: 'number', default: 1 }
    }
  },

  initSharedState(ctx: SharedStateInitContext): SharedStateInitResult | null {
    const config = getConfig(ctx.config);
    if (!config) return null;

    const segments = config.segments ?? [
      { id: 'produce', name: 'Produce', action: 'produce' },
      { id: 'build', name: 'Build', action: 'build' },
      { id: 'trade', name: 'Trade', action: 'trade' },
      { id: 'recruit', name: 'Recruit', action: 'recruit' },
      { id: 'move', name: 'Move', action: 'move' },
      { id: 'attack', name: 'Attack', action: 'attack' },
      { id: 'develop', name: 'Develop', action: 'develop' },
      { id: 'tax', name: 'Tax', action: 'tax' }
    ];

    const positions: Record<string, number> = {};
    for (let i = 0; i < ctx.playerIds.length; i++) {
      positions[ctx.playerIds[i]] = i % segments.length;
    }

    return { rondel: { segments, positions } as RondelState };
  },

  getAvailableActions(ctx: HookContext): AvailableAction[] {
    if (!isMechanicEnabled(ctx.config, 'rondel')) return [];

    const config = getConfig(ctx.config);
    if (!config) return [];

    const rState = getRondelState(ctx.state.shared);
    if (!rState) return [];

    const currentPos = rState.positions[ctx.playerId] ?? 0;
    const numSegments = rState.segments.length;
    const freeSteps = config.free_steps ?? 3;
    const maxSteps = Math.min(numSegments - 1, freeSteps + 3); // allow paying for up to 3 extra

    const actions: AvailableAction[] = [];
    for (let steps = 1; steps <= maxSteps; steps++) {
      const targetIdx = (currentPos + steps) % numSegments;
      const segment = rState.segments[targetIdx];
      const extraCost = Math.max(0, steps - freeSteps) * (config.cost_per_extra_step ?? 1);

      actions.push({
        action: {
          type: 'rondel_move',
          targetSegment: targetIdx,
          steps,
          cost: extraCost
        } as unknown as GameAction,
        priority: 65 - steps,
        category: 'rondel'
      });
    }

    return actions;
  },

  onExecuteAction(ctx: ActionExecutionContext): ActionExecutionResult | null {
    if (ctx.action.type !== 'rondel_move') return null;

    const config = getConfig(ctx.config);
    if (!config) return null;

    const rState = getRondelState(ctx.state.shared);
    if (!rState) return null;

    const moveAction = ctx.action as unknown as {
      type: 'rondel_move';
      targetSegment: number;
      steps: number;
      cost: number;
    };

    const segment = rState.segments[moveAction.targetSegment];
    if (!segment) {
      return { handled: true, logMessage: 'Invalid segment.', advanceTurn: false, checkWin: false };
    }

    const scoreChange = moveAction.cost > 0 ? -moveAction.cost : 0;

    return {
      handled: true,
      stateChanges: {
        sharedStateChanges: {
          rondel: {
            ...rState,
            positions: { ...rState.positions, [ctx.playerId]: moveAction.targetSegment }
          }
        },
        ...(scoreChange !== 0 ? {
          playerStateChanges: {
            [ctx.playerId]: { score: (ctx.player.score ?? 0) + scoreChange }
          }
        } : {})
      },
      advanceTurn: false,
      checkWin: false,
      logMessage: `${ctx.playerId} moved to ${segment.name} (${moveAction.steps} steps${moveAction.cost > 0 ? `, cost ${moveAction.cost}` : ''}).`,
      logData: { player: ctx.playerId, segment: segment.name, steps: moveAction.steps, cost: moveAction.cost }
    };
  },

  getPlayerView(ctx: HookContext): Record<string, unknown> | null {
    if (!isMechanicEnabled(ctx.config, 'rondel')) return null;

    const rState = getRondelState(ctx.state.shared);
    if (!rState) return null;

    const myPos = rState.positions[ctx.playerId] ?? 0;
    return {
      rondelPosition: myPos,
      currentSegment: rState.segments[myPos],
      rondelSegments: rState.segments,
      allPositions: rState.positions
    };
  }
};
