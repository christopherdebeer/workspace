/**
 * Core Social Operations - Foundational services for voting and social mechanics
 *
 * This provides primitive operations for:
 * - Voting (casting votes, tallying, resolving ties)
 * - Negotiation tracking (future)
 * - Communication state (future)
 *
 * Fires social-defined hooks:
 * - onBeforeVote: Can block a vote (blocking)
 * - onPlayerVoted: React to vote being cast (merge)
 * - onVoteTally: Custom vote tallying logic (first)
 * - onVoteCompleted: React to voting session completing (merge)
 */

import { GameState, GameConfig } from '../../types/game';
import { mechanicRegistry, applyStateChanges } from '../registry';

// ============ Types ============

/**
 * A vote cast by a player
 */
export interface Vote {
  playerId: string;
  choice: string | number | null;
  timestamp: string;
  round: number;
  turnNumber: number;
}

/**
 * Active voting session
 */
export interface VotingSession {
  id: string;
  topic: string;
  /** Players who must vote */
  eligibleVoters: string[];
  /** Votes cast so far */
  votes: Record<string, Vote>;
  /** When voting started */
  startedAt: string;
  /** When voting phase started (round/turn) */
  startedAtRound: number;
  startedAtTurn: number;
  /** Whether voting is complete */
  complete: boolean;
  /** Voting result (if complete) */
  result?: VotingResult;
  /** Voting configuration */
  config: VotingConfig;
}

/**
 * Configuration for a voting session
 */
export interface VotingConfig {
  /** Type of voting (majority, plurality, unanimous) */
  type: 'majority' | 'plurality' | 'unanimous';
  /** Whether abstaining is allowed */
  allowAbstain?: boolean;
  /** Whether to use secret ballot */
  secret?: boolean;
  /** Tiebreaker method */
  tiebreaker?: 'random' | 'current_player' | 'none' | 'revote';
  /** Timeout in turns (0 = no timeout) */
  timeoutTurns?: number;
  /** Valid choices (if restricted) */
  validChoices?: (string | number)[];
}

/**
 * Result of a completed vote
 */
export interface VotingResult {
  winner: string | number | null;
  tied: boolean;
  tiedChoices?: (string | number)[];
  tiebreakerUsed?: string;
  voteCounts: Record<string, number>;
  totalVotes: number;
  abstentions: number;
}

// ============ Voting Operations ============

/**
 * Start a new voting session
 */
export function startVoting(
  state: GameState,
  topic: string,
  eligibleVoters?: string[],
  config?: Partial<VotingConfig>
): string {
  const voteId = `vote_${Date.now()}`;
  const voters = eligibleVoters ?? Object.keys(state.players);

  const session: VotingSession = {
    id: voteId,
    topic,
    eligibleVoters: voters,
    votes: {},
    startedAt: new Date().toISOString(),
    startedAtRound: state.round,
    startedAtTurn: state.turnNumber,
    complete: false,
    config: {
      type: config?.type ?? 'plurality',
      allowAbstain: config?.allowAbstain ?? true,
      secret: config?.secret ?? false,
      tiebreaker: config?.tiebreaker ?? 'random',
      timeoutTurns: config?.timeoutTurns ?? 0,
      validChoices: config?.validChoices
    }
  };

  // Store in shared state
  const votingSessions = (state.shared.votingSessions ?? {}) as Record<string, VotingSession>;
  votingSessions[voteId] = session;
  state.shared.votingSessions = votingSessions;
  state.shared.activeVoteId = voteId;

  return voteId;
}

/**
 * Cast a vote in an active voting session
 */
