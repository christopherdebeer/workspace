import * as React from 'react';
import styled from '../../shared/styled';
import { theme } from '../../shared/theme';
import type { DiscoverCopy } from '../../shared/types';
import { ClayButton, Field, QuietButton } from '../../shared/components/Layout';
import { DiscoveryBookCard } from '../../shared/components/DiscoveryBookCard';
import { BookCover } from '../../shared/components/BookCover';

const Hero = styled.section`
  display: grid; grid-template-columns: minmax(0, 1.2fr) minmax(260px, .8fr); gap: 32px; align-items: center;
  padding: clamp(38px, 8vw, 88px) 0 54px;
  @media (max-width: 720px) { grid-template-columns: 1fr; padding-top: 36px; }
`;
const Eyebrow = styled.p`margin: 0 0 10px; color: ${theme.clay}; font-size: 12px; font-weight: 800; letter-spacing: .12em; text-transform: uppercase;`;
const HeroTitle = styled.h1`max-width: 760px; margin: 0; font: 500 clamp(43px, 8.5vw, 84px)/.92 ${theme.serif}; letter-spacing: -.045em;`;
const HeroCopy = styled.p`max-width: 600px; margin: 22px 0; color: ${theme.quiet}; font-size: clamp(16px, 2vw, 20px); line-height: 1.55;`;
const Actions = styled.div`display: flex; flex-wrap: wrap; gap: 9px;`;
const Search = styled.div`display: flex; gap: 8px; max-width: 430px; margin-top: 13px;`;
const SearchError = styled.p`margin: 7px 0 0; color: ${theme.clay}; font-size: 11px;`;
const Stack = styled.div`position: relative; height: 315px; @media (max-width: 720px) { display: none; }`;
const StackOne = styled.div`position: absolute; left: 8%; bottom: 0; transform: rotate(-8deg);`;
const StackTwo = styled.div`position: absolute; left: 36%; bottom: 14px; z-index: 2; transform: rotate(3deg);`;
const StackThree = styled.div`position: absolute; right: 1%; bottom: 3px; transform: rotate(10deg);`;
const Section = styled.section`padding: 26px 0 46px; border-top: 1px solid ${theme.line};`;
const SectionHead = styled.div`display: flex; align-items: end; justify-content: space-between; gap: 18px; margin-bottom: 20px;`;
const Heading = styled.h2`margin: 0; font: 600 clamp(27px, 4vw, 42px)/1 ${theme.serif};`;
const Sub = styled.p`margin: 7px 0 0; color: ${theme.quiet}; font-size: 13px;`;
const Rail = styled.div`display: flex; gap: 22px; overflow-x: auto; padding: 2px 4px 24px; scroll-snap-type: x proximity;`;
const Chips = styled.div`display: flex; gap: 8px; overflow-x: auto; padding-bottom: 17px;`;
const Chip = styled.button`white-space: nowrap; border: 1px solid ${theme.line}; border-radius: 999px; background: ${theme.paperRaised}; padding: 8px 13px; color: ${theme.ink}; cursor: pointer;`;
const ActiveChip = styled(Chip)`background: ${theme.moss}; color: white; border-color: ${theme.moss};`;
const ShelfGrid = styled.div`display: grid; grid-template-columns: repeat(auto-fit, minmax(230px, 1fr)); gap: 12px;`;
const ShelfCard = styled.button`min-height: 160px; padding: 18px; border: 1px solid ${theme.line}; border-radius: 16px; background: ${theme.paperRaised}; color: ${theme.ink}; overflow: hidden; cursor: pointer; text-align: left;`;
const ShelfName = styled.h3`margin: 0 0 5px; font: 600 21px/1.1 ${theme.serif};`;
const ShelfMeta = styled.p`margin: 0 0 14px; color: ${theme.quiet}; font-size: 12px;`;
const ShelfBooks = styled.div`display: flex; align-items: end; gap: 7px; height: 83px; overflow: hidden;`;
const Empty = styled.div`padding: 34px; border: 1px dashed ${theme.line}; border-radius: 16px; color: ${theme.quiet}; text-align: center; line-height: 1.55;`;

