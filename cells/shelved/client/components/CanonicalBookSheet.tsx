import * as React from 'react';
import styled from '../../shared/styled';
import { theme } from '../../shared/theme';
import type { DiscoverCopy, PublicBookView, UserBookState } from '../../shared/types';
import { BookCover } from '../../shared/components/BookCover';
import { PrimaryButton, QuietButton } from '../../shared/components/Layout';

const Backdrop = styled.div`position: fixed; inset: 0; z-index: 30; display: grid; place-items: end center; padding: 18px; background: rgba(40,33,29,.48); backdrop-filter: blur(3px);`;
const Sheet = styled.section`width: min(100%, 690px); max-height: min(90svh, 780px); overflow: auto; padding: 22px; border: 1px solid ${theme.line}; border-radius: 24px 24px 16px 16px; background: ${theme.paperRaised}; box-shadow: 0 24px 80px rgba(40,33,29,.28);`;
const Head = styled.div`display: flex; justify-content: flex-end; margin-bottom: 8px;`;
const Close = styled.button`width: 36px; height: 36px; border: 1px solid ${theme.line}; border-radius: 50%; background: ${theme.paper}; color: ${theme.ink}; cursor: pointer; font-size: 22px;`;
const Book = styled.div`display: grid; grid-template-columns: 155px 1fr; gap: 24px; @media (max-width: 540px) { grid-template-columns: 110px 1fr; gap: 15px; }`;
const Eyebrow = styled.p`margin: 0 0 7px; color: ${theme.clay}; font-size: 10px; font-weight: 800; letter-spacing: .1em; text-transform: uppercase;`;
const Title = styled.h2`margin: 0 0 7px; font: 600 clamp(30px, 7vw, 48px)/.98 ${theme.serif}; letter-spacing: -.03em;`;
const Author = styled.p`margin: 0 0 13px; color: ${theme.quiet};`;
const Meta = styled.p`margin: 5px 0; color: ${theme.quiet}; font-size: 12px; line-height: 1.45;`;
const Chips = styled.div`display: flex; flex-wrap: wrap; gap: 6px; margin-top: 13px;`;
const Chip = styled.span`border: 1px solid ${theme.line}; border-radius: 999px; padding: 5px 8px; color: ${theme.moss}; font-size: 10px;`;
const Reading = styled.section`margin-top: 22px; padding: 15px; border-radius: 14px; background: ${theme.mossSoft};`;
const Label = styled.strong`display: block; margin-bottom: 9px; color: ${theme.moss}; font-size: 12px;`;
const StateRow = styled.div`display: flex; flex-wrap: wrap; gap: 7px;`;
const State = styled.button`border: 1px solid ${theme.line}; border-radius: 999px; padding: 7px 10px; background: ${theme.paperRaised}; color: ${theme.ink}; cursor: pointer; &[aria-pressed="true"] { border-color: ${theme.moss}; background: ${theme.moss}; color: white; }`;
const Copies = styled.section`margin-top: 24px; padding-top: 20px; border-top: 1px solid ${theme.line};`;
const CopiesTitle = styled.h3`margin: 0 0 5px; font: 600 24px/1 ${theme.serif};`;
const CopiesIntro = styled.p`margin: 0 0 13px; color: ${theme.quiet}; font-size: 12px;`;
const Copy = styled.div`width: 100%; display: flex; align-items: center; justify-content: space-between; gap: 14px; margin-top: 8px; border: 1px solid ${theme.line}; border-radius: 12px; padding: 12px; background: ${theme.paper}; color: ${theme.ink}; &[data-selected="true"] { border-color: ${theme.clay}; box-shadow: inset 0 0 0 1px ${theme.clay}; }`;
const CopySelect = styled.button`flex: 1; border: 0; padding: 0; background: none; color: inherit; cursor: pointer; text-align: left;`;
const CopyOwner = styled.strong`display: block; font-size: 13px;`;
const CopyMeta = styled.span`display: block; margin-top: 3px; color: ${theme.quiet}; font-size: 10px;`;
const OwnerLink = styled.button`border: 0; padding: 0; background: none; color: ${theme.clay}; cursor: pointer; font-size: 11px; font-weight: 750;`;
const Delivery = styled.div`display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-top: 13px;`;
const DeliveryChoice = styled.button`border: 1px solid ${theme.line}; border-radius: 12px; padding: 10px; background: ${theme.paper}; color: ${theme.ink}; cursor: pointer; text-align: left; &[aria-pressed="true"] { border-color: ${theme.moss}; background: ${theme.mossSoft}; }`;
const Actions = styled.div`display: flex; flex-wrap: wrap; gap: 8px; margin-top: 14px;`;
const Note = styled.p`margin: 12px 0 0; color: ${theme.moss}; font-size: 12px; font-weight: 700;`;
const ErrorText = styled.p`margin: 12px 0 0; color: ${theme.clay}; font-size: 12px;`;

const availability = (copy: DiscoverCopy): string => copy.availability === 'pass' ? 'Pass it on' : copy.availability === 'lend' ? 'Available to borrow' : 'Ask to borrow';

