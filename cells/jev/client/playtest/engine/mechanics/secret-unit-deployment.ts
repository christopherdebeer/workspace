/**
 * Secret Unit Deployment Mechanic
 *
 * Units are deployed face-down and revealed during combat.
 *
 * Config:
 *   secret_deployment:
 *     reveal_on_combat: boolean     # Reveal when entering combat
 *     reveal_on_adjacent: boolean   # Reveal when adjacent to enemy
 *     allow_bluffing: boolean       # Allow dummy/decoy units
 *     reveal_cost: number           # Cost to reveal enemy unit
 */

import { MechanicHooks, HookContext, ValidationResult, ActionExecutionContext, ActionExecutionResult, AvailableAction, StateChanges, CombatHookContext } from './types';
import { GameAction } from '../types/game';

interface SecretDeploymentConfig {
  reveal_on_combat?: boolean;
  reveal_on_adjacent?: boolean;
  allow_bluffing?: boolean;
  reveal_cost?: number;
}

interface DeploySecretAction {
  type: 'deploy_secret';
  unitId: string;
  position: string;
  isDecoy?: boolean;
}

interface RevealUnitAction {
  type: 'reveal_unit';
  targetUnitId: string;
}

interface SecretUnit {
  id: string;
  owner: string;
  position: string;
  revealed: boolean;
  isDecoy: boolean;
  actualType?: string;
}

