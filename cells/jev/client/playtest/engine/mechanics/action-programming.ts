/**
 * Action Programming Mechanic
 *
 * Players program a sequence of actions that execute in order.
 * Common in games like RoboRally, Colt Express.
 *
 * Config:
 *   action_programming:
 *     program_size: number            # Actions per program
 *     simultaneous: boolean           # All players program at once
 *     reveal_order: 'simultaneous' | 'sequential'
 *     allowed_actions: string[]       # Valid action types for programming
 */

import { MechanicHooks, HookContext, ValidationResult, ActionExecutionContext, ActionExecutionResult, AvailableAction, StateChanges, SharedStateInitContext, SharedStateInitResult, TurnStartContext } from './types';
import { GameAction, GameConfig, PlayerState } from '../types/game';

interface ActionProgrammingConfig {
  program_size?: number;
  simultaneous?: boolean;
  reveal_order?: 'simultaneous' | 'sequential';
  allowed_actions?: string[];
}

interface ProgrammingState {
  phase: 'programming' | 'executing' | 'idle';
  programs: Record<string, unknown[]>;  // playerId -> array of programmed actions
  executionStep: number;
  executionOrder: string[];  // Player order for execution
  allProgrammed: boolean;
}

function getConfig(config: GameConfig): ActionProgrammingConfig | undefined {
  return config.engine_mechanics?.action_programming as ActionProgrammingConfig | undefined;
}

function getPlayerProgram(player: PlayerState): unknown[] {
  return (player as unknown as Record<string, unknown>).programmedActions as unknown[] ?? [];
}

