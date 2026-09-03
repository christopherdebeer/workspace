import * as React from 'react';
import styled from '../../shared/styled';
import { theme } from '../../shared/theme';
import type { DiscoverCopy } from '../../shared/types';
import { BookCover } from '../../shared/components/BookCover';
import { PrimaryButton, QuietButton } from '../../shared/components/Layout';

const Backdrop = styled.div`
  position: fixed; inset: 0; z-index: 30; display: grid; place-items: end center;
  padding: 18px; background: rgba(40, 33, 29, .48); backdrop-filter: blur(3px);
`;
const Sheet = styled.section`
  width: min(100%, 620px); max-height: min(88svh, 720px); overflow: auto;
  padding: 22px; border: 1px solid ${theme.line}; border-radius: 24px 24px 16px 16px;
  background: ${theme.paperRaised}; box-shadow: 0 24px 80px rgba(40, 33, 29, .28);
`;
const Head = styled.div`display: flex; align-items: center; justify-content: space-between; gap: 14px; margin-bottom: 18px;`;
const Kicker = styled.p`margin: 0; color: ${theme.clay}; font-size: 11px; font-weight: 800; letter-spacing: .09em; text-transform: uppercase;`;
const Close = styled.button`width: 36px; height: 36px; border: 1px solid ${theme.line}; border-radius: 50%; background: ${theme.paper}; color: ${theme.ink}; cursor: pointer; font-size: 22px;`;
const Body = styled.div`display: grid; grid-template-columns: 150px 1fr; gap: 22px; @media (max-width: 520px) { grid-template-columns: 112px 1fr; gap: 16px; }`;
const Title = styled.h2`margin: 1px 0 6px; font: 600 clamp(28px, 6vw, 42px)/1 ${theme.serif}; letter-spacing: -.025em;`;
const Author = styled.p`margin: 0 0 17px; color: ${theme.quiet}; line-height: 1.4;`;
const Availability = styled.p`display: inline-block; margin: 0 0 15px; border-radius: 999px; padding: 6px 10px; background: ${theme.claySoft}; color: ${theme.clay}; font-size: 11px; font-weight: 800; text-transform: uppercase; letter-spacing: .05em;`;
const Detail = styled.p`margin: 6px 0; color: ${theme.quiet}; font-size: 13px; line-height: 1.45;`;
const Genres = styled.div`display: flex; flex-wrap: wrap; gap: 6px; margin-top: 14px;`;
const Genre = styled.span`border: 1px solid ${theme.line}; border-radius: 999px; padding: 5px 8px; color: ${theme.moss}; font-size: 11px;`;
const OwnerNote = styled.div`margin-top: 20px; padding: 13px 14px; border-radius: 12px; background: ${theme.mossSoft}; color: ${theme.moss}; font-size: 13px; line-height: 1.45;`;
const Actions = styled.div`display: flex; flex-wrap: wrap; gap: 9px; margin-top: 20px;`;
const Status = styled.p`margin: 12px 0 0; color: ${theme.moss}; font-size: 13px; font-weight: 700;`;
const ErrorText = styled.p`margin: 12px 0 0; color: ${theme.clay}; font-size: 13px;`;
const Delivery = styled.fieldset`margin: 20px 0 0; padding: 0; border: 0;`;
const Legend = styled.legend`margin-bottom: 9px; color: ${theme.quiet}; font-size: 12px; font-weight: 750;`;
const DeliveryChoices = styled.div`display: grid; grid-template-columns: 1fr 1fr; gap: 8px;`;
const DeliveryChoice = styled.button`border: 1px solid ${theme.line}; border-radius: 13px; padding: 11px 12px; background: ${theme.paper}; color: ${theme.ink}; text-align: left; cursor: pointer; &[aria-pressed="true"] { border-color: ${theme.moss}; background: ${theme.mossSoft}; color: ${theme.moss}; }`;
const ChoiceTitle = styled.strong`display: block; font-size: 13px;`;
const ChoiceMeta = styled.span`display: block; margin-top: 3px; color: ${theme.quiet}; font-size: 10px; line-height: 1.35;`;

