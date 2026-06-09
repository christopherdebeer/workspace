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
import { createWorkspaceCommands, dynamoDeps } from './handlers';

const commands = createWorkspaceCommands(dynamoDeps);

export const handler = defineService({
  name: 'workspace',
  commands,
  events: {
    emits: ['workspace.fact.written', 'workspace.shared', 'workspace.action.invoked'],
  },
});

export default handler;
