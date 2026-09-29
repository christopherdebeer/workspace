/**
 * Mechanic Hooks - Incremental extraction infrastructure
 *
 * This provides hook points for extracting mechanics from the monolithic game.ts
 * without breaking existing functionality. Mechanics can opt-in to hooks by
 * returning values; returning null means "not my concern".
 */

import { GameState, GameConfig, PlayerState, GameAction, Card, Effect } from '../types/game';

/**
 * Context passed to hooks - read-only view of game state
 */
export interface HookContext {
  state: GameState;
  playerId: string;
  player: PlayerState;
  config: GameConfig;
}

/**
 * Extended context for turn-start hooks
 */
export interface TurnStartContext extends HookContext {
  isNewRound: boolean;
}

/**
 * Extended context for turn-end hooks
 */
export interface TurnEndContext extends HookContext {
  /** Next player ID (after turn advances) */
  nextPlayerId: string;
  /** True if this ends the current round */
  isRoundEnd: boolean;
}

/**
 * Context for win condition checks
 */
export interface WinCheckContext {
  state: GameState;
  playerId: string;
  player: PlayerState;
  config: GameConfig;
  /** The trigger that caused this win check (action type, turn end, etc.) */
  trigger: string;
}

/**
 * Result from win condition check
 */
export interface WinCheckResult {
  /** True if this player has won */
  won: boolean;
  /** Reason for winning (for logging) */
  reason?: string;
}

// ============ Action Execution & Registration Types ============

/**
 * Context for action execution
 */
export interface ActionExecutionContext extends HookContext {
  action: GameAction;
}

/**
 * Result from action execution
 */
export interface ActionExecutionResult {
  /** True if this mechanic handled the action */
  handled: boolean;
  /** State changes to apply */
  stateChanges?: StateChanges;
  /** Should turn advance after this action? */
  advanceTurn?: boolean;
  /** Should check win conditions after this action? */
  checkWin?: boolean;
  /** Log message for the action */
  logMessage?: string;
  /** Additional log data */
  logData?: Record<string, unknown>;
}

/**
 * An available action exposed by a mechanic
 */
export interface AvailableAction {
  /** The action object */
  action: GameAction;
  /** Priority for display ordering (higher = first) */
  priority?: number;
  /** Category for grouping in UI */
  category?: string;
  /** If provided, overrides the default isYourTurn && !isBlocked enablement */
  enabled?: boolean;
  /** Reason the action is disabled (shown to player when enabled is false) */
  reason?: string;
  /** Rich description for player-facing display */
  description?: string;
  /** Required field descriptions */
  required?: Record<string, string>;
  /** Optional field descriptions */
  optional?: Record<string, string>;
  /** Example actions */
  examples?: GameAction[];
  /** Valid card names (for card-based actions) */
  cards?: string[];
  /** Valid target names (for targeted actions) */
  targets?: string[];
}

/**
 * Description of an action for display
 */
export interface ActionDescription {
  /** Action type */
  type: string;
  /** Human-readable label */
  label: string;
  /** Detailed description */
  description: string;
  /** Example usage strings */
  examples?: string[];
}

/**
 * Result of action validation
 */
export interface ValidationResult {
  valid: boolean;
  error?: string;
}

/**
 * State changes to apply after hook execution
 */
export interface StateChanges {
  playerStateChanges?: Record<string, Partial<PlayerState>>;
  sharedStateChanges?: Record<string, unknown>;
}

/**
 * Player state initialization result
 */
export interface PlayerInitResult {
  [key: string]: unknown;
}

/**
 * Context for player initialization (includes partial game state being built)
 */
export interface PlayerInitContext {
  config: GameConfig;
  playerId: string;
  playerIndex: number;
  /** Players initialized so far (for cross-player coordination) */
  existingPlayers: Record<string, Partial<PlayerState>>;
  /** Shared state initialized by mechanics (e.g., cards mechanic pre-dealt hands) */
  shared?: Record<string, unknown>;
}

/**
 * Context for card draw operations
 */
export interface DrawContext {
  state: GameState;
  playerId: string;
  requestedCount: number;
  config: GameConfig;
}

/**
 * Result from onBeforeDraw - can modify count or block draw
 */
