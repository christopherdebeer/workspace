import * as React from 'react';
import styled from '../styled';
import { theme } from '../theme';
import { Panel, PrimaryButton } from './Layout';

const Empty = styled(Panel)`padding: 54px 22px; text-align: center;`;
const Mark = styled.div`font: 500 46px/1 ${theme.serif}; color: ${theme.clay};`;
const Title = styled.h2`margin: 13px 0 6px; font: 600 23px/1.1 ${theme.serif};`;
const Text = styled.p`max-width: 440px; margin: 0 auto 20px; color: ${theme.quiet}; line-height: 1.55;`;

export function EmptyShelf({ authed, onAdd, onLogin }: { authed: boolean; onAdd?: () => void; onLogin?: () => void }): React.JSX.Element {
  return <Empty><Mark>∫</Mark><Title>{authed ? 'Begin with one spine.' : 'Your shelf is personal.'}</Title><Text>{authed ? 'Scan the ISBN barcode on a book. Its edition becomes a physical copy you can read, lend, or pass on.' : 'Sign in through parc.land to open the shelf attached to your identity.'}</Text>{authed && onAdd ? <PrimaryButton onClick={onAdd}>scan your first book</PrimaryButton> : onLogin ? <PrimaryButton onClick={onLogin}>sign in</PrimaryButton> : null}</Empty>;
}