export function castVote(
  state: GameState,
  voteId: string,
  playerId: string,
  choice: string | number | null
): { success: boolean; error?: string } {
  const votingSessions = (state.shared.votingSessions ?? {}) as Record<string, VotingSession>;
  const session = votingSessions[voteId];

  if (!session) {
    return { success: false, error: `Voting session ${voteId} not found` };
  }

  if (session.complete) {
    return { success: false, error: 'Voting session is already complete' };
  }

  if (!session.eligibleVoters.includes(playerId)) {
    return { success: false, error: `Player ${playerId} is not eligible to vote` };
  }

  if (session.votes[playerId]) {
    return { success: false, error: `Player ${playerId} has already voted` };
  }

  // Validate choice
  if (choice === null && !session.config.allowAbstain) {
    return { success: false, error: 'Abstaining is not allowed in this vote' };
  }

  if (choice !== null && session.config.validChoices) {
    if (!session.config.validChoices.includes(choice)) {
      return { success: false, error: `Invalid choice: ${choice}` };
    }
  }

  // Fire social-defined onBeforeVote hook (blocking)
  const definedBeforeResult = mechanicRegistry.fire('social', 'onBeforeVote', state, playerId, {
    sessionId: voteId, choice
  });
  if (definedBeforeResult && (definedBeforeResult as Record<string, unknown>).blocked) {
    const blockReason = (definedBeforeResult as Record<string, unknown>).blockReason as string | undefined;
    return { success: false, error: blockReason ?? 'Vote blocked' };
  }

  // Record the vote
  session.votes[playerId] = {
    playerId,
    choice,
    timestamp: new Date().toISOString(),
    round: state.round,
    turnNumber: state.turnNumber
  };

  // Fire social-defined onPlayerVoted hook (merge)
  const votedChanges = mechanicRegistry.fire('social', 'onPlayerVoted', state, playerId, {
    sessionId: voteId, choice
  });
  if (votedChanges) applyStateChanges(state, votedChanges);

  // Check if voting is complete
  if (Object.keys(session.votes).length >= session.eligibleVoters.length) {
    session.complete = true;

    // Fire social-defined onVoteTally hook (first) — custom tally logic
    const votes: Record<string, string | number | null> = {};
    for (const [pid, vote] of Object.entries(session.votes)) {
      votes[pid] = vote.choice;
    }
    const customTally = mechanicRegistry.fire('social', 'onVoteTally', state, playerId, {
      sessionId: voteId, topic: session.topic, votes
    });

    if (customTally && (customTally as Record<string, unknown>).winner !== undefined) {
      // Use custom tally result
      const ct = customTally as Record<string, unknown>;
      const internalResult = tallyVotesInternal(session);
      session.result = {
        ...internalResult,
        winner: ct.winner as string | number | null,
        tied: (ct.tied as boolean) ?? false,
        tiedChoices: ct.tiedChoices as (string | number)[] | undefined,
        tiebreakerUsed: ct.tiebreakerUsed as string | undefined,
      };
    } else {
      session.result = tallyVotesInternal(session);
    }

    // Fire social-defined onVoteCompleted hook (merge)
    if (session.result) {
      const completedChanges = mechanicRegistry.fire('social', 'onVoteCompleted', state, playerId, {
        sessionId: voteId,
        topic: session.topic,
        winner: session.result.winner,
        tied: session.result.tied,
        voteCounts: session.result.voteCounts
      });
      if (completedChanges) applyStateChanges(state, completedChanges);
    }
  }

  return { success: true };
}

/**
 * Get the current voting session
 */
export function getActiveVotingSession(state: GameState): VotingSession | null {
  const activeVoteId = state.shared.activeVoteId as string | undefined;
  if (!activeVoteId) return null;

  const votingSessions = (state.shared.votingSessions ?? {}) as Record<string, VotingSession>;
  return votingSessions[activeVoteId] ?? null;
}

/**
 * Get a voting session by ID
 */
export function getVotingSession(state: GameState, voteId: string): VotingSession | null {
  const votingSessions = (state.shared.votingSessions ?? {}) as Record<string, VotingSession>;
  return votingSessions[voteId] ?? null;
}

/**
 * Check if a player has voted in the active session
 */
export function hasVoted(state: GameState, playerId: string, voteId?: string): boolean {
  const session = voteId
    ? getVotingSession(state, voteId)
    : getActiveVotingSession(state);

  if (!session) return false;
  return playerId in session.votes;
}

/**
 * Get players who haven't voted yet
 */
export function getPendingVoters(state: GameState, voteId?: string): string[] {
  const session = voteId
    ? getVotingSession(state, voteId)
    : getActiveVotingSession(state);

  if (!session) return [];
  return session.eligibleVoters.filter(p => !(p in session.votes));
}

/**
 * Check if voting is complete
 */
export function isVotingComplete(state: GameState, voteId?: string): boolean {
  const session = voteId
    ? getVotingSession(state, voteId)
    : getActiveVotingSession(state);

  return session?.complete ?? false;
}

/**
 * Get the result of a completed vote
 */
export function getVotingResult(state: GameState, voteId?: string): VotingResult | null {
  const session = voteId
    ? getVotingSession(state, voteId)
    : getActiveVotingSession(state);

  return session?.result ?? null;
}

/**
 * Force-complete a voting session (e.g., on timeout)
 */
export function completeVoting(state: GameState, voteId?: string): VotingResult | null {
  const targetVoteId = voteId ?? (state.shared.activeVoteId as string | undefined);
  if (!targetVoteId) return null;

  const votingSessions = (state.shared.votingSessions ?? {}) as Record<string, VotingSession>;
  const session = votingSessions[targetVoteId];

  if (!session || session.complete) return session?.result ?? null;

  session.complete = true;
  session.result = tallyVotesInternal(session);

  // Clear active vote if this was it
  if (state.shared.activeVoteId === targetVoteId) {
    state.shared.activeVoteId = undefined;
  }

  return session.result;
}

/**
 * Internal vote tallying logic
 */
