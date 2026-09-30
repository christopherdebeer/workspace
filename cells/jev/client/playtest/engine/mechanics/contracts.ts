/**
 * Contracts Mechanic
 *
 * Players can take and fulfill contracts for rewards.
 * Contracts have resource requirements and give resource/point rewards.
 *
 * Config (engine_mechanics.contracts):
 * ```yaml
 * engine_mechanics:
 *   contracts:
 *     contracts:
 *       - id: "deliver_wheat"
 *         name: "Wheat Delivery"
 *         requirements: { wheat: 3 }
 *         rewards: { gold: 5 }
 *         points: 2
 *     max_active: 3
 *     available_count: 3
 *     refill: true
 * ```
 *
 * Hooks used:
 * - initSharedState: Create available contracts pool, shuffle contract deck
 * - initPlayerState: Give player empty active_contracts array
 * - getAvailableActions: 'take_contract' and 'fulfill_contract' actions
 * - preValidateAction: Validate contract actions
 * - onExecuteAction: Handle take_contract and fulfill_contract
 * - getPlayerView: Show player's contracts and available contracts
 * - describeAction: Describe contract actions
 */

import {
  MechanicHooks,
  HookContext,
  ValidationResult,
  ActionExecutionContext,
  ActionExecutionResult,
  AvailableAction,
  ActionDescription,
  SharedStateInitContext,
  SharedStateInitResult,
  PlayerInitContext,
  PlayerInitResult
} from './types';
import { GameAction, GameConfig } from '../types/game';
import { spendResource, addResource, getResource } from './core/resources';

interface ContractDef {
  id: string;
  name: string;
  requirements: Record<string, number>;
  rewards: Record<string, number>;
  points?: number;
}

interface ContractsConfig {
  contracts: ContractDef[];
  max_active?: number;
  available_count?: number;
  refill?: boolean;
}

interface ContractsState {
  deck: ContractDef[];
  available: ContractDef[];
  fulfilled: Record<string, string[]>;  // playerId -> fulfilled contract IDs
}

function getConfig(config: GameConfig): ContractsConfig | undefined {
  return config.engine_mechanics?.contracts as ContractsConfig | undefined;
}

