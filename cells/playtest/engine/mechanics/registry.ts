/**
 * Mechanic Registry - Manages registered mechanics and routes hooks
 *
 * This is intentionally minimal to avoid adding complexity.
 * Mechanics register themselves, and the registry routes hook calls
 * to all enabled mechanics.
 */

import {
  MechanicHooks,
  HookContext,
  HookDefinition,
  TurnStartContext,
  TurnEndContext,
  ValidationResult,
  StateChanges,
  PlayerInitResult,
  PlayerInitContext,
  WinCheckContext,
  WinCheckResult,
  ActionExecutionContext,
  ActionExecutionResult,
  AvailableAction,
  ActionDescription,
  VisibilityContext,
  VisibleState,
  TurnOrderContext,
  TurnOrderResult,
  PassPriorityResult,
  // Agnosticism hooks
  SharedStateInitContext,
  SharedStateInitResult,
  EffectApplicationContext,
  EffectApplicationResult,
  ActionSchema,
  isMechanicEnabled,
  hasExplicitConfig,
  setDependencyResolver
} from './types';
import { GameState, GameConfig, GameAction, PlayerState, Card, Effect } from '../types/game';
import { logEvent } from '../core/game';

/**
 * Error returned when validating mechanic dependencies/conflicts
 */
export interface MechanicValidationError {
  mechanic: string;
  type: 'missing_dependency' | 'conflict';
  message: string;
}

/**
 * Metadata for a registered mechanic (for export/documentation)
 */
export interface MechanicMetadata {
  slug: string;
  name: string;
  configKey: string;
  description?: string;
  configSchema?: {
    type: string;
    properties?: Record<string, unknown>;
    required?: string[];
    description?: string;
  };
  requires?: string[];
  conflicts?: string[];
  defines?: Record<string, HookDefinition>;
  hooks: string[];
  hasHighlight?: boolean;
}

/**
 * Get the requirements for a mechanic, supporting both `requires` and legacy `dependencies`.
 */
export function getMechanicRequires(mechanic: MechanicHooks): string[] {
  return mechanic.requires ?? mechanic.dependencies ?? [];
}

class MechanicRegistry {
  private mechanics: Map<string, MechanicHooks> = new Map();

  /**
   * Register a mechanic's hooks
   */
  register(mechanic: MechanicHooks): void {
    if (this.mechanics.has(mechanic.slug)) {
      throw new Error(`Mechanic '${mechanic.slug}' is already registered`);
    }
    this.mechanics.set(mechanic.slug, mechanic);
    this.enabledByConfig = new WeakMap();
    this.enabledByKeys.clear();
  }

  /**
   * Install the dependency resolver so isMechanicEnabled can resolve
   * mechanics enabled via dependency (e.g., 'cards' is enabled because
   * 'card-matching' requires it and card-matching has explicit config).
   */
  installDependencyResolver(): void {
    setDependencyResolver((config: GameConfig, slug: string) => {
      // Check if any explicitly-enabled mechanic requires this slug
      for (const mechanic of this.mechanics.values()) {
        const requires = getMechanicRequires(mechanic);
        if (requires.includes(slug) && hasExplicitConfig(config, mechanic.slug)) {
          return true;
        }
      }
      return false;
    });
  }

  /**
   * Get all registered mechanic slugs
   */
  getRegisteredSlugs(): string[] {
    return Array.from(this.mechanics.keys());
  }

  /**
   * Get mechanics enabled for a game config.
   * Resolves dependencies transitively: infrastructure mechanics (no configSchema)
   * are auto-enabled when all their requires are satisfied.
   */
  getEnabledMechanics(config: GameConfig): MechanicHooks[] {
    // Hot path (every hook call). The result depends only on which engine_mechanics keys
    // are set, so cache by that key set (configs are deep-copied per state, so identity
    // alone would miss); registering a mechanic clears the cache.
    const byIdentity = this.enabledByConfig.get(config);
    if (byIdentity) return byIdentity;
    const em = (config.engine_mechanics ?? {}) as Record<string, unknown>;
    const key = Object.keys(em).filter((k) => em[k] !== undefined).sort().join('|');
    const cached = this.enabledByKeys.get(key);
    if (cached) {
      this.enabledByConfig.set(config, cached);
      return cached;
    }
    const result = this.computeEnabledMechanics(config);
    this.enabledByKeys.set(key, result);
    this.enabledByConfig.set(config, result);
    return result;
  }

