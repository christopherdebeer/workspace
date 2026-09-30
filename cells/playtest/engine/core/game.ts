// Game state management

import { readFileSync, writeFileSync, existsSync, mkdirSync, appendFileSync, unlinkSync, readdirSync, statSync } from '../shims/fs';
import { join, dirname } from '../shims/path';
import { fileURLToPath } from '../shims/url';

// Debug logging flag (can be set from CLI)
let DEBUG_MODE = false;

export function setDebugMode(enabled: boolean): void {
  DEBUG_MODE = enabled;
}

function debug(...args: any[]): void {
  if (DEBUG_MODE) {
    console.error(...args);
  }
}
import type {
  GameState,
  GameStatus,
  PlayerState,
  PlayerView,
  OpponentView,
  Card,
  LogEvent,
  GameAction,
  ResignAction,
  PlacedCard,
  ActionValidationResult,
  LastAction,
  PendingContest,
  PendingResignation,
  PendingVictoryClaim,
  ContestHistoryEntry,
  ResignationEntry,
  ContestState,
  AvailableAction,
  AvailableActionsResult,
  GameAnalysis,
  KeyMoment
} from '../types/game';
import { parseRules, getPlayerCount } from './rules';

// Mechanics hook system (incremental extraction)
import { mechanicRegistry, applyStateChanges } from '../mechanics/index';
import type { ActionSchema } from '../mechanics/types';

// Core services (trunk mechanics)
import {
  addToDiscard,
  playCard,
  removeFromHandByIndex,
  applyDynamicTurnOrder,
  setBoardState
} from '../mechanics/core/index';

// Find project root (parent of src directory)
const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = join(__dirname, '..', '..');
const GAMES_DIR = join(PROJECT_ROOT, 'games');
const PERSONAS_DIR = join(PROJECT_ROOT, '.claude', 'agents', 'personas');

// ============ Auto-Adjudication Configuration ============
// If a contest/resignation is pending for longer than this, auto-adjudicate (allow)
// This prevents games from deadlocking when the gamemaster agent times out
const AUTO_ADJUDICATION_TIMEOUT_MS = 60000; // 60 seconds

/**
 * Check if a pending contest has timed out and should be auto-adjudicated.
 * Returns true if auto-adjudication was performed, false otherwise.
 */
export function checkAndAutoAdjudicateContest(state: GameState): boolean {
  const contestState = ensureContestState(state);

  if (!contestState.pendingContest) {
    return false;
  }

  const contestTimestamp = new Date(contestState.pendingContest.timestamp).getTime();
  const elapsed = Date.now() - contestTimestamp;

  if (elapsed >= AUTO_ADJUDICATION_TIMEOUT_MS) {
    // Auto-adjudicate: allow the contested action (reject the contest)
    const contest = contestState.pendingContest;
    const originalAction = contest.originalAction;

    // Record in history with auto-adjudication note
    contestState.contestHistory.push({
      round: originalAction.round,
      turnNumber: originalAction.turnNumber,
      action: originalAction.action,
      player: originalAction.player,
      contestedBy: contest.contestedBy,
      contestReason: contest.reason,
      ruling: 'allowed',
      rulingReason: `[AUTO-ADJUDICATED] Gamemaster did not respond within ${AUTO_ADJUDICATION_TIMEOUT_MS / 1000}s. Action allowed by default.`,
      timestamp: new Date().toISOString()
    });

    // Clear pending contest
    delete contestState.pendingContest;
    saveState(state);

    // Log the auto-adjudication
    logEvent(state, {
      event: 'contest_auto_adjudicated',
      round: state.round,
      turnNumber: state.turnNumber,
      player: originalAction.player,
      data: {
        contestedBy: contest.contestedBy,
        reason: contest.reason,
        ruling: 'allowed',
        autoReason: 'Gamemaster timeout - action allowed by default',
        elapsedMs: elapsed
      }
    });

    debug(`[AUTO-ADJUDICATION] Contest timed out after ${elapsed}ms. Action allowed.`);

    // Check if the allowed action includes a victory declaration
    processVictoryDeclarationIfPresent(state, originalAction);

    return true;
  }

  return false;
}

/**
 * Check if an allowed action includes a victory declaration and create pending claim.
 * Called after a contest is resolved as 'allowed' to ensure victory claims are verified.
 */
function processVictoryDeclarationIfPresent(state: GameState, originalAction: LastAction): void {
  const action = originalAction.action as GameAction & { declareVictory?: boolean; victoryReason?: string };

  if (!action.declareVictory) {
    return;
  }

  const contestState = ensureContestState(state);
  const playerBoardState = state.players[originalAction.player]?.state ?? 'unknown';

  // Create pending victory claim for GM verification
  contestState.pendingVictoryClaim = {
    player: originalAction.player,
    reason: action.victoryReason || 'Victory declared with action',
    fromState: playerBoardState,
    toState: playerBoardState,
    action: action,
    timestamp: new Date().toISOString()
  };

  saveState(state);

  logEvent(state, {
    event: 'victory_claim_pending',
    round: state.round,
    turnNumber: state.turnNumber,
    player: originalAction.player,
    data: {
      reason: action.victoryReason || 'Victory declared with action',
      note: 'Contest allowed - victory claim requires GM verification'
    }
  });

  debug(`[VICTORY CLAIM] Created pending victory claim for ${originalAction.player} after contest allowed`);
}

/**
 * Check if a pending resignation has timed out and should be auto-adjudicated.
 * Returns true if auto-adjudication was performed, false otherwise.
 */
export function checkAndAutoAdjudicateResignation(state: GameState): boolean {
  const contestState = ensureContestState(state);

  if (!contestState.pendingResignation) {
    return false;
  }

  const resignTimestamp = new Date(contestState.pendingResignation.timestamp).getTime();
  const elapsed = Date.now() - resignTimestamp;

  if (elapsed >= AUTO_ADJUDICATION_TIMEOUT_MS) {
    // Auto-adjudicate: accept the resignation
    const resignation = contestState.pendingResignation;
    const rulingReason = `[AUTO-ADJUDICATED] Gamemaster did not respond within ${AUTO_ADJUDICATION_TIMEOUT_MS / 1000}s. Resignation accepted by default.`;

    // Record in history
    contestState.resignations.push({
      player: resignation.player,
      reason: resignation.reason,
      accepted: true,
      rulingReason,
      timestamp: new Date().toISOString()
    });

    // End game - the resigning player loses (same as manual adjudication)
    const otherPlayers = state.turnOrder.filter(p => p !== resignation.player);
    const winner = otherPlayers.length === 1 ? otherPlayers[0] : 'none';

    state.status = 'pending_analysis';
    state.shared.winner = winner;
    state.shared.endReason = `${resignation.player} resigned: ${resignation.reason}`;

    logEvent(state, {
      event: 'game_end',
      round: state.round,
      turnNumber: state.turnNumber,
      data: {
        winner,
        reason: `Resignation auto-accepted: ${resignation.reason}`,
        resignedPlayer: resignation.player
      }
    });

    // Clear pending resignation
    delete contestState.pendingResignation;
    saveState(state);

    logEvent(state, {
      event: 'resignation_adjudicated',
      round: state.round,
      turnNumber: state.turnNumber,
      data: {
        player: resignation.player,
        accepted: true,
        rulingReason,
        autoAdjudicated: true
      }
    });

    debug(`[AUTO-ADJUDICATION] Resignation timed out after ${elapsed}ms. Resignation accepted.`);
    return true;
  }

  return false;
}

// ============ Persona Management ============

/**
 * Get list of available persona slugs (filenames without .md extension)
 * Excludes README.md
 */
export function getAvailablePersonas(): string[] {
  if (!existsSync(PERSONAS_DIR)) {
    return [];
  }
  return readdirSync(PERSONAS_DIR)
    .filter(f => f.endsWith('.md') && f !== 'README.md')
    .map(f => f.replace('.md', ''));
}

/**
 * Load persona content by slug
 * Returns the full markdown content of the persona file
 */
export function loadPersonaContent(slug: string): string | null {
  const personaPath = join(PERSONAS_DIR, `${slug}.md`);
  if (!existsSync(personaPath)) {
    return null;
  }
  return readFileSync(personaPath, 'utf-8');
}

/**
 * Select a random persona from available personas
 * Returns the slug, or null if no personas available
 */
