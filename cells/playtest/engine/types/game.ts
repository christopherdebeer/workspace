// Core game types

export type GameStatus = 'initializing' | 'waiting_for_players' | 'in_progress' | 'pending_analysis' | 'completed' | 'cancelled';
export type Role = 'gamemaster' | 'player';

export interface Card {
  name: string;
  type: string;
  id?: string;  // Unique card instance ID (for deck-building, multi-use tracking)
  effect?: {
    type: string;
    value?: number;
    duration?: number;
    target?: string;
    color?: string;  // For card games like UNO
  };
  placeable?: boolean;  // Can this card be placed on board states?
  targetMode?: 'owner' | 'opponents' | 'all';  // Who the placed card affects
  // Trick-taking card attributes
  suit?: string;  // Card suit (e.g., "hearts", "spades")
  value?: number | string;  // Card value (e.g., 1-13, "A", "K", "Q", "J")
}

export interface PlayerState {
  agentId?: string;
  persona?: string;  // Persona slug for this player's personality
  state: string;  // position/status in game
  hand?: Card[];  // Optional - cards mechanic sets this via initPlayerState
  effects: Effect[];
  score?: number;
  lastActionRound?: number;  // Track last round player acted (prevents multiple actions per round)

  // New mechanic state
  resources?: Record<string, number>;     // Resource amounts (e.g., { "gold": 10 })
  actionPoints?: number;                  // Remaining action points this turn
  actionPointsUsed?: number;              // Action points used this turn
  collectedSets?: string[];               // Names of completed sets
  currentBid?: number;                    // Current bid in auction

  // Additional mechanic state
  rollAccumulator?: number;               // Accumulated points from push-your-luck rolls
  rollCount?: number;                     // Number of rolls this turn
  powerId?: string;                       // Assigned player power ID
  completedTrades?: number;               // Number of completed trades (for The Trader objective)
  visitedLocations?: string[];            // Locations visited (for The Explorer objective)

  // Proposal 010: Hidden objectives for role-based games
  objective?: {
    name: string;        // Objective name (e.g., "The Enemy", "The Collector")
    type: string;        // Objective type (e.g., "enemy", "regular")
    condition?: string;  // Win condition description
    revealed?: boolean;  // Whether the objective has been revealed
  };

  // Closed drafting state
  draftPool?: Card[];              // Cards available to draft from
  draftSelection?: Card | null;    // Currently selected card (hidden until reveal)
  hasDraftSelected?: boolean;      // Whether player has made selection this pick

  // Movement points state
  movementPoints?: number;         // Remaining movement points this turn
  movementPointsUsed?: number;     // Movement points used this turn

  // Trick-taking state
  tricksWon?: number;              // Number of tricks won

  // Ladder climbing state
  ladderEliminated?: boolean;      // Eliminated from current round (passed)

  // Once per game abilities state
  availableAbilities?: string[];   // Abilities assigned to player
  usedAbilities?: string[];        // Abilities already used
  extraActions?: number;           // Extra actions from abilities

  // Race win condition state
  visitedCheckpoints?: string[];   // Checkpoints visited
  lapsCompleted?: number;          // Laps completed (for circuit races)

  // Chaining state
  canReroll?: boolean;             // Can reroll (from ability)

  // Area movement state
  currentArea?: string;            // Current area location
  previousArea?: string;           // Previous area (for tracking)

  // Deck-building state
  personalDeck?: Card[];           // Player's personal deck
  personalDiscard?: Card[];        // Player's personal discard pile
  deckCardsAcquired?: number;      // Count of cards acquired (for unique IDs)
  coins?: number;                  // Currency for deck-building games

  // Point-to-point movement state
  currentNode?: string;            // Current node location
  previousNode?: string;           // Previous node (for tracking)
  stopsThisTurn?: number;          // Number of stops made this turn

  // Visibility system state (Phase 4)
  hiddenRole?: string;             // Player's secret role (traitor, villager, etc.)
  team?: string;                   // Player's team affiliation
  knowledge?: PlayerKnowledge;     // What this player knows about others

  // Dice system state (Phase 2)
  lastRoll?: DiceRollState;        // Last roll result
  lastRollResults?: number[];      // Last roll individual results
  lastRollTotal?: number;          // Last roll total
  rerollsUsed?: number;            // Re-rolls used this turn

  // Phase 1-5 Expansion player state
  deductionNotes?: DeductionNotes; // Deduction mechanic notes
  memory?: PlayerMemory;           // Memory mechanic state
  isJudge?: boolean;               // Player judge mechanic
  timePosition?: number;           // Time track position

  // Phase 6: Combat System player state
  inEnemyZoC?: boolean;            // Player is in enemy zone of control
  zocProjector?: string;           // Player ID projecting ZoC
  impulseState?: ImpulseState;     // Area impulse activation state

  // Phase 7: Worker Placement state
  workers?: WorkerState[];         // Player's workers with placement status

  // Multi-category expansion state
  tableau?: Card[];                  // Tableau building: cards in personal tableau
  programmedActions?: unknown[];     // Action programming: programmed action sequence

  // Economic mechanic state
  active_contracts?: string[];       // IDs of active contracts the player holds
  active_loans?: LoanInstance[];     // Active loans the player has taken

  // Action mechanics state
  selectedActions?: string[];         // Action drafting: selected actions this round
  playedCards?: string[];             // Action retrieval: cards played (retrievable)

  // Betting and bluffing state
  currentBet?: number;               // Current bet amount in betting round
  pot?: number;                       // Player's stake in the pot
  folded?: boolean;                   // Has player folded this round

  // Tech trees state
  researchedTechs?: string[];        // IDs of researched technologies
  techBonuses?: Record<string, number>;  // Permanent bonuses from tech

  // Route building state
  claimedRoutes?: string[];          // IDs of claimed routes
  routeCards?: string[];             // Held route objective cards

  // Phase 15: Mechanic player state
  character?: Record<string, unknown>;  // Role-playing character info
  melds?: unknown[];                    // Melding and splaying: card melds
  meldCount?: number;                   // Number of melds created
  patternGrid?: unknown[][];            // Pattern building: personal grid
  completedPatterns?: string[];         // Pattern building: completed patterns
}

/**
 * Loan instance for the loans mechanic.
 */
export interface LoanInstance {
  amount: number;           // Original loan amount
  repayment: number;        // Total amount to repay (amount + interest)
  taken_on_turn: number;    // Turn number when loan was taken
  deadline_turn?: number;   // Turn by which loan must be repaid (0 = end of game)
}

/**
 * Worker state for worker placement mechanic.
 */
export interface WorkerState {
  id: string;
  type: string;
  placedAt: string | null;
}

/**
 * Impulse state for area impulse mechanic.
 */
export interface ImpulseState {
  currentImpulse: number;
  impulsesUsed: number;
  activatedUnits: string[];
  phase: 'selecting' | 'resolving' | 'complete';
}

/**
 * Deduction notes for the deduction mechanic.
 */
export interface DeductionNotes {
  known: Record<string, string[]>;
  eliminated: Record<string, string[]>;
  suspicions: Record<string, string[]>;
  wrongGuesses: number;
}

/**
 * Player memory for the memory mechanic.
 */
export interface PlayerMemory {
  entries: MemoryEntry[];
  notes: Record<string, string>;
}

export interface MemoryEntry {
  infoType: string;
  value: unknown;
  revealedTurn: number;
  expiresOnTurn: number;
  source: string;
}

/**
 * State of the last dice roll
 */
export interface DiceRollState {
  results: number[];
  total: number;
  modifier?: number;
  finalTotal?: number;
  keptDice?: number[];
  rerolledDice?: number[];
}

/**
 * Knowledge that a player has about other players.
 * Used by the visibility system to track revealed information.
 */
export interface PlayerKnowledge {
  /** Players whose roles this player knows */
  knownRoles: Record<string, string>;
  /** Players whose positions this player knows */
  knownPositions: Record<string, string>;
  /** Custom revealed information (key is "playerId:infoType") */
  revealed: Record<string, unknown>;
}

export interface Effect {
  type: string;
  value?: number;
  duration: number;  // player turns remaining (decrements when effect holder's turn ends)
  source?: string;   // who applied it
}

// Cards config (unified format: stored in engine_mechanics.cards)
export interface CardsEngineMechanicConfig {
  deck?: DeckConfig[];         // Card definitions
  starting_hand?: number;      // Cards dealt to each player at start
}

// Engine mechanics that can be enabled per-game
export interface EngineMechanics {
  // Core mechanics (unified format puts cards and board here)
  cards?: CardsEngineMechanicConfig;   // Card deck and dealing config
  board?: BoardConfig;                  // Board states and edges

  probability_movement?: boolean;  // Moves use edge probabilities (default: true if board.edges have probability)
  card_boosts?: boolean;           // Cards can modify move probability (default: true if deck exists)
  victory_declaration?: boolean;   // Players must declare victory for GM adjudication (default: false)
  pass?: boolean;                  // Enable explicit pass action (default: false — turns auto-advance)

  // New mechanics from mechanics library
  action_points?: ActionPointsConfig;   // Action points budget per turn
  resources?: ResourceConfig[];         // Resource types to track
  income?: IncomeConfig;                // Per-turn resource generation
  set_collection?: SetCollectionConfig; // Set detection and scoring
  auction?: AuctionConfig;              // Auction/bidding system
  turn_order?: TurnOrderConfig;         // Turn order determination

  // Additional mechanics
  push_your_luck?: PushYourLuckConfig;  // Risk/reward dice rolling
  variable_powers?: VariablePlayerPowersConfig;  // Asymmetric player abilities
  open_drafting?: OpenDraftingConfig;   // Draft from visible card pool
  simultaneous?: SimultaneousActionConfig;  // All players act at once

  // Proposal 007: Grid-based movement
  grid?: GridConfig;                   // Grid configuration for tile-placement games

  // Trading mechanic
  trade?: TradeConfig;                 // Trading configuration

  // Proposal 008: Hand limits and card type restrictions
  hand_limit?: number;                 // Maximum cards in hand
  hand_limit_policy?: 'cannot_draw' | 'discard_choice' | 'discard_oldest';  // What happens when limit exceeded
  card_type_rules?: Record<string, CardTypeRules>;  // Per-type playability rules

  // Proposal 010: Configurable default winner on timeout
  timeout_winner?: TimeoutWinnerConfig;  // Who wins when max_turns is reached

  // Win condition mechanics (composable)
  win_reach_state?: WinReachStateConfig;      // Win by reaching a board state
  win_score_threshold?: WinScoreThresholdConfig;  // Win by reaching a score threshold
  win_empty_hand?: boolean;                   // Win by emptying hand
  win_elimination?: boolean;                  // Win by being last player standing
  win_timeout?: WinTimeoutConfig;             // Winner determination on timeout
  win_end_game_bonuses?: WinEndGameBonusesConfig;  // End-game bonus scoring
  win_king_of_the_hill?: WinKingOfTheHillConfig;   // Win by controlling a location
  win_victory_points_as_resource?: WinVPAsResourceConfig;  // VP as spendable resource
  win_highest_lowest_scoring?: WinHighestLowestScoringConfig;  // Highest or lowest score wins

