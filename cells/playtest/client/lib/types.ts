/* Shapes of the public API (lib/public.ts on the server). */
export interface Change { at: string; kind: 'deploy' | 'engine' | 'definition' | 'round' | 'eval'; title: string; detail?: string; game?: string; ref?: string; outcome?: string }
export interface Climb { rounds: number; stall: number; status: 'idle' | 'climbing' | 'stalled' }
export interface GameRow {
  slug: string; name: string; head: number; versions: number; best?: number; climb?: Climb; updatedAt: string;
  evals: number; kept: number; reverted: number;
  latest: { train: number; test: number; version: number; engine: string; at: string } | null;
  bestTrain: { train: number; test: number; version: number } | null;
}
export interface Overview {
  cell: string; scoreVersion: string;
  engine: { version: string; mechanics: number; vendoredFrom: { commit?: string; repo?: string; [k: string]: unknown } };
  totals: { games: number; evals: number; runs: number; rounds: number; kept: number; reverted: number; jevTokens: number; usd: number };
  games: GameRow[]; presets: string[]; recent: Change[];
}
export interface Declared { mechanics: string[]; effects: string[]; unhandledEffects: string[]; name: string; error?: string }
export interface EvalSummary { id: string; version: number; engine: string; suite: string; scoreVersion: string; train: number; test: number; tag: string; createdAt: string }
export interface Round {
  round: number; from: number; to: number; rationale: string; author: string;
  baseline: { evalId: string; train: number; test: number }; candidate: { evalId: string; train: number; test: number };
  delta: { train: number; test: number }; epsilon: number; decision: 'kept' | 'reverted'; reason: string; engine: string; createdAt: string;
}
export interface Suite { train: { seeds: number[]; players: number[] }; test: { seeds: number[]; players: number[] }; maxSteps: number; epsilon: number; noise?: number; hash: string }
export interface Version { version: number; parent: number | null; status: string; rationale: string; author: string; hash: string; createdAt: string }
export interface GameView {
  game: GameRow; engine: string; suite: Suite; versions: Version[]; evals: EvalSummary[]; rounds: Round[];
  head: { version: number; rules: string; rationale: string; status: string; hash: string; createdAt: string; declared: Declared } | null;
}
export interface Finding { kind: string; severity: 'info' | 'warn' | 'error'; subject: string; detail: string }
export interface Parts { ended: number; variety: number; agency: number; length: number; clean: number; judged: number; critique?: number }
export interface Critique { dims: Record<string, number | null>; index: number | null; weakest: Array<[string, number]>; strongest: Array<[string, number]>; fixes: Array<[string, number]> }
export interface CritiqueSummary { n: number; index: number | null; dims: Record<string, number>; weakest: Array<[string, number]>; strongest: Array<[string, number]>; fixes: Array<[string, number]> }
export interface Scoring { version: string; weights: Record<string, number>; critique: Array<{ key: string; name: string; ask: string; levels: string[] }>; fixes: string[] }
export interface RunDigest { id: string; split: 'train' | 'test'; seed: number; players: number; score: number; parts?: Parts; stopped?: string; endReason?: string | null; steps?: number; rounds?: number; verdict?: string | null; findings?: string[]; critique?: Critique | null }
export interface EvalView {
  id: string; game: string; version: number; engine: string; suite: string; scoreVersion: string;
  train: { score: number; runs: RunDigest[]; critique?: CritiqueSummary | null }; test: { score: number; n: number };
  definitionHealth: number; classificationFindings: Finding[]; tokens: number; usd: number; ms: number; tag: string; createdAt: string;
}
export interface Turn { step: number; round: number; turn: number; player: string; valid: number; forced: boolean; move: string; confidence: number | null; runnerUp: [string, number] | null; ahead: number | null; fallback?: string }
export interface RunView extends Omit<RunDigest, 'findings'> {
  heldOut?: boolean; game?: string; version?: number; engine?: string; createdAt?: string;
  metrics?: Record<string, any>; judgement?: { health: { verdict: string | null; confidence: number | null; probabilities: Record<string, number> }; decisive: number | null; agency: number | null; pacing: number | null; endedByRule: number | null; runaway: number | null; critique?: Critique };
  findings?: Finding[] | string[]; turns?: Turn[]; totalTurns?: number;
}
export interface Mechanic {
  slug: string; name: string; category: string; source: string; status: 'implemented' | 'partial' | 'engine-flag' | 'not-implemented';
  description: string | null; requires: string[]; hooks: string[]; configKey: string | null; hash: string | null;
  changedIn: Array<{ engine: string; at: string }>; games: string[]; presets: string[];
  backlog: Array<{ kind: string; hits: number; severity: string; detail: string }>;
}
export interface BacklogItem { kind: string; subject: string; severity: string; detail: string; hits: number; games: string[]; firstSeen: string; lastSeen: string; engine: string }
export interface MechanicsView {
  engine: { version: string; core: string; vendoredFrom: Record<string, unknown> };
  counts: Record<string, number>; categories: string[]; mechanics: Mechanic[];
  effects: Array<{ type: string; presets: string[]; handled: boolean }>; backlog: BacklogItem[];
}
export interface Preset extends Declared { slug: string }
export interface ToolInfo { name: string; kind: string; description: string }
