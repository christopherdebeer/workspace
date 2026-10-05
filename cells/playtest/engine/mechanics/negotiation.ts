/**
 * Negotiation Mechanic
 *
 * Enables binding and non-binding agreements between players.
 * Players can propose deals, accept/reject, and optionally enforce them.
 * Examples: Diplomacy, Cosmic Encounter, Settlers of Catan
 */

import {
  MechanicHooks,
  ActionExecutionContext,
  ActionExecutionResult,
  AvailableAction,
  TurnStartContext,
  StateChanges,
  HookContext,
  isMechanicEnabled
} from './types';
import { PlayerState } from '../types/game';

export interface NegotiationConfig {
  binding?: boolean;
  penalty_for_breaking?: BreakingPenalty;
  max_agreements?: number;
  agreement_types?: AgreementType[];
  allow_public?: boolean;
  allow_private?: boolean;
  expiration_turns?: number;
}

export interface BreakingPenalty {
  type: 'resource' | 'score' | 'reputation' | 'custom';
  resource?: string;
  amount?: number;
}

export type AgreementType =
  | 'non_aggression'
  | 'alliance'
  | 'trade_deal'
  | 'territory'
  | 'vote_agreement'
  | 'custom';

export interface Agreement {
  id: string;
  type: AgreementType;
  parties: string[];
  terms: string;
  binding: boolean;
  createdTurn: number;
  expiresAtTurn?: number;
  isPublic: boolean;
  status: 'pending' | 'active' | 'broken' | 'expired' | 'fulfilled';
}

export interface NegotiationAction {
  type: 'propose_agreement' | 'accept_agreement' | 'reject_agreement' | 'break_agreement';
  agreementId?: string;
  targetPlayer?: string;
  agreementType?: AgreementType;
  terms?: string;
  binding?: boolean;
  isPublic?: boolean;
  expiresInTurns?: number;
}

