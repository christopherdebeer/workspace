/**
 * Tableau Building Mechanic
 *
 * Players build a personal tableau of cards/tiles that provide ongoing benefits.
 * Cards in the tableau grant resources, abilities, or scoring at various triggers.
 *
 * Config:
 *   tableau_building:
 *     max_size: number               # Maximum tableau size
 *     placement_cost: Record<string, number>  # Resource cost to place
 *     score_per_card: number          # Points per card in tableau
 *     synergy_bonuses: SynergyBonus[] # Bonuses for card combinations
 */

import { MechanicHooks, HookContext, ValidationResult, ActionExecutionContext, ActionExecutionResult, AvailableAction, StateChanges, SharedStateInitContext, SharedStateInitResult, PlayerInitContext, PlayerInitResult, TurnStartContext } from './types';
import { GameAction, GameConfig, Card, PlayerState } from '../types/game';

interface TableauBuildingConfig {
  max_size?: number;
  placement_cost?: Record<string, number>;
  score_per_card?: number;
  synergy_bonuses?: SynergyBonus[];
  income_per_card_type?: Record<string, Record<string, number>>;
}

interface SynergyBonus {
  card_types: string[];
  bonus_type: 'score' | 'resource' | 'draw';
  amount: number;
  resource?: string;
}

function getConfig(config: GameConfig): TableauBuildingConfig | undefined {
  return config.engine_mechanics?.tableau_building as TableauBuildingConfig | undefined;
}

function getPlayerTableau(player: PlayerState): Card[] {
  return (player as unknown as Record<string, unknown>).tableau as Card[] ?? [];
}