function shuffleArray<T>(arr: T[]): T[] {
  const shuffled = [...arr];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

export const contractsMechanic: MechanicHooks = {
  slug: 'contracts',
  name: 'Contracts',
  requires: ['resources'],

  configSchema: {
    type: 'object',
    description: 'Contract fulfillment system for resource trading',
    properties: {
      contracts: {
        type: 'array',
        description: 'Available contract definitions'
      },
      max_active: {
        type: 'number',
        description: 'Maximum contracts a player can hold',
        default: 3
      },
      available_count: {
        type: 'number',
        description: 'How many contracts visible to draft from',
        default: 3
      },
      refill: {
        type: 'boolean',
        description: 'Auto-refill available contracts when taken',
        default: true
      }
    }
  },

  initSharedState(ctx: SharedStateInitContext): SharedStateInitResult | null {
    const config = getConfig(ctx.config);
    if (!config || !config.contracts?.length) return null;

    const availableCount = config.available_count ?? 3;
    const shuffled = shuffleArray(config.contracts);

    const available = shuffled.slice(0, availableCount);
    const deck = shuffled.slice(availableCount);

    const contractsState: ContractsState = {
      deck,
      available,
      fulfilled: {}
    };

    return { contracts: contractsState };
  },

  initPlayerState(ctx: PlayerInitContext): PlayerInitResult | null {
    const config = getConfig(ctx.config);
    if (!config) return null;

    return {
      active_contracts: []
    };
  },

  preValidateAction(ctx: HookContext, action: GameAction): ValidationResult | null {
    if (action.type !== 'take_contract' && action.type !== 'fulfill_contract') return null;

    const config = getConfig(ctx.config);
    if (!config) return { valid: false, error: 'Contracts not enabled.' };

    const contractsState = ctx.state.shared.contracts as ContractsState | undefined;
    if (!contractsState) return { valid: false, error: 'Contracts not initialized.' };

    const contractAction = action as unknown as { type: string; contract_id: string };

    if (!contractAction.contract_id) {
      return { valid: false, error: 'Must specify contract_id.' };
    }

    if (action.type === 'take_contract') {
      const maxActive = config.max_active ?? 3;
      const playerContracts = (ctx.player.active_contracts as string[]) || [];

      if (playerContracts.length >= maxActive) {
        return { valid: false, error: `Already holding maximum contracts (${maxActive}).` };
      }

      const available = contractsState.available.find(c => c.id === contractAction.contract_id);
      if (!available) {
        return { valid: false, error: `Contract ${contractAction.contract_id} is not available.` };
      }
    }

    if (action.type === 'fulfill_contract') {
      const playerContracts = (ctx.player.active_contracts as string[]) || [];

      if (!playerContracts.includes(contractAction.contract_id)) {
        return { valid: false, error: `You don't hold contract ${contractAction.contract_id}.` };
      }

      // Check if player has required resources
      const contractDef = config.contracts.find(c => c.id === contractAction.contract_id);
      if (!contractDef) {
        return { valid: false, error: `Unknown contract: ${contractAction.contract_id}.` };
      }

      for (const [resource, amount] of Object.entries(contractDef.requirements)) {
        const playerAmount = getResource(ctx.state, ctx.playerId, resource);
        if (playerAmount < amount) {
          return {
            valid: false,
            error: `Not enough ${resource}. Need ${amount}, have ${playerAmount}.`
          };
        }
      }
    }

    return { valid: true };
  },

  onExecuteAction(ctx: ActionExecutionContext): ActionExecutionResult | null {
    if (ctx.action.type !== 'take_contract' && ctx.action.type !== 'fulfill_contract') return null;

    const config = getConfig(ctx.config);
    if (!config) return null;

    const contractAction = ctx.action as unknown as { type: string; contract_id: string };
    const contractsState = { ...(ctx.state.shared.contracts as ContractsState) };

    if (ctx.action.type === 'take_contract') {
      // Remove contract from available pool
      const contractIndex = contractsState.available.findIndex(c => c.id === contractAction.contract_id);
      if (contractIndex === -1) return null;

      const contract = contractsState.available[contractIndex];
      const newAvailable = [...contractsState.available];
      newAvailable.splice(contractIndex, 1);

      // Refill from deck if configured
      const newDeck = [...contractsState.deck];
      const refill = config.refill ?? true;
      if (refill && newDeck.length > 0) {
        newAvailable.push(newDeck.shift()!);
      }

      contractsState.available = newAvailable;
      contractsState.deck = newDeck;

      // Add to player's active contracts
      const playerContracts = [...((ctx.state.players[ctx.playerId]?.active_contracts as string[]) || [])];
      playerContracts.push(contract.id);

      return {
        handled: true,
        stateChanges: {
          sharedStateChanges: { contracts: contractsState },
          playerStateChanges: {
            [ctx.playerId]: { active_contracts: playerContracts }
          }
        },
        advanceTurn: false,
        checkWin: false,
        logMessage: `${ctx.playerId} took contract "${contract.name}".`
      };
    }

    if (ctx.action.type === 'fulfill_contract') {
      const contractDef = config.contracts.find(c => c.id === contractAction.contract_id);
      if (!contractDef) return null;

      // Spend required resources
      for (const [resource, amount] of Object.entries(contractDef.requirements)) {
        const result = spendResource(ctx.state, ctx.playerId, resource, amount);
        if (!result.success) {
          return {
            handled: true,
            stateChanges: {},
            advanceTurn: false,
            checkWin: false,
            logMessage: `${ctx.playerId} failed to fulfill contract: ${result.blockReason}`
          };
        }
      }

      // Add reward resources
      for (const [resource, amount] of Object.entries(contractDef.rewards)) {
        addResource(ctx.state, ctx.playerId, resource, amount);
      }

      // Add points if configured
      const player = ctx.state.players[ctx.playerId];
      const newScore = (player?.score ?? 0) + (contractDef.points ?? 0);

      // Remove from player's active contracts
      const playerContracts = [...((player?.active_contracts as string[]) || [])];
      const contractIdx = playerContracts.indexOf(contractAction.contract_id);
      if (contractIdx >= 0) {
        playerContracts.splice(contractIdx, 1);
      }

      // Track fulfilled contracts
      const fulfilled = { ...contractsState.fulfilled };
      if (!fulfilled[ctx.playerId]) {
        fulfilled[ctx.playerId] = [];
      }
      fulfilled[ctx.playerId] = [...fulfilled[ctx.playerId], contractAction.contract_id];
      contractsState.fulfilled = fulfilled;

      const rewardStr = Object.entries(contractDef.rewards)
        .map(([r, a]) => `${a} ${r}`)
        .join(', ');
      const pointStr = contractDef.points ? ` and ${contractDef.points} points` : '';

      return {
        handled: true,
        stateChanges: {
          sharedStateChanges: { contracts: contractsState },
          playerStateChanges: {
            [ctx.playerId]: {
              active_contracts: playerContracts,
              score: newScore
            }
          }
        },
        advanceTurn: false,
        checkWin: true,
        logMessage: `${ctx.playerId} fulfilled contract "${contractDef.name}" for ${rewardStr}${pointStr}.`
      };
    }

    return null;
  },

  getAvailableActions(ctx: HookContext): AvailableAction[] {
    const config = getConfig(ctx.config);
    if (!config) return [];

    const contractsState = ctx.state.shared.contracts as ContractsState | undefined;
    if (!contractsState) return [];

    const actions: AvailableAction[] = [];
    const maxActive = config.max_active ?? 3;
    const playerContracts = (ctx.player.active_contracts as string[]) || [];

    // Take contract actions (from available pool)
    if (playerContracts.length < maxActive) {
      for (const contract of contractsState.available) {
        actions.push({
          action: {
            type: 'take_contract',
            contract_id: contract.id
          } as unknown as GameAction,
          priority: 60,
          category: 'contracts'
        });
      }
    }

    // Fulfill contract actions (from player's active contracts)
    for (const contractId of playerContracts) {
      const contractDef = config.contracts.find(c => c.id === contractId);
      if (!contractDef) continue;

      // Check if player has required resources
      let canFulfill = true;
      for (const [resource, amount] of Object.entries(contractDef.requirements)) {
        const playerAmount = getResource(ctx.state, ctx.playerId, resource);
        if (playerAmount < amount) {
          canFulfill = false;
          break;
        }
      }

      if (canFulfill) {
        actions.push({
          action: {
            type: 'fulfill_contract',
            contract_id: contractId
          } as unknown as GameAction,
          priority: 75,
          category: 'contracts'
        });
      }
    }

    return actions;
  },

  getPlayerView(ctx: HookContext): Record<string, unknown> | null {
    const config = getConfig(ctx.config);
    if (!config) return null;

    const contractsState = ctx.state.shared.contracts as ContractsState | undefined;
    if (!contractsState) return null;

    const playerContracts = (ctx.player.active_contracts as string[]) || [];
    const activeContractDefs = playerContracts
      .map(id => config.contracts.find(c => c.id === id))
      .filter(Boolean);

    return {
      availableContracts: contractsState.available,
      activeContracts: activeContractDefs,
      fulfilledContracts: contractsState.fulfilled[ctx.playerId] || []
    };
  },

  describeAction(action: GameAction): { type: string; label: string; description: string; examples?: string[] } | null {
    if (action.type === 'take_contract') {
      return {
        type: 'take_contract',
        label: 'Take Contract',
        description: 'Take an available contract to fulfill later.',
        examples: ['take_contract contract_id:"deliver_wheat"']
      };
    }
    if (action.type === 'fulfill_contract') {
      return {
        type: 'fulfill_contract',
        label: 'Fulfill Contract',
        description: 'Spend required resources to fulfill a contract and claim rewards.',
        examples: ['fulfill_contract contract_id:"deliver_wheat"']
      };
    }
    return null;
  }
};
