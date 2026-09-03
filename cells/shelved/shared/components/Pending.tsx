/**
 * Placeholders for content that is on its way.
 *
 * The first paint renders the real components with empty data, which was meant
 * to avoid maintaining a second set of surfaces — but an empty list and a list
 * that has not loaded look identical, and the empty copy asserts a fact ("No
 * books in this category yet") at the moment we know least. A reader arriving
 * at a shelf that does have books was told, briefly and confidently, that it
 * did not.
 *
 * So the shapes are shared and only the FILLING differs: same rails, same
 * grids, same card footprint, holding blocks instead of covers. That keeps the
 * layout from moving when the real thing lands, which is the whole point of
 * having drawn it early.
 */
import * as React from 'react';
import styled from '../styled';
import { theme } from '../theme';

/** A soft block. Animation is a courtesy, so it goes away when asked. */
export const Shimmer = styled.div`
  background: linear-gradient(100deg, ${theme.line} 20%, ${theme.paperRaised} 45%, ${theme.line} 70%);
  background-size: 220% 100%;
  border-radius: 8px;
  animation: shelved-shimmer 1.4s ease-in-out infinite;
  @media (prefers-reduced-motion: reduce) { animation: none; background: ${theme.line}; }
`;

const Cover = styled(Shimmer)`width: 100%; aspect-ratio: 2 / 3; border-radius: 6px;`;
const Line = styled(Shimmer)`height: 11px; margin-top: 9px;`;
const Card = styled.div`width: 152px; flex: 0 0 auto;`;

/** One card in a rail — the DiscoveryBookCard footprint, unfilled. */
export function PendingBookCard(): React.JSX.Element {
  return (
    <Card aria-hidden="true">
      <Cover />
      <Line style={{ width: '85%' }} />
      <Line style={{ width: '55%' }} />
    </Card>
  );
}

/**
 * A row of them. `count` is fixed rather than guessed from anything, so the
 * server and the client's pre-data render produce identical markup — a random
 * or measured count would be a hydration mismatch.
 */
export function PendingRail({ count = 5 }: { count?: number }): React.JSX.Element {
  return (
    <div style={{ display: 'flex', gap: '14px', overflow: 'hidden' }} aria-hidden="true">
      {Array.from({ length: count }, (_, i) => <PendingBookCard key={i} />)}
    </div>
  );
}

/** The status line that says this is loading, for anyone not looking at pixels. */
export function PendingNote({ children }: { children: React.ReactNode }): React.JSX.Element {
  return (
    <p role="status" aria-live="polite" style={{ color: theme.quiet, margin: '10px 0 0', fontSize: '0.85rem' }}>
      {children}
    </p>
  );
}

/**
 * A cover-shaped block at an explicit size, for the hero stack — those covers
 * are absolutely positioned at fixed dimensions, so a placeholder that sized
 * itself would shift the whole composition when the real ones arrive.
 */
export function PendingCover({ $w, $h }: { $w: number; $h: number }): React.JSX.Element {
  return <Shimmer style={{ width: $w, height: $h, borderRadius: 6 }} aria-hidden="true" />;
}