function generateAgreementId(): string {
  return `agr-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

function getPlayerExtras(player: PlayerState): Record<string, unknown> {
  return player as unknown as Record<string, unknown>;
}

export const negotiationMechanic: MechanicHooks = {
  slug: 'negotiation',
  name: 'Negotiation',
  requires: ['social'],

  onTurnStart(ctx: TurnStartContext): StateChanges | null {
    if (!isMechanicEnabled(ctx.config, 'negotiation')) return null;

    const shared = ctx.state.shared as Record<string, unknown> ?? {};
    const agreements = shared.agreements as Agreement[] ?? [];
    const currentTurn = ctx.state.turnNumber ?? 0;

    const expiredAgreements: string[] = [];

    for (const agreement of agreements) {
      if (agreement.status === 'active' && agreement.expiresAtTurn !== undefined) {
        if (currentTurn >= agreement.expiresAtTurn) {
          agreement.status = 'expired';
          expiredAgreements.push(agreement.id);
        }
      }
    }

    // Agreements marked as expired are handled above
    return null;
  },

  getAvailableActions(ctx: HookContext): AvailableAction[] {
    if (!isMechanicEnabled(ctx.config, 'negotiation')) return [];

    const config = ctx.config.engine_mechanics?.negotiation as NegotiationConfig | undefined;
    const actions: AvailableAction[] = [];

    const shared = ctx.state.shared as Record<string, unknown> ?? {};
    const agreements = shared.agreements as Agreement[] ?? [];

    const playerAgreements = agreements.filter(
      a => a.parties.includes(ctx.playerId) && a.status === 'active'
    );
    const maxAgreements = config?.max_agreements ?? 10;

    if (playerAgreements.length < maxAgreements) {
      for (const targetId of Object.keys(ctx.state.players)) {
        if (targetId === ctx.playerId) continue;

        actions.push({
          action: { type: 'pass' },
          priority: 30,
          category: 'social'
        });
      }
    }

    const pendingForPlayer = agreements.filter(
      a => a.status === 'pending' &&
           a.parties.includes(ctx.playerId) &&
           a.parties[0] !== ctx.playerId
    );

    for (const agreement of pendingForPlayer) {
      actions.push({
        action: { type: 'pass' },
        priority: 40,
        category: 'social'
      });

      actions.push({
        action: { type: 'pass' },
        priority: 35,
        category: 'social'
      });
    }

    const activeForPlayer = agreements.filter(
      a => a.status === 'active' && a.parties.includes(ctx.playerId)
    );

    for (const agreement of activeForPlayer) {
      actions.push({
        action: { type: 'pass' },
        priority: 10,
        category: 'social'
      });
    }

    return actions;
  },

  onExecuteAction(ctx: ActionExecutionContext): ActionExecutionResult | null {
    const { action, playerId, state } = ctx;
    if (!isMechanicEnabled(ctx.config, 'negotiation')) return null;

    const config = ctx.config.engine_mechanics?.negotiation as NegotiationConfig | undefined;
    const negAction = action as unknown as NegotiationAction;

    if (!state.shared) {
      state.shared = {};
    }
    const shared = state.shared as Record<string, unknown>;
    if (!shared.agreements) {
      shared.agreements = [];
    }
    const agreements = shared.agreements as Agreement[];

    if (negAction.type === 'propose_agreement') {
      const newAgreement: Agreement = {
        id: generateAgreementId(),
        type: negAction.agreementType ?? 'custom',
        parties: [playerId, negAction.targetPlayer!],
        terms: negAction.terms ?? `${negAction.agreementType} agreement`,
        binding: negAction.binding ?? config?.binding ?? false,
        createdTurn: state.turnNumber ?? 0,
        expiresAtTurn: negAction.expiresInTurns
          ? (state.turnNumber ?? 0) + negAction.expiresInTurns
          : undefined,
        isPublic: negAction.isPublic ?? config?.allow_public ?? true,
        status: 'pending'
      };

      agreements.push(newAgreement);

      return {
        handled: true,
        advanceTurn: false,
        logData: {
          agreementId: newAgreement.id,
          type: newAgreement.type,
          targetPlayer: negAction.targetPlayer,
          binding: newAgreement.binding
        }
      };
    }

    if (negAction.type === 'accept_agreement') {
      const agreement = agreements.find(a => a.id === negAction.agreementId);
      if (!agreement) {
        return {
          handled: true,
          logData: { error: 'Agreement not found' }
        };
      }

      if (!agreement.parties.includes(playerId)) {
        return {
          handled: true,
          logData: { error: 'Not party to agreement' }
        };
      }

      agreement.status = 'active';

      return {
        handled: true,
        advanceTurn: false,
        logData: {
          agreementId: agreement.id,
          type: agreement.type,
          accepted: true
        }
      };
    }

    if (negAction.type === 'reject_agreement') {
      const agreement = agreements.find(a => a.id === negAction.agreementId);
      if (!agreement) {
        return {
          handled: true,
          logData: { error: 'Agreement not found' }
        };
      }

      const index = agreements.indexOf(agreement);
      if (index !== -1) {
        agreements.splice(index, 1);
      }

      return {
        handled: true,
        advanceTurn: false,
        logData: {
          agreementId: agreement.id,
          rejected: true
        }
      };
    }

    if (negAction.type === 'break_agreement') {
      const agreement = agreements.find(a => a.id === negAction.agreementId);
      if (!agreement) {
        return {
          handled: true,
          logData: { error: 'Agreement not found' }
        };
      }

      if (!agreement.parties.includes(playerId)) {
        return {
          handled: true,
          logData: { error: 'Not party to agreement' }
        };
      }

      agreement.status = 'broken';

      if (agreement.binding && config?.penalty_for_breaking) {
        const penalty = config.penalty_for_breaking;
        const player = state.players[playerId];

        if (player) {
          if (penalty.type === 'score') {
            player.score = (player.score ?? 0) - (penalty.amount ?? 5);
          } else if (penalty.type === 'resource' && penalty.resource) {
            if (!player.resources) player.resources = {};
            player.resources[penalty.resource] =
              (player.resources[penalty.resource] ?? 0) - (penalty.amount ?? 5);
          } else if (penalty.type === 'reputation') {
            const extras = getPlayerExtras(player);
            extras.reputation =
              ((extras.reputation as number) ?? 100) - (penalty.amount ?? 10);
          }
        }
      }

      return {
        handled: true,
        advanceTurn: false,
        logData: {
          agreementId: agreement.id,
          broken: true,
          penaltyApplied: agreement.binding
        }
      };
    }

    return null;
  },

  describeAction(action) {
    const negAction = action as unknown as NegotiationAction;

    if (negAction.type === 'propose_agreement') {
      return {
        type: 'propose_agreement',
        label: 'Propose Agreement',
        description: `Propose an agreement with another player`,
        examples: [
          '{ "type": "propose_agreement", "targetPlayer": "player-2", "agreementType": "alliance" }'
        ]
      };
    }

    if (negAction.type === 'accept_agreement') {
      return {
        type: 'accept_agreement',
        label: 'Accept Agreement',
        description: 'Accept a pending agreement',
        examples: ['{ "type": "accept_agreement", "agreementId": "agr-123" }']
      };
    }

    if (negAction.type === 'reject_agreement') {
      return {
        type: 'reject_agreement',
        label: 'Reject Agreement',
        description: 'Reject a pending agreement',
        examples: ['{ "type": "reject_agreement", "agreementId": "agr-123" }']
      };
    }

    if (negAction.type === 'break_agreement') {
      return {
        type: 'break_agreement',
        label: 'Break Agreement',
        description: 'Break an active agreement (may have consequences)',
        examples: ['{ "type": "break_agreement", "agreementId": "agr-123" }']
      };
    }

    return null;
  },

  configSchema: {
    type: 'object',
    description: 'Binding and non-binding agreements between players.'
  }
};