export const actionProgrammingMechanic: MechanicHooks = {
  slug: 'action-programming',
  name: 'Action Programming',

  configSchema: {
    type: 'object',
    description: 'Program a sequence of actions to execute',
    properties: {
      program_size: {
        type: 'number',
        description: 'Number of actions per program',
        default: 5
      },
      simultaneous: {
        type: 'boolean',
        description: 'All players program at the same time',
        default: true
      },
      reveal_order: {
        type: 'string',
        description: 'How programs are revealed and executed',
        default: 'simultaneous'
      },
      allowed_actions: {
        type: 'array',
        description: 'Action types that can be programmed'
      }
    }
  },

  initSharedState(ctx: SharedStateInitContext): SharedStateInitResult | null {
    const config = getConfig(ctx.config);
    if (!config) return null;

    const programmingState: ProgrammingState = {
      phase: 'programming',
      programs: {},
      executionStep: 0,
      executionOrder: [],
      allProgrammed: false
    };

    return { actionProgramming: programmingState };
  },

  onTurnStart(ctx: TurnStartContext): StateChanges | null {
    const config = getConfig(ctx.config);
    if (!config) return null;

    if (!ctx.isNewRound) return null;

    // Reset programming state at start of each round
    const programmingState: ProgrammingState = {
      phase: 'programming',
      programs: {},
      executionStep: 0,
      executionOrder: ctx.state.turnOrder,
      allProgrammed: false
    };

    return {
      sharedStateChanges: { actionProgramming: programmingState }
    };
  },

  preValidateAction(ctx: HookContext, action: GameAction): ValidationResult | null {
    if (action.type !== 'program_action' && action.type !== 'execute_program') return null;

    const config = getConfig(ctx.config);
    if (!config) return { valid: false, error: 'Action programming not enabled.' };

    const progState = ctx.state.shared.actionProgramming as ProgrammingState | undefined;
    if (!progState) return { valid: false, error: 'Programming state not initialized.' };

    if (action.type === 'program_action') {
      if (progState.phase !== 'programming') {
        return { valid: false, error: 'Not in programming phase.' };
      }

      const programAction = action as unknown as { type: 'program_action'; actions: unknown[] };
      if (!programAction.actions || !Array.isArray(programAction.actions)) {
        return { valid: false, error: 'Must specify actions array.' };
      }

      const programSize = config.program_size ?? 5;
      if (programAction.actions.length > programSize) {
        return { valid: false, error: `Program can have at most ${programSize} actions.` };
      }

      if (programAction.actions.length === 0) {
        return { valid: false, error: 'Program must have at least 1 action.' };
      }

      // Validate allowed action types
      if (config.allowed_actions && config.allowed_actions.length > 0) {
        for (const a of programAction.actions) {
          const actionObj = a as { type?: string };
          if (actionObj.type && !config.allowed_actions.includes(actionObj.type)) {
            return { valid: false, error: `Action type '${actionObj.type}' is not allowed in programs. Allowed: ${config.allowed_actions.join(', ')}` };
          }
        }
      }

      // Check if already programmed
      if (progState.programs[ctx.playerId]) {
        return { valid: false, error: 'You have already submitted your program this round.' };
      }
    }

    if (action.type === 'execute_program') {
      if (progState.phase !== 'executing') {
        return { valid: false, error: 'Not in execution phase.' };
      }
    }

    return { valid: true };
  },

  onExecuteAction(ctx: ActionExecutionContext): ActionExecutionResult | null {
    if (ctx.action.type !== 'program_action' && ctx.action.type !== 'execute_program') return null;

    const config = getConfig(ctx.config);
    if (!config) return null;

    const progState = { ...(ctx.state.shared.actionProgramming as ProgrammingState) };

    if (ctx.action.type === 'program_action') {
      const programAction = ctx.action as unknown as { type: 'program_action'; actions: unknown[] };

      progState.programs = { ...progState.programs, [ctx.playerId]: programAction.actions };

      // Check if all players have programmed
      const allPlayers = Object.keys(ctx.state.players);
      const allProgrammed = allPlayers.every(p => progState.programs[p] !== undefined);

      if (allProgrammed) {
        progState.allProgrammed = true;
        progState.phase = 'executing';
        progState.executionStep = 0;
      }

      return {
        handled: true,
        stateChanges: {
          sharedStateChanges: { actionProgramming: progState },
          playerStateChanges: {
            [ctx.playerId]: {
              programmedActions: programAction.actions as unknown as undefined
            }
          }
        },
        advanceTurn: !allProgrammed,
        checkWin: false,
        logMessage: allProgrammed
          ? `All players have submitted programs. Execution begins!`
          : `${ctx.playerId} submitted program (${Object.keys(progState.programs).length}/${allPlayers.length}).`
      };
    }

    if (ctx.action.type === 'execute_program') {
      // Move to next execution step
      progState.executionStep++;

      // Check if all steps are done
      const programSize = config.program_size ?? 5;
      const maxSteps = Math.max(
        ...Object.values(progState.programs).map(p => (p as unknown[]).length)
      );

      if (progState.executionStep >= maxSteps) {
        progState.phase = 'idle';
      }

      return {
        handled: true,
        stateChanges: {
          sharedStateChanges: { actionProgramming: progState }
        },
        advanceTurn: true,
        checkWin: true,
        logMessage: `Executed step ${progState.executionStep} of programmed actions.`
      };
    }

    return null;
  },

  canPlayerActNow(ctx: HookContext): boolean | null {
    const config = getConfig(ctx.config);
    if (!config || !config.simultaneous) return null;

    const progState = ctx.state.shared.actionProgramming as ProgrammingState | undefined;
    if (!progState || progState.phase !== 'programming') return null;

    // During programming phase, any player who hasn't programmed can act
    if (!progState.programs[ctx.playerId]) {
      return true;
    }

    return null;
  },

  getAvailableActions(ctx: HookContext): AvailableAction[] {
    const config = getConfig(ctx.config);
    if (!config) return [];

    const progState = ctx.state.shared.actionProgramming as ProgrammingState | undefined;
    if (!progState) return [];

    if (progState.phase === 'programming' && !progState.programs[ctx.playerId]) {
      return [{
        action: {
          type: 'program_action',
          actions: []
        } as unknown as GameAction,
        priority: 95,
        category: 'programming'
      }];
    }

    return [];
  },

  getPlayerView(ctx: HookContext): Record<string, unknown> | null {
    const config = getConfig(ctx.config);
    if (!config) return null;

    const progState = ctx.state.shared.actionProgramming as ProgrammingState | undefined;
    if (!progState) return null;

    const allPlayers = Object.keys(ctx.state.players);

    return {
      programmingPhase: progState.phase,
      hasProgrammed: !!progState.programs[ctx.playerId],
      programmedCount: Object.keys(progState.programs).length,
      totalPlayers: allPlayers.length,
      executionStep: progState.executionStep,
      myProgram: getPlayerProgram(ctx.player),
      // Only show others' programs during execution
      allPrograms: progState.phase === 'executing' ? progState.programs : undefined
    };
  },

  describeAction(action: GameAction): { type: string; label: string; description: string; examples?: string[] } | null {
    if (action.type === 'program_action') {
      return {
        type: 'program_action',
        label: 'Submit Program',
        description: 'Submit a sequence of actions to execute in order.',
        examples: ['program_action actions:[{ type: "move", target: "north" }, { type: "move", target: "east" }]']
      };
    }
    if (action.type === 'execute_program') {
      return {
        type: 'execute_program',
        label: 'Execute Next Step',
        description: 'Execute the next step in all players\' programs.',
        examples: ['execute_program']
      };
    }
    return null;
  }
};