export interface DrawHookResult {
  /** Modified count to draw (defaults to requestedCount) */
  count?: number;
  /** Block the draw entirely */
  blocked?: boolean;
  /** Reason for blocking */
  blockReason?: string;
}

/**
 * Context for after-draw hook
 */
export interface AfterDrawContext extends DrawContext {
  drawnCards: Card[];
  reshuffled: boolean;
}

/**
 * Context for discard operations
 */
export interface DiscardContext {
  state: GameState;
  playerId?: string;
  cards: Card[];
  config: GameConfig;
}

/**
 * Context for hand add operations
 */
export interface HandAddContext {
  state: GameState;
  playerId: string;
  cards: Card[];
  config: GameConfig;
}

/**
 * Result from onBeforeAddToHand - can filter or block
 */
export interface HandAddHookResult {
  /** Cards to actually add (can filter) */
  cards?: Card[];
  /** Block the add entirely */
  blocked?: boolean;
  blockReason?: string;
}

/**
 * Context for hand remove operations
 */
export interface HandRemoveContext {
  state: GameState;
  playerId: string;
  cards: Card[];
  config: GameConfig;
}

/**
 * Context for resource change operations
 */
export interface ResourceChangeContext {
  state: GameState;
  playerId: string;
  resource: string;
  /** Positive for add, negative for spend */
  amount: number;
  config: GameConfig;
}

/**
 * Result from onBeforeResourceChange - can modify amount or block
 */
export interface ResourceChangeHookResult {
  /** Modified amount (defaults to requested amount) */
  amount?: number;
  /** Block the change entirely */
  blocked?: boolean;
  /** Reason for blocking */
  blockReason?: string;
}

/**
 * Context for after-resource-change hook
 */
export interface AfterResourceChangeContext extends ResourceChangeContext {
  /** New amount after the change */
  newAmount: number;
}

/**
 * Context for effect operations
 */
export interface EffectContext {
  state: GameState;
  playerId: string;
  effect: Effect;
  config: GameConfig;
}

/**
 * Result from onBeforeAddEffect - can modify effect or block
 */
export interface EffectAddHookResult {
  /** Modified effect (defaults to original) */
  effect?: Effect;
  /** Block the add entirely */
  blocked?: boolean;
  /** Reason for blocking */
  blockReason?: string;
}

/**
 * Result from onBeforeRemoveEffect - can block removal
 */
export interface EffectRemoveHookResult {
  /** Block the removal */
  blocked?: boolean;
  /** Reason for blocking */
  blockReason?: string;
}

/**
 * Context for board move operations
 */
export interface MoveContext {
  state: GameState;
  playerId: string;
  /** Target state to move to */
  target: string;
  config: GameConfig;
}

// ============ Visibility System Types (Phase 4) ============

/**
 * Context for visibility checks - determines what a player can see
 */
export interface VisibilityContext {
  state: GameState;
  viewerPlayerId: string;
  config: GameConfig;
}

/**
 * Context for reveal operations - when hidden info becomes visible
 */
export interface RevealContext {
  state: GameState;
  /** Player revealing the information */
  revealingPlayerId: string;
  /** Type of information being revealed (e.g., 'role', 'hand', 'position') */
  targetInfo: string;
  /** Players who will see the revealed info ('all' for everyone) */
  toPlayerIds: string[] | 'all';
  config: GameConfig;
}

/**
 * Result from getVisibleState - filtered game state for a viewer
 */
export interface VisibleState {
  /** Filtered players object (with hidden info redacted) */
  players?: Record<string, Partial<PlayerState>>;
  /** Filtered shared state */
  shared?: Record<string, unknown>;
  /** Additional visibility metadata */
  visibilityMeta?: {
    hiddenPlayers?: string[];
    hiddenInfo?: string[];
    revealedTo?: Record<string, string[]>;
  };
}

// ============ Dice System Types (Phase 2) ============

/**
 * Context for dice roll operations
 */
export interface DiceRollContext {
  state: GameState;
  playerId: string;
  diceCount: number;
  diceSides: number;
  /** Purpose of the roll ('movement', 'combat', 'resource', etc.) */
  purpose?: string;
  config: GameConfig;
}

/**
 * Result from onBeforeRoll hook
 */
