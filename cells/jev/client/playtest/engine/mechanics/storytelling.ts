/**
 * Storytelling Mechanic
 *
 * Players tell stories or give creative descriptions. Other players vote/judge.
 * Requires the social core mechanic for voting infrastructure.
 *
 * Hooks used:
 * - getAvailableActions: 'tell_story' and 'vote_story'
 * - onExecuteAction: Handle story submission and voting
 */

import {
  MechanicHooks,
  HookContext,
  ActionExecutionContext,
  ActionExecutionResult,
  AvailableAction,
  SharedStateInitContext,
  SharedStateInitResult,
  isMechanicEnabled
} from './types';
import { GameAction, GameConfig } from '../types/game';

interface StorytellingConfig {
  prompt_deck?: boolean;       // draw prompts from deck
  voting?: 'all' | 'judge';   // who votes
  points_correct?: number;
  points_fooled?: number;
}

interface StorySubmission {
  playerId: string;
  story: string;
  prompt?: string;
}

interface StorytellingState {
  phase: 'storytelling' | 'voting' | 'scoring' | 'idle';
  currentStoryteller: string | null;
  currentPrompt: string | null;
  submissions: StorySubmission[];
  votes: Record<string, string>;  // voterId -> submissionPlayerId
  roundScores: Record<string, number>;
  promptDeck: string[];
}

function getConfig(config: GameConfig): StorytellingConfig | undefined {
  return config.engine_mechanics?.storytelling as StorytellingConfig | undefined;
}

function getStoryState(shared: Record<string, unknown>): StorytellingState | undefined {
  return shared.storytelling as StorytellingState | undefined;
}