export function CanonicalBookSheet({ view, authed, ownBookIds, onClose, onSignIn, onManage, onRequest, onSetUserBook, onViewProfile }: {
  view: PublicBookView; authed: boolean; ownBookIds: Set<string>;
  onClose: () => void; onSignIn: () => void; onManage: () => void;
  onRequest: (book: DiscoverCopy, delivery: 'local' | 'post') => Promise<void>;
  onSetUserBook: (workId: string, state: UserBookState) => Promise<void>;
  onViewProfile: (profileId: string) => void;
}): React.JSX.Element {
  const firstBorrowable = view.copies.find((copy) => !ownBookIds.has(copy.id)) ?? view.copies[0];
  const [selectedId, setSelectedId] = React.useState(firstBorrowable?.id ?? '');
  const [delivery, setDelivery] = React.useState<'local' | 'post'>('local');
  const [busy, setBusy] = React.useState(false);
  const [sent, setSent] = React.useState(false);
  const [state, setState] = React.useState<UserBookState | undefined>(view.userBook?.state);
  const [error, setError] = React.useState('');
  const selected = view.copies.find((copy) => copy.id === selectedId);
  const isOwn = selected ? ownBookIds.has(selected.id) : false;
  React.useEffect(() => { const key = (event: KeyboardEvent): void => { if (event.key === 'Escape') onClose(); }; addEventListener('keydown', key); return () => removeEventListener('keydown', key); }, [onClose]);
  React.useEffect(() => { setSelectedId(firstBorrowable?.id ?? ''); setState(view.userBook?.state); setDelivery('local'); setSent(false); setError(''); }, [view.work.id]);
  const saveState = async (next: UserBookState): Promise<void> => { if (!authed) { onSignIn(); return; } setBusy(true); setError(''); try { await onSetUserBook(view.work.id, next); setState(next); } catch (err) { setError((err as Error).message); } finally { setBusy(false); } };
  const request = async (): Promise<void> => { if (!selected) return; if (!authed) { onSignIn(); return; } setBusy(true); setError(''); try { await onRequest(selected, delivery); setSent(true); } catch (err) { setError((err as Error).message); } finally { setBusy(false); } };
  return <Backdrop onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><Sheet role="dialog" aria-modal="true" aria-labelledby="canonical-title"><Head><Close onClick={onClose} aria-label="Close book">×</Close></Head><Book><BookCover title={view.work.title} url={view.work.coverUrl} width={155} height={228} /><div><Eyebrow>Book</Eyebrow><Title id="canonical-title">{view.work.title}</Title><Author>{view.work.authors.join(', ') || 'Unknown author'}</Author>{view.work.firstPublished ? <Meta>First published {view.work.firstPublished}</Meta> : null}<Meta>{view.work.editionIsbns.length} known edition{view.work.editionIsbns.length === 1 ? '' : 's'}</Meta>{view.work.genres?.length ? <Chips>{view.work.genres.map((genre) => <Chip key={genre}>{genre}</Chip>)}</Chips> : null}</div></Book><Reading><Label>Your reading life</Label><StateRow>{([['want','Want to read'],['reading','Reading'],['read','Read'],['dnf','Did not finish']] as Array<[UserBookState,string]>).map(([value,label]) => <State key={value} aria-pressed={state === value} disabled={busy} onClick={() => void saveState(value)}>{state === value ? '✓ ' : ''}{label}</State>)}</StateRow>{state === 'want' ? <Note>You’ll be notified when a copy becomes available.</Note> : null}</Reading><Copies><CopiesTitle>{view.copies.length ? 'Available copies' : 'No copies available—yet'}</CopiesTitle><CopiesIntro>{view.copies.length ? 'Choose a reader’s copy, then arrange a local handoff or tracked post.' : 'The book still has a home here. Mark it “Want to read” and Shelved will watch for you.'}</CopiesIntro>{view.copies.map((copy) => <Copy key={copy.id} data-selected={selectedId === copy.id}><CopySelect aria-pressed={selectedId === copy.id} onClick={() => setSelectedId(copy.id)}><CopyOwner>{copy.shelfLabel}</CopyOwner><CopyMeta>{availability(copy)}{copy.condition ? ` · ${copy.condition.replace('-', ' ')}` : ''}</CopyMeta></CopySelect><OwnerLink onClick={() => onViewProfile(copy.shelfId)}>View reader</OwnerLink></Copy>)}{selected && !isOwn ? <Delivery><DeliveryChoice aria-pressed={delivery === 'local'} onClick={() => setDelivery('local')}><strong>Meet locally</strong><CopyMeta>Arrange after acceptance</CopyMeta></DeliveryChoice><DeliveryChoice aria-pressed={delivery === 'post'} onClick={() => setDelivery('post')}><strong>Tracked post</strong><CopyMeta>Borrower pays postage</CopyMeta></DeliveryChoice></Delivery> : null}<Actions>{selected ? isOwn ? <PrimaryButton onClick={onManage}>Manage my copy</PrimaryButton> : sent ? <PrimaryButton disabled>Request sent</PrimaryButton> : <PrimaryButton disabled={busy} onClick={() => void request()}>{authed ? 'Ask this reader' : 'Sign in to ask'}</PrimaryButton> : null}<QuietButton onClick={onClose}>Close</QuietButton></Actions>{error ? <ErrorText>{error}</ErrorText> : null}</Copies></Sheet></Backdrop>;
}