  private enabledByConfig = new WeakMap<object, MechanicHooks[]>();
  private enabledByKeys = new Map<string, MechanicHooks[]>();

  private computeEnabledMechanics(config: GameConfig): MechanicHooks[] {
    const all = Array.from(this.mechanics.values());
    const enabledSlugs = new Set<string>();

    // Phase 1: explicitly configured + alwaysEnabled
    for (const m of all) {
      if (m.alwaysEnabled || isMechanicEnabled(config, m.slug)) {
        enabledSlugs.add(m.slug);
      }
    }

    // Phase 2: auto-enable infrastructure mechanics (no configSchema) whose
    // requires are all satisfied. Iterate until no new mechanics are added.
    let changed = true;
    while (changed) {
      changed = false;
      for (const m of all) {
        if (enabledSlugs.has(m.slug)) continue;
        if (m.configSchema) continue; // leaf mechanics need explicit config
        const requires = getMechanicRequires(m);
        if (requires.length > 0 && requires.every(dep => enabledSlugs.has(dep))) {
          enabledSlugs.add(m.slug);
          changed = true;
        }
      }
    }

    return all.filter(m => enabledSlugs.has(m.slug));
  }

  /**
   * Get highlights for a mechanic given its config from RULES.md.
   * Returns array of { label, value } or null.
   */
  getHighlights(slug: string, config: unknown): { label: string; value: string }[] | null {
    const mechanic = this.mechanics.get(slug);
    if (!mechanic?.getHighlight) return null;
    return mechanic.getHighlight(config);
  }

  /**
   * Get a specific mechanic by slug
   */
  getMechanic(slug: string): MechanicHooks | undefined {
    return this.mechanics.get(slug);
  }

  /**
   * Validate mechanic requirements and conflicts for a game config.
   * Returns array of validation errors, empty if valid.
   */
  validateDependencies(config: GameConfig): MechanicValidationError[] {
    const enabled = this.getEnabledMechanics(config);
    const enabledSlugs = new Set(enabled.map(m => m.slug));
    const errors: MechanicValidationError[] = [];

    for (const mechanic of enabled) {
      // Check requirements (supports both `requires` and legacy `dependencies`)
      const requires = getMechanicRequires(mechanic);
      for (const dep of requires) {
        if (!enabledSlugs.has(dep)) {
          errors.push({
            mechanic: mechanic.slug,
            type: 'missing_dependency',
            message: `Mechanic '${mechanic.slug}' requires '${dep}' but it is not enabled`
          });
        }
      }

      // Check conflicts
      if (mechanic.conflicts) {
        for (const conflict of mechanic.conflicts) {
          if (enabledSlugs.has(conflict)) {
            errors.push({
              mechanic: mechanic.slug,
              type: 'conflict',
              message: `Mechanic '${mechanic.slug}' conflicts with '${conflict}' which is also enabled`
            });
          }
        }
      }
    }

    return errors;
  }

  /**
   * Get metadata for all registered mechanics (for export/documentation)
   */
  getAllMechanicsMetadata(): MechanicMetadata[] {
    const result: MechanicMetadata[] = [];

    for (const mechanic of this.mechanics.values()) {
      // Derive config key from slug (e.g., 'action-points' -> 'action_points')
      const configKey = mechanic.slug.replace(/-/g, '_');

      // Collect which hooks are implemented
      const hooks: string[] = [];
      const hookNames = [
        'preValidateAction', 'postExecuteAction', 'shouldAutoEndTurn',
        'initPlayerState', 'onTurnStart', 'onTurnEnd', 'onCheckWin',
        'onExecuteAction', 'getAvailableActions', 'describeAction',
        'getVisibleState', 'canSeeInfo',
        'onDetermineTurnOrder', 'onPassPriority',
        // Agnosticism hooks
        'initSharedState', 'getPlayerView', 'applyEffect',
        'isPlayerBlocked', 'canPlayerActNow', 'getActionSchema', 'reverseAction'
      ];

      for (const hookName of hookNames) {
        if (hookName in mechanic && (mechanic as unknown as Record<string, unknown>)[hookName] !== undefined) {
          hooks.push(hookName);
        }
      }

      const requires = getMechanicRequires(mechanic);
      result.push({
        slug: mechanic.slug,
        name: mechanic.name,
        configKey,
        description: mechanic.configSchema?.description,
        configSchema: mechanic.configSchema,
        requires: requires.length > 0 ? requires : undefined,
        conflicts: mechanic.conflicts,
        defines: mechanic.defines,
        hooks,
        hasHighlight: typeof mechanic.getHighlight === 'function' ? true : undefined,
      });
    }

    return result.sort((a, b) => a.slug.localeCompare(b.slug));
  }

