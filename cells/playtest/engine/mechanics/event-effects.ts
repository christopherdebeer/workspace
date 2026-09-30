/**
 * Event Effects — card effects that act on other players or on the tile map, and the
 * passive item effects that go with them. Added in @c15r/playtest (not upstream) when
 * AAOTE's playtests showed 19 effect types silently doing nothing.
 *
 * Targeted events (play_card with a `target`; this mechanic advertises one concrete
 * option per card × valid target, and the cards mechanic leaves these cards to it):
 *   peek_hand        (player)  see their hand                               — Spy
 *   peek_objective   (player)  see their secret objective                   — Interrogate
 *   steal_item       (player)  take a random item from a player next to you — Theft
 *   block_tile       (tile)    nobody may enter it until the end of next round — Roadblock
 *   destroy_location (tile)    remove an empty tile from the map            — Sabotage
 *   teleport_adjacent(tile)    jump next to any other player                — Shortcut
 *   secret_move      (tile)    move up to two tiles, position hidden        — Hidden Path
 * Untargeted: extra_movement (value N) — your next N moves this turn cost 0 AP (Swift Journey).
 * Reactions: counter — held; cancels the next event aimed at you, then is discarded (Evasion).
 * Items: collectible (value N, default 3) — spend N same-name items to see an objective
 * (Map Fragments); movement_bonus — first move each turn free (read by action-points).
 *
 * A card's `requires` lists item names that must be in hand to play it (one of each is
 * spent), or "adjacency" (the target must be on your tile or next to it).
 * What a player learns is kept in player.knowledge.revealed and shown in their view.
 */
import { MechanicHooks, HookContext, ValidationResult, AvailableAction, StateChanges, ActionExecutionContext, ActionExecutionResult, TurnStartContext } from './types';
import type { CardsHooks, CardPlayedPayload } from './core/cards';
import type { GameAction, Card, PlayerState } from '../types/game';
import { removeCardsFromHand, addToHand } from './core/hand';
import { addToDiscard } from './core/card-piles';
import { powerEffect } from './variable-player-powers';
import { tilesOf, positionOf, neighbours, within, entryProblem, occupants, adjacentPlayers, removeTile, originId } from './core/tile-map';

type TargetKind = 'player' | 'tile' | 'none';

/** Effect types this mechanic resolves when their card is played. */
export const EVENT_EFFECTS: Record<string, TargetKind> = {
  peek_hand: 'player',
  peek_objective: 'player',
  steal_item: 'player',
  block_tile: 'tile',
  destroy_location: 'tile',
  teleport_adjacent: 'tile',
  secret_move: 'tile',
  extra_movement: 'none',
};
/** Held, never played: they work from the hand. */
export const PASSIVE_EFFECTS = new Set(['counter', 'collectible', 'movement_bonus', 'utility', 'currency', 'enemy_item']);

type Knowing = Omit<PlayerState, 'knowledge'> & { knowledge?: { revealed?: Record<string, unknown> }; freeMoves?: number; hiddenPosition?: boolean; objective?: { name: string; condition: string } };

const hand = (s: { players: Record<string, PlayerState> }, p: string) => (s.players[p]?.hand ?? []) as Card[];
const requiresOf = (card: Card) => ((card as Card & { requires?: string[] }).requires ?? []).filter((r) => typeof r === 'string');

function learn(ctx: HookContext, key: string, value: unknown) {
  const me = ctx.state.players[ctx.playerId] as unknown as { knowledge?: { revealed?: Record<string, unknown> } };
  const k = (me.knowledge ??= {});
  (k.revealed ??= {})[key] = value;
}

/** Valid targets for a targeted event card, as this player could use it now. */
function targetsFor(ctx: HookContext, card: Card): string[] {
  const kind = EVENT_EFFECTS[card.effect?.type ?? ''];
  const { state, config, playerId } = ctx;
  const others = state.turnOrder.filter((p) => p !== playerId);
  const needsAdjacency = requiresOf(card).includes('adjacency');
  if (kind === 'player') {
    return others.filter((p) => {
      const power = powerEffect(state, config, p);
      if (power?.type === 'immune' && power.to.includes(card.effect?.type ?? '')) return false;
      if (needsAdjacency && !adjacentPlayers(state, config, playerId, p)) return false;
      if (card.effect?.type === 'steal_item') return hand(state, p).some((c) => c.type === 'item');
      return true;
    });
  }
  if (kind === 'tile') {
    const tiles = tilesOf(state, config);
    const here = positionOf(state, config, playerId);
    switch (card.effect?.type) {
      case 'block_tile':
        return Object.keys(tiles).filter((t) => t !== originId(config));
      case 'destroy_location':
        return Object.keys(tiles).filter((t) => t !== originId(config) && !occupants(state, config, t).length);
      case 'teleport_adjacent': {
        const spots = new Set<string>();
        for (const p of others) for (const n of neighbours(state, config, positionOf(state, config, p))) spots.add(n);
        spots.delete(here);
        return [...spots].filter((t) => !entryProblem(state, config, playerId, t));
      }
      case 'secret_move':
        return within(state, config, here, 2).filter((t) => !entryProblem(state, config, playerId, t));
    }
  }
  return [];
}

