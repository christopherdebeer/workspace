/**
 * Pass Mechanic (Core)
 *
 * Handles the fundamental "pass" action - ending a turn without taking an action.
 * This is a core mechanic that is always available (no config required).
 *
 * Features:
 * - Executes pass action via onExecuteAction hook
 * - Calls onPassPriority hooks for turn order mechanics to intercept
 * - Handles victory declarations routed through pass (pendingVictoryClaim)
 * - Exposes pass as a low-priority available action (fallback)
 *
 * Hooks used:
 * - onExecuteAction: Handle pass action execution
 * - getAvailableActions: Expose pass as fallback action
 * - describeAction: Describe pass action for UI/agents
 */

import {
  MechanicHooks,
  ActionExecutionContext,
  ActionExecutionResult,
  HookContext,
  AvailableAction,
  ActionDescription,
  PassPriorityResult,
  ValidationResult,
  ActionSchema
} from '../types';
import { GameAction, GameState } from '../../types/game';
import { mechanicRegistry } from '../registry';

/**
 * Extended pass action interface with victory declaration support
 */
interface PassAction {
  type: 'pass';
  declareVictory?: boolean;
  victoryReason?: string;
}

/**
 * Contest state type for pending victory claims
 */
interface ContestState {
  pendingVictoryClaim?: {
    player: string;
    reason: string;
    fromState?: string;
    toState?: string;
    timestamp: number;
  };
}

export const passMechanic: MechanicHooks = {
  slug: 'pass',
  name: 'Pass Action',
  alwaysEnabled: true,

  getActionSchema(action: GameAction): ActionSchema | null {
    if (action.type !== 'pass') return null;
    return {
      optional: ['declareVictory', 'victoryReason'],
      fields: {
        declareVictory: { type: 'boolean' },
        victoryReason: { type: 'string' },
      },
    };
  },

  /**
   * Only the current player may pass. Out-of-turn access (via canPlayerActNow)
   * is granted for specific actions like simultaneous submissions — pass would
   * let a player monopolize round advancement by advancing turns without acting.
   */
  preValidateAction(ctx: HookContext, action: GameAction): ValidationResult | null {
    if (action.type !== 'pass') return null;

    if (ctx.state.currentPlayer !== ctx.playerId) {
      return { valid: false, error: 'Only the current player may pass.' };
    }

    return null;
  },

  /**
   * Handle pass action execution.
   * - Processes victory declarations by creating pendingVictoryClaim
   * - Calls onPassPriority hooks for turn order mechanics
   * - Always advances turn by default
   */
  onExecuteAction(ctx: ActionExecutionContext): ActionExecutionResult | null {
    if (ctx.action.type !== 'pass') return null;

    const passAction = ctx.action as PassAction;
    const { state, playerId } = ctx;

    // Handle victory declaration routed through pass
    if (passAction.declareVictory) {
      // Initialize contest state if needed
      if (!state.shared.contestState) {
        state.shared.contestState = {
          pendingContests: [],
          contestHistory: []
        };
      }

      const contestState = state.shared.contestState as ContestState;
      const player = state.players[playerId];

      // Create pending victory claim for GM verification
      contestState.pendingVictoryClaim = {
        player: playerId,
        reason: passAction.victoryReason || 'Victory declared',
        fromState: player.state,
        toState: 'Victory',
        timestamp: Date.now()
      };

      return {
        handled: true,
        advanceTurn: true,
        checkWin: false, // GM will adjudicate
        logMessage: `${playerId} declared victory: ${passAction.victoryReason || 'Victory claimed'}`,
        logData: {
          victoryDeclaration: true,
          reason: passAction.victoryReason
        }
      };
    }

    // Call onPassPriority hooks for turn order mechanics
    const passResult = callPassPriorityHooks(state, playerId);

    // Build result with any pass priority modifications
    const result: ActionExecutionResult = {
      handled: true,
      advanceTurn: true,
      logMessage: `${playerId} passed`
    };

    // Apply pass priority results
    if (passResult) {
      if (passResult.removeFromRound) {
        // Track passed players in shared state (for mechanics that track this)
        const passedPlayers = (state.shared.passedThisRound as string[]) || [];
        if (!passedPlayers.includes(playerId)) {
          passedPlayers.push(playerId);
        }
        result.stateChanges = {
          sharedStateChanges: {
            passedThisRound: passedPlayers
          }
        };
        result.logData = { ...result.logData, removedFromRound: true };
      }

      if (passResult.skipToNextRound) {
        result.logData = { ...result.logData, skippedToNextRound: true };
      }

      // Note: nextPlayer override would need to be handled by the turn system
      // The mechanic can set this, but game.ts advanceTurn needs to respect it
      if (passResult.nextPlayer) {
        result.logData = { ...result.logData, nextPlayerOverride: passResult.nextPlayer };
      }
    }

    return result;
  },

  /**
   * Expose victory declaration variant of pass when enabled.
   * The base pass action is provided by the engine (game.ts getAvailableActions)
   * which serves as the dedup anchor for other mechanics' pass-typed actions.
   */
  getAvailableActions(ctx: HookContext): AvailableAction[] {
    const actions: AvailableAction[] = [];

    // Victory declaration is always available when enabled
    if (ctx.config.engine_mechanics?.victory_declaration) {
      actions.push({
        action: { type: 'pass', declareVictory: true, victoryReason: '' } as unknown as GameAction,
        priority: 100,
        category: 'victory'
      });
    }

    return actions;
  },

  /**
   * Describe the pass action for UI/agents.
   */
  describeAction(action: GameAction): ActionDescription | null {
    if (action.type !== 'pass') return null;

    const passAction = action as PassAction;

    if (passAction.declareVictory) {
      return {
        type: 'pass',
        label: 'Declare Victory',
        description: 'End your turn and declare that you have achieved victory. The gamemaster will verify your claim.',
        examples: ['pass declareVictory:true victoryReason:"Reached Victory state"']
      };
    }

    return {
      type: 'pass',
      label: 'Pass',
      description: 'End your turn without taking an action. Use this when you have no valid moves or wish to skip your turn.',
      examples: ['pass']
    };
  }
};

/**
 * Helper to call onPassPriority hooks on all enabled mechanics.
 * Returns the first non-null result.
 */
function callPassPriorityHooks(state: GameState, playerId: string): PassPriorityResult | null {
  // The registry's onPassPriority method handles this,
  // but we call it here to keep the mechanic self-contained
  return mechanicRegistry.onPassPriority(state, playerId);
}
