/**
 * Connections Mechanic
 *
 * Build links between points on the board. Connected networks score based on size.
 *
 * Hooks used:
 * - initSharedState: Track connections
 * - getAvailableActions: 'build_connection'
 * - onExecuteAction: Build a connection between two nodes
 * - getPlayerView: Show networks
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

interface ConnectionConfig {
  connection_cost?: number;
  points_per_connection?: number;
  max_connections?: number;
}

interface Connection {
  from: string;
  to: string;
  owner: string;
}

interface ConnectionState {
  connections: Connection[];
  availableNodes: string[];
}

function getConfig(config: GameConfig): ConnectionConfig | undefined {
  return config.engine_mechanics?.connections as ConnectionConfig | undefined;
}

function getConnectionState(shared: Record<string, unknown>): ConnectionState | undefined {
  return shared.connections as ConnectionState | undefined;
}

export const connectionsMechanic: MechanicHooks = {
  slug: 'connections',
  name: 'Connections',
  requires: ['building'],

  configSchema: {
    type: 'object',
    description: 'Build links between board points',
    properties: {
      connection_cost: { type: 'number', default: 2 },
      points_per_connection: { type: 'number', default: 1 },
      max_connections: { type: 'number', default: 20 }
    }
  },

  initSharedState(ctx: SharedStateInitContext): SharedStateInitResult | null {
    const config = getConfig(ctx.config);
    if (!config) return null;

    return {
      connections: {
        connections: [],
        availableNodes: ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H']
      } as ConnectionState
    };
  },

  getAvailableActions(ctx: HookContext): AvailableAction[] {
    if (!isMechanicEnabled(ctx.config, 'connections')) return [];

    const connState = getConnectionState(ctx.state.shared);
    if (!connState) return [];

    const config = getConfig(ctx.config);
    const maxConn = config?.max_connections ?? 20;
    if (connState.connections.length >= maxConn) return [];

    return [{
      action: {
        type: 'build_connection',
        from: '',
        to: ''
      } as unknown as GameAction,
      priority: 55,
      category: 'connections'
    }];
  },

  onExecuteAction(ctx: ActionExecutionContext): ActionExecutionResult | null {
    if (ctx.action.type !== 'build_connection') return null;

    const config = getConfig(ctx.config);
    if (!config) return null;

    const connState = getConnectionState(ctx.state.shared);
    if (!connState) return null;

    const buildAction = ctx.action as unknown as { type: 'build_connection'; from: string; to: string };
    const { from, to } = buildAction;

    if (!connState.availableNodes.includes(from) || !connState.availableNodes.includes(to)) {
      return { handled: true, logMessage: 'Invalid nodes.', advanceTurn: false, checkWin: false };
    }

    if (from === to) {
      return { handled: true, logMessage: 'Cannot connect node to itself.', advanceTurn: false, checkWin: false };
    }

    // Check if connection already exists
    const exists = connState.connections.some(
      c => (c.from === from && c.to === to) || (c.from === to && c.to === from)
    );
    if (exists) {
      return { handled: true, logMessage: 'Connection already exists.', advanceTurn: false, checkWin: false };
    }

    const cost = config.connection_cost ?? 2;
    const points = config.points_per_connection ?? 1;

    const newConnection: Connection = { from, to, owner: ctx.playerId };

    return {
      handled: true,
      stateChanges: {
        sharedStateChanges: {
          connections: {
            ...connState,
            connections: [...connState.connections, newConnection]
          }
        },
        playerStateChanges: {
          [ctx.playerId]: { score: (ctx.player.score ?? 0) + points - cost }
        }
      },
      advanceTurn: false,
      checkWin: true,
      logMessage: `${ctx.playerId} connected ${from} to ${to}.`,
      logData: { player: ctx.playerId, from, to }
    };
  },

  getPlayerView(ctx: HookContext): Record<string, unknown> | null {
    if (!isMechanicEnabled(ctx.config, 'connections')) return null;

    const connState = getConnectionState(ctx.state.shared);
    if (!connState) return null;

    const myConnections = connState.connections.filter(c => c.owner === ctx.playerId);
    return {
      myConnections: myConnections.length,
      allConnections: connState.connections,
      availableNodes: connState.availableNodes
    };
  }
};
