/**
 * Point-to-Point Movement Mechanic
 *
 * Movement between nodes/locations connected by explicit connections/routes.
 * Unlike area movement (named regions with adjacency), point-to-point uses
 * a graph of nodes connected by edges (routes).
 *
 * Common in: Ticket to Ride, Pandemic, Power Grid
 *
 * Features:
 * - Named nodes/locations
 * - Explicit routes/connections between nodes
 * - Route costs (travel time, resources required)
 * - Route ownership (claimed routes)
 * - One-way vs bidirectional routes
 *
 * Hooks used:
 * - preValidateAction: Validate move is along valid route
 * - onExecuteAction: Execute point-to-point movement
 * - getAvailableActions: List valid destinations
 * - initPlayerState: Set starting location
 */

import {
  MechanicHooks,
  HookContext,
  ValidationResult,
  ActionExecutionContext,
  ActionExecutionResult,
  AvailableAction,
  PlayerInitContext,
  PlayerInitResult,
  ActionDescription,
  EffectContext,
  EffectApplicationResult
} from './types';
import { GameAction } from '../types/game';
import { spendResource } from './core/resources';

interface NodeDefinition {
  /** Unique node identifier */
  id: string;
  /** Display name */
  name?: string;
  /** Node type (city, station, port, etc.) */
  type?: string;
  /** Special properties */
  properties?: Record<string, unknown>;
}

interface RouteDefinition {
  /** Route identifier */
  id?: string;
  /** Starting node */
  from: string;
  /** Ending node */
  to: string;
  /** Whether route is bidirectional (default: true) */
  bidirectional?: boolean;
  /** Cost to travel this route */
  cost?: number;
  /** Resource required to use route */
  resource_cost?: Record<string, number>;
  /** Owner player ID (for claimed routes) */
  owner?: string;
  /** Route type/color (for route-building games) */
  type?: string;
  /** Length/distance */
  length?: number;
  /** Whether route is blocked/unavailable */
  blocked?: boolean;
}

interface PointToPointConfig {
  /** Node definitions */
  nodes: NodeDefinition[];
  /** Route definitions */
  routes: RouteDefinition[];
  /** Starting node ID (or array for multiple start options) */
  starting_node: string | string[];
  /** Whether movement uses movement points */
  use_movement_points?: boolean;
  /** Default route cost if not specified */
  default_cost?: number;
  /** Whether only route owner can use claimed routes */
  exclusive_routes?: boolean;
  /** Allow multiple stops per turn */
  multi_stop?: boolean;
  /** Maximum stops per turn (if multi_stop) */
  max_stops?: number;
}

function isPointToPointConfig(config: unknown): config is PointToPointConfig {
  return (
    typeof config === 'object' &&
    config !== null &&
    Array.isArray((config as PointToPointConfig).nodes) &&
    Array.isArray((config as PointToPointConfig).routes) &&
    (config as PointToPointConfig).starting_node !== undefined
  );
}

function getNodeById(config: PointToPointConfig, nodeId: string): NodeDefinition | undefined {
  return config.nodes.find(n => n.id === nodeId);
}

function getRoutesFrom(config: PointToPointConfig, nodeId: string): RouteDefinition[] {
  return config.routes.filter(r => {
    if (r.from === nodeId) return true;
    if (r.bidirectional !== false && r.to === nodeId) return true;
    return false;
  });
}

function findRoute(
  config: PointToPointConfig,
  fromNode: string,
  toNode: string
): RouteDefinition | undefined {
  return config.routes.find(r => {
    if (r.from === fromNode && r.to === toNode) return true;
    if (r.bidirectional !== false && r.from === toNode && r.to === fromNode) return true;
    return false;
  });
}

function getRouteCost(route: RouteDefinition, config: PointToPointConfig): number {
  return route.cost ?? config.default_cost ?? 1;
}

