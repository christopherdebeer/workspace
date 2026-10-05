/**
 * Tile map — the world built by placing location cards (place-location) and walked by
 * grid-movement. Shared by those two and by effects that act on tiles.
 *
 * Each placed card becomes a tile with a unique id ("Forest Clearing", "Forest Clearing #2"),
 * carrying the card's terrain, effect and entry requirements, linked to the tile it was
 * placed next to. A tile has at most four links (N/S/E/W), so the world is a grid-like
 * graph without coordinates: you move along links, not anywhere.
 *
 * State: shared.tiles (id → Tile); shared.placedLocations mirrors the placed ids for
 * older readers. A player's position is player.state (a tile id; "start" = the origin).
 */
import type { GameState, GameConfig, Card } from '../../types/game';

export interface Tile {
  id: string;
  name: string;
  terrain?: string;
  effect?: { type: string; value?: number; description?: string };
  /** Item cards a player must hold to enter (e.g. a Lantern for a cave). */
  requires?: string[];
  links: string[];
  placedBy?: string;
  /** Blocked (by a Roadblock) until the end of this round. */
  blockedThroughRound?: number;
  /** Item cards lying here (from the card's `holds`), taken one at a time with search. */
  stash?: string[];
}

export const MAX_LINKS = 4;

export function originId(config: GameConfig): string {
  const grid = config.engine_mechanics?.grid as { starting_tile?: string } | undefined;
  return grid?.starting_tile || 'origin';
}

export function tilesOf(state: GameState, config: GameConfig): Record<string, Tile> {
  const shared = state.shared as Record<string, unknown>;
  let tiles = shared.tiles as Record<string, Tile> | undefined;
  if (!tiles) {
    const o = originId(config);
    tiles = { [o]: { id: o, name: 'Origin', links: [] } };
    shared.tiles = tiles;
  }
  return tiles;
}

export function positionOf(state: GameState, config: GameConfig, playerId: string): string {
  const pos = state.players[playerId]?.state;
  const tiles = tilesOf(state, config);
  return pos && tiles[pos] ? pos : originId(config);
}

export function isBlocked(state: GameState, tile: Tile | undefined): boolean {
  return !!tile?.blockedThroughRound && state.round <= tile.blockedThroughRound;
}

export function openSlots(tile: Tile): number {
  return MAX_LINKS - tile.links.length;
}

/** Why `playerId` may not enter `tileId`, or null if they may. */
export function entryProblem(state: GameState, config: GameConfig, playerId: string, tileId: string): string | null {
  const tile = tilesOf(state, config)[tileId];
  if (!tile) return `no tile "${tileId}"`;
  if (isBlocked(state, tile)) return `${tile.id} is blocked by a Roadblock this round`;
  const player = state.players[playerId];
  const hand = (player?.hand ?? []) as Card[];
  const missing = (tile.requires ?? []).filter((n) => !hand.some((c) => c.name === n));
  if (missing.length) return `entering ${tile.id} needs ${missing.join(' and ')} in hand`;
  if (tile.effect?.type === 'enemy_only' && (player as unknown as { team?: string })?.team !== 'enemy') return `only The Enemy may enter ${tile.id}`;
  return null;
}

/** Tiles linked to `from` (enterable or not). */
export function neighbours(state: GameState, config: GameConfig, from: string): string[] {
  return tilesOf(state, config)[from]?.links ?? [];
}

/** Tiles within `depth` links of `from` (excluding `from`). */
export function within(state: GameState, config: GameConfig, from: string, depth: number): string[] {
  const seen = new Set([from]);
  let frontier = [from];
  for (let d = 0; d < depth; d++) {
    const next: string[] = [];
    for (const t of frontier) for (const n of neighbours(state, config, t)) if (!seen.has(n)) (seen.add(n), next.push(n));
    frontier = next;
  }
  seen.delete(from);
  return [...seen];
}

export function placeTile(state: GameState, config: GameConfig, card: Card, adjacentTo: string, playerId: string): Tile {
  const tiles = tilesOf(state, config);
  let id = card.name;
  for (let k = 2; tiles[id]; k++) id = `${card.name} #${k}`;
  const c = card as Card & { terrain?: string; requires?: string[]; holds?: string[] };
  const tile: Tile = { id, name: card.name, terrain: c.terrain, effect: card.effect as Tile['effect'], requires: Array.isArray(c.requires) ? c.requires : undefined, links: [adjacentTo], placedBy: playerId, ...(Array.isArray(c.holds) && c.holds.length ? { stash: [...c.holds] } : {}) };
  tiles[id] = tile;
  tiles[adjacentTo].links.push(id);
  const shared = state.shared as Record<string, unknown>;
  shared.placedLocations = Object.keys(tiles).filter((t) => t !== originId(config));
  return tile;
}

/** Remove a tile (Sabotage). Its links are cut; tiles left unreachable stay on the map. */
export function removeTile(state: GameState, config: GameConfig, tileId: string): void {
  const tiles = tilesOf(state, config);
  const tile = tiles[tileId];
  if (!tile) return;
  for (const n of tile.links) if (tiles[n]) tiles[n].links = tiles[n].links.filter((l) => l !== tileId);
  delete tiles[tileId];
  const shared = state.shared as Record<string, unknown>;
  shared.placedLocations = Object.keys(tiles).filter((t) => t !== originId(config));
}

export function occupants(state: GameState, config: GameConfig, tileId: string): string[] {
  return state.turnOrder.filter((p) => positionOf(state, config, p) === tileId);
}

/** Is `other` on the same tile as `playerId`, or one link away? */
export function adjacentPlayers(state: GameState, config: GameConfig, playerId: string, other: string): boolean {
  const a = positionOf(state, config, playerId);
  const b = positionOf(state, config, other);
  return a === b || neighbours(state, config, a).includes(b);
}

/** A compact, readable map for a player: one line per tile. */
export function describeMap(state: GameState, config: GameConfig): string[] {
  const tiles = tilesOf(state, config);
  return Object.values(tiles).map((t) => {
    const bits = [t.terrain, t.effect && t.effect.type !== 'safe' ? t.effect.type : null, t.requires?.length ? `needs ${t.requires.join('+')}` : null, t.stash?.length ? `holds ${t.stash.join('+')}` : null, isBlocked(state, t) ? 'BLOCKED' : null].filter(Boolean);
    return `${t.id}${bits.length ? ` (${bits.join(', ')})` : ''} → ${t.links.join(', ') || '—'}${openSlots(t) > 0 ? ` [${openSlots(t)} open]` : ''}`;
  });
}