export interface DiceRollHookResult {
  /** Modified dice count */
  diceCount?: number;
  /** Modified dice sides */
  diceSides?: number;
  /** Modifier to add to total */
  modifier?: number;
  /** Block the roll entirely */
  blocked?: boolean;
  /** Reason for blocking */
  blockReason?: string;
}

/**
 * Context for after-roll operations
 */
export interface AfterRollContext extends DiceRollContext {
  /** Individual die results */
  results: number[];
  /** Sum of all dice */
  total: number;
  /** Dice that were kept (for re-roll mechanics) */
  keptDice?: number[];
}

// ============ Agnosticism Types (game.ts decoupling) ============

/**
 * Context for shared state initialization
 */
export interface SharedStateInitContext {
  config: GameConfig;
  /** The deck being built (mechanics can modify) */
  deck: Card[];
  /** Players being initialized */
  playerIds: string[];
  /** Shared state accumulated so far (includes topCard from discard pile init) */
  shared: Record<string, unknown>;
}

/**
 * Result from initSharedState - properties to add to shared state
 */
export interface SharedStateInitResult {
  [key: string]: unknown;
}

/**
 * Context for applying an effect
 */
export interface EffectApplicationContext {
  state: GameState;
  playerId: string;
  effect: Effect;
  /** Optional target player (for effects that target others) */
  targetPlayerId?: string;
  config: GameConfig;
}

/**
 * Result from applyEffect hook
 */
export interface EffectApplicationResult {
  /** True if this mechanic handled the effect */
  handled: boolean;
  /** State changes to apply */
  stateChanges?: StateChanges;
  /** Log message */
  logMessage?: string;
  /** Additional log data */
  logData?: Record<string, unknown>;
}

/**
 * Schema for action validation
 */
export interface ActionSchema {
  /** Required fields */
  required?: string[];
  /** Optional fields */
  optional?: string[];
  /** Conditional requirements */
  conditional?: Array<{
    /** Condition to check */
    if: Record<string, unknown>;
    /** Fields required when condition is true */
    require?: string[];
    /** Fields forbidden when condition is true */
    forbid?: string[];
  }>;
  /** Field type definitions */
  fields?: Record<string, {
    type: 'string' | 'number' | 'boolean' | 'array' | 'object';
    enum?: unknown[];
    minimum?: number;
    maximum?: number;
  }>;
}

// ============ Dynamic Turn Order Types (Phase 3) ============

/**
 * Context for determining turn order
 */
export interface TurnOrderContext {
  state: GameState;
  config: GameConfig;
  /** Current turn order */
  currentOrder: string[];
  /** Why turn order is being determined */
  reason: 'round_start' | 'mid_round' | 'claim' | 'pass';
}

/**
 * Result from onDetermineTurnOrder hook
 */
export interface TurnOrderResult {
  /** New turn order (or null to keep current) */
  order?: string[];
  /** Players to skip this round */
  skipPlayers?: string[];
}

/**
 * Result from onPassPriority hook
 */
export interface PassPriorityResult {
  /** Next player to receive priority */
  nextPlayer?: string;
  /** Remove passing player from this round */
  removeFromRound?: boolean;
  /** Skip to next round */
  skipToNextRound?: boolean;
}

// ============ Voting & Social Types (Phase 5) ============

/**
 * Context for casting a vote
 */
export interface VoteContext {
  state: GameState;
  /** Player casting the vote */
  playerId: string;
  /** Topic being voted on (e.g., 'elimination', 'action', 'leader') */
  topic: string;
  /** Vote ID (for tracking multi-round votes) */
  voteId: string;
  /** The player's vote choice */
  choice: string | number | null;
  config: GameConfig;
}

/**
 * Result from onVoteCast hook
 */
export interface VoteCastResult {
  /** Modified vote choice */
  choice?: string | number | null;
  /** Block the vote */
  blocked?: boolean;
  /** Reason for blocking */
  blockReason?: string;
  /** Additional state changes */
  stateChanges?: StateChanges;
}

/**
 * Result from onBeforeMove - can modify target or block
 */
export interface MoveHookResult {
  /** Modified target state */
  target?: string;
  /** Block the move entirely */
  blocked?: boolean;
  /** Reason for blocking */
  blockReason?: string;
}

// ============ Combat System Types (Phase 6) ============

