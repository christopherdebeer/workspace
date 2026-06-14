/* ---------------------------------------------------------------------------
 * starter/shared — the isomorphic surface, shared by server and client.
 *
 * This is the happy-path template for a parc.land cell: ONE React tree rendered
 * to a string on the server (renderToString) and hydrated on the client
 * (hydrateRoot). Because both sides import THIS module, the markup is identical
 * and hydration attaches instead of rebuilding — no first-paint flash.
 *
 * It also shows arbitrary npm working on BOTH sides: `ms` is declared once in
 * client/imports.json, the server bundles it from esm.sh (node target), the
 * browser fetches the same pinned version — so a value it computes is byte-
 * identical and hydrates cleanly.
 * ------------------------------------------------------------------------- */
import * as React from 'react';
import ms from 'ms';

export function Starter(): React.JSX.Element {
  return (
    <main>
      <h1>starter</h1>
      <p>An isomorphic React cell — server-rendered, then hydrated. Copy this as the
        starting point for your own cell.</p>
      <p className="note">
        npm works on both sides: <code>ms('2 days')</code> = {ms('2 days')},{' '}
        <code>ms(86400000)</code> = {ms(86400000)} — declared once in{' '}
        <code>client/imports.json</code>, bundled into the server and fetched by the
        browser at the same pinned version.
      </p>
    </main>
  );
}