export function selectRandomPersona(): string | null {
  const personas = getAvailablePersonas();
  if (personas.length === 0) {
    return null;
  }
  return personas[Math.floor(Math.random() * personas.length)];
}

export function getGamePath(gameName: string): string {
  return join(GAMES_DIR, gameName);
}

// Instance-based state path (supports concurrent instances)
export function getStatePath(gameName: string, instanceId?: string): string {
  const basePath = join(getGamePath(gameName), 'state');
  return instanceId ? join(basePath, instanceId) : basePath;
}

export function getStateFile(gameName: string, instanceId?: string): string {
  return join(getStatePath(gameName, instanceId), 'game.json');
}

export function getLogPath(gameName: string, gameId: string): string {
  return join(getGamePath(gameName), 'logs', `${gameId}.jsonl`);
}

export function getRulesPath(gameName: string): string {
  return join(getGamePath(gameName), 'RULES.md');
}

export function gameExists(gameName: string): boolean {
  return existsSync(getRulesPath(gameName));
}

// Check if state exists - supports both game name and instance ID
export function stateExists(gameNameOrInstanceId: string): boolean {
  // Try as instance ID first (format: gameName-timestamp)
  const resolved = resolveGameInstance(gameNameOrInstanceId);
  if (resolved) {
    return existsSync(getStateFile(resolved.gameName, resolved.instanceId));
  }
  // Fall back to legacy single-instance path
  return existsSync(getStateFile(gameNameOrInstanceId));
}

// Cache for resolveGameInstance to avoid repeated statSync calls during polling.
// Keyed by game name/instance ID, cached for 2 seconds (long enough to help
// with 100ms polling, short enough to pick up new instances promptly).
const instanceCache = new Map<string, { result: { gameName: string; instanceId: string } | null; expiry: number }>();
const INSTANCE_CACHE_TTL_MS = 2000;

// Resolve a game name or instance ID to {gameName, instanceId}
// Returns null if cannot be resolved
export function resolveGameInstance(gameNameOrInstanceId: string): { gameName: string; instanceId: string } | null {
  // Check cache first
  const cached = instanceCache.get(gameNameOrInstanceId);
  if (cached && Date.now() < cached.expiry) {
    return cached.result;
  }

  const result = resolveGameInstanceUncached(gameNameOrInstanceId);
  instanceCache.set(gameNameOrInstanceId, { result, expiry: Date.now() + INSTANCE_CACHE_TTL_MS });
  return result;
}

function resolveGameInstanceUncached(gameNameOrInstanceId: string): { gameName: string; instanceId: string } | null {
  // Check if it's an instance ID (format: gameName-timestamp)
  const match = gameNameOrInstanceId.match(/^(.+)-(\d{13,})$/);
  if (match) {
    const [, gameName, timestamp] = match;
    const instanceId = `${gameName}-${timestamp}`;
    if (existsSync(getStateFile(gameName, instanceId))) {
      return { gameName, instanceId };
    }
  }

  // Try as game name - find most recent instance
  const statePath = getStatePath(gameNameOrInstanceId);
  if (existsSync(statePath)) {
    try {
      const entries = readdirSync(statePath);
      // Filter to instance directories (format: gameName-timestamp)
      const instances = entries
        .filter((e: string) => e.match(/^.+-\d{13,}$/))
        .filter((e: string) => existsSync(join(statePath, e, 'game.json')))
        .sort((a: string, b: string) => {
          // Sort by timestamp in the directory name (avoids statSync calls)
          const aTs = a.match(/-(\d{13,})$/)?.[1] || '0';
          const bTs = b.match(/-(\d{13,})$/)?.[1] || '0';
          return bTs.localeCompare(aTs);
        });

      if (instances.length > 0) {
        return { gameName: gameNameOrInstanceId, instanceId: instances[0] };
      }
    } catch {
      // Directory doesn't exist or can't be read
    }

    // Fall back to legacy single-instance path (game.json directly in state/)
    if (existsSync(getStateFile(gameNameOrInstanceId))) {
      // Legacy: no instance ID, gameName only
      return { gameName: gameNameOrInstanceId, instanceId: '' };
    }
  }

  return null;
}

// List all active game instances for a game name
export function listGameInstances(gameName: string): string[] {
  const statePath = getStatePath(gameName);
  if (!existsSync(statePath)) return [];

  try {
    return readdirSync(statePath)
      .filter((e: string) => e.match(/^.+-\d{13,}$/))
      .filter((e: string) => existsSync(join(statePath, e, 'game.json')));
  } catch {
    return [];
  }
}

// ============ File Locking ============

function getLockFile(gameName: string, instanceId?: string): string {
  return `${getStateFile(gameName, instanceId)}.lock`;
}

function acquireLock(gameName: string, instanceId?: string, timeoutMs: number = 5000): boolean {
  const lockFile = getLockFile(gameName, instanceId);
  const startTime = Date.now();
  const retryInterval = 10; // Check every 10ms

  debug(`[LOCK DEBUG] Attempting to acquire lock: ${lockFile}`);

  // Ensure the directory exists for the lock file
  const lockDir = dirname(lockFile);
  if (!existsSync(lockDir)) {
    debug(`[LOCK DEBUG] Creating lock directory: ${lockDir}`);
    mkdirSync(lockDir, { recursive: true });
  }

  while (Date.now() - startTime < timeoutMs) {
    try {
      // Try to create lock file exclusively (fails if exists)
      writeFileSync(lockFile, `${1}\n${new Date().toISOString()}`, { flag: 'wx' });
      debug(`[LOCK DEBUG] Lock acquired by PID ${1}`);
      return true;
    } catch (e: any) {
      if (e.code === 'EEXIST') {
        // Lock file exists, check if stale
        try {
          const lockContent = readFileSync(lockFile, 'utf-8');
          const lockAge = Date.now() - new Date(lockContent.split('\n')[1]).getTime();

          // If lock is older than 2 seconds, consider it stale and remove
          if (lockAge > 2000) {
            debug(`[LOCK DEBUG] Stale lock detected (${lockAge}ms old), removing...`);
            unlinkSync(lockFile);
            continue;
          }
        } catch {
          // Lock file might have been removed, try again
        }

        // Wait before retrying
        const elapsed = Date.now() - startTime;
        if (elapsed < timeoutMs) {
          // Busy wait (not ideal but simple for now)
          const waitUntil = Date.now() + retryInterval;
          while (Date.now() < waitUntil) { /* busy wait */ }
        }
      } else {
        // Other error, fail
        debug(`[LOCK DEBUG] Lock acquisition failed:`, e);
        return false;
      }
    }
  }

  debug(`[LOCK DEBUG] Lock acquisition timeout after ${timeoutMs}ms`);
  return false;
}

function releaseLock(gameName: string, instanceId?: string): void {
  const lockFile = getLockFile(gameName, instanceId);

  try {
    if (existsSync(lockFile)) {
      unlinkSync(lockFile);
      debug(`[LOCK DEBUG] Lock released by PID ${1}`);
    }
  } catch (e) {
    debug(`[LOCK DEBUG] Error releasing lock:`, e);
  }
}

// ============ State Management with Locking ============

// Internal functions without locking (for use within locked operations)
function loadStateUnsafe(gameName: string, instanceId?: string): GameState {
  const stateFile = getStateFile(gameName, instanceId);
  debug(`[LOADSTATE DEBUG] Loading state for ${gameName}/${instanceId || 'default'} from ${stateFile}`);

  if (!existsSync(stateFile)) {
    debug(`[LOADSTATE DEBUG] ERROR: State file not found`);
    throw new Error(`No active game found for ${instanceId || gameName}`);
  }

  const state = JSON.parse(readFileSync(stateFile, 'utf-8'));
  debug(`[LOADSTATE DEBUG] Loaded successfully, status: ${state.status}`);
  return state;
}

function saveStateUnsafe(state: GameState, instanceId?: string): void {
  // Use gameId as instanceId if not provided
  const effectiveInstanceId = instanceId || state.gameId;
  const stateDir = getStatePath(state.gameName, effectiveInstanceId);
  const stateFile = getStateFile(state.gameName, effectiveInstanceId);

  debug(`[SAVESTATE DEBUG] Saving state for ${state.gameName}/${effectiveInstanceId} to ${stateFile}`);
  debug(`[SAVESTATE DEBUG] Status: ${state.status}, Round: ${state.round}, TurnNumber: ${state.turnNumber}`);

  if (!existsSync(stateDir)) {
    debug(`[SAVESTATE DEBUG] Creating state directory: ${stateDir}`);
    mkdirSync(stateDir, { recursive: true });
  }

  writeFileSync(stateFile, JSON.stringify(state, null, 2));
  debug(`[SAVESTATE DEBUG] State saved successfully`);
}

