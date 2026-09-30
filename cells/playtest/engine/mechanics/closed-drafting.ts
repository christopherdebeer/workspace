/**
 * Closed Drafting Mechanic
 *
 * Players simultaneously select cards from a hidden hand, then pass remaining cards.
 * Like 7 Wonders or Sushi Go drafting.
 *
 * Flow:
 * 1. Each player receives a draft pool (hand of cards to choose from)
 * 2. Players secretly select one card (selection hidden until all choose)
 * 3. Once all players have selected, selections are revealed
 * 4. Remaining cards are passed to next player
 * 5. Repeat until draft pools are empty
 *
 * Hooks used:
 * - initPlayerState: Set up draft pool state
 * - preValidateAction: Validate draft_select action
 * - onExecuteAction: Handle selection and passing
 * - onTurnEnd: Check if round of drafting is complete
 * - getAvailableActions: Expose draft_select action
 * - describeAction: Describe draft_select action
 */

import {
  MechanicHooks,
  HookContext,
  ValidationResult,
  ActionExecutionContext,
  ActionExecutionResult,
  AvailableAction,
  ActionDescription,
  PlayerInitContext,
  PlayerInitResult,
  TurnEndContext,
  TurnStartContext,
  StateChanges,
  SharedStateInitContext,
  SharedStateInitResult
} from './types';
import { GameAction, Card } from '../types/game';
import { addToHand } from './core/hand';

/** Temporary storage for draft pools before distribution to players */
interface ClosedDraftPoolsShared {
  closedDraftPools?: Record<string, Card[]>;
  closedDraftPoolsDistributed?: boolean;
}

interface ClosedDraftingConfig {
  /** Number of cards in initial draft pool per player */
  pool_size: number;
  /** Direction to pass cards: 'left' (next player) or 'right' (previous player) */
  pass_direction: 'left' | 'right';
  /** Whether to alternate direction each round */
  alternate_direction?: boolean;
  /** Cards to keep from final pool (when pool gets too small) */
  final_pool_keep?: number;
}

interface DraftSelectAction {
  type: 'draft_select';
  card: string;
}

