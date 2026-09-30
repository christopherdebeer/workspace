/**
 * Network and Route Building Mechanic
 *
 * Players build connections between points on a board to form routes/networks.
 * Completed routes score points, longest network bonuses possible.
 * Examples: Ticket to Ride, Power Grid, Brass
 *
 * Requires: building (core mechanic)
 *
 * Hooks used:
 * - initSharedState: Set up route cards, connection map
 * - initPlayerState: Player's claimed routes, route cards
 * - getAvailableActions: 'claim_route' action
 * - onExecuteAction: Handle route claiming, check completion
 * - getPlayerView: Show routes and network
 */

import {
  MechanicHooks,
  HookContext,
  AvailableAction,
  ActionExecutionContext,
  ActionExecutionResult,
  SharedStateInitContext,
  SharedStateInitResult,
  PlayerInitContext,
  PlayerInitResult,
} from './types';
import type { BuildingDefinedHooks } from './core/building-mechanic';
import { GameAction, ClaimRouteAction, PlayerState } from '../types/game';

interface RouteSegment {
  id: string;
  from: string;
  to: string;
  cost: number | Record<string, number>;
  color?: string;
  points?: number;
  length?: number;
}

interface RouteCard {
  id: string;
  from: string;
  to: string;
  points: number;
}

interface NetworkBuildingConfig {
  segments: RouteSegment[];
  route_cards?: RouteCard[];
  starting_route_cards?: number;
  longest_network_bonus?: number;
  resource?: string;            // Resource used to claim routes
  allow_parallel?: boolean;     // Multiple players can claim same route (default false)
}

export const networkAndRouteBuildingMechanic: MechanicHooks & BuildingDefinedHooks = {
  slug: 'network-and-route-building',
  name: 'Network and Route Building',
  requires: ['building'],

  configSchema: {
    type: 'object',
    description: 'Build connections between points to form networks',
    properties: {
      segments: { type: 'array', description: 'Route segments on the board', required: true },
      route_cards: { type: 'array', description: 'Secret route objective cards' },
      starting_route_cards: { type: 'number', default: 3 },
      longest_network_bonus: { type: 'number', description: 'Bonus for longest network' },
      resource: { type: 'string', description: 'Resource to spend for claiming' },
    },
    required: ['segments'],
  },

  initSharedState(ctx: SharedStateInitContext): SharedStateInitResult | null {
    const config = ctx.config.engine_mechanics?.network_and_route_building as NetworkBuildingConfig | undefined;
    if (!config) return {};

    return {
      routeSegments: config.segments.map(s => ({ ...s, claimedBy: null as string | null })),
      routeCardDeck: config.route_cards ? [...config.route_cards] : [],
    };
  },

  initPlayerState(ctx: PlayerInitContext): PlayerInitResult | null {
    const config = ctx.config.engine_mechanics?.network_and_route_building as NetworkBuildingConfig | undefined;
    if (!config) return {};

    return {
      claimedRoutes: [] as string[],
      routeCards: [] as string[],
      networkSize: 0,
    };
  },

  getAvailableActions(ctx: HookContext): AvailableAction[] {
    const config = ctx.config.engine_mechanics?.network_and_route_building as NetworkBuildingConfig | undefined;
    if (!config) return [];

    const shared = ctx.state.shared as Record<string, unknown>;
    const segments = (shared.routeSegments || []) as Array<RouteSegment & { claimedBy: string | null }>;
    const actions: AvailableAction[] = [];

    for (const segment of segments) {
      // Skip claimed routes (unless parallel allowed)
      if (segment.claimedBy !== null && config.allow_parallel !== true) continue;
      // Don't claim your own route twice
      if (segment.claimedBy === ctx.playerId) continue;

      // Check if player can afford
      if (config.resource && typeof segment.cost === 'number') {
        const resources = (ctx.player.resources as Record<string, number>) || {};
        if ((resources[config.resource] || 0) < segment.cost) continue;
      }

      actions.push({
        action: {
          type: 'claim_route',
          routeId: segment.id,
        } as GameAction,
        category: 'routes',
      });
    }

    return actions;
  },

  onExecuteAction(ctx: ActionExecutionContext): ActionExecutionResult | null {
    if (ctx.action.type !== 'claim_route') return null;

    const config = ctx.config.engine_mechanics?.network_and_route_building as NetworkBuildingConfig | undefined;
    if (!config) return null;

    const segmentId = (ctx.action as ClaimRouteAction).routeId;
    const shared = ctx.state.shared as Record<string, unknown>;
    const segments = [...((shared.routeSegments || []) as Array<RouteSegment & { claimedBy: string | null }>)];
    const segIdx = segments.findIndex(s => s.id === segmentId);

    if (segIdx === -1) return null;

    const segment = { ...segments[segIdx] };
    segment.claimedBy = ctx.playerId;
    segments[segIdx] = segment;

    // Update player state
    const player = ctx.state.players[ctx.playerId];
    const claimedRoutes = [...((player?.claimedRoutes as string[]) || []), segmentId];

    // Calculate score from segment
    const points = segment.points || segment.length || 1;

    // Deduct cost
    const playerChanges: Partial<PlayerState> = {
      claimedRoutes,
      score: (player?.score || 0) + points,
    };

    if (config.resource && typeof segment.cost === 'number') {
      const resources = { ...((player?.resources as Record<string, number>) || {}) };
      resources[config.resource] = (resources[config.resource] || 0) - segment.cost;
      playerChanges.resources = resources;
    }

    return {
      handled: true,
      stateChanges: {
        playerStateChanges: {
          [ctx.playerId]: playerChanges,
        },
        sharedStateChanges: { routeSegments: segments },
      },
      advanceTurn: false,
      checkWin: true,
      logMessage: `claimed route ${segment.from} → ${segment.to} (+${points} points)`,
    };
  },

  getPlayerView(ctx: HookContext): Record<string, unknown> {
    const config = ctx.config.engine_mechanics?.network_and_route_building as NetworkBuildingConfig | undefined;
    if (!config) return {};

    const shared = ctx.state.shared as Record<string, unknown>;
    return {
      routeSegments: shared.routeSegments,
      myRouteCards: ctx.player.routeCards || [],
      claimedRoutes: ctx.player.claimedRoutes || [],
    };
  },
};