// Public functions with locking
// Accepts game name OR instance ID (format: gameName-timestamp)
export function loadState(gameNameOrInstanceId: string): GameState {
  // Resolve to gameName + instanceId
  const resolved = resolveGameInstance(gameNameOrInstanceId);
  if (!resolved) {
    throw new Error(`No active game found for ${gameNameOrInstanceId}`);
  }
  const { gameName, instanceId } = resolved;

  // Acquire lock before reading
  if (!acquireLock(gameName, instanceId)) {
    throw new Error(`Failed to acquire lock for ${instanceId || gameName}`);
  }

  try {
    return loadStateUnsafe(gameName, instanceId);
  } finally {
    // Always release lock
    releaseLock(gameName, instanceId);
  }
}

// Lock-free read for status checks and polling operations.
// Skips lock acquisition since read-only JSON parsing is safe against
// concurrent writes (writeFileSync is atomic enough on Linux for small files;
// worst case JSON.parse fails and we retry on next poll cycle).
export function loadStateReadOnly(gameNameOrInstanceId: string): GameState {
  const resolved = resolveGameInstance(gameNameOrInstanceId);
  if (!resolved) {
    throw new Error(`No active game found for ${gameNameOrInstanceId}`);
  }
  const { gameName, instanceId } = resolved;
  return loadStateUnsafe(gameName, instanceId);
}

export function saveState(state: GameState): void {
  // Use gameId as instanceId for instance-specific storage
  const instanceId = state.gameId;

  // Acquire lock before writing
  if (!acquireLock(state.gameName, instanceId)) {
    throw new Error(`Failed to acquire lock for ${instanceId}`);
  }

  try {
    saveStateUnsafe(state, instanceId);
  } finally {
    // Always release lock
    releaseLock(state.gameName, instanceId);
  }
}

export function logEvent(state: GameState, event: Omit<LogEvent, 'timestamp'>): void {
  const logDir = dirname(state.log);
  if (!existsSync(logDir)) {
    mkdirSync(logDir, { recursive: true });
  }

  const fullEvent: LogEvent = {
    timestamp: new Date().toISOString(),
    ...event
  };

  appendFileSync(state.log, JSON.stringify(fullEvent) + '\n');
}

export interface InitGameOptions {
  personas?: Record<string, string>;  // Map of playerId -> persona slug (or "random")
}

export function initGame(gameName: string, playerCount: number, options?: InitGameOptions): GameState {
  if (!gameExists(gameName)) {
    throw new Error(`Game '${gameName}' not found. Create games/${gameName}/RULES.md first.`);
  }

  const rulesPath = getRulesPath(gameName);
  const { config, markdown } = parseRules(rulesPath);

  // Validate player count
  const { min, max } = getPlayerCount(config);
  if (playerCount < min || playerCount > max) {
    throw new Error(`Player count ${playerCount} out of range [${min}, ${max}] for ${gameName}`);
  }

  // Validate mechanic dependencies and conflicts
  const mechanicErrors = mechanicRegistry.validateDependencies(config);
  if (mechanicErrors.length > 0) {
    const errorMessages = mechanicErrors.map(e => `  - ${e.message}`).join('\n');
    throw new Error(`Mechanic configuration errors for ${gameName}:\n${errorMessages}`);
  }

  const gameId = `${gameName}-${Date.now()}`;

  // Build turn order first (needed for initSharedState)
  const turnOrder: string[] = [];
  for (let i = 1; i <= playerCount; i++) {
    turnOrder.push(`player-${i}`);
  }

  // ============ Mechanic Hooks: Shared state initialization (FIRST) ============
  // Cards mechanic builds deck, shuffles, deals starting hands, creates discard pile
  // All card setup moved from game.ts to cards mechanic's initSharedState
  const shared: Record<string, unknown> = {};
  const mechanicSharedState = mechanicRegistry.initSharedState(config, [], turnOrder, shared);
  Object.assign(shared, mechanicSharedState);

  // Create player slots
  const players: Record<string, PlayerState> = {};
  for (let i = 1; i <= playerCount; i++) {
    const playerId = `player-${i}`;

    // Assign persona if specified
    // - undefined or "random" = assign random at registration
    // - empty string "" = no persona (explicit opt-out)
    // - any other string = specific persona slug
    const assignedPersona = options?.personas?.[playerId];
    let persona: string | undefined;
    if (assignedPersona === '') {
      persona = '_none_';  // Marker for explicit no-persona
    } else if (assignedPersona && assignedPersona !== 'random') {
      persona = assignedPersona;
    }
    // else undefined = random assignment at registration

    // ============ Mechanic Hooks: Player initialization ============
    // Get initial player state from all enabled mechanics
    // Pass existing players for cross-player coordination (e.g., unique power assignment)
    // Pass shared state for cross-mechanic coordination (e.g., cards mechanic pre-dealt hands)
    const playerIndex = i - 1;
    const mechanicState = mechanicRegistry.initPlayerState(config, playerId, playerIndex, players, shared);

    // Initialize score from starting_state if configured
    const startingState = (config as { starting_state?: { score?: number } }).starting_state;
    const startingScore = startingState?.score ?? 0;

    players[playerId] = {
      state: 'start',
      effects: [],
      persona,
      score: startingScore
    };

    // Apply all mechanic-provided state (hand, resources, actionPoints, powerId, etc.)
    // Mechanics can override defaults like 'state' (board-state sets starting position)
    // 'resources' now set by resources mechanic via initPlayerState
    const protectedKeys = new Set(['effects', 'persona', 'score']);
    for (const [key, value] of Object.entries(mechanicState)) {
      if (value !== undefined && !protectedKeys.has(key)) {
        (players[playerId] as unknown as Record<string, unknown>)[key] = value;
      }
    }
  }

  // Clean up temporary state from cards mechanic
  delete shared._startingHands;

  const logPath = getLogPath(gameName, gameId);

  const state: GameState = {
    gameId,
    gameName,
    status: 'waiting_for_players',
    round: 0,
    turnNumber: 0,
    currentPlayer: null,
    turnOrder,
    players,
    shared,
    config,
    rulesMarkdown: markdown,
    log: logPath,
    created: Date.now()
  };

  saveState(state);

  logEvent(state, {
    event: 'game_init',
    data: { gameId, playerCount, config: config.name }
  });

  return state;
}