export const closedDraftingMechanic: MechanicHooks = {
  slug: 'closed-drafting',
  name: 'Closed Drafting',
  requires: ['cards'],

  configSchema: {
    type: 'object',
    description: 'Simultaneous card selection with passing (7 Wonders style)',
    properties: {
      pool_size: {
        type: 'number',
        description: 'Number of cards in each player\'s draft pool',
        required: true
      },
      pass_direction: {
        type: 'string',
        description: 'Direction to pass remaining cards',
        enum: ['left', 'right'],
        default: 'left'
      },
      alternate_direction: {
        type: 'boolean',
        description: 'Alternate pass direction each round',
        default: false
      },
      final_pool_keep: {
        type: 'number',
        description: 'Cards kept from final pool (rest discarded)',
        default: 1
      }
    },
    required: ['pool_size']
  },

  /**
   * Initialize draft state flags. Actual pool creation is deferred to onTurnStart
   * because the cards mechanic (which builds the deck) may not have run yet.
   */
  initSharedState(ctx: SharedStateInitContext): SharedStateInitResult | null {
    const draftConfig = ctx.config.engine_mechanics?.closed_drafting as ClosedDraftingConfig | undefined;
    if (!draftConfig) return null;

    return {
      closedDraftPoolsDistributed: false,
      draftRound: 1
    };
  },

  initPlayerState(ctx: PlayerInitContext): PlayerInitResult | null {
    const draftConfig = ctx.config.engine_mechanics?.closed_drafting as ClosedDraftingConfig | undefined;
    if (!draftConfig) return null;

    return {
      draftPool: [] as Card[],       // Cards available to draft from (populated from shared state)
      draftSelection: null as Card | null,  // Currently selected card (hidden)
      hasDraftSelected: false        // Whether player has made selection this pick
    };
  },

  /**
   * On first turn: create draft pools from the game deck and distribute to players.
   * Pool creation is deferred from initSharedState because the cards mechanic
   * (which builds the deck) registers later and may not have run yet during init.
   */
  onTurnStart(ctx: TurnStartContext): StateChanges | null {
    const draftConfig = ctx.config.engine_mechanics?.closed_drafting as ClosedDraftingConfig | undefined;
    if (!draftConfig) return null;

    const sharedState = ctx.state.shared as ClosedDraftPoolsShared;

    // Already distributed
    if (sharedState.closedDraftPoolsDistributed) return null;

    // If pools exist in shared state (from initSharedState), distribute them
    if (sharedState.closedDraftPools) {
      const playerStateChanges: Record<string, Partial<{ draftPool: Card[] }>> = {};
      for (const [playerId, pool] of Object.entries(sharedState.closedDraftPools)) {
        playerStateChanges[playerId] = { draftPool: pool };
      }
      return {
        playerStateChanges,
        sharedStateChanges: {
          closedDraftPoolsDistributed: true,
          closedDraftPools: undefined
        }
      };
    }

    // Pools don't exist yet — create them from the game deck
    const deck = ctx.state.shared.deck as Card[] | undefined;
    if (!deck || deck.length === 0) return null;

    const poolSize = draftConfig.pool_size;
    const playerIds = ctx.state.turnOrder;
    const totalCardsNeeded = poolSize * playerIds.length;

    if (deck.length < totalCardsNeeded) {
      console.warn(`[closed-drafting] Not enough cards in deck for ${playerIds.length} players with pool_size=${poolSize}. ` +
        `Need ${totalCardsNeeded}, have ${deck.length}. Adjusting pool sizes.`);
    }

    // Deal cards from deck to create pools
    const playerStateChanges: Record<string, Partial<{ draftPool: Card[] }>> = {};
    const newDeck = [...deck];
    for (const playerId of playerIds) {
      const cardsToTake = Math.min(poolSize, newDeck.length);
      playerStateChanges[playerId] = { draftPool: newDeck.splice(0, cardsToTake) };
    }

    return {
      playerStateChanges,
      sharedStateChanges: {
        closedDraftPoolsDistributed: true,
        deck: newDeck
      }
    };
  },

  preValidateAction(ctx: HookContext, action: GameAction): ValidationResult | null {
    if (action.type !== 'draft_select') return null;

    const draftConfig = ctx.config.engine_mechanics?.closed_drafting as ClosedDraftingConfig | undefined;
    if (!draftConfig) {
      return { valid: false, error: 'Closed drafting is not enabled for this game.' };
    }

    const selectAction = action as DraftSelectAction;

    // Get draft pool - check player state first, then shared state
    let draftPool = (ctx.player.draftPool || []) as Card[];
    if (draftPool.length === 0) {
      const sharedState = ctx.state.shared as ClosedDraftPoolsShared;
      if (sharedState.closedDraftPools && sharedState.closedDraftPools[ctx.playerId]) {
        draftPool = sharedState.closedDraftPools[ctx.playerId];
      }
    }

    // Check if player already selected this pick
    if (ctx.player.hasDraftSelected) {
      return { valid: false, error: 'You have already selected a card this pick. Waiting for other players.' };
    }

    // Check if card is in player's draft pool
    if (!draftPool.find(c => c.name === selectAction.card)) {
      return {
        valid: false,
        error: `Card "${selectAction.card}" not in your draft pool. Available: ${draftPool.map(c => c.name).join(', ')}`
      };
    }

    return { valid: true };
  },

  onExecuteAction(ctx: ActionExecutionContext): ActionExecutionResult | null {
    const { action, player, playerId, state } = ctx;

    if (action.type !== 'draft_select') return null;

    const draftConfig = ctx.config.engine_mechanics?.closed_drafting as ClosedDraftingConfig | undefined;
    if (!draftConfig) return null;

    const selectAction = action as DraftSelectAction;

    // Get draft pool - check player state first, then shared state
    let draftPool = (player.draftPool || []) as Card[];
    if (draftPool.length === 0) {
      const sharedState = state.shared as ClosedDraftPoolsShared;
      if (sharedState.closedDraftPools && sharedState.closedDraftPools[playerId]) {
        draftPool = sharedState.closedDraftPools[playerId];
      }
    }

    const cardIndex = draftPool.findIndex(c => c.name === selectAction.card);

    if (cardIndex === -1) {
      return {
        handled: true,
        stateChanges: {},
        advanceTurn: false,
        checkWin: false,
        logMessage: 'draft_select_failed',
        logData: { card: selectAction.card, error: 'Card not in pool' }
      };
    }

    // Remove card from pool and mark as selected
    const newPool = [...draftPool];
    const [selectedCard] = newPool.splice(cardIndex, 1);

    // Check if all players have now selected
    const allSelected = Object.entries(state.players).every(([pid, p]) => {
      if (pid === playerId) return true; // This player just selected
      return p.hasDraftSelected === true;
    });

    const stateChanges: StateChanges = {
      playerStateChanges: {
        [playerId]: {
          draftPool: newPool,
          draftSelection: selectedCard,
          hasDraftSelected: true
        }
      }
    };

    // If all players have selected, trigger the reveal and pass phase
    if (allSelected) {
      // Reveal all selections: add to hands
      for (const [pid, p] of Object.entries(state.players)) {
        const selection = pid === playerId ? selectedCard : p.draftSelection as Card | null;
        if (selection) {
          // Add selected card to hand
          addToHand(state, pid, [selection]);

          // Clear selection state
          stateChanges.playerStateChanges = stateChanges.playerStateChanges || {};
          stateChanges.playerStateChanges[pid] = {
            ...stateChanges.playerStateChanges[pid],
            draftSelection: null,
            hasDraftSelected: false
          };
        }
      }

      // Pass remaining pools to next player
      const turnOrder = state.turnOrder;
      const direction = draftConfig.pass_direction || 'left';
      const poolsToPass: Record<string, Card[]> = {};

      // Collect all remaining pools
      for (const [pid, p] of Object.entries(state.players)) {
        const pool = pid === playerId ? newPool : (p.draftPool || []) as Card[];
        poolsToPass[pid] = pool;
      }

      // Assign passed pools
      for (let i = 0; i < turnOrder.length; i++) {
        const currentPid = turnOrder[i];
        let sourcePid: string;

        if (direction === 'left') {
          // Pass left means receive from right (previous player)
          const sourceIndex = (i - 1 + turnOrder.length) % turnOrder.length;
          sourcePid = turnOrder[sourceIndex];
        } else {
          // Pass right means receive from left (next player)
          const sourceIndex = (i + 1) % turnOrder.length;
          sourcePid = turnOrder[sourceIndex];
        }

        stateChanges.playerStateChanges = stateChanges.playerStateChanges || {};
        stateChanges.playerStateChanges[currentPid] = {
          ...stateChanges.playerStateChanges[currentPid],
          draftPool: poolsToPass[sourcePid]
        };
      }

      // Track draft round for alternating direction
      const currentDraftRound = (state.shared.draftRound || 1) as number;
      stateChanges.sharedStateChanges = {
        draftRound: currentDraftRound + 1
      };

      return {
        handled: true,
        stateChanges,
        advanceTurn: false, // Don't advance - all players act simultaneously
        checkWin: false,
        logMessage: 'draft_round_complete',
        logData: {
          round: currentDraftRound,
          direction,
          selections: Object.fromEntries(
            Object.entries(state.players).map(([pid, p]) => [
              pid,
              pid === playerId ? selectedCard.name : (p.draftSelection as Card)?.name
            ])
          )
        }
      };
    }

    // Not all players have selected yet
    return {
      handled: true,
      stateChanges,
      advanceTurn: false, // Don't advance turn - simultaneous selection
      checkWin: false,
      logMessage: 'draft_selected',
      logData: {
        player: playerId,
        waitingFor: Object.entries(state.players)
          .filter(([pid, p]) => pid !== playerId && !p.hasDraftSelected)
          .map(([pid]) => pid)
      }
    };
  },

  getAvailableActions(ctx: HookContext): AvailableAction[] {
    const draftConfig = ctx.config.engine_mechanics?.closed_drafting as ClosedDraftingConfig | undefined;
    if (!draftConfig) return [];

    // Don't show actions if already selected
    if (ctx.player.hasDraftSelected) return [];

    // Get draft pool - check player state first, then fall back to shared state
    // (shared state is used before pools are distributed on first turn)
    let draftPool = (ctx.player.draftPool || []) as Card[];

    // Fallback: check if pools are in shared state (not yet distributed)
    if (draftPool.length === 0) {
      const sharedState = ctx.state.shared as ClosedDraftPoolsShared;
      if (sharedState.closedDraftPools && sharedState.closedDraftPools[ctx.playerId]) {
        draftPool = sharedState.closedDraftPools[ctx.playerId];
      }
    }

    if (draftPool.length === 0) return [];

    // Return one action per card in draft pool
    return draftPool.map(card => ({
      action: {
        type: 'draft_select',
        card: card.name
      } as GameAction,
      priority: 46,
      category: 'drafting'
    }));
  },

  describeAction(action: GameAction): ActionDescription | null {
    if (action.type !== 'draft_select') return null;

    return {
      type: 'draft_select',
      label: 'Select Card',
      description: 'Select a card from your draft pool. Selection is hidden until all players choose.',
      examples: ['draft_select card:"Fire Spell"']
    };
  }
};
