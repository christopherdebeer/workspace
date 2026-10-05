/**
 * Simultaneous Action Selection Mechanic
 *
 * All players secretly select actions, then reveal and resolve simultaneously.
 * Common in games like RoboRally, Diplomacy, 7 Wonders.
 *
 * Config:
 *   simultaneous_action_selection:
 *     resolution_order: 'random' | 'clockwise' | 'priority'
 *     actions_per_round: number      # Actions selected per round
 *     reveal_before_resolve: boolean # Show all choices before resolving
 */

import { MechanicHooks, HookContext, ValidationResult, ActionExecutionContext, ActionExecutionResult, AvailableAction, StateChanges, SharedStateInitContext, SharedStateInitResult, TurnStartContext, VisibilityContext, VisibleState } from './types';
import { GameAction, GameConfig } from '../types/game';

interface SimultaneousActionConfig {
  resolution_order?: 'random' | 'clockwise' | 'priority';
  actions_per_round?: number;
  reveal_before_resolve?: boolean;
}

interface SimultaneousSelectionState {
  phase: 'selecting' | 'revealing' | 'resolving' | 'idle';
  selections: Record<string, unknown>;  // playerId -> selected action (hidden)
  revealed: Record<string, unknown>;    // playerId -> revealed action
  round: number;
  allSelected: boolean;
}

function getConfig(config: GameConfig): SimultaneousActionConfig | undefined {
  return config.engine_mechanics?.simultaneous_action_selection as SimultaneousActionConfig | undefined;
}