// Accepts game name OR instance ID
export function registerAgent(
  gameNameOrInstanceId: string,
  role: 'gamemaster' | 'player',
  agentId: string,
  playerId?: string
): { registered: boolean; role: string; playerId?: string; persona?: string; rules: string; instanceId: string; config: object } {
  debug(`[REGISTER DEBUG] === Starting registration ===`);
  debug(`[REGISTER DEBUG] Game: ${gameNameOrInstanceId}, Role: ${role}, AgentId: ${agentId}, PlayerId: ${playerId || 'auto'}`);

  // Resolve to gameName + instanceId
  const resolved = resolveGameInstance(gameNameOrInstanceId);
  if (!resolved) {
    throw new Error(`No active game found for ${gameNameOrInstanceId}`);
  }
  const { gameName, instanceId } = resolved;
  debug(`[REGISTER DEBUG] Resolved: gameName=${gameName}, instanceId=${instanceId}`);

  // Acquire lock for the entire registration operation
  if (!acquireLock(gameName, instanceId)) {
    throw new Error(`Failed to acquire lock for ${instanceId || gameName}`);
  }

  try {
    const state = loadStateUnsafe(gameName, instanceId);

    if (role === 'gamemaster') {
      debug(`[REGISTER DEBUG] Gamemaster registration path`);
      debug(`[REGISTER DEBUG] Before: gamemasterAgentId = ${state.shared.gamemasterAgentId || 'null'}`);

      // Gamemaster registration - store in shared state
      state.shared.gamemasterAgentId = agentId;
      debug(`[REGISTER DEBUG] After assignment: gamemasterAgentId = ${state.shared.gamemasterAgentId}`);

      saveStateUnsafe(state, instanceId);
      debug(`[REGISTER DEBUG] State saved for gamemaster`);

      // Check if all players also registered - if so, auto-start
      const allPlayersRegistered = state.turnOrder.every(pid => state.players[pid].agentId);
      debug(`[REGISTER DEBUG] All players registered? ${allPlayersRegistered}`);
      if (allPlayersRegistered) {
        debug(`[REGISTER DEBUG] Starting game automatically...`);
        startGameUnsafe(gameName, instanceId);
      }

      return {
        registered: true,
        role: 'gamemaster',
        rules: state.rulesMarkdown,
        instanceId: state.gameId,
        config: state.config
      };
    }

    // Player registration
    debug(`[REGISTER DEBUG] Player registration path`);

    if (!playerId) {
      debug(`[REGISTER DEBUG] Auto-assigning player slot...`);
      // Auto-assign to first unregistered player
      for (const pid of state.turnOrder) {
        if (!state.players[pid].agentId) {
          playerId = pid;
          debug(`[REGISTER DEBUG] Assigned to ${playerId}`);
          break;
        }
      }
    }

    if (!playerId || !state.players[playerId]) {
      debug(`[REGISTER DEBUG] ERROR: No available player slot`);
      throw new Error(`No available player slot for registration`);
    }

    debug(`[REGISTER DEBUG] Before: ${playerId}.agentId = ${state.players[playerId].agentId || 'null'}`);

    if (state.players[playerId].agentId) {
      debug(`[REGISTER DEBUG] ERROR: Player already registered`);
      throw new Error(`Player ${playerId} already registered`);
    }

    state.players[playerId].agentId = agentId;
    debug(`[REGISTER DEBUG] After assignment: ${playerId}.agentId = ${state.players[playerId].agentId}`);

    // Assign persona if not pre-assigned
    // - undefined = random assignment
    // - '_none_' = explicit no persona
    // - any other string = specific persona
    let persona = state.players[playerId].persona;
    if (persona === '_none_') {
      // Explicit opt-out - no persona
      persona = undefined;
      state.players[playerId].persona = undefined;
      debug(`[REGISTER DEBUG] Persona explicitly disabled`);
    } else if (!persona) {
      // Random assignment
      const randomPersona = selectRandomPersona();
      if (randomPersona) {
        persona = randomPersona;
        state.players[playerId].persona = persona;
        debug(`[REGISTER DEBUG] Randomly assigned persona: ${persona}`);
      }
    } else {
      debug(`[REGISTER DEBUG] Using pre-assigned persona: ${persona}`);
    }

    saveStateUnsafe(state, instanceId);
    debug(`[REGISTER DEBUG] State saved for ${playerId}`);

    // Build rules with persona injection
    let rulesWithPersona = state.rulesMarkdown;
    if (persona) {
      const personaContent = loadPersonaContent(persona);
      if (personaContent) {
        rulesWithPersona = `${state.rulesMarkdown}\n\n---\n\n# Your Persona\n\n${personaContent}`;
        debug(`[REGISTER DEBUG] Injected persona content for ${persona}`);
      }
    }

    // Check if all players registered
    const allRegistered = state.turnOrder.every(pid => state.players[pid].agentId);
    debug(`[REGISTER DEBUG] All players registered? ${allRegistered}`);
    debug(`[REGISTER DEBUG] Gamemaster registered? ${!!state.shared.gamemasterAgentId}`);

    if (allRegistered && state.shared.gamemasterAgentId) {
      debug(`[REGISTER DEBUG] Starting game automatically...`);
      startGameUnsafe(gameName, instanceId);
    }

    return {
      registered: true,
      role: 'player',
      playerId,
      persona,
      rules: rulesWithPersona,
      instanceId: state.gameId,
      config: state.config
    };
  } finally {
    // Always release lock
    releaseLock(gameName, instanceId);
  }
}

// Internal unsafe version (called within locked operations)
function startGameUnsafe(gameName: string, instanceId?: string): void {
  debug(`[STARTGAME DEBUG] === Starting game ${gameName}/${instanceId || 'default'} ===`);

  const state = loadStateUnsafe(gameName, instanceId);
  debug(`[STARTGAME DEBUG] Current status: ${state.status}`);

  if (state.status !== 'waiting_for_players') {
    debug(`[STARTGAME DEBUG] Game already started, skipping`);
    return; // Already started
  }

  debug(`[STARTGAME DEBUG] Changing status to in_progress`);
  state.status = 'in_progress';
  state.round = 1;
  state.turnNumber = 1;
  state.currentPlayer = state.turnOrder[0];
  debug(`[STARTGAME DEBUG] First player: ${state.currentPlayer}`);

  saveStateUnsafe(state, instanceId);
  debug(`[STARTGAME DEBUG] State saved, game started`);

  logEvent(state, {
    event: 'game_start',
    round: 1,
    turnNumber: 1,
    data: {
      players: state.turnOrder,
      firstPlayer: state.currentPlayer
    }
  });
}

// Public version with locking
export function startGame(gameNameOrInstanceId: string): void {
  const resolved = resolveGameInstance(gameNameOrInstanceId);
  if (!resolved) {
    throw new Error(`No active game found for ${gameNameOrInstanceId}`);
  }
  const { gameName, instanceId } = resolved;

  if (!acquireLock(gameName, instanceId)) {
    throw new Error(`Failed to acquire lock for ${instanceId || gameName}`);
  }

  try {
    startGameUnsafe(gameName, instanceId);
  } finally {
    releaseLock(gameName, instanceId);
  }
}

export function getPlayerView(state: GameState, playerId: string): PlayerView {
  const player = state.players[playerId];
  if (!player) {
    throw new Error(`Player ${playerId} not found`);
  }

  const opponents: OpponentView[] = state.turnOrder
    .filter(pid => pid !== playerId)
    .map(pid => ({
      playerId: pid,
      state: state.players[pid].state,
      handSize: (state.players[pid].hand || []).length,
      effects: state.players[pid].effects
    }));

  return {
    gameId: state.gameId,
    round: state.round,
    turnNumber: state.turnNumber,
    currentPlayer: state.currentPlayer!,
    myState: {
      state: player.state,
      hand: player.hand ?? [],
      effects: player.effects
    },
    opponents,
    shared: state.shared
  };
}

/**
 * End game when timeout is reached (max_turns or max_rounds).
 * Delegates winner determination to mechanic hooks (timeout-winner),
 * falls back to highest score if no mechanic handles it.
 */
function endGameOnTimeout(state: GameState, endType: string): void {
  // Guard against duplicate end calls
  if (state.status === 'pending_analysis' || state.status === 'completed' || state.status === 'cancelled') {
    return;
  }

  // Let mechanics determine timeout winner (timeout-winner mechanic handles role/condition logic)
  const mechanicResult = mechanicRegistry.checkAllWinConditions(state, 'timeout');

  let winner: string | null;
  let reason: string;

  if (mechanicResult) {
    winner = mechanicResult.playerId;
    reason = mechanicResult.reason;
  } else {
    // Fallback: highest score
    let highestScore = -Infinity;
    winner = 'none';
    for (const [playerId, player] of Object.entries(state.players)) {
      const score = player.score ?? 0;
      if (score > highestScore) {
        highestScore = score;
        winner = playerId;
      }
    }
    const limit = endType === 'turn_limit' ? `Max turns (${state.config.max_turns})` : `Max rounds (${state.config.max_rounds})`;
    reason = `${limit} reached. ${winner} wins with ${highestScore} points.`;
  }

  state.status = 'pending_analysis';
  state.shared.winner = winner;
  state.shared.endReason = reason;

  logEvent(state, {
    event: 'game_end',
    round: state.round,
    turnNumber: state.turnNumber,
    data: { winner, reason, endType }
  });

  saveState(state);
}

