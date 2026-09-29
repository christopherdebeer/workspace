/**
 * Bribery Mechanic
 *
 * Players can pay resources to influence other players' actions or votes.
 *
 * Config:
 *   bribery:
 *     currency: string
 *     binding: boolean
 *     max_bribe_per_action: number
 *     bribe_targets: string[]
 */

import { MechanicHooks, HookContext, ValidationResult, ActionExecutionContext, ActionExecutionResult, AvailableAction, StateChanges } from './types';
import { GameAction, OfferBribeAction, RespondToBribeAction, BriberyConfig } from '../types/game';
import type { SocialHooks, BeforeVotePayload, PlayerVotedPayload } from './core/social-mechanic';
import { spendResource, addResource } from './core/resources';

interface Bribe {
  id: string;
  offerer: string;
  target: string;
  amount: number;
  requestedAction: string;
  requestedDetails?: Record<string, unknown>;
  status: 'pending' | 'accepted' | 'rejected' | 'fulfilled' | 'broken';
  turn: number;
}

export const briberyMechanic: MechanicHooks & SocialHooks = {
  slug: 'bribery',
  name: 'Bribery',
  requires: ['social'],

  configSchema: {
    type: 'object',
    description: 'Pay to influence other players',
    properties: {
      currency: {
        type: 'string',
        description: 'Resource used for bribes',
        required: true
      },
      binding: {
        type: 'boolean',
        description: 'Whether accepted bribes must be honored',
        default: false
      },
      max_bribe_per_action: {
        type: 'number',
        description: 'Maximum bribe amount',
        default: 100
      },
      bribe_targets: {
        type: 'array',
        description: 'Actions that can be bribed',
        items: { type: 'string' },
        default: ['vote', 'pass', 'trade']
      }
    },
    required: ['currency']
  },

  preValidateAction(ctx: HookContext, action: GameAction): ValidationResult | null {
    if (action.type !== 'offer_bribe' && action.type !== 'respond_to_bribe') return null;

    const config = ctx.config.engine_mechanics?.bribery;
    if (!config) {
      return { valid: false, error: 'Bribery is not enabled.' };
    }

    if (action.type === 'offer_bribe') {
      const offerAction = action as OfferBribeAction;

      if (!ctx.state.players[offerAction.targetPlayer]) {
        return { valid: false, error: 'Target player does not exist.' };
      }

      if (offerAction.targetPlayer === ctx.playerId) {
        return { valid: false, error: 'Cannot bribe yourself.' };
      }

      const available = ctx.player.resources?.[config.currency] ?? 0;
      if (offerAction.amount > available) {
        return { valid: false, error: `Not enough ${config.currency}. Have ${available}, offering ${offerAction.amount}.` };
      }

      if (offerAction.amount <= 0) {
        return { valid: false, error: 'Bribe amount must be positive.' };
      }

      const maxBribe = config.max_bribe_per_action ?? 100;
      if (offerAction.amount > maxBribe) {
        return { valid: false, error: `Maximum bribe is ${maxBribe}.` };
      }

      if (config.bribe_targets && !config.bribe_targets.includes(offerAction.requestedAction)) {
        return { valid: false, error: `Cannot bribe for action type: ${offerAction.requestedAction}` };
      }
    }

    if (action.type === 'respond_to_bribe') {
      const respondAction = action as RespondToBribeAction;
      const bribes = (ctx.state.shared.activeBribes as Bribe[]) ?? [];
      const bribe = bribes.find(b => b.id === respondAction.bribeId);

      if (!bribe) {
        return { valid: false, error: 'Bribe not found.' };
      }

      if (bribe.target !== ctx.playerId) {
        return { valid: false, error: 'This bribe is not for you.' };
      }

      if (bribe.status !== 'pending') {
        return { valid: false, error: 'Bribe has already been responded to.' };
      }
    }

    return { valid: true };
  },

  onExecuteAction(ctx: ActionExecutionContext): ActionExecutionResult | null {
    const { action, state, playerId } = ctx;
    const config = ctx.config.engine_mechanics?.bribery;
    if (!config) return null;

    if (action.type === 'offer_bribe') {
      const offerAction = action as OfferBribeAction;

      const bribes = [...((state.shared.activeBribes as Bribe[]) ?? [])];
      const newBribe: Bribe = {
        id: `bribe_${Date.now()}_${Math.random().toString(36).slice(2)}`,
        offerer: playerId,
        target: offerAction.targetPlayer,
        amount: offerAction.amount,
        requestedAction: offerAction.requestedAction,
        requestedDetails: offerAction.requestedDetails,
        status: 'pending',
        turn: state.turnNumber
      };
      bribes.push(newBribe);

      return {
        handled: true,
        stateChanges: {
          sharedStateChanges: {
            activeBribes: bribes,
            lastBribeOffer: newBribe
          }
        },
        advanceTurn: false,
        checkWin: false,
        logMessage: `${playerId} offered ${offerAction.amount} ${config.currency} to ${offerAction.targetPlayer} for ${offerAction.requestedAction}`
      };
    }

    if (action.type === 'respond_to_bribe') {
      const respondAction = action as RespondToBribeAction;
      const bribes = [...((state.shared.activeBribes as Bribe[]) ?? [])];
      const bribeIndex = bribes.findIndex(b => b.id === respondAction.bribeId);
      const bribe = { ...bribes[bribeIndex] };

      bribe.status = respondAction.accept ? 'accepted' : 'rejected';
      bribes[bribeIndex] = bribe;

      const stateChanges: StateChanges = {
        sharedStateChanges: { activeBribes: bribes }
      };

      if (respondAction.accept) {
        spendResource(state, bribe.offerer, config.currency, bribe.amount);
        addResource(state, bribe.target, config.currency, bribe.amount);

        if (config.binding) {
          const obligations = [...((state.shared.bribeObligations as Bribe[]) ?? [])];
          obligations.push({ ...bribe, status: 'accepted' });
          stateChanges.sharedStateChanges!.bribeObligations = obligations;
        }
      }

      return {
        handled: true,
        stateChanges,
        advanceTurn: false,
        checkWin: false,
        logMessage: respondAction.accept
          ? `${playerId} accepted bribe of ${bribe.amount} from ${bribe.offerer}`
          : `${playerId} rejected bribe from ${bribe.offerer}`
      };
    }

    return null;
  },

  onBeforeVote(ctx: HookContext, payload: BeforeVotePayload): { blocked?: boolean; blockReason?: string } | null {
    const config = ctx.config.engine_mechanics?.bribery;
    if (!config || !config.binding) return null;

    const obligations = (ctx.state.shared.bribeObligations as Bribe[]) ?? [];
    const voteObligation = obligations.find(
      b => b.target === ctx.playerId &&
           b.requestedAction === 'vote' &&
           b.status === 'accepted'
    );

    if (voteObligation && voteObligation.requestedDetails) {
      const requestedChoice = voteObligation.requestedDetails.choice as string | number;

      if (payload.choice !== requestedChoice) {
        return {
          blocked: true,
          blockReason: `You accepted a bribe to vote for ${requestedChoice}. Breaking the deal!`
        };
      }
    }

    return null;
  },

  onPlayerVoted(ctx: HookContext, payload: PlayerVotedPayload): StateChanges | null {
    const config = ctx.config.engine_mechanics?.bribery;
    if (!config || !config.binding) return null;

    const obligations = (ctx.state.shared.bribeObligations as Bribe[]) ?? [];
    const voteObligation = obligations.find(
      b => b.target === ctx.playerId &&
           b.requestedAction === 'vote' &&
           b.status === 'accepted'
    );

    if (voteObligation && voteObligation.requestedDetails) {
      const requestedChoice = voteObligation.requestedDetails.choice as string | number;

      if (payload.choice === requestedChoice) {
        return {
          sharedStateChanges: {
            bribeObligations: obligations.map(b =>
              b.id === voteObligation.id ? { ...b, status: 'fulfilled' } : b
            )
          }
        };
      }
    }

    return null;
  },

  getAvailableActions(ctx: HookContext): AvailableAction[] {
    const config = ctx.config.engine_mechanics?.bribery;
    if (!config) return [];

    const actions: AvailableAction[] = [];
    const available = ctx.player.resources?.[config.currency] ?? 0;

    if (available > 0) {
      actions.push({
        action: {
          type: 'offer_bribe',
          targetPlayer: '',
          amount: 1,
          requestedAction: ''
        } as OfferBribeAction,
        priority: 40,
        category: 'social'
      });
    }

    const bribes = (ctx.state.shared.activeBribes as Bribe[]) ?? [];
    const pendingBribes = bribes.filter(
      b => b.target === ctx.playerId && b.status === 'pending'
    );

    for (const bribe of pendingBribes) {
      actions.push({
        action: {
          type: 'respond_to_bribe',
          bribeId: bribe.id,
          accept: true
        } as RespondToBribeAction,
        priority: 85,
        category: 'social'
      });
      actions.push({
        action: {
          type: 'respond_to_bribe',
          bribeId: bribe.id,
          accept: false
        } as RespondToBribeAction,
        priority: 84,
        category: 'social'
      });
    }

    return actions;
  }
};