  // New mechanics (Phase 1 expansion)
  closed_drafting?: ClosedDraftingConfig;     // Simultaneous card drafting with passing
  trick_taking?: TrickTakingConfig;           // Trick-taking card game mechanic
  movement_points?: MovementPointsConfig;     // Movement budget per turn
  automatic_resource_growth?: AutomaticResourceGrowthConfig;  // Resources that grow over time
  events?: EventsConfig;                      // Random/scheduled game events
  ladder_climbing?: LadderClimbingConfig;     // Beat previous play or pass
  once_per_game_abilities?: OncePerGameAbilitiesConfig;  // Special one-time abilities
  chaining?: ChainingConfig;                  // Actions that trigger follow-up effects
  win_race?: RaceWinConfig;                   // First to reach goal wins
  catch_the_leader?: CatchTheLeaderConfig;    // Balancing mechanic for competitive games
  sudden_death_ending?: SuddenDeathEndingConfig;  // Instant win conditions
  area_movement?: AreaMovementConfig;         // Movement between named areas

  // Phase 1 expansion (continued)
  deck_building?: DeckBuildingConfig;         // Personal deck acquisition (Dominion, Star Realms)
  multi_use_cards?: MultiUseCardsConfig;      // Cards with multiple use options
  point_to_point_movement?: PointToPointMovementConfig;  // Graph-based node movement

  // Phase 4: Visibility System
  hidden_roles?: HiddenRolesConfig;           // Secret role assignment
  traitor_game?: TraitorGameConfig;           // Traitor vs loyalist gameplay

  // Phase 2: Dice System
  dice_rolling?: DiceRollingConfig;           // Core dice rolling with modifiers

  // Phase 3: Dynamic Turn Order
  turn_order_random?: TurnOrderRandomConfig;  // Randomize turn order at trigger points
  turn_order_stat_based?: TurnOrderStatBasedConfig;  // Order by player stat
  turn_order_progressive?: TurnOrderProgressiveConfig;  // Snake draft order

  // Phase 4: Visibility (extended)
  hidden_victory_points?: HiddenVictoryPointsConfig;  // Hidden scores until end

  // Phase 2: Dice (extended)
  rerolling?: RerollingConfig;                // Yahtzee-style re-roll and lock

  // Phase 5: Voting & Social
  voting?: VotingMechanicConfig;              // Democratic decision-making
  negotiation?: NegotiationMechanicConfig;    // Binding/non-binding agreements
  communication_limits?: CommunicationLimitsConfig;  // Restricted communication

  // Phase 2: Additional Dice mechanics
  roll_spin_move?: RollSpinMoveConfig;        // Classic board game movement
  different_dice_movement?: DifferentDiceMovementConfig;  // Dice determine options

  // Phase 3: Additional Turn Order mechanics
  turn_order_pass_order?: TurnOrderPassOrderConfig;  // Pass order determines next round

  // Phase 4: Additional Visibility mechanics
  hidden_movement?: HiddenMovementConfig;     // Hidden player positions
  hidden_objectives?: HiddenObjectivesConfig; // Secret objective distribution (Proposal 012)

  // Phase 1-5 Expansion: Additional mechanics
  auction_sealed_bid?: AuctionSealedBidConfig;    // Sealed bid auctions
  auction_once_around?: AuctionOnceAroundConfig;  // Once around auctions
  die_icon_resolution?: DieIconResolutionConfig;  // Symbol-based dice
  turn_order_auction?: TurnOrderAuctionConfig;    // Bid for turn position
  turn_order_claim?: TurnOrderClaimConfig;        // Claim turn position
  turn_order_time_track?: TurnOrderTimeTrackConfig;  // Time track based order
  turn_order_role?: TurnOrderRoleConfig;          // Role-based turn order
  deduction?: DeductionConfig;                    // Deduction mechanics
  memory?: MemoryMechanicConfig;                  // Memory mechanics
  targeted_clues?: TargetedCluesConfig;           // Targeted clue giving
  roles_asymmetric_info?: RolesAsymmetricInfoConfig;  // Asymmetric role info
  player_judge?: PlayerJudgeConfig;               // Player judging
  i_cut_you_choose?: ICutYouChooseConfig;         // Fair division
  bribery?: BriberyConfig;                        // Bribery mechanics

  // Phase 6: Combat System
  critical_hits?: CriticalHitsConfig;             // Critical hit/failure outcomes
  zone_of_control?: ZoneOfControlConfig;          // Unit ZoC projection
  ratio_crt?: RatioCRTConfig;                     // Ratio-based combat resolution
  force_commitment?: ForceCommitmentConfig;       // Commit forces before resolution
  area_impulse?: AreaImpulseConfig;               // Impulse-based activation
  chit_pull?: ChitPullConfig;                     // Random chit activation
  secret_deployment?: SecretDeploymentConfig;     // Face-down unit deployment
  kill_steal?: KillStealConfig;                   // Final blow rewards

  // Phase 7: Worker Placement System
  worker_placement?: WorkerPlacementConfig;       // Worker placement mechanics
  different_worker_types?: DifferentWorkerTypesConfig;  // Multiple worker types

  // New mechanics (multi-category expansion)
  auction_dutch?: AuctionDutchConfig;             // Descending price auction
  simultaneous_action_selection?: SimultaneousActionSelectionConfig;  // Simultaneous play
  market?: MarketMechanicConfig;                  // Supply/demand commodity trading
  tableau_building?: TableauBuildingConfig;        // Personal tableau of cards
  action_programming?: ActionProgrammingConfig;   // Program action sequences
  cooperative?: CooperativeConfig;                // Cooperative play mechanics
  cooperative_actions?: CooperativeConfig;            // Cooperative play mechanics (preferred key)

  // Economic mechanics
  contracts?: ContractsConfig;                    // Contract fulfillment system
  loans?: LoansConfig;                            // Loan/debt system

  // Ending/elimination mechanics
  win_finale_ending?: FinaleEndingConfig;         // End-game scoring phase
  win_single_loser?: SingleLoserConfig;           // Last player standing loses
  player_elimination?: PlayerEliminationProcessConfig;  // Elimination process during play

  // Action mechanics
  action_drafting?: ActionDraftingConfig;           // Select actions from shared pool
  action_event?: ActionEventConfig;                 // Cards as actions or events
  action_retrieval?: ActionRetrievalConfig;         // Retrieve played cards

  // Social/Cooperative mechanics
  betting_and_bluffing?: BettingAndBluffingConfig;  // Betting with bluff calling
  cooperative_game?: CooperativeGameConfig;          // All-vs-game framework
  alliances?: AlliancesConfig;                       // Player alliances

  // Building mechanics
  network_and_route_building?: NetworkAndRouteBuildingConfig;  // Route claiming
  tech_trees_tech_tracks?: TechTreesConfig;          // Tech research trees

  // Other mechanics
  area_majority_influence?: AreaMajorityInfluenceConfig;  // Area control scoring
  team_based_game?: TeamBasedGameConfig;              // Team play
  tile_placement?: TilePlacementConfig;               // Tile placement
  variable_set_up?: VariableSetUpConfig;              // Variable game setup
  advantage_token?: AdvantageTokenConfig;             // First player / advantage token
  random_production?: RandomProductionConfig;         // Random resource generation
  follow?: FollowConfig;                              // Follow the leader mechanic
  storytelling?: StorytellingConfig;                  // Storytelling mechanic

  // Phase 15: Category completers
  semi_cooperative_game?: Record<string, unknown>;    // Shared + individual goals
  action_queue?: Record<string, unknown>;              // Queue actions for sequential execution
  action_timer?: Record<string, unknown>;              // Time-limited actions
  worker_placement_with_dice_workers?: Record<string, unknown>;  // Dice as workers
  role_playing?: Record<string, unknown>;              // Character personas
  acting?: Record<string, unknown>;                    // Charades-style acting
  prisoners_dilemma?: Record<string, unknown>;         // Cooperate/defect choices
  induction?: Record<string, unknown>;                 // Discover secret rules
  pattern_recognition?: Record<string, unknown>;       // Identify matching patterns
  questions_and_answers?: Record<string, unknown>;     // Q&A deduction
  elapsed_real_time_ending?: Record<string, unknown>;  // Turn-limited ending

  // Phase 15: Economic
  stock_holding?: Record<string, unknown>;             // Stock market trading
  investment?: Record<string, unknown>;                // Future return investments
  commodity_speculation?: Record<string, unknown>;     // Commodity price trading
  ownership?: Record<string, unknown>;                 // Element ownership

  // Phase 15: Building
  pattern_building?: Record<string, unknown>;          // Grid pattern creation
  connections?: Record<string, unknown>;               // Build links between nodes
  enclosure?: Record<string, unknown>;                 // Surround areas to claim
  map_addition?: Record<string, unknown>;              // Expand play area with tiles

  // Phase 15: Auction
  auction_compensation?: Record<string, unknown>;      // Losers receive compensation
  auction_fixed_placement?: Record<string, unknown>;   // Bid on fixed slots
  auction_multiple_lot?: Record<string, unknown>;      // Simultaneous multi-lot
  auction_bidding?: Record<string, unknown>;           // Generic bidding
  auction_dutch_priority?: Record<string, unknown>;    // Dutch with priority
  auction_turn_order_until_pass?: Record<string, unknown>;  // Pass = exit

  // Phase 15: Movement
  hexagon_grid?: Record<string, unknown>;              // Hex grid movement
  rondel?: Record<string, unknown>;                    // Circular action wheel
  track_movement?: Record<string, unknown>;            // Linear track movement
  square_grid?: Record<string, unknown>;               // Square grid movement
  grid_coverage?: Record<string, unknown>;             // Cover grid spaces

  // Phase 15: Cards
  melding_and_splaying?: Record<string, unknown>;      // Card melds with splay
  command_cards?: Record<string, unknown>;             // Command-issuing cards
  deck_construction?: Record<string, unknown>;         // Pre-game deck building

  // Phase 15: Other
  pick_up_and_deliver?: Record<string, unknown>;       // Transport goods
  modular_board?: Record<string, unknown>;             // Variable board layout
  variable_phase_order?: Record<string, unknown>;      // Dynamic phase ordering
  tug_of_war?: Record<string, unknown>;                // Bidirectional tug
  matching?: Record<string, unknown>;                  // Pair matching
  interrupts?: Record<string, unknown>;                // Out-of-turn reactions
  score_and_reset_game?: Record<string, unknown>;      // Multi-round scoring
}

// Proposal 007: Grid configuration
export interface GridConfig {
  type: 'infinite' | 'bounded';
  starting_tile: string;
  adjacency: 'orthogonal' | 'diagonal' | 'hexagonal';
  bounds?: { width: number; height: number };
}

// Trading configuration
export interface TradeConfig {
  enabled: boolean;                    // Whether trading is enabled
  require_same_location?: boolean;     // Players must be at same location to trade
  require_adjacent_location?: boolean; // Players must be at adjacent locations
  item_types_only?: boolean;           // Only cards with type 'item' can be traded
  allow_gifts?: boolean;               // Allow one-sided trades (giving without receiving)
  max_cards_per_trade?: number;        // Maximum cards that can be exchanged in one trade
}

// Pending trade offer (stored in state.shared.pendingTrades)
export interface PendingTrade {
  id: string;                          // Unique offer ID
  from: string;                        // Player ID offering
  to: string;                          // Player ID receiving offer
  offer: string[];                     // Card names being offered
  request: string[];                   // Card names being requested (empty for gifts)
  timestamp: string;                   // When offer was created
  expiresAtTurn?: number;              // Optional expiration turn
}

