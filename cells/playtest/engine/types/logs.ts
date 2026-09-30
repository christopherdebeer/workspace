/**
 * Shared Log Event Types
 *
 * Source of truth for log event structures used by:
 * - engine/src/types.ts (LogEvent)
 * - site/src/types/logs.ts (TypedLogEvent)
 *
 * When adding new events:
 * 1. Add type here
 * 2. Add to LogEventType union
 * 3. Update engine logEvent() calls
 * 4. Update site TypedLogEvent union
 *
 * BUILD-TIME VALIDATION:
 * Run `npm run validate-sync` to ensure types are in sync across packages.
 */

// All possible log event types
export const LOG_EVENT_TYPES = [
  // Game lifecycle
  'game_init',
  'game_start',
  'game_end',
  'game_cancelled',

  // Actions
  'action_executed',

  // State tracking (for debugging/replay)
  'state_snapshot',

  // Probability/movement (when probability_movement enabled)
  'probability_roll',
  'state_transition',
  'move_failed',

  // Victory declaration (when victory_declaration enabled)
  'victory_claimed',
  'victory_adjudicated',
  'victory_rejected',

  // Contest system
  'contest_filed',
  'contest_adjudicated',

  // Resignations
  'resignation_submitted',
  'resignation_adjudicated',

  // Hand limit enforcement (Proposal 008)
  'hand_limit_exceeded',

  // Hook telemetry (mechanic debugging)
  'hook_invoked',
  'mechanic_response',
] as const;

export type LogEventType = (typeof LOG_EVENT_TYPES)[number];

// ============ STATE SNAPSHOT TYPES ============
// Lightweight state representation for logging (not full game state)

export interface PlayerStateSnapshot {
  position: string;           // Current location/state
  handSize: number;           // Number of cards in hand
  hand?: string[];            // Card names (optional, for detailed logging)
  score?: number;
  actionPoints?: number;
  resources?: Record<string, number>;
  effects?: Array<{ type: string; duration: number }>;
}

export interface GameStateSnapshot {
  round: number;
  turnNumber: number;
  currentPlayer: string;
  players: Record<string, PlayerStateSnapshot>;
  deckSize: number;
  discardSize: number;
  shared?: Record<string, unknown>;  // Game-specific shared state
}

// ============ EVENT DATA SCHEMAS ============

export interface LogEventDataSchemas {
  game_init: {
    gameId: string;
    playerCount: number;
    config: string;
    mechanics?: string[];      // Referenced mechanics from library
  };

  game_start: {
    players: string[];
    firstPlayer: string;
    initialState?: GameStateSnapshot;  // Starting state
  };

  game_end: {
    winner: string | null;     // null for draws
    reason: string;
    resignedPlayer?: string;
    claimedState?: string;
    finalState?: GameStateSnapshot;    // End state
    endType?: 'victory' | 'resignation' | 'timeout' | 'cancelled';
  };

  game_cancelled: {
    reason: string;
  };

  action_executed: {
    type: 'play_card' | 'draw' | 'pass' | 'move' | 'place_card' | 'trade' | 'resign' | 'draft';
    card?: string;
    effect?: Record<string, unknown>;
    declaredColor?: string;
    count?: number;
    target?: string;
    success?: boolean;

    // Player reasoning/thinking (required for playtesting analysis)
    reasoning: string;

    // State changes for traceability
    stateBefore?: PlayerStateSnapshot;   // Player state before action
    stateAfter?: PlayerStateSnapshot;    // Player state after action
  };

  // Periodic full state snapshot for debugging/replay
  state_snapshot: {
    reason: 'turn_start' | 'turn_end' | 'checkpoint' | 'debug';
    state: GameStateSnapshot;
  };

  probability_roll: {
    fromState: string;
    toState: string;
    baseProbability: number;
    boost: { card: string; value: number } | null;
    effectiveProbability: number;
    roll: number;
    success: boolean;
  };

  state_transition: {
    fromState: string;
    toState: string;
  };

  move_failed: {
    fromState: string;
    toState: string;
    probability: number;
    reasoning?: string;
  };

  victory_claimed: {
    reason: string;
    state: string;
    evidence?: Record<string, unknown>;  // Evidence for the claim
  };

  victory_adjudicated: {
    player: string;
    accepted: boolean;
    rulingReason: string;
  };

  victory_rejected: {
    reason: string;
    rolledBackFrom: string;
    rolledBackTo: string;
  };

  contest_filed: {
    reason: string;
    contestedAction: Record<string, unknown>;
    contestedPlayer: string;
  };

  contest_adjudicated: {
    ruling: 'allowed' | 'rejected';
    rulingReason: string;
    reversed: boolean;
    contestedPlayer: string;
    contestedBy: string;
  };

  resignation_submitted: {
    reason: string;
  };

  resignation_adjudicated: {
    player: string;
    accepted: boolean;
    rulingReason?: string;
  };

  hand_limit_exceeded: {
    handSize: number;
    limit: number;
    excess: number;
    policy: string;
    message: string;
  };

  hook_invoked: {
    hook: string;
    action_type?: string;
    enabled_mechanics: string[];
    responding_mechanics: string[];
    duration_ms: number;
    result: 'blocked' | 'allowed' | 'modified' | 'no_response';
  };

  mechanic_response: {
    mechanic: string;
    hook: string;
    response_type: 'blocked' | 'allowed' | 'modified' | 'state_changes';
    duration_ms: number;
    response_data?: Record<string, unknown>;
  };
}

// ============ TYPE HELPERS ============

// Helper type for type-safe event creation
export type TypedLogEvent<T extends LogEventType> = {
  timestamp: string;
  event: T;
  round?: number;
  turnNumber?: number;
  player?: string;
  data: LogEventDataSchemas[T];
};

// Union of all possible events
export type AnyLogEvent = {
  [K in LogEventType]: TypedLogEvent<K>;
}[LogEventType];

// Type guard for checking event types
export function isEventType<T extends LogEventType>(
  event: { event: string },
  type: T
): event is TypedLogEvent<T> {
  return event.event === type;
}

// ============ VALIDATION ============

// Runtime validation that an event has required fields
export function validateActionEvent(
  data: LogEventDataSchemas['action_executed']
): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  if (!data.type) {
    errors.push('Action type is required');
  }

  if (!data.reasoning || data.reasoning.trim() === '') {
    errors.push('Action reasoning is required for playtest analysis');
  }

  return {
    valid: errors.length === 0,
    errors
  };
}