function tallyVotesInternal(session: VotingSession): VotingResult {
  const voteCounts: Record<string, number> = {};
  let abstentions = 0;
  let totalVotes = 0;

  // Count votes
  for (const vote of Object.values(session.votes)) {
    totalVotes++;
    if (vote.choice === null) {
      abstentions++;
    } else {
      const choiceKey = String(vote.choice);
      voteCounts[choiceKey] = (voteCounts[choiceKey] ?? 0) + 1;
    }
  }

  // Find winner based on voting type
  const { type, tiebreaker } = session.config;
  const entries = Object.entries(voteCounts).sort((a, b) => b[1] - a[1]);

  if (entries.length === 0) {
    return {
      winner: null,
      tied: false,
      voteCounts,
      totalVotes,
      abstentions
    };
  }

  const maxVotes = entries[0][1];
  const topChoices = entries.filter(([_, count]) => count === maxVotes).map(([choice]) => choice);

  // Check if winner requirement is met
  let winner: string | number | null = null;
  let tied = topChoices.length > 1;
  let tiebreakerUsed: string | undefined;

  if (type === 'unanimous') {
    // Unanimous requires all non-abstaining votes for same choice
    if (topChoices.length === 1 && maxVotes === totalVotes - abstentions) {
      winner = topChoices[0];
      tied = false;
    }
  } else if (type === 'majority') {
    // Majority requires > 50% of votes
    const threshold = Math.floor((totalVotes - abstentions) / 2) + 1;
    if (maxVotes >= threshold) {
      if (topChoices.length === 1) {
        winner = topChoices[0];
        tied = false;
      }
    }
  } else {
    // Plurality: most votes wins
    if (topChoices.length === 1) {
      winner = topChoices[0];
      tied = false;
    }
  }

  // Handle tie
  if (tied && tiebreaker && tiebreaker !== 'none' && tiebreaker !== 'revote') {
    if (tiebreaker === 'random') {
      const randomIndex = Math.floor(Math.random() * topChoices.length);
      winner = topChoices[randomIndex];
      tiebreakerUsed = 'random';
      tied = false;
    }
    // Note: current_player tiebreaker would need state context, handled by mechanic
  }

  // Parse winner back to number if it was a number
  if (winner !== null && !isNaN(Number(winner))) {
    winner = Number(winner);
  }

  return {
    winner,
    tied,
    tiedChoices: tied ? topChoices.map(c => isNaN(Number(c)) ? c : Number(c)) : undefined,
    tiebreakerUsed,
    voteCounts,
    totalVotes,
    abstentions
  };
}

/**
 * Get vote counts for the current session (for display)
 */
export function getVoteCounts(state: GameState, voteId?: string): Record<string, number> {
  const session = voteId
    ? getVotingSession(state, voteId)
    : getActiveVotingSession(state);

  if (!session) return {};

  const counts: Record<string, number> = {};
  for (const vote of Object.values(session.votes)) {
    if (vote.choice !== null) {
      const key = String(vote.choice);
      counts[key] = (counts[key] ?? 0) + 1;
    }
  }
  return counts;
}

/**
 * Clear completed voting sessions (cleanup)
 */
export function clearCompletedVotes(state: GameState, keepLast: number = 3): void {
  const votingSessions = (state.shared.votingSessions ?? {}) as Record<string, VotingSession>;
  const completed = Object.entries(votingSessions)
    .filter(([_, s]) => s.complete)
    .sort((a, b) => new Date(b[1].startedAt).getTime() - new Date(a[1].startedAt).getTime());

  // Remove old completed sessions
  for (let i = keepLast; i < completed.length; i++) {
    delete votingSessions[completed[i][0]];
  }
}

// ============ Vote Action Types ============

/**
 * Check if a vote action is valid
 */
export function validateVoteAction(
  state: GameState,
  playerId: string,
  choice: string | number | null,
  voteId?: string
): { valid: boolean; error?: string } {
  const session = voteId
    ? getVotingSession(state, voteId)
    : getActiveVotingSession(state);

  if (!session) {
    return { valid: false, error: 'No active voting session' };
  }

  if (session.complete) {
    return { valid: false, error: 'Voting is already complete' };
  }

  if (!session.eligibleVoters.includes(playerId)) {
    return { valid: false, error: 'You are not eligible to vote' };
  }

  if (session.votes[playerId]) {
    return { valid: false, error: 'You have already voted' };
  }

  if (choice === null && !session.config.allowAbstain) {
    return { valid: false, error: 'Abstaining is not allowed' };
  }

  if (choice !== null && session.config.validChoices) {
    if (!session.config.validChoices.includes(choice)) {
      return { valid: false, error: `Invalid choice: ${choice}. Valid choices: ${session.config.validChoices.join(', ')}` };
    }
  }

  return { valid: true };
}
