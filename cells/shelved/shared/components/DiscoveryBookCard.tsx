import * as React from 'react';
import styled from '../styled';
import { theme } from '../theme';
import type { DiscoverCopy } from '../types';
import { BookCover } from './BookCover';

const Card = styled.button`min-width: 172px; width: 172px; border: 0; padding: 0; background: none; color: inherit; text-align: left; cursor: pointer; scroll-snap-align: start; &:focus-visible { outline: 3px solid ${theme.gold}; outline-offset: 5px; border-radius: 8px; }`;
const Title = styled.h3`margin: 13px 0 3px; font: 600 17px/1.15 ${theme.serif};`;
const Author = styled.p`margin: 0; color: ${theme.quiet}; font-size: 12px; line-height: 1.35;`;
const Shelf = styled.p`margin: 8px 0 0; color: ${theme.moss}; font-size: 11px; font-weight: 750;`;
const Mode = styled.span`display: inline-block; margin-top: 8px; border-radius: 999px; padding: 4px 8px; background: ${theme.claySoft}; color: ${theme.clay}; font-size: 10px; font-weight: 800; text-transform: uppercase; letter-spacing: .05em;`;

const mode = (value: DiscoverCopy['availability']): string => value === 'pass' ? 'pass it on' : value === 'lend' ? 'available to borrow' : 'ask to borrow';

export function DiscoveryBookCard({ book, onSelect }: { book: DiscoverCopy; onSelect: (book: DiscoverCopy) => void }): React.JSX.Element {
  return <Card onClick={() => onSelect(book)} aria-label={`Open ${book.title} details`}><BookCover title={book.title} url={book.coverUrl} width={172} height={252} /><Title>{book.title}</Title><Author>{book.authors.join(', ') || 'Unknown author'}</Author><Mode>{mode(book.availability)}</Mode><Shelf>On {book.shelfLabel}</Shelf></Card>;
}
