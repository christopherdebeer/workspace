/**
 * Area Majority / Influence Mechanic
 *
 * Players compete for majority control in areas for points.
 * Requires board mechanic for area definitions.
 *
 * Hooks used:
 * - initSharedState: Create influence tracker per area
 * - getAvailableActions: 'place_influence' action
 * - onExecuteAction: Handle influence placement
 * - getPlayerView: Show area control
 */

import {
  MechanicHooks,
  HookContext,
  ActionExecutionContext,
  ActionExecutionResult,
  AvailableAction,
  SharedStateInitContext,
  SharedStateInitResult,
  StateChanges,
  isMechanicEnabled
} from './types';
import { GameAction, GameConfig } from '../types/game';

interface AreaDefinition {
  id: string;
  name: string;
  points: number[];        // Points for 1st, 2nd, 3rd place etc.
  max_influence?: number;  // Maximum total influence tokens allowed in area
}

interface AreaMajorityConfig {
  areas: AreaDefinition[];
  influence_resource?: string;  // Resource spent to place influence
}

interface AreaInfluence {
  areaId: string;
  influence: Record<string, number>;  // playerId -> influence count
  totalInfluence: number;
}

interface AreaMajorityState {
  areas: AreaInfluence[];
}

function getConfig(config: GameConfig): AreaMajorityConfig | undefined {
  return config.engine_mechanics?.area_majority_influence as AreaMajorityConfig | undefined;
}

function getAreaState(state: Record<string, unknown>): AreaMajorityState | undefined {
  return state.areaMajority as AreaMajorityState | undefined;
}

/**
 * Determine rankings for an area by influence count
 */
function getAreaRankings(areaInfluence: AreaInfluence): Array<{ playerId: string; influence: number; rank: number }> {
  const entries = Object.entries(areaInfluence.influence)
    .filter(([, count]) => count > 0)
    .sort((a, b) => b[1] - a[1]);

  const rankings: Array<{ playerId: string; influence: number; rank: number }> = [];
  let currentRank = 1;

  for (let i = 0; i < entries.length; i++) {
    if (i > 0 && entries[i][1] < entries[i - 1][1]) {
      currentRank = i + 1;
    }
    rankings.push({
      playerId: entries[i][0],
      influence: entries[i][1],
      rank: currentRank
    });
  }

  return rankings;
}

