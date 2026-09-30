/**
 * Betting and Bluffing Mechanic
 *
 * Players make bets (committing resources) and can bluff about their hand/position.
 * Other players can call bluffs. Supports poker-style betting rounds.
 * Examples: Poker, Sheriff of Nottingham, Perudo/Liar's Dice
 *
 * Requires: social (core mechanic)
 *
 * Hooks used:
 * - initSharedState: Set up betting pool
 * - getAvailableActions: Expose bet, raise, call, fold, call_bluff actions
 * - onExecuteAction: Handle betting actions
 * - getPlayerView: Show pot, current bet, player's wager
 */

import {
  MechanicHooks,
  HookContext,
  AvailableAction,
  ActionExecutionContext,
  ActionExecutionResult,
  SharedStateInitContext,
  SharedStateInitResult,
} from './types';
import type { SocialHooks } from './core/social-mechanic';
import { GameAction, BetAction, CallBluffAction } from '../types/game';

interface BettingConfig {
  resource?: string;           // Resource used for betting (default: 'coins')
  min_bet?: number;            // Minimum bet (default 1)
  max_bet?: number;            // Maximum bet (0 = no limit)
  allow_bluff?: boolean;       // Enable bluff calling (default true)
  bluff_penalty?: number;      // Penalty for caught bluffing
  bluff_reward?: number;       // Reward for successful bluff
  ante?: number;               // Required ante per round
  betting_rounds?: number;     // Max betting rounds (default 1)
}

interface BettingState {
  pot: number;
  currentBet: number;
  playerBets: Record<string, number>;
  folded: string[];
  bettingRound: number;
  declarations: Record<string, unknown>;
}

