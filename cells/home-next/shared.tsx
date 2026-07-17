/* ---------------------------------------------------------------------------
 * home/shared — the isomorphic chrome (server + client import THIS module).
 *
 * home as a tier-2 cell (not a privileged platform service): two faces — a
 * signed-out landing, and the signed-in *workspace view* over the substrate.
 * This module is the presentational chrome (platform/ui, source-bundled); the
 * rich, explorable, type-rendered workspace list is composed on the client via
 * the kernel (loadTypes/titleOf/hrefOf) + @c15r/viewers — see client/main.tsx.
 * ------------------------------------------------------------------------- */
import * as React from 'react';
import { Page, Card, Heading, theme } from './shared/ui';

export interface ViewModel {
  authed: boolean;
}

export function Surface({ vm }: { vm: ViewModel }): React.JSX.Element {
  return (
    <Page>
      <Heading sub={vm.authed ? 'your substrate — salience-shaped, explorable by lens' : 'a personal substrate workspace'}>
        {vm.authed ? 'your workspace' : 'parc.land'}
      </Heading>
      {vm.authed ? null : (
        <Card>
          <p style={{ margin: 0, color: theme.dim, lineHeight: 1.6 }}>
            One substrate, addressed two ways: a human surface here, and an MCP endpoint
            (<code>/mcp</code>) for agents — over the same facts. Sign in to open your workspace.
          </p>
        </Card>
      )}
    </Page>
  );
}