// Proposal 008: Card type rules
export interface CardTypeRules {
  playable?: boolean;     // Can this card type be played with play_card action?
  tradeable?: boolean;    // Can this card type be traded?
  holdable?: boolean;     // Can this card type be held in hand?
  placeable?: boolean;    // Can this card type be placed on the grid/board?
}

// Proposal 010: Timeout winner configuration
export interface TimeoutWinnerConfig {
  type: 'role' | 'highest_score' | 'specific_player' | 'no_winner';  // How to determine winner
  role?: string;           // For type "role": the role/objective type that wins
  role_name?: string;      // For type "role": match by objective name
  player_condition?: string;  // For type "specific_player": condition to evaluate
  reveal_role?: boolean;   // Whether to reveal the winner's hidden role
  reason?: string;         // Custom reason message (for "no_winner")
}

// Win condition mechanic configs (composable)
export interface WinReachStateConfig {
  target_state: string;    // The board state to reach to win
}

export interface WinScoreThresholdConfig {
  threshold: number;       // Score threshold to reach
  operator?: '>=' | '>' | '==' | '=';  // Comparison operator (default: ">=")
}

export interface WinTimeoutConfig {
  type?: 'highest_score' | 'role' | 'specific_player' | 'no_winner';  // How to determine winner
  role?: string;           // For type "role": the role/objective type that wins
  role_name?: string;      // For type "role": match by objective name
  player_condition?: string;  // For type "specific_player": condition to evaluate
  reveal_role?: boolean;   // Whether to reveal the winner's hidden role
  reason?: string;         // Custom reason message (for "no_winner")
}

export interface WinEndGameBonusesConfig {
  bonuses: Array<{
    type: 'set_count' | 'majority' | 'per_resource' | 'per_card' | 'flat';
    name: string;
    points: number;
    resource?: string;
    card_type?: string;
    set_type?: string;
  }>;
}

export interface WinKingOfTheHillConfig {
  target_state?: string;
  target_position?: string;
  turns_required?: number;
}

export interface WinVPAsResourceConfig {
  vp_resource: string;
  threshold: number;
  spendable?: boolean;
}

export interface WinHighestLowestScoringConfig {
  mode: 'highest' | 'lowest';
}

export interface TimeoutResult {
  winner: string | null;
  reason: string;
  revealRole: boolean;
}

// Action Points mechanic (slug: action-points)
export interface ActionPointsConfig {
  points_per_turn: number;           // How many action points per turn
  action_costs: Record<string, number>; // Cost per action type (e.g., { "move": 1, "play_card": 1, "draw": 1 })
  rollover?: boolean;                // Do unused points carry over? (default: false)
}

// Resource mechanic (slug: income, commodity-speculation)
export interface ResourceConfig {
  name: string;                      // e.g., "gold", "mana", "wood"
  starting_amount: number;           // How much each player starts with
  max?: number;                      // Optional cap
}

// Income mechanic (slug: income)
export interface IncomeConfig {
  per_turn: Record<string, number>;  // Resources generated per turn (e.g., { "gold": 2 })
  per_round?: Record<string, number>; // Resources generated per full round
}

// Set Collection mechanic (slug: set-collection)
export interface SetCollectionConfig {
  sets: SetDefinition[];             // Define what constitutes a set
  scoring: 'per_set' | 'largest_set' | 'most_sets';
  points_per_set?: number;           // Points awarded per complete set
}

export interface SetDefinition {
  name: string;                      // e.g., "Color Set", "Number Run"
  match_field: string;               // Card field to match (e.g., "effect.color", "type")
  size: number;                      // How many cards needed for a set
  unique?: boolean;                  // Must cards be unique?
}

// Auction mechanic (slug: auction-english, auction-sealed-bid, etc.)
export interface AuctionConfig {
  type: 'english' | 'sealed' | 'dutch' | 'once-around';
  currency: string;                  // Resource used for bidding (e.g., "gold")
  min_increment?: number;            // Minimum bid increase (for english)
  time_limit?: number;               // Seconds per auction (optional)
}

// Turn Order mechanic (slug: turn-order-*)
export interface TurnOrderConfig {
  type: 'fixed' | 'random' | 'stat-based' | 'bid' | 'pass-order';
  stat?: string;                     // For stat-based: which stat determines order
  shuffle_frequency?: 'never' | 'per_round' | 'per_turn';
}

// Push Your Luck mechanic (slug: push-your-luck)
export interface PushYourLuckConfig {
  dice_sides: number;                // Sides on the die (e.g., 6)
  bust_threshold: number;            // Roll this or below = bust (e.g., 1)
  points_per_success: number;        // Points gained per successful roll
  max_rolls?: number;                // Optional cap on rolls per turn
}

// Variable Player Powers mechanic (slug: variable-player-powers)
export interface VariablePlayerPowersConfig {
  powers: PlayerPower[];             // Available powers
  assignment: 'random' | 'draft' | 'fixed';  // How powers are assigned
}

export interface PlayerPower {
  id: string;                        // Unique identifier
  name: string;                      // Display name
  description: string;               // What it does
  effect: PowerEffect;               // Mechanical effect
}

export interface PowerEffect {
  type: 'bonus_action_points' | 'bonus_draw' | 'bonus_income' | 'discount' | 'reroll' | 'immunity' | 'extra_cards';
  value?: number;                    // Effect magnitude
  condition?: string;                // When it applies
}

// Open Drafting mechanic (slug: open-drafting)
export interface OpenDraftingConfig {
  display_size: number;              // Cards visible in the draft pool
  picks_per_turn: number;            // How many cards player can pick per turn
  refill: 'immediate' | 'end_of_round' | 'never';  // When to refill display
}

// Simultaneous Action mechanic (slug: simultaneous-action-selection)
export interface SimultaneousActionConfig {
  enabled: boolean;                  // Use simultaneous resolution
  resolution_order: 'random' | 'clockwise' | 'priority';  // How to resolve conflicts
}

// Closed Drafting mechanic (slug: closed-drafting)
export interface ClosedDraftingConfig {
  pool_size: number;                 // Cards per player's draft pool
  pass_direction: 'left' | 'right'; // Direction to pass remaining cards
  alternate_direction?: boolean;     // Alternate direction each round
  final_pool_keep?: number;          // Cards kept from final pool
}

// Trick-Taking mechanic (slug: trick-taking)
export interface TrickTakingConfig {
  trump_suit?: string;               // Trump suit (optional)
  can_lead_trump?: boolean;          // Can lead trump when having other suits
  suit_order?: string[];             // Suit hierarchy for tiebreaks
  value_order?: string[];            // Value hierarchy (first is highest)
  points_per_trick?: number;         // Points per trick won
  card_values?: Record<string, number>;  // Explicit card values
}

// Movement Points mechanic (slug: movement-points)
export interface MovementPointsConfig {
  points_per_turn: number;           // Movement points per turn
  rollover?: boolean;                // Carry over unused points
  max_points?: number;               // Max accumulated points
  terrain_costs?: Record<string, number>;  // Cost per terrain type
  default_cost?: number;             // Default movement cost
  movement_actions?: string[];       // Actions that consume MP
}

// Automatic Resource Growth mechanic (slug: automatic-resource-growth)
export interface AutomaticResourceGrowthConfig {
  rules: ResourceGrowthRule[];       // Growth rules
}

export interface ResourceGrowthRule {
  resource: string;                  // Resource to grow
  rate?: number;                     // Growth rate (0.1 = 10%)
  fixed_per?: number;                // Fixed amount per threshold
  threshold?: number;                // Threshold for fixed_per
  min?: number;                      // Minimum after growth
  max?: number;                      // Maximum after growth
  rounding?: 'floor' | 'round' | 'ceil';
  timing?: 'turn' | 'round';
}

// Events mechanic (slug: events)
export interface EventsConfig {
  events: GameEventDef[];            // Available events
  timing?: 'turn_start' | 'round_start' | 'both';
  probability?: number;              // Chance of event occurring
  max_per_trigger?: number;          // Max events per trigger
  use_deck?: boolean;                // Remove events after occurring
}

export interface GameEventDef {
  id: string;                        // Unique identifier
  name: string;                      // Display name
  description?: string;              // Description
  weight?: number;                   // Selection weight
  on_rounds?: number[];              // Specific rounds only
  effects: GameEventEffect[];        // Effects when triggered
  once?: boolean;                    // Can only occur once
}

export interface GameEventEffect {
  type: 'resource' | 'effect' | 'state' | 'score';
  target?: 'current' | 'all' | 'random' | string;
  resource?: string;
  amount?: number;
  effect?: Partial<Effect>;
  state?: string;
}

// Ladder Climbing mechanic (slug: ladder-climbing)
export interface LadderClimbingConfig {
  comparison: 'value' | 'rank';
  rank_order?: string[];
  higher_wins?: boolean;
  allow_combinations?: boolean;
  combination_types?: ('single' | 'pair' | 'triple' | 'quad' | 'run')[];
  min_run_length?: number;
  pass_eliminates?: boolean;
  wild_cards?: string[];
  bomb_cards?: string[];
}

// Once Per Game Abilities mechanic (slug: once-per-game-abilities)
export interface OncePerGameAbilitiesConfig {
  abilities: AbilityDef[];
  assignment?: 'all' | 'choose' | 'random';
  abilities_per_player?: number;
}

export interface AbilityDef {
  id: string;
  name: string;
  description: string;
  effect: {
    type: 'draw' | 'resource' | 'extra_action' | 'skip_turn' | 'reroll' | 'teleport' | 'score' | 'custom';
    count?: number;
    amount?: number;
    resource?: string;
    target?: string;
    custom_id?: string;
  };
  condition?: {
    type: 'min_score' | 'max_hand' | 'state' | 'round' | 'losing';
    value?: number | string;
  };
}

// Chaining mechanic (slug: chaining)
export interface ChainingConfig {
  rules: ChainRuleDef[];
  max_chain_depth?: number;
}

export interface ChainRuleDef {
  id: string;
  name: string;
  trigger: {
    type: 'action' | 'card_type' | 'card_name' | 'state_enter' | 'state_leave' | 'resource_threshold';
    action_type?: string;
    match?: string;
    state?: string;
    resource?: string;
    threshold?: number;
    comparison?: '>=' | '>' | '<=' | '<' | '==';
  };
  effect: {
    type: 'draw' | 'resource' | 'extra_action' | 'score' | 'effect' | 'move';
    count?: number;
    amount?: number;
    resource?: string;
    effect?: { type: string; duration?: number; value?: number };
    target?: string;
  };
  max_per_turn?: number;
  max_per_game?: number;
  condition?: {
    type: 'has_card' | 'has_resource' | 'in_state' | 'hand_size';
    match?: string;
    value?: number | string;
    comparison?: '>=' | '>' | '<=' | '<' | '==';
  };
}

// Race Win Condition mechanic (slug: win-race)
export interface RaceWinConfig {
  goal_state: string;
  goal_states?: string[];
  laps?: number;
  checkpoints?: string[];
}

// Catch The Leader mechanic (slug: catch-the-leader)
export interface CatchTheLeaderConfig {
  leader_metric: 'score' | 'resources' | 'hand_size' | 'position';
  resource?: string;
  lead_threshold?: number;
  leader_penalties?: {
    income_reduction?: number;
    cost_increase?: number;
    resource_loss?: Record<string, number>;
  };
  trailing_bonuses?: {
    gap_threshold?: number;
    extra_resources?: Record<string, number>;
    extra_draw?: number;
    score_bonus?: number;
  };
  targetable_leader?: boolean;
}

