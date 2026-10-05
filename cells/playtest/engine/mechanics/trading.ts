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
  StateChanges,
  TurnStartContext,
  isMechanicEnabled
} from './types';
import { GameAction, TradeOfferAction, TradeRespondAction } from '../types/game';
import { removeCardsFromHand, addToHand } from './core/hand';
import { adjacentPlayers } from './core/tile-map';

/** Every tradeable card name in the game (from the deck definition). */
function tradeableNames(ctx: HookContext): string[] {
  const tradeConfig = ctx.config.engine_mechanics?.trade as TradeConfig | undefined;
  const deck = ((ctx.config.engine_mechanics?.cards as { deck?: Array<{ name: string; type?: string }> } | undefined)?.deck ?? (ctx.config as { deck?: Array<{ name: string; type?: string }> }).deck ?? []);
  return [...new Set(deck.filter((c) => !tradeConfig?.item_types_only || c.type === 'item').map((c) => c.name))];
}

/** Identity of an offer (who, to whom, what for what) — to refuse repeats after a decline. */
function offerKey(from: string, to: string, offer: string[], request: string[]): string {
  return `${from}>${to}:${[...offer].sort().join('+')}=${[...request].sort().join('+')}`;
}

function locationOk(ctx: HookContext, cfg: TradeConfig, other: string): boolean {
  if (cfg.require_same_location && ctx.state.players[other]?.state !== ctx.player.state) return false;
  if (cfg.require_adjacent_location && !adjacentPlayers(ctx.state, ctx.config, ctx.playerId, other)) return false;
  return true;
}

interface TradeConfig {
  enabled?: boolean;
  /** Offers a player may make per turn (default unlimited). */
  max_offers_per_turn?: number;
  /** Whose completed-trade count a trade raises: both sides (default), or only one. */
  counts_for?: 'both' | 'offerer' | 'responder';
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
          give: { type: 'array' },
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
    const pendingTrades = (ctx.state.shared.pendingTrades as PendingTrade[]) || [];

    // Offers are open: you put one of your items on the table and they choose what to give
    // back (or decline) — nobody can name what's in a hidden hand. Named requests
    // (request: [card]) still validate for MCP/agents, but aren't advertised.
    const mine = [...new Set((ctx.player.hand ?? []).filter((c) => !tradeConfig.item_types_only || c.type === 'item').map((c) => c.name))];
    const declined = ((ctx.state.shared.declinedTrades as string[] | undefined) ?? []);
    const offersLeft = tradeConfig.max_offers_per_turn === undefined ? Infinity : tradeConfig.max_offers_per_turn - Number((ctx.player as unknown as { offersThisTurn?: number }).offersThisTurn ?? 0);
    const targets = offersLeft <= 0 ? [] : ctx.state.turnOrder.filter((id) => id !== ctx.playerId && ctx.state.players[id] && !pendingTrades.some((t) => t.from === ctx.playerId && t.to === id) && locationOk(ctx, tradeConfig, id));
    const examples: GameAction[] = [];
    for (const target of targets) for (const give of mine) if (!declined.includes(offerKey(ctx.playerId, target, [give], []))) examples.push({ type: 'trade_offer', target, offer: [give], request: [] } as GameAction);
    if (examples.length) {
      actions.push({
        action: examples[0],
        priority: 30,
        category: 'trading',
        description: 'Offer one of your items to a player; they pick an item to give back, or decline',
        required: { target: 'Another player', offer: 'Items from your hand', request: '[] (open: they choose) or item names' },
        examples,
      });
    }

