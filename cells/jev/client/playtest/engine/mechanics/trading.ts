/**
 * Trading Mechanic
 *
 * Player-to-player trading system with configurable constraints.
 * Supports location requirements, item-only trading, and gift restrictions.
 *
 * Hooks used:
 * - preValidateAction: Validate trade_offer and trade_respond actions
 * - onExecuteAction: Handle trade execution
 * - getAvailableActions: Expose trade_offer and trade_respond actions
 * - describeAction: Describe trade actions
 * - canPlayerActNow: Allow out-of-turn trade responses
 */

import {
  MechanicHooks,
  HookContext,
  ValidationResult,
  ActionExecutionContext,
  ActionExecutionResult,
  AvailableAction,
  ActionDescription,
  SharedStateInitContext,
  SharedStateInitResult,
  ActionSchema,
  isMechanicEnabled
} from './types';
import { GameAction, TradeOfferAction, TradeRespondAction } from '../types/game';
import { removeCardsFromHand, addToHand } from './core/hand';

interface TradeConfig {
  enabled?: boolean;
  require_same_location?: boolean;
  require_adjacent_location?: boolean;
  item_types_only?: boolean;
  allow_gifts?: boolean;
}

interface PendingTrade {
  id: string;
  from: string;
  to: string;
  offer: string[];
  request: string[];
  timestamp: string;
  expiresAtTurn: number;
}

export const tradingMechanic: MechanicHooks = {
  slug: 'trading',
  name: 'Trading',

  configSchema: {
    type: 'object',
    description: 'Player-to-player trading with configurable constraints',
    properties: {
      enabled: {
        type: 'boolean',
        description: 'Whether trading is enabled',
        default: true
      },
      require_same_location: {
        type: 'boolean',
        description: 'Players must be at same location to trade'
      },
      require_adjacent_location: {
        type: 'boolean',
        description: 'Players must be at adjacent locations to trade'
      },
      item_types_only: {
        type: 'boolean',
        description: 'Only cards with type "item" can be traded'
      },
      allow_gifts: {
        type: 'boolean',
        description: 'Allow one-sided trades (giving without receiving)'
      }
    }
  },

  getActionSchema(action: GameAction): ActionSchema | null {
    if (action.type === 'trade_offer') {
      return {
        required: ['target', 'offer', 'request'],
        fields: {
          target: { type: 'string' },
          offer: { type: 'array' },
          request: { type: 'array' },
        },
      };
    }
    if (action.type === 'trade_respond') {
      return {
        required: ['offerId', 'accept'],
        fields: {
          offerId: { type: 'string' },
          accept: { type: 'boolean' },
        },
      };
    }
    return null;
  },

  /**
   * Initialize shared state with empty pendingTrades array
   */
  initSharedState(ctx: SharedStateInitContext): SharedStateInitResult | null {
    if (!isMechanicEnabled(ctx.config, 'trading')) return null;

    return {
      pendingTrades: []
    };
  },

  preValidateAction(ctx: HookContext, action: GameAction): ValidationResult | null {
    if (action.type === 'trade_offer') {
      return validateTradeOffer(ctx, action as TradeOfferAction);
    }

    if (action.type === 'trade_respond') {
      return validateTradeRespond(ctx, action as TradeRespondAction);
    }

    return null;
  },

  onExecuteAction(ctx: ActionExecutionContext): ActionExecutionResult | null {
    const { action, player, playerId, state } = ctx;

    if (action.type === 'trade_offer') {
      return executeTradeOffer(ctx, action as TradeOfferAction);
    }

    if (action.type === 'trade_respond') {
      return executeTradeRespond(ctx, action as TradeRespondAction);
    }

    return null;
  },

  getAvailableActions(ctx: HookContext): AvailableAction[] {
    const tradeConfig = ctx.config.engine_mechanics?.trade as TradeConfig | undefined;
    if (!tradeConfig?.enabled) return [];

    const actions: AvailableAction[] = [];

    // Get tradeable cards from player's hand
    const tradeableCards = (ctx.player.hand ?? [])
      .filter(c => !tradeConfig.item_types_only || c.type === 'item')
      .map(c => c.name);

    if (tradeableCards.length > 0) {
      // Find valid trade targets
      const validTargets = Object.entries(ctx.state.players)
        .filter(([id, p]) => {
          if (id === ctx.playerId) return false;
          if (tradeConfig.require_same_location && p.state !== ctx.player.state) return false;
          return true;
        })
        .map(([id]) => id);

      if (validTargets.length > 0) {
        const target = validTargets[0];
        const targetPlayer = ctx.state.players[target];
        const targetCards = (targetPlayer.hand ?? [])
          .filter(c => !tradeConfig.item_types_only || c.type === 'item')
          .map(c => c.name);

        actions.push({
          action: {
            type: 'trade_offer',
            target,
            offer: tradeableCards.slice(0, 1),
            request: targetCards.slice(0, 1)
          } as GameAction,
          priority: 30,
          category: 'trading'
        });
      }
    }

    // Add trade_respond actions for pending trades directed at this player
    const pendingTrades = (ctx.state.shared.pendingTrades as PendingTrade[]) || [];
    const myPendingTrades = pendingTrades.filter(t => t.to === ctx.playerId);

    for (const trade of myPendingTrades) {
      actions.push({
        action: {
          type: 'trade_respond',
          offerId: trade.id,
          accept: true
        } as GameAction,
        priority: 60, // High priority - respond to pending trades
        category: 'trading'
      });
    }

    return actions;
  },

  describeAction(action: GameAction): ActionDescription | null {
    if (action.type === 'trade_offer') {
      return {
        type: 'trade_offer',
        label: 'Offer Trade',
        description: 'Propose a trade with another player.',
        examples: ['trade_offer target:"player2" offer:["Gold Coin"] request:["Map"]']
      };
    }

    if (action.type === 'trade_respond') {
      return {
        type: 'trade_respond',
        label: 'Respond to Trade',
        description: 'Accept or decline a pending trade offer.',
        examples: ['trade_respond offerId:"trade-123" accept:true']
      };
    }

    return null;
  },

  /**
   * Allow players to respond to trade offers out of turn.
   * Returns true if the player has pending trades directed at them.
   */
  canPlayerActNow(ctx: HookContext): boolean | null {
    if (!isMechanicEnabled(ctx.config, 'trading')) return null;

    const pendingTrades = (ctx.state.shared.pendingTrades as PendingTrade[]) || [];
    const hasPendingTrades = pendingTrades.some(t => t.to === ctx.playerId);

    // Allow out-of-turn action only if player has pending trades to respond to
    return hasPendingTrades ? true : null;
  }
};

