/**
 * Variable Set Up Mechanic
 *
 * Randomize game setup elements each game (modules, starting positions, etc).
 * Supports module selection from a pool and player order randomization.
 *
 * Hooks used:
 * - initSharedState: Randomly select/arrange modules from config pool
 */

import {
  MechanicHooks,
  SharedStateInitContext,
  SharedStateInitResult,
  HookContext,
  isMechanicEnabled
} from './types';
import { GameConfig } from '../types/game';

interface ModuleDefinition {
  id: string;
  name: string;
}

interface VariableSetUpConfig {
  modules?: ModuleDefinition[];
  select_count?: number;
  randomize_player_order?: boolean;
}

interface VariableSetUpState {
  selectedModules: ModuleDefinition[];
  playerOrder: string[];
  setupSeed: number;
}

function getConfig(config: GameConfig): VariableSetUpConfig | undefined {
  return config.engine_mechanics?.variable_set_up as VariableSetUpConfig | undefined;
}

function shuffleArray<T>(array: T[]): T[] {
  const result = [...array];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

export const variableSetUpMechanic: MechanicHooks = {
  slug: 'variable-set-up',
  name: 'Variable Set Up',

  configSchema: {
    type: 'object',
    description: 'Randomize game setup elements each game',
    properties: {
      modules: {
        type: 'array',
        description: 'Pool of game modules to choose from'
      },
      select_count: {
        type: 'number',
        description: 'Number of modules to select from pool'
      },
      randomize_player_order: {
        type: 'boolean',
        description: 'Randomize starting player order',
        default: false
      }
    }
  },

  /**
   * Randomly select/arrange modules from config pool
   */
  initSharedState(ctx: SharedStateInitContext): SharedStateInitResult | null {
    const config = getConfig(ctx.config);
    if (!config) return null;

    // Select modules from pool
    let selectedModules: ModuleDefinition[] = [];
    if (config.modules?.length) {
      const shuffled = shuffleArray(config.modules);
      const selectCount = config.select_count ?? config.modules.length;
      selectedModules = shuffled.slice(0, Math.min(selectCount, shuffled.length));
    }

    // Determine player order
    let playerOrder = [...ctx.playerIds];
    if (config.randomize_player_order) {
      playerOrder = shuffleArray(playerOrder);
    }

    const setupState: VariableSetUpState = {
      selectedModules,
      playerOrder,
      setupSeed: Math.floor(Math.random() * 1000000)
    };

    return { variableSetUp: setupState };
  },

  /**
   * Show selected modules and setup info in player view
   */
  getPlayerView(ctx: HookContext): Record<string, unknown> | null {
    if (!isMechanicEnabled(ctx.config, 'variable-set-up')) return null;

    const setupState = ctx.state.shared.variableSetUp as VariableSetUpState | undefined;
    if (!setupState) return null;

    return {
      selectedModules: setupState.selectedModules,
      playerOrder: setupState.playerOrder
    };
  }
};
