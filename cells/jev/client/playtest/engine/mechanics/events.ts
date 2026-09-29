/**
 * Events Mechanic
 *
 * Random or scheduled game events that trigger at turn/round boundaries.
 * Events can modify resources, add effects, change game state.
 *
 * Supports:
 * - Random events with weighted probabilities
 * - Scheduled events (on specific rounds)
 * - Event effects (resource changes, effects, state changes)
 * - Event decks (draw from shuffled events)
 *
 * Hooks used:
 * - onTurnStart: Check and trigger events at turn/round start
 */

import { MechanicHooks, TurnStartContext, StateChanges } from './types';
import { Effect } from '../types/game';
import { addResource, spendResource } from './core/resources';

interface EventEffect {
  /** Type of effect */
  type: 'resource' | 'effect' | 'state' | 'score';
  /** Target: 'current', 'all', 'random', or specific player ID */
  target?: 'current' | 'all' | 'random' | string;
  /** Resource name (for type: 'resource') */
  resource?: string;
  /** Amount to add/subtract */
  amount?: number;
  /** Effect to apply (for type: 'effect') */
  effect?: Partial<Effect>;
  /** State to set (for type: 'state') */
  state?: string;
}

interface GameEvent {
  /** Unique event identifier */
  id: string;
  /** Display name */
  name: string;
  /** Description for logging/display */
  description?: string;
  /** Weight for random selection (higher = more likely) */
  weight?: number;
  /** Specific rounds when this event can occur */
  on_rounds?: number[];
  /** Effects to apply when event triggers */
  effects: EventEffect[];
  /** Whether event can only occur once */
  once?: boolean;
}

interface EventsConfig {
  /** Available events */
  events: GameEvent[];
  /** Timing: 'turn_start', 'round_start', or 'both' */
  timing?: 'turn_start' | 'round_start' | 'both';
  /** Probability of an event occurring (0-1, default 1) */
  probability?: number;
  /** Maximum events per turn/round */
  max_per_trigger?: number;
  /** Use event deck (events removed after occurring) */
  use_deck?: boolean;
}

function selectRandomEvent(
  events: GameEvent[],
  triggeredEvents: string[],
  currentRound: number
): GameEvent | null {
  // Filter available events
  const available = events.filter(e => {
    // Skip once-only events that have triggered
    if (e.once && triggeredEvents.includes(e.id)) return false;
    // Check round restrictions
    if (e.on_rounds && !e.on_rounds.includes(currentRound)) return false;
    return true;
  });

  if (available.length === 0) return null;

  // Weighted random selection
  const totalWeight = available.reduce((sum, e) => sum + (e.weight ?? 1), 0);
  let random = Math.random() * totalWeight;

  for (const event of available) {
    random -= event.weight ?? 1;
    if (random <= 0) return event;
  }

  return available[available.length - 1];
}

function applyEventEffects(
  event: GameEvent,
  ctx: TurnStartContext,
  stateChanges: StateChanges
): void {
  for (const effect of event.effects) {
    const targets: string[] = [];

    // Determine targets
    if (effect.target === 'current' || effect.target === undefined) {
      targets.push(ctx.playerId);
    } else if (effect.target === 'all') {
      targets.push(...Object.keys(ctx.state.players));
    } else if (effect.target === 'random') {
      const playerIds = Object.keys(ctx.state.players);
      const randomIndex = Math.floor(Math.random() * playerIds.length);
      targets.push(playerIds[randomIndex]);
    } else {
      targets.push(effect.target);
    }

    // Apply effect to each target
    for (const targetId of targets) {
      const player = ctx.state.players[targetId];
      if (!player) continue;

      stateChanges.playerStateChanges = stateChanges.playerStateChanges || {};
      stateChanges.playerStateChanges[targetId] = stateChanges.playerStateChanges[targetId] || {};

      if (effect.type === 'resource' && effect.resource && effect.amount !== undefined) {
        // Use resource service (fires hooks)
        if (effect.amount >= 0) {
          addResource(ctx.state, targetId, effect.resource, effect.amount);
        } else {
          spendResource(ctx.state, targetId, effect.resource, Math.abs(effect.amount));
        }
      }

      if (effect.type === 'score' && effect.amount !== undefined) {
        const currentScore = player.score || 0;
        stateChanges.playerStateChanges[targetId].score = currentScore + effect.amount;
      }

      if (effect.type === 'effect' && effect.effect) {
        const currentEffects = [...(player.effects || [])];
        currentEffects.push({
          type: effect.effect.type || 'event',
          duration: effect.effect.duration ?? 1,
          source: `event:${event.id}`,
          ...effect.effect
        } as Effect);
        stateChanges.playerStateChanges[targetId].effects = currentEffects;
      }

      if (effect.type === 'state' && effect.state) {
        stateChanges.playerStateChanges[targetId].state = effect.state;
      }
    }
  }
}

