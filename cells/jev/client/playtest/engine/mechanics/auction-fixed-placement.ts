/**
 * Auction Fixed Placement Mechanic
 *
 * Bids on fixed positions/slots. Each slot has a defined value.
 * Players bid on specific slots rather than items.
 *
 * Hooks used:
 * - initSharedState: Create slots
 * - getAvailableActions: 'bid_on_slot'
 * - onExecuteAction: Place bid on slot
 * - getPlayerView: Show slots and bids
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

interface AuctionSlot {
  id: string;
  name: string;
  value: number;
}

interface AuctionFixedConfig {
  slots?: AuctionSlot[];
}

interface FixedPlacementState {
  slots: AuctionSlot[];
  placements: Record<string, { playerId: string; bid: number } | null>; // slotId -> placement
}

function getConfig(config: GameConfig): AuctionFixedConfig | undefined {
  return config.engine_mechanics?.auction_fixed_placement as AuctionFixedConfig | undefined;
}

function getFixedState(shared: Record<string, unknown>): FixedPlacementState | undefined {
  return shared.fixedPlacementAuction as FixedPlacementState | undefined;
}

export const auctionFixedPlacementMechanic: MechanicHooks = {
  slug: 'auction-fixed-placement',
  name: 'Auction: Fixed Placement',
  requires: ['auction'],

  configSchema: {
    type: 'object',
    description: 'Bid on fixed position slots',
    properties: {
      slots: { type: 'array', description: 'Slot definitions with id, name, value' }
    }
  },

  initSharedState(ctx: SharedStateInitContext): SharedStateInitResult | null {
    const config = getConfig(ctx.config);
    if (!config) return null;

    const slots = config.slots ?? [
      { id: 'slot-1', name: 'First Pick', value: 5 },
      { id: 'slot-2', name: 'Second Pick', value: 3 },
      { id: 'slot-3', name: 'Third Pick', value: 1 }
    ];

    const placements: Record<string, null> = {};
    for (const slot of slots) {
      placements[slot.id] = null;
    }

    return {
      fixedPlacementAuction: { slots, placements } as FixedPlacementState
    };
  },

  getAvailableActions(ctx: HookContext): AvailableAction[] {
    if (!isMechanicEnabled(ctx.config, 'auction-fixed-placement')) return [];

    const fpState = getFixedState(ctx.state.shared);
    if (!fpState) return [];

    // Check if player already has a placement
    const hasPlacement = Object.values(fpState.placements).some(
      p => p !== null && p.playerId === ctx.playerId
    );
    if (hasPlacement) return [];

    const actions: AvailableAction[] = [];
    for (const slot of fpState.slots) {
      const current = fpState.placements[slot.id];
      actions.push({
        action: {
          type: 'bid_on_slot',
          slotId: slot.id,
          bid: (current?.bid ?? 0) + 1
        } as unknown as GameAction,
        priority: 65,
        category: 'auction'
      });
    }

    return actions;
  },

  onExecuteAction(ctx: ActionExecutionContext): ActionExecutionResult | null {
    if (ctx.action.type !== 'bid_on_slot') return null;

    const fpState = getFixedState(ctx.state.shared);
    if (!fpState) return null;

    const bidAction = ctx.action as unknown as { type: 'bid_on_slot'; slotId: string; bid: number };
    const slot = fpState.slots.find(s => s.id === bidAction.slotId);
    if (!slot) {
      return { handled: true, logMessage: 'Slot not found.', advanceTurn: false, checkWin: false };
    }

    const currentPlacement = fpState.placements[bidAction.slotId];
    if (currentPlacement && bidAction.bid <= currentPlacement.bid) {
      return { handled: true, logMessage: 'Bid must exceed current bid.', advanceTurn: false, checkWin: false };
    }

    const updatedPlacements = {
      ...fpState.placements,
      [bidAction.slotId]: { playerId: ctx.playerId, bid: bidAction.bid }
    };

    return {
      handled: true,
      stateChanges: {
        sharedStateChanges: {
          fixedPlacementAuction: { ...fpState, placements: updatedPlacements }
        }
      },
      advanceTurn: false,
      checkWin: false,
      logMessage: `${ctx.playerId} bid ${bidAction.bid} on ${slot.name}.`,
      logData: { player: ctx.playerId, slot: slot.name, bid: bidAction.bid }
    };
  },

  getPlayerView(ctx: HookContext): Record<string, unknown> | null {
    if (!isMechanicEnabled(ctx.config, 'auction-fixed-placement')) return null;

    const fpState = getFixedState(ctx.state.shared);
    if (!fpState) return null;

    return {
      auctionSlots: fpState.slots.map(s => ({
        ...s,
        currentBid: fpState.placements[s.id]?.bid ?? 0,
        currentHolder: fpState.placements[s.id]?.playerId ?? null
      }))
    };
  }
};