function missingItems(ctx: HookContext, card: Card): string[] {
  const h = hand(ctx.state, ctx.playerId);
  return requiresOf(card).filter((r) => r !== 'adjacency' && !h.some((c) => c.name === r && c !== card));
}

export const eventEffectsMechanic: MechanicHooks & CardsHooks = {
  slug: 'event-effects',
  name: 'Event Effects',
  requires: ['cards'],

  preValidateAction(ctx: HookContext, action: GameAction): ValidationResult | null {
    if ((action.type as string) === 'combine_collectibles') return validateCombine(ctx, action as unknown as { card: string; target: string });
    if (action.type !== 'play_card') return null;
    const a = action as unknown as { card: string; target?: string };
    const card = hand(ctx.state, ctx.playerId).find((c) => c.name === a.card);
    const type = card?.effect?.type ?? '';
    if (!card) return null;
    if (PASSIVE_EFFECTS.has(type)) return { valid: false, error: `${card.name} works from your hand; it is not played` };
    if (!(type in EVENT_EFFECTS)) return null;
    const missing = missingItems(ctx, card);
    if (missing.length) return { valid: false, error: `${card.name} needs ${missing.join(' and ')} in hand` };
    if (EVENT_EFFECTS[type] === 'none') return { valid: true };
    if (!a.target) return { valid: false, error: `${card.name} needs a target` };
    if (!targetsFor(ctx, card).includes(a.target)) return { valid: false, error: `${a.target} is not a valid target for ${card.name} now` };
    return { valid: true };
  },

  getAvailableActions(ctx: HookContext): AvailableAction[] {
    const examples: GameAction[] = [];
    const seen = new Set<string>();
    for (const card of hand(ctx.state, ctx.playerId)) {
      const type = card.effect?.type ?? '';
      if (!(type in EVENT_EFFECTS) || seen.has(card.name)) continue;
      seen.add(card.name);
      if (missingItems(ctx, card).length) continue;
      if (EVENT_EFFECTS[type] === 'none') examples.push({ type: 'play_card', card: card.name } as unknown as GameAction);
      else for (const target of targetsFor(ctx, card)) examples.push({ type: 'play_card', card: card.name, target } as unknown as GameAction);
    }
    const out: AvailableAction[] = [];
    if (examples.length) out.push({ action: examples[0], priority: 55, category: 'events', description: 'Play an event card at a target', required: { card: 'Event card', target: 'Player or tile' }, examples });
    const combos = combineOptions(ctx);
    if (combos.length) out.push({ action: combos[0], priority: 40, category: 'events', description: 'Spend a set of collectible items to see a player’s objective', required: { card: 'Collectible item', target: 'Player' }, examples: combos });
    return out;
  },

  onExecuteAction(ctx: ActionExecutionContext): ActionExecutionResult | null {
    if ((ctx.action.type as string) !== 'combine_collectibles') return null;
    const a = ctx.action as unknown as { card: string; target: string };
    const card = hand(ctx.state, ctx.playerId).find((c) => c.name === a.card)!;
    const n = card.effect?.value ?? 3;
    const spent = removeCardsFromHand(ctx.state, ctx.playerId, Array(n).fill(a.card));
    addToDiscard(ctx.state, spent, ctx.playerId);
    const obj = (ctx.state.players[a.target] as Knowing).objective;
    learn(ctx, `${a.target} objective`, obj ? `${obj.name}: ${obj.condition}` : 'none');
    return { handled: true, advanceTurn: false, checkWin: true, logMessage: 'collectibles_combined', logData: { card: a.card, spent: n, target: a.target } };
  },

  /** Resolve the effect of a played event card (the card is already in the discard). */
  onCardPlayed(ctx: HookContext, { card, playContext }: CardPlayedPayload): StateChanges | null {
    const type = card.effect?.type ?? '';
    if (!(type in EVENT_EFFECTS)) return null;
    const { state, config, playerId } = ctx;
    const me = state.players[playerId] as Knowing;
    const target = playContext?.actionTarget as string | undefined;
    // Spend required items (one of each); "adjacency" is a condition, not a cost.
    const cost = requiresOf(card).filter((r) => r !== 'adjacency');
    if (cost.length) addToDiscard(state, removeCardsFromHand(state, playerId, cost), playerId);
    // Evasion: an event aimed at a player who holds a counter card is cancelled.
    if (EVENT_EFFECTS[type] === 'player' && target) {
      const counter = hand(state, target).find((c) => c.effect?.type === 'counter');
      if (counter) {
        addToDiscard(state, removeCardsFromHand(state, target, [counter.name]), target);
        learn(ctx, `${target} evaded`, `${card.name} was cancelled by ${target}'s ${counter.name}`);
        return null;
      }
    }
    switch (type) {
      case 'peek_hand':
        if (target) learn(ctx, `${target} hand (round ${state.round})`, hand(state, target).map((c) => c.name));
        break;
      case 'peek_objective': {
        const obj = target ? (state.players[target] as Knowing).objective : undefined;
        if (target) learn(ctx, `${target} objective`, obj ? `${obj.name}: ${obj.condition}` : 'none');
        break;
      }
      case 'steal_item': {
        if (!target) break;
        const items = hand(state, target).filter((c) => c.type === 'item');
        if (!items.length) break;
        const pick = items[Math.floor(Math.random() * items.length)];
        addToHand(state, playerId, removeCardsFromHand(state, target, [pick.name]));
        learn(ctx, `stole from ${target}`, pick.name);
        break;
      }
      case 'block_tile': {
        const t = target ? tilesOf(state, config)[target] : undefined;
        if (t) t.blockedThroughRound = state.round + Math.max(1, Number((card.effect as { duration?: number }).duration ?? 1));
        break;
      }
      case 'destroy_location':
        if (target) removeTile(state, config, target);
        break;
      case 'teleport_adjacent':
      case 'secret_move': {
        if (!target) break;
        me.state = target;
        const visited = me.visitedLocations ?? (me.visitedLocations = []);
        if (!visited.includes(target)) visited.push(target);
        me.hiddenPosition = type === 'secret_move';
        break;
      }
      case 'extra_movement':
        me.freeMoves = (me.freeMoves ?? 0) + (card.effect?.value ?? 1);
        break;
    }
    return null;
  },

  /** Free moves and a hidden position last only until your next turn. */
  onTurnStart(ctx: TurnStartContext): StateChanges | null {
    const me = ctx.state.players[ctx.playerId] as Knowing;
    if (me) {
      me.freeMoves = 0;
      (me as unknown as { usedMovementBonus?: boolean }).usedMovementBonus = false;
    }
    return null;
  },

  /** A normal move ends a secret position. */
  postExecuteAction(ctx: HookContext, action: GameAction): StateChanges | null {
    if (action.type === 'move') (ctx.state.players[ctx.playerId] as Knowing).hiddenPosition = false;
    return null;
  },

  getPlayerView(ctx: HookContext): Record<string, unknown> | null {
    const me = ctx.state.players[ctx.playerId] as Knowing;
    const out: Record<string, unknown> = {};
    const known = me?.knowledge?.revealed;
    if (known && Object.keys(known).length) out.whatYouKnow = known;
    if (me?.freeMoves) out.freeMovesLeft = me.freeMoves;
    return Object.keys(out).length ? out : null;
  },
};

function combineOptions(ctx: HookContext): GameAction[] {
  const counts = new Map<string, { n: number; need: number }>();
  for (const c of hand(ctx.state, ctx.playerId)) {
    if (c.effect?.type !== 'collectible') continue;
    const e = counts.get(c.name) ?? { n: 0, need: c.effect.value ?? 3 };
    e.n++;
    counts.set(c.name, e);
  }
  const out: GameAction[] = [];
  for (const [card, { n, need }] of counts) if (n >= need) for (const target of ctx.state.turnOrder.filter((p) => p !== ctx.playerId)) out.push({ type: 'combine_collectibles', card, target } as unknown as GameAction);
  return out;
}

function validateCombine(ctx: HookContext, a: { card: string; target: string }): ValidationResult {
  const same = hand(ctx.state, ctx.playerId).filter((c) => c.name === a.card && c.effect?.type === 'collectible');
  const need = same[0]?.effect?.value ?? 3;
  if (same.length < need) return { valid: false, error: `need ${need} × ${a.card} (have ${same.length})` };
  if (!ctx.state.players[a.target] || a.target === ctx.playerId) return { valid: false, error: 'choose another player' };
  return { valid: true };
}