/**
 * Context for combat operations
 */
export interface CombatHookContext {
  state: GameState;
  attackerId: string;
  defenderId: string;
  attackerUnits?: string[];
  defenderUnits?: string[];
  territory?: string;
  combatType?: string;
  config: GameConfig;
}

/**
 * Result from combat modifier hooks
 */
export interface CombatModifierResult {
  modifier: number;
  reason: string;
  source?: string;
}

/**
 * Result from combat resolution
 */
export interface CombatHookResult {
  winner: 'attacker' | 'defender' | 'draw';
  attackerLosses: number;
  defenderLosses: number;
  territoryChange: boolean;
  retreatRequired?: 'attacker' | 'defender' | 'both';
  criticalHit?: boolean;
  criticalFailure?: boolean;
}

/**
 * Casualties from combat
 */
export interface CombatCasualties {
  attacker: number;
  defender: number;
}

/**
 * Context for after-move hook
 */
export interface AfterMoveContext {
  state: GameState;
  playerId: string;
  /** Previous state before move */
  previousState: string;
  /** New state after move */
  newState: string;
  config: GameConfig;
}

/**
 * Definition of a hook that a mechanic exposes for its dependents to implement.
 * Any mechanic can define hooks; dependents implement them as methods.
 */
export interface HookDefinition {
  /** Human-readable description of when this hook fires */
  description: string;
  /**
   * How results from multiple implementers are combined:
   * - 'merge' (default): Collect and merge StateChanges from all implementers
   * - 'first': First non-null response wins
   * - 'blocking': Short-circuit if any implementer returns { blocked: true }
   */
  resolution?: 'merge' | 'first' | 'blocking';
}

/**
 * Mechanic hooks interface - all methods optional, return null to skip.
 *
 * Global hooks (defined here) are fired by the engine and routed to all enabled mechanics.
 * Mechanic-defined hooks (via `defines`) are fired by the defining mechanic and routed
 * only to mechanics that declare `requires` on the definer. Dependents implement these
 * as regular methods - identical in feel to implementing a global hook.
 */
export interface MechanicHooks {
  /** Unique identifier for this mechanic */
  slug: string;

  /** Human-readable name */
  name: string;

  /** If true, this mechanic's hooks are always active regardless of game config */
  alwaysEnabled?: boolean;

  /**
   * Called before action validation in core.
   * Return { valid: false, error } to block action.
   * Return { valid: true } or null to allow.
   */
  preValidateAction?(ctx: HookContext, action: GameAction): ValidationResult | null;

  /**
   * Called after successful action execution.
   * Return state changes to apply, or null for no changes.
   */
  postExecuteAction?(ctx: HookContext, action: GameAction): StateChanges | null;

  /**
   * Called to check if turn should auto-end.
   * Return true to force turn end, false/null to continue.
   */
  shouldAutoEndTurn?(ctx: HookContext): boolean;

  /**
   * Called when initializing a new player.
   * Return partial player state to merge.
   * Context includes existingPlayers for cross-player coordination.
   */
  initPlayerState?(ctx: PlayerInitContext): PlayerInitResult | null;

  /**
   * Called at start of player's turn.
   * Return state changes to apply.
   */
  onTurnStart?(ctx: TurnStartContext): StateChanges | null;

  /**
   * Called at end of player's turn (before advancing to next player).
   * Return state changes to apply.
   */
  onTurnEnd?(ctx: TurnEndContext): StateChanges | null;

  /**
   * Called to check if a player has won.
   * Return { won: true, reason } if the player has achieved victory.
   * Multiple mechanics can define win conditions; first to return won: true wins.
   */
  onCheckWin?(ctx: WinCheckContext): WinCheckResult | null;

  // ============ Action Execution & Registration Hooks ============
  // These hooks enable mechanics to handle their own actions and
  // dynamically expose available actions based on game state.

  /**
   * Execute an action owned by this mechanic.
   * Return { handled: true } to prevent default execution in game.ts.
   * Return null if this action is not owned by this mechanic.
   */
  onExecuteAction?(ctx: ActionExecutionContext): ActionExecutionResult | null;

  /**
   * Return actions this mechanic provides for the current player.
   * Called when building available actions list.
   */
  getAvailableActions?(ctx: HookContext): AvailableAction[];