  /**
   * Create hook context from game state
   */
  private createContext(state: GameState, playerId: string): HookContext {
    const player = state.players[playerId];
    if (!player) {
      throw new Error(`Player ${playerId} not found in state`);
    }
    return {
      state,
      playerId,
      player,
      config: state.config
    };
  }

  /**
   * Run preValidateAction hooks for all enabled mechanics.
   * Returns first validation failure, or { valid: true } if all pass.
   */
  preValidateAction(state: GameState, playerId: string, action: GameAction): ValidationResult {
    const telemetryEnabled = state.config.engine_debug?.hook_telemetry;
    const startTime = telemetryEnabled ? performance.now() : 0;

    const ctx = this.createContext(state, playerId);
    const enabledMechanics = this.getEnabledMechanics(state.config);
    const respondingMechanics: string[] = [];
    let finalResult: ValidationResult = { valid: true };

    for (const mechanic of enabledMechanics) {
      if (mechanic.preValidateAction) {
        const mechanicStart = telemetryEnabled ? performance.now() : 0;
        const result = mechanic.preValidateAction(ctx, action);

        if (result) {
          respondingMechanics.push(mechanic.slug);

          if (telemetryEnabled) {
            logEvent(state, {
              event: 'mechanic_response',
              player: playerId,
              data: {
                mechanic: mechanic.slug,
                hook: 'preValidateAction',
                response_type: result.valid ? 'allowed' : 'blocked',
                duration_ms: performance.now() - mechanicStart,
                response_data: result
              }
            });
          }

          if (!result.valid) {
            finalResult = result;
            break;
          }
        }
      }
    }

    // Only log telemetry if mechanics are enabled (avoid noise from 0/0 mechanics)
    if (telemetryEnabled && enabledMechanics.length > 0) {
      logEvent(state, {
        event: 'hook_invoked',
        player: playerId,
        data: {
          hook: 'preValidateAction',
          action_type: action.type,
          enabled_mechanics: enabledMechanics.map(m => m.slug),
          responding_mechanics: respondingMechanics,
          duration_ms: performance.now() - startTime,
          result: finalResult.valid ? 'allowed' : 'blocked'
        }
      });
    }

    return finalResult;
  }

  /**
   * Run postExecuteAction hooks for all enabled mechanics.
   * Collects and merges all state changes.
   */
  postExecuteAction(state: GameState, playerId: string, action: GameAction): StateChanges {
    const ctx = this.createContext(state, playerId);
    const enabledMechanics = this.getEnabledMechanics(state.config);
    const mergedChanges: StateChanges = {};

    for (const mechanic of enabledMechanics) {
      if (mechanic.postExecuteAction) {
        const changes = mechanic.postExecuteAction(ctx, action);
        if (changes) {
          // Merge player state changes
          if (changes.playerStateChanges) {
            mergedChanges.playerStateChanges = mergedChanges.playerStateChanges || {};
            for (const [pid, pchanges] of Object.entries(changes.playerStateChanges)) {
              mergedChanges.playerStateChanges[pid] = {
                ...mergedChanges.playerStateChanges[pid],
                ...pchanges
              };
            }
          }
          // Merge shared state changes
          if (changes.sharedStateChanges) {
            mergedChanges.sharedStateChanges = {
              ...mergedChanges.sharedStateChanges,
              ...changes.sharedStateChanges
            };
          }
        }
      }
    }

    return mergedChanges;
  }

  /**
   * Check if any enabled mechanic wants to auto-end turn.
   */
  shouldAutoEndTurn(state: GameState, playerId: string): boolean {
    const ctx = this.createContext(state, playerId);
    const enabledMechanics = this.getEnabledMechanics(state.config);

    for (const mechanic of enabledMechanics) {
      if (mechanic.shouldAutoEndTurn) {
        if (mechanic.shouldAutoEndTurn(ctx)) {
          return true;
        }
      }
    }

    return false;
  }

