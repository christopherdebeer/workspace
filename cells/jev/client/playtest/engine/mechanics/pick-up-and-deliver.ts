/**
 * Pick-up and Deliver Mechanic
 *
 * Transport goods from pickup locations to delivery locations for rewards.
 *
 * Hooks used:
 * - initSharedState: Create pickup/delivery locations and goods
 * - getAvailableActions: 'pickup_cargo', 'deliver_cargo'
 * - onExecuteAction: Handle cargo operations
 * - getPlayerView: Show cargo and locations
 */

import {
  MechanicHooks,
  HookContext,
  ActionExecutionContext,
  ActionExecutionResult,
  AvailableAction,
  SharedStateInitContext,
  SharedStateInitResult,
  isMechanicEnabled
} from './types';
import { GameAction, GameConfig } from '../types/game';

interface DeliveryContract {
  id: string;
  cargo: string;
  pickup: string;
  delivery: string;
  reward: number;
}

interface PickUpDeliverConfig {
  contracts?: DeliveryContract[];
  cargo_capacity?: number;
}

interface PickUpDeliverState {
  contracts: DeliveryContract[];
  playerCargo: Record<string, string[]>; // playerId -> cargo held
  completedContracts: Array<{ contractId: string; playerId: string }>;
}

function getConfig(config: GameConfig): PickUpDeliverConfig | undefined {
  return config.engine_mechanics?.pick_up_and_deliver as PickUpDeliverConfig | undefined;
}

function getPUDState(shared: Record<string, unknown>): PickUpDeliverState | undefined {
  return shared.pickUpDeliver as PickUpDeliverState | undefined;
}

