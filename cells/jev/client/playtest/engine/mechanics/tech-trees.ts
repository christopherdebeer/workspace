/**
 * Tech Trees / Tech Tracks Mechanic
 *
 * Players advance along technology tracks, unlocking abilities and bonuses.
 * Technologies have prerequisites (must research A before B).
 * Examples: Terra Mystica, Scythe, Through the Ages
 *
 * Requires: resources (core mechanic)
 *
 * Hooks used:
 * - initSharedState: Define tech tree structure
 * - initPlayerState: Player's researched techs
 * - getAvailableActions: 'research' action for affordable & unlocked techs
 * - onExecuteAction: Handle research, apply tech bonuses
 * - getPlayerView: Show tech tree and player progress
 */

import {
  MechanicHooks,
  HookContext,
  AvailableAction,
  ActionExecutionContext,
  ActionExecutionResult,
  SharedStateInitContext,
  SharedStateInitResult,
  PlayerInitContext,
  PlayerInitResult,
} from './types';
import { GameAction, ResearchAction } from '../types/game';

interface TechNode {
  id: string;
  name: string;
  description?: string;
  cost: Record<string, number>;
  prerequisites?: string[];
  bonuses?: Record<string, number>;   // permanent resource bonuses
  points?: number;
  unlocks?: string[];                 // what this tech unlocks
}

interface TechTreeConfig {
  techs: TechNode[];
  tracks?: Array<{
    id: string;
    name: string;
    techs: string[];      // ordered tech IDs in this track
  }>;
  max_researched?: number;  // limit total techs (0 = no limit)
}

export const techTreesMechanic: MechanicHooks = {
  slug: 'tech-trees-tech-tracks',
  name: 'Tech Trees / Tech Tracks',
  requires: ['resources'],

  configSchema: {
    type: 'object',
    description: 'Research technologies with prerequisites and bonuses',
    properties: {
      techs: { type: 'array', description: 'Technology nodes', required: true },
      tracks: { type: 'array', description: 'Organized tech tracks' },
      max_researched: { type: 'number', description: 'Max total techs', default: 0 },
    },
    required: ['techs'],
  },

  initSharedState(ctx: SharedStateInitContext): SharedStateInitResult | null {
    const config = ctx.config.engine_mechanics?.tech_trees_tech_tracks as TechTreeConfig | undefined;
    if (!config) return {};

    return {
      techTree: config.techs,
      techTracks: config.tracks || [],
    };
  },

  initPlayerState(ctx: PlayerInitContext): PlayerInitResult | null {
    const config = ctx.config.engine_mechanics?.tech_trees_tech_tracks as TechTreeConfig | undefined;
    if (!config) return {};

    return {
      researchedTechs: [] as string[],
      techBonuses: {} as Record<string, number>,
    };
  },

  getAvailableActions(ctx: HookContext): AvailableAction[] {
    const config = ctx.config.engine_mechanics?.tech_trees_tech_tracks as TechTreeConfig | undefined;
    if (!config?.techs) return [];

    const researched = (ctx.player.researchedTechs as string[]) || [];
    const resources = (ctx.player.resources as Record<string, number>) || {};
    const actions: AvailableAction[] = [];

    // Check max
    if (config.max_researched && researched.length >= config.max_researched) return [];

    for (const tech of config.techs) {
      // Already researched
      if (researched.includes(tech.id)) continue;

      // Check prerequisites
      if (tech.prerequisites?.length) {
        const met = tech.prerequisites.every(prereq => researched.includes(prereq));
        if (!met) continue;
      }

      // Check cost
      const canAfford = Object.entries(tech.cost).every(
        ([resource, amount]) => (resources[resource] || 0) >= amount
      );
      if (!canAfford) continue;

      actions.push({
        action: {
          type: 'research',
          techId: tech.id,
        } as GameAction,
        category: 'research',
      });
    }

    return actions;
  },

  onExecuteAction(ctx: ActionExecutionContext): ActionExecutionResult | null {
    if (ctx.action.type !== 'research') return null;

    const config = ctx.config.engine_mechanics?.tech_trees_tech_tracks as TechTreeConfig | undefined;
    if (!config?.techs) return null;

    const techId = (ctx.action as ResearchAction).techId;
    const tech = config.techs.find(t => t.id === techId);
    if (!tech) return null;

    const player = ctx.state.players[ctx.playerId];
    const researched = [...((player?.researchedTechs as string[]) || []), techId];

    // Deduct cost
    const resources = { ...((player?.resources as Record<string, number>) || {}) };
    for (const [resource, amount] of Object.entries(tech.cost)) {
      resources[resource] = (resources[resource] || 0) - amount;
    }

    // Apply bonuses
    const techBonuses = { ...((player?.techBonuses as Record<string, number>) || {}) };
    if (tech.bonuses) {
      for (const [resource, amount] of Object.entries(tech.bonuses)) {
        techBonuses[resource] = (techBonuses[resource] || 0) + amount;
      }
    }

    // Score
    const score = (player?.score || 0) + (tech.points || 0);

    return {
      handled: true,
      stateChanges: {
        playerStateChanges: {
          [ctx.playerId]: {
            researchedTechs: researched,
            resources,
            techBonuses,
            score,
          },
        },
      },
      advanceTurn: false,
      logMessage: `researched ${tech.name}${tech.points ? ` (+${tech.points} points)` : ''}`,
    };
  },

  getPlayerView(ctx: HookContext): Record<string, unknown> {
    const config = ctx.config.engine_mechanics?.tech_trees_tech_tracks as TechTreeConfig | undefined;
    if (!config) return {};

    return {
      techTree: config.techs,
      researchedTechs: ctx.player.researchedTechs || [],
      techBonuses: ctx.player.techBonuses || {},
    };
  },
};
