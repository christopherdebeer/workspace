/**
 * I Cut You Choose Mechanic
 *
 * One player divides items into groups, other player(s) choose which group to take.
 *
 * Config:
 *   i_cut_you_choose:
 *     num_groups: number
 *     chooser_order: 'reverse' | 'clockwise'
 *     cutter_gets_last: boolean
 */

import { MechanicHooks, HookContext, ValidationResult, ActionExecutionContext, ActionExecutionResult, AvailableAction, StateChanges } from './types';
import { GameAction, Card, DivideItemsAction, ChooseGroupAction, ICutYouChooseConfig } from '../types/game';

interface DivisionState {
  cutter: string;
  itemsToDivide: Card[];
  groups: Card[][];
  phase: 'cutting' | 'choosing' | 'complete';
  chooserOrder: string[];
  currentChooser: number;
  chosenGroups: Record<string, number>;
}

export const iCutYouChooseMechanic: MechanicHooks = {
  slug: 'i-cut-you-choose',
  name: 'I Cut You Choose',

  configSchema: {
    type: 'object',
    description: 'Fair division through cutting and choosing',
    properties: {
      num_groups: {
        type: 'number',
        description: 'Number of groups to divide items into',
        default: 2
      },
      chooser_order: {
        type: 'string',
        description: 'Order in which players choose groups',
        enum: ['reverse', 'clockwise'],
        default: 'reverse'
      },
      cutter_gets_last: {
        type: 'boolean',
        description: 'Whether the cutter gets the remaining group',
        default: true
      }
    }
  },

  preValidateAction(ctx: HookContext, action: GameAction): ValidationResult | null {
    if (action.type !== 'divide_items' && action.type !== 'choose_group') return null;

    const config = ctx.config.engine_mechanics?.i_cut_you_choose;
    if (!config) {
      return { valid: false, error: 'I Cut You Choose is not enabled.' };
    }

    const division = ctx.state.shared.activeDivision as DivisionState | undefined;
    if (!division) {
      return { valid: false, error: 'No active division.' };
    }

    if (action.type === 'divide_items') {
      if (division.cutter !== ctx.playerId) {
        return { valid: false, error: 'You are not the cutter.' };
      }

      if (division.phase !== 'cutting') {
        return { valid: false, error: 'Not in cutting phase.' };
      }

      const divideAction = action as DivideItemsAction;
      const numGroups = config.num_groups ?? 2;

      if (divideAction.groups.length !== numGroups) {
        return { valid: false, error: `Must divide into exactly ${numGroups} groups.` };
      }

      const allItemIds = division.itemsToDivide.map(i => i.id ?? i.name);
      const groupItemIds = divideAction.groups.flat();

      if (groupItemIds.length !== allItemIds.length) {
        return { valid: false, error: 'All items must be placed in exactly one group.' };
      }

      for (const itemId of groupItemIds) {
        if (!allItemIds.includes(itemId)) {
          return { valid: false, error: `Invalid item ID: ${itemId}` };
        }
      }

      const uniqueIds = new Set(groupItemIds);
      if (uniqueIds.size !== groupItemIds.length) {
        return { valid: false, error: 'Each item can only be in one group.' };
      }
    }

    if (action.type === 'choose_group') {
      if (division.phase !== 'choosing') {
        return { valid: false, error: 'Not in choosing phase.' };
      }

      const currentChooser = division.chooserOrder[division.currentChooser];
      if (currentChooser !== ctx.playerId) {
        return { valid: false, error: 'It is not your turn to choose.' };
      }

      const chooseAction = action as ChooseGroupAction;
      if (chooseAction.groupIndex < 0 || chooseAction.groupIndex >= division.groups.length) {
        return { valid: false, error: 'Invalid group index.' };
      }

      if (Object.values(division.chosenGroups).includes(chooseAction.groupIndex)) {
        return { valid: false, error: 'This group has already been chosen.' };
      }
    }

    return { valid: true };
  },

  onExecuteAction(ctx: ActionExecutionContext): ActionExecutionResult | null {
    const { action, state, playerId } = ctx;
    const config = ctx.config.engine_mechanics?.i_cut_you_choose;
    if (!config) return null;

    if (action.type === 'divide_items') {
      const divideAction = action as DivideItemsAction;
      const division = state.shared.activeDivision as DivisionState;

      division.groups = divideAction.groups.map(groupIds =>
        groupIds.map(id => division.itemsToDivide.find(i => (i.id ?? i.name) === id)!)
      );

      const activePlayers = state.turnOrder.filter(
        pid => state.players[pid].state !== 'eliminated' && pid !== division.cutter
      );

      if (config.chooser_order === 'reverse') {
        division.chooserOrder = [...activePlayers].reverse();
      } else {
        division.chooserOrder = activePlayers;
      }

      if (config.cutter_gets_last !== false) {
        division.chooserOrder.push(division.cutter);
      }

      division.phase = 'choosing';
      division.currentChooser = 0;
      division.chosenGroups = {};

      return {
        handled: true,
        stateChanges: {
          sharedStateChanges: { activeDivision: division }
        },
        advanceTurn: false,
        checkWin: false,
        logMessage: `${playerId} divided the items into ${division.groups.length} groups`
      };
    }

    if (action.type === 'choose_group') {
      const chooseAction = action as ChooseGroupAction;
      const division = state.shared.activeDivision as DivisionState;

      division.chosenGroups[playerId] = chooseAction.groupIndex;
      const chosenItems = division.groups[chooseAction.groupIndex];

      const currentHand = state.players[playerId].hand ?? [];
      const newHand = [...currentHand, ...chosenItems];

      division.currentChooser++;

      const stateChanges: StateChanges = {
        playerStateChanges: {
          [playerId]: { hand: newHand }
        },
        sharedStateChanges: {}
      };

      if (division.currentChooser >= division.chooserOrder.length) {
        division.phase = 'complete';
        stateChanges.sharedStateChanges!.activeDivision = division;
        stateChanges.sharedStateChanges!.lastDivisionComplete = true;

        return {
          handled: true,
          stateChanges,
          advanceTurn: true,
          checkWin: true,
          logMessage: `${playerId} chose group ${chooseAction.groupIndex + 1}. Division complete!`
        };
      }

      if (division.chooserOrder.length - division.currentChooser === 1) {
        const lastChooser = division.chooserOrder[division.currentChooser];
        const remainingGroup = division.groups.findIndex(
          (_, i) => !Object.values(division.chosenGroups).includes(i)
        );

        if (remainingGroup !== -1) {
          division.chosenGroups[lastChooser] = remainingGroup;
          const lastItems = division.groups[remainingGroup];
          const lastPlayerHand = [...(state.players[lastChooser].hand ?? []), ...lastItems];

          division.phase = 'complete';
          stateChanges.playerStateChanges![lastChooser] = { hand: lastPlayerHand };
          stateChanges.sharedStateChanges!.activeDivision = division;
          stateChanges.sharedStateChanges!.lastDivisionComplete = true;

          return {
            handled: true,
            stateChanges,
            advanceTurn: true,
            checkWin: true,
            logMessage: `${playerId} chose group ${chooseAction.groupIndex + 1}. ${lastChooser} receives remaining group. Division complete!`
          };
        }
      }

      stateChanges.sharedStateChanges!.activeDivision = division;

      return {
        handled: true,
        stateChanges,
        advanceTurn: false,
        checkWin: false,
        logMessage: `${playerId} chose group ${chooseAction.groupIndex + 1}`
      };
    }

    return null;
  },

  getAvailableActions(ctx: HookContext): AvailableAction[] {
    const config = ctx.config.engine_mechanics?.i_cut_you_choose;
    if (!config) return [];

    const division = ctx.state.shared.activeDivision as DivisionState | undefined;
    if (!division) return [];

    if (division.phase === 'cutting' && division.cutter === ctx.playerId) {
      return [{
        action: {
          type: 'divide_items',
          groups: []
        } as DivideItemsAction,
        priority: 95,
        category: 'division'
      }];
    }

    if (division.phase === 'choosing') {
      const currentChooser = division.chooserOrder[division.currentChooser];
      if (currentChooser === ctx.playerId) {
        return division.groups
          .map((_, index) => index)
          .filter(index => !Object.values(division.chosenGroups).includes(index))
          .map(index => ({
            action: {
              type: 'choose_group',
              groupIndex: index
            } as ChooseGroupAction,
            priority: 90,
            category: 'division'
          }));
      }
    }

    return [];
  }
};
