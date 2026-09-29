/**
 * Alliances Mechanic
 *
 * Players can form and break alliances with other players.
 * Allied players may share resources, coordinate actions, or score together.
 * Examples: Dune, Cosmic Encounter, Diplomacy
 *
 * Requires: social (core mechanic)
 *
 * Hooks used:
 * - initSharedState: Set up alliance tracker
 * - getAvailableActions: Propose/accept/break alliance
 * - onExecuteAction: Handle alliance actions
 * - getPlayerView: Show alliance status
 */

import {
  MechanicHooks,
  HookContext,
  AvailableAction,
  ActionExecutionContext,
  ActionExecutionResult,
  SharedStateInitContext,
  SharedStateInitResult,
} from './types';
import type { SocialHooks } from './core/social-mechanic';
import { GameAction, ProposeAllianceAction, AcceptAllianceAction, RejectAllianceAction, BreakAllianceAction } from '../types/game';

interface AllianceConfig {
  max_alliance_size?: number;    // Max players in one alliance (default 2)
  max_alliances?: number;        // Max alliances per player (default 1)
  binding?: boolean;             // Can alliances be broken? (default: false = yes)
  duration?: number;             // Turns until alliance expires (0 = permanent until broken)
  shared_victory?: boolean;      // Allied players can win together (default false)
  shared_resources?: string[];   // Resources shared between allies
}

interface Alliance {
  id: string;
  members: string[];
  formedOnTurn: number;
  expiresOnTurn?: number;
}

interface AllianceState {
  alliances: Alliance[];
  proposals: Array<{
    from: string;
    to: string;
    id: string;
  }>;
}

