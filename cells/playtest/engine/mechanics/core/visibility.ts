/**
 * Visibility Core Service
 *
 * Manages information visibility for hidden information games.
 * This enables mechanics like:
 * - hidden-roles: Secret role assignment
 * - hidden-movement: Hidden player positions
 * - hidden-victory-points: Secret scoring
 * - traitor-game: Hidden traitor role
 *
 * Global hooks (remain on MechanicHooks):
 * - getVisibleState: Filter state for a specific viewer
 * - canSeeInfo: Check if viewer can see specific info type
 *
 * Fires visibility-defined hooks:
 * - onBeforeReveal: Can block reveals (blocking)
 * - onInfoRevealed: Notified after info revealed (merge)
 */

import { GameState, PlayerState } from '../../types/game';
import { VisibilityContext, VisibleState } from '../types';
import { mechanicRegistry, applyStateChanges } from '../registry';

/**
 * Information types that can be hidden/revealed
 */
export type InfoType =
  | 'role'           // Player's secret role
  | 'team'           // Player's team affiliation
  | 'hand'           // Cards in hand
  | 'position'       // Current location
  | 'score'          // Victory points
  | 'objective'      // Secret objective
  | 'resources'      // Resource counts
  | 'effects';       // Active effects

/**
 * Knowledge that a player has about other players
 */
export interface PlayerKnowledge {
  /** Players whose roles this player knows */
  knownRoles: Record<string, string>;
  /** Players whose positions this player knows */
  knownPositions: Record<string, string>;
  /** Custom revealed information */
  revealed: Record<string, unknown>;
}

/**
 * Result from visibility operation
 */
export interface VisibilityOperationResult {
  success: boolean;
  revealedInfo?: unknown;
  error?: string;
}

/**
 * Get the filtered game state visible to a specific player.
 * Calls getVisibleState hooks from all enabled mechanics to build
 * a composite view of what the player can see.
 */
export function getVisibleStateForPlayer(
  state: GameState,
  viewerPlayerId: string
): GameState {
  const ctx: VisibilityContext = {
    state,
    viewerPlayerId,
    config: state.config
  };

  // Start with full state (default is full visibility)
  const enabledMechanics = mechanicRegistry.getEnabledMechanics(state.config);
  const visibilityResults: VisibleState[] = [];

  // Collect visibility filters from all mechanics
  for (const mechanic of enabledMechanics) {
    if (mechanic.getVisibleState) {
      const result = mechanic.getVisibleState(ctx);
      if (result) {
        visibilityResults.push(result);
      }
    }
  }

  // If no mechanics filtered visibility, return full state
  if (visibilityResults.length === 0) {
    return state;
  }

  // Build filtered state by merging all visibility results
  const filteredState: GameState = {
    ...state,
    players: { ...state.players },
    shared: { ...state.shared }
  };

  // Apply player visibility filters
  for (const result of visibilityResults) {
    if (result.players) {
      for (const [playerId, filteredPlayer] of Object.entries(result.players)) {
        if (filteredState.players[playerId]) {
          // Merge filtered player state (more restrictive wins)
          filteredState.players[playerId] = {
            ...filteredState.players[playerId],
            ...filteredPlayer
          };
        }
      }
    }

    if (result.shared) {
      filteredState.shared = {
        ...filteredState.shared,
        ...result.shared
      };
    }
  }

  return filteredState;
}

/**
 * Check if a player can see specific information about another player.
 * Returns true if any mechanic grants visibility, false if any denies,
 * or undefined if no mechanics have an opinion (defaults to visible).
 */
export function canPlayerSeeInfo(
  state: GameState,
  viewerPlayerId: string,
  infoType: string,
  targetPlayerId?: string
): boolean {
  const ctx: VisibilityContext = {
    state,
    viewerPlayerId,
    config: state.config
  };

  const enabledMechanics = mechanicRegistry.getEnabledMechanics(state.config);
  let hasOpinion = false;
  let anyDenied = false;

  for (const mechanic of enabledMechanics) {
    if (mechanic.canSeeInfo) {
      const result = mechanic.canSeeInfo(ctx, infoType, targetPlayerId);
      if (result !== undefined) {
        hasOpinion = true;
        if (result === false) {
          anyDenied = true;
          // Don't break - continue checking for logging purposes
        }
      }
    }
  }

  // If any mechanic denied, return false
  // If no mechanics had an opinion, default to visible (true)
  return hasOpinion ? !anyDenied : true;
}

/**
 * Reveal information from one player to others.
 * Fires visibility-defined onBeforeReveal and onInfoRevealed hooks.
 */
