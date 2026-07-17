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
  // Has non-heading prose accreted onto `cur` since its opening heading? A
  // heading opens a prose cell; the following prose accretes onto it. But a
  // heading immediately followed by ANOTHER heading — a parent section header
  // with no intro prose before its first subsection (e.g. `## Decisions` then
  // `### 1. …`) — must NOT emit the parent as a content-less cell: it folds
  // forward to ride with its first prose-bearing subsection. Otherwise every
  // doc structured `## Decisions` / `### …` yields a BYTE-IDENTICAL bare
  // `## Decisions` block, and those pair combinatorially in the vector-kinship
  // pass → substrate-wide contested/suggestion noise (a heading is a structural
  // label, not a shareable fact). See kb/contested-noise-floor-boilerplate-doc-blocks.
  let curHasProse = false;
  const flush = (): void => { const s = cur.replace(/\s+$/, ''); if (s.trim()) cells.push(s); cur = ''; curHasProse = false; };
  for (const t of toks) {
    if (t.type === 'heading') {
      if (cur && !curHasProse) cur += (cur.endsWith('\n') ? '' : '\n\n') + t.raw; // fold a heading-only cell forward
      else { flush(); cur = t.raw; }
    }
    else if (t.type === 'code') { flush(); const s = t.raw.replace(/\s+$/, ''); if (s.trim()) cells.push(s); }
    else { cur += t.raw; if (t.raw.trim()) curHasProse = true; }
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
