/* ---------------------------------------------------------------------------
 * starter — the happy-path cell template (client half).
 *
 * Hydrate the server-rendered tree (same shared module → identical markup) so
 * the first paint stays put, then go interactive. A real cell would add state
 * and substrate reads/writes here (see cells/lit/client/main.tsx).
 * ------------------------------------------------------------------------- */
import * as React from 'react';
import { hydrateRoot, createRoot } from 'react-dom/client';
import { Starter } from '../shared';

const appRoot = document.getElementById('app')!;
if (appRoot.dataset.ssr === '1') hydrateRoot(appRoot, <Starter />);
else { appRoot.textContent = ''; createRoot(appRoot).render(<Starter />); }