export const areaMajorityInfluenceMechanic: MechanicHooks = {
  slug: 'area-majority-influence',
  name: 'Area Majority / Influence',
  requires: ['board'],

  configSchema: {
    type: 'object',
    description: 'Compete for majority control in areas for points',
    properties: {
      areas: {
        type: 'array',
        description: 'Area definitions with id, name, points array, and optional max_influence',
        required: true
      },
      influence_resource: {
        type: 'string',
        description: 'Resource spent to place influence (optional)'
      }
    },
    required: ['areas']
  },

  /**
   * Create influence tracker per area
   */
  initSharedState(ctx: SharedStateInitContext): SharedStateInitResult | null {
    const config = getConfig(ctx.config);
    if (!config?.areas?.length) return null;

    const areas: AreaInfluence[] = config.areas.map(area => ({
      areaId: area.id,
      influence: {},
      totalInfluence: 0
    }));

    const areaState: AreaMajorityState = { areas };

    return { areaMajority: areaState };
  },

  /**
   * Provide 'place_influence' action for each available area
   */
  getAvailableActions(ctx: HookContext): AvailableAction[] {
    if (!isMechanicEnabled(ctx.config, 'area-majority-influence')) return [];

    const config = getConfig(ctx.config);
    if (!config?.areas?.length) return [];

    const areaState = getAreaState(ctx.state.shared);
    if (!areaState) return [];

    const actions: AvailableAction[] = [];

    // Check if player has the required resource (if configured)
    if (config.influence_resource) {
      const available = ctx.player.resources?.[config.influence_resource] ?? 0;
      if (available <= 0) return [];
    }

    for (const areaDef of config.areas) {
      const areaInf = areaState.areas.find(a => a.areaId === areaDef.id);
      if (!areaInf) continue;

      // Check max influence for the area
      if (areaDef.max_influence !== undefined && areaInf.totalInfluence >= areaDef.max_influence) {
        continue;
      }

      actions.push({
        action: {
          type: 'place_influence',
          areaId: areaDef.id
        } as unknown as GameAction,
        priority: 50,
        category: 'area-majority'
      });
    }

    return actions;
  },

  /**
   * Handle influence placement
   */
  onExecuteAction(ctx: ActionExecutionContext): ActionExecutionResult | null {
    if (ctx.action.type !== 'place_influence') return null;

    const config = getConfig(ctx.config);
    if (!config?.areas?.length) return null;

    const placeAction = ctx.action as unknown as { type: 'place_influence'; areaId: string; amount?: number };
    const areaId = placeAction.areaId;
    const amount = placeAction.amount ?? 1;

    // Validate area exists
    const areaDef = config.areas.find(a => a.id === areaId);
    if (!areaDef) {
      return {
        handled: true,
        logMessage: `Invalid area: ${areaId}`,
        advanceTurn: false,
        checkWin: false
      };
    }

    const areaState = getAreaState(ctx.state.shared);
    if (!areaState) return null;

    const areaInf = areaState.areas.find(a => a.areaId === areaId);
    if (!areaInf) return null;

    // Check max influence
    if (areaDef.max_influence !== undefined && areaInf.totalInfluence + amount > areaDef.max_influence) {
      return {
        handled: true,
        logMessage: `Area ${areaDef.name} is at maximum influence capacity.`,
        advanceTurn: false,
        checkWin: false
      };
    }

    // Deduct resource cost if configured
    const stateChanges: StateChanges = {};
    if (config.influence_resource) {
      const currentAmount = ctx.player.resources?.[config.influence_resource] ?? 0;
      if (currentAmount < amount) {
        return {
          handled: true,
          logMessage: `Not enough ${config.influence_resource} to place influence.`,
          advanceTurn: false,
          checkWin: false
        };
      }

      const updatedResources = { ...(ctx.state.players[ctx.playerId].resources ?? {}) };
      updatedResources[config.influence_resource] = currentAmount - amount;
      stateChanges.playerStateChanges = {
        [ctx.playerId]: { resources: updatedResources }
      };
    }

    // Update influence in area
    const updatedAreas = areaState.areas.map(a => {
      if (a.areaId !== areaId) return a;
      const newInfluence = { ...a.influence };
      newInfluence[ctx.playerId] = (newInfluence[ctx.playerId] ?? 0) + amount;
      return {
        ...a,
        influence: newInfluence,
        totalInfluence: a.totalInfluence + amount
      };
    });

    stateChanges.sharedStateChanges = {
      areaMajority: { areas: updatedAreas }
    };

    return {
      handled: true,
      stateChanges,
      advanceTurn: false,
      checkWin: true,
      logMessage: 'influence_placed',
      logData: {
        player: ctx.playerId,
        area: areaId,
        areaName: areaDef.name,
        amount
      }
    };
  },

  /**
   * Show area control in player view
   */
  getPlayerView(ctx: HookContext): Record<string, unknown> | null {
    if (!isMechanicEnabled(ctx.config, 'area-majority-influence')) return null;

    const config = getConfig(ctx.config);
    if (!config?.areas?.length) return null;

    const areaState = getAreaState(ctx.state.shared);
    if (!areaState) return null;

    const areaControl: Array<{
      areaId: string;
      areaName: string;
      influence: Record<string, number>;
      leader: string | null;
      myInfluence: number;
      pointsAvailable: number[];
    }> = [];

    for (const areaDef of config.areas) {
      const areaInf = areaState.areas.find(a => a.areaId === areaDef.id);
      if (!areaInf) continue;

      const rankings = getAreaRankings(areaInf);
      const leader = rankings.length > 0 ? rankings[0].playerId : null;
      const myInfluence = areaInf.influence[ctx.playerId] ?? 0;

      areaControl.push({
        areaId: areaDef.id,
        areaName: areaDef.name,
        influence: areaInf.influence,
        leader,
        myInfluence,
        pointsAvailable: areaDef.points
      });
    }

    return {
      areaControl,
      influenceResource: config.influence_resource ?? null
    };
  }
};
