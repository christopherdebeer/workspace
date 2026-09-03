import * as React from 'react';
import styled from '../styled';
import { theme } from '../theme';
import type { BookCopy } from '../types';
import { Panel } from './Layout';

const Row = styled(Panel)`
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  overflow: hidden;
  margin-bottom: 18px;
  @media (max-width: 620px) { grid-template-columns: repeat(2, 1fr); }
`;
const Stat = styled.div`
  padding: 16px 18px;
  border-right: 1px solid ${theme.line};
  &:last-child { border-right: 0; }
  @media (max-width: 620px) {
    &:nth-child(2) { border-right: 0; }
    &:nth-child(-n+2) { border-bottom: 1px solid ${theme.line}; }
  }
`;
const Value = styled.div`font: 500 26px/1 ${theme.serif};`;
const Label = styled.div`
  margin-top: 5px;
  color: ${theme.quiet};
  font-size: 11px;
  letter-spacing: .08em;
  text-transform: uppercase;
`;

export function ShelfStats({ books }: { books: BookCopy[] }): React.JSX.Element {
  const stats = [
    ['on shelf', books.length],
    ['read', books.filter((b) => b.readingState === 'read').length],
    ['lendable', books.filter((b) => b.availability === 'lend' || b.availability === 'ask').length],
    ['passing on', books.filter((b) => b.availability === 'pass').length],
  ] as const;
  return <Row>{stats.map(([label, value]) => <Stat key={label}><Value>{value}</Value><Label>{label}</Label></Stat>)}</Row>;
}
