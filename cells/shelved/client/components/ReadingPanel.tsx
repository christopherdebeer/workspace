import * as React from 'react';
import styled from '../../shared/styled';
import { theme } from '../../shared/theme';
import type { AvailabilityNotification, UserBook } from '../../shared/types';
import { BookCover } from '../../shared/components/BookCover';

const Section = styled.section`margin: 30px 0; padding-top: 26px; border-top: 1px solid ${theme.line};`;
const Heading = styled.h2`margin: 0; font: 600 clamp(27px,4vw,40px)/1 ${theme.serif};`;
const Intro = styled.p`margin: 8px 0 18px; color: ${theme.quiet}; font-size: 13px;`;
const Grid = styled.div`display: grid; grid-template-columns: repeat(auto-fit,minmax(270px,1fr)); gap: 12px;`;
const Card = styled.button`display: grid; grid-template-columns: 56px 1fr; gap: 12px; border: 1px solid ${theme.line}; border-radius: 14px; padding: 12px; background: ${theme.paperRaised}; color: ${theme.ink}; cursor: pointer; text-align: left;`;
const Title = styled.strong`display: block; margin-top: 3px; font: 600 18px/1.1 ${theme.serif};`;
const Meta = styled.span`display: block; margin-top: 5px; color: ${theme.quiet}; font-size: 10px; line-height: 1.4;`;
const Dot = styled.span`display: inline-block; width: 7px; height: 7px; margin-right: 5px; border-radius: 50%; background: ${theme.clay};`;
const Empty = styled.div`padding: 22px; border: 1px dashed ${theme.line}; border-radius: 14px; color: ${theme.quiet}; text-align: center; font-size: 12px;`;
const Spacer = styled.div`height: 12px;`;

export function ReadingPanel({ books, notifications, onOpenBook, onReadNotification }: { books: UserBook[]; notifications: AvailabilityNotification[]; onOpenBook: (workId: string) => void; onReadNotification: (notice: AvailabilityNotification) => Promise<void> }): React.JSX.Element {
  const wants = books.filter((book) => book.state === 'want');
  const unread = notifications.filter((notice) => !notice.read);
  const openNotice = async (notice: AvailabilityNotification): Promise<void> => { await onReadNotification(notice); onOpenBook(notice.workId); };
  return <Section><Heading>Reading next</Heading><Intro>Your interests are separate from the books you own. Wanted books automatically watch for available copies.</Intro>{unread.length ? <><Intro><strong>{unread.length} newly available</strong></Intro><Grid>{unread.map((notice) => <Card key={notice.id} onClick={() => void openNotice(notice)}><BookCover title={notice.title} url={notice.coverUrl} width={56} height={83} /><span><Title><Dot />{notice.title}</Title><Meta>A copy is now available on {notice.shelfLabel}</Meta></span></Card>)}</Grid></> : null}<Spacer />{wants.length ? <Grid>{wants.map((book) => <Card key={book.workId} onClick={() => onOpenBook(book.workId)}><BookCover title={book.work.title} url={book.work.coverUrl} width={56} height={83} /><span><Title>{book.work.title}</Title><Meta>{book.work.authors.join(', ')} · Want to read</Meta></span></Card>)}</Grid> : <Empty>No wanted books yet. Open any book and choose “Want to read”.</Empty>}</Section>;
}
