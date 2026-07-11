/* ---------------------------------------------------------------------------
 * blocks.ts — the substrate-native document ⇄ cells decomposition, split out
 * of shared.tsx (no DOM/JSX here) so server-side, non-React code (e.g.
 * decompose.ts's ADR-0081 ingestion reaction, and jest, which cannot parse
 * shared.tsx's JSX outside a bundler) can import it directly.
 *
 * A document is authored as one markdown text; on save it decomposes into
 * cell-facts (dotlit's sections+cells, simplified): a heading opens a prose
 * cell that accretes following prose; a fenced code block is its own cell.
 * ------------------------------------------------------------------------- */
import { marked } from 'marked';

export function splitCells(md: string): string[] {
  const toks = (marked.lexer(md || '') as Array<{ type: string; raw: string }>);
  const cells: string[] = [];
  let cur = '';
  const flush = (): void => { const s = cur.replace(/\s+$/, ''); if (s.trim()) cells.push(s); cur = ''; };
  for (const t of toks) {
    if (t.type === 'heading') { flush(); cur = t.raw; }
    else if (t.type === 'code') { flush(); const s = t.raw.replace(/\s+$/, ''); if (s.trim()) cells.push(s); }
    else cur += t.raw;
  }
  flush();
  return cells;
}

/** Fractional ordering — placing a split-off fragment or moving a cell is a
 *  single decoration write (no renumbering). */
export function seqBetween(a: number | null, b: number | null): number {
  if (a == null && b == null) return 1;
  if (a == null) return (b as number) - 1;
  if (b == null) return (a as number) + 1;
  return (a + b) / 2;
}