export const simultaneousActionSelectionMechanic: MechanicHooks = {
  slug: 'simultaneous-action-selection',
  name: 'Simultaneous Action Selection',

  configSchema: {
    type: 'object',
    description: 'All players select actions simultaneously',
    properties: {
      resolution_order: {
        type: 'string',
        description: 'How to resolve simultaneous actions',
        default: 'clockwise'
      },
      actions_per_round: {
        type: 'number',
        description: 'Actions selected per round',
        default: 1
      },
      reveal_before_resolve: {
        type: 'boolean',
        description: 'Reveal all selections before resolving',
        default: true
      }
    }
  },

  initSharedState(ctx: SharedStateInitContext): SharedStateInitResult | null {
    const config = getConfig(ctx.config);
    if (!config) return null;

    const selectionState: SimultaneousSelectionState = {
      phase: 'selecting',
      selections: {},
      revealed: {},
      round: 0,
      allSelected: false
    };

    return { simultaneousSelection: selectionState };
  },

  onTurnStart(ctx: TurnStartContext): StateChanges | null {
    const config = getConfig(ctx.config);
    if (!config) return null;

    if (!ctx.isNewRound) return null;

    // Reset selection state at start of each round
    const selectionState: SimultaneousSelectionState = {
      phase: 'selecting',
      selections: {},
      revealed: {},
      round: ctx.state.round,
      allSelected: false
    };

    return {
      sharedStateChanges: { simultaneousSelection: selectionState }
    };
  },

  preValidateAction(ctx: HookContext, action: GameAction): ValidationResult | null {
    if (action.type !== 'select_action') return null;

    const config = getConfig(ctx.config);
    if (!config) return { valid: false, error: 'Simultaneous action selection not enabled.' };

    const selState = ctx.state.shared.simultaneousSelection as SimultaneousSelectionState | undefined;
    if (!selState || selState.phase !== 'selecting') {
      return { valid: false, error: 'Not in selection phase.' };
    }

    const selectAction = action as unknown as { type: 'select_action'; selectedAction: Record<string, unknown> };
    if (!selectAction.selectedAction) {
      return { valid: false, error: 'Must specify selectedAction.' };
    }

    // Check if already selected
    if (selState.selections[ctx.playerId]) {
      return { valid: false, error: 'You have already selected an action this round.' };
    }

    return { valid: true };
  },

  onExecuteAction(ctx: ActionExecutionContext): ActionExecutionResult | null {
    if (ctx.action.type !== 'select_action') return null;

    const config = getConfig(ctx.config);
    if (!config) return null;

    const selectAction = ctx.action as unknown as { type: 'select_action'; selectedAction: Record<string, unknown> };
    const selState = { ...(ctx.state.shared.simultaneousSelection as SimultaneousSelectionState) };

    // Record selection (hidden from other players)
    selState.selections = { ...selState.selections, [ctx.playerId]: selectAction.selectedAction };

    // Check if all players have selected
    const allPlayers = Object.keys(ctx.state.players);
    const allSelected = allPlayers.every(p => selState.selections[p] !== undefined);

    if (allSelected) {
      selState.allSelected = true;
      if (config.reveal_before_resolve !== false) {
        selState.phase = 'revealing';
        selState.revealed = { ...selState.selections };
      } else {
        selState.phase = 'resolving';
      }

      // Resolve action effects for all players
      const resolvedMessages: string[] = [];
      for (const [pid, selectedAction] of Object.entries(selState.selections)) {
        // Normalize action name from various formats: "Scheme", {type: "Scheme"}, {action: "Scheme"}
        const actionName = ((): string => {
          if (typeof selectedAction === 'string') return selectedAction.toLowerCase();
          if (typeof selectedAction === 'object' && selectedAction !== null) {
            const obj = selectedAction as Record<string, unknown>;
            if (typeof obj.type === 'string') return obj.type.toLowerCase();
            if (typeof obj.action === 'string') return obj.action.toLowerCase();
          }
          return String(selectedAction).toLowerCase();
        })();
        const player = ctx.state.players[pid];
        if (!player || !player.resources) continue;

        const resources = player.resources;
        const goldMax = (ctx.config.engine_mechanics?.resources as unknown as Array<{name: string; max: number}>)
          ?.find((r: {name: string}) => r.name === 'gold')?.max ?? 30;
        const influenceMax = (ctx.config.engine_mechanics?.resources as unknown as Array<{name: string; max: number}>)
          ?.find((r: {name: string}) => r.name === 'influence')?.max ?? 15;

        switch (actionName) {
          case 'scheme':
            resources.gold = Math.min((resources.gold || 0) + 2, goldMax);
            resolvedMessages.push(`${pid}: Scheme (+2 gold)`);
            break;
          case 'fortify':
            resources.influence = Math.min((resources.influence || 0) + 2, influenceMax);
            resolvedMessages.push(`${pid}: Fortify (+2 influence)`);
            break;
          case 'subvert': {
            const coopState = ctx.state.shared.semiCooperative as { collectiveProgress: number } | undefined;
            if (coopState && coopState.collectiveProgress >= 2) {
              coopState.collectiveProgress -= 2;
              resources.gold = Math.min((resources.gold || 0) + 2, goldMax);
              resolvedMessages.push(`${pid}: Subvert (stole 2 gold from treasury)`);
            } else {
              resolvedMessages.push(`${pid}: Subvert (treasury too low, failed)`);
            }
            break;
          }
          case 'investigate':
            resolvedMessages.push(`${pid}: Investigate`);
            break;
          default:
            resolvedMessages.push(`${pid}: ${selectedAction}`);
            break;
        }
      }

      // Transition to idle after resolution
      selState.phase = 'idle';
    }

    return {
      handled: true,
      stateChanges: {
        sharedStateChanges: { simultaneousSelection: selState }
      },
      advanceTurn: true, // Always advance turn after selection (resolution happens inline)
      checkWin: false,
      logMessage: allSelected
        ? `All players have selected their actions. ${config.reveal_before_resolve !== false ? 'Revealing...' : 'Resolving...'}`
        : `${ctx.playerId} has selected an action (${Object.keys(selState.selections).length}/${allPlayers.length}).`
    };
  },

  canPlayerActNow(ctx: HookContext): boolean | null {
    const config = getConfig(ctx.config);
    if (!config) return null;

    const selState = ctx.state.shared.simultaneousSelection as SimultaneousSelectionState | undefined;
    if (!selState || selState.phase !== 'selecting') return null;

    // During selection phase, any player who hasn't selected can act
    if (!selState.selections[ctx.playerId]) {
      return true;
    }

    return null;
  },

  getAvailableActions(ctx: HookContext): AvailableAction[] {
    const config = getConfig(ctx.config);
    if (!config) return [];

    const selState = ctx.state.shared.simultaneousSelection as SimultaneousSelectionState | undefined;
    if (!selState || selState.phase !== 'selecting') return [];
    if (selState.selections[ctx.playerId]) return []; // Already selected

    return [{
      action: {
        type: 'select_action',
        selectedAction: {}
      } as unknown as GameAction,
      priority: 95,
      category: 'simultaneous'
    }];
  },

  getPlayerView(ctx: HookContext): Record<string, unknown> | null {
    const config = getConfig(ctx.config);
    if (!config) return null;

    const selState = ctx.state.shared.simultaneousSelection as SimultaneousSelectionState | undefined;
    if (!selState) return null;

    const allPlayers = Object.keys(ctx.state.players);
    const selectedCount = Object.keys(selState.selections).length;

    return {
      simultaneousPhase: selState.phase,
      hasSelected: !!selState.selections[ctx.playerId],
      selectedCount,
      totalPlayers: allPlayers.length,
      revealedActions: selState.phase === 'revealing' || selState.phase === 'resolving'
        ? selState.revealed
        : undefined
    };
  },

  getVisibleState(ctx: VisibilityContext): VisibleState | null {
    const config = getConfig(ctx.config);
    if (!config) return null;

    const selState = ctx.state.shared.simultaneousSelection as SimultaneousSelectionState | undefined;
    if (!selState || selState.phase !== 'selecting') return null;

    // During selection phase, redact other players' selections from shared state
    // Each player should only see their own selection
    const redactedSelections: Record<string, unknown> = {};
    if (selState.selections[ctx.viewerPlayerId]) {
      redactedSelections[ctx.viewerPlayerId] = selState.selections[ctx.viewerPlayerId];
    }

    return {
      shared: {
        simultaneousSelection: {
          ...selState,
          selections: redactedSelections
        }
      }
    };
  },

  describeAction(action: GameAction): { type: string; label: string; description: string; examples?: string[] } | null {
    if (action.type === 'select_action') {
      return {
        type: 'select_action',
        label: 'Select Action',
        description: 'Secretly select an action for simultaneous resolution.',
        examples: ['select_action selectedAction:{ type: "move", target: "north" }']
      };
    }
    return null;
  }
};
