/**
 * Ladder Climbing Mechanic
 *
 * Card game mechanic where players must play cards that beat the previous play,
 * or pass. Common in games like President/Daifugō, Big Two, Tichu.
 *
 * Flow:
 * 1. Lead player plays a card or combination
 * 2. Next players must beat the current play or pass
 * 3. When all players pass, the last player who played leads next
 * 4. First player to empty hand wins (typically)
 *
 * Hooks used:
 * - preValidateAction: Validate play beats current or is a pass
 * - onExecuteAction: Handle card play and round clearing
 * - getAvailableActions: Expose valid plays
 * - describeAction: Describe ladder climbing rules
 */

import {
  MechanicHooks,
  HookContext,
  ValidationResult,
  ActionExecutionContext,
  ActionExecutionResult,
  AvailableAction,
  ActionDescription,
  StateChanges
} from './types';
import { GameAction, Card, PlayCardAction } from '../types/game';
import { removeFromHandByName, getHand } from './core/hand';
import { mechanicRegistry, applyStateChanges } from './registry';

interface LadderClimbingConfig {
  /** How to compare cards: 'value' (numeric), 'rank' (use rank_order) */
  comparison: 'value' | 'rank';
  /** Rank order from lowest to highest (for comparison: 'rank') */
  rank_order?: string[];
  /** Whether higher beats lower (true) or lower beats higher (false) */
  higher_wins?: boolean;
  /** Allow combinations (pairs, triples, runs) */
  allow_combinations?: boolean;
  /** Combination types allowed */
  combination_types?: ('single' | 'pair' | 'triple' | 'quad' | 'run')[];
  /** Minimum run length */
  min_run_length?: number;
  /** Whether passing removes you from the round */
  pass_eliminates?: boolean;
  /** Special cards that can be played anytime */
  wild_cards?: string[];
  /** Cards that clear the pile and give lead */
  bomb_cards?: string[];
  /** Automatically advance winner to next node (for racing games) */
  auto_advance_winner?: boolean;
}

interface CurrentPlay {
  playerId: string;
  cards: Card[];
  combinationType: string;
  value: number;
}

function getCardValue(card: Card, config: LadderClimbingConfig): number {
  if (config.comparison === 'rank' && config.rank_order) {
    const cardValue = String(card.value ?? card.name);
    const idx = config.rank_order.indexOf(cardValue);
    return idx !== -1 ? idx : -1;
  }
  return typeof card.value === 'number' ? card.value : 0;
}

function getCombinationType(cards: Card[], config: LadderClimbingConfig): string | null {
  if (cards.length === 0) return null;
  if (cards.length === 1) return 'single';

  const values = cards.map(c => getCardValue(c, config));
  const allSame = values.every(v => v === values[0]);

  if (allSame) {
    if (cards.length === 2) return 'pair';
    if (cards.length === 3) return 'triple';
    if (cards.length === 4) return 'quad';
  }

  // Check for run (consecutive values)
  const sorted = [...values].sort((a, b) => a - b);
  const isRun = sorted.every((v, i) => i === 0 || v === sorted[i - 1] + 1);
  const minRunLength = config.min_run_length ?? 3;

  if (isRun && cards.length >= minRunLength) {
    return 'run';
  }

  return null;
}

function getCombinationValue(cards: Card[], config: LadderClimbingConfig): number {
  const values = cards.map(c => getCardValue(c, config));
  // For runs, use highest card; for sets, use the card value
  return Math.max(...values);
}