function canUseRoute(
  route: RouteDefinition,
  playerId: string,
  ctx: HookContext,
  config: PointToPointConfig
): { allowed: boolean; reason?: string } {
  // Check if route is blocked
  if (route.blocked) {
    return { allowed: false, reason: 'Route is blocked' };
  }

  // Check exclusive routes (owned by another player)
  if (config.exclusive_routes && route.owner && route.owner !== playerId) {
    return { allowed: false, reason: `Route is owned by ${route.owner}` };
  }

  // Check resource costs
  if (route.resource_cost) {
    for (const [resource, amount] of Object.entries(route.resource_cost)) {
      const available = ctx.player.resources?.[resource] ?? 0;
      if (available < amount) {
        return { allowed: false, reason: `Not enough ${resource}. Need ${amount}, have ${available}` };
      }
    }
  }

  return { allowed: true };
}

function getDestination(route: RouteDefinition, fromNode: string): string {
  // Handle bidirectional routes
  if (route.from === fromNode) return route.to;
  return route.from;
}

export const pointToPointMovementMechanic: MechanicHooks = {
  slug: 'point-to-point-movement',
  name: 'Point-to-Point Movement',
  requires: ['resources'],

  configSchema: {
    type: 'object',
    description: 'Movement between nodes connected by routes (Ticket to Ride, Pandemic)',
    properties: {
      nodes: {
        type: 'array',
        description: 'Node/location definitions',
        required: true
      },
      routes: {
        type: 'array',
        description: 'Route/connection definitions',
        required: true
      },
      starting_node: {
        type: 'string',
        description: 'Starting node ID',
        required: true
      },
      use_movement_points: {
        type: 'boolean',
        description: 'Use movement points system',
        default: false
      },
      default_cost: {
        type: 'number',
        description: 'Default route cost',
        default: 1
      },
      exclusive_routes: {
        type: 'boolean',
        description: 'Only owner can use claimed routes',
        default: false
      },
      multi_stop: {
        type: 'boolean',
        description: 'Allow multiple stops per turn',
        default: false
      },
      max_stops: {
        type: 'number',
        description: 'Maximum stops per turn',
        default: null
      }
    },
    required: ['nodes', 'routes', 'starting_node']
  },

  initPlayerState(ctx: PlayerInitContext): PlayerInitResult | null {
    const p2pConfig = ctx.config.engine_mechanics?.point_to_point_movement;
    if (!isPointToPointConfig(p2pConfig)) return null;

    // Handle multiple start options (assign based on player index)
    let startNode: string;
    if (Array.isArray(p2pConfig.starting_node)) {
      startNode = p2pConfig.starting_node[ctx.playerIndex % p2pConfig.starting_node.length];
    } else {
      startNode = p2pConfig.starting_node;
    }

    return {
      currentNode: startNode,
      stopsThisTurn: 0
    };
  },

  preValidateAction(ctx: HookContext, action: GameAction): ValidationResult | null {
    if (action.type !== 'move' && action.type !== 'travel') return null;

    const p2pConfig = ctx.config.engine_mechanics?.point_to_point_movement;
    if (!isPointToPointConfig(p2pConfig)) return null;

    const moveAction = action as { target: string; route?: string };
    const currentNode = (ctx.player.currentNode as string) ||
      (Array.isArray(p2pConfig.starting_node) ? p2pConfig.starting_node[0] : p2pConfig.starting_node);
    const targetNode = moveAction.target;

    // Check if target node exists
    const targetDef = getNodeById(p2pConfig, targetNode);
    if (!targetDef) {
      const validNodes = p2pConfig.nodes.map(n => n.id).join(', ');
      return {
        valid: false,
        error: `Unknown destination "${targetNode}". Valid locations: ${validNodes}`
      };
    }

    // Check if route exists
    const route = findRoute(p2pConfig, currentNode, targetNode);
    if (!route) {
      const availableRoutes = getRoutesFrom(p2pConfig, currentNode);
      const destinations = availableRoutes.map(r => getDestination(r, currentNode)).join(', ');
      return {
        valid: false,
        error: `No route from "${currentNode}" to "${targetNode}". Available destinations: ${destinations || 'none'}`
      };
    }

    // Check if can use route
    const routeCheck = canUseRoute(route, ctx.playerId, ctx, p2pConfig);
    if (!routeCheck.allowed) {
      return { valid: false, error: routeCheck.reason || 'Cannot use route' };
    }

    // Check movement points if enabled
    if (p2pConfig.use_movement_points) {
      const cost = getRouteCost(route, p2pConfig);
      const available = (ctx.player.movementPoints as number) ?? 0;
      const used = (ctx.player.movementPointsUsed as number) ?? 0;
      const remaining = available - used;

      if (cost > remaining) {
        return {
          valid: false,
          error: `Not enough movement points. Need ${cost}, have ${remaining}`
        };
      }
    }

    // Check multi-stop limits
    if (p2pConfig.multi_stop && p2pConfig.max_stops) {
      const stopsThisTurn = (ctx.player.stopsThisTurn as number) ?? 0;
      if (stopsThisTurn >= p2pConfig.max_stops) {
        return {
          valid: false,
          error: `Maximum stops (${p2pConfig.max_stops}) reached this turn`
        };
      }
    }

    return { valid: true };
  },

  onExecuteAction(ctx: ActionExecutionContext): ActionExecutionResult | null {
    const { action, playerId, player, state } = ctx;

    if (action.type !== 'move' && action.type !== 'travel') return null;

    const p2pConfig = ctx.config.engine_mechanics?.point_to_point_movement;
    if (!isPointToPointConfig(p2pConfig)) return null;

    const moveAction = action as { target: string };
    const targetNode = moveAction.target;
    const startingNode = Array.isArray(p2pConfig.starting_node)
      ? p2pConfig.starting_node[0]
      : p2pConfig.starting_node;
    const previousNode = (player.currentNode as string) || player.state || startingNode;

    const route = findRoute(p2pConfig, previousNode, targetNode)!;
    const cost = getRouteCost(route, p2pConfig);

    const stateChanges: { playerStateChanges: Record<string, Partial<typeof player>> } = {
      playerStateChanges: {
        [playerId]: {
          currentNode: targetNode,
          previousNode,
          // Sync board state so win conditions (race, reach-state) see the current position
          state: targetNode
        }
      }
    };

    // Track movement points if enabled
    if (p2pConfig.use_movement_points) {
      const used = (player.movementPointsUsed as number) ?? 0;
      stateChanges.playerStateChanges[playerId].movementPointsUsed = used + cost;
    }

    // Deduct resource costs via resource service (fires hooks)
    if (route.resource_cost) {
      for (const [resource, amount] of Object.entries(route.resource_cost)) {
        spendResource(state, playerId, resource, amount);
      }
    }

    // Track stops
    const stopsThisTurn = ((player.stopsThisTurn as number) ?? 0) + 1;
    stateChanges.playerStateChanges[playerId].stopsThisTurn = stopsThisTurn;

    const targetDef = getNodeById(p2pConfig, targetNode);

    // Determine if turn should advance
    let advanceTurn = true;
    if (p2pConfig.multi_stop) {
      // Check if can make more stops
      const canContinue = !p2pConfig.max_stops || stopsThisTurn < p2pConfig.max_stops;
      const hasMoreMoves = getRoutesFrom(p2pConfig, targetNode).some(r => {
        const dest = getDestination(r, targetNode);
        const routeOk = canUseRoute(r, playerId, ctx, p2pConfig).allowed;
        if (!routeOk) return false;
        if (p2pConfig.use_movement_points) {
          const remainingPoints = (player.movementPoints as number ?? 0) -
            (player.movementPointsUsed as number ?? 0) - cost;
          return getRouteCost(r, p2pConfig) <= remainingPoints;
        }
        return true;
      });
      advanceTurn = !(canContinue && hasMoreMoves);
    }

    return {
      handled: true,
      stateChanges,
      advanceTurn,
      checkWin: true,
      logMessage: 'point_to_point_move',
      logData: {
        from: previousNode,
        to: targetNode,
        nodeName: targetDef?.name || targetNode,
        cost,
        routeType: route.type
      }
    };
  },

  getAvailableActions(ctx: HookContext): AvailableAction[] {
    const p2pConfig = ctx.config.engine_mechanics?.point_to_point_movement;
    if (!isPointToPointConfig(p2pConfig)) return [];

    const startingNode = Array.isArray(p2pConfig.starting_node)
      ? p2pConfig.starting_node[0]
      : p2pConfig.starting_node;
    const currentNode = (ctx.player.currentNode as string) || ctx.player.state || startingNode;
    const availableRoutes = getRoutesFrom(p2pConfig, currentNode);

    const actions: AvailableAction[] = [];

    for (const route of availableRoutes) {
      const destination = getDestination(route, currentNode);

      // Check if can use route
      const routeCheck = canUseRoute(route, ctx.playerId, ctx, p2pConfig);
      if (!routeCheck.allowed) continue;

      // Check movement points if enabled
      if (p2pConfig.use_movement_points) {
        const cost = getRouteCost(route, p2pConfig);
        const available = (ctx.player.movementPoints as number) ?? 0;
        const used = (ctx.player.movementPointsUsed as number) ?? 0;
        if (cost > available - used) continue;
      }

      // Check multi-stop limits
      if (p2pConfig.multi_stop && p2pConfig.max_stops) {
        const stopsThisTurn = (ctx.player.stopsThisTurn as number) ?? 0;
        if (stopsThisTurn >= p2pConfig.max_stops) continue;
      }

      const destNode = getNodeById(p2pConfig, destination);
      actions.push({
        action: {
          type: 'move',
          target: destination
        } as unknown as GameAction,
        priority: 50,
        category: 'movement'
      });
    }

    return actions;
  },

  describeAction(action: GameAction): ActionDescription | null {
    if (action.type === 'move' || action.type === 'travel') {
      return {
        type: action.type,
        label: 'Travel',
        description: 'Move to a connected location via an available route.',
        examples: ['move target:"Atlanta"', 'travel target:"Chicago"']
      };
    }
    return null;
  },

  /**
   * Apply movement effects from cards (move_forward, move_backward).
   * Follows routes to advance the player N nodes along the track.
   */
  applyEffect(ctx: EffectContext): EffectApplicationResult | null {
    const { effect, playerId, state } = ctx;

    // Only handle movement effects
    if (effect.type !== 'move_forward' && effect.type !== 'move_backward') {
      return null;
    }

    const p2pConfig = state.config.engine_mechanics?.point_to_point_movement;
    if (!isPointToPointConfig(p2pConfig)) return null;

    const player = state.players[playerId];
    if (!player) return null;

    const startingNode = Array.isArray(p2pConfig.starting_node)
      ? p2pConfig.starting_node[0]
      : p2pConfig.starting_node;
    let currentNode = (player.currentNode as string) || startingNode;
    const steps = typeof effect.value === 'number' ? effect.value : 1;

    // Move forward or backward along the route chain
    const isForward = effect.type === 'move_forward';

    for (let i = 0; i < steps; i++) {
      const routes = p2pConfig.routes.filter(r => {
        if (isForward) {
          // Forward: follow from→to direction
          return r.from === currentNode;
        } else {
          // Backward: follow to→from direction (reverse)
          return r.to === currentNode;
        }
      });

      if (routes.length === 0) {
        // No further routes in this direction - stop at current node
        break;
      }

      // Take the first available route (for linear tracks, there's typically one)
      const route = routes[0];
      currentNode = isForward ? route.to : route.from;
    }

    return {
      handled: true,
      stateChanges: {
        playerStateChanges: {
          [playerId]: {
            currentNode,
            previousNode: player.currentNode,
            // Sync board state so win conditions see the current position
            state: currentNode
          }
        }
      },
      logMessage: `Moved ${effect.type === 'move_forward' ? 'forward' : 'backward'} ${steps} to ${currentNode}`
    };
  }
};
