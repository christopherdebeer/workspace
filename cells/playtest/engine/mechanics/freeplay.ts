/**
 * Freeplay Mechanic (Experimental)
 *
 * Enables continuous parallel play where players can act simultaneously
 * without waiting for turn-based alternation. Only interaction actions
 * (trading, attacking, etc.) require synchronization between players.
 *
 * This is an EXPERIMENTAL mechanic that fundamentally changes the engine's
 * turn model. Use with caution and only for games designed for parallel play.
 *
 * Key behaviors:
 * - Any player can act at any time (no currentPlayer blocking)
 * - Actions are validated based on player state, not turn ownership
 * - Rounds advance based on action count or time, not turn completion
 * - Interaction actions create "pending" states awaiting response
 *
 * Hooks used:
 * - preValidateAction: Override turn validation to allow any player
 * - onTurnEnd: Track action counts, manage round advancement
 * - initSharedState: Initialize freeplay tracking state
 * - getAvailableActions: Always allow actions regardless of turn
 *
 * Configuration:
 * - actions_per_round: How many total actions before round advances (optional)
 * - interaction_timeout: Seconds to wait for interaction response (optional)
 * - allow_concurrent_resource_access: Whether multiple players can access same resource
 */

import {
  MechanicHooks,
  HookContext,
  ValidationResult,
  TurnEndContext,
  StateChanges,
  SharedStateInitContext,
  SharedStateInitResult,
  AvailableAction,
  isMechanicEnabled
} from './types';
import { GameAction } from '../types/game';

interface FreeplayConfig {
  /** Total actions across all players before round advances */
  actions_per_round?: number;
  /** Seconds to wait for interaction responses */
  interaction_timeout?: number;
  /** Allow concurrent access to shared resources (deck, etc.) */
  allow_concurrent_resource_access?: boolean;
  /** Actions that require synchronization with other players */
  interaction_actions?: string[];
}

interface FreeplaySharedState {
  /** Track actions taken this round by each player */
  actionsThisRound: Record<string, number>;
  /** Total actions this round across all players */
  totalActionsThisRound: number;
  /** Pending interactions awaiting response */
  pendingInteractions: Array<{
    id: string;
    type: string;
    initiator: string;
    target?: string;
    data: Record<string, unknown>;
    timestamp: number;
  }>;
  /** Players currently locked waiting for interaction response */
  playersAwaitingResponse: string[];
}

/**
 * Default interaction actions that require synchronization
 */
const DEFAULT_INTERACTION_ACTIONS = [
  'trade_offer',
  'trade_respond',
  'attack',
  'negotiate',
  'challenge',
  'vote'
];

