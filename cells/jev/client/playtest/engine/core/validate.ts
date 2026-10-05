// Validation logic for RULES.md files

import { readFileSync, existsSync } from '../shims/fs';
import { parse as parseYAML } from 'yaml';
import { join, dirname } from '../shims/path';
import { fileURLToPath } from '../shims/url';

import type {
  GameConfig,
  EngineMechanics,
  DeckConfig,
  BoardConfig,
  ValidationResult,
  ValidationIssue,
  ExtractedSections,
  ExtractedSection,
  MechanicsIndex,
} from '../types/game';

import {
  SECTION_DEFINITIONS,
  VALID_EFFECT_TYPES,
  VALID_ADJACENCY_TYPES,
  VALID_GRID_TYPES,
  VALID_AUCTION_TYPES,
  VALID_TURN_ORDER_TYPES,
  VALID_POWER_ASSIGNMENTS,
  VALID_POWER_EFFECT_TYPES,
  VALID_SET_SCORING,
  VALID_HAND_LIMIT_POLICIES,
  VALID_TIMEOUT_WINNER_TYPES,
  VALID_TARGET_MODES,
} from './validate-schema';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MECHANICS_DIR = join(__dirname, '../../mechanics');

/**
 * Load mechanics index for cross-reference validation.
 */
function loadMechanicsIndex(): MechanicsIndex | null {
  const indexPath = join(MECHANICS_DIR, 'index.json');
  if (!existsSync(indexPath)) {
    return null;
  }
  try {
    return JSON.parse(readFileSync(indexPath, 'utf-8'));
  } catch {
    return null;
  }
}

/**
 * Create a validation error.
 */
function error(code: string, message: string, location?: string, suggestion?: string): ValidationIssue {
  return { code, message, severity: 'error', location, suggestion };
}

/**
 * Create a validation warning.
 */
function warning(code: string, message: string, location?: string, suggestion?: string): ValidationIssue {
  return { code, message, severity: 'warning', location, suggestion };
}

/**
 * Validate the YAML frontmatter configuration.
 */
function validateConfig(config: unknown, issues: ValidationIssue[]): config is GameConfig {
  if (!config || typeof config !== 'object') {
    issues.push(error('INVALID_CONFIG', 'Configuration must be an object'));
    return false;
  }

  const cfg = config as Record<string, unknown>;

  // Required fields
  if (!cfg.name || typeof cfg.name !== 'string') {
    issues.push(error('MISSING_NAME', 'Required field "name" is missing or not a string', 'config.name'));
  }

  if (!cfg.win_condition || typeof cfg.win_condition !== 'string') {
    issues.push(error('MISSING_WIN_CONDITION', 'Required field "win_condition" is missing or not a string', 'config.win_condition'));
  }

  // Players field validation
  if (cfg.players === undefined) {
    issues.push(error('MISSING_PLAYERS', 'Required field "players" is missing', 'config.players'));
  } else if (typeof cfg.players === 'number') {
    if (cfg.players < 1 || cfg.players > 20) {
      issues.push(error('INVALID_PLAYERS', `Player count ${cfg.players} is out of valid range (1-20)`, 'config.players'));
    }
  } else if (typeof cfg.players === 'string') {
    // Handle "2-4" format
    const match = cfg.players.match(/^(\d+)-(\d+)$/);
    if (match) {
      const min = parseInt(match[1], 10);
      const max = parseInt(match[2], 10);
      if (min > max) {
        issues.push(error('INVALID_PLAYERS', `Player range min (${min}) is greater than max (${max})`, 'config.players'));
      }
    } else {
      issues.push(error('INVALID_PLAYERS', 'Players must be a number or range (e.g., "2-4")', 'config.players'));
    }
  } else if (typeof cfg.players === 'object' && cfg.players !== null) {
    const players = cfg.players as Record<string, unknown>;
    if (typeof players.min !== 'number' || typeof players.max !== 'number') {
      issues.push(error('INVALID_PLAYERS', 'Players object must have numeric "min" and "max" fields', 'config.players'));
    } else if (players.min > players.max) {
      issues.push(error('INVALID_PLAYERS', `Player range min (${players.min}) is greater than max (${players.max})`, 'config.players'));
    }
  } else {
    issues.push(error('INVALID_PLAYERS', 'Players must be a number, range string, or {min, max} object', 'config.players'));
  }

  // Recommended fields (warnings)
  if (!cfg.version) {
    issues.push(warning('MISSING_VERSION', 'Recommended field "version" is missing', 'config.version', 'Add version: "1.0"'));
  }

  if (cfg.max_rounds === undefined) {
    issues.push(warning('MISSING_MAX_ROUNDS', 'Field "max_rounds" not specified, will default to 50', 'config.max_rounds'));
  } else if (typeof cfg.max_rounds !== 'number' || cfg.max_rounds < 1) {
    issues.push(error('INVALID_MAX_ROUNDS', 'max_rounds must be a positive number', 'config.max_rounds'));
  }

  if (cfg.starting_cards !== undefined && (typeof cfg.starting_cards !== 'number' || cfg.starting_cards < 0)) {
    issues.push(error('INVALID_STARTING_CARDS', 'starting_cards must be a non-negative number', 'config.starting_cards'));
  }

  // Validate deck if present
  if (cfg.deck !== undefined) {
    if (!Array.isArray(cfg.deck)) {
      issues.push(error('INVALID_DECK', 'deck must be an array', 'config.deck'));
    } else {
      validateDeck(cfg.deck, issues);
    }
  }

  // Validate board if present
  if (cfg.board !== undefined) {
    validateBoard(cfg.board as BoardConfig, issues);
  }

  // Validate mechanics references
  if (cfg.mechanics !== undefined) {
    if (!Array.isArray(cfg.mechanics)) {
      issues.push(error('INVALID_MECHANICS', 'mechanics must be an array of strings', 'config.mechanics'));
    } else {
      validateMechanicsReferences(cfg.mechanics, issues);
    }
  }

  // Validate engine_mechanics
  if (cfg.engine_mechanics !== undefined) {
    validateEngineMechanics(cfg.engine_mechanics as EngineMechanics, issues);
  }

  return issues.filter(i => i.severity === 'error').length === 0;
}

