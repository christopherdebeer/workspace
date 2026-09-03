import * as React from 'react';
import styled from '../styled';
import { theme } from '../theme';

const Nav = styled.header`display: flex; align-items: center; justify-content: space-between; gap: 14px; padding: 9px 0 17px; border-bottom: 1px solid ${theme.line};`;
const Brand = styled.button`display: flex; align-items: center; gap: 9px; border: 0; background: none; padding: 0; color: ${theme.ink}; cursor: pointer;`;
const Mark = styled.span`display: inline-grid; place-items: center; width: 31px; height: 31px; border-radius: 50% 50% 45% 45%; background: ${theme.clay}; color: white; font: 600 18px/1 ${theme.serif};`;
const Word = styled.span`font: 600 24px/1 ${theme.serif}; letter-spacing: -.025em; @media (max-width: 560px) { display: none; }`;
const Links = styled.nav`display: flex; align-items: center; gap: 4px; min-width: 0;`;
const Link = styled.button`border: 0; background: none; padding: 8px 10px; color: ${theme.quiet}; cursor: pointer; font-size: 13px; font-weight: 700; white-space: nowrap; @media (max-width: 560px) { padding: 7px 6px; font-size: 12px; }`;
const Active = styled(Link)`color: ${theme.ink};`;
const SignIn = styled(Link)`border: 1px solid ${theme.line}; border-radius: 999px; color: ${theme.moss};`;
const SignOut = styled(Link)`border: 1px solid ${theme.line}; border-radius: 999px; color: ${theme.clay};`;

export function BrandNav({ view, authed, onBrowse, onShelf, onReaders, onSignIn, onSignOut }: { view: 'discover' | 'shelf' | 'readers'; authed: boolean; onBrowse: () => void; onShelf: () => void; onReaders: () => void; onSignIn: () => void; onSignOut: () => void }): React.JSX.Element {
  return <Nav><Brand onClick={onBrowse} aria-label="Shelved home"><Mark>S</Mark><Word>Shelved</Word></Brand><Links>{view === 'discover' ? <Active onClick={onBrowse}>Browse</Active> : <Link onClick={onBrowse}>Browse</Link>}{view === 'readers' ? <Active onClick={onReaders}>Readers</Active> : <Link onClick={onReaders}>Readers</Link>}{view === 'shelf' ? <Active onClick={onShelf}>My shelf</Active> : <Link onClick={onShelf}>My shelf</Link>}{authed ? <SignOut onClick={onSignOut}>Sign out</SignOut> : <SignIn onClick={onSignIn}>Sign in</SignIn>}</Links></Nav>;
}
