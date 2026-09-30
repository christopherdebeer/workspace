/**
 * Grid Movement Mechanic
 *
 * Tile-based movement on the tile map (core/tile-map.ts): one move goes along one link
 * to a neighbouring tile. Entry rules come from the tile's card: `requires` (items you
 * must hold, e.g. a Lantern for a cave), enemy_only (only The Enemy may enter — and
 * entering reveals them), Roadblocks. Entering applies the tile's effect (draw_on_enter)
 * and is counted in player.visitedLocations (distinct tiles, for "visit N locations").
 * An effect with `once: true` fires only on a player's first entry to that tile.
 *
 * Hooks used:
 * - preValidateAction: Validate move target is a placed location
 * - onExecuteAction: Handle move execution with location effects
 * - getAvailableActions: Expose available move targets
 * - describeAction: Describe move action
 */

import {
  MechanicHooks,
  HookContext,
  ValidationResult,
  ActionExecutionContext,
  ActionExecutionResult,
  AvailableAction,
  ActionDescription,
  StateChanges,
  ActionSchema
} from './types';
import { GameAction, Card } from '../types/game';
import { getCardsState } from './core/index';
import { tilesOf, positionOf, neighbours, entryProblem, describeMap, isBlocked } from './core/tile-map';

interface GridConfig {
  type?: string;
  starting_tile?: string;
  adjacency?: string;
}

/** Neighbouring tiles this player may enter now. */
function getValidMoveTargets(ctx: HookContext): string[] {
  if (!(ctx.config.engine_mechanics?.grid as GridConfig | undefined)) return [];
  const here = positionOf(ctx.state, ctx.config, ctx.playerId);
  return neighbours(ctx.state, ctx.config, here).filter((t) => !entryProblem(ctx.state, ctx.config, ctx.playerId, t));
}

