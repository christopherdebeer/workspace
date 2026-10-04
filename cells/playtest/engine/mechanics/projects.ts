/**
 * Projects — a personal table of project cards, each worked toward with tokens.
 *
 * A project is played from the hand face up (open) or, if the rules allow, face down
 * (stealth: everyone sees that a hidden project exists and how many tokens it has, not what
 * it is). Tokens are added by its owner (progress) or, on an open project, by anyone else
 * (cooperate, which pays the helper). At `needs` tokens a project completes and scores its
 * `value`; a completing stealth project turns face up. Open projects can be sabotaged (all
 * tokens cleared); a stealth project can be exposed (turned face up for everyone).
 *
 * Card fields: { name, type: "project", kind, needs, value, stealth_only?, only_role? }
 *   kind        — what objectives count ("research"); any player may complete any kind
 *   stealth_only — may only be played face down
 *   only_role   — only a player of this team may add tokens to it (others can play it as a decoy)
 *
 * Config (engine_mechanics.projects):
 *   stealth: true            # may play face down
 *   needs_default: 2  value_default: 2
 *   cooperate_reward: 1      # points to the helper
 *   completion_reveals: true # a completing stealth project turns face up
 *   max_open: 6              # table size
 *   expose_min_tokens: 0     # a hidden project can be exposed only once it carries this many tokens
 *   expose: "action"         # or "card": no standing expose action — only an event card with
 *                            # effect expose_project (event-effects) turns a hidden project face up
 *
 * Actions: play_project {card, stealth?} · progress {project} · cooperate {target, project}
 *          · sabotage {target, project} · expose {target, project: "hidden #k"}
 * AP costs come from action_points.action_costs.
 *
 * State: player.projects: Project[]; shared.publicKnowledge: string[] (exposures and
 * completions of hidden projects, for everyone — the runner reports them to the judge).
 */
import { MechanicHooks, HookContext, ValidationResult, ActionExecutionContext, ActionExecutionResult, AvailableAction, PlayerInitContext, PlayerInitResult } from './types';
import type { GameAction, Card, PlayerState, GameState } from '../types/game';
import { removeCardsFromHand } from './core/hand';
import { canAfford } from './action-points';

export interface Project {
  id: string;
  name: string;
  kind?: string;
  needs: number;
  value: number;
  stealth: boolean;
  tokens: number;
  done: boolean;
  onlyRole?: string;
}

interface ProjectsConfig {
  stealth?: boolean;
  needs_default?: number;
  value_default?: number;
  cooperate_reward?: number;
  completion_reveals?: boolean;
  max_open?: number;
  expose_min_tokens?: number;
  expose?: 'action' | 'card';
}

type ProjectCard = Card & { kind?: string; needs?: number; value?: number; stealth_only?: boolean; only_role?: string };
type P = PlayerState & { projects?: Project[]; team?: string; knowledge?: { revealed?: Record<string, unknown> } };

const cfgOf = (ctx: { config: { engine_mechanics?: Record<string, unknown> } }) => ctx.config.engine_mechanics?.projects as ProjectsConfig | undefined;
export const projectsOf = (p: PlayerState | undefined): Project[] => {
  const pl = p as P | undefined;
  if (!pl) return [];
  return (pl.projects ??= []);
};
const hand = (s: GameState, p: string) => (s.players[p]?.hand ?? []) as ProjectCard[];

/** How `viewer` refers to one of `owner`'s projects: by name when open, "hidden #k" when not. */
export function projectRef(owner: P, project: Project, viewer: string, ownerId: string): string {
  if (!project.stealth || viewer === ownerId) return project.id;
  const hidden = projectsOf(owner).filter((p) => p.stealth);
  return `hidden #${hidden.indexOf(project) + 1}`;
}

function findProject(owner: P, ownerId: string, ref: string, viewer: string): Project | undefined {
  const list = projectsOf(owner);
  const m = /^hidden #(\d+)$/.exec(ref);
  if (m) return list.filter((p) => p.stealth)[Number(m[1]) - 1];
  const p = list.find((x) => x.id === ref);
  return p && (!p.stealth || viewer === ownerId) ? p : undefined;
}

function publish(state: GameState, line: string) {
  const shared = state.shared as Record<string, unknown>;
  ((shared.publicKnowledge ??= []) as string[]).push(line);
}

/** Turn `target`'s most advanced hidden project (≥ expose_min_tokens) face up for everyone, by `by`
 *  (the expose action, or an event card with effect expose_project). Returns what was exposed. */