// Sudden Death Ending mechanic (slug: sudden-death-ending)
export interface SuddenDeathEndingConfig {
  conditions: SuddenDeathCondition[];
  check_on_action?: boolean;
  announce_warning?: boolean;
}

export interface SuddenDeathCondition {
  type: 'resource_depleted' | 'deck_exhausted' | 'state_reached' | 'turn_limit' | 'elimination' | 'score_reached';
  resource?: string;
  threshold?: number;
  target_state?: string;
  max_turns?: number;
  score?: number;
  loser?: 'triggering_player' | 'all_others' | 'no_one';
  message?: string;
}

// Area Movement mechanic (slug: area-movement)
export interface AreaMovementConfig {
  areas: AreaDefinition[];
  starting_area: string;
  use_movement_points?: boolean;
  default_cost?: number;
  allow_passing?: boolean;
  allow_stacking?: boolean;
  default_capacity?: number;
}

export interface AreaDefinition {
  id: string;
  name?: string;
  adjacent: string[];
  entry_cost?: number;
  capacity?: number;
  restricted?: boolean;
  owner?: string;
  properties?: Record<string, unknown>;
}

// Deck Building mechanic (slug: deck-building)
export interface DeckBuildingConfig {
  starting_deck?: (string | Card)[];           // Starting deck cards
  supply?: DeckBuildingSupplyPile[];           // Supply piles for acquisition
  currency?: string;                           // Currency resource name
  use_discard?: boolean;                       // Use separate discard pile
  draw_count?: number;                         // Cards drawn per turn
  acquire_to?: 'hand' | 'discard' | 'deck_top'; // Where acquired cards go
  allow_trash?: boolean;                       // Enable trashing cards
  trash_pile?: string;                         // Trash pile name
}

export interface DeckBuildingSupplyPile {
  card: Card;                                  // Card template
  count: number;                               // Number available
  cost?: number | Record<string, number>;      // Cost to acquire
  type?: string;                               // Pile type
}

// Multi-Use Cards mechanic (slug: multi-use-cards)
export interface MultiUseCardsConfig {
  cards: MultiUseCardDef[];                    // Card definitions with uses
  default_uses?: MultiUseCardUse[];            // Default uses for all cards
  discard_on_use?: boolean;                    // Cards go to discard after use
  cards_as_currency?: boolean;                 // Allow using cards as currency
  card_currency_value?: number;                // Currency value per card
}

export interface MultiUseCardDef {
  name: string;                                // Card name
  uses: MultiUseCardUse[];                     // Available uses
}

export interface MultiUseCardUse {
  type: string;                                // Use type identifier
  label: string;                               // Display label
  description?: string;                        // Description
  effect?: {
    gain_resources?: Record<string, number>;
    spend_resources?: Record<string, number>;
    gain_points?: number;
    draw_cards?: number;
    add_effect?: { type: string; duration?: number; [key: string]: unknown };
  };
  condition?: {
    min_resources?: Record<string, number>;
    phase?: string;
    player_state?: Record<string, unknown>;
  };
}

// Point-to-Point Movement mechanic (slug: point-to-point-movement)
export interface PointToPointMovementConfig {
  nodes: PointToPointNode[];                   // Node definitions
  routes: PointToPointRoute[];                 // Route definitions
  starting_node: string | string[];            // Starting node(s)
  use_movement_points?: boolean;               // Use movement points system
  default_cost?: number;                       // Default route cost
  exclusive_routes?: boolean;                  // Only owner can use claimed routes
  multi_stop?: boolean;                        // Allow multiple stops per turn
  max_stops?: number;                          // Maximum stops per turn
}

export interface PointToPointNode {
  id: string;                                  // Unique node identifier
  name?: string;                               // Display name
  type?: string;                               // Node type
  properties?: Record<string, unknown>;        // Special properties
}

export interface PointToPointRoute {
  id?: string;                                 // Route identifier
  from: string;                                // Starting node
  to: string;                                  // Ending node
  bidirectional?: boolean;                     // Whether route is bidirectional
  cost?: number;                               // Travel cost
  resource_cost?: Record<string, number>;      // Resource cost
  owner?: string;                              // Owner player ID
  type?: string;                               // Route type/color
  length?: number;                             // Route length
  blocked?: boolean;                           // Whether route is blocked
}

// Hidden Roles mechanic (Phase 4: Visibility System)
export interface HiddenRolesConfig {
  roles: HiddenRoleDefinition[];               // Available roles
  assignment?: 'random' | 'predetermined' | 'draft';  // How roles are assigned
  defaultRole?: string;                        // Default role if not enough specific roles
  teamVisibility?: boolean;                    // Whether teammates can see each other
  evilKnowsEvil?: boolean;                     // Whether evil players know each other
  investigatorRole?: string;                   // Role that can investigate others
  hiddenInfo?: ('role' | 'team' | 'alignment')[];  // What info is hidden
}

export interface HiddenRoleDefinition {
  id: string;                                  // Unique role identifier
  name: string;                                // Display name
  description?: string;                        // Role description
  team?: string;                               // Team this role belongs to
  count?: number;                              // Number of this role
  isEvil?: boolean;                            // Whether this role is evil/traitor
  abilities?: string[];                        // Special abilities
  winCondition?: string;                       // Win condition description
}

// Traitor Game mechanic (Phase 4: Visibility System)
export interface TraitorGameConfig {
  traitorCount?: number;                       // Number of traitors (default: 1)
  traitorsByPlayerCount?: Record<number, number>;  // Traitor count by player count
  traitorRole?: string;                        // Role ID for traitor
  loyalistRole?: string;                       // Role ID for loyalists
  traitorsKnowEachOther?: boolean;             // Whether traitors know each other
  traitorWinCondition?: TraitorWinCondition;   // How traitors win
  loyalistWinCondition?: LoyalistWinCondition; // How loyalists win
  enableAccusation?: boolean;                  // Allow voting to expose traitors
  exposureThreshold?: number;                  // Voting threshold to expose
}

export interface TraitorWinCondition {
  type: 'majority_eliminated' | 'all_eliminated' | 'objective_failed' |
        'reach_state' | 'timeout' | 'custom';
  targetState?: string;
  eliminationThreshold?: number;
  customCondition?: string;
}

export interface LoyalistWinCondition {
  type: 'objective_complete' | 'traitors_exposed' | 'reach_state' |
        'survive_rounds' | 'custom';
  targetState?: string;
  roundsToSurvive?: number;
  customCondition?: string;
}

// Dice Rolling mechanic (Phase 2: Dice System)
export interface DiceRollingConfig {
  dice_count?: number;                         // Default number of dice
  dice_sides?: number;                         // Default sides per die (default: 6)
  roll_action?: boolean;                       // Expose a 'roll' action
  roll_purposes?: string[];                    // Purposes for rolls
  modifiers?: DiceModifiersConfig;             // Static modifiers
  max_rerolls?: number;                        // Maximum re-rolls per turn
  track_last_roll?: boolean;                   // Track last roll in player state
}

export interface DiceModifiersConfig {
  flat_bonus?: number;                         // Flat bonus to all rolls
  per_die_bonus?: number;                      // Bonus per die
  effect_modifiers?: Record<string, number>;   // Effect-based modifiers
}

// Turn Order Random mechanic (Phase 3: Dynamic Turn Order)
export interface TurnOrderRandomConfig {
  trigger?: 'game_start' | 'round_start' | 'both';  // When to randomize
  keep_current?: boolean;                           // Keep current player in position
}

// Voting mechanic (Phase 5: Voting & Social)
export interface VotingMechanicConfig {
  type?: 'majority' | 'plurality' | 'unanimous';    // Voting type
  allowAbstain?: boolean;                           // Allow abstaining
  secret?: boolean;                                 // Secret ballot
  tiebreaker?: 'random' | 'current_player' | 'none' | 'revote';  // Tie resolution
  topics?: VotingTopicConfig[];                     // Predefined voting topics
}

export interface VotingTopicConfig {
  id: string;                                       // Topic identifier
  name: string;                                     // Display name
  description?: string;                             // Topic description
  validChoices?: (string | number)[];               // Valid choices (or 'players' for player elimination)
  choiceType?: 'players' | 'custom';                // Type of choices
  effect?: VotingEffectConfig;                      // Effect of winning choice
}

export interface VotingEffectConfig {
  type: 'eliminate' | 'resource' | 'state' | 'custom';  // Effect type
  target?: 'winner' | 'loser' | 'all';              // Who is affected
  resource?: string;                                // Resource to modify
  amount?: number;                                  // Amount to modify
  state?: string;                                   // State to set
}

// Re-Rolling and Locking mechanic (Phase 2)
export interface RerollingConfig {
  dice_count?: number;                              // Number of dice to roll
  dice_sides?: number;                              // Sides per die (default: 6)
  max_rerolls?: number;                             // Max re-rolls per turn (default: 2)
  auto_lock_on_max?: boolean;                       // Auto-lock when max reached
}

// Turn Order: Stat-Based mechanic (Phase 3)
export interface TurnOrderStatBasedConfig {
  stat?: string;                                    // Stat to sort by (score, resources.gold, etc.)
  descending?: boolean;                             // Higher values first (default: true)
  trigger?: 'game_start' | 'round_start' | 'both'; // When to reorder
}

// Turn Order: Progressive mechanic (Phase 3)
export interface TurnOrderProgressiveConfig {
  reverse_each_round?: boolean;                     // Reverse order each round (default: true)
  reverse_on_tie?: boolean;                         // Reverse when scores are tied
}

// Hidden Victory Points mechanic (Phase 4)
export interface HiddenVictoryPointsConfig {
  reveal_at_end?: boolean;                          // Reveal all scores at game end (default: true)
  reveal_threshold?: number;                        // Reveal when any player reaches this score
  show_relative?: boolean;                          // Show relative position instead of exact
  reveal_own?: boolean;                             // Players can see own score (default: true)
}

export interface GameConfig {
  name: string;
  version: string;
  players: number | { min: number; max: number };
  win_condition: string;
  max_rounds: number;
  max_turns?: number;  // Proposal 012: Turn-based limit (takes precedence over max_rounds)
  starting_cards?: number;
  deck?: DeckConfig[];
  board?: BoardConfig;
  mechanics?: string[];  // References to mechanic slugs (e.g., ['hand-management', 'set-collection'])
  engine_mechanics?: EngineMechanics;  // Enable/disable engine capabilities
  engine_debug?: {
    hook_telemetry?: boolean;  // Enable hook telemetry logging
  };
  [key: string]: unknown;  // game-specific config
}

// Mechanic definition from mechanics/ folder
export interface MechanicDef {
  id: string;
  name: string;
  slug: string;
  category: string;
  path: string;
}

export interface MechanicsIndex {
  generated: string;
  source: string;
  count: number;
  categories: string[];
  mechanics: MechanicDef[];
}

export interface DeckConfig {
  name: string;
  count: number;
  type?: string;
  effect?: {
    type: string;
    value?: number;
    duration?: number;
    color?: string;  // For card games like UNO
  };
  placeable?: boolean;  // Can this card be placed on board states?
  targetMode?: 'owner' | 'opponents' | 'all';  // Who the placed card affects
}

