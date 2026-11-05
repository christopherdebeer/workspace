/**
 * The shape of the record: a hand, a sample's entry, a session, and a session's file (sessions/NN.ts).
 */
import type { Sig } from '../switchback/sign';

/** every hand, in the order they were made (each session that makes one adds it here) */
export type HandId = 'scribble' | 'v0' | 'v1' | 'v2' | 'v3' | 'v4' | 'v5' | 'v6' | 'v7' | 'v8' | 'v9' | 'v10' | 'v11' | 'v12' | 'v13' | 'v14' | 'v15' | 'v16' | 'v17' | 'v18' | 'v19' | 'v20' | 'v21' | 'v22' | 'v23' | 'v24' | 'v25' | 'v26' | 'v27' | 'font';
export type Hand = { name: string; made: string; about: string };

export type Entry = {
  id: string; session: number; title: string; hand: HandId;
  /** what it says, if it says anything */
  text?: string;
  /** several writings: one under another, or laid on top of each other (the examiner's way of comparing) */
  layout?: 'rows' | 'overlay' | 'page';
  /** (from session 4) text set in the font rather than written by a hand: lines, each at a size (px), joins on unless
   * `calt` is false; (from session 12) a line with a `way` is marked text (as the hand reads it, see typeset.ts), set as
   * the web sets it, the font and its stylesheet, or as any app does, the font alone; (from session 27) a line `at` a
   * place on the variable font's axes, its pace (wght) and its wear (WEAR); (from session 31) a line set `time` is set as
   * the web sets it and written in the hand's time by its script (claude-hand-time-3.1.js) when it's seen; (from session
   * 32) by the `script` version named, 3.1 if none is */
  type?: { text: string; size: number; calt?: boolean; lh?: string; way?: 'web' | 'app' | 'time'; at?: { pace: number; wear: number; opsz?: number | 'auto' }; script?: string; face?: 'Regular' | 'Pressed' | 'Hurried'; family?: string }[];
  /** the font's version it's set in (each version is kept, so it always comes out as it was set; 0.41 if not given,
   * which has 0.4's glyphs) */
  font?: string;
  made: string;
  review: string;
};

export type Session = { n: number; date: string; title: string; summary: string; decided: string[] };

/** a session as it's kept: what it found and decided, the hands it made, its entries, and how its samples are made */
export type SessionFile = { session: Session; hands?: Partial<Record<HandId, Hand>>; entries: Entry[]; made?: Record<string, () => Sig[]> };