export function exposeProject(state: GameState, config: { engine_mechanics?: Record<string, unknown> }, by: string, target: string): Project | null {
  const cfg = config.engine_mechanics?.projects as ProjectsConfig | undefined;
  const hidden = projectsOf(state.players[target] as P).filter((p) => p.stealth && p.tokens >= (cfg?.expose_min_tokens ?? 0)).sort((a, b) => b.tokens - a.tokens);
  const p = hidden[0];
  if (!p) return null;
  p.stealth = false;
  const me = state.players[by] as P;
  const k = (me.knowledge ??= {});
  (k.revealed ??= {})[`${target} project`] = p.name;
  publish(state, `${target}'s hidden project is ${p.name} (${p.tokens}/${p.needs}), exposed by ${by}`);
  return p;
}

/** Add tokens; complete and score at `needs`. Returns what happened, for the log. */
function addTokens(state: GameState, ownerId: string, project: Project, n: number, cfg: ProjectsConfig | undefined): string {
  project.tokens += n;
  if (project.tokens < project.needs || project.done) return `${project.tokens}/${project.needs}`;
  project.done = true;
  const owner = state.players[ownerId];
  owner.score = (owner.score ?? 0) + project.value;
  const wasStealth = project.stealth;
  if (wasStealth && (cfg?.completion_reveals ?? true)) {
    project.stealth = false;
    publish(state, `${ownerId}'s hidden project was ${project.name}: completed for ${project.value} points`);
  }
  return `completed (+${project.value})`;
}