  /**
   * Collect player state from all enabled mechanics during registration.
   * Passes existing players for cross-player coordination (e.g., unique power assignment).
   * Passes shared state for cross-mechanic coordination (e.g., cards mechanic pre-dealt hands).
   */
  initPlayerState(
    config: GameConfig,
    playerId: string,
    playerIndex: number,
    existingPlayers: Record<string, Partial<PlayerState>>,
    shared?: Record<string, unknown>
  ): PlayerInitResult {
    const enabledMechanics = this.getEnabledMechanics(config);
    const merged: PlayerInitResult = {};

    const ctx: PlayerInitContext = {
      config,
      playerId,
      playerIndex,
      existingPlayers,
      shared
    };

    for (const mechanic of enabledMechanics) {
      if (mechanic.initPlayerState) {
        const result = mechanic.initPlayerState(ctx);
        if (result) {
          Object.assign(merged, result);
        }
      }
    }

    return merged;
  }

  /**
   * Run onTurnStart hooks for all enabled mechanics.
   */
  onTurnStart(state: GameState, playerId: string, isNewRound: boolean = false): StateChanges {
    const baseCtx = this.createContext(state, playerId);
    const ctx: TurnStartContext = { ...baseCtx, isNewRound };
    const enabledMechanics = this.getEnabledMechanics(state.config);
    const mergedChanges: StateChanges = {};

    for (const mechanic of enabledMechanics) {
      if (mechanic.onTurnStart) {
        const changes = mechanic.onTurnStart(ctx);
        if (changes) {
          if (changes.playerStateChanges) {
            mergedChanges.playerStateChanges = mergedChanges.playerStateChanges || {};
            for (const [pid, pchanges] of Object.entries(changes.playerStateChanges)) {
              mergedChanges.playerStateChanges[pid] = {
                ...mergedChanges.playerStateChanges[pid],
                ...pchanges
              };
            }
          }
          if (changes.sharedStateChanges) {
            mergedChanges.sharedStateChanges = {
              ...mergedChanges.sharedStateChanges,
              ...changes.sharedStateChanges
            };
          }
        }
      }
    }

    return mergedChanges;
  }

  /**
   * Run onTurnEnd hooks for all enabled mechanics.
   */
  onTurnEnd(state: GameState, playerId: string, nextPlayerId: string, isRoundEnd: boolean = false): StateChanges {
    const baseCtx = this.createContext(state, playerId);
    const ctx: TurnEndContext = { ...baseCtx, nextPlayerId, isRoundEnd };
    const enabledMechanics = this.getEnabledMechanics(state.config);
    const mergedChanges: StateChanges = {};

    for (const mechanic of enabledMechanics) {
      if (mechanic.onTurnEnd) {
        const changes = mechanic.onTurnEnd(ctx);
        if (changes) {
          this.mergeStateChanges(mergedChanges, changes);
        }
      }
    }

    return mergedChanges;
  }

  /**
   * Run onCheckWin hooks for a specific player.
   * Returns first winning result, or null if no win.
   */
  onCheckWin(state: GameState, playerId: string, trigger: string): WinCheckResult | null {
    const baseCtx = this.createContext(state, playerId);
    const ctx: WinCheckContext = { ...baseCtx, trigger };
    const enabledMechanics = this.getEnabledMechanics(state.config);

    for (const mechanic of enabledMechanics) {
      if (mechanic.onCheckWin) {
        const result = mechanic.onCheckWin(ctx);
        if (result?.won) {
          return result;
        }
      }
    }

    return null;
  }

  /**
   * Check win conditions for all active players.
   * Returns { playerId, reason } of first winner, or null.
   */
  checkAllWinConditions(state: GameState, trigger: string): { playerId: string; reason: string } | null {
    const activePlayers = Object.entries(state.players)
      .filter(([_, p]) => p.state !== 'eliminated' && !p.effects?.some(e => e.type === 'eliminated'));

    for (const [playerId] of activePlayers) {
      const result = this.onCheckWin(state, playerId, trigger);
      if (result?.won) {
        return { playerId, reason: result.reason || 'Win condition met' };
      }
    }

    return null;
  }

  // ============ Action Execution & Registration ============