export interface BoardConfig {
  states: string[];
  start?: string;
  edges: EdgeConfig[];
}

export interface EdgeConfig {
  from: string | string[];
  to: string | string[];
  probability?: number;
  cost?: number;
}

export interface PendingAction {
  player: string;
  round: number;
  action: Record<string, unknown>;
  submittedAt: string;
}

export interface GameState {
  gameId: string;
  gameName: string;
  status: GameStatus;
  round: number;
  turnNumber: number;
  currentPlayer: string | null;
  turnOrder: string[];
  players: Record<string, PlayerState>;
  shared: Record<string, unknown>;  // game-specific shared state (cards mechanic puts deck/discardPile here)
  config: GameConfig;
  rulesMarkdown: string;
  log: string;  // path to log file
  created?: number;  // Unix timestamp in milliseconds when game was initialized
}

export interface WaitResult {
  status: 'your_turn' | 'game_over' | 'game_cancelled' | 'timeout' | 'error' | 'game_not_found';
  gameState?: PlayerView;
  winner?: string;
  reason?: string;
  error?: string;
}

export interface PlayerView {
  gameId: string;
  round: number;
  turnNumber: number;
  currentPlayer: string;
  myState: {
    state: string;
    hand: Card[];
    effects: Effect[];
  };
  opponents: OpponentView[];
  shared: Record<string, unknown>;
}

export interface OpponentView {
  playerId: string;
  state: string;
  handSize: number;
  effects: Effect[];
}

export interface ActionResult {
  accepted: boolean;
  result?: {
    type: string;
    success?: boolean;
    details?: Record<string, unknown>;
  };
  error?: string;
  nextPlayer?: string;
}

export interface RollResult {
  roll: number;
  threshold: number;
  success: boolean;
  context: string;
}

/**
 * Log event structure for game event logging.
 *
 * SOURCE OF TRUTH: /shared/types/log-events.ts
 *
 * Keep in sync with:
 * - shared/types/log-events.ts (canonical event definitions)
 * - site/src/types/logs.ts (TypedLogEvent union)
 *
 * Event types include:
 * - game_init, game_start, game_end, game_cancelled
 * - action_executed
 * - probability_roll, state_transition, move_failed (probability_movement)
 * - victory_claimed, victory_adjudicated, victory_rejected (victory_declaration)
 * - contest_filed, contest_adjudicated
 * - resignation_submitted, resignation_adjudicated
 */
export interface LogEvent {
  timestamp: string;
  event: string;
  round?: number;
  turnNumber?: number;
  player?: string;
  data?: Record<string, unknown>;
}

// ============ Contest-Based Adjudication Types ============

// Action schemas for validation
export type ActionType = 'play_card' | 'draw' | 'pass' | 'move' | 'place_card' | 'place_location' | 'trade_offer' | 'trade_respond' | 'resign' | 'bid' | 'spend' | 'collect_set' | 'roll' | 'bank' | 'draft' | 'draft_select' | 'use_ability' | 'acquire' | 'buy' | 'trash' | 'draw_deck' | 'use_card' | 'travel' | 'vote' | 'lock_dice' | 'unlock_dice' | 'sealed_bid' | 'once_around_bid' | 'once_around_pass' | 'icon_roll' | 'turn_order_bid' | 'claim_turn_position' | 'investigate' | 'accuse' | 'give_clue' | 'submit_for_judging' | 'judge_select' | 'divide_items' | 'choose_group' | 'offer_bribe' | 'respond_to_bribe' | 'commit_forces' | 'activate_units' | 'deploy_secret' | 'reveal_unit' | 'place_worker' | 'retrieve_workers' | 'auction_pass' | 'dutch_bid' | 'dutch_pass' | 'select_action' | 'buy_market' | 'sell_market' | 'add_to_tableau' | 'program_action' | 'execute_program' | 'contribute' | 'use_shared' | 'take_contract' | 'fulfill_contract' | 'take_loan' | 'repay_loan' | 'play_as_event' | 'retrieve_actions' | 'bet' | 'call_bluff' | 'propose_alliance' | 'accept_alliance' | 'reject_alliance' | 'break_alliance' | 'claim_route' | 'research' | 'place_influence' | 'follow_action' | 'use_advantage' | 'tell_story' | 'vote_story' | 'place_tile' |
  // Phase 15: New action types
  'queue_action' | 'process_queue' | 'perform' | 'guess' | 'dilemma_choice' |
  'set_rule' | 'test_example' | 'guess_rule' | 'validate_example' |
  'identify_pattern' | 'ask_question' | 'answer_question' | 'final_answer' |
  'buy_stock' | 'sell_stock' | 'invest' | 'buy_commodity' | 'sell_commodity' |
  'claim_ownership' | 'transfer_ownership' | 'place_pattern_piece' |
  'build_connection' | 'place_stone' | 'add_map_tile' |
  'bid_compensated' | 'bid_on_slot' | 'bid_multi_lot' | 'auction_bid' |
  'claim_at_price' | 'pass_price' | 'raise_bid' | 'pass_auction' |
  'hex_move' | 'rondel_move' | 'advance_track' | 'grid_square_move' | 'cover_space' |
  'create_meld' | 'add_to_meld' | 'splay' | 'play_command' | 'draft_to_deck' |
  'pickup_cargo' | 'deliver_cargo' | 'select_phase' | 'tug_push' |
  'reveal_match' | 'interrupt' | 'end_round' | 'place_dice_worker';

export interface BaseAction {
  type: ActionType;
  reasoning?: string;
}

export interface PlayCardAction extends BaseAction {
  type: 'play_card';
  card: string;
  declaredColor?: string;  // For wild cards
  target?: string;  // Target player for interference cards (Block, Friction, Sabotage, etc.)
}

export interface DrawAction extends BaseAction {
  type: 'draw';
  count?: number;  // defaults to 1
}

export interface PassAction extends BaseAction {
  type: 'pass';
}

export interface MoveAction extends BaseAction {
  type: 'move';
  target: string;
  boost?: string;           // Card name to use for probability boost
  declareVictory?: boolean; // Player believes this move wins
  victoryReason?: string;   // Why they believe they won
}

export interface ResignAction extends BaseAction {
  type: 'resign';
  reason: string;  // Required: why player is resigning
}

// New mechanic actions

export interface BidAction extends BaseAction {
  type: 'bid';
  amount: number;                    // Bid amount
  item?: string;                     // Optional: what you're bidding on
}

export interface SpendAction extends BaseAction {
  type: 'spend';
  resource: string;                  // Resource to spend (e.g., "gold")
  amount: number;                    // Amount to spend
  target?: string;                   // Optional: what to spend on
}

export interface CollectSetAction extends BaseAction {
  type: 'collect_set';
  cards: string[];                   // Card names to claim as a set
  setType: string;                   // Which set definition to use
}

// Push Your Luck actions
export interface RollAction extends BaseAction {
  type: 'roll';
  diceCount?: number;              // Number of dice to roll
  diceSides?: number;              // Number of sides per die
  purpose?: string;                // Purpose of the roll
  keepIndices?: number[];          // Indices of dice to keep (for re-rolling)
}

export interface BankAction extends BaseAction {
  type: 'bank';
  // Bank current accumulated points and end rolling
}

// Open Drafting action
export interface DraftAction extends BaseAction {
  type: 'draft';
  card: string;                      // Card name to draft from display
}

// Closed Drafting action
export interface DraftSelectAction extends BaseAction {
  type: 'draft_select';
  card: string;                      // Card name to select from draft pool
}

// Once Per Game Ability action
export interface UseAbilityAction extends BaseAction {
  type: 'use_ability';
  ability: string;                   // Ability ID to use
  target?: string;                   // Optional target
}

// Deck Building actions
export interface AcquireAction extends BaseAction {
  type: 'acquire';
  card: string;                      // Card name to acquire from supply
  pile?: string;                     // Optional: specific supply pile
}

export interface BuyAction extends BaseAction {
  type: 'buy';
  card: string;                      // Card name to buy from supply
  pile?: string;                     // Optional: specific supply pile
}

export interface TrashAction extends BaseAction {
  type: 'trash';
  card: string;                      // Card name to trash from hand
}

export interface DrawDeckAction extends BaseAction {
  type: 'draw_deck';
  count?: number;                    // Number of cards to draw from personal deck
}

// Multi-Use Cards action
export interface UseCardAction extends BaseAction {
  type: 'use_card';
  card: string;                      // Card name to use
  use: string;                       // Use type identifier
}

// Point-to-Point Movement action
export interface TravelAction extends BaseAction {
  type: 'travel';
  target: string;                    // Destination node ID
  route?: string;                    // Optional: specific route to use
}

// Voting action (Phase 5)
export interface VoteAction extends BaseAction {
  type: 'vote';
  choice: string | number | null;    // Vote choice (null = abstain)
  voteId?: string;                   // Optional: specific vote session ID
}

// Re-rolling and Locking actions (Phase 2)
export interface LockDiceAction extends BaseAction {
  type: 'lock_dice';
  diceIndex: number;                 // Index of die to lock
  value?: number;                    // Current value (for display)
}

export interface UnlockDiceAction extends BaseAction {
  type: 'unlock_dice';
  diceIndex: number;                 // Index of die to unlock
  value?: number;                    // Current value (for display)
}

// ============ State Cards (Game-Agnostic Board Placement) ============

/**
 * A card placed on a board state/location.
 * When players interact with that state, the placed card's effect triggers.
 */
export interface PlacedCard {
  cardName: string;
  placedBy: string;           // Player who placed this card
  state: string;              // Board state where the card is placed
  effect: {
    type: string;             // Effect type (probability_penalty, probability_boost, force_discard, etc.)
    value?: number;
    duration?: number;        // How long the effect lasts after triggering
  };
  targetMode: 'owner' | 'opponents' | 'all';  // Who the effect applies to
  triggersRemaining?: number; // How many times it can trigger (undefined = unlimited until removed)
}

/**
 * Action to place a card on a board state.
 * The card must be marked as `placeable: true` in the game's deck config.
 */
export interface PlaceCardAction extends BaseAction {
  type: 'place_card';
  card: string;               // Card name to place
  targetState: string;        // Board state to place the card on
}

export interface PlaceLocationAction extends BaseAction {
  type: 'place_location';
  card: string;               // Location card name to place
  adjacentTo: string;         // Existing location to place adjacent to (e.g., "origin", "Forest Clearing")
}

export interface TradeOfferAction extends BaseAction {
  type: 'trade_offer';
  target: string;             // Player ID to trade with
  offer: string[];            // Card names you are offering
  request: string[];          // Card names you want in return (empty for gifts)
}

export interface TradeRespondAction extends BaseAction {
  type: 'trade_respond';
  offerId: string;            // ID of the pending trade offer
  accept: boolean;            // Whether to accept the trade
}

// New Phase 1-5 Expansion Actions
export interface SealedBidAction extends BaseAction {
  type: 'sealed_bid';
  amount: number;
  auctionId?: string;
}

export interface OnceAroundBidAction extends BaseAction {
  type: 'once_around_bid';
  amount: number;
  auctionId?: string;
}

export interface OnceAroundPassAction extends BaseAction {
  type: 'once_around_pass';
  auctionId?: string;
}

export interface IconRollAction extends BaseAction {
  type: 'icon_roll';
  purpose?: string;
}

