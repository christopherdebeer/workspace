/**
 * Kill Steal Mechanic
 *
 * Rewards for landing the final blow in combat.
 *
 * Config:
 *   kill_steal:
 *     bounty_type: 'fixed' | 'percentage' | 'unit_value'
 *     bounty_amount: number          # Fixed amount or percentage
 *     credit_assists: boolean        # Give partial credit to assisters
 *     assist_share: number           # Percentage for assisters
 */

import { MechanicHooks, CombatHookContext, CombatHookResult, StateChanges } from './types';
import { addResource } from './core/resources';

interface KillStealConfig {
  bounty_type?: 'fixed' | 'percentage' | 'unit_value';
  bounty_amount?: number;
  credit_assists?: boolean;
  assist_share?: number;
}

interface CombatParticipant {
  playerId: string;
  damageDealt: number;
  isKiller: boolean;
}

interface KillRecord {
  victim: string;
  killer: string;
  assisters: string[];
  bounty: number;
  turnNumber: number;
}

export const killStealMechanic: MechanicHooks = {
  slug: 'kill-steal',
  name: 'Kill Steal',
  requires: ['resources'],

  configSchema: {
    type: 'object',
    description: 'Rewards for landing final blows',
    properties: {
      bounty_type: {
        type: 'string',
        enum: ['fixed', 'percentage', 'unit_value'],
        description: 'How bounty is calculated',
        default: 'fixed'
      },
      bounty_amount: {
        type: 'number',
        description: 'Bounty amount (or percentage)',
        default: 10
      },
      credit_assists: {
        type: 'boolean',
        description: 'Give partial credit to assisters',
        default: true
      },
      assist_share: {
        type: 'number',
        description: 'Percentage of bounty for assisters',
        default: 25
      }
    }
  },

  onCombatEnd(ctx: CombatHookContext, result: CombatHookResult): StateChanges | null {
    const config = ctx.config.engine_mechanics?.kill_steal as KillStealConfig | undefined;
    if (!config) return null;

    // Only process if there were casualties
    if (!result.defenderLosses || result.defenderLosses <= 0) return null;

    const bountyType = config.bounty_type ?? 'fixed';
    const bountyAmount = config.bounty_amount ?? 10;
    const creditAssists = config.credit_assists ?? true;
    const assistShare = config.assist_share ?? 25;

    // Calculate bounty
    let bounty: number;
    switch (bountyType) {
      case 'fixed':
        bounty = bountyAmount;
        break;
      case 'percentage':
        // Percentage of defender's value
        const defenderValue = (ctx.state.shared.unitValues as Record<string, number>)?.[ctx.defenderId] ?? 100;
        bounty = Math.floor(defenderValue * (bountyAmount / 100));
        break;
      case 'unit_value':
        bounty = (ctx.state.shared.unitValues as Record<string, number>)?.[ctx.defenderId] ?? bountyAmount;
        break;
      default:
        bounty = bountyAmount;
    }

    // Track combat participants
    const combatParticipants = (ctx.state.shared.combatParticipants as CombatParticipant[]) ?? [];
    const killer = ctx.attackerId;
    const assisters = combatParticipants
      .filter(p => p.playerId !== killer && p.damageDealt > 0)
      .map(p => p.playerId);

    // Record the kill
    const killRecords = [...((ctx.state.shared.killRecords as KillRecord[]) ?? [])];
    killRecords.push({
      victim: ctx.defenderId,
      killer,
      assisters,
      bounty,
      turnNumber: ctx.state.turnNumber
    });

    // Distribute bounty via resource service (fires hooks)
    const playerStateChanges: Record<string, Partial<{ score: number }>> = {};

    // Killer gets main bounty
    const killerState = ctx.state.players[killer];
    addResource(ctx.state, killer, 'gold', bounty);
    playerStateChanges[killer] = {
      score: (killerState?.score ?? 0) + bounty
    };

    // Assisters get partial credit
    if (creditAssists && assisters.length > 0) {
      const assistBounty = Math.floor(bounty * (assistShare / 100));
      for (const assister of assisters) {
        const assisterState = ctx.state.players[assister];
        addResource(ctx.state, assister, 'gold', assistBounty);
        playerStateChanges[assister] = {
          score: (assisterState?.score ?? 0) + assistBounty
        };
      }
    }

    return {
      sharedStateChanges: {
        killRecords,
        combatParticipants: [] // Clear for next combat
      },
      playerStateChanges: playerStateChanges as Record<string, Partial<import('../types/game').PlayerState>>
    };
  },

  onResolveCombat(ctx: CombatHookContext, attackValue: number, defenseValue: number): CombatHookResult | null {
    const config = ctx.config.engine_mechanics?.kill_steal as KillStealConfig | undefined;
    if (!config) return null;

    // Track damage dealt by attacker for assist calculations
    const combatParticipants = [...((ctx.state.shared.combatParticipants as CombatParticipant[]) ?? [])];

    // Find or create participant record
    const existingIndex = combatParticipants.findIndex(p => p.playerId === ctx.attackerId);
    if (existingIndex >= 0) {
      combatParticipants[existingIndex].damageDealt += attackValue;
    } else {
      combatParticipants.push({
        playerId: ctx.attackerId,
        damageDealt: attackValue,
        isKiller: false
      });
    }

    // Don't override combat resolution, just track participation
    return null;
  }
};