/**
 * Validate deck configuration.
 */
function validateDeck(deck: unknown[], issues: ValidationIssue[]): void {
  deck.forEach((card, index) => {
    const location = `config.deck[${index}]`;

    if (!card || typeof card !== 'object') {
      issues.push(error('INVALID_DECK_ITEM', `Deck item at index ${index} must be an object`, location));
      return;
    }

    const c = card as Record<string, unknown>;

    if (!c.name || typeof c.name !== 'string') {
      issues.push(error('MISSING_CARD_NAME', `Card at index ${index} is missing "name"`, `${location}.name`));
    }

    if (c.count === undefined || typeof c.count !== 'number' || c.count < 1) {
      issues.push(error('INVALID_CARD_COUNT', `Card "${c.name || index}" has invalid count`, `${location}.count`));
    }

    if (c.type !== undefined && typeof c.type !== 'string') {
      issues.push(error('INVALID_CARD_TYPE', `Card "${c.name || index}" has invalid type`, `${location}.type`));
    }

    if (c.effect !== undefined) {
      const effect = c.effect as Record<string, unknown>;
      if (!effect.type || typeof effect.type !== 'string') {
        issues.push(error('MISSING_EFFECT_TYPE', `Card "${c.name || index}" effect is missing "type"`, `${location}.effect.type`));
      } else if (!VALID_EFFECT_TYPES.includes(effect.type as string)) {
        issues.push(warning('UNKNOWN_EFFECT_TYPE', `Card "${c.name || index}" has unknown effect type "${effect.type}"`, `${location}.effect.type`));
      }
    }

    if (c.placeable !== undefined && typeof c.placeable !== 'boolean') {
      issues.push(error('INVALID_PLACEABLE', `Card "${c.name || index}" placeable must be boolean`, `${location}.placeable`));
    }

    if (c.targetMode !== undefined && !VALID_TARGET_MODES.includes(c.targetMode as string)) {
      issues.push(error('INVALID_TARGET_MODE', `Card "${c.name || index}" has invalid targetMode`, `${location}.targetMode`));
    }
  });
}

/**
 * Validate board configuration.
 */