  /**
   * Execute an action through mechanics.
   * Returns the first mechanic's result that handles the action, or null.
   */
  executeAction(state: GameState, playerId: string, action: GameAction): ActionExecutionResult | null {
    const telemetryEnabled = state.config.engine_debug?.hook_telemetry;
    const startTime = telemetryEnabled ? performance.now() : 0;

    const baseCtx = this.createContext(state, playerId);
    const ctx: ActionExecutionContext = { ...baseCtx, action };
    const enabledMechanics = this.getEnabledMechanics(state.config);
    const respondingMechanics: string[] = [];
    let handlerResult: ActionExecutionResult | null = null;

    for (const mechanic of enabledMechanics) {
      if (mechanic.onExecuteAction) {
        const mechanicStart = telemetryEnabled ? performance.now() : 0;
        const result = mechanic.onExecuteAction(ctx);

        if (result) {
          respondingMechanics.push(mechanic.slug);

          if (telemetryEnabled && result.handled) {
            logEvent(state, {
              event: 'mechanic_response',
              player: playerId,
              data: {
                mechanic: mechanic.slug,
                hook: 'onExecuteAction',
                response_type: 'state_changes',
                duration_ms: performance.now() - mechanicStart,
                response_data: { handled: true, advanceTurn: result.advanceTurn, checkWin: result.checkWin }
              }
            });
          }

          if (result.handled) {
            handlerResult = result;
            break;
          }
        }
      }
    }

    // Only log telemetry if mechanics are enabled (avoid noise from 0/0 mechanics)
    if (telemetryEnabled && enabledMechanics.length > 0) {
      logEvent(state, {
        event: 'hook_invoked',
        player: playerId,
        data: {
          hook: 'onExecuteAction',
          action_type: action.type,
          enabled_mechanics: enabledMechanics.map(m => m.slug),
          responding_mechanics: respondingMechanics,
          duration_ms: performance.now() - startTime,
          result: handlerResult ? 'modified' : 'no_response'
        }
      });
    }

    return handlerResult;
  }

  /**
   * Collect available actions from all enabled mechanics.
   * Returns actions sorted by priority (highest first).
   */
  getAvailableActions(state: GameState, playerId: string): AvailableAction[] {
    const ctx = this.createContext(state, playerId);
    const enabledMechanics = this.getEnabledMechanics(state.config);
    const actions: AvailableAction[] = [];

    for (const mechanic of enabledMechanics) {
      if (mechanic.getAvailableActions) {
        const mechanicActions = mechanic.getAvailableActions(ctx);
        actions.push(...mechanicActions);
      }
    }

    // Post-process: apply filterPlayableCards to play_card actions
    for (const action of actions) {
      if (action.action.type === 'play_card' && action.cards && action.cards.length > 0) {
        const player = state.players[playerId];
        const hand = (player?.hand ?? []) as Card[];
        const cardObjects = hand.filter((c: Card) => action.cards!.includes(c.name));
        const filtered = this.filterPlayableCards(state, playerId, cardObjects);
        action.cards = filtered.map((c: Card) => c.name);
      }
    }

    // Sort by priority (higher first), then by type
    return actions.sort((a, b) => {
      const priorityDiff = (b.priority ?? 0) - (a.priority ?? 0);
      if (priorityDiff !== 0) return priorityDiff;
      return a.action.type.localeCompare(b.action.type);
    });
  }

  /**
   * Filter playable cards through cards-domain mechanics.
   * Routes to mechanics that declare `requires: ['cards']` and implement filterPlayableCards.
   * Returns the filtered card list (may be smaller than input).
   */
  filterPlayableCards(state: GameState, playerId: string, cards: Card[]): Card[] {
    const ctx = this.createContext(state, playerId);

    // Route only to enabled mechanics that require 'cards' (cards-domain dependents)
    const dependents = this.getEnabledMechanics(state.config)
      .filter(m => getMechanicRequires(m).includes('cards'));

    let filtered = cards;
    for (const dep of dependents) {
      const handler = (dep as Record<string, unknown>)['filterPlayableCards'];
      if (typeof handler === 'function') {
        const result = handler.call(dep, ctx, { cards: filtered });
        if (result !== null && Array.isArray(result)) {
          filtered = result;
        }
      }
    }

    return filtered;
  }

  /**
   * Get description for an action from the owning mechanic.
   */
  describeAction(state: GameState, action: GameAction): ActionDescription | null {
    const enabledMechanics = this.getEnabledMechanics(state.config);

    for (const mechanic of enabledMechanics) {
      if (mechanic.describeAction) {
        const description = mechanic.describeAction(action);
        if (description) {
          return description;
        }
      }
    }

    return null;
  }