function canBeatPlay(
  newCards: Card[],
  currentPlay: CurrentPlay | null,
  config: LadderClimbingConfig
): { canBeat: boolean; reason?: string } {
  if (!currentPlay) {
    // Leading - any valid combination
    return { canBeat: true };
  }

  const newType = getCombinationType(newCards, config);
  if (!newType) {
    return { canBeat: false, reason: 'Invalid card combination' };
  }

  // Check if bomb (special card that beats anything)
  if (config.bomb_cards) {
    const isBomb = newCards.every(c => config.bomb_cards!.includes(c.name));
    if (isBomb) return { canBeat: true };
  }

  // Must match combination type
  if (newType !== currentPlay.combinationType) {
    // Quads beat everything except other quads
    if (newType === 'quad' && currentPlay.combinationType !== 'quad') {
      return { canBeat: true };
    }
    return { canBeat: false, reason: `Must play ${currentPlay.combinationType}, not ${newType}` };
  }

  // Must match card count for runs
  if (newType === 'run' && newCards.length !== currentPlay.cards.length) {
    return { canBeat: false, reason: `Run must have ${currentPlay.cards.length} cards` };
  }

  const newValue = getCombinationValue(newCards, config);
  const higherWins = config.higher_wins ?? true;

  if (higherWins) {
    if (newValue <= currentPlay.value) {
      return { canBeat: false, reason: `Must play higher than ${currentPlay.value}` };
    }
  } else {
    if (newValue >= currentPlay.value) {
      return { canBeat: false, reason: `Must play lower than ${currentPlay.value}` };
    }
  }

  return { canBeat: true };
}