export const alliancesMechanic: MechanicHooks & SocialHooks = {
  slug: 'alliances',
  name: 'Alliances',
  requires: ['social'],

  configSchema: {
    type: 'object',
    description: 'Form and break alliances between players',
    properties: {
      max_alliance_size: { type: 'number', default: 2 },
      max_alliances: { type: 'number', default: 1 },
      binding: { type: 'boolean', default: false },
      duration: { type: 'number', default: 0 },
      shared_victory: { type: 'boolean', default: false },
    },
  },

  initSharedState(ctx: SharedStateInitContext): SharedStateInitResult | null {
    const config = ctx.config.engine_mechanics?.alliances as AllianceConfig | undefined;
    if (!config) return {};

    return {
      allianceState: {
        alliances: [],
        proposals: [],
      } as AllianceState,
    };
  },

  getAvailableActions(ctx: HookContext): AvailableAction[] {
    const config = ctx.config.engine_mechanics?.alliances as AllianceConfig | undefined;
    if (!config) return [];

    const shared = ctx.state.shared as Record<string, unknown>;
    const allianceState = shared.allianceState as AllianceState | undefined;
    if (!allianceState) return [];

    const actions: AvailableAction[] = [];
    const maxAlliances = config.max_alliances ?? 1;
    const myAlliances = allianceState.alliances.filter(a => a.members.includes(ctx.playerId));

    // Propose alliance (if under max)
    if (myAlliances.length < maxAlliances) {
      const otherPlayers = ctx.state.turnOrder.filter(pid => pid !== ctx.playerId);
      for (const pid of otherPlayers) {
        // Don't propose if already allied
        if (myAlliances.some(a => a.members.includes(pid))) continue;
        // Don't propose if already pending
        if (allianceState.proposals.some(p => p.from === ctx.playerId && p.to === pid)) continue;

        actions.push({
          action: {
            type: 'propose_alliance',
            targetPlayerId: pid,
          } as GameAction,
        });
      }
    }

    // Accept pending proposals
    const pendingForMe = allianceState.proposals.filter(p => p.to === ctx.playerId);
    for (const proposal of pendingForMe) {
      actions.push({
        action: {
          type: 'accept_alliance',
          proposalId: proposal.id,
        } as GameAction,
      });
      actions.push({
        action: {
          type: 'reject_alliance',
          proposalId: proposal.id,
        } as GameAction,
      });
    }

    // Break existing alliances (if not binding)
    if (config.binding !== true) {
      for (const alliance of myAlliances) {
        const partner = alliance.members.find(m => m !== ctx.playerId);
        actions.push({
          action: {
            type: 'break_alliance',
            allianceId: alliance.id,
          } as GameAction,
        });
      }
    }

    return actions;
  },

  onExecuteAction(ctx: ActionExecutionContext): ActionExecutionResult | null {
    const actionType = ctx.action.type;

    if (!['propose_alliance', 'accept_alliance', 'reject_alliance', 'break_alliance'].includes(actionType)) {
      return null;
    }

    const config = ctx.config.engine_mechanics?.alliances as AllianceConfig | undefined;
    if (!config) return null;

    const shared = ctx.state.shared as Record<string, unknown>;
    const allianceState = { ...(shared.allianceState as AllianceState) };
    allianceState.alliances = [...allianceState.alliances];
    allianceState.proposals = [...allianceState.proposals];

    if (actionType === 'propose_alliance') {
      const targetId = (ctx.action as ProposeAllianceAction).targetPlayerId;
      const proposalId = `alliance-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      allianceState.proposals.push({ from: ctx.playerId, to: targetId, id: proposalId });

      return {
        handled: true,
        stateChanges: { sharedStateChanges: { allianceState } },
        advanceTurn: false,
        logMessage: `proposed alliance with ${targetId}`,
      };
    }

    if (actionType === 'accept_alliance') {
      const proposalId = (ctx.action as AcceptAllianceAction).proposalId;
      const proposal = allianceState.proposals.find(p => p.id === proposalId);
      if (!proposal) return null;

      // Remove proposal
      allianceState.proposals = allianceState.proposals.filter(p => p.id !== proposalId);

      // Create alliance
      const turn = ctx.state.round || 0;
      const duration = config.duration || 0;
      const alliance: Alliance = {
        id: `a-${Date.now()}`,
        members: [proposal.from, proposal.to],
        formedOnTurn: turn,
        expiresOnTurn: duration > 0 ? turn + duration : undefined,
      };
      allianceState.alliances.push(alliance);

      return {
        handled: true,
        stateChanges: { sharedStateChanges: { allianceState } },
        advanceTurn: false,
        logMessage: `accepted alliance with ${proposal.from}`,
      };
    }

    if (actionType === 'reject_alliance') {
      const proposalId = (ctx.action as RejectAllianceAction).proposalId;
      allianceState.proposals = allianceState.proposals.filter(p => p.id !== proposalId);

      return {
        handled: true,
        stateChanges: { sharedStateChanges: { allianceState } },
        advanceTurn: false,
        logMessage: 'rejected alliance proposal',
      };
    }

    if (actionType === 'break_alliance') {
      const allianceId = (ctx.action as BreakAllianceAction).allianceId;
      const alliance = allianceState.alliances.find(a => a.id === allianceId);
      if (!alliance) return null;

      allianceState.alliances = allianceState.alliances.filter(a => a.id !== allianceId);
      const partner = alliance.members.find(m => m !== ctx.playerId);

      return {
        handled: true,
        stateChanges: { sharedStateChanges: { allianceState } },
        advanceTurn: false,
        logMessage: `broke alliance with ${partner}`,
      };
    }

    return null;
  },

  getPlayerView(ctx: HookContext): Record<string, unknown> {
    const config = ctx.config.engine_mechanics?.alliances as AllianceConfig | undefined;
    if (!config) return {};

    const shared = ctx.state.shared as Record<string, unknown>;
    const allianceState = shared.allianceState as AllianceState | undefined;
    if (!allianceState) return {};

    return {
      myAlliances: allianceState.alliances.filter(a => a.members.includes(ctx.playerId)),
      pendingProposals: allianceState.proposals.filter(p => p.to === ctx.playerId),
      sentProposals: allianceState.proposals.filter(p => p.from === ctx.playerId),
    };
  },
};