  // ============ Visibility System Hook Routing ============

  /**
   * Run getVisibleState hooks. Returns merged visible state.
   * Mechanics can filter what a viewer can see about game state.
   */
  getVisibleState(state: GameState, viewerPlayerId: string): VisibleState {
    const ctx: VisibilityContext = {
      state,
      viewerPlayerId,
      config: state.config
    };
    const enabledMechanics = this.getEnabledMechanics(state.config);
    const mergedVisible: VisibleState = {};

    for (const mechanic of enabledMechanics) {
      if (mechanic.getVisibleState) {
        const result = mechanic.getVisibleState(ctx);
        if (result) {
          // Merge visibility results (more restrictive wins)
          if (result.players) {
            mergedVisible.players = mergedVisible.players || {};
            for (const [pid, pstate] of Object.entries(result.players)) {
              mergedVisible.players[pid] = {
                ...mergedVisible.players[pid],
                ...pstate
              };
            }
          }
          if (result.shared) {
            mergedVisible.shared = {
              ...mergedVisible.shared,
              ...result.shared
            };
          }
          if (result.visibilityMeta) {
            mergedVisible.visibilityMeta = {
              ...mergedVisible.visibilityMeta,
              ...result.visibilityMeta
            };
          }
        }
      }
    }

    return mergedVisible;
  }

  /**
   * Check if a player can see specific information.
   * Returns true if any mechanic grants visibility, false if any denies.
   * Returns undefined if no mechanics have an opinion (default: visible).
   */
  canSeeInfo(
    state: GameState,
    viewerPlayerId: string,
    infoType: string,
    targetPlayerId?: string
  ): boolean | undefined {
    const ctx: VisibilityContext = {
      state,
      viewerPlayerId,
      config: state.config
    };
    const enabledMechanics = this.getEnabledMechanics(state.config);

    let hasOpinion = false;
    let anyDenied = false;

    for (const mechanic of enabledMechanics) {
      if (mechanic.canSeeInfo) {
        const result = mechanic.canSeeInfo(ctx, infoType, targetPlayerId);
        if (result !== undefined) {
          hasOpinion = true;
          if (result === false) {
            anyDenied = true;
          }
        }
      }
    }

    if (!hasOpinion) return undefined;
    return !anyDenied;
  }

  // ============ Dynamic Turn Order Hook Routing ============

  /**
   * Run onDetermineTurnOrder hooks. Returns new turn order if any mechanic provides one.
   * First mechanic to return a non-null order wins.
   */
  onDetermineTurnOrder(
    state: GameState,
    reason: 'round_start' | 'mid_round' | 'claim' | 'pass'
  ): TurnOrderResult | null {
    const ctx: TurnOrderContext = {
      state,
      config: state.config,
      currentOrder: state.turnOrder,
      reason
    };
    const enabledMechanics = this.getEnabledMechanics(state.config);

    for (const mechanic of enabledMechanics) {
      if (mechanic.onDetermineTurnOrder) {
        const result = mechanic.onDetermineTurnOrder(ctx);
        if (result?.order) {
          return result;
        }
      }
    }

    return null;
  }

  /**
   * Run onPassPriority hooks. Returns next player or removal instruction.
   * First mechanic to return a result wins.
   */
  onPassPriority(state: GameState, playerId: string): PassPriorityResult | null {
    const ctx: HookContext = {
      state,
      playerId,
      player: state.players[playerId],
      config: state.config
    };
    const enabledMechanics = this.getEnabledMechanics(state.config);

    for (const mechanic of enabledMechanics) {
      if (mechanic.onPassPriority) {
        const result = mechanic.onPassPriority(ctx);
        if (result) {
          return result;
        }
      }
    }

    return null;
  }

  // ============ Agnosticism Hooks (game.ts decoupling) ============

  /**
   * Initialize shared state from all mechanics.
   * Each mechanic contributes its own shared state properties.
   * Returns merged result from all mechanics.
   */
  initSharedState(
    config: GameConfig,
    deck: Card[],
    playerIds: string[],
    shared: Record<string, unknown> = {}
  ): SharedStateInitResult {
    const ctx: SharedStateInitContext = {
      config,
      deck,
      playerIds,
      shared
    };

    const result: SharedStateInitResult = {};

    // Call all registered mechanics (not just enabled - some may need to initialize)
    for (const mechanic of this.mechanics.values()) {
      if (mechanic.initSharedState) {
        const mechanicResult = mechanic.initSharedState(ctx);
        if (mechanicResult) {
          Object.assign(result, mechanicResult);
        }
      }
    }

    return result;
  }