function validateBoard(board: unknown, issues: ValidationIssue[]): void {
  if (!board || typeof board !== 'object') {
    issues.push(error('INVALID_BOARD', 'board must be an object', 'config.board'));
    return;
  }

  const b = board as Record<string, unknown>;

  if (!Array.isArray(b.states) || b.states.length === 0) {
    issues.push(error('MISSING_BOARD_STATES', 'board.states must be a non-empty array', 'config.board.states'));
    return;
  }

  const states = new Set(b.states as string[]);

  if (b.start !== undefined && !states.has(b.start as string)) {
    issues.push(error('INVALID_START_STATE', `board.start "${b.start}" is not in states array`, 'config.board.start'));
  }

  if (!Array.isArray(b.edges)) {
    issues.push(error('MISSING_BOARD_EDGES', 'board.edges must be an array', 'config.board.edges'));
    return;
  }

  b.edges.forEach((edge, index) => {
    const location = `config.board.edges[${index}]`;
    const e = edge as Record<string, unknown>;

    // Validate from
    const froms = Array.isArray(e.from) ? e.from : [e.from];
    froms.forEach((from: string) => {
      if (!states.has(from)) {
        issues.push(error('INVALID_EDGE_FROM', `Edge ${index} "from" state "${from}" not in states`, location));
      }
    });

    // Validate to
    const tos = Array.isArray(e.to) ? e.to : [e.to];
    tos.forEach((to: string) => {
      if (!states.has(to)) {
        issues.push(error('INVALID_EDGE_TO', `Edge ${index} "to" state "${to}" not in states`, location));
      }
    });

    // Validate probability
    if (e.probability !== undefined) {
      const prob = e.probability as number;
      if (typeof prob !== 'number' || prob < 0 || prob > 1) {
        issues.push(error('INVALID_PROBABILITY', `Edge ${index} probability must be between 0 and 1`, location));
      }
    }
  });
}

/**
 * Validate mechanics references against the mechanics index.
 */
function validateMechanicsReferences(mechanics: unknown[], issues: ValidationIssue[]): void {
  const index = loadMechanicsIndex();
  if (!index) {
    issues.push(warning('NO_MECHANICS_INDEX', 'Could not load mechanics index for validation', 'config.mechanics'));
    return;
  }

  const slugs = new Set(index.mechanics.map(m => m.slug));

  mechanics.forEach((mech, i) => {
    if (typeof mech !== 'string') {
      issues.push(error('INVALID_MECHANIC_REF', `Mechanic reference at index ${i} must be a string`, `config.mechanics[${i}]`));
      return;
    }

    if (!slugs.has(mech)) {
      issues.push(warning('UNKNOWN_MECHANIC', `Mechanic "${mech}" not found in mechanics index`, `config.mechanics[${i}]`, 'Check mechanics/index.json for valid slugs'));
    }
  });
}

/**
 * Validate engine_mechanics configuration.
 */
