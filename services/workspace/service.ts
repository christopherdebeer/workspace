/**
 * Workspace service runtime entry point.
 *
 * The first flagship *room* over the observed-state substrate: each user's
 * workspace is their slice of the one Substrate. Declares the vocabulary
 * (remember/recall/peek/query/link/neighbors/changes/attention/supersede +
 * sharing) over observed state, backed in production by the shared substrate
 * table. See `handlers.ts`, `docs/substrate.md`, `docs/substrate-storage.md`.
 */
import { defineService } from '../../platform/runtime';
import { createWorkspaceCommands, createSubstrateWriteHandler, createTendHandler, createMachineTickHandler, createCellLifecycleHandler, createDataFileMirrorHandler, createFactReactionHandler, createReindexHandler, createCapabilityTouchHandler, dynamoDeps } from './handlers';

const commands = createWorkspaceCommands(dynamoDeps);

export const handler = defineService({
  name: 'workspace',
  commands,
  events: {
    emits: [
      'workspace.fact.written',
      'workspace.shared',
      'workspace.action.invoked',
      'workspace.tended',
      'workspace.ingested',
      'workspace.grant.requested',
      'workspace.grant.resolved',
      // The async, chunked reindex chains continuation events to itself (ADR-0030/0031).
      'workspace.reindex.requested',
    ],
    // The organ-to-reef write path: dynamic cells emit substrate.write.requested
    // (source IAM-pinned to cell-<id>); the workspace applies it as a fact in
    // the owner's slice. The daily tend schedule delivers tend.requested.
    // Both wired via PlatformEventBus.routeTo / the TendSchedule rule.
    handles: {
      'substrate.write.requested': createSubstrateWriteHandler(dynamoDeps),
      'workspace.tend.requested': createTendHandler(dynamoDeps),
      // The machine tick: a frequent cron resumes machine runs whose `wait`-rail
      // deadline has elapsed (the autonomous half of the wait primitive).
      'machine.tick.requested': createMachineTickHandler(dynamoDeps),
      // The reaction reactor: every fact change is delivered back here so the
      // slice's `_subscriptions/*` can invoke matching declared actions — the
      // generic primitive that makes machines (and anything else) reactive.
      'workspace.fact.written': createFactReactionHandler(dynamoDeps),
      // Platform reflected in the substrate: cell lifecycle events project to
      // `cells/<cellId>` pointer facts in the owner's slice.
      'cell.create.requested': createCellLifecycleHandler(dynamoDeps),
      'cell.deployed': createCellLifecycleHandler(dynamoDeps),
      'cell.files.changed': createCellLifecycleHandler(dynamoDeps),
      'cell.delete.requested': createCellLifecycleHandler(dynamoDeps),
      // ADR-0027 Inc 2: a cell data blob mirrors into a `file` fact in the uploader's slice.
      'cell.data.changed': createDataFileMirrorHandler(dynamoDeps),
      // ADR-0030/0031: the async, chunked semantic-search backfill — one page per
      // invocation, chaining itself until the slice is embedded + similarTo-linked.
      'workspace.reindex.requested': createReindexHandler(dynamoDeps),
      // ADR-0085 Inc 0: the gateway announces each successful dispatch; apply it
      // as an actor-classed touch on the target's `_caps/<target>` fact, so used
      // capabilities accrue salience and rise through recall.
      'capability.invoked': createCapabilityTouchHandler(dynamoDeps),
    },
  },
});

export default handler;
