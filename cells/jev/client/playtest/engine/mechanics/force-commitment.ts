/**
 * Force Commitment Mechanic
 *
 * Players must commit forces before seeing combat resolution.
 *
 * Config:
 *   force_commitment:
 *     simultaneous: boolean      # Both sides commit at same time
 *     revealed_after_commit: boolean  # Forces visible after commitment
 *     commitment_binding: boolean     # Can't change after commit
 */

import { MechanicHooks, HookContext, ValidationResult, ActionExecutionContext, ActionExecutionResult, AvailableAction, CombatHookContext, StateChanges } from './types';
import { GameAction } from '../types/game';

interface ForceCommitmentConfig {
  simultaneous?: boolean;
  revealed_after_commit?: boolean;
  commitment_binding?: boolean;
}

interface CommitForcesAction {
  type: 'commit_forces';
  unitIds: string[];
  combatId: string;
}

interface CommitmentState {
  combatId: string;
  attackerCommitted: boolean;
  defenderCommitted: boolean;
  attackerForces: string[];
  defenderForces: string[];
  phase: 'committing' | 'resolved';
}

export const forceCommitmentMechanic: MechanicHooks = {
  slug: 'force-commitment',
  name: 'Force Commitment',
  requires: ['combat'],

  configSchema: {
    type: 'object',
    description: 'Commit forces before combat resolution',
    properties: {
      simultaneous: {
        type: 'boolean',
        description: 'Both sides commit at same time (hidden)',
        default: true
      },
      revealed_after_commit: {
        type: 'boolean',
        description: 'Forces revealed after both commit',
        default: true
      },
      commitment_binding: {
        type: 'boolean',
        description: 'Cannot change commitment after submitting',
        default: true
      }
    }
  },

  preValidateAction(ctx: HookContext, action: GameAction): ValidationResult | null {
    if (action.type !== 'commit_forces') return null;

    const config = ctx.config.engine_mechanics?.force_commitment as ForceCommitmentConfig | undefined;
    if (!config) return { valid: false, error: 'Force commitment not enabled.' };

    const commitAction = action as unknown as CommitForcesAction;
    const commitment = ctx.state.shared.forceCommitment as CommitmentState | undefined;

    if (!commitment || commitment.phase === 'resolved') {
      return { valid: false, error: 'No active combat requiring commitment.' };
    }

    const activeCombat = ctx.state.shared.activeCombat as { attackerId: string; defenderId: string } | undefined;
    if (!activeCombat) {
      return { valid: false, error: 'No active combat.' };
    }

    const isAttacker = ctx.playerId === activeCombat.attackerId;
    const isDefender = ctx.playerId === activeCombat.defenderId;

    if (!isAttacker && !isDefender) {
      return { valid: false, error: 'You are not involved in this combat.' };
    }

    if (isAttacker && commitment.attackerCommitted && config.commitment_binding !== false) {
      return { valid: false, error: 'You have already committed forces.' };
    }

    if (isDefender && commitment.defenderCommitted && config.commitment_binding !== false) {
      return { valid: false, error: 'You have already committed forces.' };
    }

    // Validate unit ownership
    const playerUnits = (ctx.state.shared.units as Record<string, { id: string }[]>)?.[ctx.playerId] ?? [];
    const playerUnitIds = playerUnits.map(u => u.id);

    for (const unitId of commitAction.unitIds) {
      if (!playerUnitIds.includes(unitId)) {
        return { valid: false, error: `Unit ${unitId} is not yours.` };
      }
    }

    return { valid: true };
  },

  onExecuteAction(ctx: ActionExecutionContext): ActionExecutionResult | null {
    if (ctx.action.type !== 'commit_forces') return null;

    const config = ctx.config.engine_mechanics?.force_commitment as ForceCommitmentConfig;
    const commitAction = ctx.action as unknown as CommitForcesAction;
    const commitment = ctx.state.shared.forceCommitment as CommitmentState;
    const activeCombat = ctx.state.shared.activeCombat as { attackerId: string; defenderId: string };

    const isAttacker = ctx.playerId === activeCombat.attackerId;

    // Update commitment
    if (isAttacker) {
      commitment.attackerCommitted = true;
      commitment.attackerForces = commitAction.unitIds;
    } else {
      commitment.defenderCommitted = true;
      commitment.defenderForces = commitAction.unitIds;
    }

    const bothCommitted = commitment.attackerCommitted && commitment.defenderCommitted;

    if (bothCommitted) {
      commitment.phase = 'resolved';
    }

    const stateChanges: StateChanges = {
      sharedStateChanges: {
        forceCommitment: commitment
      }
    };

    // If both committed, update the combat with forces
    if (bothCommitted) {
      stateChanges.sharedStateChanges!.activeCombat = {
        ...activeCombat,
        attackerUnits: commitment.attackerForces,
        defenderUnits: commitment.defenderForces
      };
    }

    return {
      handled: true,
      stateChanges,
      advanceTurn: false,
      checkWin: false,
      logMessage: bothCommitted
        ? `${ctx.playerId} committed forces. Both sides ready - combat resolves!`
        : `${ctx.playerId} committed forces to combat.`
    };
  },

  onCombatStart(ctx: CombatHookContext): StateChanges | null {
    const config = ctx.config.engine_mechanics?.force_commitment as ForceCommitmentConfig | undefined;
    if (!config) return null;

    // Initialize commitment tracking
    const commitment: CommitmentState = {
      combatId: (ctx.state.shared.activeCombat as { id: string }).id,
      attackerCommitted: false,
      defenderCommitted: false,
      attackerForces: [],
      defenderForces: [],
      phase: 'committing'
    };

    return {
      sharedStateChanges: {
        forceCommitment: commitment
      }
    };
  },

  getAvailableActions(ctx: HookContext): AvailableAction[] {
    const config = ctx.config.engine_mechanics?.force_commitment as ForceCommitmentConfig | undefined;
    if (!config) return [];

    const commitment = ctx.state.shared.forceCommitment as CommitmentState | undefined;
    if (!commitment || commitment.phase !== 'committing') return [];

    const activeCombat = ctx.state.shared.activeCombat as { attackerId: string; defenderId: string } | undefined;
    if (!activeCombat) return [];

    const isAttacker = ctx.playerId === activeCombat.attackerId;
    const isDefender = ctx.playerId === activeCombat.defenderId;

    if (!isAttacker && !isDefender) return [];

    // Check if already committed
    if (isAttacker && commitment.attackerCommitted) return [];
    if (isDefender && commitment.defenderCommitted) return [];

    return [{
      action: {
        type: 'commit_forces',
        unitIds: [],  // Player fills in
        combatId: commitment.combatId
      } as unknown as GameAction,
      priority: 95,
      category: 'combat'
    }];
  }
};