function validateEngineMechanics(mechanics: EngineMechanics, issues: ValidationIssue[]): void {
  const location = 'config.engine_mechanics';

  // action_points
  // Helper: skip validation for empty/no-config mechanic enablement (e.g., hand_management: true → {})
  const hasConfig = (m: unknown) => m !== undefined && typeof m === 'object' && m !== null && Object.keys(m as object).length > 0;

  if (mechanics.action_points && hasConfig(mechanics.action_points)) {
    const ap = mechanics.action_points;
    if (typeof ap.points_per_turn !== 'number' || ap.points_per_turn < 1) {
      issues.push(error('INVALID_ACTION_POINTS', 'action_points.points_per_turn must be a positive number', `${location}.action_points.points_per_turn`));
    }
    if (!ap.action_costs || typeof ap.action_costs !== 'object') {
      issues.push(error('MISSING_ACTION_COSTS', 'action_points.action_costs is required', `${location}.action_points.action_costs`));
    }
  }

  // grid
  if (mechanics.grid && hasConfig(mechanics.grid)) {
    const grid = mechanics.grid;
    if (!VALID_GRID_TYPES.includes(grid.type)) {
      issues.push(error('INVALID_GRID_TYPE', `grid.type must be one of: ${VALID_GRID_TYPES.join(', ')}`, `${location}.grid.type`));
    }
    if (!grid.starting_tile || typeof grid.starting_tile !== 'string') {
      issues.push(error('MISSING_STARTING_TILE', 'grid.starting_tile is required', `${location}.grid.starting_tile`));
    }
    if (!VALID_ADJACENCY_TYPES.includes(grid.adjacency)) {
      issues.push(error('INVALID_ADJACENCY', `grid.adjacency must be one of: ${VALID_ADJACENCY_TYPES.join(', ')}`, `${location}.grid.adjacency`));
    }
    if (grid.type === 'bounded' && !grid.bounds) {
      issues.push(error('MISSING_BOUNDS', 'grid.bounds is required for bounded grids', `${location}.grid.bounds`));
    }
  }

  // resources
  if (mechanics.resources !== undefined) {
    if (!Array.isArray(mechanics.resources)) {
      issues.push(error('INVALID_RESOURCES', 'resources must be an array', `${location}.resources`));
    } else {
      const names = new Set<string>();
      mechanics.resources.forEach((res, i) => {
        if (!res.name || typeof res.name !== 'string') {
          issues.push(error('MISSING_RESOURCE_NAME', `Resource at index ${i} is missing name`, `${location}.resources[${i}].name`));
        } else {
          if (names.has(res.name)) {
            issues.push(error('DUPLICATE_RESOURCE', `Duplicate resource name "${res.name}"`, `${location}.resources[${i}].name`));
          }
          names.add(res.name);
        }
        if (res.starting_amount === undefined || typeof res.starting_amount !== 'number') {
          issues.push(error('MISSING_STARTING_AMOUNT', `Resource "${res.name || i}" is missing starting_amount`, `${location}.resources[${i}].starting_amount`));
        }
      });
    }
  }

  // income
  if (mechanics.income && hasConfig(mechanics.income)) {
    if (!mechanics.income.per_turn || typeof mechanics.income.per_turn !== 'object') {
      issues.push(error('MISSING_INCOME_PER_TURN', 'income.per_turn is required', `${location}.income.per_turn`));
    }
  }

  // auction
  if (mechanics.auction && hasConfig(mechanics.auction)) {
    const auc = mechanics.auction;
    if (!VALID_AUCTION_TYPES.includes(auc.type)) {
      issues.push(error('INVALID_AUCTION_TYPE', `auction.type must be one of: ${VALID_AUCTION_TYPES.join(', ')}`, `${location}.auction.type`));
    }
    if (!auc.currency || typeof auc.currency !== 'string') {
      issues.push(error('MISSING_AUCTION_CURRENCY', 'auction.currency is required', `${location}.auction.currency`));
    }
  }

  // turn_order
  if (mechanics.turn_order && hasConfig(mechanics.turn_order)) {
    if (!VALID_TURN_ORDER_TYPES.includes(mechanics.turn_order.type)) {
      issues.push(error('INVALID_TURN_ORDER', `turn_order.type must be one of: ${VALID_TURN_ORDER_TYPES.join(', ')}`, `${location}.turn_order.type`));
    }
  }

  // set_collection (skip validation for empty/no-config enablement)
  if (mechanics.set_collection !== undefined && Object.keys(mechanics.set_collection).length > 0) {
    if (!Array.isArray(mechanics.set_collection.sets) || mechanics.set_collection.sets.length === 0) {
      issues.push(error('MISSING_SETS', 'set_collection.sets must be a non-empty array', `${location}.set_collection.sets`));
    }
    if (!VALID_SET_SCORING.includes(mechanics.set_collection.scoring)) {
      issues.push(error('INVALID_SET_SCORING', `set_collection.scoring must be one of: ${VALID_SET_SCORING.join(', ')}`, `${location}.set_collection.scoring`));
    }
  }

  // push_your_luck
  if (mechanics.push_your_luck && hasConfig(mechanics.push_your_luck)) {
    const pyl = mechanics.push_your_luck;
    if (typeof pyl.dice_sides !== 'number' || pyl.dice_sides < 2) {
      issues.push(error('INVALID_DICE_SIDES', 'push_your_luck.dice_sides must be >= 2', `${location}.push_your_luck.dice_sides`));
    }
    if (typeof pyl.bust_threshold !== 'number' || pyl.bust_threshold < 1) {
      issues.push(error('INVALID_BUST_THRESHOLD', 'push_your_luck.bust_threshold must be >= 1', `${location}.push_your_luck.bust_threshold`));
    }
    if (pyl.dice_sides && pyl.bust_threshold && pyl.bust_threshold >= pyl.dice_sides) {
      issues.push(error('BUST_TOO_HIGH', 'push_your_luck.bust_threshold must be less than dice_sides', `${location}.push_your_luck`));
    }
  }

  // variable_powers
  if (mechanics.variable_powers && hasConfig(mechanics.variable_powers)) {
    const vp = mechanics.variable_powers;
    if (!Array.isArray(vp.powers) || vp.powers.length === 0) {
      issues.push(error('MISSING_POWERS', 'variable_powers.powers must be a non-empty array', `${location}.variable_powers.powers`));
    }
    if (!VALID_POWER_ASSIGNMENTS.includes(vp.assignment)) {
      issues.push(error('INVALID_POWER_ASSIGNMENT', `variable_powers.assignment must be one of: ${VALID_POWER_ASSIGNMENTS.join(', ')}`, `${location}.variable_powers.assignment`));
    }
  }

  // hand_limit
  if (mechanics.hand_limit !== undefined) {
    if (typeof mechanics.hand_limit !== 'number' || mechanics.hand_limit < 1) {
      issues.push(error('INVALID_HAND_LIMIT', 'hand_limit must be a positive number', `${location}.hand_limit`));
    }
  }

  // hand_limit_policy
  if (mechanics.hand_limit_policy !== undefined) {
    if (!VALID_HAND_LIMIT_POLICIES.includes(mechanics.hand_limit_policy)) {
      issues.push(error('INVALID_HAND_LIMIT_POLICY', `hand_limit_policy must be one of: ${VALID_HAND_LIMIT_POLICIES.join(', ')}`, `${location}.hand_limit_policy`));
    }
  }

  // timeout_winner
  if (mechanics.timeout_winner && hasConfig(mechanics.timeout_winner)) {
    const tw = mechanics.timeout_winner;
    if (!VALID_TIMEOUT_WINNER_TYPES.includes(tw.type)) {
      issues.push(error('INVALID_TIMEOUT_WINNER', `timeout_winner.type must be one of: ${VALID_TIMEOUT_WINNER_TYPES.join(', ')}`, `${location}.timeout_winner.type`));
    }
    if (tw.type === 'role' && !tw.role && !tw.role_name) {
      issues.push(error('MISSING_TIMEOUT_ROLE', 'timeout_winner requires "role" or "role_name" when type is "role"', `${location}.timeout_winner`));
    }
  }

  // trade
  if (mechanics.trade && hasConfig(mechanics.trade)) {
    if (typeof mechanics.trade.enabled !== 'boolean') {
      issues.push(error('MISSING_TRADE_ENABLED', 'trade.enabled is required and must be boolean', `${location}.trade.enabled`));
    }
  }

  // cards (unified format: deck and starting_hand in engine_mechanics.cards)
  const cardsConfig = (mechanics as unknown as Record<string, unknown>).cards as { deck?: unknown[]; starting_hand?: number } | undefined;
  if (cardsConfig && hasConfig(cardsConfig)) {
    if (cardsConfig.deck !== undefined) {
      if (!Array.isArray(cardsConfig.deck)) {
        issues.push(error('INVALID_DECK', 'cards.deck must be an array', `${location}.cards.deck`));
      } else {
        validateDeckInMechanics(cardsConfig.deck, issues, `${location}.cards`);
      }
    }
    if (cardsConfig.starting_hand !== undefined && (typeof cardsConfig.starting_hand !== 'number' || cardsConfig.starting_hand < 0)) {
      issues.push(error('INVALID_STARTING_HAND', 'cards.starting_hand must be a non-negative number', `${location}.cards.starting_hand`));
    }
  }

  // board (unified format: in engine_mechanics.board)
  const boardConfig = (mechanics as unknown as Record<string, unknown>).board;
  if (boardConfig && hasConfig(boardConfig)) {
    validateBoardInMechanics(boardConfig as BoardConfig, issues, `${location}.board`);
  }
}