  /**
   * Get mechanic-contributed properties for player view.
   * Each mechanic adds its own view properties.
   */
  getPlayerView(state: GameState, playerId: string): Record<string, unknown> {
    const ctx: HookContext = {
      state,
      playerId,
      player: state.players[playerId],
      config: state.config
    };

    const result: Record<string, unknown> = {};
    const enabledMechanics = this.getEnabledMechanics(state.config);

    for (const mechanic of enabledMechanics) {
      if (mechanic.getPlayerView) {
        const mechanicResult = mechanic.getPlayerView(ctx);
        if (mechanicResult) {
          Object.assign(result, mechanicResult);
        }
      }
    }

    return result;
  }

  /**
   * Apply an effect using mechanic handlers.
   * First mechanic to return { handled: true } wins.
   * Returns null if no mechanic handles the effect type.
   */
  applyEffect(
    state: GameState,
    playerId: string,
    effect: Effect,
    targetPlayerId?: string
  ): EffectApplicationResult | null {
    const ctx: EffectApplicationContext = {
      state,
      playerId,
      effect,
      targetPlayerId,
      config: state.config
    };

    const enabledMechanics = this.getEnabledMechanics(state.config);

    for (const mechanic of enabledMechanics) {
      if (mechanic.applyEffect) {
        const result = mechanic.applyEffect(ctx);
        if (result?.handled) {
          return result;
        }
      }
    }

    return null;
  }

  /**
   * Check if a player is blocked from taking actions.
   * Any mechanic returning true blocks the player.
   * Returns false if no mechanic indicates blocked.
   */
  isPlayerBlocked(state: GameState, playerId: string): boolean {
    const ctx: HookContext = {
      state,
      playerId,
      player: state.players[playerId],
      config: state.config
    };

    const enabledMechanics = this.getEnabledMechanics(state.config);

    for (const mechanic of enabledMechanics) {
      if (mechanic.isPlayerBlocked) {
        const result = mechanic.isPlayerBlocked(ctx);
        if (result === true) {
          return true;
        }
      }
    }

    return false;
  }

  /**
   * Check if a player can act now (even if not their turn).
   * Used by mechanics like freeplay that allow parallel/out-of-turn actions.
   * Returns true if any mechanic allows out-of-turn action.
   * Returns false if no mechanics grant this ability.
   */
  canPlayerActNow(state: GameState, playerId: string): boolean {
    const ctx: HookContext = {
      state,
      playerId,
      player: state.players[playerId],
      config: state.config
    };

    const enabledMechanics = this.getEnabledMechanics(state.config);

    for (const mechanic of enabledMechanics) {
      if (mechanic.canPlayerActNow) {
        const result = mechanic.canPlayerActNow(ctx);
        if (result === true) {
          return true;
        }
      }
    }

    return false;
  }

  /**
   * Reverse a previously executed action through mechanics.
   * First mechanic to return true wins (handled).
   * Returns true if a mechanic handled the reversal, false otherwise.
   * Note: The engine handles reverseTurn/saveState — mechanics only undo state changes.
   */
  reverseAction(state: GameState, playerId: string, action: GameAction): boolean {
    const ctx = this.createContext(state, playerId);
    const enabledMechanics = this.getEnabledMechanics(state.config);

    for (const mechanic of enabledMechanics) {
      if (mechanic.reverseAction) {
        const result = mechanic.reverseAction(ctx, action);
        if (result === true) {
          return true;
        }
      }
    }

    return false;
  }

  /**
   * Get action schema from mechanics.
   * First mechanic to return a schema for the action wins.
   */
  getActionSchema(state: GameState, action: GameAction): ActionSchema | null {
    const enabledMechanics = this.getEnabledMechanics(state.config);

    for (const mechanic of enabledMechanics) {
      if (mechanic.getActionSchema) {
        const schema = mechanic.getActionSchema(action);
        if (schema) {
          return schema;
        }
      }
    }

    return null;
  }

  // ============ Mechanic-Defined Hook Routing ============

