/**
 * Voting Mechanic (Phase 5)
 *
 * Enables democratic decision-making through voting.
 * Supports majority, plurality, and unanimous voting types.
 *
 * BGG Reference: Voting (2011)
 * https://boardgamegeek.com/boardgamemechanic/2079/voting
 *
 * Config options:
 * - voting.type: 'majority' | 'plurality' | 'unanimous'
 * - voting.allowAbstain: Whether players can abstain
 * - voting.secret: Whether votes are secret until revealed
 * - voting.tiebreaker: How to resolve ties
 * - voting.topics: Predefined voting topics
 */

import {
  MechanicHooks,
  HookContext,
  ActionExecutionContext,
  ActionExecutionResult,
  AvailableAction,
  isMechanicEnabled
} from './types';
import { GameAction, VotingMechanicConfig } from '../types/game';
import type { SocialHooks, VoteTallyPayload, VoteTallyHookResult } from './core/social-mechanic';
import {
  startVoting,
  castVote,
  getActiveVotingSession,
  hasVoted,
  getPendingVoters,
  isVotingComplete,
  getVotingResult,
  validateVoteAction
} from './core/social';

export const votingMechanic: MechanicHooks & SocialHooks = {
  slug: 'voting',
  name: 'Voting',
  requires: ['social'],

  /**
   * Provide vote action when a voting session is active
   */
  getAvailableActions(ctx: HookContext): AvailableAction[] {
    if (!isMechanicEnabled(ctx.config, 'voting')) {
      return [];
    }

    const session = getActiveVotingSession(ctx.state);
    if (!session) return [];

    // Check if player can vote
    if (!session.eligibleVoters.includes(ctx.playerId)) return [];
    if (hasVoted(ctx.state, ctx.playerId)) return [];

    const actions: AvailableAction[] = [];

    // Get valid choices
    const choices = session.config.validChoices ?? [];

    // Add vote actions for each choice
    for (const choice of choices) {
      actions.push({
        action: {
          type: 'vote' as any,
          choice,
          voteId: session.id,
          reasoning: `Vote for ${choice}`
        },
        priority: 100,
        category: 'voting'
      });
    }

    // Add abstain action if allowed
    if (session.config.allowAbstain) {
      actions.push({
        action: {
          type: 'vote' as any,
          choice: null,
          voteId: session.id,
          reasoning: 'Abstain from voting'
        },
        priority: 50,
        category: 'voting'
      });
    }

    return actions;
  },

  /**
   * Execute vote action
   */
  onExecuteAction(ctx: ActionExecutionContext): ActionExecutionResult | null {
    if (!isMechanicEnabled(ctx.config, 'voting')) {
      return null;
    }

    const action = ctx.action as GameAction & { type: 'vote'; choice: string | number | null; voteId?: string };
    if (action.type !== 'vote') return null;

    const voteId = action.voteId;
    const choice = action.choice;

    // Validate
    const validation = validateVoteAction(ctx.state, ctx.playerId, choice, voteId);
    if (!validation.valid) {
      return {
        handled: true,
        logMessage: `Vote rejected: ${validation.error}`,
        logData: { playerId: ctx.playerId, choice, error: validation.error }
      };
    }

    // Cast the vote
    const result = castVote(ctx.state, voteId ?? '', ctx.playerId, choice);

    if (!result.success) {
      return {
        handled: true,
        logMessage: `Vote failed: ${result.error}`,
        logData: { playerId: ctx.playerId, choice, error: result.error }
      };
    }

    // Check if voting is complete
    const session = getActiveVotingSession(ctx.state);
    const complete = isVotingComplete(ctx.state, voteId);

    let logMessage = `${ctx.playerId} voted`;
    if (!session?.config.secret) {
      logMessage += ` for ${choice ?? 'abstain'}`;
    }

    if (complete) {
      const votingResult = getVotingResult(ctx.state, voteId);
      logMessage += `. Voting complete: ${votingResult?.winner ?? 'no winner'}`;
    }

    return {
      handled: true,
      advanceTurn: !complete, // Only advance turn if voting continues
      logMessage,
      logData: {
        playerId: ctx.playerId,
        choice: session?.config.secret ? '[secret]' : choice,
        complete,
        result: complete ? getVotingResult(ctx.state, voteId) : undefined
      }
    };
  },

  /**
   * Custom vote tallying with config-driven voting type and tiebreakers.
   * Social-defined hook (first resolution) — overrides internal tally.
   */
  onVoteTally(ctx: HookContext, payload: VoteTallyPayload): VoteTallyHookResult | null {
    if (!isMechanicEnabled(ctx.config, 'voting')) {
      return null;
    }

    const votingConfig = ctx.config.engine_mechanics?.voting;
    if (!votingConfig) return null;

    // Count votes
    const voteCounts: Record<string, number> = {};
    let abstentions = 0;
    let totalVotes = 0;

    for (const choice of Object.values(payload.votes)) {
      totalVotes++;
      if (choice === null) {
        abstentions++;
      } else {
        const key = String(choice);
        voteCounts[key] = (voteCounts[key] ?? 0) + 1;
      }
    }

    const entries = Object.entries(voteCounts).sort((a, b) => b[1] - a[1]);
    if (entries.length === 0) {
      return {
        winner: null,
        tied: false,
      };
    }

    const maxVotes = entries[0][1];
    const topChoices = entries.filter(([_, count]) => count === maxVotes).map(([choice]) => choice);

    // Determine winner based on voting type
    const type = votingConfig.type ?? 'plurality';
    let winner: string | number | null = null;
    let tied = topChoices.length > 1;

    if (type === 'unanimous') {
      if (topChoices.length === 1 && maxVotes === totalVotes - abstentions) {
        winner = topChoices[0];
        tied = false;
      }
    } else if (type === 'majority') {
      const threshold = Math.floor((totalVotes - abstentions) / 2) + 1;
      if (maxVotes >= threshold && topChoices.length === 1) {
        winner = topChoices[0];
        tied = false;
      }
    } else {
      // Plurality
      if (topChoices.length === 1) {
        winner = topChoices[0];
        tied = false;
      }
    }

    // Handle tiebreaker
    let tiebreakerUsed: string | undefined;
    if (tied && votingConfig.tiebreaker) {
      if (votingConfig.tiebreaker === 'random') {
        const randomIndex = Math.floor(Math.random() * topChoices.length);
        winner = topChoices[randomIndex];
        tiebreakerUsed = 'random';
        tied = false;
      } else if (votingConfig.tiebreaker === 'current_player') {
        // Current player breaks tie
        if (ctx.state.currentPlayer && topChoices.includes(ctx.state.currentPlayer)) {
          winner = ctx.state.currentPlayer;
          tiebreakerUsed = 'current_player';
          tied = false;
        }
      }
    }

    return {
      winner,
      tied,
      tiedChoices: tied ? topChoices : undefined,
      tiebreakerUsed,
    };
  }
};