/**
 * Validate deck configuration within engine_mechanics.cards.
 */
function validateDeckInMechanics(deck: unknown[], issues: ValidationIssue[], prefix: string): void {
  deck.forEach((card, index) => {
    const location = `${prefix}.deck[${index}]`;

    if (!card || typeof card !== 'object') {
      issues.push(error('INVALID_DECK_ITEM', `Deck item at index ${index} must be an object`, location));
      return;
    }

    const c = card as Record<string, unknown>;

    if (!c.name || typeof c.name !== 'string') {
      issues.push(error('MISSING_CARD_NAME', `Card at index ${index} is missing "name"`, `${location}.name`));
    }

    if (c.count === undefined || typeof c.count !== 'number' || c.count < 1) {
      issues.push(error('INVALID_CARD_COUNT', `Card "${c.name || index}" has invalid count`, `${location}.count`));
    }

    if (c.type !== undefined && typeof c.type !== 'string') {
      issues.push(error('INVALID_CARD_TYPE', `Card "${c.name || index}" has invalid type`, `${location}.type`));
    }

    if (c.effect !== undefined) {
      const effect = c.effect as Record<string, unknown>;
      if (!effect.type || typeof effect.type !== 'string') {
        issues.push(error('MISSING_EFFECT_TYPE', `Card "${c.name || index}" effect is missing "type"`, `${location}.effect.type`));
      } else if (!VALID_EFFECT_TYPES.includes(effect.type as string)) {
        issues.push(warning('UNKNOWN_EFFECT_TYPE', `Card "${c.name || index}" has unknown effect type "${effect.type}"`, `${location}.effect.type`));
      }
    }

    if (c.placeable !== undefined && typeof c.placeable !== 'boolean') {
      issues.push(error('INVALID_PLACEABLE', `Card "${c.name || index}" placeable must be boolean`, `${location}.placeable`));
    }

    if (c.targetMode !== undefined && !VALID_TARGET_MODES.includes(c.targetMode as string)) {
      issues.push(error('INVALID_TARGET_MODE', `Card "${c.name || index}" has invalid targetMode`, `${location}.targetMode`));
    }
  });
}