  /**
   * Describe an action for display purposes.
   * Return null if this action is not owned by this mechanic.
   */
  describeAction?(action: GameAction): ActionDescription | null;

  // ============ Visibility System Hooks ============

  /**
   * Filter game state for a specific viewer.
   * Return partial state showing only what the viewer should see.
   * Return null to skip (use default visibility).
   */
  getVisibleState?(ctx: VisibilityContext): VisibleState | null;

  /**
   * Check if a player can see specific information.
   * Return true/false to allow/deny, or undefined to defer to other mechanics.
   * @param infoType - Type of info: 'role', 'hand', 'position', 'score', etc.
   * @param targetPlayerId - Optional target player (for viewing another player's info)
   */
  canSeeInfo?(ctx: VisibilityContext, infoType: string, targetPlayerId?: string): boolean | undefined;

  // ============ Dynamic Turn Order Hooks ============

  /**
   * Called to determine turn order at round start or when order changes.
   * Return new order or null to keep current.
   */
  onDetermineTurnOrder?(ctx: TurnOrderContext): TurnOrderResult | null;

  /**
   * Called when a player passes priority.
   * Can determine next player or remove from round.
   */
  onPassPriority?(ctx: HookContext): PassPriorityResult | null;

  // ============ Agnosticism Hooks (game.ts decoupling) ============

  /**
   * Initialize shared state for this mechanic.
   * Called during game initialization.
   * Return state properties to add to shared state.
   */
  initSharedState?(ctx: SharedStateInitContext): SharedStateInitResult | null;

  /**
   * Contribute mechanic-specific properties to player view.
   * Called when building visible state for a player.
   * Return properties to include in player's view.
   */
  getPlayerView?(ctx: HookContext): Record<string, unknown> | null;

  /**
   * Apply a mechanic-owned effect type.
   * Return { handled: true } if this mechanic handles the effect type.
   * Return null if the effect type is not owned by this mechanic.
   */
  applyEffect?(ctx: EffectApplicationContext): EffectApplicationResult | null;

  /**
   * Determine if a player is blocked from taking actions.
   * Return true if blocked, false if explicitly not blocked,
   * null/undefined to defer to other mechanics.
   */
  isPlayerBlocked?(ctx: HookContext): boolean | null;

  /**
   * Determine if a player can act now, even if it's not their turn.
   * Used by mechanics like freeplay that allow parallel/out-of-turn actions.
   * Return true if player can act, false if blocked, null to defer.
   */
  canPlayerActNow?(ctx: HookContext): boolean | null;

  /**
   * Provide action schema for validation.
   * Return schema for actions this mechanic owns.
   * Return null if action is not owned by this mechanic.
   */
  getActionSchema?(action: GameAction): ActionSchema | null;

  /**
   * Reverse a previously executed action (for contest rollback).
   * Return true if reversal was handled, null to defer to other mechanics.
   * The engine handles reverseTurn/saveState — mechanics only undo state changes.
   */
  reverseAction?(ctx: HookContext, action: GameAction): boolean | null;

  // ============ Combat System Hooks (Phase 6) ============

  /**
   * Called when combat is initiated.
   * Can modify setup or trigger pre-combat effects.
   */
  onCombatStart?(ctx: CombatHookContext): StateChanges | null;

  /**
   * Get attack modifiers for combat resolution.
   * Called to gather all attack bonuses/penalties.
   */
  getAttackModifiers?(ctx: CombatHookContext): CombatModifierResult[];

  /**
   * Get defense modifiers for combat resolution.
   * Called to gather all defense bonuses/penalties.
   */
  getDefenseModifiers?(ctx: CombatHookContext): CombatModifierResult[];

  /**
   * Called to resolve combat result.
   * Return result to override default resolution.
   */
  onResolveCombat?(ctx: CombatHookContext, attackValue: number, defenseValue: number): CombatHookResult | null;

  /**
   * Called after combat is resolved.
   * Can trigger post-combat effects.
   */
  onCombatEnd?(ctx: CombatHookContext, result: CombatHookResult): StateChanges | null;

  /**
   * Called when applying casualties from combat.
   * Can modify casualty distribution.
   */
  onApplyCasualties?(ctx: CombatHookContext, casualties: CombatCasualties): StateChanges | null;