export function revealInfo(
  state: GameState,
  revealingPlayerId: string,
  targetInfo: string,
  toPlayerIds: string[] | 'all'
): VisibilityOperationResult {
  const targetPlayers = toPlayerIds === 'all'
    ? Object.keys(state.players)
    : toPlayerIds;

  // Fire visibility-defined onBeforeReveal hook (blocking)
  const beforeResult = mechanicRegistry.fire('visibility', 'onBeforeReveal', state, revealingPlayerId, {
    infoType: targetInfo, targetPlayerId: revealingPlayerId, revealTo: targetPlayers
  });
  if (beforeResult && (beforeResult as Record<string, unknown>).blocked) {
    const blockReason = (beforeResult as Record<string, unknown>).blockReason as string | undefined;
    return { success: false, error: blockReason ?? 'Reveal blocked' };
  }

  // Update player knowledge tracking
  for (const receiverId of targetPlayers) {
    if (receiverId === revealingPlayerId) continue;

    const receiver = state.players[receiverId];
    if (!receiver) continue;

    // Initialize knowledge tracking if needed
    if (!receiver.knowledge) {
      receiver.knowledge = {
        knownRoles: {},
        knownPositions: {},
        revealed: {}
      };
    }

    // Record the reveal
    const revealKey = `${revealingPlayerId}:${targetInfo}`;
    receiver.knowledge.revealed[revealKey] = true;
  }

  // Fire visibility-defined onInfoRevealed hook (merge)
  const afterChanges = mechanicRegistry.fire('visibility', 'onInfoRevealed', state, revealingPlayerId, {
    infoType: targetInfo, targetPlayerId: revealingPlayerId, revealedTo: targetPlayers, info: targetInfo
  });
  if (afterChanges) applyStateChanges(state, afterChanges);

  return { success: true };
}

/**
 * Get what a player knows about another player's role.
 * Returns undefined if the role is not known.
 */
export function getKnownRole(
  state: GameState,
  viewerPlayerId: string,
  targetPlayerId: string
): string | undefined {
  const viewer = state.players[viewerPlayerId];
  if (!viewer?.knowledge) return undefined;

  return viewer.knowledge.knownRoles[targetPlayerId];
}

/**
 * Record that a player has learned another player's role.
 */
export function recordKnownRole(
  state: GameState,
  viewerPlayerId: string,
  targetPlayerId: string,
  role: string
): void {
  const viewer = state.players[viewerPlayerId];
  if (!viewer) return;

  if (!viewer.knowledge) {
    viewer.knowledge = {
      knownRoles: {},
      knownPositions: {},
      revealed: {}
    };
  }

  viewer.knowledge.knownRoles[targetPlayerId] = role;
}

/**
 * Check if a player has a specific hidden role.
 */
export function hasHiddenRole(
  state: GameState,
  playerId: string,
  role: string
): boolean {
  const player = state.players[playerId];
  return player?.hiddenRole === role;
}

/**
 * Get a player's hidden role (internal use only - not for player visibility).
 */
export function getHiddenRole(
  state: GameState,
  playerId: string
): string | undefined {
  const player = state.players[playerId];
  return player?.hiddenRole;
}

/**
 * Set a player's hidden role.
 */
export function setHiddenRole(
  state: GameState,
  playerId: string,
  role: string
): void {
  const player = state.players[playerId];
  if (player) {
    player.hiddenRole = role;
  }
}

/**
 * Get players with a specific hidden role.
 */
export function getPlayersWithRole(
  state: GameState,
  role: string
): string[] {
  return Object.entries(state.players)
    .filter(([_, player]) => player.hiddenRole === role)
    .map(([playerId]) => playerId);
}

/**
 * Redact hidden information from a player state for external viewing.
 * Returns a copy with sensitive fields replaced.
 */
export function redactPlayerState(
  player: PlayerState,
  visibleFields: string[] = ['state', 'score', 'effects']
): Partial<PlayerState> {
  const redacted: Partial<PlayerState> = {};

  // Always include non-sensitive fields
  if ('state' in player && visibleFields.includes('state')) {
    redacted.state = player.state;
  }
  if ('score' in player && visibleFields.includes('score')) {
    redacted.score = player.score;
  }
  if ('effects' in player && visibleFields.includes('effects')) {
    redacted.effects = player.effects;
  }

  // Mark hand as hidden (show count only)
  if (player.hand) {
    redacted.hand = Array(player.hand.length).fill({ name: '???', type: 'hidden' });
  }

  // Never expose hidden role
  // redacted.hiddenRole = undefined;

  return redacted;
}

/**
 * Create a "fog of war" view of shared state.
 * Removes information that should be hidden from the viewer.
 */
export function redactSharedState(
  shared: Record<string, unknown>,
  hiddenKeys: string[] = []
): Record<string, unknown> {
  const redacted = { ...shared };

  for (const key of hiddenKeys) {
    if (key in redacted) {
      redacted[key] = '[HIDDEN]';
    }
  }

  return redacted;
}

/**
 * Check if the viewer is on the same team as the target.
 * Used for team-based visibility rules.
 */
export function isSameTeam(
  state: GameState,
  viewerPlayerId: string,
  targetPlayerId: string
): boolean {
  const viewer = state.players[viewerPlayerId];
  const target = state.players[targetPlayerId];

  if (!viewer || !target) return false;

  // Check explicit team assignment
  if (viewer.team && target.team) {
    return viewer.team === target.team;
  }

  // Check role-based team membership
  const viewerRole = viewer.hiddenRole;
  const targetRole = target.hiddenRole;

  if (!viewerRole || !targetRole) return false;

  // Common team groupings
  const traitorRoles = ['traitor', 'spy', 'enemy', 'werewolf', 'impostor'];
  const townRoles = ['town', 'villager', 'innocent', 'crew', 'citizen'];

  const viewerIsTraitor = traitorRoles.includes(viewerRole);
  const targetIsTraitor = traitorRoles.includes(targetRole);

  if (viewerIsTraitor && targetIsTraitor) return true;

  const viewerIsTown = townRoles.includes(viewerRole);
  const targetIsTown = townRoles.includes(targetRole);

  if (viewerIsTown && targetIsTown) return true;

  return false;
}
