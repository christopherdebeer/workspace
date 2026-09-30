/**
 * Multi-Use Cards Mechanic
 *
 * Cards that can be used in multiple ways, giving players choices about
 * how to utilize each card. Different uses typically discard/consume the card.
 *
 * Common in: Race for the Galaxy, Glory to Rome, San Juan, Concordia
 *
 * Use patterns:
 * - Play for ability (main use)
 * - Discard as payment/currency
 * - Tuck as production/goods
 * - Play as building/development
 *
 * Hooks used:
 * - preValidateAction: Validate card use is valid
 * - onExecuteAction: Execute the chosen card use
 * - getAvailableActions: Expose all valid uses for cards in hand
 * - describeAction: Describe the different use options
 */

import {
  MechanicHooks,
  HookContext,
  ValidationResult,
  ActionExecutionContext,
  ActionExecutionResult,
  AvailableAction,
  ActionDescription,
  StateChanges
} from './types';
import { GameAction, Card } from '../types/game';
import { addResource, spendResource } from './core/resources';

interface CardUse {
  /** Use type identifier */
  type: string;
  /** Display label */
  label: string;
  /** Description of what this use does */
  description?: string;
  /** Effect when used this way */
  effect?: {
    /** Resources gained */
    gain_resources?: Record<string, number>;
    /** Resources spent */
    spend_resources?: Record<string, number>;
    /** Points gained */
    gain_points?: number;
    /** Cards drawn */
    draw_cards?: number;
    /** Add effect to player */
    add_effect?: { type: string; duration?: number; [key: string]: unknown };
  };
  /** Condition for when this use is available */
  condition?: {
    /** Minimum resources required */
    min_resources?: Record<string, number>;
    /** Required game phase */
    phase?: string;
    /** Required player state */
    player_state?: Record<string, unknown>;
  };
}

interface CardDefinition {
  /** Card name (matches card.name) */
  name: string;
  /** Available uses for this card */
  uses: CardUse[];
}

interface MultiUseConfig {
  /** Card definitions with their uses */
  cards: CardDefinition[];
  /** Default uses available for all cards */
  default_uses?: CardUse[];
  /** Whether used cards go to discard or are removed */
  discard_on_use?: boolean;
  /** Allow using cards as generic currency */
  cards_as_currency?: boolean;
  /** Currency value per card */
  card_currency_value?: number;
}

function isMultiUseConfig(config: unknown): config is MultiUseConfig {
  return (
    typeof config === 'object' &&
    config !== null &&
    Array.isArray((config as MultiUseConfig).cards)
  );
}

function getCardDefinition(
  config: MultiUseConfig,
  cardName: string
): CardDefinition | undefined {
  return config.cards.find(c =>
    c.name === cardName ||
    c.name.toLowerCase() === cardName.toLowerCase()
  );
}

function getAvailableUses(
  ctx: HookContext,
  card: Card,
  config: MultiUseConfig
): CardUse[] {
  const uses: CardUse[] = [];

  // Get card-specific uses
  const cardDef = getCardDefinition(config, card.name);
  if (cardDef) {
    for (const use of cardDef.uses) {
      if (isUseAvailable(ctx, use)) {
        uses.push(use);
      }
    }
  }

  // Add default uses
  if (config.default_uses) {
    for (const use of config.default_uses) {
      if (isUseAvailable(ctx, use)) {
        uses.push(use);
      }
    }
  }

  // Add currency use if enabled
  if (config.cards_as_currency) {
    uses.push({
      type: 'currency',
      label: 'Use as Currency',
      description: `Discard for ${config.card_currency_value ?? 1} currency`
    });
  }

  return uses;
}

function isUseAvailable(ctx: HookContext, use: CardUse): boolean {
  if (!use.condition) return true;

  // Check resource requirements
  if (use.condition.min_resources) {
    const resources = ctx.player.resources || {};
    for (const [resource, amount] of Object.entries(use.condition.min_resources)) {
      if ((resources[resource] ?? 0) < amount) return false;
    }
  }

  // Check phase
  if (use.condition.phase) {
    const currentPhase = ctx.state.shared.phase as string | undefined;
    if (currentPhase !== use.condition.phase) return false;
  }

  // Check player state
  if (use.condition.player_state) {
    for (const [key, value] of Object.entries(use.condition.player_state)) {
      if ((ctx.player as unknown as Record<string, unknown>)[key] !== value) return false;
    }
  }

  return true;
}

function applyUseEffect(
  ctx: ActionExecutionContext,
  use: CardUse,
  card: Card
): StateChanges {
  const { playerId, player, state } = ctx;
  const changes: StateChanges = {
    playerStateChanges: {
      [playerId]: {}
    }
  };

  if (!use.effect) return changes;

  const playerChanges = changes.playerStateChanges![playerId];

  // Gain resources via resource service (fires hooks)
  if (use.effect.gain_resources) {
    for (const [resource, amount] of Object.entries(use.effect.gain_resources)) {
      addResource(state, playerId, resource, amount);
    }
  }

  // Spend resources via resource service (fires hooks)
  if (use.effect.spend_resources) {
    for (const [resource, amount] of Object.entries(use.effect.spend_resources)) {
      spendResource(state, playerId, resource, amount);
    }
  }

  // Gain points
  if (use.effect.gain_points) {
    playerChanges.score = (player.score ?? 0) + use.effect.gain_points;
  }

  // TODO: draw_cards and add_effect would need core service integration

  return changes;
}

