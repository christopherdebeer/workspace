/**
 * Action Drafting Mechanic
 *
 * Players take turns selecting actions/roles from a common pool.
 * Selected actions may grant unique abilities or bonuses for the round.
 * Examples: Puerto Rico (role selection), Citadels (character drafting)
 *
 * Hooks used:
 * - initSharedState: Create action pool
 * - getAvailableActions: Expose 'select_action' when in drafting phase
 * - onExecuteAction: Handle action selection
 * - onTurnStart: Reset action pool at round start
 * - getPlayerView: Show available actions and selections
 */

import {
  MechanicHooks,
  HookContext,
  AvailableAction,
  ActionExecutionContext,
  ActionExecutionResult,
  TurnStartContext,
  StateChanges,
  SharedStateInitContext,
  SharedStateInitResult,
  PlayerInitContext,
  PlayerInitResult,
} from './types';
import { GameAction } from '../types/game';

interface DraftableAction {
  id: string;
  name: string;
  description?: string;
  bonus?: Record<string, unknown>;
}

interface ActionDraftingConfig {
  actions: DraftableAction[];
  reset_each_round?: boolean;  // default true
  exclusive?: boolean;         // each action can only be selected once per round (default true)
  unchosen_bonus?: string;     // resource added to unchosen actions (increase-value pattern)
}

export const actionDraftingMechanic: MechanicHooks = {
  slug: 'action-drafting',
  name: 'Action Drafting',

  configSchema: {
    type: 'object',
    description: 'Draft actions/roles from a shared pool each round',
    properties: {
      actions: { type: 'array', description: 'Available actions to draft', required: true },
      reset_each_round: { type: 'boolean', description: 'Reset pool each round', default: true },
      exclusive: { type: 'boolean', description: 'Each action selected only once per round', default: true },
      unchosen_bonus: { type: 'string', description: 'Resource added to unchosen actions' },
    },
    required: ['actions'],
  },

  initSharedState(ctx: SharedStateInitContext): SharedStateInitResult | null {
    const config = ctx.config.engine_mechanics?.action_drafting as ActionDraftingConfig | undefined;
    if (!config?.actions) return {};

    return {
      actionDraftPool: config.actions.map(a => ({ ...a, bonusTokens: 0 })),
      actionDraftSelections: {} as Record<string, string>,
      actionDraftPhase: true,
    };
  },

  initPlayerState(ctx: PlayerInitContext): PlayerInitResult | null {
    const config = ctx.config.engine_mechanics?.action_drafting as ActionDraftingConfig | undefined;
    if (!config) return null;
    return { selectedActions: [] };
  },

  getAvailableActions(ctx: HookContext): AvailableAction[] {
    const config = ctx.config.engine_mechanics?.action_drafting as ActionDraftingConfig | undefined;
    if (!config) return [];

    const shared = ctx.state.shared as Record<string, unknown>;
    if (!shared.actionDraftPhase) return [];

    const selections = (shared.actionDraftSelections || {}) as Record<string, string>;
    const exclusive = config.exclusive !== false;

    // Player already selected this round
    if (selections[ctx.playerId]) return [];

    const pool = (shared.actionDraftPool || []) as Array<DraftableAction & { bonusTokens: number }>;
    const taken = new Set(Object.values(selections));

    return pool
      .filter(a => !exclusive || !taken.has(a.id))
      .map(a => ({
        action: {
          type: 'select_action',
          selectedAction: { actionId: a.id, name: a.name, description: a.description },
        } as GameAction,
        category: 'drafting',
      }));
  },

  onExecuteAction(ctx: ActionExecutionContext): ActionExecutionResult | null {
    const action = ctx.action;
    if (action.type !== 'select_action') return null;

    const config = ctx.config.engine_mechanics?.action_drafting as ActionDraftingConfig | undefined;
    if (!config) return null;

    const selectAction = action as { type: string; selectedAction?: Record<string, unknown> };
    const actionId = selectAction.selectedAction?.actionId as string;
    if (!actionId) return null;

    const shared = ctx.state.shared as Record<string, unknown>;
    const selections = { ...((shared.actionDraftSelections || {}) as Record<string, string>) };
    selections[ctx.playerId] = actionId;

    // Check if all players have selected
    const allSelected = ctx.state.turnOrder.every(pid => selections[pid]);

    return {
      handled: true,
      stateChanges: {
        playerStateChanges: { [ctx.playerId]: { selectedActions: [actionId] } },
        sharedStateChanges: {
          actionDraftSelections: selections,
          actionDraftPhase: !allSelected,
        },
      },
      advanceTurn: true,
      logMessage: `selected action ${actionId}`,
    };
  },

  onTurnStart(ctx: TurnStartContext): StateChanges | null {
    const config = ctx.config.engine_mechanics?.action_drafting as ActionDraftingConfig | undefined;
    if (!config) return null;

    // Reset at round start
    if (!ctx.isNewRound) return null;
    if (config.reset_each_round === false) return null;

    const shared = ctx.state.shared as Record<string, unknown>;
    const pool = (shared.actionDraftPool || []) as Array<DraftableAction & { bonusTokens: number }>;

    // Add bonus tokens to unchosen actions
    let updatedPool = pool;
    if (config.unchosen_bonus) {
      const selections = (shared.actionDraftSelections || {}) as Record<string, string>;
      const chosen = new Set(Object.values(selections));
      updatedPool = pool.map(a => ({
        ...a,
        bonusTokens: chosen.has(a.id) ? 0 : a.bonusTokens + 1,
      }));
    }

    return {
      sharedStateChanges: {
        actionDraftSelections: {},
        actionDraftPhase: true,
        actionDraftPool: updatedPool,
      },
    };
  },

  getPlayerView(ctx: HookContext): Record<string, unknown> {
    const config = ctx.config.engine_mechanics?.action_drafting as ActionDraftingConfig | undefined;
    if (!config) return {};

    const shared = ctx.state.shared as Record<string, unknown>;
    return {
      actionDraftPool: shared.actionDraftPool,
      actionDraftSelections: shared.actionDraftSelections,
      actionDraftPhase: shared.actionDraftPhase,
      selectedActions: ctx.player.selectedActions,
    };
  },
};
