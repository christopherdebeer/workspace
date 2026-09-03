import * as React from 'react';
import styled from '../styled';
import { theme } from '../theme';
import { Panel, PrimaryButton } from './Layout';
import { PendingRail } from './Pending';

const Empty = styled(Panel)`padding: 54px 22px; text-align: center;`;
const Mark = styled.div`font: 500 46px/1 ${theme.serif}; color: ${theme.clay};`;
const Title = styled.h2`margin: 13px 0 6px; font: 600 23px/1.1 ${theme.serif};`;
const Text = styled.p`max-width: 440px; margin: 0 auto 20px; color: ${theme.quiet}; line-height: 1.55;`;

export function EmptyShelf({ authed, pending, onAdd, onLogin }: { authed: boolean; /** The shelf has not loaded — do not claim it is empty. */ pending?: boolean; onAdd?: () => void; onLogin?: () => void }): React.JSX.Element {
  // "Your shelf is personal" and "Begin with one spine" both assert that there
  // is nothing here. Before the first read comes back that is a guess, and for
  // a reader who does have books it is simply wrong — so while it is pending,
  // hold the same panel and say what is actually happening.
  if (pending) return <Empty aria-busy="true"><Mark>∫</Mark><Title>Opening your shelf.</Title><Text role="status" aria-live="polite">Fetching the books you have shelved.</Text><PendingRail count={3} /></Empty>;
  return <Empty><Mark>∫</Mark><Title>{authed ? 'Begin with one spine.' : 'Your shelf is personal.'}</Title><Text>{authed ? 'Scan the ISBN barcode on a book. Its edition becomes a physical copy you can read, lend, or pass on.' : 'Sign in through parc.land to open the shelf attached to your identity.'}</Text>{authed && onAdd ? <PrimaryButton onClick={onAdd}>scan your first book</PrimaryButton> : onLogin ? <PrimaryButton onClick={onLogin}>sign in</PrimaryButton> : null}</Empty>;
}
