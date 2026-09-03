import * as React from 'react';
import styled from '../styled';
import { theme } from '../theme';
import type { Availability, BookCopy, ReadingState } from '../types';
import { Panel, Select } from './Layout';
import { BookCover } from './BookCover';

const Card = styled(Panel)`
  display: grid;
  grid-template-columns: 78px minmax(0, 1fr);
  gap: 15px;
  padding: 14px;
  min-height: 132px;
`;
const Copy = styled.div`min-width: 0; display: flex; flex-direction: column;`;
const Title = styled.h2`
  margin: 2px 0 3px; font: 600 18px/1.15 ${theme.serif};
`;
const Author = styled.p`margin: 0; color: ${theme.quiet}; font-size: 13px;`;
const Isbn = styled.p`margin: 7px 0 0; color: ${theme.quiet}; font: 10px/1 ${theme.mono};`;
const Controls = styled.div`
  display: grid; grid-template-columns: 1fr 1fr; gap: 7px; margin-top: auto; padding-top: 10px;
  ${Select} { padding: 7px 8px; font-size: 12px; }
`;
const Badges = styled.div`display: flex; gap: 6px; flex-wrap: wrap; margin-top: auto; padding-top: 10px;`;
const Badge = styled.span`
  border-radius: 999px; padding: 4px 8px; font-size: 10px; font-weight: 700;
  color: ${theme.moss}; background: ${theme.mossSoft};
`;
const WarmBadge = styled(Badge)`color: ${theme.clay}; background: #f1ddd5;`;

const pretty = (value: string): string => value.replace('-', ' ');

export function BookCard({ book, onChange }: {
  book: BookCopy;
  onChange?: (patch: { readingState?: ReadingState; availability?: Availability }) => void;
}): React.JSX.Element {
  return (
    <Card>
      <BookCover title={book.title} url={book.coverUrl} width={78} height={112} />
      <Copy>
        <Title>{book.title}</Title>
        <Author>{book.authors.length ? book.authors.join(', ') : 'Unknown author'}</Author>
        <Isbn>ISBN {book.isbn}</Isbn>
        {onChange ? (
          <Controls>
            <Select aria-label={`Reading state for ${book.title}`} value={book.readingState} onChange={(e) => onChange({ readingState: e.target.value as ReadingState })}>
              <option value="unread">Unread</option><option value="reading">Reading</option><option value="read">Read</option><option value="want">Want</option>
            </Select>
            <Select aria-label={`Availability for ${book.title}`} value={book.availability} onChange={(e) => onChange({ availability: e.target.value as Availability })}>
              <option value="private">Mine</option><option value="ask">Ask me</option><option value="lend">Lend</option><option value="pass">Pass on</option>
            </Select>
          </Controls>
        ) : (
          <Badges><Badge>{pretty(book.readingState)}</Badge>{book.availability === 'pass' ? <WarmBadge>{pretty(book.availability)}</WarmBadge> : <Badge>{pretty(book.availability)}</Badge>}</Badges>
        )}
      </Copy>
    </Card>
  );
}
