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
import { createWorkspaceCommands, createSubstrateWriteHandler, createTendHandler, createCellLifecycleHandler, dynamoDeps } from './handlers';

const commands = createWorkspaceCommands(dynamoDeps);

export const handler = defineService({
  name: 'workspace',
  commands,
  events: {
    emits: ['workspace.fact.written', 'workspace.shared', 'workspace.action.invoked', 'workspace.tended'],
    // The organ-to-reef write path: dynamic cells emit substrate.write.requested
    // (source IAM-pinned to cell-<id>); the workspace applies it as a fact in
    // the owner's slice. The daily tend schedule delivers tend.requested.
    // Both wired via PlatformEventBus.routeTo / the TendSchedule rule.
    handles: {
      'substrate.write.requested': createSubstrateWriteHandler(dynamoDeps),
      'workspace.tend.requested': createTendHandler(dynamoDeps),
      // Platform reflected in the substrate: cell lifecycle events project to
      // `cells/<cellId>` pointer facts in the owner's slice.
      'cell.create.requested': createCellLifecycleHandler(dynamoDeps),
      'cell.deployed': createCellLifecycleHandler(dynamoDeps),
      'cell.files.changed': createCellLifecycleHandler(dynamoDeps),
      'cell.delete.requested': createCellLifecycleHandler(dynamoDeps),
    },
  },
});

export default handler;
