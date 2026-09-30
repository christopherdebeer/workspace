/**
 * Auction Turn Order Until Pass Mechanic
 *
 * Players bid in turn order. Once you pass, you're out.
 * Last bidder standing wins.
 *
 * Hooks used:
 * - initSharedState: Create auction state
 * - getAvailableActions: 'raise_bid' or 'pass_auction'
 * - onExecuteAction: Raise or pass
 * - getPlayerView: Show auction state
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

interface TurnOrderAuctionConfig {
  min_raise?: number;
  starting_bid?: number;
}

interface TurnOrderAuctionState {
  currentBid: number;
  currentBidder: string | null;
  passedPlayers: string[];
  item: string;
  round: number;
}

function getConfig(config: GameConfig): TurnOrderAuctionConfig | undefined {
  return config.engine_mechanics?.auction_turn_order_until_pass as TurnOrderAuctionConfig | undefined;
}

function getTOAState(shared: Record<string, unknown>): TurnOrderAuctionState | undefined {
  return shared.turnOrderAuction as TurnOrderAuctionState | undefined;
}

export const auctionTurnOrderUntilPassMechanic: MechanicHooks = {
  slug: 'auction-turn-order-until-pass',
  name: 'Auction: Turn Order Until Pass',
  requires: ['auction'],

  configSchema: {
    type: 'object',
    description: 'Bid in turn order; passed players exit',
    properties: {
      min_raise: { type: 'number', default: 1 },
      starting_bid: { type: 'number', default: 0 }
    }
  },

  initSharedState(ctx: SharedStateInitContext): SharedStateInitResult | null {
    const config = getConfig(ctx.config);
    if (!config) return null;

    return {
      turnOrderAuction: {
        currentBid: config.starting_bid ?? 0,
        currentBidder: null,
        passedPlayers: [],
        item: 'auction-item-1',
        round: 1
      } as TurnOrderAuctionState
    };
  },

  getAvailableActions(ctx: HookContext): AvailableAction[] {
    if (!isMechanicEnabled(ctx.config, 'auction-turn-order-until-pass')) return [];

    const toaState = getTOAState(ctx.state.shared);
    if (!toaState) return [];
    if (toaState.passedPlayers.includes(ctx.playerId)) return [];

    const config = getConfig(ctx.config);
    const minRaise = config?.min_raise ?? 1;

    return [
      {
        action: {
          type: 'raise_bid',
          amount: toaState.currentBid + minRaise
        } as unknown as GameAction,
        priority: 70,
        category: 'auction'
      },
      {
        action: { type: 'pass_auction' } as unknown as GameAction,
        priority: 65,
        category: 'auction'
      }
    ];
  },

  onExecuteAction(ctx: ActionExecutionContext): ActionExecutionResult | null {
    if (ctx.action.type !== 'raise_bid' && ctx.action.type !== 'pass_auction') return null;

    const config = getConfig(ctx.config);
    if (!config) return null;

    const toaState = getTOAState(ctx.state.shared);
    if (!toaState) return null;

    if (ctx.action.type === 'pass_auction') {
      const updatedPassed = [...toaState.passedPlayers, ctx.playerId];
      const activePlayers = Object.keys(ctx.state.players).filter(p => !updatedPassed.includes(p));

      if (activePlayers.length <= 1 && toaState.currentBidder) {
        // Auction resolved
        return {
          handled: true,
          stateChanges: {
            sharedStateChanges: {
              turnOrderAuction: {
                currentBid: config.starting_bid ?? 0,
                currentBidder: null,
                passedPlayers: [],
                item: `auction-item-${toaState.round + 1}`,
                round: toaState.round + 1
              }
            },
            playerStateChanges: {
              [toaState.currentBidder]: {
                score: (ctx.state.players[toaState.currentBidder]?.score ?? 0) - toaState.currentBid
              }
            }
          },
          advanceTurn: true,
          checkWin: false,
          logMessage: `${toaState.currentBidder} wins the auction for ${toaState.currentBid}!`,
          logData: { winner: toaState.currentBidder, bid: toaState.currentBid }
        };
      }

      return {
        handled: true,
        stateChanges: {
          sharedStateChanges: {
            turnOrderAuction: { ...toaState, passedPlayers: updatedPassed }
          }
        },
        advanceTurn: true,
        checkWin: false,
        logMessage: `${ctx.playerId} passed.`,
        logData: { player: ctx.playerId, remaining: activePlayers.length }
      };
    }

    // raise_bid
    const raiseAction = ctx.action as unknown as { type: 'raise_bid'; amount: number };
    const minRaise = config.min_raise ?? 1;

    if (raiseAction.amount < toaState.currentBid + minRaise) {
      return { handled: true, logMessage: `Must bid at least ${toaState.currentBid + minRaise}.`, advanceTurn: false, checkWin: false };
    }

    return {
      handled: true,
      stateChanges: {
        sharedStateChanges: {
          turnOrderAuction: {
            ...toaState,
            currentBid: raiseAction.amount,
            currentBidder: ctx.playerId
          }
        }
      },
      advanceTurn: true,
      checkWin: false,
      logMessage: `${ctx.playerId} raised to ${raiseAction.amount}.`,
      logData: { player: ctx.playerId, amount: raiseAction.amount }
    };
  },

  getPlayerView(ctx: HookContext): Record<string, unknown> | null {
    if (!isMechanicEnabled(ctx.config, 'auction-turn-order-until-pass')) return null;

    const toaState = getTOAState(ctx.state.shared);
    if (!toaState) return null;

    return {
      toaCurrentBid: toaState.currentBid,
      toaCurrentBidder: toaState.currentBidder,
      toaHasPassed: toaState.passedPlayers.includes(ctx.playerId),
      toaItem: toaState.item
    };
  }
};
