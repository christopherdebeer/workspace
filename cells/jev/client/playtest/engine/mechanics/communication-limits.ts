/**
 * Communication Limits Mechanic
 *
 * Restricts when and how players can communicate with each other.
 * Creates information asymmetry and strategic communication.
 * Examples: Hanabi (limited communication), Codenames (one-word clues)
 *
 * Hooks used:
 * - getAvailableActions: Expose communication actions
 * - onExecuteAction: Handle message/signal actions
 * - preValidateAction: Block communication outside allowed windows
 *
 * Config options:
 * - communication_phases: When communication is allowed
 * - message_types: Types of messages allowed
 * - limits: Quantity/length restrictions
 * - target_restrictions: Who can talk to whom
 */

import {
  MechanicHooks,
  ActionExecutionContext,
  ActionExecutionResult,
  AvailableAction,
  HookContext,
  TurnEndContext,
  StateChanges,
  ValidationResult,
  isMechanicEnabled
} from './types';
import { GameAction, PlayerState } from '../types/game';

export interface CommunicationLimitsConfig {
  communication_phases?: CommunicationPhase[];
  message_types?: MessageType[];
  limits?: CommunicationLimits;
  target_restrictions?: TargetRestriction[];
  no_table_talk?: boolean;
  team_only?: boolean;
  one_word_clues?: boolean;
  signal_vocabulary?: string[];
}

export interface CommunicationPhase {
  phase: 'turn_start' | 'turn_end' | 'round_start' | 'round_end' | 'always' | 'never';
  duration?: number;
}

export interface MessageType {
  type: 'word' | 'phrase' | 'signal' | 'gesture' | 'number' | 'choice';
  maxLength?: number;
  vocabulary?: string[];
}

export interface CommunicationLimits {
  messages_per_turn?: number;
  messages_per_round?: number;
  words_per_message?: number;
  characters_per_message?: number;
  total_messages?: number;
}

export interface TargetRestriction {
  from?: string[];
  to?: string[];
  allow?: boolean;
  same_team_only?: boolean;
}

export interface CommunicateAction {
  type: 'communicate' | 'signal' | 'give_clue';
  targetPlayer?: string;
  targetTeam?: string;
  message?: string;
  signal?: string;
  number?: number;
}

// Type guard for extended player state
function getPlayerExtras(player: PlayerState): Record<string, unknown> {
  return player as unknown as Record<string, unknown>;
}

