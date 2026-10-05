/**
 * Roles with Asymmetric Information Mechanic
 *
 * Different roles have access to different information about the game state.
 * Extends hidden-roles with information asymmetry.
 *
 * Config:
 *   roles_asymmetric_info:
 *     roles: Record<string, {
 *       can_see: string[]           # Info types this role can see
 *       knows_roles_of: string[]    # Roles whose identity they know
 *       special_knowledge?: string  # Special info only this role knows
 *     }>
 *
 * Hooks used:
 * - canSeeInfo: Filter info based on role
 * - getVisibleState: Customize visible state per role
 */

import { MechanicHooks, VisibilityContext, VisibleState } from './types';
import { PlayerState } from '../types/game';

interface RoleInfoConfig {
  can_see: string[];
  knows_roles_of: string[];
  special_knowledge?: string;
}

interface AsymmetricInfoConfig {
  roles: Record<string, RoleInfoConfig>;
}

export const rolesAsymmetricInfoMechanic: MechanicHooks = {
  slug: 'roles-with-asymmetric-information',
  name: 'Roles with Asymmetric Information',

  requires: ['hidden-roles', 'visibility'],

  configSchema: {
    type: 'object',
    description: 'Different roles have access to different information',
    properties: {
      roles: {
        type: 'object',
        description: 'Role configurations with information access',
        required: true
      }
    },
    required: ['roles']
  },

  canSeeInfo(ctx: VisibilityContext, infoType: string, targetPlayerId?: string): boolean | undefined {
    const config = ctx.config.engine_mechanics?.roles_asymmetric_info as AsymmetricInfoConfig | undefined;
    if (!config) return undefined;

    // Get viewer's role
    const viewer = ctx.state.players[ctx.viewerPlayerId];
    const viewerRole = (viewer as { role?: string }).role ??
                       (viewer as { hiddenRole?: string }).hiddenRole;

    if (!viewerRole || !config.roles[viewerRole]) {
      return undefined;  // Role not configured, defer to other mechanics
    }

    const roleConfig = config.roles[viewerRole];

    // Check if trying to see another player's role
    if (infoType === 'role' && targetPlayerId) {
      const targetPlayer = ctx.state.players[targetPlayerId];
      const targetRole = (targetPlayer as { role?: string }).role ??
                        (targetPlayer as { hiddenRole?: string }).hiddenRole;

      // Can always see own role
      if (targetPlayerId === ctx.viewerPlayerId) return true;

      // Check if this role knows target's role
      if (targetRole && roleConfig.knows_roles_of.includes(targetRole)) {
        return true;
      }

      return false;  // Cannot see this role
    }

    // Check general info type visibility
    if (roleConfig.can_see.includes(infoType)) {
      return true;
    }

    if (roleConfig.can_see.includes('all')) {
      return true;
    }

    // Check if explicitly excluded
    if (roleConfig.can_see.length > 0 && !roleConfig.can_see.includes(infoType)) {
      // Has explicit can_see list but doesn't include this type
      // Only return false if this is a restricted type
      const restrictedTypes = ['solution', 'hidden_hand', 'secret_objective', 'other_roles'];
      if (restrictedTypes.includes(infoType)) {
        return false;
      }
    }

    return undefined;  // Defer to other mechanics
  },

  getVisibleState(ctx: VisibilityContext): VisibleState | null {
    const config = ctx.config.engine_mechanics?.roles_asymmetric_info as AsymmetricInfoConfig | undefined;
    if (!config) return null;

    // Get viewer's role
    const viewer = ctx.state.players[ctx.viewerPlayerId];
    const viewerRole = (viewer as { role?: string }).role ??
                       (viewer as { hiddenRole?: string }).hiddenRole;

    if (!viewerRole || !config.roles[viewerRole]) {
      return null;
    }

    const roleConfig = config.roles[viewerRole];
    const visibleState: VisibleState = {
      players: {},
      visibilityMeta: {
        hiddenInfo: []
      }
    };

    // Build visible player state based on role's knowledge
    for (const [playerId, player] of Object.entries(ctx.state.players)) {
      const targetRole = (player as { role?: string }).role ??
                        (player as { hiddenRole?: string }).hiddenRole;

      const visiblePlayer: Partial<PlayerState> = {
        state: player.state,
        resources: player.resources,
        score: player.score
      };

      // Include role if known
      if (playerId === ctx.viewerPlayerId) {
        // Always see own role
        (visiblePlayer as { role?: string }).role = targetRole;
      } else if (targetRole && roleConfig.knows_roles_of.includes(targetRole)) {
        // This role can see the target's role
        (visiblePlayer as { role?: string }).role = targetRole;
      } else {
        // Hide role
        visibleState.visibilityMeta!.hiddenInfo!.push(`${playerId}.role`);
      }

      // Add special knowledge if this is the viewer
      if (playerId === ctx.viewerPlayerId && roleConfig.special_knowledge) {
        (visiblePlayer as { specialKnowledge?: string }).specialKnowledge = roleConfig.special_knowledge;
      }

      visibleState.players![playerId] = visiblePlayer;
    }

    return visibleState;
  }
};