/**
 * Validate board configuration within engine_mechanics.board.
 */
function validateBoardInMechanics(board: unknown, issues: ValidationIssue[], prefix: string): void {
  if (!board || typeof board !== 'object') {
    issues.push(error('INVALID_BOARD', 'board must be an object', prefix));
    return;
  }

  const b = board as Record<string, unknown>;

  if (!Array.isArray(b.states) || b.states.length === 0) {
    issues.push(error('MISSING_BOARD_STATES', 'board.states must be a non-empty array', `${prefix}.states`));
    return;
  }

  const states = new Set(b.states as string[]);

  if (b.start !== undefined && !states.has(b.start as string)) {
    issues.push(error('INVALID_START_STATE', `board.start "${b.start}" is not in states array`, `${prefix}.start`));
  }

  if (!Array.isArray(b.edges)) {
    issues.push(error('MISSING_BOARD_EDGES', 'board.edges must be an array', `${prefix}.edges`));
    return;
  }

  b.edges.forEach((edge, index) => {
    const location = `${prefix}.edges[${index}]`;
    const e = edge as Record<string, unknown>;

    const froms = Array.isArray(e.from) ? e.from : [e.from];
    froms.forEach((from: string) => {
      if (!states.has(from)) {
        issues.push(error('INVALID_EDGE_FROM', `Edge ${index} "from" state "${from}" not in states`, location));
      }
    });

    const tos = Array.isArray(e.to) ? e.to : [e.to];
    tos.forEach((to: string) => {
      if (!states.has(to)) {
        issues.push(error('INVALID_EDGE_TO', `Edge ${index} "to" state "${to}" not in states`, location));
      }
    });
  });
}

/**
 * Extract sections from markdown content.
 */
