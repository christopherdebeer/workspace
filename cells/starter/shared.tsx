/* ---------------------------------------------------------------------------
 * starter/shared — the isomorphic surface (server + client import THIS module).
 *
 * The canonical cell reference: ONE React tree rendered to a string on the
 * server (renderToString) and hydrated on the client (hydrateRoot), built from
 * the shared `platform/ui` kit (the `@parc/ui` virtual module (ADR-0044 Inc 3),
 * so it renders the SAME components with this cell's own React on both sides).
 * Presentational only — no hooks/handlers here, so server markup === first
 * client render (no flash). Interactivity, auth and substrate live in client/.
 * ------------------------------------------------------------------------- */
import * as React from 'react';
import { marked } from 'marked';
import { Page, Card, Heading, Badge, theme } from '@parc/ui';

/** A `note` fact, the type this cell manages — `{ text }` markdown. */
export interface Note {
  key: string;
  text: string;
}
/** The serialized first-paint state the server hands the client to hydrate. */
export interface ViewModel {
  authed: boolean;
  notes: Note[];
}

marked.setOptions({ gfm: true, breaks: false });
/** npm on both sides: `marked` is pinned once in client/imports.json; the server
 *  bundles it from esm.sh (node), the browser fetches the same pin — identical
 *  output, so hydration matches. */
export function renderMd(md: string): string {
  return marked.parse(md.replace(/\r\n/g, '\n'), { async: false });
}

export function Surface({ vm }: { vm: ViewModel }): React.JSX.Element {
  return (
    <Page>
      <Heading sub="the canonical cell — kernel · platform/ui · types · viewers · isomorphic SSR">
        @c15r/starter
      </Heading>
      <Card>
        <p style={{ margin: 0, color: theme.dim, fontSize: '0.9rem', lineHeight: 1.6 }}>
          A reference surface over the substrate. The notes below are <b>note</b> facts — the
          <i> same</i> facts an agent reads via <code>workspace.query</code> and writes via{' '}
          <code>workspace.remember</code>. One substrate, two modalities: the surface↔MCP duality.
        </p>
      </Card>
      {vm.notes.length === 0 ? (
        <Card>
          <p style={{ margin: 0, color: theme.dim }}>
            {vm.authed ? 'No notes yet — add one below.' : 'Sign in to read and add notes.'}
          </p>
        </Card>
      ) : (
        vm.notes.map((n) => (
          <Card key={n.key}>
            <div style={{ marginBottom: '0.5rem' }}>
              <Badge tone="dim">{n.key}</Badge>
            </div>
            <div className="note-body" data-key={n.key} dangerouslySetInnerHTML={{ __html: renderMd(n.text) }} />
          </Card>
        ))
      )}
    </Page>
  );
}
