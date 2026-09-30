// Rules parser - extracts YAML frontmatter and markdown from RULES.md

import { readFileSync, existsSync } from '../shims/fs';
import { parse as parseYAML } from 'yaml';
import { join, dirname } from '../shims/path';
import { fileURLToPath } from '../shims/url';
import type { GameConfig, DeckConfig, Card, MechanicDef, MechanicsIndex } from '../types/game';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MECHANICS_DIR = join(__dirname, '../../mechanics');

export interface ParsedRules {
  config: GameConfig;
  markdown: string;
}

/**
 * Convert unified RULES.md format (single `mechanics:` object) to internal GameConfig.
 * Unified format: root has only metadata; `mechanics:` maps slug → config.
 * All mechanics (including cards and board) are stored uniformly in engine_mechanics.
 */
/** Config keys rules authors reach for that name an engine mechanic differently. */
const CONFIG_KEY_ALIASES: Record<string, string> = {
  timeout_winner: 'win_timeout',
};

/** `players: 3-5` arrives from YAML as the string "3-5"; the engine needs {min, max}. */
function parsePlayers(v: unknown): number | { min: number; max: number } {
  if (typeof v === 'number') return v;
  if (typeof v === 'string') {
    const m = /^\s*(\d+)\s*(?:-|–|to)\s*(\d+)\s*$/.exec(v);
    if (m) return { min: Number(m[1]), max: Number(m[2]) };
    if (/^\s*\d+\s*$/.test(v)) return Number(v);
  }
  return v as number | { min: number; max: number };
}

function normalizeUnifiedConfig(raw: Record<string, unknown>): GameConfig {
  const mechanicsObj = raw.mechanics as Record<string, unknown>;
  const engineMechanics: Record<string, unknown> = {};
  const mechanicsList: string[] = [];

  const config: Partial<GameConfig> & Record<string, unknown> = {
    name: raw.name as string,
    version: (raw.version as string) ?? '1.0',
    players: parsePlayers(raw.players),
    win_condition: raw.win_condition as string,
    max_rounds: raw.max_rounds as number ?? 50,
    max_turns: raw.max_turns as number | undefined,
  };

  for (const [rawKey, value] of Object.entries(mechanicsObj)) {
    // All mechanics (including cards and board) are treated uniformly
    const key = CONFIG_KEY_ALIASES[rawKey.replace(/-/g, '_')] ?? rawKey;
    const slug = key.replace(/_/g, '-');
    mechanicsList.push(slug);
    const configKey = key.replace(/-/g, '_');

    if (value === true || value === null || (typeof value === 'object' && !Array.isArray(value) && Object.keys(value as object).length === 0)) {
      // No-config mechanic: store empty object so code can safely access properties
      engineMechanics[configKey] = {};
    } else {
      engineMechanics[configKey] = value;
    }
  }

  config.mechanics = mechanicsList;
  config.engine_mechanics = engineMechanics as GameConfig['engine_mechanics'];

  // Pass through any other root-level keys (e.g., player_cards, objectives)
  for (const [key, value] of Object.entries(raw)) {
    if (!['name', 'version', 'players', 'win_condition', 'max_rounds', 'max_turns', 'mechanics'].includes(key)) {
      config[key] = value;
    }
  }

  return config as GameConfig;
}

export function parseRules(rulesPath: string): ParsedRules {
  const content = readFileSync(rulesPath, 'utf-8');

  // Extract YAML frontmatter
  const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);

  if (!frontmatterMatch) {
    throw new Error(`Invalid RULES.md format: missing YAML frontmatter in ${rulesPath}`);
  }

  const yamlContent = frontmatterMatch[1];
  const markdown = frontmatterMatch[2].trim();

  let raw: Record<string, unknown>;
  try {
    raw = parseYAML(yamlContent) as Record<string, unknown>;
  } catch (e) {
    throw new Error(`Failed to parse YAML frontmatter: ${e}`);
  }

  // Detect unified format: mechanics is an object (not an array)
  const mechanics = raw.mechanics;
  const isUnifiedFormat = mechanics && typeof mechanics === 'object' && !Array.isArray(mechanics);

  let config: GameConfig;
  if (isUnifiedFormat) {
    config = normalizeUnifiedConfig(raw);
  } else {
    config = raw as GameConfig;
  }

  // Validate required fields
  if (!config.name) throw new Error('RULES.md missing required field: name');
  if (!config.win_condition) throw new Error('RULES.md missing required field: win_condition');

  // Set defaults
  config.max_rounds = config.max_rounds ?? 50;
  config.starting_cards = config.starting_cards ?? 0;

  return { config, markdown };
}

export function buildDeck(deckConfig: DeckConfig[]): Card[] {
  const deck: Card[] = [];

  for (const cardDef of deckConfig) {
    for (let i = 0; i < cardDef.count; i++) {
      // Keep every declared field (terrain, subtype, requires, …): mechanics read them off
      // the dealt card, and dropping them made rules like "Lantern for caves" unenforceable.
      const { count: _count, ...fields } = cardDef as DeckConfig & Record<string, unknown>;
      const card: Card = {
        ...(fields as Partial<Card>),
        name: cardDef.name,
        type: cardDef.type ?? 'standard',
        effect: cardDef.effect ?? { type: 'none' }
      } as Card;

      // Add placeable card properties if defined
      if (cardDef.placeable) {
        card.placeable = true;
        card.targetMode = cardDef.targetMode ?? 'opponents';  // Default to affecting opponents
      }

      deck.push(card);
    }
  }

  return deck;
}

