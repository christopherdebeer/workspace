/**
 * What the page looks like before any data has arrived.
 *
 * The server renders exactly this, and the client renders exactly this until
 * its first load resolves — which is what makes hydration clean. It is not a
 * skeleton: these are the REAL components, given empty data and inert
 * handlers. React does not serialise event handlers, so a no-op `onClick`
 * produces byte-identical markup to the live one; and every list here already
 * has an empty state, because it had to handle a reader with nothing on their
 * shelf. So "no data yet" and "no data at all" render the same, and neither
 * needs a second set of components to maintain.
 *
 * Deliberately NOT personalised. Nothing here depends on who is asking, so the
 * response is identical for every visitor and safe to cache at the edge — the
 * alternative, server-rendering the caller's own shelf, makes every page
 * private and one mis-set cache header away from showing one reader's books to
 * the next. Personal content arrives on the client, a beat later, where it
 * belongs.
 */
import * as React from 'react';
import { ThemeProvider } from './styled';
import { GlobalStyle, theme } from './theme';
import { Page, Shell } from './components/Layout';
import { BrandNav } from './components/BrandNav';
import { Discover } from './components/Discover';
import { ShelfHeader } from './components/ShelfHeader';
import { EmptyShelf } from './components/EmptyShelf';

export type ShelvedView = 'discover' | 'shelf' | 'readers';

/** The view a path lands on, resolved the same way on both sides of the wire. */
export function viewForPath(pathname: string): ShelvedView {
  if (pathname === '/readers' || pathname.startsWith('/reader')) return 'readers';
  return 'discover';
}

const noop = (): void => undefined;
const noopAsync = async (): Promise<void> => undefined;

/**
 * The part inside the app frame. Split out because `App` renders its own
 * `ThemeProvider / GlobalStyle / Page / Shell / BrandNav` and would otherwise
 * nest a second copy — which is precisely the markup difference hydration
 * complains about. App renders this body inside its frame; the server renders
 * `FirstPaint`, which is the same body inside an identical frame.
 */
export function FirstPaintBody({ view }: { view: ShelvedView }): React.JSX.Element {
  if (view === 'shelf') {
    return (
      <>
        <ShelfHeader onAdd={noop} />
        <EmptyShelf authed={false} />
      </>
    );
  }
  // `readers` shares this body rather than getting its own: the readers page is
  // a grid of profiles we do not have yet, so its empty first paint is the
  // discover hero either way, and one less surface can drift from the live one.
  return (
    <Discover
      books={[]}
      authed={false}
      onJoin={noop}
      onAdd={noop}
      onManage={noop}
      onOpenBook={noop}
      onViewProfile={noop}
      onLookupIsbn={noopAsync}
    />
  );
}

/** The whole page as the server sends it. Must match `App`'s first render. */
export function FirstPaint({ view }: { view: ShelvedView }): React.JSX.Element {
  return (
    <ThemeProvider theme={theme}>
      <GlobalStyle />
      <Page>
        <Shell>
          <BrandNav
            view={view}
            authed={false}
            onBrowse={noop}
            onShelf={noop}
            onReaders={noop}
            onSignIn={noop}
            onSignOut={noop}
          />
          <FirstPaintBody view={view} />
        </Shell>
      </Page>
    </ThemeProvider>
  );
}
