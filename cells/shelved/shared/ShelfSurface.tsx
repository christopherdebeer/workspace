import * as React from 'react';
import styled, { ThemeProvider } from './styled';
import { GlobalStyle, theme } from './theme';
import type { ShelfViewModel } from './types';
import { Page, Shell } from './components/Layout';
import { ShelfHeader } from './components/ShelfHeader';
import { ShelfStats } from './components/ShelfStats';
import { BookCard } from './components/BookCard';
import { EmptyShelf } from './components/EmptyShelf';

const Grid = styled.div`display: grid; grid-template-columns: repeat(auto-fill, minmax(min(100%, 310px), 1fr)); gap: 12px;`;

export function ShelfSurface({ vm }: { vm: ShelfViewModel }): React.JSX.Element {
  return <ThemeProvider theme={theme}><GlobalStyle /><Page><Shell><ShelfHeader />{vm.authed ? <ShelfStats books={vm.books} /> : null}{vm.books.length ? <Grid>{vm.books.map((book) => <BookCard key={book.id} book={book} />)}</Grid> : <EmptyShelf authed={vm.authed} />}</Shell></Page></ThemeProvider>;
}