export const projectsMechanic: MechanicHooks = {
  slug: 'projects',
  name: 'Projects',
  requires: ['cards'],

  configSchema: {
    type: 'object',
    description: 'Project cards on the table, worked toward with tokens; face up or in stealth',
    properties: {
      stealth: { type: 'boolean', description: 'Projects may be played face down', default: true },
      needs_default: { type: 'number', default: 2 },
      value_default: { type: 'number', default: 2 },
      cooperate_reward: { type: 'number', description: 'Points to a player who adds a token to another player’s open project', default: 1 },
      completion_reveals: { type: 'boolean', default: true },
      max_open: { type: 'number', default: 6 },
      expose_min_tokens: { type: 'number', description: 'A hidden project can be exposed only once it carries this many tokens', default: 0 },
      expose: { type: 'string', enum: ['action', 'card'], description: '"card": exposing needs an event card (effect expose_project), there is no standing action', default: 'action' },
    },
  },

  initPlayerState(_ctx: PlayerInitContext): PlayerInitResult | null {
    return { projects: [] } as unknown as PlayerInitResult;
  },

  getActionSchema(action: GameAction) {
    switch (action.type as string) {
      case 'play_project': return { required: ['card'], fields: { card: { type: 'string' }, stealth: { type: 'boolean' } } };
      case 'progress': return { required: ['project'], fields: { project: { type: 'string' } } };
      case 'cooperate': case 'sabotage': case 'expose': return { required: ['target', 'project'], fields: { target: { type: 'string' }, project: { type: 'string' } } };
    }
    return null;
  },

  getAvailableActions(ctx: HookContext): AvailableAction[] {
    const cfg = cfgOf(ctx);
    if (!cfg) return [];
    const { state, playerId } = ctx;
    const me = state.players[playerId] as P;
    const out: AvailableAction[] = [];
    const mine = projectsOf(me);
    const cards = hand(state, playerId).filter((c) => c.type === 'project');
    if (cards.length && mine.length < (cfg.max_open ?? 6)) {
      const examples: GameAction[] = [];
      for (const c of [...new Map(cards.map((c) => [c.name, c])).values()]) {
        if (!c.stealth_only) examples.push({ type: 'play_project', card: c.name } as unknown as GameAction);
        if (cfg.stealth) examples.push({ type: 'play_project', card: c.name, stealth: true } as unknown as GameAction);
      }
      if (examples.length) out.push({ action: examples[0], priority: 30, category: 'projects', description: 'Play a project card to your table, face up or in stealth', required: { card: 'A project card in your hand' }, optional: { stealth: 'true: face down' }, examples });
    }
    const workable = mine.filter((p) => !p.done && (!p.onlyRole || me.team === p.onlyRole));
    // `hidden: true` marks a move on a stealth project: the other players see it without the name.
    const prog = (p: Project) => ({ type: 'progress', project: p.id, ...(p.stealth ? { hidden: true } : {}) }) as unknown as GameAction;
    if (workable.length) out.push({ action: prog(workable[0]), priority: 29, category: 'projects', description: 'Add a token to one of your projects', required: { project: 'One of your unfinished projects' }, examples: workable.map(prog) });
    const coop: GameAction[] = [];
    const sab: GameAction[] = [];
    const exp: GameAction[] = [];
    for (const other of state.turnOrder.filter((p) => p !== playerId)) {
      const them = state.players[other] as P;
      for (const p of projectsOf(them)) {
        if (p.done) continue;
        if (!p.stealth) {
          coop.push({ type: 'cooperate', target: other, project: p.id } as unknown as GameAction);
          if (p.tokens > 0) sab.push({ type: 'sabotage', target: other, project: p.id } as unknown as GameAction);
        } else if (p.tokens >= (cfg.expose_min_tokens ?? 0)) exp.push({ type: 'expose', target: other, project: projectRef(them, p, playerId, other) } as unknown as GameAction);
      }
    }
    if (coop.length) out.push({ action: coop[0], priority: 20, category: 'projects', description: `Add a token to another player's open project (you score ${cfg.cooperate_reward ?? 1})`, required: { target: 'Player', project: 'Their open project' }, examples: coop });
    if (sab.length) out.push({ action: sab[0], priority: 15, category: 'projects', description: "Clear every token from another player's open project", required: { target: 'Player', project: 'Their open project with tokens' }, examples: sab });
    if (exp.length && cfg.expose !== 'card') out.push({ action: exp[0], priority: 18, category: 'projects', description: "Turn another player's hidden project face up for everyone", required: { target: 'Player', project: 'hidden #k' }, examples: exp });
    // Only what the player can pay for now (sabotage and expose usually cost more than one action).
    return out.filter((a) => canAfford(ctx, a.action));
  },

  preValidateAction(ctx: HookContext, action: GameAction): ValidationResult | null {
    const cfg = cfgOf(ctx);
    const t = action.type as string;
    if (!['play_project', 'progress', 'cooperate', 'sabotage', 'expose'].includes(t)) return null;
    if (!cfg) return { valid: false, error: 'Projects are not part of this game.' };
    const { state, playerId } = ctx;
    const me = state.players[playerId] as P;
    const a = action as unknown as { card?: string; stealth?: boolean; project?: string; target?: string };
    if (t === 'play_project') {
      const card = hand(state, playerId).find((c) => c.name === a.card && c.type === 'project');
      if (!card) return { valid: false, error: `No project card "${a.card}" in your hand.` };
      if (a.stealth && !cfg.stealth) return { valid: false, error: 'Projects cannot be played in stealth in this game.' };
      if (card.stealth_only && !a.stealth) return { valid: false, error: `${card.name} can only be played in stealth.` };
      if (projectsOf(me).length >= (cfg.max_open ?? 6)) return { valid: false, error: 'Your table is full.' };
      return { valid: true };
    }
    if (t === 'progress') {
      const p = findProject(me, playerId, String(a.project), playerId);
      if (!p) return { valid: false, error: `You have no project "${a.project}".` };
      if (p.done) return { valid: false, error: `${p.id} is already complete.` };
      if (p.onlyRole && me.team !== p.onlyRole) return { valid: false, error: `Only an agent of the Enemy can make use of ${p.name}.` };
      return { valid: true };
    }
    const target = a.target ?? '';
    const them = state.players[target] as P | undefined;
    if (!them || target === playerId) return { valid: false, error: 'Name another player.' };
    const p = findProject(them, target, String(a.project), playerId);
    if (!p) return { valid: false, error: `${target} has no project "${a.project}".` };
    if (p.done) return { valid: false, error: `${target}'s ${a.project} is already complete.` };
    if (t === 'cooperate' && p.stealth) return { valid: false, error: 'You cannot help with a project you cannot see.' };
    if (t === 'sabotage' && p.stealth) return { valid: false, error: 'A hidden project cannot be sabotaged until it is exposed.' };
    if (t === 'sabotage' && p.tokens === 0) return { valid: false, error: `${target}'s ${p.id} has no tokens to clear.` };
    if (t === 'expose' && cfg.expose === 'card') return { valid: false, error: 'Exposing a hidden project takes a card in this game.' };
    if (t === 'expose' && !p.stealth) return { valid: false, error: `${target}'s ${p.id} is already face up.` };
    if (t === 'expose' && p.tokens < (cfg.expose_min_tokens ?? 0)) return { valid: false, error: `A hidden project can be exposed only once it carries ${cfg.expose_min_tokens} tokens (this one has ${p.tokens}).` };
    return { valid: true };
  },

  onExecuteAction(ctx: ActionExecutionContext): ActionExecutionResult | null {
    const cfg = cfgOf(ctx);
    const t = ctx.action.type as string;
    if (!cfg || !['play_project', 'progress', 'cooperate', 'sabotage', 'expose'].includes(t)) return null;
    const { state, playerId } = ctx;
    const me = state.players[playerId] as P;
    const a = ctx.action as unknown as { card?: string; stealth?: boolean; project?: string; target?: string };
    const base = { handled: true, advanceTurn: false, checkWin: true };
    if (t === 'play_project') {
      const [card] = removeCardsFromHand(state, playerId, [String(a.card)]) as ProjectCard[];
      if (!card) return null;
      const list = projectsOf(me);
      let id = card.name;
      for (let k = 2; list.some((p) => p.id === id); k++) id = `${card.name} #${k}`;
      const project: Project = { id, name: card.name, kind: card.kind, needs: Number(card.needs ?? cfg.needs_default ?? 2), value: Number(card.value ?? cfg.value_default ?? 2), stealth: !!a.stealth, tokens: 0, done: false, ...(card.only_role ? { onlyRole: card.only_role } : {}) };
      list.push(project);
      return { ...base, logMessage: a.stealth ? 'project_played_stealth' : 'project_played', logData: { player: playerId, card: a.stealth ? '(hidden)' : card.name, stealth: !!a.stealth } };
    }
    if (t === 'progress') {
      const p = findProject(me, playerId, String(a.project), playerId)!;
      const what = addTokens(state, playerId, p, 1, cfg);
      return { ...base, logMessage: 'progress', logData: { player: playerId, project: p.stealth ? '(hidden)' : p.id, tokens: what } };
    }
    const target = String(a.target);
    const them = state.players[target] as P;
    const p = findProject(them, target, String(a.project), playerId)!;
    if (t === 'cooperate') {
      const what = addTokens(state, target, p, 1, cfg);
      me.score = (me.score ?? 0) + (cfg.cooperate_reward ?? 1);
      return { ...base, logMessage: 'cooperate', logData: { player: playerId, target, project: p.id, tokens: what } };
    }
    if (t === 'sabotage') {
      const cleared = p.tokens;
      p.tokens = 0;
      return { ...base, logMessage: 'sabotage', logData: { player: playerId, target, project: p.id, cleared } };
    }
    // expose
    p.stealth = false;
    const k = (me.knowledge ??= {});
    (k.revealed ??= {})[`${target} project`] = p.name;
    publish(state, `${target}'s hidden project is ${p.name} (${p.tokens}/${p.needs}), exposed by ${playerId}`);
    return { ...base, logMessage: 'expose', logData: { player: playerId, target, project: p.name } };
  },

  describeAction(action: GameAction) {
    const a = action as unknown as { card?: string; stealth?: boolean; project?: string; target?: string };
    const t = action.type as string;
    const d = (label: string, description: string) => ({ type: t, label, description });
    switch (t) {
      case 'play_project': return a.stealth ? d('Play a project in stealth', 'Face down: others see a hidden project') : d(`Play ${a.card}`, 'Face up on your table');
      case 'progress': return d(`Progress ${a.project}`, 'Add a token');
      case 'cooperate': return d(`Help ${a.target} with ${a.project}`, 'Add a token to their open project; you score for the favour');
      case 'sabotage': return d(`Sabotage ${a.target}'s ${a.project}`, 'Clear its tokens');
      case 'expose': return d(`Expose ${a.target}'s ${a.project}`, 'Turn it face up for everyone');
    }
    return null;
  },

  /** Your table in full; everyone else's with hidden projects as "hidden #k (tokens)". */
  getPlayerView(ctx: HookContext): Record<string, unknown> | null {
    if (!cfgOf(ctx)) return null;
    const { state, playerId } = ctx;
    const me = state.players[playerId] as P;
    const line = (p: Project, owner: P, ownerId: string) => {
      const ref = projectRef(owner, p, playerId, ownerId);
      if (ref.startsWith('hidden')) return `${ref}: ${p.tokens} token${p.tokens === 1 ? '' : 's'}`;
      return `${p.id}${p.stealth ? ' (stealth)' : ''}: ${p.done ? `done, ${p.value} pts` : `${p.tokens}/${p.needs}`}${p.kind ? ` [${p.kind}]` : ''}`;
    };
    const others: Record<string, string[]> = {};
    for (const o of state.turnOrder.filter((p) => p !== playerId)) others[o] = projectsOf(state.players[o] as P).map((p) => line(p, state.players[o] as P, o));
    const shared = state.shared as Record<string, unknown>;
    const pub = (shared.publicKnowledge as string[] | undefined) ?? [];
    return {
      yourProjects: projectsOf(me).map((p) => line(p, me, playerId)),
      // Token-by-token progress on your own unfinished projects (the harness shows changes as facts).
      progress: projectsOf(me).filter((p) => !p.done).map((p) => `${p.id}: ${p.tokens}/${p.needs}`),
      othersProjects: others,
      ...(pub.length ? { publicKnowledge: pub.slice(-8) } : {}),
    };
  },
};
