import * as React from 'react';
import styled from '../../shared/styled';
import { theme } from '../../shared/theme';
import type { AddBookInput, Availability, Edition, ReadingState } from '../../shared/types';
import { Field, PrimaryButton, QuietButton, Select } from '../../shared/components/Layout';
import { BookCover } from '../../shared/components/BookCover';
import { BrowserIsbnScanner } from '../scanner/browserScanner';
import { read } from '../lib/substrate';

const Backdrop = styled.div`position: fixed; inset: 0; z-index: 20; display: grid; place-items: end center; background: rgba(24,31,25,.58);`;
const Sheet = styled.section`width: min(100%, 620px); max-height: 92svh; overflow: auto; padding: 18px 18px max(22px, env(safe-area-inset-bottom)); border-radius: 22px 22px 0 0; background: ${theme.paper}; box-shadow: 0 -20px 60px rgba(0,0,0,.24);`;
const Head = styled.div`display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 14px;`;
const Title = styled.h2`margin: 0; font: 600 25px/1 ${theme.serif};`;
const Close = styled.button`border: 0; background: none; color: ${theme.quiet}; font-size: 28px; cursor: pointer;`;
const Camera = styled.div`position: relative; aspect-ratio: 4/3; border-radius: 14px; overflow: hidden; background: #17251c; margin-bottom: 14px;`;
const Video = styled.video`width: 100%; height: 100%; object-fit: cover;`;
const Guide = styled.div`position: absolute; inset: 24% 9%; border: 2px solid ${theme.gold}; border-radius: 10px; box-shadow: 0 0 0 999px rgba(0,0,0,.22);`;
const Hint = styled.p`margin: 8px 0 14px; color: ${theme.quiet}; font-size: 13px; line-height: 1.5;`;
const Row = styled.div`display: grid; grid-template-columns: 1fr auto; gap: 8px;`;
const Form = styled.div`display: grid; gap: 10px;`;
const Pair = styled.div`display: grid; grid-template-columns: 1fr 1fr; gap: 10px;`;
const Label = styled.label`display: grid; gap: 5px; color: ${theme.quiet}; font-size: 11px; font-weight: 700; letter-spacing: .06em; text-transform: uppercase;`;
const ErrorText = styled.p`margin: 8px 0; color: ${theme.clay}; font-size: 13px;`;

const clean = (value: string): string => value.toUpperCase().replace(/[^0-9X]/g, '');

export function IsbnCapture({ onClose, onAdd }: { onClose: () => void; onAdd: (book: AddBookInput) => Promise<void> }): React.JSX.Element {
  const videoRef = React.useRef<HTMLVideoElement>(null);
  const scannerRef = React.useRef<BrowserIsbnScanner | null>(null);
  const [isbn, setIsbn] = React.useState('');
  const [edition, setEdition] = React.useState<Edition | null>(null);
  const [title, setTitle] = React.useState('');
  const [authors, setAuthors] = React.useState('');
  const [readingState, setReadingState] = React.useState<ReadingState>('unread');
  const [availability, setAvailability] = React.useState<Availability>('private');
  const [scanning, setScanning] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState('');

  React.useEffect(() => () => scannerRef.current?.stop(), []);

  React.useEffect(() => {
    if (!scanning || !videoRef.current) return;
    const scanner = new BrowserIsbnScanner();
    scannerRef.current = scanner;
    void scanner.start(videoRef.current, (code) => void lookup(code)).catch((err: Error) => {
      setScanning(false);
      setError(err.name === 'NotAllowedError' ? 'Camera permission was declined. You can still type the ISBN below.' : err.message);
    });
    return () => scanner.stop();
  }, [scanning]);

  const lookup = async (raw: string): Promise<void> => {
    const value = clean(raw);
    if (value.length !== 10 && value.length !== 13) { setError('Enter a 10 or 13 digit ISBN.'); return; }
    setBusy(true); setError(''); setScanning(false); scannerRef.current?.stop();
    try {
      const result = await read<{ edition: Edition }>('@c15r/shelved.lookup_isbn', { isbn: value });
      setEdition(result.edition); setIsbn(result.edition.isbn); setTitle(result.edition.title); setAuthors(result.edition.authors.join(', '));
    } catch (err) { setError((err as Error).message || 'That ISBN could not be resolved.'); }
    finally { setBusy(false); }
  };

  const startCamera = async (): Promise<void> => {
    setError(''); setEdition(null); setScanning(true);
  };

  const save = async (): Promise<void> => {
    if (!edition || !title.trim()) return;
    setBusy(true); setError('');
    try {
      await onAdd({ ...edition, title: title.trim(), authors: authors.split(',').map((a) => a.trim()).filter(Boolean), readingState, availability });
      onClose();
    } catch (err) { setError((err as Error).message || 'Could not add the book.'); setBusy(false); }
  };

  return <Backdrop role="presentation" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}><Sheet role="dialog" aria-modal="true" aria-labelledby="scan-title"><Head><Title id="scan-title">Add a book</Title><Close onClick={onClose} aria-label="Close">×</Close></Head>{scanning ? <Camera><Video ref={videoRef} muted playsInline /><Guide /></Camera> : null}{!edition ? <><Hint>{scanning ? 'Hold the barcode steady inside the frame.' : 'Point your camera at the barcode on the back, or type the ISBN.'}</Hint><Row><Field inputMode="numeric" autoComplete="off" value={isbn} onChange={(e) => setIsbn(e.target.value)} placeholder="978…" onKeyDown={(e) => { if (e.key === 'Enter') void lookup(isbn); }} /><PrimaryButton disabled={busy} onClick={() => void lookup(isbn)}>{busy ? 'finding…' : 'find book'}</PrimaryButton></Row><div style={{ display: 'flex', gap: 8, marginTop: 10 }}><QuietButton onClick={() => void startCamera()} disabled={scanning}>▣ scan barcode</QuietButton>{scanning ? <QuietButton onClick={() => setScanning(false)}>stop</QuietButton> : null}</div></> : <Form><BookCover title={edition.title} url={edition.coverUrl} width={104} height={154} /><Label>Title<Field value={title} onChange={(e) => setTitle(e.target.value)} /></Label><Label>Author(s)<Field value={authors} onChange={(e) => setAuthors(e.target.value)} /></Label><Pair><Label>Reading<Select value={readingState} onChange={(e) => setReadingState(e.target.value as ReadingState)}><option value="unread">Unread</option><option value="reading">Reading</option><option value="read">Read</option><option value="want">Want</option></Select></Label><Label>Who can ask?<Select value={availability} onChange={(e) => setAvailability(e.target.value as Availability)}><option value="private">Just me</option><option value="ask">Ask me</option><option value="lend">Happy to lend</option><option value="pass">Pass it on</option></Select></Label></Pair><PrimaryButton disabled={busy} onClick={() => void save()}>{busy ? 'adding…' : 'put on my shelf'}</PrimaryButton><QuietButton onClick={() => setEdition(null)}>scan another ISBN</QuietButton></Form>}{error ? <ErrorText>{error}</ErrorText> : null}</Sheet></Backdrop>;
}