export interface TurnOrderBidAction extends BaseAction {
  type: 'turn_order_bid';
  amount: number;
}

export interface ClaimTurnPositionAction extends BaseAction {
  type: 'claim_turn_position';
  position: number;
}

export interface InvestigateAction extends BaseAction {
  type: 'investigate';
  target: string;
  infoType: string;
  specificItem?: string;
}

export interface AccuseAction extends BaseAction {
  type: 'accuse';
  accusation: Record<string, string>;
}

export interface GiveClueAction extends BaseAction {
  type: 'give_clue';
  targetPlayer: string;
  clueType: string;
  clueValue: string | number;
  affectedItems?: string[];
}

export interface SubmitForJudgingAction extends BaseAction {
  type: 'submit_for_judging';
  cardIds: string[];
}

export interface JudgeSelectAction extends BaseAction {
  type: 'judge_select';
  submissionIndex: number;
}

export interface DivideItemsAction extends BaseAction {
  type: 'divide_items';
  groups: string[][];
}

export interface ChooseGroupAction extends BaseAction {
  type: 'choose_group';
  groupIndex: number;
}

export interface OfferBribeAction extends BaseAction {
  type: 'offer_bribe';
  targetPlayer: string;
  amount: number;
  requestedAction: string;
  requestedDetails?: Record<string, unknown>;
}

export interface RespondToBribeAction extends BaseAction {
  type: 'respond_to_bribe';
  bribeId: string;
  accept: boolean;
}

// Phase 6: Combat System actions
export interface CommitForcesAction extends BaseAction {
  type: 'commit_forces';
  unitIds: string[];
  combatId: string;
}

export interface ActivateUnitsAction extends BaseAction {
  type: 'activate_units';
  unitIds: string[];
  orders: Record<string, 'move' | 'attack' | 'defend' | 'hold'>;
}

export interface DeploySecretAction extends BaseAction {
  type: 'deploy_secret';
  unitId: string;
  position: string;
  isDecoy?: boolean;
}

export interface RevealUnitAction extends BaseAction {
  type: 'reveal_unit';
  targetUnitId: string;
}

// Phase 7: Worker Placement actions
export interface PlaceWorkerAction extends BaseAction {
  type: 'place_worker';
  spaceId: string;
  workerId?: string;
}

export interface RetrieveWorkersAction extends BaseAction {
  type: 'retrieve_workers';
  fromSpaces?: string[];
}

// Auction pass action
export interface AuctionPassAction extends BaseAction {
  type: 'auction_pass';
}

// Dutch Auction actions
export interface DutchBidAction extends BaseAction {
  type: 'dutch_bid';
}

export interface DutchPassAction extends BaseAction {
  type: 'dutch_pass';
}

// Simultaneous Action Selection action
export interface SelectActionAction extends BaseAction {
  type: 'select_action';
  selectedAction: Record<string, unknown>;
}

// Market actions
export interface BuyMarketAction extends BaseAction {
  type: 'buy_market';
  commodity: string;
  quantity?: number;
}

export interface SellMarketAction extends BaseAction {
  type: 'sell_market';
  commodity: string;
  quantity?: number;
}

// Tableau Building action
export interface AddToTableauAction extends BaseAction {
  type: 'add_to_tableau';
  card: string;
}

// Action Programming actions
export interface ProgramActionAction extends BaseAction {
  type: 'program_action';
  actions: Record<string, unknown>[];
}

export interface ExecuteProgramAction extends BaseAction {
  type: 'execute_program';
}

// Cooperative actions
export interface ContributeAction extends BaseAction {
  type: 'contribute';
  resource: string;
  amount: number;
}

export interface UseSharedAction extends BaseAction {
  type: 'use_shared';
  resource: string;
  amount: number;
}

export interface TakeContractAction extends BaseAction {
  type: 'take_contract';
  contract_id: string;
}

export interface FulfillContractAction extends BaseAction {
  type: 'fulfill_contract';
  contract_id: string;
}

export interface TakeLoanAction extends BaseAction {
  type: 'take_loan';
}

export interface RepayLoanAction extends BaseAction {
  type: 'repay_loan';
  loan_index: number;  // Which loan to repay (index in active_loans array)
}

// Action Event mechanic
export interface PlayAsEventAction extends BaseAction {
  type: 'play_as_event';
  card: string;
}

// Action Retrieval mechanic
export interface RetrieveActionsAction extends BaseAction {
  type: 'retrieve_actions';
}

// Betting and Bluffing mechanic
export interface BetAction extends BaseAction {
  type: 'bet';
  amount: number;
  action?: 'raise' | 'call' | 'fold' | 'check';
}

export interface CallBluffAction extends BaseAction {
  type: 'call_bluff';
  targetPlayerId: string;
}

// Alliance mechanic
export interface ProposeAllianceAction extends BaseAction {
  type: 'propose_alliance';
  targetPlayerId: string;
}

export interface AcceptAllianceAction extends BaseAction {
  type: 'accept_alliance';
  proposalId: string;
}

export interface RejectAllianceAction extends BaseAction {
  type: 'reject_alliance';
  proposalId: string;
}

export interface BreakAllianceAction extends BaseAction {
  type: 'break_alliance';
  allianceId: string;
}

// Network and Route Building mechanic
export interface ClaimRouteAction extends BaseAction {
  type: 'claim_route';
  routeId: string;
}

// Tech Trees mechanic
export interface ResearchAction extends BaseAction {
  type: 'research';
  techId: string;
}

// Subagent-created action types
export interface PlaceInfluenceAction extends BaseAction {
  type: 'place_influence';
  areaId: string;
  amount?: number;
}

export interface FollowActionAction extends BaseAction {
  type: 'follow_action';
  leadAction?: string;
}

export interface UseAdvantageAction extends BaseAction {
  type: 'use_advantage';
}

export interface TellStoryAction extends BaseAction {
  type: 'tell_story';
  promptId?: string;
  story?: string;
}

export interface VoteStoryAction extends BaseAction {
  type: 'vote_story';
  targetPlayerId: string;
}

export interface PlaceTileAction extends BaseAction {
  type: 'place_tile';
  tileId: string;
  position: string;
  rotation?: number;
}

// Phase 15: Generic action interface for new mechanic actions
export interface Phase15Action extends BaseAction {
  type: 'queue_action' | 'process_queue' | 'perform' | 'guess' | 'dilemma_choice' |
    'set_rule' | 'test_example' | 'guess_rule' | 'validate_example' |
    'identify_pattern' | 'ask_question' | 'answer_question' | 'final_answer' |
    'buy_stock' | 'sell_stock' | 'invest' | 'buy_commodity' | 'sell_commodity' |
    'claim_ownership' | 'transfer_ownership' | 'place_pattern_piece' |
    'build_connection' | 'place_stone' | 'add_map_tile' |
    'bid_compensated' | 'bid_on_slot' | 'bid_multi_lot' | 'auction_bid' |
    'claim_at_price' | 'pass_price' | 'raise_bid' | 'pass_auction' |
    'hex_move' | 'rondel_move' | 'advance_track' | 'grid_square_move' | 'cover_space' |
    'create_meld' | 'add_to_meld' | 'splay' | 'play_command' | 'draft_to_deck' |
    'pickup_cargo' | 'deliver_cargo' | 'select_phase' | 'tug_push' |
    'reveal_match' | 'interrupt' | 'end_round' | 'place_dice_worker';
  [key: string]: unknown;
}

export type GameAction = PlayCardAction | DrawAction | PassAction | MoveAction | PlaceCardAction | PlaceLocationAction | TradeOfferAction | TradeRespondAction | ResignAction | BidAction | SpendAction | CollectSetAction | RollAction | BankAction | DraftAction | DraftSelectAction | UseAbilityAction | AcquireAction | BuyAction | TrashAction | DrawDeckAction | UseCardAction | TravelAction | VoteAction | LockDiceAction | UnlockDiceAction | SealedBidAction | OnceAroundBidAction | OnceAroundPassAction | IconRollAction | TurnOrderBidAction | ClaimTurnPositionAction | InvestigateAction | AccuseAction | GiveClueAction | SubmitForJudgingAction | JudgeSelectAction | DivideItemsAction | ChooseGroupAction | OfferBribeAction | RespondToBribeAction | CommitForcesAction | ActivateUnitsAction | DeploySecretAction | RevealUnitAction | PlaceWorkerAction | RetrieveWorkersAction | AuctionPassAction | DutchBidAction | DutchPassAction | SelectActionAction | BuyMarketAction | SellMarketAction | AddToTableauAction | ProgramActionAction | ExecuteProgramAction | ContributeAction | UseSharedAction | TakeContractAction | FulfillContractAction | TakeLoanAction | RepayLoanAction | PlayAsEventAction | RetrieveActionsAction | BetAction | CallBluffAction | ProposeAllianceAction | AcceptAllianceAction | RejectAllianceAction | BreakAllianceAction | ClaimRouteAction | ResearchAction | PlaceInfluenceAction | FollowActionAction | UseAdvantageAction | TellStoryAction | VoteStoryAction | PlaceTileAction | Phase15Action;

// Action validation result
export interface ActionValidationResult {
  valid: boolean;
  errors: string[];  // Actionable error messages for player
  warnings?: string[];  // Non-blocking issues
}

// Last action tracking (for contests)
export interface LastAction {
  player: string;
  action: GameAction;
  timestamp: string;
  round: number;
  turnNumber: number;
  result?: {
    success: boolean;
    details?: Record<string, unknown>;
  };
}

// Pending contest state
export interface PendingContest {
  contestedBy: string;
  reason: string;
  originalAction: LastAction;
  timestamp: string;
}

// Pending resignation (awaiting gamemaster adjudication)
export interface PendingResignation {
  player: string;
  reason: string;
  timestamp: string;
}

// Pending victory claim (awaiting gamemaster adjudication)
export interface PendingVictoryClaim {
  player: string;
  reason: string;           // Why they believe they won
  fromState: string;        // State before the move
  toState: string;          // Claimed victory state
  action: GameAction;       // The action that led to claim
  timestamp: string;
}

// Victory claim history entry
export interface VictoryClaimEntry {
  player: string;
  reason: string;
  ruling: 'accepted' | 'rejected';
  rulingReason: string;
  timestamp: string;
}

// Contest history entry
export interface ContestHistoryEntry {
  round: number;
  turnNumber: number;
  action: GameAction;
  player: string;
  contestedBy: string;
  contestReason: string;
  ruling: 'allowed' | 'rejected';
  rulingReason: string;
  timestamp: string;
}

// Resignation history entry
export interface ResignationEntry {
  player: string;
  reason: string;
  accepted: boolean;
  rulingReason?: string;
  timestamp: string;
}

// Operator hint entry (for unblocking agents)
export interface OperatorHint {
  message: string;
  reason: string;
  timestamp: string;
  createdAtRound: number;
  createdAtTurn: number;
  targetPlayer?: string;  // Optional: specific player, or all if undefined
  expiresAfterRounds?: number;  // Optional: expire after N rounds
  expiresAfterTurns?: number;   // Optional: expire after N turns
}

// Extended game state with contest system
export interface ContestState {
  lastAction?: LastAction;
  actionHistory: LastAction[];  // Recent actions for player visibility (last N turns)
  pendingContest?: PendingContest;
  pendingResignation?: PendingResignation;
  pendingVictoryClaim?: PendingVictoryClaim;
  contestHistory: ContestHistoryEntry[];
  resignations: ResignationEntry[];
  victoryHistory: VictoryClaimEntry[];
  operatorHints?: OperatorHint[];  // Ephemeral hints from operator to help agents
}