export function Discover({ books, authed, onJoin, onAdd, onManage, onOpenBook, onViewProfile, onLookupIsbn }: { books: DiscoverCopy[]; authed: boolean; onJoin: () => void; onAdd: () => void; onManage: () => void; onOpenBook: (workId: string) => void; onViewProfile: (profileId: string) => void; onLookupIsbn: (isbn: string) => Promise<void> }): React.JSX.Element {
  const genres = React.useMemo(() => Array.from(new Set(books.flatMap((b) => b.genres ?? []))).slice(0, 12), [books]);
  const [genre, setGenre] = React.useState('All books');
  const [isbn, setIsbn] = React.useState('');
  const [searching, setSearching] = React.useState(false);
  const [searchError, setSearchError] = React.useState('');
  const visible = genre === 'All books' ? books : books.filter((b) => b.genres?.includes(genre));
  const shelves = React.useMemo(() => { const map = new Map<string, { id: string; label: string; books: DiscoverCopy[] }>(); for (const book of books) { const current = map.get(book.shelfId); if (current) current.books.push(book); else map.set(book.shelfId, { id: book.shelfId, label: book.shelfLabel, books: [book] }); } return Array.from(map.values()); }, [books]);
  const hero = books.slice(0, 3);
  const lookup = async (): Promise<void> => { setSearching(true); setSearchError(''); try { await onLookupIsbn(isbn); setIsbn(''); } catch (err) { setSearchError((err as Error).message); } finally { setSearching(false); } };
  return <><Hero><div><Eyebrow>Books are better shared</Eyebrow><HeroTitle>Find your next book on someone else’s shelf.</HeroTitle><HeroCopy>Browse books that readers are happy to lend or pass on. Save books even when no copy is available, and Shelved will watch for you.</HeroCopy><Actions>{!authed ? <ClayButton onClick={onJoin}>Join the library</ClayButton> : <ClayButton onClick={onManage}>Open my shelf</ClayButton>}<QuietButton onClick={onAdd}>Add your books</QuietButton></Actions><Search><Field inputMode="numeric" value={isbn} onChange={(event) => setIsbn(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') void lookup(); }} placeholder="Find any book by ISBN" /><QuietButton disabled={searching || !isbn} onClick={() => void lookup()}>{searching ? 'Finding…' : 'Find book'}</QuietButton></Search>{searchError ? <SearchError>{searchError}</SearchError> : null}</div><Stack>{hero[0] ? <StackOne><BookCover title={hero[0].title} url={hero[0].coverUrl} width={164} height={242} /></StackOne> : null}{hero[1] ? <StackTwo><BookCover title={hero[1].title} url={hero[1].coverUrl} width={172} height={255} /></StackTwo> : null}{hero[2] ? <StackThree><BookCover title={hero[2].title} url={hero[2].coverUrl} width={158} height={234} /></StackThree> : null}</Stack></Hero><Section id="available"><SectionHead><div><Heading>Available books</Heading><Sub>Borrow it, ask for it, or help it travel onwards.</Sub></div></SectionHead>{genres.length ? <Chips>{['All books', ...genres].map((item) => item === genre ? <ActiveChip key={item} onClick={() => setGenre(item)}>{item}</ActiveChip> : <Chip key={item} onClick={() => setGenre(item)}>{item}</Chip>)}</Chips> : null}{visible.length ? <Rail>{visible.map((book) => <DiscoveryBookCard key={book.id} book={book} onSelect={(copy) => copy.workId && onOpenBook(copy.workId)} />)}</Rail> : <Empty>No books in this category yet. The first shared shelf will make this place come alive.</Empty>}</Section><Section><SectionHead><div><Heading>Explore the shelves</Heading><Sub>Every shelf belongs to a reader, not a shop.</Sub></div></SectionHead>{shelves.length ? <ShelfGrid>{shelves.map((shelf) => <ShelfCard key={shelf.id} onClick={() => onViewProfile(shelf.id)}><ShelfName>{shelf.label}</ShelfName><ShelfMeta>{shelf.books.length} book{shelf.books.length === 1 ? '' : 's'} available</ShelfMeta><ShelfBooks>{shelf.books.slice(0, 6).map((book) => <BookCover key={book.id} title={book.title} url={book.coverUrl} width={48} height={72} />)}</ShelfBooks></ShelfCard>)}</ShelfGrid> : <Empty>Shelves marked “ask”, “lend” or “pass on” will appear here.</Empty>}</Section></>;
}