export const bettingAndBluffingMechanic: MechanicHooks & SocialHooks = {
  slug: 'betting-and-bluffing',
  name: 'Betting and Bluffing',
  requires: ['social'],

  configSchema: {
    type: 'object',
    description: 'Betting rounds with optional bluff calling',
    properties: {
      resource: { type: 'string', description: 'Resource used for betting', default: 'coins' },
      min_bet: { type: 'number', default: 1 },
      max_bet: { type: 'number', description: '0 = no limit', default: 0 },
      allow_bluff: { type: 'boolean', default: true },
      bluff_penalty: { type: 'number', default: 0 },
      bluff_reward: { type: 'number', default: 0 },
      ante: { type: 'number', default: 0 },
    },
  },

  initSharedState(ctx: SharedStateInitContext): SharedStateInitResult | null {
    const config = ctx.config.engine_mechanics?.betting_and_bluffing as BettingConfig | undefined;
    if (!config) return {};

    return {
      bettingState: {
        pot: 0,
        currentBet: 0,
        playerBets: {},
        folded: [],
        bettingRound: 0,
        declarations: {},
      } as BettingState,
    };
  },

  getAvailableActions(ctx: HookContext): AvailableAction[] {
    const config = ctx.config.engine_mechanics?.betting_and_bluffing as BettingConfig | undefined;
    if (!config) return [];

    const shared = ctx.state.shared as Record<string, unknown>;
    const betting = shared.bettingState as BettingState | undefined;
    if (!betting) return [];

    // Folded players can't act
    if (betting.folded.includes(ctx.playerId)) return [];

    const actions: AvailableAction[] = [];
    const resource = config.resource || 'coins';
    const playerResources = (ctx.player.resources as Record<string, number>) || {};
    const available = playerResources[resource] || 0;
    const myBet = betting.playerBets[ctx.playerId] || 0;
    const toCall = betting.currentBet - myBet;
    const minBet = config.min_bet || 1;

    // Call (match current bet)
    if (toCall > 0 && available >= toCall) {
      actions.push({
        action: {
          type: 'bet',
          amount: toCall,
          action: 'call',
        } as GameAction,
      });
    }

    // Raise
    const minRaise = betting.currentBet + minBet;
    const maxRaise = config.max_bet || available;
    if (available >= toCall + minBet) {
      actions.push({
        action: {
          type: 'bet',
          amount: minRaise,
          action: 'raise',
        } as GameAction,
      });
    }

    // Check (if no bet to call)
    if (toCall === 0) {
      actions.push({
        action: {
          type: 'bet',
          amount: 0,
          action: 'check',
        } as GameAction,
      });
    }

    // Fold
    actions.push({
      action: {
        type: 'bet',
        amount: 0,
        action: 'fold',
      } as GameAction,
    });

    // Call bluff (if bluffing is enabled and someone made a declaration)
    if (config.allow_bluff !== false && Object.keys(betting.declarations).length > 0) {
      const declarers = Object.keys(betting.declarations).filter(pid => pid !== ctx.playerId);
      for (const declarerId of declarers) {
        actions.push({
          action: {
            type: 'call_bluff',
            targetPlayerId: declarerId,
          } as GameAction,
        });
      }
    }

    return actions;
  },

  onExecuteAction(ctx: ActionExecutionContext): ActionExecutionResult | null {
    if (ctx.action.type !== 'bet' && ctx.action.type !== 'call_bluff') return null;

    const config = ctx.config.engine_mechanics?.betting_and_bluffing as BettingConfig | undefined;
    if (!config) return null;

    const shared = ctx.state.shared as Record<string, unknown>;
    const betting = { ...(shared.bettingState as BettingState) };
    const resource = config.resource || 'coins';

    if (ctx.action.type === 'bet') {
      const betAction = ctx.action as BetAction;
      const betType = betAction.action || '';

      if (betType === 'fold') {
        betting.folded = [...betting.folded, ctx.playerId];
        return {
          handled: true,
          stateChanges: { sharedStateChanges: { bettingState: betting } },
          advanceTurn: true,
          logMessage: 'folded',
        };
      }

      if (betType === 'check') {
        return {
          handled: true,
          advanceTurn: true,
          logMessage: 'checked',
        };
      }

      const amount = betAction.amount || 0;
      const playerBets = { ...betting.playerBets };
      playerBets[ctx.playerId] = (playerBets[ctx.playerId] || 0) + amount;
      betting.playerBets = playerBets;
      betting.pot += amount;

      if (betType === 'raise') {
        betting.currentBet = playerBets[ctx.playerId];
      }

      // Deduct from player resources
      const playerResources = { ...((ctx.state.players[ctx.playerId]?.resources as Record<string, number>) || {}) };
      playerResources[resource] = (playerResources[resource] || 0) - amount;

      return {
        handled: true,
        stateChanges: {
          playerStateChanges: { [ctx.playerId]: { resources: playerResources } },
          sharedStateChanges: { bettingState: betting },
        },
        advanceTurn: true,
        logMessage: `${betType} ${amount} ${resource} (pot: ${betting.pot})`,
      };
    }

    // call_bluff
    if (ctx.action.type === 'call_bluff') {
      const targetId = (ctx.action as CallBluffAction).targetPlayerId;
      // Bluff resolution would depend on game-specific verification
      // For now, mark the challenge in shared state for GM/game to resolve
      return {
        handled: true,
        stateChanges: {
          sharedStateChanges: {
            pendingBluffChallenge: {
              challenger: ctx.playerId,
              target: targetId,
              declaration: betting.declarations[targetId],
            },
          },
        },
        advanceTurn: false,
        logMessage: `called ${targetId}'s bluff`,
      };
    }

    return null;
  },

  getPlayerView(ctx: HookContext): Record<string, unknown> {
    const config = ctx.config.engine_mechanics?.betting_and_bluffing as BettingConfig | undefined;
    if (!config) return {};

    const shared = ctx.state.shared as Record<string, unknown>;
    const betting = shared.bettingState as BettingState | undefined;
    if (!betting) return {};

    return {
      bettingPot: betting.pot,
      currentBet: betting.currentBet,
      myBet: betting.playerBets[ctx.playerId] || 0,
      folded: betting.folded,
    };
  },
};
