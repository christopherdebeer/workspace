/**
 * Deck Construction Mechanic
 *
 * Pre-game deck building phase. Players select cards from a pool
 * to construct their personal deck before gameplay begins.
 *
 * Hooks used:
 * - initSharedState: Create card pool
 * - getAvailableActions: 'draft_to_deck' during construction phase
 * - onExecuteAction: Add card to deck
 * - getPlayerView: Show pool and constructed deck
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

interface DeckConstructionConfig {
  pool_size?: number;
  deck_size?: number;
  cards_per_pick?: number;
}

interface DeckConstructionState {
  pool: string[];
  decks: Record<string, string[]>;
  phase: 'constructing' | 'playing';
  deckSize: number;
}

function getConfig(config: GameConfig): DeckConstructionConfig | undefined {
  return config.engine_mechanics?.deck_construction as DeckConstructionConfig | undefined;
}

function getDeckState(shared: Record<string, unknown>): DeckConstructionState | undefined {
  return shared.deckConstruction as DeckConstructionState | undefined;
}

export const deckConstructionMechanic: MechanicHooks = {
  slug: 'deck-construction',
  name: 'Deck Construction',
  requires: ['cards'],

  configSchema: {
    type: 'object',
    description: 'Pre-game deck building from card pool',
    properties: {
      pool_size: { type: 'number', default: 50 },
      deck_size: { type: 'number', default: 20 },
      cards_per_pick: { type: 'number', default: 1 }
    }
  },

  initSharedState(ctx: SharedStateInitContext): SharedStateInitResult | null {
    const config = getConfig(ctx.config);
    if (!config) return null;

    const poolSize = config.pool_size ?? 50;
    const pool: string[] = [];
    for (let i = 0; i < poolSize; i++) {
      pool.push(`card-${i + 1}`);
    }

    const decks: Record<string, string[]> = {};
    for (const pid of ctx.playerIds) {
      decks[pid] = [];
    }

    return {
      deckConstruction: {
        pool,
        decks,
        phase: 'constructing',
        deckSize: config.deck_size ?? 20
      } as DeckConstructionState
    };
  },

  getAvailableActions(ctx: HookContext): AvailableAction[] {
    if (!isMechanicEnabled(ctx.config, 'deck-construction')) return [];

    const dcState = getDeckState(ctx.state.shared);
    if (!dcState || dcState.phase !== 'constructing') return [];

    const myDeck = dcState.decks[ctx.playerId] ?? [];
    if (myDeck.length >= dcState.deckSize) return [];
    if (dcState.pool.length === 0) return [];

    return [{
      action: {
        type: 'draft_to_deck',
        cardId: dcState.pool[0]
      } as unknown as GameAction,
      priority: 80,
      category: 'deck-construction'
    }];
  },

  onExecuteAction(ctx: ActionExecutionContext): ActionExecutionResult | null {
    if (ctx.action.type !== 'draft_to_deck') return null;

    const dcState = getDeckState(ctx.state.shared);
    if (!dcState) return null;

    const draftAction = ctx.action as unknown as { type: 'draft_to_deck'; cardId: string };
    const cardIdx = dcState.pool.indexOf(draftAction.cardId);

    if (cardIdx < 0) {
      return { handled: true, logMessage: 'Card not in pool.', advanceTurn: false, checkWin: false };
    }

    const updatedPool = dcState.pool.filter((_, i) => i !== cardIdx);
    const updatedDeck = [...(dcState.decks[ctx.playerId] ?? []), draftAction.cardId];

    // Check if all decks are complete
    const allPlayers = Object.keys(ctx.state.players);
    const updatedDecks = { ...dcState.decks, [ctx.playerId]: updatedDeck };
    const allComplete = allPlayers.every(p => (updatedDecks[p] ?? []).length >= dcState.deckSize);

    return {
      handled: true,
      stateChanges: {
        sharedStateChanges: {
          deckConstruction: {
            ...dcState,
            pool: updatedPool,
            decks: updatedDecks,
            phase: allComplete ? 'playing' : 'constructing'
          }
        }
      },
      advanceTurn: !allComplete,
      checkWin: false,
      logMessage: allComplete
        ? 'All decks constructed! Game begins.'
        : `${ctx.playerId} drafted a card (${updatedDeck.length}/${dcState.deckSize}).`,
      logData: { player: ctx.playerId, deckSize: updatedDeck.length, allComplete }
    };
  },

  getPlayerView(ctx: HookContext): Record<string, unknown> | null {
    if (!isMechanicEnabled(ctx.config, 'deck-construction')) return null;

    const dcState = getDeckState(ctx.state.shared);
    if (!dcState) return null;

    return {
      constructionPhase: dcState.phase,
      myDeckSize: (dcState.decks[ctx.playerId] ?? []).length,
      targetDeckSize: dcState.deckSize,
      poolRemaining: dcState.pool.length
    };
  }
};