export function advanceTurn(state: GameState): void {
  const previousPlayer = state.currentPlayer!;
  const currentIndex = state.turnOrder.indexOf(previousPlayer);
  const nextIndex = (currentIndex + 1) % state.turnOrder.length;
  const isNewRound = nextIndex === 0;

  // Always increment turnNumber (absolute action counter)
  state.turnNumber++;

  // Proposal 012: Check max_turns limit (takes precedence over max_rounds)
  const maxTurns = state.config.max_turns as number | undefined;
  if (maxTurns && state.turnNumber > maxTurns) {
    endGameOnTimeout(state, 'turn_limit');
    return;
  }

  // If we wrapped around, increment round number
  if (isNewRound) {
    state.round++;

    // Check max_rounds limit (legacy - use max_turns for turn-based limits)
    if (state.config.max_rounds && state.round > state.config.max_rounds) {
      endGameOnTimeout(state, 'timeout');
      return;
    }
  }

  // At round start, let mechanics reorder turn order (e.g., turn-order-role, turn-order-stat-based)
  if (isNewRound) {
    applyDynamicTurnOrder(state, 'round_start');
  }

  // ============ Mechanic Hooks: Turn end ============
  // Run onTurnEnd hooks for the player whose turn just ended
  // Effects mechanic decrements durations, fires onEffectRemoved hooks
  const turnEndChanges = mechanicRegistry.onTurnEnd(state, previousPlayer, state.turnOrder[nextIndex], isNewRound);
  applyStateChanges(state, turnEndChanges);

  state.currentPlayer = state.turnOrder[nextIndex];

  // ============ Mechanic Hooks: Turn start ============
  // Run onTurnStart hooks for all enabled mechanics (e.g., refresh AP, income)
  const turnStartChanges = mechanicRegistry.onTurnStart(state, state.currentPlayer, isNewRound);
  applyStateChanges(state, turnStartChanges);

  saveState(state);
}

export function endGame(gameName: string, winner: string, reason: string): GameState {
  const state = loadState(gameName);

  // Guard against duplicate end calls — game can only end once
  if (state.status === 'pending_analysis' || state.status === 'completed' || state.status === 'cancelled') {
    return state;
  }

  state.status = 'pending_analysis';
  state.shared.winner = winner;
  state.shared.endReason = reason;
  saveState(state);

  logEvent(state, {
    event: 'game_end',
    round: state.round,
    turnNumber: state.turnNumber,
    data: { winner, reason }
  });

  return state;
}

export function cancelGame(gameName: string, reason: string): GameState {
  const state = loadState(gameName);

  state.status = 'cancelled';
  state.shared.cancelReason = reason;
  saveState(state);

  logEvent(state, {
    event: 'game_cancelled',
    round: state.round,
        turnNumber: state.turnNumber,
    data: { reason }
  });

  return state;
}

/**
 * Check if multi-action per round is allowed (e.g., action-points mechanic is enabled).
 * Without this, engine enforces single action per round.
 */
function isMultiActionAllowed(state: GameState): boolean {
  return !!state.config.engine_mechanics?.action_points;
}

/**
 * Conditionally advance turn based on action type and mechanic hooks.
 * For games with action points, only advances when AP is depleted.
 * For games without action points, always advances (each action = one turn).
 *
 * @param state - Current game state
 * @param playerId - Player who just acted
 * @param action - The action that was executed
 * @returns true if turn was advanced, false if player can continue
 */
export function maybeAdvanceTurn(state: GameState, playerId: string, action: GameAction): boolean {
  // Note: 'pass' is now handled by the pass mechanic via onExecuteAction
  // which sets advanceTurn: true, so it's handled in executeAction's mechanic path

  // Check if any mechanic wants to auto-end the turn (e.g., action points depleted)
  const shouldEnd = mechanicRegistry.shouldAutoEndTurn(state, playerId);

  if (shouldEnd) {
    advanceTurn(state);
    return true;
  }

  // Auto-advance for single-action-per-round games (no action points).
  // This function is only called after an action is executed, so always advance.
  if (!isMultiActionAllowed(state)) {
    advanceTurn(state);
    return true;
  }

  // Turn continues - save state but don't advance
  saveState(state);
  return false;
}

/**
 * Submit gamemaster analysis for a completed game.
 * Transitions status from 'pending_analysis' to 'completed'.
 */
export function submitAnalysis(gameName: string, analysis: GameAnalysis): GameState {
  const state = loadState(gameName);

  if (state.status !== 'pending_analysis') {
    throw new Error(`Cannot submit analysis: game status is '${state.status}', expected 'pending_analysis'`);
  }

  // Store analysis in shared state
  state.shared.analysis = analysis;
  state.status = 'completed';
  saveState(state);

  logEvent(state, {
    event: 'analysis_submitted',
    round: state.round,
        turnNumber: state.turnNumber,
    data: {
      summary: analysis.summary,
      winner: analysis.winner,
      mechanicsUsed: analysis.mechanicsObserved
    }
  });

  return state;
}

/**
 * Skip analysis and mark game as completed directly.
 * Use when no analysis is needed or GM is unavailable.
 */
export function skipAnalysis(gameName: string): GameState {
  const state = loadState(gameName);

  if (state.status !== 'pending_analysis') {
    throw new Error(`Cannot skip analysis: game status is '${state.status}', expected 'pending_analysis'`);
  }

  state.status = 'completed';
  saveState(state);

  return state;
}

/**
 * Submit gamemaster analysis as markdown file.
 * Writes to: games/{gameName}/logs/playtest-analysis-{version}-{timestamp}.md
 * Transitions status from 'pending_analysis' to 'completed'.
 */
export function submitAnalysisMarkdown(gameNameOrId: string, version: string, markdownContent: string): GameState {
  const state = loadState(gameNameOrId);

  if (state.status !== 'pending_analysis') {
    throw new Error(`Cannot submit analysis: game status is '${state.status}', expected 'pending_analysis'`);
  }

  // Extract timestamp from gameId (e.g., "fortune-seekers-1769871590604" -> "1769871590604")
  const timestampMatch = state.gameId.match(/(\d{13})$/);
  if (!timestampMatch) {
    throw new Error(`Cannot extract timestamp from gameId: ${state.gameId}`);
  }
  const timestamp = timestampMatch[1];

  // Ensure version starts with 'v' for consistency
  const normalizedVersion = version.startsWith('v') ? version : `v${version}`;

  // Build analysis file path
  const logsDir = join(GAMES_DIR, state.gameName, 'logs');
  const analysisFilename = `playtest-analysis-${normalizedVersion}-${timestamp}.md`;
  const analysisPath = join(logsDir, analysisFilename);

  // Ensure logs directory exists
  if (!existsSync(logsDir)) {
    mkdirSync(logsDir, { recursive: true });
  }

  // Write markdown file
  writeFileSync(analysisPath, markdownContent, 'utf-8');

  // Store reference in game state
  state.shared.analysisFile = analysisFilename;
  state.shared.analysisVersion = normalizedVersion;
  state.status = 'completed';
  saveState(state);

  logEvent(state, {
    event: 'analysis_submitted',
    round: state.round,
        turnNumber: state.turnNumber,
    data: {
      file: analysisFilename,
      version: normalizedVersion
    }
  });

  return state;
}

// Randomization functions (engine-controlled)

export function roll(probability: number): { roll: number; success: boolean } {
  const rollValue = Math.random();
  return {
    roll: rollValue,
    success: rollValue <= probability
  };
}

// ============ Win Condition Detection ============

/**
 * Check all players for win conditions after an action.
 * Delegates to mechanic registry's onCheckWin hooks (win condition mechanics
 * are auto-derived from win_condition string during config normalization).
 */
export function checkAllWinConditions(state: GameState): { winner: string; reason: string } | null {
  const result = mechanicRegistry.checkAllWinConditions(state, 'action');
  if (result) {
    return { winner: result.playerId, reason: result.reason };
  }
  return null;
}

// determineTimeoutWinner logic moved to timeout-winner mechanic (onCheckWin with trigger='timeout')
// Engine fallback (highest score) is in endGameOnTimeout() above

// drawCards moved to cards core mechanic (src/mechanics/core/cards.ts)

export function discardCard(state: GameState, playerId: string, cardIndex: number): Card | null {
  // Use core services for hand and discard operations (with playerId for hooks)
  const card = removeFromHandByIndex(state, playerId, cardIndex);
  if (!card) {
    return null;
  }

  addToDiscard(state, [card], playerId);
  saveState(state);

  return card;
}

export function playCardByName(state: GameState, playerId: string, cardName: string, declaredColor?: string): Card | null {
  const player = state.players[playerId];
  if (!player) {
    throw new Error(`Player ${playerId} not found`);
  }

  // Use core service for card play (handles hand removal, discard, and onCardPlayed hook)
  const playContext: Record<string, unknown> = {};
  if (declaredColor) playContext.declaredColor = declaredColor;
  const result = playCard(state, playerId, cardName, playContext);

  if (!result.card) {
    return null;
  }

  saveState(state);

  return result.card;
}

// getPlacedCardsOnState and applyPlacedCardEffects moved to board-state mechanic

// applyLocationEffects removed - location-effects mechanic handles via applyEffect hook

