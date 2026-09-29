/**
 * Follow Mechanic
 *
 * When the active player takes an action, other players may "follow"
 * by taking a lesser version of that action. Common in games like
 * Glory to Rome, Puerto Rico, etc.
 *
 * Hooks used:
 * - canPlayerActNow: Allow non-active players to follow
 * - getAvailableActions: 'follow_action' for non-active players
 * - onExecuteAction: Handle follow action
 * - postExecuteAction: After active player acts, open follow window
 */

import {
  MechanicHooks,
  HookContext,
  ActionExecutionContext,
  ActionExecutionResult,
  AvailableAction,
  StateChanges,
  SharedStateInitContext,
  SharedStateInitResult,
  isMechanicEnabled
} from './types';
import { GameAction, GameConfig } from '../types/game';

interface FollowConfig {
  followable_actions?: string[];  // action types that can be followed
  follow_bonus_reduction?: number;  // reduce effect by this amount (default 1)
}

interface FollowWindowState {
  /** The action that was taken by the active player */
  leadAction: Record<string, unknown> | null;
  /** Player who took the lead action */
  leadPlayer: string | null;
  /** Players who have already responded (followed or declined) */
  respondedPlayers: string[];
  /** Players who chose to follow */
  followedPlayers: string[];
  /** Whether follow window is currently open */
  isOpen: boolean;
}

function getConfig(config: GameConfig): FollowConfig | undefined {
  return config.engine_mechanics?.follow as FollowConfig | undefined;
}

function getFollowState(shared: Record<string, unknown>): FollowWindowState | undefined {
  return shared.followWindow as FollowWindowState | undefined;
}

export const followMechanic: MechanicHooks = {
  slug: 'follow',
  name: 'Follow',

  configSchema: {
    type: 'object',
    description: 'Non-active players may follow the active player\'s action at reduced strength',
    properties: {
      followable_actions: {
        type: 'array',
        description: 'Action types that can be followed (default: all non-pass actions)'
      },
      follow_bonus_reduction: {
        type: 'number',
        description: 'Reduce effect amount by this value when following',
        default: 1
      }
    }
  },

  /**
   * Initialize follow window state
   */
  initSharedState(ctx: SharedStateInitContext): SharedStateInitResult | null {
    const config = getConfig(ctx.config);
    if (!config) return null;

    const followWindow: FollowWindowState = {
      leadAction: null,
      leadPlayer: null,
      respondedPlayers: [],
      followedPlayers: [],
      isOpen: false
    };

    return { followWindow };
  },

  /**
   * Allow non-active players to act when follow window is open
   */
  canPlayerActNow(ctx: HookContext): boolean | null {
    if (!isMechanicEnabled(ctx.config, 'follow')) return null;

    const followState = getFollowState(ctx.state.shared);
    if (!followState?.isOpen) return null;

    // If follow window is open and this player hasn't responded yet
    if (followState.leadPlayer !== ctx.playerId &&
        !followState.respondedPlayers.includes(ctx.playerId)) {
      return true;
    }

    return null;
  },

  /**
   * Provide follow/decline actions for non-active players during follow window
   */
  getAvailableActions(ctx: HookContext): AvailableAction[] {
    if (!isMechanicEnabled(ctx.config, 'follow')) return [];

    const followState = getFollowState(ctx.state.shared);
    if (!followState?.isOpen) return [];

    // Only non-active, non-responded players get follow actions
    if (followState.leadPlayer === ctx.playerId) return [];
    if (followState.respondedPlayers.includes(ctx.playerId)) return [];

    const actions: AvailableAction[] = [];

    // Follow action
    actions.push({
      action: {
        type: 'follow_action',
        follow: true
      } as unknown as GameAction,
      priority: 80,
      category: 'follow'
    });

    // Decline action
    actions.push({
      action: {
        type: 'follow_action',
        follow: false
      } as unknown as GameAction,
      priority: 75,
      category: 'follow'
    });

    return actions;
  },

  /**
   * Handle follow/decline actions
   */
  onExecuteAction(ctx: ActionExecutionContext): ActionExecutionResult | null {
    if (ctx.action.type !== 'follow_action') return null;

    const config = getConfig(ctx.config);
    if (!config) return null;

    const followAction = ctx.action as unknown as { type: 'follow_action'; follow: boolean };
    const followState = getFollowState(ctx.state.shared);
    if (!followState?.isOpen) {
      return {
        handled: true,
        logMessage: 'No follow window is currently open.',
        advanceTurn: false,
        checkWin: false
      };
    }

    // Record the response
    const updatedRespondedPlayers = [...followState.respondedPlayers, ctx.playerId];
    const updatedFollowedPlayers = followAction.follow
      ? [...followState.followedPlayers, ctx.playerId]
      : [...followState.followedPlayers];

    // Check if all non-lead players have responded
    const allPlayers = Object.keys(ctx.state.players);
    const nonLeadPlayers = allPlayers.filter(p => p !== followState.leadPlayer);
    const allResponded = nonLeadPlayers.every(p => updatedRespondedPlayers.includes(p));

    // Close window if all have responded
    const updatedFollowWindow: FollowWindowState = {
      ...followState,
      respondedPlayers: updatedRespondedPlayers,
      followedPlayers: updatedFollowedPlayers,
      isOpen: !allResponded
    };

    // If player chose to follow, apply reduced effect
    const stateChanges: StateChanges = {
      sharedStateChanges: {
        followWindow: updatedFollowWindow
      }
    };

    if (followAction.follow && followState.leadAction) {
      // Apply a score bonus (reduced by follow_bonus_reduction)
      const reduction = config.follow_bonus_reduction ?? 1;
      const bonusPoints = Math.max(0, 1 - reduction); // Minimum 0 points
      if (bonusPoints > 0 || reduction === 0) {
        const currentScore = ctx.player.score ?? 0;
        stateChanges.playerStateChanges = {
          [ctx.playerId]: { score: currentScore + Math.max(1, bonusPoints) }
        };
      }
    }

    return {
      handled: true,
      stateChanges,
      advanceTurn: false, // Don't advance turn for follow responses
      checkWin: followAction.follow, // Check win only if followed
      logMessage: followAction.follow ? 'player_followed' : 'player_declined_follow',
      logData: {
        player: ctx.playerId,
        followed: followAction.follow,
        leadAction: followState.leadAction?.type,
        allResponded
      }
    };
  },

  /**
   * After the active player acts, open follow window if action is followable
   */
  postExecuteAction(ctx: HookContext, action: GameAction): StateChanges | null {
    if (!isMechanicEnabled(ctx.config, 'follow')) return null;

    const config = getConfig(ctx.config);
    if (!config) return null;

    // Don't open follow window for follow_action responses or pass
    if (action.type === 'follow_action' || action.type === 'pass') return null;

    // Check if this action type is followable
    if (config.followable_actions?.length) {
      if (!config.followable_actions.includes(action.type)) return null;
    }

    // Only open follow window for the active player's actions
    if (ctx.playerId !== ctx.state.currentPlayer) return null;

    // Open follow window
    const followWindow: FollowWindowState = {
      leadAction: action as unknown as Record<string, unknown>,
      leadPlayer: ctx.playerId,
      respondedPlayers: [],
      followedPlayers: [],
      isOpen: true
    };

    return {
      sharedStateChanges: { followWindow }
    };
  }
};