export const communicationLimitsMechanic: MechanicHooks = {
  slug: 'communication-limits',
  name: 'Communication Limits',
  requires: ['social'],

  getAvailableActions(ctx: HookContext): AvailableAction[] {
    if (!isMechanicEnabled(ctx.config, 'communication-limits')) return [];

    const config = ctx.config.engine_mechanics?.communication_limits as CommunicationLimitsConfig | undefined;
    if (!config) return [];

    if (!isInCommunicationPhase(ctx, config)) return [];

    const player = ctx.state.players[ctx.playerId];
    if (!player) return [];

    const extras = getPlayerExtras(player);
    const messagesThisTurn = (extras.messagesThisTurn as number) ?? 0;
    const messagesThisRound = (extras.messagesThisRound as number) ?? 0;
    const totalMessages = (extras.totalMessages as number) ?? 0;

    const limits = config.limits ?? {};

    if (limits.messages_per_turn !== undefined && messagesThisTurn >= limits.messages_per_turn) {
      return [];
    }
    if (limits.messages_per_round !== undefined && messagesThisRound >= limits.messages_per_round) {
      return [];
    }
    if (limits.total_messages !== undefined && totalMessages >= limits.total_messages) {
      return [];
    }

    const actions: AvailableAction[] = [];
    const validTargets = getValidCommunicationTargets(ctx.playerId, ctx.state, config);
    const messageTypes = config.message_types ?? [{ type: 'phrase' }];

    for (const targetId of validTargets) {
      for (const msgType of messageTypes) {
        if (msgType.type === 'signal' && config.signal_vocabulary) {
          for (const signal of config.signal_vocabulary) {
            actions.push({
              action: { type: 'pass' },  // Placeholder
              priority: 30,
              category: 'social'
            });
          }
        } else if (msgType.type === 'word' || config.one_word_clues) {
          actions.push({
            action: { type: 'pass' },
            priority: 35,
            category: 'social'
          });
        } else {
          actions.push({
            action: { type: 'pass' },
            priority: 25,
            category: 'social'
          });
        }
      }
    }

    return actions;
  },

  preValidateAction(ctx: HookContext, action: GameAction): ValidationResult | null {
    if (!isMechanicEnabled(ctx.config, 'communication-limits')) return null;

    const commAction = action as unknown as CommunicateAction;
    if (!['communicate', 'signal', 'give_clue'].includes(commAction.type)) {
      return null;
    }

    const config = ctx.config.engine_mechanics?.communication_limits as CommunicationLimitsConfig | undefined;
    if (!config) return null;

    if (!isInCommunicationPhase(ctx, config)) {
      return { valid: false, error: 'Communication is not allowed at this time' };
    }

    if (commAction.targetPlayer) {
      const validTargets = getValidCommunicationTargets(ctx.playerId, ctx.state, config);
      if (!validTargets.includes(commAction.targetPlayer)) {
        return { valid: false, error: `Cannot communicate with ${commAction.targetPlayer}` };
      }
    }

    const player = ctx.state.players[ctx.playerId];
    if (!player) return null;

    const extras = getPlayerExtras(player);
    const messagesThisTurn = (extras.messagesThisTurn as number) ?? 0;
    const limits = config.limits ?? {};

    if (limits.messages_per_turn !== undefined && messagesThisTurn >= limits.messages_per_turn) {
      return { valid: false, error: 'Message limit reached for this turn' };
    }

    if (commAction.message) {
      if (config.one_word_clues) {
        const words = commAction.message.trim().split(/\s+/);
        if (words.length > 1) {
          return { valid: false, error: 'Only one word allowed per clue' };
        }
      }

      if (limits.words_per_message !== undefined) {
        const words = commAction.message.trim().split(/\s+/);
        if (words.length > limits.words_per_message) {
          return { valid: false, error: `Maximum ${limits.words_per_message} words allowed` };
        }
      }

      if (limits.characters_per_message !== undefined) {
        if (commAction.message.length > limits.characters_per_message) {
          return { valid: false, error: `Maximum ${limits.characters_per_message} characters allowed` };
        }
      }
    }

    if (commAction.signal && config.signal_vocabulary) {
      if (!config.signal_vocabulary.includes(commAction.signal)) {
        return { valid: false, error: `Invalid signal. Allowed: ${config.signal_vocabulary.join(', ')}` };
      }
    }

    return null;
  },

  onExecuteAction(ctx: ActionExecutionContext): ActionExecutionResult | null {
    const { action, playerId, state } = ctx;
    if (!isMechanicEnabled(ctx.config, 'communication-limits')) return null;

    const commAction = action as unknown as CommunicateAction;
    if (!['communicate', 'signal', 'give_clue'].includes(commAction.type)) {
      return null;
    }

    const player = state.players[playerId];
    if (!player) return null;

    const extras = getPlayerExtras(player);
    extras.messagesThisTurn = ((extras.messagesThisTurn as number) ?? 0) + 1;
    extras.messagesThisRound = ((extras.messagesThisRound as number) ?? 0) + 1;
    extras.totalMessages = ((extras.totalMessages as number) ?? 0) + 1;

    if (!state.shared) state.shared = {};
    const shared = state.shared as Record<string, unknown>;
    if (!shared.messages) shared.messages = [];

    const messages = shared.messages as Array<{
      from: string;
      to: string;
      type: string;
      content: string | number;
      turn: number;
    }>;

    messages.push({
      from: playerId,
      to: commAction.targetPlayer ?? 'all',
      type: commAction.type,
      content: commAction.message ?? commAction.signal ?? commAction.number ?? '',
      turn: state.turnNumber ?? 0
    });

    return {
      handled: true,
      advanceTurn: false,
      logData: {
        type: commAction.type,
        to: commAction.targetPlayer ?? 'all',
        content: commAction.message ?? commAction.signal ?? commAction.number
      }
    };
  },

  onTurnEnd(ctx: TurnEndContext): StateChanges | null {
    if (!isMechanicEnabled(ctx.config, 'communication-limits')) return null;

    const player = ctx.state.players[ctx.playerId];
    if (!player) return null;

    const extras = getPlayerExtras(player);
    extras.messagesThisTurn = 0;

    return null;
  },

  describeAction(action) {
    const commAction = action as unknown as CommunicateAction;

    if (commAction.type === 'communicate') {
      return {
        type: 'communicate',
        label: 'Send Message',
        description: 'Send a message to another player (within limits)',
        examples: ['{ "type": "communicate", "targetPlayer": "player-2", "message": "hello" }']
      };
    }

    if (commAction.type === 'signal') {
      return {
        type: 'signal',
        label: 'Send Signal',
        description: 'Send a predefined signal to another player',
        examples: ['{ "type": "signal", "targetPlayer": "player-2", "signal": "yes" }']
      };
    }

    if (commAction.type === 'give_clue') {
      return {
        type: 'give_clue',
        label: 'Give Clue',
        description: 'Give a one-word clue to another player',
        examples: ['{ "type": "give_clue", "targetPlayer": "player-2", "message": "river" }']
      };
    }

    return null;
  },

  configSchema: {
    type: 'object',
    description: 'Restricts when and how players can communicate.'
  }
};

function isInCommunicationPhase(ctx: HookContext, config: CommunicationLimitsConfig): boolean {
  const phases = config.communication_phases ?? [{ phase: 'always' }];

  for (const phase of phases) {
    if (phase.phase === 'always') return true;
    if (phase.phase === 'never') return false;

    const shared = ctx.state.shared as Record<string, unknown> ?? {};
    const currentPhase = shared.gamePhase as string | undefined;

    if (phase.phase === currentPhase) return true;
  }

  return true;
}

function getValidCommunicationTargets(
  playerId: string,
  state: { players: Record<string, PlayerState>; shared?: Record<string, unknown> },
  config: CommunicationLimitsConfig
): string[] {
  const targets: string[] = [];

  for (const targetId of Object.keys(state.players)) {
    if (targetId === playerId) continue;

    if (config.team_only) {
      const myExtras = getPlayerExtras(state.players[playerId]);
      const theirExtras = getPlayerExtras(state.players[targetId]);
      const myTeam = myExtras.team as string | undefined;
      const theirTeam = theirExtras.team as string | undefined;
      if (myTeam && theirTeam && myTeam !== theirTeam) continue;
    }

    if (Array.isArray(config.target_restrictions) && config.target_restrictions.length > 0) {
      let allowed = true;
      for (const restriction of config.target_restrictions) {
        const fromMatches = !restriction.from || restriction.from.includes(playerId);
        const toMatches = !restriction.to || restriction.to.includes(targetId);

        if (fromMatches && toMatches) {
          if (restriction.allow === false) {
            allowed = false;
            break;
          }
        }
      }
      if (!allowed) continue;
    }

    targets.push(targetId);
  }

  return targets;
}
