// Validation schema definitions for RULES.md files

/**
 * Section definition for markdown validation.
 */
export interface SectionDefinition {
  name: string;                  // Normalized section name
  patterns: RegExp[];            // Heading patterns to match
  required: boolean;             // Is this section required?
  description: string;           // What this section should contain
}

/**
 * Required and advised markdown sections.
 * Note: Patterns match the heading TEXT only (without # prefix), case-insensitive.
 */
export const SECTION_DEFINITIONS: SectionDefinition[] = [
  // Required sections
  {
    name: 'overview',
    patterns: [
      /^(Overview|Game Concept|Objective|Introduction)$/i,
    ],
    required: true,
    description: 'Brief game summary explaining the core concept',
  },
  {
    name: 'setup',
    patterns: [
      /^(Setup|Game Setup|Initial Setup|Getting Started)$/i,
    ],
    required: true,
    description: 'How to set up the game (deal cards, initial positions, etc.)',
  },
  {
    name: 'gameplay',
    patterns: [
      /^(Gameplay|Turn Structure|Turn Sequence|How to Play|Playing the Game)$/i,
    ],
    required: true,
    description: 'How turns work and what actions are available',
  },
  {
    name: 'winning',
    patterns: [
      /^(Winning|Victory|Win Condition|How to Win|End Game|Game End|Scoring)$/i,
    ],
    required: true,
    description: 'Victory conditions and how the game ends',
  },

  // Advised sections
  {
    name: 'cardTypes',
    patterns: [
      /^(Card Types|Cards|Components|Game Components|Card Descriptions|Card Deck)$/i,
    ],
    required: false,
    description: 'Description of card types and their effects',
  },
  {
    name: 'gamemasterNotes',
    patterns: [
      /^(Gamemaster Notes|GM Notes|Adjudication|Rules Clarifications)$/i,
    ],
    required: false,
    description: 'Guidance for gamemaster adjudication',
  },
  {
    name: 'strategy',
    patterns: [
      /^(Strategy|Strategy Notes|Tips|Strategic Considerations)$/i,
    ],
    required: false,
    description: 'Strategic guidance for players',
  },

  // Internal sections (extracted but not required)
  {
    name: 'designNotes',
    patterns: [
      /^(Design Notes|Playtest Notes|Development Notes|Balance Notes)/i,
    ],
    required: false,
    description: 'Internal design/playtest notes (may be excluded from agent view)',
  },
];

/**
 * Valid effect types for cards.
 */
export const VALID_EFFECT_TYPES = [
  // Core effects
  'none',
  'probability_boost',
  'probability_penalty',
  'auto_success',
  'block_turn',
  'force_discard',
  'force_retarget',
  'swap_positions',
  'reroll_failed',

  // Card game effects
  'skip',
  'reverse',
  'draw',
  'wild',
  'wild_draw',

  // AAOTE-style effects
  'safe',
  'trade_bonus',
  'draw_on_enter',
  'hide',
  'reveal',
  'enemy_only',
  'utility',
  'movement_bonus',
  'collectible',
  'currency',
  'enemy_item',
  'extra_movement',
  'teleport_adjacent',
  'peek_hand',
  'peek_objective',
  'block_tile',
  'steal_item',
  'destroy_location',
  'counter',
  'secret_move',
];

/**
 * Valid adjacency types for grid mechanics.
 */
export const VALID_ADJACENCY_TYPES = ['orthogonal', 'diagonal', 'hexagonal'];

/**
 * Valid grid types.
 */
export const VALID_GRID_TYPES = ['infinite', 'bounded'];

/**
 * Valid auction types.
 */
export const VALID_AUCTION_TYPES = ['english', 'sealed', 'dutch', 'once-around'];

/**
 * Valid turn order types.
 */
export const VALID_TURN_ORDER_TYPES = ['fixed', 'random', 'stat-based', 'bid', 'pass-order'];

/**
 * Valid power assignment types.
 */
export const VALID_POWER_ASSIGNMENTS = ['random', 'draft', 'fixed'];

/**
 * Valid power effect types.
 */
export const VALID_POWER_EFFECT_TYPES = [
  'bonus_action_points',
  'bonus_draw',
  'bonus_income',
  'discount',
  'reroll',
  'immunity',
  'extra_cards',
];

/**
 * Valid set collection scoring types.
 */
export const VALID_SET_SCORING = ['per_set', 'largest_set', 'most_sets'];

/**
 * Valid hand limit policies.
 */
export const VALID_HAND_LIMIT_POLICIES = ['cannot_draw', 'discard_choice', 'discard_oldest'];

/**
 * Valid timeout winner types.
 */
export const VALID_TIMEOUT_WINNER_TYPES = ['role', 'highest_score', 'specific_player', 'no_winner'];

/**
 * Valid card target modes.
 */
export const VALID_TARGET_MODES = ['owner', 'opponents', 'all'];