/**
 * Place a card on a board state.
 */
// ============ Dynamic Action Discovery ============

/**
 * Get all available actions for a player based on game rules and current state.
 * This function procedurally exposes what actions are possible, enabling
 * game-agnostic action discovery.
 */
export function getAvailableActions(state: GameState, playerId: string): AvailableActionsResult {
  const player = state.players[playerId];
  if (!player) {
    throw new Error(`Player ${playerId} not found`);
  }

  const isCurrentPlayer = state.currentPlayer === playerId;
  const canActNow = mechanicRegistry.canPlayerActNow(state, playerId);
  const isYourTurn = isCurrentPlayer || canActNow;
  const placedCards = (state.shared.placedCards || []) as PlacedCard[];

  // Check for blocking effects using mechanic registry
  const isBlocked = mechanicRegistry.isPlayerBlocked(state, playerId);

  // Collect all mechanic-provided actions (move, play_card, draw, place_card, etc.)
  const mechanicActions = mechanicRegistry.getAvailableActions(state, playerId);

  const actions: AvailableAction[] = [];

  // === PASS action (only for currentPlayer) ===
  // Serves as the dedup anchor — other mechanics may emit { type: 'pass' } but
  // those are deduplicated against this base entry.
  // Validation is handled by the pass mechanic's preValidateAction hook.
  actions.push({
    type: 'pass',
    description: 'Skip your turn without taking an action',
    enabled: isCurrentPlayer,
    reason: !isCurrentPlayer ? 'Not your turn' : undefined,
    required: {},
    optional: { reasoning: 'Why you are passing' },
    examples: [{ type: 'pass' }]
  });

  // trade_offer, trade_respond, bid, spend, collect_set, roll, bank, draft
  // actions are now provided by their respective mechanics (getAvailableActions)

  // === RESIGN action (always available regardless of turn) ===
  actions.push({
    type: 'resign',
    description: 'Forfeit the game (requires gamemaster approval)',
    enabled: true,
    required: { reason: 'Explanation for why you are resigning' },
    examples: [{ type: 'resign', reason: 'I cannot win from this position' }]
  });

  // === MECHANIC HOOKS: Merge non-duplicate mechanic actions ===
  // Skip mechanic actions that duplicate base actions (pass, resign)
  // Keep mechanic actions with unique categories (e.g. "victory" pass is distinct from plain "pass")
  const baseActionTypes = new Set(actions.map(a => a.type));
  for (const mechanicAction of mechanicActions) {
    // Skip mechanics that duplicate base actions already listed above
    // Keep special categories like "victory" that add new functionality
    if (baseActionTypes.has(mechanicAction.action.type) &&
        !['victory', 'programming'].includes(mechanicAction.category || '')) continue;

    // Let mechanics override enabled/reason; default to isYourTurn && !isBlocked
    const defaultEnabled = isYourTurn && !isBlocked;
    const enabled = mechanicAction.enabled !== undefined ? mechanicAction.enabled : defaultEnabled;
    const reason = mechanicAction.reason !== undefined ? mechanicAction.reason :
                   (!isYourTurn ? 'Not your turn' :
                    isBlocked ? 'You are blocked this turn' :
                    undefined);

    // Use rich metadata from mechanic when available, fall back to extracted params
    let required = mechanicAction.required;
    if (!required) {
      const { type, ...actionParams } = mechanicAction.action as unknown as Record<string, unknown>;
      required = {};
      for (const [key, val] of Object.entries(actionParams)) {
        required[key] = String(val);
      }
    }

    const actionEntry: AvailableAction = {
      type: mechanicAction.action.type,
      description: mechanicAction.description || `${mechanicAction.category || 'mechanic'}: ${mechanicAction.action.type}`,
      enabled,
      reason: !enabled ? reason : undefined,
      required,
      optional: mechanicAction.optional,
      examples: mechanicAction.examples || [mechanicAction.action],
      cards: mechanicAction.cards,
      targets: mechanicAction.targets,
    };

    actions.push(actionEntry);
  }

  // Add resource and action point info to result
  const result: AvailableActionsResult = {
    playerId,
    isYourTurn,
    currentState: player.state,
    hand: [],  // Cards mechanic contributes hand via getPlayerView
    actions,
    placedCards,
    activeEffects: player.effects
  };

  // Let mechanics contribute to player view
  // resources (resources-mechanic), actionPoints (action-points), collectedSets (set-collection),
  // power (variable-player-powers), rollAccumulator (push-your-luck), draftDisplay (open-drafting)
  const mechanicView = mechanicRegistry.getPlayerView(state, playerId);
  Object.assign(result, mechanicView);

  return result;
}

// ============ Contest-Based Adjudication Functions ============

// Initialize contest state in game state if not present
export function ensureContestState(state: GameState): ContestState {
  if (!state.shared.contestState) {
    state.shared.contestState = {
      actionHistory: [],
      contestHistory: [],
      resignations: [],
      victoryHistory: []
    };
  }
  // Ensure arrays exist for older game states
  const cs = state.shared.contestState as ContestState;
  if (!cs.victoryHistory) {
    cs.victoryHistory = [];
  }
  if (!cs.actionHistory) {
    cs.actionHistory = [];
  }
  return cs;
}

// Record an action in both lastAction and actionHistory
const MAX_ACTION_HISTORY = 12;  // Keep last 12 actions (3 full rounds for 4 players)

export function recordAction(contestState: ContestState, action: LastAction): void {
  contestState.lastAction = action;

  // Add to history and trim to max size
  contestState.actionHistory.push(action);
  if (contestState.actionHistory.length > MAX_ACTION_HISTORY) {
    contestState.actionHistory = contestState.actionHistory.slice(-MAX_ACTION_HISTORY);
  }
}

// Validate an action against an ActionSchema returned by a mechanic
function validateAgainstSchema(action: Record<string, unknown>, schema: ActionSchema): string[] {
  const errors: string[] = [];

  // Check required fields
  if (schema.required) {
    for (const field of schema.required) {
      if (action[field] === undefined || action[field] === null) {
        errors.push(`${action.type} action requires "${field}" field`);
      }
    }
  }

  // Check field types
  if (schema.fields) {
    for (const [field, def] of Object.entries(schema.fields)) {
      const value = action[field];
      if (value === undefined || value === null) continue; // Missing fields caught by required check

      const actualType = Array.isArray(value) ? 'array' : typeof value;
      if (actualType !== def.type) {
        errors.push(`${action.type} "${field}" must be ${def.type === 'array' ? 'an array' : `a ${def.type}`}`);
        continue;
      }

      if (def.type === 'number' && typeof value === 'number') {
        if (def.minimum !== undefined && value < def.minimum) {
          errors.push(`${action.type} "${field}" must be at least ${def.minimum}`);
        }
        if (def.maximum !== undefined && value > def.maximum) {
          errors.push(`${action.type} "${field}" must be at most ${def.maximum}`);
        }
      }

      if (def.enum && !def.enum.includes(value)) {
        errors.push(`${action.type} "${field}" must be one of: ${def.enum.join(', ')}`);
      }
    }
  }

  // Check conditional requirements
  if (schema.conditional) {
    for (const cond of schema.conditional) {
      const matches = Object.entries(cond.if).every(([k, v]) => action[k] === v);
      if (matches) {
        if (cond.require) {
          for (const field of cond.require) {
            if (action[field] === undefined || action[field] === null) {
              errors.push(`${action.type} requires "${field}" when ${Object.entries(cond.if).map(([k, v]) => `${k}=${v}`).join(', ')}`);
            }
          }
        }
        if (cond.forbid) {
          for (const field of cond.forbid) {
            if (action[field] !== undefined) {
              errors.push(`${action.type} forbids "${field}" when ${Object.entries(cond.if).map(([k, v]) => `${k}=${v}`).join(', ')}`);
            }
          }
        }
      }
    }
  }

  return errors;
}

// Built-in schemas for engine-owned actions (not owned by any mechanic)
const BUILTIN_SCHEMAS: Record<string, ActionSchema> = {
  resign: {
    required: ['reason'],
    fields: {
      reason: { type: 'string' },
    },
  },
};