export function shuffleDeck<T>(deck: T[]): T[] {
  const shuffled = [...deck];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

export function getPlayerCount(config: GameConfig): { min: number; max: number } {
  if (typeof config.players === 'number') {
    return { min: config.players, max: config.players };
  }
  return config.players;
}

// Look up card definition from config by name
export function getCardDefinition(config: GameConfig, cardName: string): DeckConfig | null {
  // Unified format: engine_mechanics.cards.deck, fallback to legacy config.deck
  const cardsConfig = config.engine_mechanics?.cards as { deck?: DeckConfig[] } | undefined;
  const deckConfig = cardsConfig?.deck ?? config.deck;
  if (!deckConfig) return null;
  return deckConfig.find(c => c.name === cardName) ?? null;
}

// ============ Mechanics Functions ============

let mechanicsIndexCache: MechanicsIndex | null = null;

// Registered mechanics cache for implementation status
interface RegisteredMechanicsRegistry {
  mechanics: Record<string, {
    config_key: string;
    since: string;
    description?: string;
    hooks?: string[];
  }>;
  partial?: Record<string, {
    notes: string;
    related_config?: string;
  }>;
}

let registeredMechanicsCache: RegisteredMechanicsRegistry | null = null;

function loadRegisteredMechanics(): RegisteredMechanicsRegistry {
  if (registeredMechanicsCache) return registeredMechanicsCache;

  const registryPath = join(__dirname, '../../shared/registered-mechanics.json');
  if (!existsSync(registryPath)) {
    registeredMechanicsCache = { mechanics: {} };
    return registeredMechanicsCache;
  }

  registeredMechanicsCache = JSON.parse(readFileSync(registryPath, 'utf-8'));
  return registeredMechanicsCache!;
}

export interface MechanicImplementationStatus {
  status: 'implemented' | 'partial' | 'not_implemented';
  configKey?: string;
  since?: string;
  description?: string;
  notes?: string;
}

export function getMechanicImplementationStatus(slug: string): MechanicImplementationStatus {
  const registry = loadRegisteredMechanics();

  if (registry.mechanics[slug]) {
    const impl = registry.mechanics[slug];
    return {
      status: 'implemented',
      configKey: impl.config_key,
      since: impl.since,
      description: impl.description
    };
  }

  if (registry.partial && registry.partial[slug]) {
    const impl = registry.partial[slug];
    return {
      status: 'partial',
      notes: impl.notes
    };
  }

  return { status: 'not_implemented' };
}

export function loadMechanicsIndex(): MechanicsIndex {
  if (mechanicsIndexCache) return mechanicsIndexCache;

  const indexPath = join(MECHANICS_DIR, 'index.json');
  if (!existsSync(indexPath)) {
    throw new Error(`Mechanics index not found at ${indexPath}`);
  }

  mechanicsIndexCache = JSON.parse(readFileSync(indexPath, 'utf-8'));
  return mechanicsIndexCache!;
}

export function getMechanicBySlug(slug: string): MechanicDef | null {
  const index = loadMechanicsIndex();
  return index.mechanics.find(m => m.slug === slug) ?? null;
}

export function getMechanicById(id: string): MechanicDef | null {
  const index = loadMechanicsIndex();
  return index.mechanics.find(m => m.id === id) ?? null;
}

export function getMechanicByName(name: string): MechanicDef | null {
  const index = loadMechanicsIndex();
  const lower = name.toLowerCase();
  return index.mechanics.find(m => m.name.toLowerCase() === lower) ?? null;
}

export function searchMechanics(query: string): MechanicDef[] {
  const index = loadMechanicsIndex();
  const lower = query.toLowerCase();
  return index.mechanics.filter(m =>
    m.name.toLowerCase().includes(lower) ||
    m.slug.includes(lower) ||
    m.category.includes(lower)
  );
}

export function getMechanicsByCategory(category: string): MechanicDef[] {
  const index = loadMechanicsIndex();
  return index.mechanics.filter(m => m.category === category);
}

export function getMechanicMarkdown(slug: string): string | null {
  const mechanic = getMechanicBySlug(slug);
  if (!mechanic) return null;

  const mdPath = join(MECHANICS_DIR, mechanic.path);
  if (!existsSync(mdPath)) return null;

  return readFileSync(mdPath, 'utf-8');
}

export function resolveMechanics(slugs: string[]): { resolved: MechanicDef[]; unknown: string[] } {
  const resolved: MechanicDef[] = [];
  const unknown: string[] = [];

  for (const slug of slugs) {
    const mech = getMechanicBySlug(slug);
    if (mech) {
      resolved.push(mech);
    } else {
      unknown.push(slug);
    }
  }

  return { resolved, unknown };
}

export function listCategories(): string[] {
  const index = loadMechanicsIndex();
  return index.categories;
}
