/**
 * Catch The Leader Mechanic
 *
 * Balancing mechanic that penalizes the leader or benefits trailing players.
 * Keeps games competitive by preventing runaway victories.
 *
 * Requires: resources (core mechanic)
 *
 * Supports:
 * - Leader penalties (reduced income, increased costs)
 * - Trailing bonuses (extra resources, cards)
 * - Target the leader (opponents can target leading player)
 *
 * Hooks used:
 * - onTurnStart: Apply leader penalties/trailing bonuses
 * - onBeforeResourceGain: Modify resource gains for leader (resources-defined hook)
 */

import {
  MechanicHooks,
  TurnStartContext,
  StateChanges,
  HookContext,
} from './types';
import type { ResourcesHooks, BeforeResourceGainPayload } from './core/resources-mechanic';
import { addToHand } from './core/hand';
import { drawFromDeck } from './core/card-piles';

interface CatchTheLeaderConfig {
  /** How to determine the leader */
  leader_metric: 'score' | 'resources' | 'hand_size' | 'position';
  /** Resource to track (for leader_metric: 'resources') */
  resource?: string;
  /** Minimum lead to trigger penalties */
  lead_threshold?: number;
  /** Leader penalties */
  leader_penalties?: {
    /** Reduce income by this percentage (0.5 = 50% reduction) */
    income_reduction?: number;
    /** Increase action costs by this amount */
    cost_increase?: number;
    /** Lose resources per turn */
    resource_loss?: Record<string, number>;
  };
  /** Trailing player bonuses */
  trailing_bonuses?: {
    /** Minimum gap to qualify for bonuses */
    gap_threshold?: number;
    /** Extra resources per turn */
    extra_resources?: Record<string, number>;
    /** Extra cards drawn at turn start */
    extra_draw?: number;
    /** Score bonus per turn */
    score_bonus?: number;
  };
  /** Whether other players can target the leader */
  targetable_leader?: boolean;
}

function getPlayerMetricValue(
  player: { score?: number; resources?: Record<string, number>; hand?: unknown[]; state: string },
  config: CatchTheLeaderConfig
): number {
  switch (config.leader_metric) {
    case 'score':
      return player.score ?? 0;
    case 'resources':
      return player.resources?.[config.resource ?? 'gold'] ?? 0;
    case 'hand_size':
      return (player.hand ?? []).length;
    case 'position':
      // Position-based would need board context
      return 0;
    default:
      return player.score ?? 0;
  }
}

function findLeader(
  players: Record<string, { score?: number; resources?: Record<string, number>; hand?: unknown[]; state: string }>,
  config: CatchTheLeaderConfig
): { leaderId: string; leaderValue: number; secondValue: number } | null {
  const entries = Object.entries(players);
  if (entries.length < 2) return null;

  let leaderId = '';
  let leaderValue = -Infinity;
  let secondValue = -Infinity;

  for (const [pid, player] of entries) {
    const value = getPlayerMetricValue(player, config);
    if (value > leaderValue) {
      secondValue = leaderValue;
      leaderValue = value;
      leaderId = pid;
    } else if (value > secondValue) {
      secondValue = value;
    }
  }

  if (leaderId === '') return null;

  return { leaderId, leaderValue, secondValue };
}