  // ============ Mechanic Composition ============

  /**
   * Mechanics this one requires.
   * Registry validates all requirements are enabled at startup.
   */
  requires?: string[];

  /**
   * @deprecated Use `requires` instead. Will be removed in a future version.
   */
  dependencies?: string[];

  /**
   * Mechanics this one conflicts with.
   * Registry validates no conflicts are enabled at startup.
   */
  conflicts?: string[];

  /**
   * Hook methods this mechanic defines for its dependents to implement.
   * Dependents declare `requires: ['this-mechanic']` and implement the
   * hook methods as regular methods on their MechanicHooks object.
   *
   * The defining mechanic fires these via `mechanicRegistry.fire(slug, hookName, ...)`.
   */
  defines?: Record<string, HookDefinition>;

  /**
   * JSON Schema for this mechanic's config.
   * Used for validation and documentation.
   */
  configSchema?: MechanicConfigSchema;

  /**
   * Return highlight stats for display on game cards and pages.
   * Receives this mechanic's config from the game's RULES.md.
   * Return one or more { label, value } pairs, or null if nothing worth highlighting.
   * Only implement on mechanics that define a game's identity.
   */
  getHighlight?(config: unknown): { label: string; value: string }[] | null;

  /**
   * Allow arbitrary methods for mechanic-defined hook implementations.
   * When a mechanic declares `requires: ['cards']`, it can implement
   * methods like `onCardDrawn()` that the cards mechanic defines.
   */
  [hookName: string]: unknown;
}

/**
 * JSON Schema for mechanic configuration validation
 */
export interface MechanicConfigSchema {
  type: 'object' | 'boolean';
  properties?: Record<string, {
    type: 'string' | 'number' | 'boolean' | 'array' | 'object';
    description?: string;
    enum?: (string | number | boolean)[];
    default?: unknown;
    minimum?: number;
    maximum?: number;
    items?: { type: string };
    required?: boolean;
  }>;
  required?: string[];
  description?: string;
}

/**
 * Dependency resolver callback - set by the registry after all mechanics are registered.
 * Returns true if the given slug is required by any explicitly-enabled mechanic.
 */
let _dependencyResolver: ((config: GameConfig, slug: string) => boolean) | null = null;

/**
 * Set the dependency resolver (called by the registry during initialization).
 */
export function setDependencyResolver(resolver: (config: GameConfig, slug: string) => boolean): void {
  _dependencyResolver = resolver;
}

/**
 * Check if a mechanic has explicit config (directly configured in engine_mechanics).
 * Does NOT check dependencies - use isMechanicEnabled for full check.
 */
export function hasExplicitConfig(config: GameConfig, slug: string): boolean {
  if (!config.engine_mechanics) return false;

  // Map slug to config key (e.g., 'action-points' -> 'action_points')
  const configKey = slug.replace(/-/g, '_');

  // Check if the standard config key exists
  if (configKey in config.engine_mechanics &&
      config.engine_mechanics[configKey as keyof typeof config.engine_mechanics] !== undefined) {
    return true;
  }

  // Handle special cases where legacy config keys enable mechanics
  // hand-management is enabled by hand_limit or hand_limit_policy
  if (slug === 'hand-management') {
    return config.engine_mechanics.hand_limit !== undefined ||
           config.engine_mechanics.hand_limit_policy !== undefined;
  }

  // grid-movement is enabled by grid config
  if (slug === 'grid-movement') {
    return config.engine_mechanics.grid !== undefined;
  }

  // trading is enabled by trade config
  if (slug === 'trading') {
    return config.engine_mechanics.trade !== undefined;
  }

  return false;
}

/**
 * Check if a mechanic is enabled in the game config.
 * A mechanic is enabled if:
 * 1. It has explicit config in engine_mechanics, OR
 * 2. It is required by another enabled mechanic (dependency resolution)
 */
export function isMechanicEnabled(config: GameConfig, slug: string): boolean {
  // Check explicit config first
  if (hasExplicitConfig(config, slug)) {
    return true;
  }

  // Check if any enabled mechanic depends on this slug
  if (_dependencyResolver) {
    return _dependencyResolver(config, slug);
  }

  return false;
}
