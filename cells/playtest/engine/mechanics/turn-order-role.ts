/**
 * Turn Order Role Mechanic
 *
 * Turn order is determined by player roles. Each role has a priority.
 *
 * Config:
 *   turn_order_role:
 *     role_priorities: Record<string, number>  # role -> priority (higher = earlier)
 *     tie_breaker: 'clockwise' | 'random'
 *
 * Hooks used:
 * - onDetermineTurnOrder: Order by role priority
 */

import { MechanicHooks, TurnOrderContext, TurnOrderResult } from './types';

interface TurnOrderRoleConfig {
  role_priorities: Record<string, number>;
  tie_breaker?: 'clockwise' | 'random';
}

export const turnOrderRoleMechanic: MechanicHooks = {
  slug: 'turn-order-role-order',
  name: 'Turn Order: Role Order',

  configSchema: {
    type: 'object',
    description: 'Turn order determined by player roles',
    properties: {
      role_priorities: {
        type: 'object',
        description: 'Map of role names to priority values (higher = earlier)',
        required: true
      },
      tie_breaker: {
        type: 'string',
        description: 'How to break ties between same-role players',
        enum: ['clockwise', 'random'],
        default: 'clockwise'
      }
    },
    required: ['role_priorities']
  },

  onDetermineTurnOrder(ctx: TurnOrderContext): TurnOrderResult | null {
    const config = ctx.config.engine_mechanics?.turn_order_role as TurnOrderRoleConfig | undefined;
    if (!config) return null;

    if (ctx.reason !== 'round_start') return null;

    const activePlayers = ctx.currentOrder.filter(
      pid => ctx.state.players[pid].state !== 'eliminated'
    );

    // Get role for each player
    const getPlayerRole = (playerId: string): string => {
      const player = ctx.state.players[playerId];
      // Check multiple possible role locations
      return (player as { role?: string }).role ??
             (player as { assignedRole?: string }).assignedRole ??
             (player as { hiddenRole?: string }).hiddenRole ??
             'default';
    };

    const getRolePriority = (role: string): number => {
      return config.role_priorities[role] ?? 0;
    };

    // Sort by role priority (descending - higher priority first)
    const sorted = [...activePlayers].sort((a, b) => {
      const roleA = getPlayerRole(a);
      const roleB = getPlayerRole(b);
      const priorityA = getRolePriority(roleA);
      const priorityB = getRolePriority(roleB);

      if (priorityA !== priorityB) {
        return priorityB - priorityA;  // Higher priority first
      }

      // Tie breaker
      if (config.tie_breaker === 'random') {
        return Math.random() - 0.5;
      }

      // Default: clockwise (original order)
      return ctx.currentOrder.indexOf(a) - ctx.currentOrder.indexOf(b);
    });

    return { order: sorted };
  }
};