export const multiUseCardsMechanic: MechanicHooks = {
  slug: 'multi-use-cards',
  name: 'Multi-Use Cards',
  requires: ['cards', 'resources'],

  configSchema: {
    type: 'object',
    description: 'Cards with multiple possible uses (Race for the Galaxy, Glory to Rome)',
    properties: {
      cards: {
        type: 'array',
        description: 'Card definitions with their available uses',
        required: true
      },
      default_uses: {
        type: 'array',
        description: 'Default uses available for all cards'
      },
      discard_on_use: {
        type: 'boolean',
        description: 'Whether used cards go to discard',
        default: true
      },
      cards_as_currency: {
        type: 'boolean',
        description: 'Allow using cards as generic currency',
        default: false
      },
      card_currency_value: {
        type: 'number',
        description: 'Currency value per card',
        default: 1
      }
    },
    required: ['cards']
  },

  preValidateAction(ctx: HookContext, action: GameAction): ValidationResult | null {
    if (action.type !== 'use_card') return null;

    const multiConfig = ctx.config.engine_mechanics?.multi_use_cards;
    if (!isMultiUseConfig(multiConfig)) return null;

    const useAction = action as { card: string; use: string };
    const hand = ctx.player.hand || [];

    // Find card in hand
    const card = hand.find(c =>
      c.name === useAction.card ||
      c.id === useAction.card
    );

    if (!card) {
      return {
        valid: false,
        error: `Card "${useAction.card}" not in hand`
      };
    }

    // Check if use type is valid for this card
    const availableUses = getAvailableUses(ctx, card, multiConfig);
    const selectedUse = availableUses.find(u => u.type === useAction.use);

    if (!selectedUse) {
      const validUses = availableUses.map(u => u.type).join(', ');
      return {
        valid: false,
        error: `Use type "${useAction.use}" not available for "${useAction.card}". Valid uses: ${validUses || 'none'}`
      };
    }

    // Check use-specific conditions
    if (selectedUse.condition?.min_resources) {
      const resources = ctx.player.resources || {};
      for (const [resource, amount] of Object.entries(selectedUse.condition.min_resources)) {
        if ((resources[resource] ?? 0) < amount) {
          return {
            valid: false,
            error: `Not enough ${resource} for "${selectedUse.label}". Need ${amount}`
          };
        }
      }
    }

    return { valid: true };
  },

  onExecuteAction(ctx: ActionExecutionContext): ActionExecutionResult | null {
    const { action, playerId, player, state } = ctx;

    if (action.type !== 'use_card') return null;

    const multiConfig = ctx.config.engine_mechanics?.multi_use_cards;
    if (!isMultiUseConfig(multiConfig)) return null;

    const useAction = action as { card: string; use: string };
    const hand = [...(player.hand || [])];

    // Find and remove card from hand
    const cardIndex = hand.findIndex(c =>
      c.name === useAction.card ||
      c.id === useAction.card
    );
    const card = hand[cardIndex];
    hand.splice(cardIndex, 1);

    // Get the selected use
    const availableUses = getAvailableUses(ctx, card, multiConfig);
    const selectedUse = availableUses.find(u => u.type === useAction.use)!;

    // Apply the effect
    const effectChanges = applyUseEffect(ctx, selectedUse, card);

    // Merge hand removal with effect changes
    effectChanges.playerStateChanges = effectChanges.playerStateChanges || {};
    effectChanges.playerStateChanges[playerId] = {
      ...effectChanges.playerStateChanges[playerId],
      hand
    };

    // Handle currency use specifically via resource service (fires hooks)
    if (selectedUse.type === 'currency') {
      const currencyValue = multiConfig.card_currency_value ?? 1;
      addResource(state, playerId, 'currency', currencyValue);
    }

    // Add card to discard if configured
    if (multiConfig.discard_on_use !== false) {
      const discard = [...((state.shared.discard as Card[]) || []), card];
      effectChanges.sharedStateChanges = {
        ...effectChanges.sharedStateChanges,
        discard
      };
    }

    return {
      handled: true,
      stateChanges: effectChanges,
      advanceTurn: false, // Using a card doesn't end turn by default
      checkWin: selectedUse.effect?.gain_points !== undefined,
      logMessage: 'multi_use_card',
      logData: {
        card: card.name,
        use: selectedUse.type,
        useLabel: selectedUse.label
      }
    };
  },

  getAvailableActions(ctx: HookContext): AvailableAction[] {
    const multiConfig = ctx.config.engine_mechanics?.multi_use_cards;
    if (!isMultiUseConfig(multiConfig)) return [];

    const actions: AvailableAction[] = [];
    const hand = ctx.player.hand || [];

    for (const card of hand) {
      const uses = getAvailableUses(ctx, card, multiConfig);

      for (const use of uses) {
        actions.push({
          action: {
            type: 'use_card',
            card: card.name,
            use: use.type
          } as unknown as GameAction,
          priority: use.type === 'currency' ? 30 : 50,
          category: 'multi-use-cards'
        });
      }
    }

    return actions;
  },

  describeAction(action: GameAction): ActionDescription | null {
    if (action.type === 'use_card') {
      return {
        type: 'use_card',
        label: 'Use Card',
        description: 'Use a card from your hand in one of its available ways.',
        examples: [
          'use_card card:"Worker" use:"produce"',
          'use_card card:"Gold" use:"currency"',
          'use_card card:"Soldier" use:"attack"'
        ]
      };
    }
    return null;
  }
};
