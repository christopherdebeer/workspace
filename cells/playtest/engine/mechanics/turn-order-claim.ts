/**
 * Turn Order Claim Action Mechanic
 *
 * Players can take an action to claim a specific turn order position.
 * First to claim a position gets it.
 *
 * Config:
 *   turn_order_claim:
 *     cost: Record<string, number>  # Resource cost to claim (optional)
 *     positions_available: number   # How many positions can be claimed
 *     reset_each_round: boolean     # Whether positions reset each round
 *
 * Hooks used:
 * - onDetermineTurnOrder: Apply claimed positions at round start
 * - onExecuteAction: Handle claim action
 * - getAvailableActions: Expose claim action
 */

import { MechanicHooks, HookContext, ValidationResult, ActionExecutionContext, ActionExecutionResult, AvailableAction, TurnOrderContext, TurnOrderResult, StateChanges, TurnStartContext } from './types';
import { GameAction, ClaimTurnPositionAction, TurnOrderClaimConfig } from '../types/game';

interface TurnOrderClaims {
  claims: Record<number, string>;
  round: number;
}

export const turnOrderClaimMechanic: MechanicHooks = {
  slug: 'turn-order-claim-action',
  name: 'Turn Order: Claim Action',

  configSchema: {
    type: 'object',
    description: 'Claim turn order positions through actions',
    properties: {
      cost: {
        type: 'object',
        description: 'Resource cost to claim a position'
      },
      positions_available: {
        type: 'number',
        description: 'Number of claimable positions',
        default: 3
      },
      reset_each_round: {
        type: 'boolean',
        description: 'Whether claims reset each round',
        default: true
      }
    }
  },

  preValidateAction(ctx: HookContext, action: GameAction): ValidationResult | null {
    if (action.type !== 'claim_turn_position') return null;

    const config = ctx.config.engine_mechanics?.turn_order_claim;
    if (!config) {
      return { valid: false, error: 'Turn order claiming is not enabled.' };
    }

    const claimAction = action as ClaimTurnPositionAction;
    const claims = ctx.state.shared.turnOrderClaims as TurnOrderClaims | undefined;
    const maxPositions = config.positions_available ?? 3;

    // Validate position range
    if (claimAction.position < 0 || claimAction.position >= maxPositions) {
      return { valid: false, error: `Position must be between 0 and ${maxPositions - 1}.` };
    }

    // Check if position already claimed
    if (claims?.claims[claimAction.position]) {
      return { valid: false, error: `Position ${claimAction.position + 1} is already claimed.` };
    }

    // Check if player already has a claim
    if (claims) {
      const playerClaim = Object.entries(claims.claims).find(([_, pid]) => pid === ctx.playerId);
      if (playerClaim) {
        return { valid: false, error: 'You have already claimed a position this round.' };
      }
    }

    // Check cost
    if (config.cost) {
      for (const [resource, amount] of Object.entries(config.cost)) {
        const available = ctx.player.resources?.[resource] ?? 0;
        if (available < amount) {
          return { valid: false, error: `Not enough ${resource}. Need ${amount}, have ${available}.` };
        }
      }
    }

    return { valid: true };
  },

  onExecuteAction(ctx: ActionExecutionContext): ActionExecutionResult | null {
    const { action, state, playerId } = ctx;
    if (action.type !== 'claim_turn_position') return null;

    const config = ctx.config.engine_mechanics?.turn_order_claim;
    if (!config) return null;

    const claimAction = action as ClaimTurnPositionAction;

    // Get or create claims
    let claims = state.shared.turnOrderClaims as TurnOrderClaims | undefined;
    if (!claims) {
      claims = { claims: {}, round: state.round };
    }

    // Record claim
    claims.claims[claimAction.position] = playerId;

    const stateChanges: StateChanges = {
      sharedStateChanges: { turnOrderClaims: claims }
    };

    // Deduct cost
    if (config.cost) {
      const playerResources = { ...state.players[playerId].resources };
      for (const [resource, amount] of Object.entries(config.cost)) {
        playerResources[resource] = (playerResources[resource] ?? 0) - amount;
      }
      stateChanges.playerStateChanges = {
        [playerId]: { resources: playerResources }
      };
    }

    return {
      handled: true,
      stateChanges,
      advanceTurn: true,
      checkWin: false,
      logMessage: `${playerId} claimed turn position ${claimAction.position + 1}`
    };
  },

  onDetermineTurnOrder(ctx: TurnOrderContext): TurnOrderResult | null {
    const config = ctx.config.engine_mechanics?.turn_order_claim;
    if (!config) return null;

    if (ctx.reason !== 'round_start') return null;

    const claims = ctx.state.shared.turnOrderClaims as TurnOrderClaims | undefined;
    if (!claims || Object.keys(claims.claims).length === 0) return null;

    // Build new order based on claims
    const maxPositions = config.positions_available ?? 3;
    const activePlayers = ctx.currentOrder.filter(
      pid => ctx.state.players[pid].state !== 'eliminated'
    );

    const newOrder: (string | null)[] = new Array(maxPositions).fill(null);
    const unclaimedPlayers: string[] = [];

    // Place claimed players
    for (const pid of activePlayers) {
      const claimedPosition = Object.entries(claims.claims)
        .find(([_, claimPid]) => claimPid === pid);

      if (claimedPosition) {
        newOrder[parseInt(claimedPosition[0])] = pid;
      } else {
        unclaimedPlayers.push(pid);
      }
    }

    // Fill remaining positions with unclaimed players in current order
    let unclaimedIndex = 0;
    for (let i = 0; i < newOrder.length && unclaimedIndex < unclaimedPlayers.length; i++) {
      if (newOrder[i] === null) {
        newOrder[i] = unclaimedPlayers[unclaimedIndex++];
      }
    }

    // Add any remaining unclaimed players
    while (unclaimedIndex < unclaimedPlayers.length) {
      newOrder.push(unclaimedPlayers[unclaimedIndex++]);
    }

    // Filter out null values and return
    return { order: newOrder.filter((p): p is string => p !== null) };
  },

  onTurnStart(ctx: TurnStartContext): StateChanges | null {
    const config = ctx.config.engine_mechanics?.turn_order_claim;
    if (!config) return null;

    // Reset claims at round start if configured
    if (ctx.isNewRound && config.reset_each_round !== false) {
      return {
        sharedStateChanges: {
          turnOrderClaims: { claims: {}, round: ctx.state.round }
        }
      };
    }

    return null;
  },

  getAvailableActions(ctx: HookContext): AvailableAction[] {
    const config = ctx.config.engine_mechanics?.turn_order_claim;
    if (!config) return [];

    const claims = ctx.state.shared.turnOrderClaims as TurnOrderClaims | undefined;
    const maxPositions = config.positions_available ?? 3;

    // Check if player already claimed
    if (claims) {
      const playerClaim = Object.values(claims.claims).includes(ctx.playerId);
      if (playerClaim) return [];
    }

    // Check if player can afford
    if (config.cost) {
      for (const [resource, amount] of Object.entries(config.cost)) {
        if ((ctx.player.resources?.[resource] ?? 0) < amount) {
          return [];
        }
      }
    }

    // Return available positions
    const actions: AvailableAction[] = [];
    for (let pos = 0; pos < maxPositions; pos++) {
      if (!claims?.claims[pos]) {
        actions.push({
          action: {
            type: 'claim_turn_position',
            position: pos
          } as ClaimTurnPositionAction,
          priority: 60,
          category: 'turn_order'
        });
      }
    }

    return actions;
  }
};