export function extractSections(markdown: string): ExtractedSections {
  const lines = markdown.split('\n');
  const allSections: Record<string, ExtractedSection> = {};
  const result: ExtractedSections = { allSections };

  let currentHeading: string | null = null;
  let currentLevel = 0;
  let currentStartLine = 0;
  let currentContent: string[] = [];

  const saveCurrentSection = (endLine: number) => {
    if (currentHeading) {
      const section: ExtractedSection = {
        heading: currentHeading,
        level: currentLevel,
        content: currentContent.join('\n').trim(),
        startLine: currentStartLine,
        endLine,
      };
      allSections[currentHeading] = section;

      // Map to standard section names
      for (const def of SECTION_DEFINITIONS) {
        for (const pattern of def.patterns) {
          if (pattern.test(currentHeading)) {
            (result as unknown as Record<string, unknown>)[def.name] = section.content;
            break;
          }
        }
      }
    }
  };

  lines.forEach((line, index) => {
    const headingMatch = line.match(/^(#{1,6})\s+(.+)$/);
    if (headingMatch) {
      // Save previous section
      saveCurrentSection(index);

      // Start new section
      currentLevel = headingMatch[1].length;
      currentHeading = headingMatch[2].trim();
      currentStartLine = index + 1;
      currentContent = [];
    } else {
      currentContent.push(line);
    }
  });

  // Save final section
  saveCurrentSection(lines.length);

  return result;
}

/**
 * Validate markdown sections.
 */
/**
 * Extract a readable example heading from a regex pattern.
 */
function getExampleHeading(pattern: RegExp): string {
  // Pattern like /^(Overview|Game Concept|...)$/i - extract first option
  const source = pattern.source;
  const match = source.match(/\(([^|)]+)/);
  return match ? match[1] : source;
}

function validateMarkdownSections(markdown: string, issues: ValidationIssue[]): ExtractedSections {
  const sections = extractSections(markdown);

  for (const def of SECTION_DEFINITIONS) {
    const found = def.patterns.some(pattern => {
      return Object.keys(sections.allSections).some(heading => pattern.test(heading));
    });

    if (!found) {
      const exampleHeading = getExampleHeading(def.patterns[0]);
      if (def.required) {
        issues.push(error(
          'MISSING_REQUIRED_SECTION',
          `Required section "${def.name}" is missing`,
          'markdown',
          `Add a heading like "## ${exampleHeading}"`
        ));
      } else {
        issues.push(warning(
          'MISSING_ADVISED_SECTION',
          `Advised section "${def.name}" is missing: ${def.description}`,
          'markdown',
          `Consider adding "## ${exampleHeading}"`
        ));
      }
    }
  }

  return sections;
}

/**
 * Main validation function.
 */
export function validateRules(rulesPath: string, options: { extractSections?: boolean } = {}): ValidationResult {
  const issues: ValidationIssue[] = [];

  // Check file exists
  if (!existsSync(rulesPath)) {
    return {
      valid: false,
      errors: [error('FILE_NOT_FOUND', `Rules file not found: ${rulesPath}`)],
      warnings: [],
    };
  }

  // Read file
  let content: string;
  try {
    content = readFileSync(rulesPath, 'utf-8');
  } catch (e) {
    return {
      valid: false,
      errors: [error('READ_ERROR', `Failed to read file: ${(e as Error).message}`)],
      warnings: [],
    };
  }

  // Extract YAML frontmatter
  const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!frontmatterMatch) {
    return {
      valid: false,
      errors: [error('INVALID_FORMAT', 'Missing YAML frontmatter (file must start with ---)')],
      warnings: [],
      markdown: content,
    };
  }

  const yamlContent = frontmatterMatch[1];
  const markdown = frontmatterMatch[2].trim();

  // Parse YAML
  let config: unknown;
  try {
    config = parseYAML(yamlContent);
  } catch (e) {
    return {
      valid: false,
      errors: [error('YAML_PARSE_ERROR', `Failed to parse YAML: ${(e as Error).message}`)],
      warnings: [],
      markdown,
    };
  }

  // Normalize unified format before validation
  // Unified format has mechanics as object (not array) - convert to internal format
  const cfg = config as Record<string, unknown>;
  if (cfg.mechanics && typeof cfg.mechanics === 'object' && !Array.isArray(cfg.mechanics)) {
    const mechanicsObj = cfg.mechanics as Record<string, unknown>;
    const engineMechanics: Record<string, unknown> = {};
    const mechanicsList: string[] = [];

    for (const [key, value] of Object.entries(mechanicsObj)) {
      if (key === 'cards') {
        const cardsConfig = value as Record<string, unknown>;
        if (cardsConfig.deck) cfg.deck = cardsConfig.deck;
        if (cardsConfig.starting_hand !== undefined) cfg.starting_cards = cardsConfig.starting_hand;
        continue;
      }
      if (key === 'board') {
        cfg.board = value;
        continue;
      }
      mechanicsList.push(key.replace(/_/g, '-'));
      const configKey = key.replace(/-/g, '_');
      if (value === true || value === null || (typeof value === 'object' && !Array.isArray(value) && Object.keys(value as object).length === 0)) {
        engineMechanics[configKey] = {};
      } else {
        engineMechanics[configKey] = value;
      }
    }
    cfg.mechanics = mechanicsList;
    cfg.engine_mechanics = engineMechanics;
  }

  // Validate config
  const configValid = validateConfig(config, issues);

  // Validate markdown sections
  const sections = validateMarkdownSections(markdown, issues);

  // Separate errors and warnings
  const errors = issues.filter(i => i.severity === 'error');
  const warnings = issues.filter(i => i.severity === 'warning');

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    config: configValid ? (config as GameConfig) : undefined,
    markdown,
    sections: options.extractSections ? sections : undefined,
  };
}

