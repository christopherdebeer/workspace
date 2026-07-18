/**
 * Fact fan-out — the ONE physical origin of "a fact changed".
 *
 * The third consumer on the SubstrateTable's DynamoDB stream (beside the vector
 * indexer and the analytics archiver): every genuine fact write is announced as
 * a `workspace.fact.written` EventBridge event (Source `workspace`, the same
 * envelope the reaction reactor has always consumed), derived from the stream
 * instead of hand-emitted at each write site.
 *
 * Before this Lambda, the logical change event had no chokepoint: `state.put`
 * did not announce, so ~10 independent call sites re-emitted by hand and a new
 * write path that forgot the emit silently broke reactions/subscriptions/
 * machines while trajectory, analytics, and the vector index kept working
 * (they ride this same stream). Now the announcement cannot be forgotten —
 * whatever writes the table announces, including paths that never emitted
 * before (`ingest` bulk writes, work leases, the projection patcher's
 * non-underscore writes if any appear).
 *
 * The plan is pure and enforces the reactor's input contract at the origin:
 *  - facts only (`sk` = `KEY#…`; edges/trajectory/seq rows never announce);
 *  - no `_`-prefixed keys (vocabulary/system writes never react — the same
 *    guard the reactor applies, applied here so its no-op invocations aren't
 *    paid per write);
 *  - no REMOVEs (a TTL reap is not a write) and no superseded images
 *    (retirement isn't an announcement — the reactor no-ops on them);
 *  - MODIFYs announce only on a **revision change**: `put` bumps `revision`,
 *    while `recordTouch` (read counters) and `supersede` do not, so touch
 *    bumps and retirements are filtered structurally, not by field allowlist.
 *
 * The chain bound is unchanged: the reactor caps on the triggering fact's own
 * `revision` vs each subscription's `maxDepth` (default 50), and the revision
 * rides the stream image — a reaction's write reappears here at revision+1, so
 * the fixpoint stays bounded with no event-carried depth.
 */
import { DynamoDB } from 'aws-sdk';
import { createEvents } from '../../platform/runtime/events';

const unmarshall = DynamoDB.Converter.unmarshall;

/** Minimal shape of a DynamoDB stream record (avoids an @types/aws-lambda dep). */
interface StreamRecord {
  eventName?: 'INSERT' | 'MODIFY' | 'REMOVE';
  dynamodb?: { NewImage?: Record<string, unknown>; OldImage?: Record<string, unknown> };
}
interface StreamEvent {
  Records?: StreamRecord[];
}

/** The fact attributes the fan-out reads off an unmarshalled item. */
interface FactItem {
  sk?: string;
  scope?: string;
  key?: string;
  revision?: number;
  superseded?: boolean;
}

export interface FactWrittenDetail {
  scope: string;
  key: string;
  revision: number;
}

/** Pure: reduce a stream batch to the `workspace.fact.written` announcements it
 *  implies — the testable core of the fan-out (mirrors `planStreamWork` in the
 *  vector indexer). */
export function planFactEvents(event: StreamEvent): FactWrittenDetail[] {
  const out: FactWrittenDetail[] = [];
  for (const r of event.Records ?? []) {
    if (r.eventName === 'REMOVE') continue; // a TTL reap is not a write
    const img = r.dynamodb?.NewImage ? (unmarshall(r.dynamodb.NewImage as DynamoDB.DocumentClient.AttributeMap) as FactItem) : null;
    if (!img || typeof img.sk !== 'string' || !img.sk.startsWith('KEY#')) continue; // facts only
    if (typeof img.scope !== 'string' || typeof img.key !== 'string') continue;
    if (img.key.startsWith('_')) continue; // vocabulary/system writes never react
    if (img.superseded) continue; // retirement isn't an announcement
    const old = r.dynamodb?.OldImage ? (unmarshall(r.dynamodb.OldImage as DynamoDB.DocumentClient.AttributeMap) as FactItem) : null;
    // Only a revision change is a write: recordTouch and supersede leave
    // `revision` untouched, so touch bumps and retirements filter out here.
    if (r.eventName === 'MODIFY' && old && Number(old.revision) === Number(img.revision)) continue;
    out.push({ scope: img.scope, key: img.key, revision: Number(img.revision ?? 0) });
  }
  return out;
}

export async function handler(event: StreamEvent): Promise<void> {
  const busName = process.env.EVENT_BUS_NAME;
  if (!busName) return; // bus not configured → no-op (safe)
  const events = createEvents({ source: 'workspace', busName });
  for (const detail of planFactEvents(event)) {
    await events.emit('workspace.fact.written', { ...detail });
  }
}
