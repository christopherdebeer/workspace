/**
 * Worker Placement with Dice Workers Mechanic
 *
 * Dice serve as workers - their face value determines which locations they can be placed on.
 * Combines dice-rolling with worker-placement for location value requirements.
 *
 * Hooks used:
 * - initSharedState: Create dice workers per player
 * - getAvailableActions: 'place_dice_worker' filtered by die value
 * - onExecuteAction: Place dice worker at location
 * - onTurnStart: Roll dice workers at round start
 * - getPlayerView: Show dice workers and valid placements
 */

import {
  MechanicHooks,
  HookContext,
  ActionExecutionContext,
  ActionExecutionResult,
  AvailableAction,
  SharedStateInitContext,
  SharedStateInitResult,
  TurnStartContext,
  StateChanges,
  isMechanicEnabled
} from './types';
import { GameAction, GameConfig } from '../types/game';

interface DiceWorkerConfig {
  dice_per_player?: number;    // number of dice workers each player gets
  die_sides?: number;          // faces on each die
  min_value_required?: boolean; // location requires min die value
}

interface DiceWorker {
  id: string;
  value: number;
  placed: boolean;
  locationId: string | null;
}

interface DiceWorkerState {
  workers: Record<string, DiceWorker[]>;  // playerId -> dice workers
  round: number;
}

function getConfig(config: GameConfig): DiceWorkerConfig | undefined {
  return config.engine_mechanics?.worker_placement_with_dice_workers as DiceWorkerConfig | undefined;
}

function getDiceWorkerState(shared: Record<string, unknown>): DiceWorkerState | undefined {
  return shared.diceWorkers as DiceWorkerState | undefined;
}

export const workerPlacementDiceWorkersMechanic: MechanicHooks = {
  slug: 'worker-placement-with-dice-workers',
  name: 'Worker Placement with Dice Workers',
  requires: ['workers', 'dice'],

  configSchema: {
    type: 'object',
    description: 'Dice serve as workers with face values determining valid placements',
    properties: {
      dice_per_player: {
        type: 'number',
        description: 'Number of dice workers per player',
        default: 3
      },
      die_sides: {
        type: 'number',
        description: 'Number of faces on each die',
        default: 6
      },
      min_value_required: {
        type: 'boolean',
        description: 'Locations require minimum die value',
        default: true
      }
    }
  },

  initSharedState(ctx: SharedStateInitContext): SharedStateInitResult | null {
    const config = getConfig(ctx.config);
    if (!config) return null;

    const diceCount = config.dice_per_player ?? 3;
    const sides = config.die_sides ?? 6;
    const workers: Record<string, DiceWorker[]> = {};

    for (const pid of ctx.playerIds) {
      workers[pid] = [];
      for (let i = 0; i < diceCount; i++) {
        workers[pid].push({
          id: `${pid}-die-${i}`,
          value: Math.floor(Math.random() * sides) + 1,
          placed: false,
          locationId: null
        });
      }
    }

    return { diceWorkers: { workers, round: 1 } as DiceWorkerState };
  },

  onTurnStart(ctx: TurnStartContext): StateChanges | null {
    if (!isMechanicEnabled(ctx.config, 'worker-placement-with-dice-workers')) return null;
    if (!ctx.isNewRound) return null;

    const config = getConfig(ctx.config);
    if (!config) return null;

    const dwState = getDiceWorkerState(ctx.state.shared);
    if (!dwState) return null;

    const sides = config.die_sides ?? 6;
    const updatedWorkers: Record<string, DiceWorker[]> = {};

    // Re-roll all dice at start of new round
    for (const [pid, dice] of Object.entries(dwState.workers)) {
      updatedWorkers[pid] = dice.map(d => ({
        ...d,
        value: Math.floor(Math.random() * sides) + 1,
        placed: false,
        locationId: null
      }));
    }

    return {
      sharedStateChanges: {
        diceWorkers: { workers: updatedWorkers, round: dwState.round + 1 }
      }
    };
  },

  getAvailableActions(ctx: HookContext): AvailableAction[] {
    if (!isMechanicEnabled(ctx.config, 'worker-placement-with-dice-workers')) return [];

    const dwState = getDiceWorkerState(ctx.state.shared);
    if (!dwState) return [];

    const myDice = dwState.workers[ctx.playerId] ?? [];
    const unplaced = myDice.filter(d => !d.placed);
    if (unplaced.length === 0) return [];

    const actions: AvailableAction[] = [];
    for (const die of unplaced) {
      actions.push({
        action: {
          type: 'place_dice_worker',
          dieId: die.id,
          dieValue: die.value,
          locationId: ''
        } as unknown as GameAction,
        priority: 60,
        category: 'worker-placement'
      });
    }

    return actions;
  },

  onExecuteAction(ctx: ActionExecutionContext): ActionExecutionResult | null {
    if (ctx.action.type !== 'place_dice_worker') return null;

    const dwState = getDiceWorkerState(ctx.state.shared);
    if (!dwState) return null;

    const placeAction = ctx.action as unknown as { type: 'place_dice_worker'; dieId: string; locationId: string };
    const myDice = dwState.workers[ctx.playerId] ?? [];
    const die = myDice.find(d => d.id === placeAction.dieId);

    if (!die) {
      return { handled: true, logMessage: 'Die not found.', advanceTurn: false, checkWin: false };
    }

    if (die.placed) {
      return { handled: true, logMessage: 'Die already placed.', advanceTurn: false, checkWin: false };
    }

    const updatedDice = myDice.map(d =>
      d.id === placeAction.dieId
        ? { ...d, placed: true, locationId: placeAction.locationId }
        : d
    );

    const allPlaced = updatedDice.every(d => d.placed);

    return {
      handled: true,
      stateChanges: {
        sharedStateChanges: {
          diceWorkers: {
            ...dwState,
            workers: { ...dwState.workers, [ctx.playerId]: updatedDice }
          }
        }
      },
      advanceTurn: false,
      checkWin: false,
      logMessage: `${ctx.playerId} placed die (value ${die.value}) at ${placeAction.locationId}.`,
      logData: {
        player: ctx.playerId,
        dieValue: die.value,
        location: placeAction.locationId,
        allPlaced
      }
    };
  },

  getPlayerView(ctx: HookContext): Record<string, unknown> | null {
    if (!isMechanicEnabled(ctx.config, 'worker-placement-with-dice-workers')) return null;

    const dwState = getDiceWorkerState(ctx.state.shared);
    if (!dwState) return null;

    const myDice = dwState.workers[ctx.playerId] ?? [];
    return {
      diceWorkers: myDice.map(d => ({
        id: d.id,
        value: d.value,
        placed: d.placed,
        location: d.locationId
      })),
      unplacedDice: myDice.filter(d => !d.placed).length
    };
  }
};