/**
 * Format validation result as human-readable text.
 */
export function formatValidationResult(result: ValidationResult, rulesPath: string): string {
  const lines: string[] = [];

  lines.push(`Validating ${rulesPath}...`);
  lines.push('');

  if (result.config) {
    lines.push(`\u2713 YAML frontmatter parsed`);
    lines.push(`\u2713 Game: ${result.config.name} v${result.config.version || '?'}`);

    if (result.config.deck) {
      const totalCards = result.config.deck.reduce((sum, c) => sum + (c.count || 0), 0);
      lines.push(`\u2713 Deck configuration valid (${totalCards} cards)`);
    }

    if (result.config.board) {
      lines.push(`\u2713 Board configuration valid (${result.config.board.states?.length || 0} states)`);
    }

    if (result.config.engine_mechanics) {
      const enabledMechanics = Object.keys(result.config.engine_mechanics).filter(
        k => (result.config!.engine_mechanics as Record<string, unknown>)[k]
      );
      if (enabledMechanics.length > 0) {
        lines.push(`\u2713 Engine mechanics: ${enabledMechanics.join(', ')}`);
      }
    }
  }

  if (result.errors.length > 0) {
    lines.push('');
    lines.push('Errors:');
    for (const err of result.errors) {
      lines.push(`  \u2717 [${err.code}] ${err.message}`);
      if (err.location) lines.push(`    Location: ${err.location}`);
      if (err.suggestion) lines.push(`    Suggestion: ${err.suggestion}`);
    }
  }

  if (result.warnings.length > 0) {
    lines.push('');
    lines.push('Warnings:');
    for (const warn of result.warnings) {
      lines.push(`  \u26A0 [${warn.code}] ${warn.message}`);
      if (warn.suggestion) lines.push(`    Suggestion: ${warn.suggestion}`);
    }
  }

  if (result.sections) {
    lines.push('');
    lines.push('Markdown Sections:');
    for (const def of SECTION_DEFINITIONS) {
      const content = (result.sections as unknown as Record<string, unknown>)[def.name] as string | undefined;
      if (content) {
        const section = Object.values(result.sections.allSections).find(s =>
          def.patterns.some(p => p.test(s.heading))
        );
        lines.push(`  \u2713 ${def.name} (line ${section?.startLine || '?'})`);
      } else if (def.required) {
        lines.push(`  \u2717 ${def.name} (MISSING - required)`);
      } else {
        lines.push(`  - ${def.name} (not found)`);
      }
    }
  }

  lines.push('');
  if (result.valid) {
    const suffix = result.warnings.length > 0 ? ` (${result.warnings.length} warning${result.warnings.length > 1 ? 's' : ''})` : '';
    lines.push(`Result: VALID${suffix}`);
  } else {
    lines.push(`Result: INVALID (${result.errors.length} error${result.errors.length > 1 ? 's' : ''})`);
  }

  return lines.join('\n');
}
