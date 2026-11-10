/** The page's shared helpers: elements, colours, escaping, and canvases sized to their writing. */
import type { Sig } from '../../switchback/sign';
import { Look, bounds } from '../ink';

export const $ = (id: string) => document.getElementById(id)!;
export const css = (v: string) => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
export const lookOf = (mode: Look['mode']): Look => ({ mode, ink: css('--ink'), faint: css('--faint') });
export const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

/** a canvas sized to its writing: as wide as its column, as tall as the writing's proportion asks (within reason) */
export function sized(cv: HTMLCanvasElement, sigs: Sig[], most = 230) {
  const b = bounds(sigs), w = cv.clientWidth || cv.parentElement!.clientWidth;
  cv.style.height = `${Math.round(Math.max(64, Math.min(most, (w / (b.w / b.h)) * 0.92)))}px`;
}

/** (session 35) where each of a still font's faces sits on the weight its family is set at */
export const FACE_WEIGHT = { Hurried: 200, Regular: 400, Pressed: 700 } as const;

/** (from session 31) the font's script for the web's time, if it's loaded */
export type Timed = { write: (el: HTMLElement, opt?: { seed?: number }) => number; watch: (el: HTMLElement) => void; settle: (el: HTMLElement) => void; version?: string };
type Win = { ClaudeHandTimes?: Record<string, Timed>; ClaudeHandTime?: Timed };
/** (from session 32) the version a sample was written with, so a later script never changes how it was written */
export const timedAs = (v: string) => { const w = window as unknown as Win; return w.ClaudeHandTimes?.[v] ?? (w.ClaudeHandTime?.version === v ? w.ClaudeHandTime : undefined); };