function validateTradeOffer(ctx: HookContext, action: TradeOfferAction): ValidationResult | null {
  const tradeConfig = ctx.config.engine_mechanics?.trade as TradeConfig | undefined;

  // Check if trading is enabled
  if (!tradeConfig?.enabled) {
    return { valid: false, error: 'Trading is not enabled for this game.' };
  }

  // Validate target player exists
  if (!ctx.state.players[action.target]) {
    return { valid: false, error: `Invalid trade target "${action.target}". Player not found.` };
  }

  if (action.target === ctx.playerId) {
    return { valid: false, error: 'Cannot trade with yourself.' };
  }

  // Check location constraints
  if (tradeConfig.require_same_location) {
    const targetPlayer = ctx.state.players[action.target];
    if (ctx.player.state !== targetPlayer.state) {
      return {
        valid: false,
        error: `Cannot trade with ${action.target}. You must be at the same location. You are at "${ctx.player.state}", they are at "${targetPlayer.state}".`
      };
    }
  }

  // Validate offered cards exist in player's hand
  const playerHand = ctx.player.hand ?? [];
  for (const cardName of action.offer) {
    const card = playerHand.find(c => c.name === cardName);
    if (!card) {
      return { valid: false, error: `Card "${cardName}" not in your hand. Cannot offer it.` };
    }
    if (tradeConfig.item_types_only && card.type !== 'item') {
      return { valid: false, error: `Card "${cardName}" is not an item. Only items can be traded.` };
    }
  }

  // Validate requested cards exist in target's hand
  const targetPlayer = ctx.state.players[action.target];
  const targetHand = targetPlayer.hand ?? [];
  for (const cardName of action.request) {
    const card = targetHand.find(c => c.name === cardName);
    if (!card) {
      return { valid: false, error: `Card "${cardName}" not in ${action.target}'s hand. Cannot request it.` };
    }
    if (tradeConfig.item_types_only && card.type !== 'item') {
      return { valid: false, error: `Card "${cardName}" is not an item. Only items can be traded.` };
    }
  }

  // Check if gifts are allowed
  if (action.request.length === 0 && !tradeConfig.allow_gifts) {
    return { valid: false, error: 'One-sided trades (gifts) are not allowed. You must request something in return.' };
  }

  if (action.offer.length === 0) {
    return { valid: false, error: 'You must offer at least one card to trade.' };
  }

  return { valid: true };
}