// Act command result
export interface ActResult {
  success: boolean;
  action?: GameAction;
  validation?: ActionValidationResult;
  effect?: {
    type: string;
    details?: Record<string, unknown>;
  };
  handSize?: number;
  nextPlayer?: string;
  error?: string;
}

// Contest result
export interface ContestResult {
  success: boolean;
  contestId?: string;
  message?: string;
  error?: string;
}

// Adjudication result
export interface AdjudicationResult {
  success: boolean;
  ruling?: 'allowed' | 'rejected';
  reason?: string;
  reversedAction?: boolean;
  error?: string;
}

// Wait result extended with contest info
export interface ExtendedWaitResult {
  status: 'your_turn' | 'game_over' | 'game_cancelled' | 'timeout' | 'error' | 'game_not_found' | 'contest_pending' | 'resignation_pending' | 'victory_pending';
  gameState?: PlayerView;
  winner?: string;
  reason?: string;
  error?: string;
  lastAction?: LastAction;  // Previous player's action (for potential contest)
  pendingContest?: PendingContest;
  pendingResignation?: PendingResignation;
  pendingVictoryClaim?: PendingVictoryClaim;
}

// ============ Dynamic Action Discovery ============

/**
 * Describes an available action with usage instructions.
 * Used to procedurally expose available commands based on game rules and state.
 */
export interface AvailableAction {
  type: ActionType;
  description: string;
  enabled: boolean;              // Whether this action is currently available
  reason?: string;               // Why it's enabled/disabled
  required: Record<string, string>;  // field name -> description
  optional?: Record<string, string>;
  examples: GameAction[];        // Concrete examples the agent can use
  cards?: string[];              // Specific cards that can be used (for play_card, place_card)
  targets?: string[];            // Valid targets (for move, place_card)
}

/**
 * Result of getAvailableActions() - shows what a player can do.
 * Mechanics can add additional fields via getPlayerView hooks.
 */
export interface AvailableActionsResult {
  playerId: string;
  isYourTurn: boolean;
  currentState: string;
  hand: string[];                // Card names in hand
  actions: AvailableAction[];
  placedCards: PlacedCard[];     // Cards placed on board (if any)
  activeEffects: Effect[];       // Effects currently on this player
  // Mechanic-contributed fields (added dynamically via getPlayerView hooks)
  // Examples: actionPoints, resources, collectedSets, power, etc.
  [key: string]: unknown;
}

// ============ Game Analysis Types ============

/**
 * A notable moment during the game (for analysis).
 */
export interface KeyMoment {
  round: number;
  turnNumber: number;
  player: string;
  action: string;
  significance: string;          // Why this moment mattered
}

/**
 * Gamemaster analysis of a completed game.
 */
export interface GameAnalysis {
  summary: string;               // Brief game summary
  winner: string;                // Winner player ID
  winCondition: string;          // How they won
  keyMoments: KeyMoment[];       // Notable moments/decisions
  mechanicsObserved: string[];   // Which mechanics were used
  playerStrategies?: Record<string, string>;  // Brief strategy notes per player
  recommendations?: string[];    // Suggestions for game balance/rules
}

// ============ Validation Types ============

/**
 * A validation error or warning from rules validation.
 */
export interface ValidationIssue {
  code: string;                  // Machine-readable error code
  message: string;               // Human-readable message
  severity: 'error' | 'warning'; // Severity level
  location?: string;             // Where in the config (e.g., "config.deck[0].name")
  suggestion?: string;           // How to fix it
}

/**
 * An extracted markdown section from RULES.md.
 */
export interface ExtractedSection {
  heading: string;               // Original heading text
  level: number;                 // Heading level (1-6)
  content: string;               // Content under this heading
  startLine: number;             // Line number where section starts
  endLine: number;               // Line number where section ends
}

/**
 * All extracted sections from a RULES.md file.
 */
export interface ExtractedSections {
  // Standard sections (normalized names)
  overview?: string;
  setup?: string;
  gameplay?: string;
  winning?: string;
  cardTypes?: string;
  gamemasterNotes?: string;
  strategy?: string;
  designNotes?: string;

  // All sections by heading (raw)
  allSections: Record<string, ExtractedSection>;
}

/**
 * Result of validating a RULES.md file.
 */
export interface ValidationResult {
  valid: boolean;                // True if no errors (warnings OK)
  errors: ValidationIssue[];     // Validation errors
  warnings: ValidationIssue[];   // Validation warnings
  config?: GameConfig;           // Parsed config (if YAML valid)
  markdown?: string;             // Raw markdown content
  sections?: ExtractedSections;  // Extracted sections (if requested)
}

// ============ Phase 2 Additional Dice Config Types ============

/**
 * Roll Spin and Move mechanic config.
 * Classic board game movement where dice determine spaces moved.
 */
export interface RollSpinMoveConfig {
  dice_count?: number;           // Number of dice (default: 2)
  dice_sides?: number;           // Sides per die (default: 6)
  auto_roll?: boolean;           // Auto roll at turn start
  doubles_again?: boolean;       // Roll again on doubles
  doubles_jail?: boolean;        // Three doubles = jail
  jail_state?: string;           // State name for jail
  linear_track?: string[];       // Ordered track positions
  loop?: boolean;                // Track loops back
}

/**
 * Different Dice Movement mechanic config.
 * Dice determine movement options rather than distance.
 */
export interface DifferentDiceMovementConfig {
  dice_count?: number;           // Number of dice
  dice_sides?: number;           // Sides per die
  movement_mapping?: Record<number, {
    type: 'forward' | 'backward' | 'diagonal' | 'jump' | 'any' | 'specific';
    distance?: number;
    directions?: string[];
    targets?: string[];
  }>;
  use_individual?: boolean;      // Use each die separately
  doubles_bonus?: boolean;       // Extra moves on doubles
  must_use_all?: boolean;        // Must use all dice
}

// ============ Phase 3 Additional Turn Order Config Types ============

/**
 * Turn Order Pass Order mechanic config.
 * Turn order determined by pass order from previous round.
 */
export interface TurnOrderPassOrderConfig {
  first_passer_first?: boolean;  // First passer goes first (default: true)
  track_within_round?: boolean;  // Track order within round
  compensation?: {
    type: 'resource' | 'points' | 'cards';
    resource?: string;
    base_amount?: number;
    per_position?: number;       // Bonus per position
  };
}

// ============ Phase 4 Additional Visibility Config Types ============

/**
 * Hidden Movement mechanic config.
 * Player positions are hidden from other players.
 */
export interface HiddenMovementConfig {
  hidden_players?: string[];     // Player IDs with hidden movement
  hidden_roles?: string[];       // Roles with hidden movement
  reveal_frequency?: number;     // Reveal every N turns
  reveal_radius?: number;        // Reveal when within N spaces
  clue_system?: {
    enabled: boolean;
    clue_type: 'proximity' | 'direction' | 'region';
    proximity_ranges?: { near: number; medium: number; far: number };
  };
  fog_of_war?: boolean;          // Only see within range
  visibility_range?: number;     // Range for fog of war
}

/**
 * Hidden objectives config (Proposal 012).
 * Assigns secret objectives to players from the game's `objectives` array.
 */
export interface HiddenObjectivesConfig {
  deal_at_start?: boolean;        // Deal objectives at game start
  reveal_on_completion?: boolean; // Reveal objective when completed
}

// ============ Phase 5 Additional Social Config Types ============

/**
 * Negotiation mechanic config.
 * Binding and non-binding agreements between players.
 */
export interface NegotiationMechanicConfig {
  binding?: boolean;             // Agreements enforceable by default
  penalty_for_breaking?: {
    type: 'resource' | 'score' | 'reputation' | 'custom';
    resource?: string;
    amount?: number;
  };
  max_agreements?: number;       // Max active agreements per player
  agreement_types?: ('non_aggression' | 'alliance' | 'trade_deal' | 'territory' | 'vote_agreement' | 'custom')[];
  allow_public?: boolean;        // Allow public agreements
  allow_private?: boolean;       // Allow private agreements
  expiration_turns?: number;     // Default expiration in turns
}

/**
 * Communication Limits mechanic config.
 * Restricts when and how players can communicate.
 */
export interface CommunicationLimitsConfig {
  communication_phases?: {
    phase: 'turn_start' | 'turn_end' | 'round_start' | 'round_end' | 'always' | 'never';
    duration?: number;
  }[];
  message_types?: {
    type: 'word' | 'phrase' | 'signal' | 'gesture' | 'number' | 'choice';
    maxLength?: number;
    vocabulary?: string[];
  }[];
  limits?: {
    messages_per_turn?: number;
    messages_per_round?: number;
    words_per_message?: number;
    characters_per_message?: number;
    total_messages?: number;
  };
  target_restrictions?: {
    from?: string[];
    to?: string[];
    allow?: boolean;
    same_team_only?: boolean;
  }[];
  no_table_talk?: boolean;       // No free communication
  team_only?: boolean;           // Team communication only
  one_word_clues?: boolean;      // One word per clue
  signal_vocabulary?: string[];  // Predefined signals
}

// ============ Phase 1-5 Expansion Config Types ============

/**
 * Sealed Bid Auction config.
 */
export interface AuctionSealedBidConfig {
  currency: string;
  allow_tie_winning?: boolean;
  reveal_all_bids?: boolean;
}

/**
 * Once Around Auction config.
 */
export interface AuctionOnceAroundConfig {
  currency: string;
  min_increment?: number;
  starting_bid?: number;
}

/**
 * Die Icon Resolution config.
 */
export interface DieIconResolutionConfig {
  dice_count?: number;
  icons: Record<string, {
    weight: number;
    effect: string;
    value?: number;
    description?: string;
  }>;
}

/**
 * Turn Order Auction config.
 */
export interface TurnOrderAuctionConfig {
  currency: string;
  when?: 'round_start' | 'game_start';
  tie_breaker?: 'current_order' | 'random';
}

/**
 * Turn Order Claim Action config.
 */
export interface TurnOrderClaimConfig {
  cost?: Record<string, number>;
  positions_available?: number;
  reset_each_round?: boolean;
}

/**
 * Turn Order Time Track config.
 */
export interface TurnOrderTimeTrackConfig {
  starting_position?: number;
  max_position?: number;
  default_time_cost?: number;
}

/**
 * Turn Order Role config.
 */
export interface TurnOrderRoleConfig {
  role_priorities: Record<string, number>;
  tie_breaker?: 'clockwise' | 'random';
}

/**
 * Deduction mechanic config.
 */
export interface DeductionConfig {
  hidden_info_types: string[];
  clue_action_cost?: Record<string, number>;
  max_guesses?: number;
}

/**
 * Memory mechanic config.
 */
export interface MemoryMechanicConfig {
  reveal_duration?: number;
  memory_types?: string[];
  can_take_notes?: boolean;
}

/**
 * Targeted Clues config.
 */
export interface TargetedCluesConfig {
  clue_types: string[];
  clues_per_turn?: number;
  clue_cost?: Record<string, number>;
  must_be_truthful?: boolean;
}

/**
 * Roles with Asymmetric Information config.
 */
export interface RolesAsymmetricInfoConfig {
  roles: Record<string, {
    can_see: string[];
    knows_roles_of: string[];
    special_knowledge?: string;
  }>;
}

