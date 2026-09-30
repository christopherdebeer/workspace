/**
 * Modular Board Mechanic
 *
 * Board is assembled from modular tiles during setup for variable game layouts.
 *
 * Hooks used:
 * - initSharedState: Create modular board layout
 * - getPlayerView: Show board configuration
 */

import {
  MechanicHooks,
  HookContext,
  SharedStateInitContext,
  SharedStateInitResult,
  isMechanicEnabled
} from './types';
import { GameConfig } from '../types/game';

interface BoardModule {
  id: string;
  type: string;
  connections: string[];
}

interface ModularBoardConfig {
  modules?: BoardModule[];
  randomize?: boolean;
}

interface ModularBoardState {
  layout: BoardModule[];
  seed: number;
}

function getConfig(config: GameConfig): ModularBoardConfig | undefined {
  return config.engine_mechanics?.modular_board as ModularBoardConfig | undefined;
}

function getModularState(shared: Record<string, unknown>): ModularBoardState | undefined {
  return shared.modularBoard as ModularBoardState | undefined;
}

export const modularBoardMechanic: MechanicHooks = {
  slug: 'modular-board',
  name: 'Modular Board',
  requires: ['board'],

  configSchema: {
    type: 'object',
    description: 'Variable board layout from modular tiles',
    properties: {
      modules: { type: 'array', description: 'Board module definitions' },
      randomize: { type: 'boolean', default: true }
    }
  },

  initSharedState(ctx: SharedStateInitContext): SharedStateInitResult | null {
    const config = getConfig(ctx.config);
    if (!config) return null;

    let modules = config.modules ?? [
      { id: 'mod-1', type: 'forest', connections: ['mod-2', 'mod-3'] },
      { id: 'mod-2', type: 'plains', connections: ['mod-1', 'mod-4'] },
      { id: 'mod-3', type: 'mountain', connections: ['mod-1', 'mod-5'] },
      { id: 'mod-4', type: 'water', connections: ['mod-2', 'mod-6'] },
      { id: 'mod-5', type: 'desert', connections: ['mod-3', 'mod-6'] },
      { id: 'mod-6', type: 'swamp', connections: ['mod-4', 'mod-5'] }
    ];

    // Randomize order if configured
    if (config.randomize !== false) {
      modules = [...modules].sort(() => Math.random() - 0.5);
    }

    return {
      modularBoard: { layout: modules, seed: Date.now() } as ModularBoardState
    };
  },

  getPlayerView(ctx: HookContext): Record<string, unknown> | null {
    if (!isMechanicEnabled(ctx.config, 'modular-board')) return null;

    const mbState = getModularState(ctx.state.shared);
    if (!mbState) return null;

    return {
      boardLayout: mbState.layout.map(m => ({
        id: m.id,
        type: m.type,
        connections: m.connections
      }))
    };
  }
};