    // Replies to offers made to you: for an open offer, accept by choosing which of your
    // items to give back; for a named request, accept (if you hold it); or decline.
    const replies: GameAction[] = [];
    const myItems = [...new Set((ctx.player.hand ?? []).filter((c) => !tradeConfig.item_types_only || c.type === 'item').map((c) => c.name))];
    for (const t of pendingTrades.filter((t) => t.to === ctx.playerId)) {
      const base = { type: 'trade_respond', offerId: t.id, from: t.from, youGet: t.offer.join('+') };
      if (t.request.length) replies.push({ ...base, accept: true, youGive: t.request.join('+') } as unknown as GameAction);
      else {
        // An open offer asks for something back: accepting means giving one of your items.
        for (const give of myItems) replies.push({ ...base, accept: true, give: [give] } as unknown as GameAction);
      }
      replies.push({ ...base, accept: false } as unknown as GameAction);
    }
    if (replies.length) {
      actions.push({
        action: replies[0],
        priority: 60,
        category: 'trading',
        description: 'Accept (choosing what you give back) or decline a trade offered to you',
        required: { offerId: 'The offer', accept: 'true or false' },
        examples: replies,
        enabled: true,
      });
    }
    return actions;
  },

  /** An offer lapses when its maker's next turn starts (no stale offers piling up). */
  onTurnStart(ctx: TurnStartContext): StateChanges | null {
    const pending = (ctx.state.shared.pendingTrades as PendingTrade[] | undefined) ?? [];
    ctx.state.shared.pendingTrades = pending.filter((t) => t.from !== ctx.playerId);
    (ctx.state.players[ctx.playerId] as unknown as { offersThisTurn?: number }).offersThisTurn = 0;
    // A declined offer can't be repeated in the same turn; next turn it may be tried again.
    const declined = (ctx.state.shared.declinedTrades as string[] | undefined) ?? [];
    ctx.state.shared.declinedTrades = declined.filter((k) => !k.startsWith(`${ctx.playerId}>`));
    return null;
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

  if (tradeConfig.require_adjacent_location && !adjacentPlayers(ctx.state, ctx.config, ctx.playerId, action.target)) {
    return { valid: false, error: `Cannot trade with ${action.target}: you must be on the same or a neighbouring tile.` };
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

  // Requested cards are named, not looked up in the target's (hidden) hand: the target
  // can only accept if they hold them. The name must be a tradeable card in this game.
  const names = tradeableNames(ctx);
  for (const cardName of action.request) {
    if (names.length && !names.includes(cardName)) {
      return { valid: false, error: `"${cardName}" is not a tradeable card in this game.` };
    }
  }
  if (tradeConfig.max_offers_per_turn !== undefined && Number((ctx.player as unknown as { offersThisTurn?: number }).offersThisTurn ?? 0) >= tradeConfig.max_offers_per_turn) {
    return { valid: false, error: `You can make ${tradeConfig.max_offers_per_turn} trade offer(s) per turn.` };
  }
  if (((ctx.state.shared.declinedTrades as string[] | undefined) ?? []).includes(offerKey(ctx.playerId, action.target, action.offer, action.request ?? []))) {
    return { valid: false, error: `${action.target} just declined that offer — try something else, or again next turn.` };
  }
  const pending = (ctx.state.shared.pendingTrades as PendingTrade[]) || [];
  if (pending.some((t) => t.from === ctx.playerId && t.to === action.target)) {
    return { valid: false, error: `You already have an offer waiting with ${action.target}.` };
  }

  // An empty request is an open offer (the responder chooses an item to give back), not a
  // gift, so it is always allowed.
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

  // If accepting, verify both players (still) have the cards — a decline is always allowed
  if (action.accept) {
    const fromPlayer = ctx.state.players[trade.from];
    const fromPlayerHand = fromPlayer.hand ?? [];

    for (const cardName of trade.offer) {
      if (!fromPlayerHand.find(c => c.name === cardName)) {
        return { valid: false, error: `Offerer no longer has card "${cardName}". Trade cannot be completed.` };
      }
    }

    const responderHand = ctx.player.hand ?? [];
    const give = ((action as unknown as { give?: string[] }).give) ?? [];
    if (!trade.request.length) {
      const tradeConfig = ctx.config.engine_mechanics?.trade as TradeConfig | undefined;
      // (allow_gifts lets an offerer give without asking; it never lets a responder take for free.)
      if (!give.length) return { valid: false, error: 'Choose an item to give back — an open offer asks for something in return.' };
      for (const cardName of give) {
        const card = responderHand.find(c => c.name === cardName);
        if (!card) return { valid: false, error: `You don't have "${cardName}" to give.` };
        if (tradeConfig?.item_types_only && card.type !== 'item') return { valid: false, error: `"${cardName}" is not an item.` };
      }
    }
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

  // Deterministic, readable id (a replayed seed gives the same ids).
  const tradeId = `t${state.turnNumber}-${playerId}-${action.target}`;

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

  const offerer = state.players[playerId] as unknown as { offersThisTurn?: number };
  offerer.offersThisTurn = Number(offerer.offersThisTurn ?? 0) + 1;

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

    const back = trade.request.length ? trade.request : (((action as unknown as { give?: string[] }).give) ?? []);
    const requestedCards = removeCardsFromHand(state, playerId, back);
    addToHand(state, trade.from, requestedCards);

    // Calculate new completed trades counts (trade.counts_for: both | offerer | responder)
    const countsFor = (ctx.config.engine_mechanics?.trade as TradeConfig | undefined)?.counts_for ?? 'both';
    const responderTrades = (player.completedTrades ?? 0) + (countsFor === 'offerer' ? 0 : 1);
    const offererTrades = (fromPlayer.completedTrades ?? 0) + (countsFor === 'responder' ? 0 : 1);

    // Distinct partners each side has completed a trade with (goal metric trade_partners).
    const partners = (p: unknown, other: string) => [...new Set([...(((p as { tradePartners?: string[] }).tradePartners) ?? []), other])];
    const responderPartners = countsFor === 'offerer' ? (player as unknown as { tradePartners?: string[] }).tradePartners ?? [] : partners(player, trade.from);
    const offererPartners = countsFor === 'responder' ? (fromPlayer as unknown as { tradePartners?: string[] }).tradePartners ?? [] : partners(fromPlayer, playerId);
    return {
      handled: true,
      stateChanges: {
        sharedStateChanges: {
          pendingTrades: newPending
        },
        playerStateChanges: {
          [playerId]: { completedTrades: responderTrades, tradePartners: responderPartners } as never,
          [trade.from]: { completedTrades: offererTrades, tradePartners: offererPartners } as never
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
        request: back
      }
    };
  } else {
    // Trade declined — the same offer can't be made again this turn
    state.shared.declinedTrades = [...((state.shared.declinedTrades as string[] | undefined) ?? []), offerKey(trade.from, trade.to, trade.offer, trade.request)];
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
