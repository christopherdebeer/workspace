/**
 * Hand Management Mechanic (Updated Proposal 012)
 *
 * Hand size limits and discard policies.
 * Policies: cannot_draw (block), discard_choice, discard_oldest
 *
 * Requires: cards (core mechanic)
 *
 * Hooks used:
 * - onBeforeAddToHand: Block or limit ANY card acquisition (cards-defined hook)
 * - onBeforeCardDraw: Block or limit draw (cards-defined hook)
 * - postExecuteAction: Enforce hand limit AFTER draw (discard_oldest auto-discards)
 */

import { MechanicHooks, HookContext, StateChanges } from './types';
import type { CardsHooks, BeforeCardDrawPayload, BeforeAddToHandPayload } from './core/cards';
import { Card, GameAction } from '../types/game';
import { getCardsState } from './core/index';

export const handManagementMechanic: MechanicHooks & CardsHooks = {
  slug: 'hand-management',
  name: 'Hand Management',
  requires: ['cards'],

  configSchema: {
    type: 'object',
    description: 'Hand size limits and discard policies',
    properties: {
      hand_limit: {
        type: 'number',
        description: 'Maximum cards allowed in hand'
      },
      hand_limit_policy: {
        type: 'string',
        description: 'Policy when hand limit exceeded',
        enum: ['cannot_draw', 'discard_choice', 'discard_oldest'],
        default: 'cannot_draw'
      }
    }
  },

  /**
   * Cards-defined hook: Enforce hand limit on ALL card acquisition (trades, effects, location draws).
   * This hook runs before ANY cards are added to hand, not just draws.
   * Fired by hand.ts via mechanicRegistry.fire('cards', 'onBeforeAddToHand', ...).
   */
  onBeforeAddToHand(ctx: HookContext, payload: BeforeAddToHandPayload): { blocked?: boolean; blockReason?: string; cards?: Card[] } | null {
    const handLimit = ctx.config.engine_mechanics?.hand_limit as number | undefined;
    if (handLimit === undefined) return null;

    const policy = (ctx.config.engine_mechanics?.hand_limit_policy as string) || 'cannot_draw';

    const currentHandSize = (ctx.player.hand ?? []).length;
    const cardsToAdd = payload.cards.length;
    const wouldExceed = currentHandSize + cardsToAdd > handLimit;

    if (!wouldExceed) return null;

    const maxAddable = Math.max(0, handLimit - currentHandSize);

    if (policy === 'cannot_draw') {
      // Block entirely if at limit
      if (maxAddable === 0) {
        return {
          blocked: true,
          blockReason: `Hand limit (${handLimit}) reached. Cannot add cards to hand.`
        };
      }
      // Otherwise limit the cards being added
      return {
        cards: payload.cards.slice(0, maxAddable),
        blockReason: `Only ${maxAddable} cards added due to hand limit (${handLimit}).`
      };
    }

    // For discard_choice and discard_oldest, allow cards but they'll be discarded after
    // (handled in game.ts execution-time logic)
    return null;
  },

  /**
   * Cards-defined hook: Block or limit draw based on hand limit.
   * Preferred path (mirrors onBeforeDraw logic above).
   * Fired by card-piles.ts via mechanicRegistry.fire('cards', 'onBeforeCardDraw', ...).
   */
  onBeforeCardDraw(ctx: HookContext, { requestedCount }: BeforeCardDrawPayload): { blocked?: boolean; blockReason?: string; count?: number } | null {
    const handLimit = ctx.config.engine_mechanics?.hand_limit as number | undefined;
    if (handLimit === undefined) return null;

    const policy = (ctx.config.engine_mechanics?.hand_limit_policy as string) || 'cannot_draw';
    if (policy !== 'cannot_draw') return null;

    const currentHandSize = (ctx.player.hand ?? []).length;
    const maxDrawable = Math.max(0, handLimit - currentHandSize);

    if (maxDrawable === 0) {
      return {
        blocked: true,
        blockReason: `Hand limit (${handLimit}) reached. You have ${currentHandSize} cards and cannot draw more.`
      };
    }

    if (requestedCount > maxDrawable) {
      return {
        count: maxDrawable,
        blockReason: `Draw limited to ${maxDrawable} cards due to hand limit (${handLimit}).`
      };
    }

    return null;
  },

  /**
   * Post-execution hook: Enforce hand limit AFTER draw action.
   * Handles discard_oldest (auto-discard) and discard_choice (warning only).
   * The cannot_draw policy is already handled by onBeforeCardDraw above.
   */
  postExecuteAction(ctx: HookContext, action: GameAction): StateChanges | null {
    // Only run after draw actions
    if (action.type !== 'draw') return null;

    const handLimit = ctx.config.engine_mechanics?.hand_limit as number | undefined;
    if (handLimit === undefined) return null;

    const policy = (ctx.config.engine_mechanics?.hand_limit_policy as string) || 'cannot_draw';
    if (policy === 'cannot_draw') return null; // Already blocked before draw

    const playerHand = ctx.player.hand ?? [];
    if (playerHand.length <= handLimit) return null; // No excess

    const excess = playerHand.length - handLimit;

    if (policy === 'discard_oldest') {
      // Auto-discard the oldest (first) cards
      // Direct mutation since we're in postExecuteAction
      const discarded: Card[] = [];
      const cardsState = getCardsState(ctx.state);
      for (let i = 0; i < excess; i++) {
        const card = playerHand.shift();
        if (card) {
          discarded.push(card);
          cardsState.discardPile.push(card);
        }
      }
      return null; // Direct mutation, no stateChanges needed
    }

    // discard_choice: just return null, game.ts logs warning
    // Full implementation would need pending_discard state
    return null;
  }
};
