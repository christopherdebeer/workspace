/**
 * Advantage Token Mechanic
 *
 * Tokens that grant one-time advantages, optionally passed between players after use.
 * Players can spend tokens for bonuses during their turn.
 *
 * Hooks used:
 * - initSharedState: Create advantage tokens
 * - getAvailableActions: 'use_advantage' action
 * - onExecuteAction: Use token for bonus
 * - getPlayerView: Show tokens
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

interface TokenDefinition {
  id: string;
  name: string;
  effect: string;
}

interface AdvantageTokenConfig {
  tokens: TokenDefinition[];
  pass_on_use?: boolean;  // token passes to next player after use
}

interface TokenInstance {
  tokenId: string;
  name: string;
  effect: string;
  heldBy: string | null;  // playerId or null if unclaimed
  used: boolean;
}

interface AdvantageTokenState {
  tokens: TokenInstance[];
}

function getConfig(config: GameConfig): AdvantageTokenConfig | undefined {
  return config.engine_mechanics?.advantage_token as AdvantageTokenConfig | undefined;
}

function getTokenState(shared: Record<string, unknown>): AdvantageTokenState | undefined {
  return shared.advantageTokens as AdvantageTokenState | undefined;
}

export const advantageTokenMechanic: MechanicHooks = {
  slug: 'advantage-token',
  name: 'Advantage Token',

  configSchema: {
    type: 'object',
    description: 'One-time advantage tokens that can be passed between players',
    properties: {
      tokens: {
        type: 'array',
        description: 'Token definitions with id, name, and effect description',
        required: true
      },
      pass_on_use: {
        type: 'boolean',
        description: 'Token passes to next player after use',
        default: false
      }
    },
    required: ['tokens']
  },

  /**
   * Create advantage tokens and distribute to first players
   */
  initSharedState(ctx: SharedStateInitContext): SharedStateInitResult | null {
    const config = getConfig(ctx.config);
    if (!config?.tokens?.length) return null;

    // Create token instances and assign to players round-robin
    const tokens: TokenInstance[] = config.tokens.map((def, index) => ({
      tokenId: def.id,
      name: def.name,
      effect: def.effect,
      heldBy: ctx.playerIds[index % ctx.playerIds.length] ?? null,
      used: false
    }));

    const tokenState: AdvantageTokenState = { tokens };

    return { advantageTokens: tokenState };
  },

  /**
   * Provide 'use_advantage' action for tokens held by this player
   */
  getAvailableActions(ctx: HookContext): AvailableAction[] {
    if (!isMechanicEnabled(ctx.config, 'advantage-token')) return [];

    const tokenState = getTokenState(ctx.state.shared);
    if (!tokenState) return [];

    const actions: AvailableAction[] = [];

    // Find tokens held by this player that haven't been used
    const heldTokens = tokenState.tokens.filter(
      t => t.heldBy === ctx.playerId && !t.used
    );

    for (const token of heldTokens) {
      actions.push({
        action: {
          type: 'use_advantage',
          tokenId: token.tokenId
        } as unknown as GameAction,
        priority: 45,
        category: 'advantage-token'
      });
    }

    return actions;
  },

  /**
   * Handle using an advantage token
   */
  onExecuteAction(ctx: ActionExecutionContext): ActionExecutionResult | null {
    if (ctx.action.type !== 'use_advantage') return null;

    const config = getConfig(ctx.config);
    if (!config?.tokens?.length) return null;

    const useAction = ctx.action as unknown as { type: 'use_advantage'; tokenId: string };
    const tokenState = getTokenState(ctx.state.shared);
    if (!tokenState) return null;

    // Find the token
    const token = tokenState.tokens.find(t => t.tokenId === useAction.tokenId);
    if (!token) {
      return {
        handled: true,
        logMessage: `Token "${useAction.tokenId}" not found.`,
        advanceTurn: false,
        checkWin: false
      };
    }

    if (token.heldBy !== ctx.playerId) {
      return {
        handled: true,
        logMessage: `You do not hold token "${token.name}".`,
        advanceTurn: false,
        checkWin: false
      };
    }

    if (token.used) {
      return {
        handled: true,
        logMessage: `Token "${token.name}" has already been used.`,
        advanceTurn: false,
        checkWin: false
      };
    }

    // Determine who gets the token next (if pass_on_use)
    let nextHolder: string | null = null;
    if (config.pass_on_use) {
      const turnOrder = ctx.state.turnOrder;
      const currentIndex = turnOrder.indexOf(ctx.playerId);
      if (currentIndex !== -1) {
        nextHolder = turnOrder[(currentIndex + 1) % turnOrder.length];
      }
    }

    // Update token state
    const updatedTokens = tokenState.tokens.map(t => {
      if (t.tokenId !== useAction.tokenId) return t;
      return {
        ...t,
        used: !config.pass_on_use, // If passed, it's reusable by next holder
        heldBy: config.pass_on_use ? nextHolder : t.heldBy
      };
    });

    return {
      handled: true,
      stateChanges: {
        sharedStateChanges: {
          advantageTokens: { tokens: updatedTokens }
        }
      },
      advanceTurn: false, // Using a token doesn't end turn
      checkWin: false,
      logMessage: 'advantage_token_used',
      logData: {
        player: ctx.playerId,
        token: token.name,
        effect: token.effect,
        passedTo: nextHolder
      }
    };
  },

  /**
   * Show token information in player view
   */
  getPlayerView(ctx: HookContext): Record<string, unknown> | null {
    if (!isMechanicEnabled(ctx.config, 'advantage-token')) return null;

    const tokenState = getTokenState(ctx.state.shared);
    if (!tokenState) return null;

    const myTokens = tokenState.tokens
      .filter(t => t.heldBy === ctx.playerId && !t.used)
      .map(t => ({ id: t.tokenId, name: t.name, effect: t.effect }));

    const allTokenLocations = tokenState.tokens.map(t => ({
      id: t.tokenId,
      name: t.name,
      heldBy: t.heldBy,
      used: t.used
    }));

    return {
      myAdvantageTokens: myTokens,
      allTokens: allTokenLocations
    };
  }
};
