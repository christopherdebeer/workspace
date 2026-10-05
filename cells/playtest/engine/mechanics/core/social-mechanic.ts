/**
 * Social Core Mechanic
 *
 * Defines the foundational social domain hooks that social/voting mechanics implement.
 * Any mechanic that works with voting, negotiation, or communication should declare
 * `requires: ['social']` and implement the hooks defined here.
 *
 * This mechanic is always enabled. Core social services fire these hooks
 * and only mechanics that declare `requires: ['social']` receive them.
 *
 * Defined hooks:
 * - onVoteCompleted: After a voting session completes (merge)
 * - onPlayerVoted: After a player casts a vote (merge)
 * - onBeforeVote: Before a vote is cast, can block (blocking)
 * - onVoteTally: Custom vote tallying logic, first handler wins (first)
 */

import { MechanicHooks, HookContext, StateChanges } from '../types';

// ============ Payload types for social-defined hooks ============

export interface VoteCompletedPayload {
  /** Voting session ID */
  sessionId: string;
  /** Topic being voted on */
  topic: string;
  /** Winning choice (null if tied with no tiebreaker) */
  winner: string | number | null;
  /** Whether the vote was tied */
  tied: boolean;
  /** Vote counts per choice */
  voteCounts: Record<string, number>;
}

export interface PlayerVotedPayload {
  /** Voting session ID */
  sessionId: string;
  /** The choice the player voted for */
  choice: string | number | null;
}

export interface BeforeVotePayload {
  /** Voting session ID */
  sessionId: string;
  /** The choice the player wants to vote for */
  choice: string | number | null;
}

export interface VoteTallyPayload {
  /** Voting session ID */
  sessionId: string;
  /** Topic being voted on */
  topic: string;
  /** All votes cast: playerId -> choice */
  votes: Record<string, string | number | null>;
}

export interface VoteTallyHookResult {
  /** The winning choice */
  winner: string | number | null;
  /** True if vote tied */
  tied?: boolean;
  /** Tied choices (if tied) */
  tiedChoices?: (string | number)[];
  /** How tie was resolved */
  tiebreakerUsed?: string;
}

// ============ Typed interface for dependents ============

/**
 * Hook methods defined by the social core mechanic.
 * Mechanics that declare `requires: ['social']` can implement these.
 */
export interface SocialHooks {
  onVoteCompleted?(ctx: HookContext, payload: VoteCompletedPayload): StateChanges | null;
  onPlayerVoted?(ctx: HookContext, payload: PlayerVotedPayload): StateChanges | null;
  onBeforeVote?(ctx: HookContext, payload: BeforeVotePayload): { blocked?: boolean; blockReason?: string } | null;
  onVoteTally?(ctx: HookContext, payload: VoteTallyPayload): VoteTallyHookResult | null;
}

// ============ The mechanic itself ============

export const socialMechanic: MechanicHooks = {
  slug: 'social',
  name: 'Social Core',

  defines: {
    onBeforeVote: {
      description: 'Before a vote is cast. Can block.',
      resolution: 'blocking',
    },
    onPlayerVoted: {
      description: 'After a player casts a vote.',
      resolution: 'merge',
    },
    onVoteCompleted: {
      description: 'After a voting session completes.',
      resolution: 'merge',
    },
    onVoteTally: {
      description: 'Custom vote tallying logic. First handler wins.',
      resolution: 'first',
    },
  },
};