export const catchTheLeaderMechanic: MechanicHooks & ResourcesHooks = {
  slug: 'catch-the-leader',
  name: 'Catch The Leader',
  requires: ['resources'],

  configSchema: {
    type: 'object',
    description: 'Balancing mechanic that penalizes leaders/benefits trailers',
    properties: {
      leader_metric: {
        type: 'string',
        description: 'How to determine the leader',
        enum: ['score', 'resources', 'hand_size', 'position'],
        default: 'score'
      },
      resource: {
        type: 'string',
        description: 'Resource to track (for resources metric)'
      },
      lead_threshold: {
        type: 'number',
        description: 'Minimum lead to trigger penalties',
        default: 0
      },
      leader_penalties: {
        type: 'object',
        description: 'Penalties applied to leader'
      },
      trailing_bonuses: {
        type: 'object',
        description: 'Bonuses for trailing players'
      },
      targetable_leader: {
        type: 'boolean',
        description: 'Allow targeting the leader',
        default: false
      }
    },
    required: ['leader_metric']
  },

  onTurnStart(ctx: TurnStartContext): StateChanges | null {
    const ctlConfig = ctx.config.engine_mechanics?.catch_the_leader as CatchTheLeaderConfig | undefined;
    if (!ctlConfig) return null;

    const leaderInfo = findLeader(ctx.state.players, ctlConfig);
    if (!leaderInfo) return null;

    const { leaderId, leaderValue, secondValue } = leaderInfo;
    const lead = leaderValue - secondValue;
    const threshold = ctlConfig.lead_threshold ?? 0;

    const stateChanges: StateChanges = {
      playerStateChanges: {},
      sharedStateChanges: {
        currentLeader: leaderId,
        currentLead: lead
      }
    };

    // Apply leader penalties
    if (lead > threshold && ctx.playerId === leaderId && ctlConfig.leader_penalties) {
      const penalties = ctlConfig.leader_penalties;

      // Resource loss
      if (penalties.resource_loss) {
        const currentResources = { ...(ctx.player.resources || {}) };
        for (const [resource, amount] of Object.entries(penalties.resource_loss)) {
          currentResources[resource] = Math.max(0, (currentResources[resource] || 0) - amount);
        }
        stateChanges.playerStateChanges![ctx.playerId] = {
          ...stateChanges.playerStateChanges![ctx.playerId],
          resources: currentResources
        };
      }
    }

    // Apply trailing bonuses
    if (ctlConfig.trailing_bonuses && ctx.playerId !== leaderId) {
      const bonuses = ctlConfig.trailing_bonuses;
      const myValue = getPlayerMetricValue(ctx.player, ctlConfig);
      const gap = leaderValue - myValue;
      const gapThreshold = bonuses.gap_threshold ?? 0;

      if (gap >= gapThreshold) {
        // Extra resources
        if (bonuses.extra_resources) {
          const currentResources = { ...(ctx.player.resources || {}) };
          for (const [resource, amount] of Object.entries(bonuses.extra_resources)) {
            currentResources[resource] = (currentResources[resource] || 0) + amount;
          }
          stateChanges.playerStateChanges![ctx.playerId] = {
            ...stateChanges.playerStateChanges![ctx.playerId],
            resources: currentResources
          };
        }

        // Extra draw
        if (bonuses.extra_draw && bonuses.extra_draw > 0) {
          const { cards } = drawFromDeck(ctx.state, bonuses.extra_draw, ctx.playerId);
          if (cards.length > 0) {
            addToHand(ctx.state, ctx.playerId, cards);
          }
        }

        // Score bonus
        if (bonuses.score_bonus) {
          stateChanges.playerStateChanges![ctx.playerId] = {
            ...stateChanges.playerStateChanges![ctx.playerId],
            score: (ctx.player.score ?? 0) + bonuses.score_bonus
          };
        }
      }
    }

    // Only return if we have actual changes
    const hasPlayerChanges = Object.keys(stateChanges.playerStateChanges!).length > 0;
    const hasSharedChanges = Object.keys(stateChanges.sharedStateChanges!).length > 0;

    if (!hasPlayerChanges && !hasSharedChanges) return null;

    return stateChanges;
  },

  /**
   * Resources-defined hook: Reduce resource gains for the leading player.
   * Fired by resources.ts via mechanicRegistry.fire('resources', 'onBeforeResourceGain', ...).
   */
  onBeforeResourceGain(ctx: HookContext, payload: BeforeResourceGainPayload): { blocked?: boolean; blockReason?: string; amount?: number } | null {
    const ctlConfig = ctx.config.engine_mechanics?.catch_the_leader as CatchTheLeaderConfig | undefined;
    if (!ctlConfig?.leader_penalties?.income_reduction) return null;

    const leaderInfo = findLeader(ctx.state.players, ctlConfig);
    if (!leaderInfo) return null;

    const { leaderId, leaderValue, secondValue } = leaderInfo;
    const lead = leaderValue - secondValue;
    const threshold = ctlConfig.lead_threshold ?? 0;

    // Only apply to leader
    if (ctx.playerId !== leaderId || lead <= threshold) {
      return null;
    }

    // Reduce the gain
    const reduction = ctlConfig.leader_penalties.income_reduction;
    const reducedAmount = Math.floor(payload.amount * (1 - reduction));

    return { amount: reducedAmount };
  }
};
