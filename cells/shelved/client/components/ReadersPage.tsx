import * as React from 'react';
import styled from '../../shared/styled';
import { theme } from '../../shared/theme';
import type { DiscoverCopy, PublicProfile, SocialGraph } from '../../shared/types';
import { BookCover } from '../../shared/components/BookCover';
import { Field, PrimaryButton, QuietButton } from '../../shared/components/Layout';

const Hero = styled.section`padding: clamp(38px,7vw,70px) 0 34px;`;
const Eyebrow = styled.p`margin: 0 0 8px; color: ${theme.clay}; font-size: 11px; font-weight: 800; letter-spacing: .1em; text-transform: uppercase;`;
const Heading = styled.h1`margin: 0; font: 500 clamp(42px,8vw,74px)/.95 ${theme.serif}; letter-spacing: -.04em;`;
const Intro = styled.p`max-width: 620px; margin: 16px 0 0; color: ${theme.quiet}; font-size: 16px; line-height: 1.55;`;
const Editor = styled.section`margin-bottom: 24px; padding: 18px; border: 1px solid ${theme.line}; border-radius: 16px; background: ${theme.mossSoft};`;
const EditorTitle = styled.h2`margin: 0 0 5px; font: 600 23px/1 ${theme.serif};`;
const EditorCopy = styled.p`margin: 0 0 13px; color: ${theme.quiet}; font-size: 11px;`;
const Form = styled.div`display: grid; grid-template-columns: 1fr 1fr; gap: 9px; @media (max-width: 620px) { grid-template-columns: 1fr; }`;
const Wide = styled.div`grid-column: 1 / -1;`;
const TextArea = styled.textarea`width: 100%; min-height: 82px; resize: vertical; border: 1px solid ${theme.line}; border-radius: 10px; padding: 11px 12px; background: #fffdf7; color: ${theme.ink};`;
const Grid = styled.div`display: grid; grid-template-columns: repeat(auto-fit,minmax(270px,1fr)); gap: 12px;`;
const Card = styled.article`padding: 18px; border: 1px solid ${theme.line}; border-radius: 16px; background: ${theme.paperRaised};`;
const NameRow = styled.div`display: flex; align-items: start; justify-content: space-between; gap: 12px;`;
const Avatar = styled.div`display: grid; place-items: center; width: 43px; height: 43px; border-radius: 50%; background: ${theme.clay}; color: white; font: 600 21px/1 ${theme.serif};`;
const Name = styled.h2`margin: 0; font: 600 24px/1 ${theme.serif};`;
const Handle = styled.p`margin: 4px 0 0; color: ${theme.quiet}; font-size: 11px;`;
const Bio = styled.p`min-height: 40px; margin: 14px 0; color: ${theme.ink}; font-size: 13px; line-height: 1.5;`;
const Genres = styled.p`margin: 8px 0; color: ${theme.moss}; font-size: 11px;`;
const Shelf = styled.div`display: flex; align-items: end; gap: 7px; min-height: 78px; margin-top: 13px;`;
const CoverButton = styled.button`border: 0; padding: 0; background: none; cursor: pointer;`;
const Empty = styled.p`margin: 15px 0 0; color: ${theme.quiet}; font-size: 11px;`;
const ErrorText = styled.p`color: ${theme.clay}; font-size: 11px;`;