// Validate action schema/type (stateless check — called before game state is loaded)
export function validateActionSchema(action: unknown): ActionValidationResult {
  if (!action || typeof action !== 'object') {
    return { valid: false, errors: ['Action must be a JSON object'] };
  }

  const act = action as Record<string, unknown>;

  if (!act.type || typeof act.type !== 'string') {
    return { valid: false, errors: ['Action must have a "type" field (string)'] };
  }

  // Validate against built-in schema if this is an engine-owned action
  const builtinSchema = BUILTIN_SCHEMAS[act.type];
  if (builtinSchema) {
    const errors = validateAgainstSchema(act, builtinSchema);
    if (errors.length > 0) {
      return { valid: false, errors };
    }
  }

  // Mechanic-owned action schemas are validated in validateAction() where game state is available
  return { valid: true, errors: [] };
}

// Validate action against a mechanic-provided schema (called from validateAction with state)
function validateMechanicSchema(state: GameState, action: GameAction): string[] {
  const schema = mechanicRegistry.getActionSchema(state, action);
  if (!schema) return []; // No mechanic claims this action type — skip schema validation
  return validateAgainstSchema(action as unknown as Record<string, unknown>, schema);
}

// Validate action against game rules (basic engine-level validation)
export function validateAction(state: GameState, playerId: string, action: GameAction): ActionValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  const player = state.players[playerId];
  if (!player) {
    return { valid: false, errors: [`Player ${playerId} not found`] };
  }

  // Check if it's the player's turn (or a mechanic grants out-of-turn access)
  // Resign is always allowed regardless of turn order
  const isOutOfTurnAction = state.currentPlayer !== playerId;
  if (isOutOfTurnAction && action.type !== 'resign') {
    const canActNow = mechanicRegistry.canPlayerActNow(state, playerId);
    if (!canActNow) {
      return { valid: false, errors: [`Not your turn. Current player: ${state.currentPlayer}`] };
    }
  }

  // Check game status
  if (state.status !== 'in_progress') {
    return { valid: false, errors: [`Game is not in progress. Status: ${state.status}`] };
  }

  // Check for pending contest/resignation (with auto-adjudication timeout)
  const contestState = ensureContestState(state);
  if (contestState.pendingContest) {
    // Check if contest has timed out and should be auto-adjudicated
    const wasAutoAdjudicated = checkAndAutoAdjudicateContest(state);
    if (!wasAutoAdjudicated) {
      // Still pending - block the action
      const elapsed = Date.now() - new Date(contestState.pendingContest.timestamp).getTime();
      const remainingMs = AUTO_ADJUDICATION_TIMEOUT_MS - elapsed;
      const remainingSec = Math.max(0, Math.ceil(remainingMs / 1000));
      return {
        valid: false,
        errors: [`Cannot act while a contest is pending. Wait for adjudication (auto-adjudication in ${remainingSec}s).`]
      };
    }
    // Auto-adjudicated - continue with validation
  }
  if (contestState.pendingResignation) {
    // Check if resignation has timed out and should be auto-adjudicated
    const wasAutoAdjudicated = checkAndAutoAdjudicateResignation(state);
    if (!wasAutoAdjudicated) {
      return { valid: false, errors: ['Cannot act while a resignation is pending adjudication.'] };
    }
  }

  // Note: Blocking effects check moved to lose-a-turn mechanic

  // Prevent multiple actions per round unless multi-action is allowed (e.g., action-points)
  // Out-of-turn actions (granted by canPlayerActNow) bypass this — mechanics track their own submission state
  if (!isOutOfTurnAction && !isMultiActionAllowed(state) && player.lastActionRound === state.round && action.type !== 'pass') {
    return {
      valid: false,
      errors: ['You have already acted this round. Wait for your next turn.']
    };
  }

  // ============ Mechanic Hooks: Pre-validation ============
  // Run preValidateAction hooks for all enabled mechanics
  const preValidationResult = mechanicRegistry.preValidateAction(state, playerId, action);
  if (!preValidationResult.valid) {
    return {
      valid: false,
      errors: [preValidationResult.error || 'Action blocked by mechanic']
    };
  }

  // ============ Mechanic Schema Validation ============
  // Validate action fields against mechanic-provided schemas
  const schemaErrors = validateMechanicSchema(state, action);
  errors.push(...schemaErrors);

  // play_card and draw validation moved to cards core mechanic (preValidateAction)

  if (action.type === 'pass') {
    warnings.push('Pass action will be recorded. Other players may contest if rules require you to play.');
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings: warnings.length > 0 ? warnings : undefined
  };
}

// Execute an action directly (the core of the contest system)
export function executeAction(state: GameState, playerId: string, action: GameAction): {
  success: boolean;
  effect?: { type: string; details?: Record<string, unknown> };
  error?: string;
  gameOver?: boolean;
  winner?: string;
} {
  const player = state.players[playerId];
  if (!player) {
    return { success: false, error: `Player ${playerId} not found` };
  }

  // Run mechanic pre-validation hooks (e.g., board-state edge checks)
  const preValidation = mechanicRegistry.preValidateAction(state, playerId, action);
  if (!preValidation.valid) {
    return { success: false, error: preValidation.error || 'Action blocked by mechanic' };
  }

  const contestState = ensureContestState(state);

  // ============ Mechanic Delegation: Let mechanics handle actions first ============
  // Try to execute via mechanic hooks before falling back to built-in handling
  const mechanicResult = mechanicRegistry.executeAction(state, playerId, action);

  if (mechanicResult?.handled) {
    // Mechanic handled the action - apply its state changes
    if (mechanicResult.stateChanges) {
      applyStateChanges(state, mechanicResult.stateChanges);
    }

    // Run postExecuteAction hooks (e.g., deduct AP)
    const postExecuteChanges = mechanicRegistry.postExecuteAction(state, playerId, action);
    applyStateChanges(state, postExecuteChanges);

    // Log the action
    logEvent(state, {
      event: 'action_executed',
      round: state.round,
      turnNumber: state.turnNumber,
      player: playerId,
      data: {
        type: action.type,
        ...mechanicResult.logData
      }
    });

    // Check win condition if requested by a mechanic — or after every action when a
    // mechanic declared machine-checkable goals (hidden-objectives `check`s): a goal can
    // be met by a trade, a placement or a draw, not only by the actions that ask.
    if (mechanicResult.checkWin || state.shared.alwaysCheckWin) {
      const winCheck = checkAllWinConditions(state);
      if (winCheck) {
        state.status = 'pending_analysis';
        state.shared.winner = winCheck.winner;
        state.shared.endReason = winCheck.reason;
        saveState(state);
        return {
          success: true,
          gameOver: true,
          winner: winCheck.winner,
          effect: { type: action.type, details: mechanicResult.logData }
        };
      }
    }

    // Mark that player has acted this round (prevents multiple actions without action points)
    // Only set this if the turn will actually end or be kept within same-round continuation
    if (mechanicResult.advanceTurn !== false) {
      player.lastActionRound = state.round;
    }

    // Handle turn advancement — three-value semantics:
    //   advanceTurn: true  → always advance (pass, bank, bust)
    //   advanceTurn: false → never advance (play_card, roll — await pass or AP depletion)
    //   advanceTurn: undefined → auto-detect (non-AP: advance; AP: let AP handle it)
    // Only the current player's spent AP ends the turn: an off-turn action (answering a
    // trade) must not advance someone else's turn.
    const shouldEnd = playerId === state.currentPlayer && mechanicRegistry.shouldAutoEndTurn(state, playerId);
    if (shouldEnd) {
      advanceTurn(state);
    } else if (mechanicResult.advanceTurn === false) {
      saveState(state);
    } else if (mechanicResult.advanceTurn === true) {
      advanceTurn(state);
    } else {
      // advanceTurn unset: auto-detect based on game type
      if (!isMultiActionAllowed(state)) {
        advanceTurn(state);
      } else {
        saveState(state);
      }
    }

    return {
      success: true,
      effect: { type: action.type, details: mechanicResult.logData }
    };
  }

  // ============ Fallback: Built-in action handling ============
  // Run postExecuteAction hooks for all enabled mechanics (e.g., deduct AP)
  const postExecuteChanges = mechanicRegistry.postExecuteAction(state, playerId, action);
  applyStateChanges(state, postExecuteChanges);

  try {
    switch (action.type) {
      // play_card, draw handled by cards core mechanic (onExecuteAction)
      // pass handled by pass core mechanic (onExecuteAction)

      case 'resign': {
        const resignAction = action as ResignAction;
        // Queue resignation for gamemaster adjudication
        contestState.pendingResignation = {
          player: playerId,
          reason: resignAction.reason,
          timestamp: new Date().toISOString()
        };
        saveState(state);

        logEvent(state, {
          event: 'resignation_submitted',
          round: state.round,
        turnNumber: state.turnNumber,
          player: playerId,
          data: { reason: resignAction.reason }
        });

        return {
          success: true,
          effect: {
            type: 'resignation_pending',
            details: { reason: resignAction.reason }
          }
        };
      }

      // move handled by board-state/grid-movement mechanics (onExecuteAction)
      // place_card and place_location handled by place-card mechanic (onExecuteAction)

      // trade_offer, trade_respond handled by trading mechanic (onExecuteAction)
      // bid handled by auction-english mechanic (onExecuteAction)
      // spend handled by resources mechanic (onExecuteAction)
      // collect_set, roll, bank, draft handled by their respective mechanics (onExecuteAction)

      default:
        return { success: false, error: `Unknown action type: ${(action as GameAction).type}` };
    }
  } catch (e) {
    return { success: false, error: (e as Error).message };
  }
}

