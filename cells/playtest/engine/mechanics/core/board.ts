/**
 * Board Core Service
 *
 * Manages board state operations for games with board/state-based movement.
 * This is a "trunk" mechanic that board-related mechanics depend on.
 *
 * Fires board-defined hooks:
 * - onBeforePlayerMove: Can modify target or block move (blocking)
 * - onPlayerMoved: Notified after player moved (merge)
 */

import { GameState, GameConfig, BoardConfig, EdgeConfig } from '../../types/game';
import { mechanicRegistry, applyStateChanges } from '../registry';

/**
 * Get board config from either unified format (engine_mechanics.board) or legacy (config.board).
 */
export function getBoardConfigFromConfig(config: GameConfig): BoardConfig | null {
  // Unified format: engine_mechanics.board
  if (config.engine_mechanics?.board) {
    return config.engine_mechanics.board;
  }
  // Legacy format: top-level config.board
  if (config.board) {
    return config.board;
  }
  return null;
}

/**
 * Result from move operation
 */
export interface MoveResult {
  /** True if the move was successful */
  success: boolean;
  /** Previous state before move */
  previousState?: string;
  /** New state after move */
  newState?: string;
  /** True if move was blocked by a hook */
  blocked?: boolean;
  /** Reason for blocking or error */
  reason?: string;
}

/**
 * Get a player's current board state.
 */
export function getBoardState(state: GameState, playerId: string): string {
  const player = state.players[playerId];
  if (!player) {
    throw new Error(`Player ${playerId} not found`);
  }

  return player.state;
}

/**
 * Set a player's board state directly.
 * Fires board-defined onBeforePlayerMove and onPlayerMoved hooks.
 *
 * @returns Result indicating success
 */
export function setBoardState(
  state: GameState,
  playerId: string,
  newState: string
): MoveResult {
  const player = state.players[playerId];
  if (!player) {
    throw new Error(`Player ${playerId} not found`);
  }

  const previousState = player.state;

  // Fire board-defined onBeforePlayerMove hook (blocking)
  let targetState = newState;
  const beforeResult = mechanicRegistry.fire('board', 'onBeforePlayerMove', state, playerId, {
    fromState: previousState, toState: targetState
  });
  if (beforeResult && (beforeResult as Record<string, unknown>).blocked) {
    const blockReason = (beforeResult as Record<string, unknown>).blockReason as string | undefined;
    return { success: false, blocked: true, reason: blockReason };
  }
  if (beforeResult && typeof (beforeResult as Record<string, unknown>).target === 'string') {
    targetState = (beforeResult as Record<string, unknown>).target as string;
  }

  // Apply the state change
  player.state = targetState;

  // Fire board-defined onPlayerMoved hook (merge)
  const afterChanges = mechanicRegistry.fire('board', 'onPlayerMoved', state, playerId, {
    fromState: previousState, toState: targetState
  });
  if (afterChanges) applyStateChanges(state, afterChanges);

  return {
    success: true,
    previousState,
    newState: targetState
  };
}

/**
 * Get all valid board states from the config.
 */
export function getBoardStates(state: GameState): string[] {
  const boardConfig = getBoardConfigFromConfig(state.config);
  if (!boardConfig) {
    return [];
  }

  return [...boardConfig.states];
}

/**
 * Get the starting state for the board.
 */
export function getStartingState(state: GameState): string | null {
  const boardConfig = getBoardConfigFromConfig(state.config);
  if (!boardConfig) {
    return null;
  }

  return boardConfig.start ?? boardConfig.states[0] ?? null;
}

/**
 * Check if a state is a valid board state.
 */
export function isValidState(state: GameState, targetState: string): boolean {
  const boardConfig = getBoardConfigFromConfig(state.config);
  if (!boardConfig) {
    return false;
  }

  return boardConfig.states.includes(targetState);
}

/**
 * Get valid move targets from a specific state based on edges.
 * If no edges are defined from the state, returns all states except current.
 */
export function getValidMoveTargets(state: GameState, fromState: string): string[] {
  const boardConfig = getBoardConfigFromConfig(state.config);
  if (!boardConfig) {
    return [];
  }

  const targets: string[] = [];

  for (const edge of boardConfig.edges || []) {
    const fromStates = Array.isArray(edge.from) ? edge.from : [edge.from];
    const toStates = Array.isArray(edge.to) ? edge.to : [edge.to];

    if (fromStates.includes(fromState)) {
      targets.push(...toStates);
    }
  }

  // Remove duplicates
  const uniqueTargets = [...new Set(targets)];

  // If no edges defined from this state, allow move to any state
  if (uniqueTargets.length === 0) {
    return boardConfig.states.filter(s => s !== fromState);
  }

  return uniqueTargets;
}

/**
 * Get valid move targets for a player from their current state.
 */
export function getValidMoveTargetsForPlayer(state: GameState, playerId: string): string[] {
  const player = state.players[playerId];
  if (!player) {
    throw new Error(`Player ${playerId} not found`);
  }

  return getValidMoveTargets(state, player.state);
}

/**
 * Check if a move from one state to another is valid based on edges.
 */
export function isValidMove(state: GameState, fromState: string, toState: string): boolean {
  const validTargets = getValidMoveTargets(state, fromState);
  return validTargets.includes(toState);
}

/**
 * Get the edge config between two states (if exists).
 */
export function getEdge(state: GameState, fromState: string, toState: string): EdgeConfig | null {
  const boardConfig = getBoardConfigFromConfig(state.config);
  if (!boardConfig) {
    return null;
  }

  for (const edge of boardConfig.edges || []) {
    const fromStates = Array.isArray(edge.from) ? edge.from : [edge.from];
    const toStates = Array.isArray(edge.to) ? edge.to : [edge.to];

    if (fromStates.includes(fromState) && toStates.includes(toState)) {
      return edge;
    }
  }

  return null;
}

/**
 * Get the probability for a move (from edge config).
 * Returns 1.0 (100%) if no probability is defined.
 */
export function getMoveProbability(state: GameState, fromState: string, toState: string): number {
  const edge = getEdge(state, fromState, toState);
  return edge?.probability ?? 1.0;
}

/**
 * Get all players at a specific board state.
 */
export function getPlayersAtState(state: GameState, boardState: string): string[] {
  return Object.entries(state.players)
    .filter(([_, player]) => player.state === boardState)
    .map(([playerId]) => playerId);
}

/**
 * Check if a board is configured for this game.
 */
export function hasBoard(state: GameState): boolean {
  return !!getBoardConfigFromConfig(state.config);
}

/**
 * Get all edges from the board config.
 */
export function getEdges(state: GameState): EdgeConfig[] {
  const boardConfig = getBoardConfigFromConfig(state.config);
  if (!boardConfig) {
    return [];
  }

  return [...(boardConfig.edges || [])];
}