export const ladderClimbingMechanic: MechanicHooks = {
  slug: 'ladder-climbing',
  name: 'Ladder Climbing',
  requires: ['cards'],

  configSchema: {
    type: 'object',
    description: 'Beat the previous play or pass (President, Big Two style)',
    properties: {
      comparison: {
        type: 'string',
        description: 'How to compare cards',
        enum: ['value', 'rank'],
        default: 'value'
      },
      rank_order: {
        type: 'array',
        description: 'Rank order from lowest to highest'
      },
      higher_wins: {
        type: 'boolean',
        description: 'Whether higher beats lower',
        default: true
      },
      allow_combinations: {
        type: 'boolean',
        description: 'Allow pairs, triples, runs',
        default: true
      },
      combination_types: {
        type: 'array',
        description: 'Allowed combination types',
        default: ['single', 'pair', 'triple', 'quad', 'run']
      },
      min_run_length: {
        type: 'number',
        description: 'Minimum cards in a run',
        default: 3
      },
      pass_eliminates: {
        type: 'boolean',
        description: 'Passing removes player from round',
        default: false
      },
      wild_cards: {
        type: 'array',
        description: 'Cards playable anytime'
      },
      bomb_cards: {
        type: 'array',
        description: 'Cards that clear and take lead'
      }
    }
  },

  preValidateAction(ctx: HookContext, action: GameAction): ValidationResult | null {
    if (action.type !== 'play_card' && action.type !== 'pass') return null;

    const ladderConfig = ctx.config.engine_mechanics?.ladder_climbing as LadderClimbingConfig | undefined;
    if (!ladderConfig) return null;

    // Pass is always valid (unless eliminated)
    if (action.type === 'pass') {
      if (ladderConfig.pass_eliminates && ctx.player.ladderEliminated) {
        return { valid: false, error: 'You have already passed this round and cannot play.' };
      }
      return { valid: true };
    }

    const playAction = action as PlayCardAction;
    const hand = getHand(ctx.state, ctx.playerId);

    // Support single card or multiple cards (comma-separated in card field)
    const cardNames = playAction.card.split(',').map(s => s.trim());
    const cardsToPlay = cardNames.map(name => hand.find(c => c.name === name)).filter((c): c is Card => c !== undefined);

    if (cardsToPlay.length !== cardNames.length) {
      const missing = cardNames.filter(name => !hand.find(c => c.name === name));
      return { valid: false, error: `Cards not in hand: ${missing.join(', ')}` };
    }

    // Check combination type is valid
    const combType = getCombinationType(cardsToPlay, ladderConfig);
    if (!combType) {
      return { valid: false, error: 'Invalid card combination' };
    }

    const allowedTypes = ladderConfig.combination_types ?? ['single', 'pair', 'triple', 'quad', 'run'];
    if (!allowedTypes.includes(combType as 'single' | 'pair' | 'triple' | 'quad' | 'run')) {
      return { valid: false, error: `${combType} combinations not allowed` };
    }

    // Check if can beat current play
    const currentPlay = ctx.state.shared.ladderCurrentPlay as CurrentPlay | null;
    const beatResult = canBeatPlay(cardsToPlay, currentPlay, ladderConfig);

    if (!beatResult.canBeat) {
      return { valid: false, error: beatResult.reason || 'Cannot beat current play' };
    }

    return { valid: true };
  },

  onExecuteAction(ctx: ActionExecutionContext): ActionExecutionResult | null {
    const { action, playerId, state } = ctx;

    if (action.type !== 'play_card' && action.type !== 'pass') return null;

    const ladderConfig = ctx.config.engine_mechanics?.ladder_climbing as LadderClimbingConfig | undefined;
    if (!ladderConfig) return null;

    const stateChanges: StateChanges = {
      sharedStateChanges: {},
      playerStateChanges: {}
    };

    if (action.type === 'pass') {
      // Track pass
      const passCount = ((state.shared.ladderPassCount as number) || 0) + 1;
      const activePlayers = state.turnOrder.filter(pid => {
        const p = state.players[pid];
        return !p.ladderEliminated && (p.hand ?? []).length > 0;
      });

      stateChanges.sharedStateChanges!.ladderPassCount = passCount;

      if (ladderConfig.pass_eliminates) {
        stateChanges.playerStateChanges![playerId] = { ladderEliminated: true };
      }

      // Check if round is over (all but one passed)
      const currentPlay = state.shared.ladderCurrentPlay as CurrentPlay | null;
      if (currentPlay && passCount >= activePlayers.length - 1) {
        // Round over - last player who played leads
        stateChanges.sharedStateChanges!.ladderCurrentPlay = null;
        stateChanges.sharedStateChanges!.ladderPassCount = 0;
        stateChanges.sharedStateChanges!.ladderLeader = currentPlay.playerId;

        // Reset eliminations
        for (const pid of state.turnOrder) {
          stateChanges.playerStateChanges![pid] = {
            ...stateChanges.playerStateChanges![pid],
            ladderEliminated: false
          };
        }

        // Auto-advance winner if configured (for racing games)
        if (ladderConfig.auto_advance_winner) {
          const winner = currentPlay.playerId;
          const winnerPlayer = state.players[winner];
          const currentNode = winnerPlayer.currentNode || 'Start';

          // Find next node in point-to-point movement
          const movementConfig = ctx.config.engine_mechanics?.point_to_point_movement as {
            routes?: Array<{ from: string; to: string }>;
          } | undefined;

          if (movementConfig?.routes) {
            const nextRoute = movementConfig.routes.find(r => r.from === currentNode);
            if (nextRoute) {
              // Automatically move winner to next node
              stateChanges.playerStateChanges![winner] = {
                ...stateChanges.playerStateChanges![winner],
                currentNode: nextRoute.to
              };
            }
          }
        }

        return {
          handled: true,
          stateChanges,
          advanceTurn: true,
          checkWin: true,  // Check win after movement (might have reached goal)
          logMessage: 'ladder_round_won',
          logData: { winner: currentPlay.playerId, passes: passCount, autoAdvanced: ladderConfig.auto_advance_winner }
        };
      }

      return {
        handled: true,
        stateChanges,
        advanceTurn: true,
        checkWin: false,
        logMessage: 'ladder_pass',
        logData: { player: playerId, passCount }
      };
    }

    // Play cards
    const playAction = action as PlayCardAction;
    const hand = getHand(state, playerId);
    const cardNames = playAction.card.split(',').map(s => s.trim());
    const cardsToPlay: Card[] = [];

    // Remove cards from hand
    for (const cardName of cardNames) {
      const card = removeFromHandByName(state, playerId, cardName);
      if (card) cardsToPlay.push(card);
    }

    // Fire cards-defined onCardPlayed hook for each card (ladder-climbing bypasses
    // playCard(), so we fire manually with target: 'ladder')
    for (const card of cardsToPlay) {
      const cardPlayedChanges = mechanicRegistry.fire('cards', 'onCardPlayed', state, playerId, {
        card, target: 'ladder', playContext: {}
      });
      if (cardPlayedChanges) applyStateChanges(state, cardPlayedChanges);
    }

    const combType = getCombinationType(cardsToPlay, ladderConfig)!;
    const combValue = getCombinationValue(cardsToPlay, ladderConfig);

    // Update current play
    const newPlay: CurrentPlay = {
      playerId,
      cards: cardsToPlay,
      combinationType: combType,
      value: combValue
    };

    stateChanges.sharedStateChanges!.ladderCurrentPlay = newPlay;
    stateChanges.sharedStateChanges!.ladderPassCount = 0;

    // Check for bomb
    const isBomb = ladderConfig.bomb_cards &&
      cardsToPlay.every(c => ladderConfig.bomb_cards!.includes(c.name));

    if (isBomb) {
      // Bomb clears and gives lead
      stateChanges.sharedStateChanges!.ladderCurrentPlay = null;
      stateChanges.sharedStateChanges!.ladderLeader = playerId;

      return {
        handled: true,
        stateChanges,
        advanceTurn: false, // Bomber leads
        checkWin: true,
        logMessage: 'ladder_bomb',
        logData: { player: playerId, cards: cardNames }
      };
    }

    return {
      handled: true,
      stateChanges,
      advanceTurn: true,
      checkWin: true, // Check if hand is empty
      logMessage: 'ladder_play',
      logData: {
        player: playerId,
        cards: cardNames,
        type: combType,
        value: combValue
      }
    };
  },

  getAvailableActions(ctx: HookContext): AvailableAction[] {
    const ladderConfig = ctx.config.engine_mechanics?.ladder_climbing as LadderClimbingConfig | undefined;
    if (!ladderConfig) return [];

    const actions: AvailableAction[] = [];
    const hand = getHand(ctx.state, ctx.playerId);
    const currentPlay = ctx.state.shared.ladderCurrentPlay as CurrentPlay | null;

    // Always can pass (unless eliminated)
    if (!ctx.player.ladderEliminated) {
      actions.push({
        action: { type: 'pass' } as GameAction,
        priority: 10,
        category: 'ladder-climbing'
      });
    }

    // Find valid plays
    const allowedTypes = ladderConfig.combination_types ?? ['single', 'pair', 'triple', 'quad', 'run'];

    // Singles
    if (allowedTypes.includes('single')) {
      for (const card of hand) {
        const result = canBeatPlay([card], currentPlay, ladderConfig);
        if (result.canBeat) {
          actions.push({
            action: { type: 'play_card', card: card.name } as GameAction,
            priority: 50,
            category: 'ladder-climbing'
          });
        }
      }
    }

    // Group cards by value for pairs/triples/quads
    if (allowedTypes.includes('pair') || allowedTypes.includes('triple') || allowedTypes.includes('quad')) {
      const byValue = new Map<number, Card[]>();
      for (const card of hand) {
        const val = getCardValue(card, ladderConfig);
        if (!byValue.has(val)) byValue.set(val, []);
        byValue.get(val)!.push(card);
      }

      for (const [, cards] of byValue) {
        if (cards.length >= 2 && allowedTypes.includes('pair')) {
          const pair = cards.slice(0, 2);
          const result = canBeatPlay(pair, currentPlay, ladderConfig);
          if (result.canBeat) {
            actions.push({
              action: { type: 'play_card', card: pair.map(c => c.name).join(',') } as GameAction,
              priority: 55,
              category: 'ladder-climbing'
            });
          }
        }
        if (cards.length >= 3 && allowedTypes.includes('triple')) {
          const triple = cards.slice(0, 3);
          const result = canBeatPlay(triple, currentPlay, ladderConfig);
          if (result.canBeat) {
            actions.push({
              action: { type: 'play_card', card: triple.map(c => c.name).join(',') } as GameAction,
              priority: 60,
              category: 'ladder-climbing'
            });
          }
        }
        if (cards.length >= 4 && allowedTypes.includes('quad')) {
          const quad = cards.slice(0, 4);
          const result = canBeatPlay(quad, currentPlay, ladderConfig);
          if (result.canBeat) {
            actions.push({
              action: { type: 'play_card', card: quad.map(c => c.name).join(',') } as GameAction,
              priority: 70,
              category: 'ladder-climbing'
            });
          }
        }
      }
    }

    return actions;
  },

  describeAction(action: GameAction): ActionDescription | null {
    if (action.type === 'play_card') {
      return {
        type: 'play_card',
        label: 'Play Cards',
        description: 'Play card(s) that beat the current play. Use comma-separated names for combinations.',
        examples: ['play_card card:"7"', 'play_card card:"7,7"']
      };
    }
    if (action.type === 'pass') {
      return {
        type: 'pass',
        label: 'Pass',
        description: 'Pass on this play. If all players pass, the last player to play leads.',
        examples: ['pass']
      };
    }
    return null;
  }
};
