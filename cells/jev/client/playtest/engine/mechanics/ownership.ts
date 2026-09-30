/**
 * Ownership Mechanic
 *
 * Players claim ownership of game elements (locations, resources, cards).
 * Owned elements provide benefits and restrict other players' access.
 *
 * Hooks used:
 * - initSharedState: Track ownership
 * - getAvailableActions: 'claim_ownership', 'transfer_ownership'
 * - onExecuteAction: Handle ownership changes
 * - getPlayerView: Show owned elements
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

interface OwnershipConfig {
  claimable_elements?: string[];
  claim_cost?: number;
  income_per_owned?: number;
}

interface OwnershipState {
  ownership: Record<string, string | null>; // elementId -> playerId or null
  claimableElements: string[];
}

function getConfig(config: GameConfig): OwnershipConfig | undefined {
  return config.engine_mechanics?.ownership as OwnershipConfig | undefined;
}

function getOwnershipState(shared: Record<string, unknown>): OwnershipState | undefined {
  return shared.ownership as OwnershipState | undefined;
}

export const ownershipMechanic: MechanicHooks = {
  slug: 'ownership',
  name: 'Ownership',
  requires: ['resources'],

  configSchema: {
    type: 'object',
    description: 'Claim and manage ownership of game elements',
    properties: {
      claimable_elements: { type: 'array', description: 'Element IDs that can be owned' },
      claim_cost: { type: 'number', default: 5 },
      income_per_owned: { type: 'number', default: 1 }
    }
  },

  initSharedState(ctx: SharedStateInitContext): SharedStateInitResult | null {
    const config = getConfig(ctx.config);
    if (!config) return null;

    const elements = config.claimable_elements ?? ['property-1', 'property-2', 'property-3', 'property-4'];
    const ownership: Record<string, string | null> = {};
    for (const el of elements) {
      ownership[el] = null;
    }

    return {
      ownership: { ownership, claimableElements: elements } as OwnershipState
    };
  },

  getAvailableActions(ctx: HookContext): AvailableAction[] {
    if (!isMechanicEnabled(ctx.config, 'ownership')) return [];

    const ownerState = getOwnershipState(ctx.state.shared);
    if (!ownerState) return [];

    const actions: AvailableAction[] = [];

    // Unclaimed elements
    for (const [elId, owner] of Object.entries(ownerState.ownership)) {
      if (owner === null) {
        actions.push({
          action: { type: 'claim_ownership', elementId: elId } as unknown as GameAction,
          priority: 55,
          category: 'ownership'
        });
      }
    }

    return actions;
  },

  onExecuteAction(ctx: ActionExecutionContext): ActionExecutionResult | null {
    if (ctx.action.type !== 'claim_ownership' && ctx.action.type !== 'transfer_ownership') return null;

    const config = getConfig(ctx.config);
    if (!config) return null;

    const ownerState = getOwnershipState(ctx.state.shared);
    if (!ownerState) return null;

    if (ctx.action.type === 'claim_ownership') {
      const claimAction = ctx.action as unknown as { type: 'claim_ownership'; elementId: string };
      const currentOwner = ownerState.ownership[claimAction.elementId];

      if (currentOwner !== null && currentOwner !== undefined) {
        return { handled: true, logMessage: 'Element already owned.', advanceTurn: false, checkWin: false };
      }

      const cost = config.claim_cost ?? 5;

      return {
        handled: true,
        stateChanges: {
          sharedStateChanges: {
            ownership: {
              ...ownerState,
              ownership: { ...ownerState.ownership, [claimAction.elementId]: ctx.playerId }
            }
          },
          playerStateChanges: {
            [ctx.playerId]: { score: (ctx.player.score ?? 0) - cost }
          }
        },
        advanceTurn: false,
        checkWin: false,
        logMessage: `${ctx.playerId} claimed ownership of ${claimAction.elementId}.`,
        logData: { player: ctx.playerId, element: claimAction.elementId, cost }
      };
    }

    // transfer_ownership
    const transferAction = ctx.action as unknown as { type: 'transfer_ownership'; elementId: string; toPlayerId: string };
    if (ownerState.ownership[transferAction.elementId] !== ctx.playerId) {
      return { handled: true, logMessage: 'You do not own this element.', advanceTurn: false, checkWin: false };
    }

    return {
      handled: true,
      stateChanges: {
        sharedStateChanges: {
          ownership: {
            ...ownerState,
            ownership: { ...ownerState.ownership, [transferAction.elementId]: transferAction.toPlayerId }
          }
        }
      },
      advanceTurn: false,
      checkWin: false,
      logMessage: `${ctx.playerId} transferred ${transferAction.elementId} to ${transferAction.toPlayerId}.`,
      logData: { player: ctx.playerId, element: transferAction.elementId, to: transferAction.toPlayerId }
    };
  },

  getPlayerView(ctx: HookContext): Record<string, unknown> | null {
    if (!isMechanicEnabled(ctx.config, 'ownership')) return null;

    const ownerState = getOwnershipState(ctx.state.shared);
    if (!ownerState) return null;

    const myOwned = Object.entries(ownerState.ownership)
      .filter(([, owner]) => owner === ctx.playerId)
      .map(([elId]) => elId);

    return {
      ownedElements: myOwned,
      allOwnership: ownerState.ownership
    };
  }
};
