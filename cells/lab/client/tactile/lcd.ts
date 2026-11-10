/**
 * The AtomS3R's 128×128 LCD, drawn the way firmware/main/display.cpp draws the reader: the same
 * colours, rows, text sizes and the LGFX default font's 6×8 cell per character at size 1, so
 * where a word sits, where its recognition letter falls and when it drops a size all match the
 * device. Glyph shapes are the browser's monospace rather than the GLCD bitmap font.
 */
import type { Frame } from './core';

export const LCD = 128;
const BG = '#08141c', TEXT = '#f2f7f5', MUTED = '#84a3ad', TEAL = '#26d0a8', CORAL = '#f06f62', RULE = '#31505a';
const CELL_W = 6, CELL_H = 8;

const width = (s: string, size: number) => s.length * CELL_W * size;

export function fixationIndex(word: string): number {
  // (the firmware's aw_fixation_index, here only for drawing; the core reports it too)
  const n = word.length;
  if (n <= 1) return 0;
  const i = Math.round((n + 1) * 0.4) - 1;
  return Math.max(0, Math.min(n - 1, i));
}

function text(g: CanvasRenderingContext2D, s: string, x: number, y: number, size: number, colour: string, align: 'center' | 'left') {
  const w = width(s, size);
  let left = align === 'center' ? Math.round(x - w / 2) : x;
  const top = Math.round(y - (CELL_H * size) / 2);
  g.fillStyle = colour;
  g.font = `${7 * size}px ui-monospace, "SF Mono", Menlo, Consolas, monospace`;
  g.textBaseline = 'top';
  g.textAlign = 'center';
  for (const ch of s) {
    g.fillText(ch, left + (CELL_W * size) / 2 - size * 0.5, top + size * 0.5);
    left += CELL_W * size;
  }
}

export interface Backlight { level: number }

/** Draw one reader frame. `anchor` is the core's fixation index for the word. */
export function drawReader(g: CanvasRenderingContext2D, f: Frame, anchor: number, light: Backlight = { level: 1 }) {
  g.save();
  g.fillStyle = BG;
  g.fillRect(0, 0, LCD, LCD);
  text(g, f.section, 64, 12, 1, TEAL, 'center');
  text(g, f.after, 64, 92, 1, MUTED, 'center');
  text(g, f.hint, 64, 115, 1, MUTED, 'center');

  const word = f.word;
  const a = anchor >= 0 && anchor < word.length ? anchor : 0;
  const prefix = word.slice(0, a), pivot = word.slice(a, a + 1), suffix = word.slice(a + 1);
  let size = 3;
  if (width(word, size) > 108) size = 2;
  if (width(word, size) > 108) size = 1;
  const start = 64 - width(prefix, size) - Math.floor(width(pivot, size) / 2);

  g.fillStyle = RULE;
  g.fillRect(17, 31, 94, 1);
  g.fillRect(17, 82, 94, 1);
  g.fillStyle = CORAL;
  g.fillRect(64, 31, 1, 5);
  g.fillRect(64, 78, 1, 5);

  text(g, prefix, start, 57, size, TEXT, 'left');
  text(g, pivot, start + width(prefix, size), 57, size, CORAL, 'left');
  text(g, suffix, start + width(prefix, size) + width(pivot, size), 57, size, TEXT, 'left');
  if (light.level < 1) {
    g.fillStyle = `rgba(0,0,0,${1 - light.level})`;
    g.fillRect(0, 0, LCD, LCD);
  }
  g.restore();
}
