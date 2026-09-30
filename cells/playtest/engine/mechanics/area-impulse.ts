/**
 * Area Impulse Mechanic
 *
 * Activation-based combat where players take impulses to activate units.
 *
 * Config:
 *   area_impulse:
 *     impulse_cost: number          # Cost per impulse
 *     max_impulses: number          # Max impulses per turn
 *     activation_limit: number      # Units activated per impulse
 */

import { MechanicHooks, HookContext, ValidationResult, ActionExecutionContext, ActionExecutionResult, AvailableAction, StateChanges, TurnStartContext, TurnEndContext } from './types';
import { GameAction, ImpulseState, ActivateUnitsAction } from '../types/game';

interface AreaImpulseConfig {
  impulse_cost?: number;
  max_impulses?: number;
  activation_limit?: number;
}

export const areaImpulseMechanic: MechanicHooks = {
  slug: 'area-impulse',
  name: 'Area Impulse',
  requires: ['combat'],

  configSchema: {
    type: 'object',
    description: 'Activation-based combat system',
    properties: {
      impulse_cost: {
        type: 'number',
        description: 'Resource cost per impulse',
        default: 1
      },
      max_impulses: {
        type: 'number',
        description: 'Maximum impulses per turn',
        default: 3
      },
      activation_limit: {
        type: 'number',
        description: 'Units that can be activated per impulse',
        default: 3
      }
    }
  },

  onTurnStart(ctx: TurnStartContext): StateChanges | null {
    const config = ctx.config.engine_mechanics?.area_impulse as AreaImpulseConfig | undefined;
    if (!config) return null;

    // Initialize impulse state for the turn
    const impulseState: ImpulseState = {
      currentImpulse: 0,
      impulsesUsed: 0,
      activatedUnits: [],
      phase: 'selecting'
    };

    return {
      playerStateChanges: {
        [ctx.playerId]: {
          impulseState
        }
      }
    };
  },

  onTurnEnd(ctx: TurnEndContext): StateChanges | null {
    const config = ctx.config.engine_mechanics?.area_impulse as AreaImpulseConfig | undefined;
    if (!config) return null;

    // Clear impulse state at end of turn
    return {
      playerStateChanges: {
        [ctx.playerId]: {
          impulseState: undefined
        }
      }
    };
  },

  preValidateAction(ctx: HookContext, action: GameAction): ValidationResult | null {
    if (action.type !== 'activate_units') return null;

    const config = ctx.config.engine_mechanics?.area_impulse as AreaImpulseConfig | undefined;
    if (!config) return { valid: false, error: 'Area impulse not enabled.' };

    const activateAction = action as unknown as ActivateUnitsAction;
    const playerState = ctx.state.players[ctx.playerId];
    const impulseState = playerState?.impulseState;

    if (!impulseState || impulseState.phase === 'complete') {
      return { valid: false, error: 'No active impulse phase.' };
    }

    const maxImpulses = config.max_impulses ?? 3;
    if (impulseState.impulsesUsed >= maxImpulses) {
      return { valid: false, error: `Maximum impulses (${maxImpulses}) reached for this turn.` };
    }

    const activationLimit = config.activation_limit ?? 3;
    if (activateAction.unitIds.length > activationLimit) {
      return { valid: false, error: `Cannot activate more than ${activationLimit} units per impulse.` };
    }

    // Check for already-activated units
    for (const unitId of activateAction.unitIds) {
      if (impulseState.activatedUnits.includes(unitId)) {
        return { valid: false, error: `Unit ${unitId} has already been activated this turn.` };
      }
    }

    return { valid: true };
  },

  onExecuteAction(ctx: ActionExecutionContext): ActionExecutionResult | null {
    if (ctx.action.type !== 'activate_units') return null;

    const config = ctx.config.engine_mechanics?.area_impulse as AreaImpulseConfig;
    const activateAction = ctx.action as unknown as ActivateUnitsAction;
    const playerState = ctx.state.players[ctx.playerId];
    const impulseState = { ...playerState.impulseState! };

    // Update impulse state
    impulseState.impulsesUsed++;
    impulseState.currentImpulse++;
    impulseState.activatedUnits.push(...activateAction.unitIds);

    const maxImpulses = config.max_impulses ?? 3;
    if (impulseState.impulsesUsed >= maxImpulses) {
      impulseState.phase = 'complete';
    }

    return {
      handled: true,
      stateChanges: {
        playerStateChanges: {
          [ctx.playerId]: {
            impulseState
          }
        }
      },
      advanceTurn: false,
      checkWin: false,
      logMessage: `${ctx.playerId} activated ${activateAction.unitIds.length} units in impulse ${impulseState.currentImpulse}.`
    };
  },

  getAvailableActions(ctx: HookContext): AvailableAction[] {
    const config = ctx.config.engine_mechanics?.area_impulse as AreaImpulseConfig | undefined;
    if (!config) return [];

    const playerState = ctx.state.players[ctx.playerId];
    const impulseState = playerState?.impulseState;

    if (!impulseState || impulseState.phase === 'complete') return [];

    const maxImpulses = config.max_impulses ?? 3;
    if (impulseState.impulsesUsed >= maxImpulses) return [];

    return [{
      action: {
        type: 'activate_units',
        unitIds: [],
        orders: {}
      } as unknown as GameAction,
      priority: 90,
      category: 'combat'
    }];
  }
};
