/**
 * Melding and Splaying Mechanic
 *
 * Cards arranged in overlapping melds. Splaying reveals/hides card attributes.
 * Think Rummy melds, Innovation splaying.
 *
 * Hooks used:
 * - initPlayerState: Create meld areas
 * - getAvailableActions: 'create_meld', 'add_to_meld', 'splay'
 * - onExecuteAction: Manage melds and splay direction
 * - getPlayerView: Show melds
 */

import {
  MechanicHooks,
  HookContext,
  ActionExecutionContext,
  ActionExecutionResult,
  AvailableAction,
  PlayerInitContext,
  PlayerInitResult,
  isMechanicEnabled
} from './types';
import { GameAction, GameConfig } from '../types/game';

interface MeldConfig {
  min_meld_size?: number;
  points_per_meld?: number;
  splay_directions?: string[];
}

interface Meld {
  id: string;
  cards: string[];
  splayDirection: 'none' | 'left' | 'right' | 'up';
}

function getConfig(config: GameConfig): MeldConfig | undefined {
  return config.engine_mechanics?.melding_and_splaying as MeldConfig | undefined;
}

export const meldingAndSplayingMechanic: MechanicHooks = {
  slug: 'melding-and-splaying',
  name: 'Melding and Splaying',
  requires: ['cards'],

  configSchema: {
    type: 'object',
    description: 'Create card melds and splay for bonuses',
    properties: {
      min_meld_size: { type: 'number', default: 3 },
      points_per_meld: { type: 'number', default: 5 },
      splay_directions: { type: 'array', default: ['left', 'right', 'up'] }
    }
  },

  initPlayerState(ctx: PlayerInitContext): PlayerInitResult | null {
    const config = getConfig(ctx.config);
    if (!config) return null;

    return {
      melds: [] as Meld[],
      meldCount: 0
    };
  },

  getAvailableActions(ctx: HookContext): AvailableAction[] {
    if (!isMechanicEnabled(ctx.config, 'melding-and-splaying')) return [];

    const hand = (ctx.player.hand || []) as Array<{ id: string }>;
    const config = getConfig(ctx.config);
    const minSize = config?.min_meld_size ?? 3;
    const actions: AvailableAction[] = [];

    if (hand.length >= minSize) {
      actions.push({
        action: {
          type: 'create_meld',
          cardIds: []
        } as unknown as GameAction,
        priority: 70,
        category: 'melding'
      });
    }

    const melds = (ctx.player.melds ?? []) as Meld[];
    if (melds.length > 0 && hand.length > 0) {
      actions.push({
        action: {
          type: 'add_to_meld',
          meldId: '',
          cardId: ''
        } as unknown as GameAction,
        priority: 65,
        category: 'melding'
      });
    }

    // Splay option for existing melds
    for (const meld of melds) {
      if (meld.cards.length >= 2) {
        actions.push({
          action: {
            type: 'splay',
            meldId: meld.id,
            direction: 'right'
          } as unknown as GameAction,
          priority: 60,
          category: 'melding'
        });
      }
    }

    return actions;
  },

  onExecuteAction(ctx: ActionExecutionContext): ActionExecutionResult | null {
    if (ctx.action.type !== 'create_meld' && ctx.action.type !== 'add_to_meld' && ctx.action.type !== 'splay') return null;

    const config = getConfig(ctx.config);
    if (!config) return null;

    const playerMelds = (ctx.player.melds ?? []) as Meld[];
    const melds = [...playerMelds];

    if (ctx.action.type === 'create_meld') {
      const createAction = ctx.action as unknown as { type: 'create_meld'; cardIds: string[] };
      const minSize = config.min_meld_size ?? 3;

      if ((createAction.cardIds?.length ?? 0) < minSize) {
        return { handled: true, logMessage: `Meld requires at least ${minSize} cards.`, advanceTurn: false, checkWin: false };
      }

      const newMeld: Meld = {
        id: `meld-${melds.length + 1}`,
        cards: createAction.cardIds ?? [],
        splayDirection: 'none'
      };

      const points = config.points_per_meld ?? 5;

      return {
        handled: true,
        stateChanges: {
          playerStateChanges: {
            [ctx.playerId]: {
              melds: [...melds, newMeld],
              meldCount: melds.length + 1,
              score: (ctx.player.score ?? 0) + points
            }
          }
        },
        advanceTurn: false,
        checkWin: true,
        logMessage: `${ctx.playerId} created a meld with ${createAction.cardIds?.length ?? 0} cards.`,
        logData: { player: ctx.playerId, meldSize: createAction.cardIds?.length ?? 0 }
      };
    }

    if (ctx.action.type === 'add_to_meld') {
      const addAction = ctx.action as unknown as { type: 'add_to_meld'; meldId: string; cardId: string };
      const meldIdx = melds.findIndex(m => m.id === addAction.meldId);
      if (meldIdx < 0) {
        return { handled: true, logMessage: 'Meld not found.', advanceTurn: false, checkWin: false };
      }

      melds[meldIdx] = {
        ...melds[meldIdx],
        cards: [...melds[meldIdx].cards, addAction.cardId]
      };

      return {
        handled: true,
        stateChanges: {
          playerStateChanges: {
            [ctx.playerId]: { melds }
          }
        },
        advanceTurn: false,
        checkWin: false,
        logMessage: `${ctx.playerId} added a card to ${addAction.meldId}.`,
        logData: { player: ctx.playerId, meldId: addAction.meldId }
      };
    }

    // splay
    const splayAction = ctx.action as unknown as { type: 'splay'; meldId: string; direction: 'left' | 'right' | 'up' };
    const meldIdx = melds.findIndex(m => m.id === splayAction.meldId);
    if (meldIdx < 0) {
      return { handled: true, logMessage: 'Meld not found.', advanceTurn: false, checkWin: false };
    }

    melds[meldIdx] = { ...melds[meldIdx], splayDirection: splayAction.direction };

    return {
      handled: true,
      stateChanges: {
        playerStateChanges: {
          [ctx.playerId]: { melds }
        }
      },
      advanceTurn: false,
      checkWin: false,
      logMessage: `${ctx.playerId} splayed ${splayAction.meldId} ${splayAction.direction}.`,
      logData: { player: ctx.playerId, meldId: splayAction.meldId, direction: splayAction.direction }
    };
  },

  getPlayerView(ctx: HookContext): Record<string, unknown> | null {
    if (!isMechanicEnabled(ctx.config, 'melding-and-splaying')) return null;

    return {
      melds: ctx.player.melds ?? [],
      meldCount: ctx.player.meldCount ?? 0
    };
  }
};
