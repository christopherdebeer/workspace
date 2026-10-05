/**
 * Matching Mechanic
 *
 * Players find matching pairs/sets among face-down or visible elements.
 * Memory-style matching or pattern-based matching.
 *
 * Hooks used:
 * - initSharedState: Create matching board
 * - getAvailableActions: 'reveal_match' actions
 * - onExecuteAction: Reveal and check for matches
 * - getPlayerView: Show revealed state
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

interface MatchingConfig {
  pairs?: number;
  points_per_match?: number;
}

interface MatchTile {
  id: number;
  value: string;
  revealed: boolean;
  matched: boolean;
  matchedBy: string | null;
}

interface MatchingState {
  tiles: MatchTile[];
  currentRevealed: number[];  // indices of currently revealed (unmatched) tiles
  matchesFound: number;
  totalPairs: number;
}

function getConfig(config: GameConfig): MatchingConfig | undefined {
  return config.engine_mechanics?.matching as MatchingConfig | undefined;
}

function getMatchState(shared: Record<string, unknown>): MatchingState | undefined {
  return shared.matching as MatchingState | undefined;
}

export const matchingMechanic: MechanicHooks = {
  slug: 'matching',
  name: 'Matching',

  configSchema: {
    type: 'object',
    description: 'Find matching pairs among hidden elements',
    properties: {
      pairs: { type: 'number', default: 8 },
      points_per_match: { type: 'number', default: 2 }
    }
  },

  initSharedState(ctx: SharedStateInitContext): SharedStateInitResult | null {
    const config = getConfig(ctx.config);
    if (!config) return null;

    const numPairs = config.pairs ?? 8;
    const values = Array.from({ length: numPairs }, (_, i) => `pair-${i + 1}`);
    const allTiles = [...values, ...values]; // duplicate for pairs

    // Shuffle
    for (let i = allTiles.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [allTiles[i], allTiles[j]] = [allTiles[j], allTiles[i]];
    }

    const tiles: MatchTile[] = allTiles.map((value, id) => ({
      id,
      value,
      revealed: false,
      matched: false,
      matchedBy: null
    }));

    return {
      matching: {
        tiles,
        currentRevealed: [],
        matchesFound: 0,
        totalPairs: numPairs
      } as MatchingState
    };
  },

  getAvailableActions(ctx: HookContext): AvailableAction[] {
    if (!isMechanicEnabled(ctx.config, 'matching')) return [];

    const mState = getMatchState(ctx.state.shared);
    if (!mState) return [];

    if (mState.currentRevealed.length >= 2) return []; // already revealed two

    const hiddenTiles = mState.tiles.filter(t => !t.matched && !mState.currentRevealed.includes(t.id));
    return hiddenTiles.slice(0, 4).map(tile => ({
      action: {
        type: 'reveal_match',
        tileId: tile.id
      } as unknown as GameAction,
      priority: 70,
      category: 'matching'
    }));
  },

  onExecuteAction(ctx: ActionExecutionContext): ActionExecutionResult | null {
    if (ctx.action.type !== 'reveal_match') return null;

    const config = getConfig(ctx.config);
    if (!config) return null;

    const mState = getMatchState(ctx.state.shared);
    if (!mState) return null;

    const revealAction = ctx.action as unknown as { type: 'reveal_match'; tileId: number };
    const tile = mState.tiles[revealAction.tileId];
    if (!tile || tile.matched) {
      return { handled: true, logMessage: 'Invalid tile.', advanceTurn: false, checkWin: false };
    }

    const newRevealed = [...mState.currentRevealed, revealAction.tileId];

    if (newRevealed.length < 2) {
      // First reveal - keep going
      return {
        handled: true,
        stateChanges: {
          sharedStateChanges: {
            matching: { ...mState, currentRevealed: newRevealed }
          }
        },
        advanceTurn: false,
        checkWin: false,
        logMessage: `${ctx.playerId} revealed tile ${revealAction.tileId}.`,
        logData: { player: ctx.playerId, tileId: revealAction.tileId }
      };
    }

    // Second reveal - check for match
    const tile1 = mState.tiles[newRevealed[0]];
    const tile2 = mState.tiles[newRevealed[1]];
    const isMatch = tile1.value === tile2.value;

    let updatedTiles = [...mState.tiles];
    let matchesFound = mState.matchesFound;

    if (isMatch) {
      updatedTiles = updatedTiles.map(t =>
        newRevealed.includes(t.id)
          ? { ...t, matched: true, matchedBy: ctx.playerId, revealed: true }
          : t
      );
      matchesFound++;
    }

    const points = isMatch ? (config.points_per_match ?? 2) : 0;
    const allMatched = matchesFound >= mState.totalPairs;

    return {
      handled: true,
      stateChanges: {
        sharedStateChanges: {
          matching: {
            ...mState,
            tiles: updatedTiles,
            currentRevealed: [],
            matchesFound
          }
        },
        ...(points > 0 ? {
          playerStateChanges: {
            [ctx.playerId]: { score: (ctx.player.score ?? 0) + points }
          }
        } : {})
      },
      advanceTurn: !isMatch, // Match = go again, no match = next player
      checkWin: allMatched,
      logMessage: isMatch
        ? `${ctx.playerId} found a match! (${tile1.value})`
        : `${ctx.playerId} no match.`,
      logData: { player: ctx.playerId, match: isMatch, value: tile1.value, matchesFound, totalPairs: mState.totalPairs }
    };
  },

  getPlayerView(ctx: HookContext): Record<string, unknown> | null {
    if (!isMechanicEnabled(ctx.config, 'matching')) return null;

    const mState = getMatchState(ctx.state.shared);
    if (!mState) return null;

    return {
      matchingTiles: mState.tiles.map(t => ({
        id: t.id,
        value: t.matched || mState.currentRevealed.includes(t.id) ? t.value : '?',
        matched: t.matched,
        revealed: mState.currentRevealed.includes(t.id)
      })),
      matchesFound: mState.matchesFound,
      totalPairs: mState.totalPairs
    };
  }
};