export const eventsMechanic: MechanicHooks = {
  slug: 'events',
  name: 'Events',

  configSchema: {
    type: 'object',
    description: 'Random or scheduled game events',
    properties: {
      events: {
        type: 'array',
        description: 'Available events',
        required: true
      },
      timing: {
        type: 'string',
        description: 'When events can trigger',
        enum: ['turn_start', 'round_start', 'both'],
        default: 'round_start'
      },
      probability: {
        type: 'number',
        description: 'Probability of event occurring (0-1)',
        default: 1
      },
      max_per_trigger: {
        type: 'number',
        description: 'Maximum events per trigger',
        default: 1
      },
      use_deck: {
        type: 'boolean',
        description: 'Remove events after occurring',
        default: false
      }
    },
    required: ['events']
  },

  onTurnStart(ctx: TurnStartContext): StateChanges | null {
    const eventsConfig = ctx.config.engine_mechanics?.events as EventsConfig | undefined;
    if (!eventsConfig?.events) return null;

    // Check timing
    const timing = eventsConfig.timing ?? 'round_start';
    if (timing === 'round_start' && !ctx.isNewRound) return null;
    if (timing === 'turn_start' && ctx.isNewRound) {
      // 'turn_start' means every turn except round starts
      // Actually, let's interpret: turn_start = every turn, round_start = only round starts
      // 'both' = every turn including round starts
    }

    // For round_start, only trigger once per round (first player)
    if (timing === 'round_start' || (timing === 'both' && ctx.isNewRound)) {
      // Only process for the first player in turn order to avoid duplicate events
      if (ctx.state.turnOrder[0] !== ctx.playerId) return null;
    }

    // Check probability
    const probability = eventsConfig.probability ?? 1;
    if (Math.random() > probability) return null;

    // Get triggered events history
    const triggeredEvents = ((ctx.state.shared.triggeredEvents as string[]) || []);
    const currentRound = ctx.state.round;

    // Select event(s)
    const maxEvents = eventsConfig.max_per_trigger ?? 1;
    const selectedEvents: GameEvent[] = [];

    for (let i = 0; i < maxEvents; i++) {
      const event = selectRandomEvent(
        eventsConfig.events,
        [...triggeredEvents, ...selectedEvents.map(e => e.id)],
        currentRound
      );
      if (event) {
        selectedEvents.push(event);
      }
    }

    if (selectedEvents.length === 0) return null;

    const stateChanges: StateChanges = {
      sharedStateChanges: {}
    };

    // Apply each event
    for (const event of selectedEvents) {
      applyEventEffects(event, ctx, stateChanges);
    }

    // Track triggered events
    const newTriggeredEvents = [
      ...triggeredEvents,
      ...selectedEvents.filter(e => e.once).map(e => e.id)
    ];

    // Track current event for display
    stateChanges.sharedStateChanges = {
      ...stateChanges.sharedStateChanges,
      triggeredEvents: newTriggeredEvents,
      currentEvent: selectedEvents.length === 1
        ? { id: selectedEvents[0].id, name: selectedEvents[0].name, description: selectedEvents[0].description }
        : selectedEvents.map(e => ({ id: e.id, name: e.name, description: e.description }))
    };

    return stateChanges;
  }
};