export const freeplayMechanic: MechanicHooks = {
  slug: 'freeplay',
  name: 'Freeplay (Experimental)',

  configSchema: {
    type: 'object',
    description: 'Experimental: Enable parallel play without turn-based alternation',
    properties: {
      actions_per_round: {
        type: 'number',
        description: 'Total actions across all players before round advances'
      },
      interaction_timeout: {
        type: 'number',
        description: 'Seconds to wait for interaction responses (default: 60)'
      },
      allow_concurrent_resource_access: {
        type: 'boolean',
        description: 'Allow concurrent access to shared resources'
      },
      interaction_actions: {
        type: 'array',
        description: 'Action types that require synchronization'
      }
    }
  },

  /**
   * Initialize freeplay tracking state
   */
  initSharedState(ctx: SharedStateInitContext): SharedStateInitResult | null {
    const mechanics = ctx.config.engine_mechanics as Record<string, unknown> | undefined;
    const config = mechanics?.freeplay as FreeplayConfig | undefined;
    if (!config) return null;

    const actionsThisRound: Record<string, number> = {};
    for (const playerId of ctx.playerIds) {
      actionsThisRound[playerId] = 0;
    }

    const freeplayState: FreeplaySharedState = {
      actionsThisRound,
      totalActionsThisRound: 0,
      pendingInteractions: [],
      playersAwaitingResponse: []
    };

    return { freeplayState };
  },

  /**
   * Override turn validation to allow any player to act.
   * In freeplay mode, we don't check currentPlayer.
   */
  preValidateAction(ctx: HookContext, action: GameAction): ValidationResult | null {
    if (!isMechanicEnabled(ctx.config, 'freeplay')) return null;

    const mechanics = ctx.config.engine_mechanics as Record<string, unknown> | undefined;
    const config = mechanics?.freeplay as FreeplayConfig | undefined;
    if (!config) return null;

    const freeplayState = ctx.state.shared.freeplayState as FreeplaySharedState | undefined;

    // Check if player is awaiting an interaction response
    if (freeplayState?.playersAwaitingResponse.includes(ctx.playerId)) {
      // Only allow interaction responses while awaiting
      const interactionActions = config.interaction_actions || DEFAULT_INTERACTION_ACTIONS;
      if (!interactionActions.includes(action.type) && action.type !== 'pass') {
        return {
          valid: false,
          error: 'You have a pending interaction that must be resolved first.'
        };
      }
    }

    // Check if this is an interaction action that needs a target
    const interactionActions = config.interaction_actions || DEFAULT_INTERACTION_ACTIONS;
    if (interactionActions.includes(action.type)) {
      // Interaction actions are valid but will create pending state
      return { valid: true };
    }

    // For non-interaction actions, allow freely (freeplay mode)
    // The key change: we DON'T check if it's the player's turn
    return { valid: true };
  },

  /**
   * Track actions and manage round advancement
   */
  onTurnEnd(ctx: TurnEndContext): StateChanges | null {
    if (!isMechanicEnabled(ctx.config, 'freeplay')) return null;

    const mechanics = ctx.config.engine_mechanics as Record<string, unknown> | undefined;
    const config = mechanics?.freeplay as FreeplayConfig | undefined;
    if (!config) return null;

    const freeplayState = ctx.state.shared.freeplayState as FreeplaySharedState | undefined;
    if (!freeplayState) return null;

    // Increment action counts
    freeplayState.actionsThisRound[ctx.playerId] =
      (freeplayState.actionsThisRound[ctx.playerId] || 0) + 1;
    freeplayState.totalActionsThisRound++;

    // Check if round should advance based on action count
    if (config.actions_per_round &&
        freeplayState.totalActionsThisRound >= config.actions_per_round) {
      // Reset for new round
      for (const pid of Object.keys(freeplayState.actionsThisRound)) {
        freeplayState.actionsThisRound[pid] = 0;
      }
      freeplayState.totalActionsThisRound = 0;

      return {
        sharedStateChanges: {
          freeplayState,
          // Signal round advancement (game.ts would need to handle this)
          freeplayRoundComplete: true
        }
      };
    }

    return {
      sharedStateChanges: { freeplayState }
    };
  },

  /**
   * In freeplay mode, actions are always available (not gated by turn)
   */
  getAvailableActions(ctx: HookContext): AvailableAction[] {
    if (!isMechanicEnabled(ctx.config, 'freeplay')) return [];

    const freeplayState = ctx.state.shared.freeplayState as FreeplaySharedState | undefined;

    // If player has pending interaction, only show resolve options
    if (freeplayState?.playersAwaitingResponse.includes(ctx.playerId)) {
      return [{
        action: { type: 'resolve_interaction' } as unknown as GameAction,
        priority: 100,
        category: 'freeplay'
      }];
    }

    // Otherwise, freeplay doesn't add specific actions
    // It just removes the turn-based gating from other actions
    return [];
  },

  /**
   * Allow any player to act in freeplay mode (bypass turn checking).
   * This hook is used by waitForTurn to allow parallel play.
   */
  canPlayerActNow(ctx: HookContext): boolean | null {
    if (!isMechanicEnabled(ctx.config, 'freeplay')) return null;

    const freeplayState = ctx.state.shared.freeplayState as FreeplaySharedState | undefined;

    // If player has pending interaction, they can still act (for interaction responses)
    // but we return true since freeplay mode allows any player to participate
    if (freeplayState?.playersAwaitingResponse.includes(ctx.playerId)) {
      // Still allow them to act - validation will restrict to interaction actions only
      return true;
    }

    // Freeplay mode: any player can act at any time
    return true;
  }
};

/**
 * Helper to check if a player can act in freeplay mode.
 * Exported for use by game.ts to override currentPlayer checks.
 */
export function canActInFreeplay(
  state: { shared: Record<string, unknown>; config: { engine_mechanics?: Record<string, unknown> } },
  playerId: string
): boolean {
  const config = state.config.engine_mechanics?.freeplay as FreeplayConfig | undefined;
  if (!config) return false;

  const freeplayState = state.shared.freeplayState as FreeplaySharedState | undefined;
  if (!freeplayState) return true; // Freeplay enabled but no state yet = allow

  // Check if player is blocked by pending interaction
  if (freeplayState.playersAwaitingResponse.includes(playerId)) {
    return false; // Must resolve interaction first
  }

  return true;
}