/**
 * Player Judge config.
 */
export interface PlayerJudgeConfig {
  judge_rotation: 'clockwise' | 'winner' | 'random';
  submissions_per_player?: number;
  anonymous_submissions?: boolean;
  judge_can_participate?: boolean;
}

/**
 * I Cut You Choose config.
 */
export interface ICutYouChooseConfig {
  num_groups: number;
  chooser_order?: 'reverse' | 'clockwise';
  cutter_gets_last?: boolean;
}

/**
 * Bribery config.
 */
export interface BriberyConfig {
  currency: string;
  binding?: boolean;
  max_bribe_per_action?: number;
  bribe_targets?: string[];
}

// ============ Phase 6: Combat System Config Types ============

/**
 * Critical Hits config.
 */
export interface CriticalHitsConfig {
  critical_hit_roll?: number;
  critical_fail_roll?: number;
  critical_hit_multiplier?: number;
  critical_fail_penalty?: number;
}

/**
 * Zone of Control config.
 */
export interface ZoneOfControlConfig {
  zoc_range?: number;
  blocks_movement?: boolean;
  must_stop?: boolean;
  must_attack?: boolean;
}

/**
 * Ratio Combat Results Table config.
 */
export interface RatioCRTConfig {
  die_sides?: number;
  crt?: Record<string, Record<string, {
    winner: 'attacker' | 'defender' | 'draw';
    attackerLosses: number;
    defenderLosses: number;
    retreat?: 'attacker' | 'defender' | 'both';
    exchange?: boolean;
  }>>;
}

/**
 * Force Commitment config.
 */
export interface ForceCommitmentConfig {
  simultaneous?: boolean;
  revealed_after_commit?: boolean;
  commitment_binding?: boolean;
}

/**
 * Area Impulse config.
 */
export interface AreaImpulseConfig {
  impulse_cost?: number;
  max_impulses?: number;
  activation_limit?: number;
}

/**
 * Chit Pull System config.
 */
export interface ChitPullConfig {
  chits_per_player?: number;
  formation_chits?: boolean;
  event_chits?: boolean;
  return_after_pull?: boolean;
}

/**
 * Secret Unit Deployment config.
 */
export interface SecretDeploymentConfig {
  reveal_on_combat?: boolean;
  reveal_on_adjacent?: boolean;
  allow_bluffing?: boolean;
  reveal_cost?: number;
}

/**
 * Kill Steal config.
 */
export interface KillStealConfig {
  bounty_type?: 'fixed' | 'percentage' | 'unit_value';
  bounty_amount?: number;
  credit_assists?: boolean;
  assist_share?: number;
}

// ============ Phase 7: Worker Placement Config Types ============

/**
 * Worker Placement mechanic config.
 */
export interface WorkerPlacementConfig {
  workers_per_player: number;
  worker_types?: WorkerTypeConfig[];
  spaces: WorkerSpaceConfig[];
  retrieval: 'round_start' | 'manual' | 'action';
  costs_action_point?: boolean;
}

export interface WorkerTypeConfig {
  type: string;
  count: number;
}

export interface WorkerSpaceConfig {
  id: string;
  name: string;
  capacity?: number;
  action?: string;
  cost?: Record<string, number>;
  reward?: Record<string, number>;
  available?: boolean;
}

// ============ Multi-Category Expansion Config Types ============

/**
 * Different Worker Types config.
 */
export interface DifferentWorkerTypesConfig {
  types?: { type: string; name: string; count_per_player?: number; strength?: number; abilities?: string[] }[];
  type_restrictions?: Record<string, string[]>;
  type_bonuses?: Record<string, Record<string, { resource?: string; amount?: number }>>;
}

/**
 * Dutch Auction config.
 */
export interface AuctionDutchConfig {
  starting_price?: number;
  decrement?: number;
  min_price?: number;
  currency?: string;
}

/**
 * Simultaneous Action Selection config.
 */
export interface SimultaneousActionSelectionConfig {
  resolution_order?: 'random' | 'clockwise' | 'priority';
  actions_per_round?: number;
  reveal_before_resolve?: boolean;
}

/**
 * Market (Supply & Demand) config.
 */
export interface MarketMechanicConfig {
  commodities?: { id: string; name: string; base_price: number; supply?: number; demand_decay?: number }[];
  price_volatility?: number;
  price_floor?: number;
  price_ceiling?: number;
  currency?: string;
}

/**
 * Tableau Building config.
 */
export interface TableauBuildingConfig {
  max_size?: number;
  placement_cost?: Record<string, number>;
  score_per_card?: number;
  synergy_bonuses?: { card_types: string[]; bonus_type: 'score' | 'resource' | 'draw'; amount: number; resource?: string }[];
  income_per_card_type?: Record<string, Record<string, number>>;
}

/**
 * Action Programming config.
 */
export interface ActionProgrammingConfig {
  program_size?: number;
  simultaneous?: boolean;
  reveal_order?: 'simultaneous' | 'sequential';
  allowed_actions?: string[];
}

/**
 * Cooperative Actions config.
 */
export interface CooperativeConfig {
  shared_pool?: Record<string, number>;
  threat_level?: number;
  threat_per_round?: number;
  max_threat?: number;
  cooperative_actions?: string[];
  loss_message?: string;
}

// Economic mechanic configs
export interface ContractsConfig {
  contracts: ContractDef[];
  max_active?: number;
  available_count?: number;
  refill?: boolean;
}

export interface ContractDef {
  id: string;
  name: string;
  requirements: Record<string, number>;
  rewards: Record<string, number>;
  points?: number;
}

export interface LoansConfig {
  max_loans?: number;
  loan_amount: number;
  interest_rate: number;
  resource: string;
  repayment_deadline?: number;
  penalty?: number;
}

// Ending/elimination mechanic configs
export interface FinaleEndingConfig {
  scoring_categories?: Array<{
    name: string;
    source: 'score' | 'resources' | 'hand_size' | 'effects';
    resource?: string;
    multiplier?: number;
  }>;
}

export interface SingleLoserConfig {
  loser_condition: 'lowest_score' | 'last_remaining' | 'bankrupt';
  resource?: string;
}

export interface PlayerEliminationProcessConfig {
  condition: 'zero_score' | 'zero_resource' | 'no_cards';
  resource?: string;
  remove_from_turn_order?: boolean;
}

// Action Drafting mechanic (slug: action-drafting)
export interface ActionDraftingConfig {
  actions: Array<{
    id: string;
    name: string;
    description?: string;
    effect?: Record<string, unknown>;
    exclusive?: boolean;
  }>;
  selection_per_round?: number;
  refill?: 'always' | 'per_round';
}

// Action Event mechanic (slug: action-event)
export interface ActionEventConfig {
  event_cards?: string[];  // Card types that can be played as events
  event_cost?: Record<string, number>;  // Cost to play as event
  discard_after_event?: boolean;  // Discard card after playing as event
}

// Action Retrieval mechanic (slug: action-retrieval)
export interface ActionRetrievalConfig {
  max_retrievable?: number;  // Max cards to retrieve at once (0 = all)
  cost?: Record<string, number>;  // Cost to retrieve
  cooldown?: number;  // Turns between retrieval
  retrieve_from?: 'discard' | 'played' | 'both';
}

// Betting and Bluffing mechanic (slug: betting-and-bluffing)
export interface BettingAndBluffingConfig {
  currency: string;  // Resource used for betting
  min_bet?: number;
  max_bet?: number;
  rounds?: number;  // Betting rounds per hand
  allow_bluff?: boolean;
  bluff_penalty?: number;  // Penalty for failed bluff call
  bluff_reward?: number;  // Reward for catching a bluff
}

// Cooperative Game mechanic (slug: cooperative-game)
export interface CooperativeGameConfig {
  threat_level?: number;  // Starting threat
  threat_escalation?: number;  // Threat increase per turn
  max_threat?: number;  // Game over threshold
  shared_objectives?: Array<{
    id: string;
    name: string;
    condition: string;
    points?: number;
  }>;
  lives?: number;  // Shared team lives
}

// Alliances mechanic (slug: alliances)
export interface AlliancesConfig {
  max_alliance_size?: number;
  max_alliances?: number;
  binding?: boolean;
  duration?: number;
  shared_victory?: boolean;
  shared_resources?: string[];
}

// Network and Route Building mechanic (slug: network-and-route-building)
export interface NetworkAndRouteBuildingConfig {
  routes: Array<{
    id: string;
    from: string;
    to: string;
    cost: Record<string, number>;
    points?: number;
    length?: number;
  }>;
  route_cards?: Array<{
    id: string;
    from: string;
    to: string;
    bonus_points: number;
  }>;
  max_routes_per_player?: number;
}

// Tech Trees mechanic (slug: tech-trees-tech-tracks)
export interface TechTreesConfig {
  techs: Array<{
    id: string;
    name: string;
    description?: string;
    cost: Record<string, number>;
    prerequisites?: string[];
    bonuses?: Record<string, number>;
    points?: number;
    unlocks?: string[];
  }>;
  tracks?: Array<{
    id: string;
    name: string;
    techs: string[];
  }>;
  max_researched?: number;
}

// Area Majority / Influence mechanic (slug: area-majority-influence)
export interface AreaMajorityInfluenceConfig {
  areas: Array<{
    id: string;
    name: string;
    points?: number;
    max_influence?: number;
  }>;
  influence_cost?: Record<string, number>;
  scoring?: 'majority_only' | 'proportional' | 'top_two';
}

// Team-Based Game mechanic (slug: team-based-game)
export interface TeamBasedGameConfig {
  teams: Array<{
    id: string;
    name: string;
    size?: number;
  }>;
  assignment?: 'random' | 'draft' | 'fixed';
  shared_score?: boolean;
  team_communication?: boolean;
}

// Tile Placement mechanic (slug: tile-placement)
export interface TilePlacementConfig {
  tiles?: Array<{
    id: string;
    name: string;
    edges?: string[];
    points?: number;
  }>;
  placement_rules?: 'adjacent' | 'matching_edges' | 'free';
  scoring?: 'per_tile' | 'pattern' | 'area';
}

// Variable Set Up mechanic (slug: variable-set-up)
export interface VariableSetUpConfig {
  setup_options?: Array<{
    id: string;
    name: string;
    description?: string;
    changes: Record<string, unknown>;
  }>;
  random_setup?: boolean;
  modules?: string[];
}

// Advantage Token mechanic (slug: advantage-token)
export interface AdvantageTokenConfig {
  token_name?: string;
  initial_holder?: 'random' | 'first_player';
  pass_condition?: 'lowest_score' | 'last_place' | 'round_end';
  bonus?: Record<string, unknown>;
}

// Random Production mechanic (slug: random-production)
export interface RandomProductionConfig {
  productions: Array<{
    resource: string;
    dice?: number;
    sides?: number;
    min?: number;
    max?: number;
  }>;
  timing?: 'turn_start' | 'round_start';
}

// Follow mechanic (slug: follow)
export interface FollowConfig {
  allow_follow?: boolean;
  follow_bonus?: Record<string, number>;
  lead_bonus?: Record<string, number>;
}

// Storytelling mechanic (slug: storytelling)
export interface StorytellingConfig {
  prompt_deck?: boolean;
  voting?: boolean;
  points_for_story?: number;
  points_for_vote?: number;
}