// validateSet moved to set-collection mechanic

// File a contest against the previous action
export function fileContest(state: GameState, contestingPlayer: string, reason: string): {
  success: boolean;
  error?: string;
} {
  const contestState = ensureContestState(state);

  if (!contestState.lastAction) {
    return { success: false, error: 'No previous action to contest' };
  }

  if (contestState.lastAction.player === contestingPlayer) {
    return { success: false, error: 'Cannot contest your own action' };
  }

  if (contestState.pendingContest) {
    return { success: false, error: 'A contest is already pending' };
  }

  if (contestState.pendingResignation) {
    return { success: false, error: 'A resignation is pending adjudication' };
  }

  contestState.pendingContest = {
    contestedBy: contestingPlayer,
    reason,
    originalAction: contestState.lastAction,
    timestamp: new Date().toISOString()
  };

  saveState(state);

  logEvent(state, {
    event: 'contest_filed',
    round: state.round,
        turnNumber: state.turnNumber,
    player: contestingPlayer,
    data: {
      reason,
      contestedAction: contestState.lastAction.action,
      contestedPlayer: contestState.lastAction.player
    }
  });

  return { success: true };
}

// Adjudicate a pending contest
export function adjudicateContest(
  state: GameState,
  ruling: 'allowed' | 'rejected',
  rulingReason: string
): {
  success: boolean;
  reversed?: boolean;
  error?: string;
} {
  const contestState = ensureContestState(state);

  if (!contestState.pendingContest) {
    return { success: false, error: 'No pending contest to adjudicate' };
  }

  const contest = contestState.pendingContest;
  const originalAction = contest.originalAction;

  // Record in history
  contestState.contestHistory.push({
    round: originalAction.round,
    turnNumber: originalAction.turnNumber,
    action: originalAction.action,
    player: originalAction.player,
    contestedBy: contest.contestedBy,
    contestReason: contest.reason,
    ruling,
    rulingReason,
    timestamp: new Date().toISOString()
  });

  let reversed = false;

  // If action is rejected, try to reverse it
  if (ruling === 'rejected') {
    reversed = reverseAction(state, originalAction);
  }

  // Clear pending contest
  delete contestState.pendingContest;
  saveState(state);

  logEvent(state, {
    event: 'contest_adjudicated',
    round: state.round,
        turnNumber: state.turnNumber,
    data: {
      ruling,
      rulingReason,
      reversed,
      contestedPlayer: originalAction.player,
      contestedBy: contest.contestedBy
    }
  });

  // If ruling is 'allowed' and action includes victory declaration, create pending claim
  if (ruling === 'allowed') {
    processVictoryDeclarationIfPresent(state, originalAction);
  }

  return { success: true, reversed };
}

// Adjudicate a pending resignation
export function adjudicateResignation(
  state: GameState,
  accepted: boolean,
  rulingReason?: string
): {
  success: boolean;
  error?: string;
} {
  const contestState = ensureContestState(state);

  if (!contestState.pendingResignation) {
    return { success: false, error: 'No pending resignation to adjudicate' };
  }

  const resignation = contestState.pendingResignation;

  // Record in history
  contestState.resignations.push({
    player: resignation.player,
    reason: resignation.reason,
    accepted,
    rulingReason,
    timestamp: new Date().toISOString()
  });

  if (accepted) {
    // End game - the resigning player loses
    const otherPlayers = state.turnOrder.filter(p => p !== resignation.player);
    const winner = otherPlayers.length === 1 ? otherPlayers[0] : 'none';

    state.status = 'pending_analysis';
    state.shared.winner = winner;
    state.shared.endReason = `${resignation.player} resigned: ${resignation.reason}`;

    logEvent(state, {
      event: 'game_end',
      round: state.round,
        turnNumber: state.turnNumber,
      data: {
        winner,
        reason: `Resignation accepted: ${resignation.reason}`,
        resignedPlayer: resignation.player
      }
    });
  }

  // Clear pending resignation
  delete contestState.pendingResignation;
  saveState(state);

  logEvent(state, {
    event: 'resignation_adjudicated',
    round: state.round,
        turnNumber: state.turnNumber,
    data: {
      player: resignation.player,
      accepted,
      rulingReason
    }
  });

  return { success: true };
}

// Adjudicate a pending victory claim
export function adjudicateVictory(
  state: GameState,
  accepted: boolean,
  rulingReason: string
): { success: boolean; error?: string } {
  const contestState = ensureContestState(state);

  if (!contestState.pendingVictoryClaim) {
    return { success: false, error: 'No pending victory claim to adjudicate' };
  }

  const claim = contestState.pendingVictoryClaim;

  // Ensure victoryHistory array exists
  if (!contestState.victoryHistory) {
    contestState.victoryHistory = [];
  }

  // Record in history
  contestState.victoryHistory.push({
    player: claim.player,
    reason: claim.reason,
    ruling: accepted ? 'accepted' : 'rejected',
    rulingReason,
    timestamp: new Date().toISOString()
  });

  if (accepted) {
    state.status = 'pending_analysis';
    state.shared.winner = claim.player;
    state.shared.endReason = `Victory claim accepted: ${rulingReason}`;

    logEvent(state, {
      event: 'game_end',
      round: state.round,
        turnNumber: state.turnNumber,
      data: {
        winner: claim.player,
        reason: rulingReason,
        claimedState: claim.toState
      }
    });
  } else {
    // Rejected - ROLL BACK the move, then advance turn
    setBoardState(state, claim.player, claim.fromState); // Roll back to previous state

    logEvent(state, {
      event: 'victory_rejected',
      round: state.round,
        turnNumber: state.turnNumber,
      player: claim.player,
      data: {
        reason: rulingReason,
        rolledBackFrom: claim.toState,
        rolledBackTo: claim.fromState
      }
    });

    // Victory rejection always advances turn
    advanceTurn(state);
  }

  // Clear pending victory claim
  delete contestState.pendingVictoryClaim;
  saveState(state);

  logEvent(state, {
    event: 'victory_adjudicated',
    round: state.round,
        turnNumber: state.turnNumber,
    data: {
      player: claim.player,
      accepted,
      rulingReason
    }
  });

  return { success: true };
}

// Reverse a previous action (for rejected contests)
function reverseAction(state: GameState, lastAction: LastAction): boolean {
  const action = lastAction.action;
  const playerId = lastAction.player;
  const player = state.players[playerId];

  if (!player) return false;

  try {
    // Delegate to mechanics for action-specific undo (e.g., cards reverses play_card)
    mechanicRegistry.reverseAction(state, playerId, action);

    // Always reverse turn and save (mechanics only undo state changes)
    reverseTurn(state);
    saveState(state);
    return true;
  } catch {
    return false;
  }
}

// Reverse turn advancement
function reverseTurn(state: GameState): void {
  const currentIndex = state.turnOrder.indexOf(state.currentPlayer!);
  const prevIndex = (currentIndex - 1 + state.turnOrder.length) % state.turnOrder.length;

  // Always decrement turnNumber
  state.turnNumber = Math.max(1, state.turnNumber - 1);

  // If we're at the start of a new round, decrement round counter
  if (currentIndex === 0) {
    state.round = Math.max(1, state.round - 1);
  }

  state.currentPlayer = state.turnOrder[prevIndex];
}

// Get contest state for a game
export function getContestState(gameName: string): ContestState {
  const state = loadState(gameName);
  return ensureContestState(state);
}
