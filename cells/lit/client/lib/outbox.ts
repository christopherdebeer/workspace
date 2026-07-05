/** lit joins the sync seam (ADR-0059 Inc 2 / ADR-0053): every fact write
 *  stages through the kernel outbox — canonical-JSON dedupe, debounced batch
 *  flush, retry with backoff, echo windows for the live-sync tick. `via:'lit'`
 *  is the provenance. Save-state surfaces as a `lit:save-state` window event
 *  (the boot code renders it as the save dot). */
import { createOutbox } from 'https://parc.land/@c15r/kernel/app.js';
import { act } from './substrate.ts';

export const outbox = createOutbox(act as (t: string, i: Record<string, unknown>) => Promise<unknown>, {
  via: 'lit',
  onState: (state: string) => {
    try { window.dispatchEvent(new CustomEvent('lit:save-state', { detail: { state } })); } catch { /* non-DOM */ }
  },
});
