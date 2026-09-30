/**
 * Turn Order: Pass Order Mechanic
 *
 * Turn order for next round is determined by pass order from current round.
 * First to pass goes first next round. Common in worker placement games.
 * Examples: Agricola, Caylus, Lords of Waterdeep
 */

import {
  MechanicHooks,
  TurnOrderContext,
  TurnOrderResult,
  HookContext,
  isMechanicEnabled
} from './types';

export interface TurnOrderPassOrderConfig {
  first_passer_first?: boolean;
  track_within_round?: boolean;
  compensation?: PassCompensation;
}

export interface PassCompensation {
  type: 'resource' | 'points' | 'cards';
  resource?: string;
  base_amount?: number;
  per_position?: number;
}

export const turnOrderPassOrderMechanic: MechanicHooks = {
  slug: 'turn-order-pass-order',
  name: 'Turn Order: Pass Order',

  onDetermineTurnOrder(ctx: TurnOrderContext): TurnOrderResult | null {
    if (!isMechanicEnabled(ctx.config, 'turn-order-pass-order')) return null;
    if (ctx.reason !== 'round_start') return null;

    const config = ctx.config.engine_mechanics?.turn_order_pass_order as TurnOrderPassOrderConfig | undefined;
    const shared = ctx.state.shared as Record<string, unknown> ?? {};
    const lastRoundPassOrder = shared.passOrder as string[] | undefined;

    if (!lastRoundPassOrder || lastRoundPassOrder.length === 0) {
      return null;
    }

    let newOrder: string[];
    if (config?.first_passer_first !== false) {
      newOrder = [...lastRoundPassOrder];
    } else {
      newOrder = [...lastRoundPassOrder].reverse();
    }

    for (const playerId of ctx.currentOrder) {
      if (!newOrder.includes(playerId)) {
        newOrder.push(playerId);
      }
    }

    if (!ctx.state.shared) {
      ctx.state.shared = {};
    }
    (ctx.state.shared as Record<string, unknown>).passOrder = [];
    (ctx.state.shared as Record<string, unknown>).passedPlayers = [];

    return {
      order: newOrder
    };
  },

  onPassPriority(ctx: HookContext): { nextPlayer?: string; removeFromRound?: boolean } | null {
    if (!isMechanicEnabled(ctx.config, 'turn-order-pass-order')) return null;

    const config = ctx.config.engine_mechanics?.turn_order_pass_order as TurnOrderPassOrderConfig | undefined;

    if (!ctx.state.shared) {
      ctx.state.shared = {};
    }
    const shared = ctx.state.shared as Record<string, unknown>;

    if (!shared.passOrder) {
      shared.passOrder = [];
    }
    if (!shared.passedPlayers) {
      shared.passedPlayers = [];
    }

    const passOrder = shared.passOrder as string[];
    const passedPlayers = shared.passedPlayers as string[];

    if (!passOrder.includes(ctx.playerId)) {
      passOrder.push(ctx.playerId);
      passedPlayers.push(ctx.playerId);
    }

    if (config?.compensation) {
      const position = passOrder.length;
      const amount = (config.compensation.base_amount ?? 0) +
                     (config.compensation.per_position ?? 0) * (passOrder.length - position);

      if (amount > 0) {
        const player = ctx.state.players[ctx.playerId];
        if (player && config.compensation.type === 'resource' && config.compensation.resource) {
          if (!player.resources) {
            player.resources = {};
          }
          player.resources[config.compensation.resource] =
            (player.resources[config.compensation.resource] ?? 0) + amount;
        } else if (player && config.compensation.type === 'points') {
          player.score = (player.score ?? 0) + amount;
        }
      }
    }

    const activePlayers = ctx.state.turnOrder?.filter(p => !passedPlayers.includes(p)) ?? [];

    if (activePlayers.length === 0) {
      return { removeFromRound: true };
    }

    const currentIndex = ctx.state.turnOrder?.indexOf(ctx.playerId) ?? -1;
    for (let i = 1; i <= (ctx.state.turnOrder?.length ?? 0); i++) {
      const nextIndex = (currentIndex + i) % (ctx.state.turnOrder?.length ?? 1);
      const nextPlayer = ctx.state.turnOrder?.[nextIndex];
      if (nextPlayer && activePlayers.includes(nextPlayer)) {
        return { nextPlayer, removeFromRound: true };
      }
    }

    return { removeFromRound: true };
  },

  describeAction() {
    return null;
  },

  configSchema: {
    type: 'object',
    description: 'Turn order determined by pass order from previous round.'
  }
};