export const secretUnitDeploymentMechanic: MechanicHooks = {
  slug: 'secret-unit-deployment',
  requires: ['combat', 'visibility'],
  name: 'Secret Unit Deployment',

  configSchema: {
    type: 'object',
    description: 'Face-down unit deployment',
    properties: {
      reveal_on_combat: {
        type: 'boolean',
        description: 'Reveal units when combat occurs',
        default: true
      },
      reveal_on_adjacent: {
        type: 'boolean',
        description: 'Reveal when adjacent to enemy',
        default: false
      },
      allow_bluffing: {
        type: 'boolean',
        description: 'Allow decoy/dummy units',
        default: false
      },
      reveal_cost: {
        type: 'number',
        description: 'Cost to scout/reveal enemy unit',
        default: 1
      }
    }
  },

  preValidateAction(ctx: HookContext, action: GameAction): ValidationResult | null {
    if (action.type !== 'deploy_secret' && action.type !== 'reveal_unit') return null;

    const config = ctx.config.engine_mechanics?.secret_deployment as SecretDeploymentConfig | undefined;
    if (!config) return { valid: false, error: 'Secret deployment not enabled.' };

    if (action.type === 'deploy_secret') {
      const deployAction = action as unknown as DeploySecretAction;

      if (deployAction.isDecoy && !config.allow_bluffing) {
        return { valid: false, error: 'Decoy units are not allowed in this game.' };
      }

      // Validate unit exists and is owned by player
      const playerUnits = (ctx.state.shared.unitsAvailable as Record<string, string[]>)?.[ctx.playerId] ?? [];
      if (!playerUnits.includes(deployAction.unitId)) {
        return { valid: false, error: `Unit ${deployAction.unitId} is not available for deployment.` };
      }
    }

    if (action.type === 'reveal_unit') {
      const revealAction = action as unknown as RevealUnitAction;
      const secretUnits = (ctx.state.shared.secretUnits as SecretUnit[]) ?? [];
      const targetUnit = secretUnits.find(u => u.id === revealAction.targetUnitId);

      if (!targetUnit) {
        return { valid: false, error: 'Target unit not found.' };
      }

      if (targetUnit.revealed) {
        return { valid: false, error: 'Unit is already revealed.' };
      }

      if (targetUnit.owner === ctx.playerId) {
        return { valid: false, error: 'Cannot spend resources to reveal your own unit.' };
      }

      // Check cost
      const revealCost = config.reveal_cost ?? 1;
      const playerResources = ctx.state.players[ctx.playerId]?.resources ?? {};
      const gold = (playerResources as Record<string, number>)['gold'] ?? 0;
      if (gold < revealCost) {
        return { valid: false, error: `Not enough resources to reveal unit. Need ${revealCost} gold.` };
      }
    }

    return { valid: true };
  },

  onExecuteAction(ctx: ActionExecutionContext): ActionExecutionResult | null {
    if (ctx.action.type !== 'deploy_secret' && ctx.action.type !== 'reveal_unit') return null;

    const config = ctx.config.engine_mechanics?.secret_deployment as SecretDeploymentConfig;

    if (ctx.action.type === 'deploy_secret') {
      const deployAction = ctx.action as unknown as DeploySecretAction;
      const secretUnits = [...((ctx.state.shared.secretUnits as SecretUnit[]) ?? [])];

      const newUnit: SecretUnit = {
        id: deployAction.unitId,
        owner: ctx.playerId,
        position: deployAction.position,
        revealed: false,
        isDecoy: deployAction.isDecoy ?? false
      };

      secretUnits.push(newUnit);

      return {
        handled: true,
        stateChanges: {
          sharedStateChanges: {
            secretUnits
          }
        },
        advanceTurn: false,
        checkWin: false,
        logMessage: `${ctx.playerId} deployed a unit to ${deployAction.position}.`
      };
    }

    if (ctx.action.type === 'reveal_unit') {
      const revealAction = ctx.action as unknown as RevealUnitAction;
      const secretUnits = [...((ctx.state.shared.secretUnits as SecretUnit[]) ?? [])];
      const unitIndex = secretUnits.findIndex(u => u.id === revealAction.targetUnitId);

      if (unitIndex >= 0) {
        secretUnits[unitIndex] = { ...secretUnits[unitIndex], revealed: true };
      }

      const revealCost = config.reveal_cost ?? 1;
      const playerResources = { ...((ctx.state.players[ctx.playerId]?.resources as Record<string, number>) ?? {}) };
      playerResources['gold'] = (playerResources['gold'] ?? 0) - revealCost;

      const revealedUnit = secretUnits[unitIndex];
      const message = revealedUnit.isDecoy
        ? `${ctx.playerId} revealed ${revealAction.targetUnitId} - it was a decoy!`
        : `${ctx.playerId} revealed ${revealAction.targetUnitId}.`;

      return {
        handled: true,
        stateChanges: {
          sharedStateChanges: { secretUnits },
          playerStateChanges: {
            [ctx.playerId]: { resources: playerResources }
          }
        },
        advanceTurn: false,
        checkWin: false,
        logMessage: message
      };
    }

    return null;
  },

  onCombatStart(ctx: CombatHookContext): StateChanges | null {
    const config = ctx.config.engine_mechanics?.secret_deployment as SecretDeploymentConfig | undefined;
    if (!config || !config.reveal_on_combat) return null;

    const secretUnits = [...((ctx.state.shared.secretUnits as SecretUnit[]) ?? [])];
    const combatLocation = ctx.territory;

    // Reveal all units at combat location
    let revealed = false;
    for (let i = 0; i < secretUnits.length; i++) {
      if (secretUnits[i].position === combatLocation && !secretUnits[i].revealed) {
        secretUnits[i] = { ...secretUnits[i], revealed: true };
        revealed = true;
      }
    }

    if (revealed) {
      return {
        sharedStateChanges: { secretUnits }
      };
    }

    return null;
  },

  getAvailableActions(ctx: HookContext): AvailableAction[] {
    const config = ctx.config.engine_mechanics?.secret_deployment as SecretDeploymentConfig | undefined;
    if (!config) return [];

    const actions: AvailableAction[] = [];

    // Check for available units to deploy
    const availableUnits = (ctx.state.shared.unitsAvailable as Record<string, string[]>)?.[ctx.playerId] ?? [];
    if (availableUnits.length > 0) {
      actions.push({
        action: {
          type: 'deploy_secret',
          unitId: '',
          position: ''
        } as unknown as GameAction,
        priority: 85,
        category: 'combat'
      });
    }

    // Check for revealable enemy units
    const secretUnits = (ctx.state.shared.secretUnits as SecretUnit[]) ?? [];
    const hiddenEnemyUnits = secretUnits.filter(u => u.owner !== ctx.playerId && !u.revealed);
    if (hiddenEnemyUnits.length > 0) {
      actions.push({
        action: {
          type: 'reveal_unit',
          targetUnitId: ''
        } as unknown as GameAction,
        priority: 80,
        category: 'combat'
      });
    }

    return actions;
  }
};