export const storytellingMechanic: MechanicHooks = {
  slug: 'storytelling',
  name: 'Storytelling',
  requires: ['social'],

  configSchema: {
    type: 'object',
    description: 'Players tell stories or give creative descriptions, others vote/judge',
    properties: {
      prompt_deck: {
        type: 'boolean',
        description: 'Draw prompts from a deck',
        default: false
      },
      voting: {
        type: 'string',
        description: 'Who votes on stories',
        enum: ['all', 'judge'],
        default: 'all'
      },
      points_correct: {
        type: 'number',
        description: 'Points for correct identification',
        default: 3
      },
      points_fooled: {
        type: 'number',
        description: 'Points for fooling other players',
        default: 1
      }
    }
  },

  /**
   * Initialize storytelling state
   */
  initSharedState(ctx: SharedStateInitContext): SharedStateInitResult | null {
    const config = getConfig(ctx.config);
    if (!config) return null;

    const storytellingState: StorytellingState = {
      phase: 'storytelling',
      currentStoryteller: ctx.playerIds[0] ?? null,
      currentPrompt: null,
      submissions: [],
      votes: {},
      roundScores: {},
      promptDeck: []
    };

    return { storytelling: storytellingState };
  },

  /**
   * Provide tell_story and vote_story actions based on phase
   */
  getAvailableActions(ctx: HookContext): AvailableAction[] {
    if (!isMechanicEnabled(ctx.config, 'storytelling')) return [];

    const config = getConfig(ctx.config);
    if (!config) return [];

    const storyState = getStoryState(ctx.state.shared);
    if (!storyState) return [];

    const actions: AvailableAction[] = [];

    if (storyState.phase === 'storytelling') {
      // Check if this player has already submitted
      const hasSubmitted = storyState.submissions.some(s => s.playerId === ctx.playerId);
      if (!hasSubmitted) {
        actions.push({
          action: {
            type: 'tell_story',
            story: ''
          } as unknown as GameAction,
          priority: 90,
          category: 'storytelling'
        });
      }
    }

    if (storyState.phase === 'voting') {
      // Check if this player has already voted
      const hasVoted = ctx.playerId in storyState.votes;
      const votingType = config.voting ?? 'all';

      // Judges can always vote; in 'all' mode, the storyteller cannot vote on their own story
      const canVote = votingType === 'judge'
        ? ctx.playerId === storyState.currentStoryteller
        : ctx.playerId !== storyState.currentStoryteller;

      if (!hasVoted && canVote) {
        // Add a vote option for each submission (except the voter's own)
        for (const submission of storyState.submissions) {
          if (submission.playerId === ctx.playerId) continue;

          actions.push({
            action: {
              type: 'vote_story',
              targetPlayerId: submission.playerId
            } as unknown as GameAction,
            priority: 85,
            category: 'storytelling'
          });
        }
      }
    }

    return actions;
  },

  /**
   * Handle story submission and voting
   */
  onExecuteAction(ctx: ActionExecutionContext): ActionExecutionResult | null {
    if (ctx.action.type !== 'tell_story' && ctx.action.type !== 'vote_story') return null;

    const config = getConfig(ctx.config);
    if (!config) return null;

    const storyState = getStoryState(ctx.state.shared);
    if (!storyState) return null;

    if (ctx.action.type === 'tell_story') {
      const tellAction = ctx.action as unknown as { type: 'tell_story'; story: string };

      if (storyState.phase !== 'storytelling') {
        return {
          handled: true,
          logMessage: 'Not in storytelling phase.',
          advanceTurn: false,
          checkWin: false
        };
      }

      // Check if already submitted
      if (storyState.submissions.some(s => s.playerId === ctx.playerId)) {
        return {
          handled: true,
          logMessage: 'You have already submitted a story.',
          advanceTurn: false,
          checkWin: false
        };
      }

      // Add submission
      const newSubmissions = [...storyState.submissions, {
        playerId: ctx.playerId,
        story: tellAction.story,
        prompt: storyState.currentPrompt ?? undefined
      }];

      // Check if all players have submitted
      const allPlayers = Object.keys(ctx.state.players);
      const allSubmitted = allPlayers.every(
        p => newSubmissions.some(s => s.playerId === p)
      );

      const updatedState: StorytellingState = {
        ...storyState,
        submissions: newSubmissions,
        phase: allSubmitted ? 'voting' : 'storytelling'
      };

      return {
        handled: true,
        stateChanges: {
          sharedStateChanges: { storytelling: updatedState }
        },
        advanceTurn: !allSubmitted,
        checkWin: false,
        logMessage: allSubmitted
          ? 'All stories submitted. Voting begins!'
          : `${ctx.playerId} submitted their story.`,
        logData: {
          player: ctx.playerId,
          allSubmitted,
          submissionCount: newSubmissions.length
        }
      };
    }

    if (ctx.action.type === 'vote_story') {
      const voteAction = ctx.action as unknown as { type: 'vote_story'; targetPlayerId: string };

      if (storyState.phase !== 'voting') {
        return {
          handled: true,
          logMessage: 'Not in voting phase.',
          advanceTurn: false,
          checkWin: false
        };
      }

      // Record vote
      const updatedVotes = { ...storyState.votes, [ctx.playerId]: voteAction.targetPlayerId };

      // Determine eligible voters
      const allPlayers = Object.keys(ctx.state.players);
      const votingType = config.voting ?? 'all';
      const eligibleVoters = votingType === 'judge'
        ? [storyState.currentStoryteller].filter(Boolean) as string[]
        : allPlayers.filter(p => p !== storyState.currentStoryteller);

      const allVoted = eligibleVoters.every(p => updatedVotes[p] !== undefined);

      let updatedPhase: StorytellingState['phase'] = 'voting';
      const roundScores: Record<string, number> = {};

      if (allVoted) {
        updatedPhase = 'scoring';

        // Calculate scores
        const pointsCorrect = config.points_correct ?? 3;
        const pointsFooled = config.points_fooled ?? 1;

        for (const [voterId, targetId] of Object.entries(updatedVotes)) {
          // If the voter correctly identified the storyteller
          if (targetId === storyState.currentStoryteller) {
            roundScores[voterId] = (roundScores[voterId] ?? 0) + pointsCorrect;
            roundScores[targetId] = (roundScores[targetId] ?? 0) + pointsCorrect;
          } else {
            // The target fooled the voter
            roundScores[targetId] = (roundScores[targetId] ?? 0) + pointsFooled;
          }
        }
      }

      const updatedState: StorytellingState = {
        ...storyState,
        votes: updatedVotes,
        phase: updatedPhase,
        roundScores: allVoted ? roundScores : storyState.roundScores
      };

      // Apply scores to players
      const playerStateChanges: Record<string, { score: number }> = {};
      if (allVoted) {
        for (const [playerId, points] of Object.entries(roundScores)) {
          const currentScore = ctx.state.players[playerId]?.score ?? 0;
          playerStateChanges[playerId] = { score: currentScore + points };
        }
      }

      return {
        handled: true,
        stateChanges: {
          sharedStateChanges: { storytelling: updatedState },
          ...(allVoted && Object.keys(playerStateChanges).length > 0
            ? { playerStateChanges }
            : {})
        },
        advanceTurn: !allVoted,
        checkWin: allVoted,
        logMessage: allVoted
          ? `Voting complete! Scores awarded.`
          : `${ctx.playerId} voted.`,
        logData: {
          player: ctx.playerId,
          allVoted,
          roundScores: allVoted ? roundScores : undefined
        }
      };
    }

    return null;
  }
};