  /**
   * Fire a hook defined by a mechanic via its `defines` property.
   * Routes ONLY to enabled mechanics that declare `requires` on the definer.
   *
   * @param definerSlug - Slug of the mechanic that defines the hook
   * @param hookName - Name of the hook method to call
   * @param state - Current game state
   * @param playerId - Player context for the hook
   * @param payload - Hook-specific data passed as second argument
   * @returns Merged state changes from all implementers, or null
   */
  fire(
    definerSlug: string,
    hookName: string,
    state: GameState,
    playerId: string,
    payload?: unknown
  ): StateChanges | null {
    const definer = this.mechanics.get(definerSlug);
    if (!definer?.defines?.[hookName]) {
      return null;
    }

    const resolution = definer.defines[hookName].resolution ?? 'merge';
    const ctx = this.createContext(state, playerId);

    // Route only to enabled mechanics that require the definer
    const dependents = this.getEnabledMechanics(state.config)
      .filter(m => getMechanicRequires(m).includes(definerSlug));

    const telemetryEnabled = state.config.engine_debug?.hook_telemetry;
    const startTime = telemetryEnabled ? performance.now() : 0;
    const respondingMechanics: string[] = [];
    const mergedChanges: StateChanges = {};

    for (const dep of dependents) {
      const handler = (dep as Record<string, unknown>)[hookName];
      if (typeof handler !== 'function') continue;

      const mechanicStart = telemetryEnabled ? performance.now() : 0;
      const result = handler.call(dep, ctx, payload);

      if (result) {
        respondingMechanics.push(dep.slug);

        if (telemetryEnabled) {
          logEvent(state, {
            event: 'mechanic_response',
            player: playerId,
            data: {
              mechanic: dep.slug,
              hook: `${definerSlug}:${hookName}`,
              response_type: result.blocked ? 'blocked' : 'state_changes',
              duration_ms: performance.now() - mechanicStart,
            }
          });
        }

        // Handle resolution strategies
        if (resolution === 'blocking' && result.blocked) {
          return result; // Short-circuit
        }
        if (resolution === 'first') {
          return result; // First responder wins
        }
        // 'merge' - accumulate
        this.mergeStateChanges(mergedChanges, result);
      }
    }

    if (telemetryEnabled && dependents.length > 0) {
      logEvent(state, {
        event: 'hook_invoked',
        player: playerId,
        data: {
          hook: `${definerSlug}:${hookName}`,
          enabled_dependents: dependents.map(m => m.slug),
          responding_mechanics: respondingMechanics,
          duration_ms: performance.now() - startTime,
        }
      });
    }

    // Return null if no mechanics responded, otherwise return merged changes
    if (respondingMechanics.length === 0) return null;
    return mergedChanges;
  }

  /**
   * Helper to merge state changes
   */
  private mergeStateChanges(target: StateChanges, source: StateChanges): void {
    if (source.playerStateChanges) {
      target.playerStateChanges = target.playerStateChanges || {};
      for (const [pid, pchanges] of Object.entries(source.playerStateChanges)) {
        target.playerStateChanges[pid] = {
          ...target.playerStateChanges[pid],
          ...pchanges
        };
      }
    }
    if (source.sharedStateChanges) {
      target.sharedStateChanges = {
        ...target.sharedStateChanges,
        ...source.sharedStateChanges
      };
    }
  }
}

/**
 * Get all registered mechanics as metadata for export.
 * Used by scripts to generate shared/registered-mechanics.json
 */
export function getRegisteredMechanicsMetadata(): MechanicMetadata[] {
  return mechanicRegistry.getAllMechanicsMetadata();
}

// Singleton registry instance
export const mechanicRegistry = new MechanicRegistry();

// Install dependency resolver so isMechanicEnabled can resolve mechanics
// enabled via dependency chains (e.g., cards enabled because card-matching requires it)
mechanicRegistry.installDependencyResolver();

/**
 * Apply state changes to game state (mutates state)
 */
export function applyStateChanges(state: GameState, changes: StateChanges): void {
  if (changes.playerStateChanges) {
    for (const [playerId, playerChanges] of Object.entries(changes.playerStateChanges)) {
      if (state.players[playerId]) {
        Object.assign(state.players[playerId], playerChanges);
      }
    }
  }
  if (changes.sharedStateChanges) {
    state.shared = { ...state.shared, ...changes.sharedStateChanges };
  }
}