function validateTradeRespond(ctx: HookContext, action: TradeRespondAction): ValidationResult | null {
  const pendingTrades = (ctx.state.shared.pendingTrades as PendingTrade[]) || [];
  const trade = pendingTrades.find(t => t.id === action.offerId);

  if (!trade) {
    return { valid: false, error: `Trade offer "${action.offerId}" not found or has expired.` };
  }

  if (trade.to !== ctx.playerId) {
    return { valid: false, error: `This trade offer is not for you. It was sent to ${trade.to}.` };
  }

  // If accepting, verify both players still have the cards
  if (action.accept) {
    const fromPlayer = ctx.state.players[trade.from];
    const fromPlayerHand = fromPlayer.hand ?? [];

    for (const cardName of trade.offer) {
      if (!fromPlayerHand.find(c => c.name === cardName)) {
        return { valid: false, error: `Offerer no longer has card "${cardName}". Trade cannot be completed.` };
      }
    }

    const responderHand = ctx.player.hand ?? [];
    for (const cardName of trade.request) {
      if (!responderHand.find(c => c.name === cardName)) {
        return { valid: false, error: `You no longer have card "${cardName}". Trade cannot be completed.` };
      }
    }
  }

  return { valid: true };
}

function executeTradeOffer(ctx: ActionExecutionContext, action: TradeOfferAction): ActionExecutionResult {
  const { playerId, state } = ctx;

  // Generate unique trade ID
  const tradeId = `trade-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

  // Create pending trade
  const pendingTrade: PendingTrade = {
    id: tradeId,
    from: playerId,
    to: action.target,
    offer: action.offer,
    request: action.request,
    timestamp: new Date().toISOString(),
    expiresAtTurn: state.turnNumber + 8  // Expires in 2 full rounds (4 players * 2)
  };

  // Get current pending trades and add new one
  const currentPending = (state.shared.pendingTrades as PendingTrade[]) || [];
  const newPending = [...currentPending, pendingTrade];

  return {
    handled: true,
    stateChanges: {
      sharedStateChanges: {
        pendingTrades: newPending
      }
    },
    advanceTurn: false, // Player may have more actions
    checkWin: false,
    logMessage: 'trade_offered',
    logData: {
      tradeId,
      target: action.target,
      offer: action.offer,
      request: action.request
    }
  };
}

function executeTradeRespond(ctx: ActionExecutionContext, action: TradeRespondAction): ActionExecutionResult {
  const { player, playerId, state } = ctx;

  const pendingTrades = (state.shared.pendingTrades as PendingTrade[]) || [];
  const tradeIndex = pendingTrades.findIndex(t => t.id === action.offerId);
  const trade = pendingTrades[tradeIndex];
  const fromPlayer = state.players[trade.from];

  // Remove the trade from pending
  const newPending = pendingTrades.filter(t => t.id !== action.offerId);

  if (action.accept) {
    // Execute the trade - swap cards between players using core services
    const offeredCards = removeCardsFromHand(state, trade.from, trade.offer);
    addToHand(state, playerId, offeredCards);

    const requestedCards = removeCardsFromHand(state, playerId, trade.request);
    addToHand(state, trade.from, requestedCards);

    // Calculate new completed trades counts
    const responderTrades = (player.completedTrades ?? 0) + 1;
    const offererTrades = (fromPlayer.completedTrades ?? 0) + 1;

    return {
      handled: true,
      stateChanges: {
        sharedStateChanges: {
          pendingTrades: newPending
        },
        playerStateChanges: {
          [playerId]: { completedTrades: responderTrades },
          [trade.from]: { completedTrades: offererTrades }
        }
      },
      advanceTurn: false, // Trade response doesn't use turn
      checkWin: false,
      logMessage: 'trade_completed',
      logData: {
        tradeId: trade.id,
        from: trade.from,
        to: trade.to,
        offer: trade.offer,
        request: trade.request
      }
    };
  } else {
    // Trade declined
    return {
      handled: true,
      stateChanges: {
        sharedStateChanges: {
          pendingTrades: newPending
        }
      },
      advanceTurn: false,
      checkWin: false,
      logMessage: 'trade_declined',
      logData: {
        tradeId: trade.id,
        from: trade.from
      }
    };
  }
}