export const pickUpAndDeliverMechanic: MechanicHooks = {
  slug: 'pick-up-and-deliver',
  name: 'Pick-up and Deliver',
  requires: ['board'],

  configSchema: {
    type: 'object',
    description: 'Transport goods between locations for rewards',
    properties: {
      contracts: { type: 'array', description: 'Delivery contracts' },
      cargo_capacity: { type: 'number', default: 3 }
    }
  },

  initSharedState(ctx: SharedStateInitContext): SharedStateInitResult | null {
    const config = getConfig(ctx.config);
    if (!config) return null;

    const contracts = config.contracts ?? [
      { id: 'c1', cargo: 'wheat', pickup: 'farm', delivery: 'market', reward: 5 },
      { id: 'c2', cargo: 'ore', pickup: 'mine', delivery: 'forge', reward: 8 },
      { id: 'c3', cargo: 'silk', pickup: 'loom', delivery: 'port', reward: 10 }
    ];

    const playerCargo: Record<string, string[]> = {};
    for (const pid of ctx.playerIds) {
      playerCargo[pid] = [];
    }

    return {
      pickUpDeliver: { contracts, playerCargo, completedContracts: [] } as PickUpDeliverState
    };
  },

  getAvailableActions(ctx: HookContext): AvailableAction[] {
    if (!isMechanicEnabled(ctx.config, 'pick-up-and-deliver')) return [];

    const config = getConfig(ctx.config);
    if (!config) return [];

    const pudState = getPUDState(ctx.state.shared);
    if (!pudState) return [];

    const myCargo = pudState.playerCargo[ctx.playerId] ?? [];
    const capacity = config.cargo_capacity ?? 3;
    const actions: AvailableAction[] = [];

    // Pickup available contracts
    if (myCargo.length < capacity) {
      for (const contract of pudState.contracts) {
        if (!pudState.completedContracts.some(c => c.contractId === contract.id)) {
          actions.push({
            action: {
              type: 'pickup_cargo',
              contractId: contract.id
            } as unknown as GameAction,
            priority: 60,
            category: 'delivery'
          });
        }
      }
    }

    // Deliver held cargo
    for (const cargoId of myCargo) {
      const contract = pudState.contracts.find(c => c.cargo === cargoId);
      if (contract) {
        actions.push({
          action: {
            type: 'deliver_cargo',
            contractId: contract.id
          } as unknown as GameAction,
          priority: 65,
          category: 'delivery'
        });
      }
    }

    return actions;
  },

  onExecuteAction(ctx: ActionExecutionContext): ActionExecutionResult | null {
    if (ctx.action.type !== 'pickup_cargo' && ctx.action.type !== 'deliver_cargo') return null;

    const config = getConfig(ctx.config);
    if (!config) return null;

    const pudState = getPUDState(ctx.state.shared);
    if (!pudState) return null;

    if (ctx.action.type === 'pickup_cargo') {
      const pickAction = ctx.action as unknown as { type: 'pickup_cargo'; contractId: string };
      const contract = pudState.contracts.find(c => c.id === pickAction.contractId);
      if (!contract) {
        return { handled: true, logMessage: 'Contract not found.', advanceTurn: false, checkWin: false };
      }

      const myCargo = pudState.playerCargo[ctx.playerId] ?? [];
      const capacity = config.cargo_capacity ?? 3;
      if (myCargo.length >= capacity) {
        return { handled: true, logMessage: 'Cargo capacity full.', advanceTurn: false, checkWin: false };
      }

      return {
        handled: true,
        stateChanges: {
          sharedStateChanges: {
            pickUpDeliver: {
              ...pudState,
              playerCargo: {
                ...pudState.playerCargo,
                [ctx.playerId]: [...myCargo, contract.cargo]
              }
            }
          }
        },
        advanceTurn: false,
        checkWin: false,
        logMessage: `${ctx.playerId} picked up ${contract.cargo} at ${contract.pickup}.`,
        logData: { player: ctx.playerId, cargo: contract.cargo, pickup: contract.pickup }
      };
    }

    // deliver_cargo
    const deliverAction = ctx.action as unknown as { type: 'deliver_cargo'; contractId: string };
    const contract = pudState.contracts.find(c => c.id === deliverAction.contractId);
    if (!contract) {
      return { handled: true, logMessage: 'Contract not found.', advanceTurn: false, checkWin: false };
    }

    const myCargo = pudState.playerCargo[ctx.playerId] ?? [];
    const cargoIdx = myCargo.indexOf(contract.cargo);
    if (cargoIdx < 0) {
      return { handled: true, logMessage: 'Cargo not held.', advanceTurn: false, checkWin: false };
    }

    const updatedCargo = [...myCargo];
    updatedCargo.splice(cargoIdx, 1);

    return {
      handled: true,
      stateChanges: {
        sharedStateChanges: {
          pickUpDeliver: {
            ...pudState,
            playerCargo: { ...pudState.playerCargo, [ctx.playerId]: updatedCargo },
            completedContracts: [...pudState.completedContracts, { contractId: contract.id, playerId: ctx.playerId }]
          }
        },
        playerStateChanges: {
          [ctx.playerId]: { score: (ctx.player.score ?? 0) + contract.reward }
        }
      },
      advanceTurn: false,
      checkWin: true,
      logMessage: `${ctx.playerId} delivered ${contract.cargo} to ${contract.delivery} for ${contract.reward} points!`,
      logData: { player: ctx.playerId, cargo: contract.cargo, delivery: contract.delivery, reward: contract.reward }
    };
  },

  getPlayerView(ctx: HookContext): Record<string, unknown> | null {
    if (!isMechanicEnabled(ctx.config, 'pick-up-and-deliver')) return null;

    const pudState = getPUDState(ctx.state.shared);
    if (!pudState) return null;

    return {
      heldCargo: pudState.playerCargo[ctx.playerId] ?? [],
      availableContracts: pudState.contracts.filter(
        c => !pudState.completedContracts.some(cc => cc.contractId === c.id)
      ),
      completedDeliveries: pudState.completedContracts.filter(c => c.playerId === ctx.playerId).length
    };
  }
};