const availabilityLabel = (value: DiscoverCopy['availability']): string => value === 'pass' ? 'Ready to pass on' : value === 'lend' ? 'Available to borrow' : 'Ask to borrow';
const actionLabel = (value: DiscoverCopy['availability']): string => value === 'pass' ? 'Ask to take this book' : 'Ask to borrow';

export function BookDetailSheet({ book, authed, isOwn, onClose, onSignIn, onManage, onRequest }: {
  book: DiscoverCopy;
  authed: boolean;
  isOwn: boolean;
  onClose: () => void;
  onSignIn: () => void;
  onManage: () => void;
  onRequest: (book: DiscoverCopy, deliveryMethod: 'local' | 'post') => Promise<void>;
}): React.JSX.Element {
  const [sending, setSending] = React.useState(false);
  const [sent, setSent] = React.useState(false);
  const [error, setError] = React.useState('');
  const [deliveryMethod, setDeliveryMethod] = React.useState<'local' | 'post'>('local');
  React.useEffect(() => {
    const onKey = (event: KeyboardEvent): void => { if (event.key === 'Escape') onClose(); };
    addEventListener('keydown', onKey);
    return () => removeEventListener('keydown', onKey);
  }, [onClose]);
  const request = async (): Promise<void> => {
    setSending(true); setError('');
    try { await onRequest(book, deliveryMethod); setSent(true); }
    catch (err) { setError((err as Error).message || 'The request could not be sent.'); }
    finally { setSending(false); }
  };
  return <Backdrop onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><Sheet role="dialog" aria-modal="true" aria-labelledby="book-detail-title"><Head><Kicker>On {book.shelfLabel}</Kicker><Close onClick={onClose} aria-label="Close book details">×</Close></Head><Body><BookCover title={book.title} url={book.coverUrl} width={150} height={220} /><div><Availability>{availabilityLabel(book.availability)}</Availability><Title id="book-detail-title">{book.title}</Title><Author>{book.authors.join(', ') || 'Unknown author'}</Author>{book.publisher ? <Detail>{book.publisher}{book.publishedDate ? ` · ${book.publishedDate}` : ''}</Detail> : book.publishedDate ? <Detail>Published {book.publishedDate}</Detail> : null}<Detail>ISBN {book.isbn}</Detail>{book.condition ? <Detail>Condition: {book.condition.replace('-', ' ')}</Detail> : null}{book.genres?.length ? <Genres>{book.genres.map((genre) => <Genre key={genre}>{genre}</Genre>)}</Genres> : null}</div></Body>{isOwn ? <OwnerNote>This is your copy. Its availability is visible here exactly as another reader would see it.</OwnerNote> : null}{authed && !isOwn && !sent ? <Delivery><Legend>How would you like to receive it?</Legend><DeliveryChoices><DeliveryChoice type="button" aria-pressed={deliveryMethod === 'local'} onClick={() => setDeliveryMethod('local')}><ChoiceTitle>Meet locally</ChoiceTitle><ChoiceMeta>Arrange a handoff after the owner accepts.</ChoiceMeta></DeliveryChoice><DeliveryChoice type="button" aria-pressed={deliveryMethod === 'post'} onClick={() => setDeliveryMethod('post')}><ChoiceTitle>Post it</ChoiceTitle><ChoiceMeta>Choose and pay for tracked postage after acceptance.</ChoiceMeta></DeliveryChoice></DeliveryChoices></Delivery> : null}<Actions>{isOwn ? <PrimaryButton onClick={onManage}>Manage on my shelf</PrimaryButton> : !authed ? <PrimaryButton onClick={onSignIn}>Sign in to {book.availability === 'pass' ? 'ask for it' : 'borrow'}</PrimaryButton> : sent ? <QuietButton onClick={onClose}>Done</QuietButton> : <PrimaryButton disabled={sending} onClick={() => void request()}>{sending ? 'Sending…' : actionLabel(book.availability)}</PrimaryButton>}<QuietButton onClick={onClose}>Close</QuietButton></Actions>{sent ? <Status>Request sent for {deliveryMethod === 'post' ? 'tracked postage' : 'a local handoff'}.</Status> : null}{error ? <ErrorText>{error}</ErrorText> : null}</Sheet></Backdrop>;
}