export const tableauBuildingMechanic: MechanicHooks = {
  slug: 'tableau-building',
  name: 'Tableau Building',
  requires: ['cards'],

  configSchema: {
    type: 'object',
    description: 'Build a personal tableau of cards for ongoing benefits',
    properties: {
      max_size: {
        type: 'number',
        description: 'Maximum cards in tableau',
        default: 10
      },
      placement_cost: {
        type: 'object',
        description: 'Resource cost to add card to tableau'
      },
      score_per_card: {
        type: 'number',
        description: 'Points per card in tableau at game end',
        default: 0
      },
      synergy_bonuses: {
        type: 'array',
        description: 'Bonus for having certain card type combinations'
      },
      income_per_card_type: {
        type: 'object',
        description: 'Resources gained per turn per card type in tableau'
      }
    }
  },

  initPlayerState(ctx: PlayerInitContext): PlayerInitResult | null {
    const config = getConfig(ctx.config);
    if (!config) return null;

    return {
      tableau: []
    };
  },

  preValidateAction(ctx: HookContext, action: GameAction): ValidationResult | null {
    if (action.type !== 'add_to_tableau') return null;

    const config = getConfig(ctx.config);
    if (!config) return { valid: false, error: 'Tableau building not enabled.' };

    const tableauAction = action as unknown as { type: 'add_to_tableau'; card: string };

    if (!tableauAction.card) {
      return { valid: false, error: 'Must specify card to add to tableau.' };
    }

    // Check hand
    const hasCard = (ctx.player.hand ?? []).some(c => c.name === tableauAction.card);
    if (!hasCard) {
      return { valid: false, error: `Card '${tableauAction.card}' not in hand.` };
    }

    // Check tableau size
    const tableau = getPlayerTableau(ctx.player);
    const maxSize = config.max_size ?? 10;
    if (tableau.length >= maxSize) {
      return { valid: false, error: `Tableau is full (${maxSize} cards maximum).` };
    }

    // Check placement cost
    if (config.placement_cost) {
      const resources = (ctx.player.resources as Record<string, number>) ?? {};
      for (const [resource, cost] of Object.entries(config.placement_cost)) {
        const available = resources[resource] ?? 0;
        if (available < cost) {
          return { valid: false, error: `Not enough ${resource}. Need ${cost}, have ${available}.` };
        }
      }
    }

    return { valid: true };
  },

  onExecuteAction(ctx: ActionExecutionContext): ActionExecutionResult | null {
    if (ctx.action.type !== 'add_to_tableau') return null;

    const config = getConfig(ctx.config);
    if (!config) return null;

    const tableauAction = ctx.action as unknown as { type: 'add_to_tableau'; card: string };

    // Find card in hand
    const playerHand = ctx.state.players[ctx.playerId].hand ?? [];
    const cardIndex = playerHand.findIndex(c => c.name === tableauAction.card);
    if (cardIndex === -1) return null;

    const card = playerHand[cardIndex];
    const newHand = [...playerHand];
    newHand.splice(cardIndex, 1);

    // Add to tableau
    const tableau = [...getPlayerTableau(ctx.state.players[ctx.playerId])];
    tableau.push(card);

    // Deduct placement cost
    const resources = { ...((ctx.state.players[ctx.playerId].resources as Record<string, number>) ?? {}) };
    if (config.placement_cost) {
      for (const [resource, cost] of Object.entries(config.placement_cost)) {
        resources[resource] = (resources[resource] ?? 0) - cost;
      }
    }

    // Check synergy bonuses
    let bonusMessage = '';
    if (config.synergy_bonuses) {
      for (const synergy of config.synergy_bonuses) {
        const tableauTypes = tableau.map(c => c.type);
        const hasAll = synergy.card_types.every(t => tableauTypes.includes(t));
        if (hasAll) {
          if (synergy.bonus_type === 'resource' && synergy.resource) {
            resources[synergy.resource] = (resources[synergy.resource] ?? 0) + synergy.amount;
            bonusMessage += ` Synergy bonus: +${synergy.amount} ${synergy.resource}!`;
          } else if (synergy.bonus_type === 'score') {
            bonusMessage += ` Synergy bonus: +${synergy.amount} points!`;
          }
        }
      }
    }

    return {
      handled: true,
      stateChanges: {
        playerStateChanges: {
          [ctx.playerId]: {
            hand: newHand,
            tableau: tableau as unknown as undefined, // Will be merged into player state
            resources
          }
        }
      },
      advanceTurn: false,
      checkWin: false,
      logMessage: `${ctx.playerId} added ${tableauAction.card} to their tableau (${tableau.length} cards).${bonusMessage}`
    };
  },

  onTurnStart(ctx: TurnStartContext): StateChanges | null {
    const config = getConfig(ctx.config);
    if (!config || !config.income_per_card_type) return null;

    const tableau = getPlayerTableau(ctx.player);
    if (tableau.length === 0) return null;

    const resources = { ...((ctx.player.resources as Record<string, number>) ?? {}) };
    let gained = false;

    for (const card of tableau) {
      const income = config.income_per_card_type[card.type];
      if (income) {
        for (const [resource, amount] of Object.entries(income)) {
          resources[resource] = (resources[resource] ?? 0) + amount;
          gained = true;
        }
      }
    }

    if (!gained) return null;

    return {
      playerStateChanges: {
        [ctx.playerId]: { resources }
      }
    };
  },

  getAvailableActions(ctx: HookContext): AvailableAction[] {
    const config = getConfig(ctx.config);
    if (!config) return [];

    const tableau = getPlayerTableau(ctx.player);
    const maxSize = config.max_size ?? 10;
    if (tableau.length >= maxSize) return [];
    if ((ctx.player.hand ?? []).length === 0) return [];

    // Check if player can afford placement
    if (config.placement_cost) {
      const resources = (ctx.player.resources as Record<string, number>) ?? {};
      for (const [resource, cost] of Object.entries(config.placement_cost)) {
        if ((resources[resource] ?? 0) < cost) return [];
      }
    }

    return [{
      action: {
        type: 'add_to_tableau',
        card: ''
      } as unknown as GameAction,
      priority: 75,
      category: 'building'
    }];
  },

  getPlayerView(ctx: HookContext): Record<string, unknown> | null {
    const config = getConfig(ctx.config);
    if (!config) return null;

    const tableau = getPlayerTableau(ctx.player);

    return {
      tableau,
      tableauSize: tableau.length,
      tableauMaxSize: config.max_size ?? 10
    };
  },

  describeAction(action: GameAction): { type: string; label: string; description: string; examples?: string[] } | null {
    if (action.type === 'add_to_tableau') {
      return {
        type: 'add_to_tableau',
        label: 'Add Card to Tableau',
        description: 'Place a card from hand into your personal tableau for ongoing benefits.',
        examples: ['add_to_tableau card:"Farm"']
      };
    }
    return null;
  }
};
