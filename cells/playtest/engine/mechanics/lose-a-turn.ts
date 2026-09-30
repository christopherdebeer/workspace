/**
 * Lose-a-Turn Mechanic
 *
 * Skip actions via card effects (block_turn, skip, etc.).
 * Checks player effects to determine if they're blocked from acting.
 *
 * Hooks used:
 * - preValidateAction: Block all actions except pass when player has blocking effect
 * - isPlayerBlocked: Report whether player is blocked (for game.ts agnosticism)
 */

import { MechanicHooks, HookContext, ValidationResult } from './types';
import { GameAction } from '../types/game';

const BLOCKING_EFFECT_TYPES = ['block_turn', 'block', 'skip', 'lose_turn'];

export const loseATurnMechanic: MechanicHooks = {
  slug: 'lose-a-turn',
  name: 'Lose a Turn',
  requires: ['effects'],

  /**
   * Check if player is blocked from taking actions.
   * Used by game.ts to determine if player can act.
   */
  isPlayerBlocked(ctx: HookContext): boolean | null {
    const hasBlockingEffect = ctx.player.effects.some(e => {
      const effectType = e.type.toLowerCase();
      return BLOCKING_EFFECT_TYPES.includes(effectType);
    });

    // Return true if blocked, null to defer to other mechanics
    return hasBlockingEffect ? true : null;
  },

  preValidateAction(ctx: HookContext, action: GameAction): ValidationResult | null {
    // Pass is always allowed (it's how blocked players end their turn)
    if (action.type === 'pass') return null;

    // Check for blocking effects on the player
    const blockingEffects = ctx.player.effects.filter(e => {
      const effectType = e.type.toLowerCase();
      return BLOCKING_EFFECT_TYPES.includes(effectType);
    });

    if (blockingEffects.length > 0) {
      const effectNames = blockingEffects.map(e => e.type).join(', ');
      return {
        valid: false,
        error: `You are blocked this turn by effect: ${effectNames}. You can only pass.`
      };
    }

    return null;
  }
};
