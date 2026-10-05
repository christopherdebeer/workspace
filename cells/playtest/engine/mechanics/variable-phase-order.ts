/**
 * Variable Phase Order Mechanic
 *
 * Game phases can occur in different orders each round.
 * Players may influence phase ordering.
 *
 * Hooks used:
 * - initSharedState: Create phase tracking
 * - getAvailableActions: 'select_phase'
 * - onExecuteAction: Select next phase
 * - getPlayerView: Show phase order
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

interface PhaseConfig {
  phases?: string[];
  player_selected?: boolean;
}

interface PhaseState {
  availablePhases: string[];
  currentPhaseIndex: number;
  phaseOrder: string[];
  round: number;
}

function getConfig(config: GameConfig): PhaseConfig | undefined {
  return config.engine_mechanics?.variable_phase_order as PhaseConfig | undefined;
}

function getPhaseState(shared: Record<string, unknown>): PhaseState | undefined {
  return shared.variablePhaseOrder as PhaseState | undefined;
}

export const variablePhaseOrderMechanic: MechanicHooks = {
  slug: 'variable-phase-order',
  name: 'Variable Phase Order',

  configSchema: {
    type: 'object',
    description: 'Dynamic phase sequencing each round',
    properties: {
      phases: { type: 'array', default: ['produce', 'build', 'trade', 'score'] },
      player_selected: { type: 'boolean', default: true }
    }
  },

  initSharedState(ctx: SharedStateInitContext): SharedStateInitResult | null {
    const config = getConfig(ctx.config);
    if (!config) return null;

    const phases = config.phases ?? ['produce', 'build', 'trade', 'score'];

    return {
      variablePhaseOrder: {
        availablePhases: phases,
        currentPhaseIndex: 0,
        phaseOrder: [...phases],
        round: 1
      } as PhaseState
    };
  },

  getAvailableActions(ctx: HookContext): AvailableAction[] {
    if (!isMechanicEnabled(ctx.config, 'variable-phase-order')) return [];

    const config = getConfig(ctx.config);
    if (!config?.player_selected) return [];

    const pState = getPhaseState(ctx.state.shared);
    if (!pState) return [];

    // Only first player selects phase
    if (ctx.state.turnOrder[0] !== ctx.playerId) return [];

    return pState.availablePhases.map(phase => ({
      action: {
        type: 'select_phase',
        phase
      } as unknown as GameAction,
      priority: 75,
      category: 'phase-order'
    }));
  },

  onExecuteAction(ctx: ActionExecutionContext): ActionExecutionResult | null {
    if (ctx.action.type !== 'select_phase') return null;

    const pState = getPhaseState(ctx.state.shared);
    if (!pState) return null;

    const selectAction = ctx.action as unknown as { type: 'select_phase'; phase: string };
    if (!pState.availablePhases.includes(selectAction.phase)) {
      return { handled: true, logMessage: 'Invalid phase.', advanceTurn: false, checkWin: false };
    }

    // Move selected phase to front of order
    const newOrder = [
      selectAction.phase,
      ...pState.phaseOrder.filter(p => p !== selectAction.phase)
    ];

    return {
      handled: true,
      stateChanges: {
        sharedStateChanges: {
          variablePhaseOrder: {
            ...pState,
            phaseOrder: newOrder,
            currentPhaseIndex: 0
          }
        }
      },
      advanceTurn: true,
      checkWin: false,
      logMessage: `${ctx.playerId} selected ${selectAction.phase} as the next phase.`,
      logData: { player: ctx.playerId, phase: selectAction.phase, newOrder }
    };
  },

  getPlayerView(ctx: HookContext): Record<string, unknown> | null {
    if (!isMechanicEnabled(ctx.config, 'variable-phase-order')) return null;

    const pState = getPhaseState(ctx.state.shared);
    if (!pState) return null;

    return {
      currentPhase: pState.phaseOrder[pState.currentPhaseIndex],
      phaseOrder: pState.phaseOrder,
      round: pState.round
    };
  }
};