export function ReadersPage({ profiles, books, social, authed, onSignIn, onSaveProfile, onFollow, onOpenBook }: {
  profiles: PublicProfile[]; books: DiscoverCopy[]; social: SocialGraph | null; authed: boolean;
  onSignIn: () => void;
  onSaveProfile: (patch: Partial<PublicProfile>) => Promise<void>;
  onFollow: (profileId: string, follow: boolean) => Promise<void>;
  onOpenBook: (workId: string) => void;
}): React.JSX.Element {
  const current = social?.profile;
  const [form, setForm] = React.useState({ displayName: current?.displayName ?? '', handle: current?.handle ?? '', location: current?.location ?? '', bio: current?.bio ?? '', genres: current?.favouriteGenres?.join(', ') ?? '' });
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState('');
  const genreKey = current?.favouriteGenres?.join('|') ?? '';
  React.useEffect(() => { if (current) setForm({ displayName: current.displayName, handle: current.handle, location: current.location ?? '', bio: current.bio ?? '', genres: current.favouriteGenres?.join(', ') ?? '' }); }, [current?.id, current?.displayName, current?.handle, current?.location, current?.bio, genreKey]);
  const following = React.useMemo(() => new Set(social?.following.map((profile) => profile.id) ?? []), [social?.following]);
  const booksByProfile = React.useMemo(() => {
    const grouped = new Map<string, DiscoverCopy[]>();
    for (const book of books) grouped.set(book.shelfId, [...(grouped.get(book.shelfId) ?? []), book]);
    return grouped;
  }, [books]);
  const field = (key: keyof typeof form) => ({ value: form[key], onChange: (event: React.ChangeEvent<HTMLInputElement>) => setForm((value) => ({ ...value, [key]: event.target.value })) });
  const save = async (): Promise<void> => { setSaving(true); setError(''); try { await onSaveProfile({ displayName: form.displayName, handle: form.handle, location: form.location, bio: form.bio, favouriteGenres: form.genres.split(',').map((value) => value.trim()).filter(Boolean) }); } catch (err) { setError((err as Error).message); } finally { setSaving(false); } };
  return <><Hero><Eyebrow>The people behind the shelves</Eyebrow><Heading>Readers worth following.</Heading><Intro>Follow a shelf because its owner’s taste intrigues you. Their available books and reading life will begin shaping what you discover.</Intro></Hero>{authed && current ? <Editor><EditorTitle>Your reader profile</EditorTitle><EditorCopy>Public and bookish. Your exact address always remains separate.</EditorCopy><Form><Field placeholder="Display name" {...field('displayName')} /><Field placeholder="Handle" {...field('handle')} /><Field placeholder="Broad location, e.g. Edinburgh" {...field('location')} /><Field placeholder="Favourite genres, comma separated" {...field('genres')} /><Wide><TextArea value={form.bio} onChange={(event) => setForm((value) => ({ ...value, bio: event.target.value }))} placeholder="A sentence or two about your reading life" /></Wide><Wide><PrimaryButton disabled={saving} onClick={() => void save()}>{saving ? 'Saving…' : 'Save profile'}</PrimaryButton>{error ? <ErrorText>{error}</ErrorText> : null}</Wide></Form></Editor> : null}<Grid>{profiles.map((profile) => { const shelf = booksByProfile.get(profile.id) ?? []; const isMe = current?.id === profile.id; const isFollowing = following.has(profile.id); return <Card key={profile.id}><NameRow><div style={{ display: 'flex', gap: 10 }}><Avatar>{profile.displayName.slice(0,1).toUpperCase()}</Avatar><div><Name>{profile.displayName}</Name><Handle>@{profile.handle}{profile.location ? ` · ${profile.location}` : ''}</Handle></div></div>{isMe ? <QuietButton disabled>You</QuietButton> : authed ? <QuietButton onClick={() => void onFollow(profile.id, !isFollowing)}>{isFollowing ? 'Following' : 'Follow'}</QuietButton> : <QuietButton onClick={onSignIn}>Sign in to follow</QuietButton>}</NameRow><Bio>{profile.bio || 'A shelf is sometimes the best introduction.'}</Bio>{profile.favouriteGenres?.length ? <Genres>{profile.favouriteGenres.join(' · ')}</Genres> : null}{shelf.length ? <><Shelf>{shelf.slice(0,5).map((book) => <CoverButton key={book.id} onClick={() => book.workId && onOpenBook(book.workId)} aria-label={`Open ${book.title}`}><BookCover title={book.title} url={book.coverUrl} width={46} height={69} /></CoverButton>)}</Shelf><Empty>{shelf.length} available book{shelf.length === 1 ? '' : 's'}</Empty></> : <Empty>No books currently available.</Empty>}</Card>; })}</Grid></>;
}