export const gridMovementMechanic: MechanicHooks = {
  slug: 'grid-movement',
  name: 'Grid Movement',
  requires: ['board'],

  getActionSchema(action: GameAction): ActionSchema | null {
    if (action.type !== 'move') return null;
    return { required: ['target'], fields: { target: { type: 'string' } } };
  },

  preValidateAction(ctx: HookContext, action: GameAction): ValidationResult | null {
    if (action.type !== 'move') return null;
    if (!(ctx.config.engine_mechanics?.grid as GridConfig | undefined)) return null;
    const target = (action as { target: string }).target;
    const here = positionOf(ctx.state, ctx.config, ctx.playerId);
    if (!tilesOf(ctx.state, ctx.config)[target]) return { valid: false, error: `No location "${target}" on the map` };
    if (!neighbours(ctx.state, ctx.config, here).includes(target)) return { valid: false, error: `${target} is not next to ${here}: move one linked tile at a time (${neighbours(ctx.state, ctx.config, here).join(', ') || 'no links yet — place a location first'})` };
    const problem = entryProblem(ctx.state, ctx.config, ctx.playerId, target);
    if (problem) return { valid: false, error: problem };
    return { valid: true };
  },

  onExecuteAction(ctx: ActionExecutionContext): ActionExecutionResult | null {
    const { action, player, playerId, state, config } = ctx;
    if (action.type !== 'move') return null;
    if (!(config.engine_mechanics?.grid as GridConfig | undefined)) return null;
    const target = (action as { target: string }).target;
    const tile = tilesOf(state, config)[target];
    const previousState = player.state;
    const effectsApplied: string[] = [];
    let cardsDrawn = 0;
    const effect = tile?.effect;
    // An effect marked `once: true` applies only on this player's first entry to the tile.
    const firstEntry = !(player.visitedLocations ?? []).includes(target);
    if (effect && (firstEntry || !(effect as { once?: boolean }).once)) {
      switch (effect.type) {
        case 'draw_on_enter': {
          const drawCount = effect.value ?? 1;
          const handLimit = (config.engine_mechanics?.hand_limit as number) ?? Infinity;
          const playerHand = player.hand ?? [];
          const cardsState = getCardsState(state);
          const n = Math.min(drawCount, handLimit - playerHand.length, cardsState.deck.length);
          if (n > 0) {
            playerHand.push(...cardsState.deck.splice(0, n));
            cardsDrawn = n;
            effectsApplied.push(`${tile.id}: drew ${n} card${n !== 1 ? 's' : ''}`);
          }
          break;
        }
        case 'enemy_only': {
          // Only The Enemy gets in — and everyone now knows who they are.
          (player as unknown as { revealedAs?: string }).revealedAs = String((player as unknown as { hiddenRole?: string }).hiddenRole ?? 'The Enemy');
          effectsApplied.push(`${tile.id}: ${playerId} entered — revealed as The Enemy`);
          break;
        }
        case 'trade_bonus':
          effectsApplied.push(`${tile.id}: trade offers cost 0 AP here`);
          break;
        case 'hide':
          effectsApplied.push(`${tile.id}: your position is hidden from others`);
          break;
        case 'reveal':
          effectsApplied.push(`${tile.id}: you see every player's position`);
          break;
        default:
          break;
      }
    }
    const visited = player.visitedLocations ?? (player.visitedLocations = []);
    if (!visited.includes(target)) visited.push(target);
    player.state = target;
    return {
      handled: true,
      stateChanges: { playerStateChanges: { [playerId]: { state: target, visitedLocations: visited } } },
      advanceTurn: false, // action points end the turn
      checkWin: true,
      logMessage: 'player_moved',
      logData: { target, previousState, locationEffects: effectsApplied, cardsDrawn, visitedCount: visited.length }
    };
  },

  getAvailableActions(ctx: HookContext): AvailableAction[] {
    if (!(ctx.config.engine_mechanics?.grid as GridConfig | undefined)) return [];
    const validTargets = getValidMoveTargets(ctx);
    return [{
      action: { type: 'move', target: validTargets[0] || '' } as unknown as GameAction,
      priority: 50,
      category: 'movement',
      enabled: validTargets.length > 0 ? undefined : false,
      reason: validTargets.length === 0 ? 'No enterable tile next to you' : undefined,
      description: 'Move to a neighbouring tile',
      required: { target: 'A tile linked to yours' },
      examples: validTargets.map((target) => ({ type: 'move', target } as unknown as GameAction)),
      targets: validTargets,
    }];
  },

  /** The map as the player sees it, and where everyone is (except those hidden in a
   *  Hidden Cave — unless you stand in the Watchtower). */
  getPlayerView(ctx: HookContext): Record<string, unknown> | null {
    if (!(ctx.config.engine_mechanics?.grid as GridConfig | undefined)) return null;
    const tiles = tilesOf(ctx.state, ctx.config);
    const here = positionOf(ctx.state, ctx.config, ctx.playerId);
    const seeAll = tiles[here]?.effect?.type === 'reveal';
    const positions: Record<string, string> = {};
    for (const p of ctx.state.turnOrder) {
      if (p === ctx.playerId) continue;
      const at = positionOf(ctx.state, ctx.config, p);
      const hidden = tiles[at]?.effect?.type === 'hide' || !!(ctx.state.players[p] as unknown as { hiddenPosition?: boolean })?.hiddenPosition;
      positions[p] = hidden && !seeAll ? 'hidden' : at;
    }
    const revealed = ctx.state.turnOrder.filter((p) => (ctx.state.players[p] as unknown as { revealedAs?: string })?.revealedAs);
    return {
      yourLocation: here,
      map: describeMap(ctx.state, ctx.config),
      otherPlayersAt: positions,
      ...(revealed.length ? { revealedEnemies: revealed } : {}),
      blockedTiles: Object.values(tiles).filter((t) => isBlocked(ctx.state, t)).map((t) => t.id),
    };
  },

  describeAction(action: GameAction): ActionDescription | null {
    if (action.type !== 'move') return null;
    const moveAction = action as { target: string };
    return {
      type: 'move',
      label: 'Move',
      description: `Move to a neighbouring tile.${moveAction.target ? ` Target: ${moveAction.target}` : ''}`,
      examples: ['move target:"Ancient Ruins"']
    };
  }
};
