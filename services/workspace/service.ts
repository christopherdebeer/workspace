/**
 * Workspace service runtime entry point.
 *
 * The first flagship *room* over the observed-state substrate: each user's
 * workspace is their slice of the one Substrate. Declares the small vocabulary
 * (remember/recall/peek/supersede) over observed state, backed in production by
 * the DynamoDB `StateStore`. See `handlers.ts` and `docs/substrate.md`.
 */
import { defineService } from '../../platform/runtime';
import { createWorkspaceCommands, dynamoStateBuilder } from './handlers';

const commands = createWorkspaceCommands(dynamoStateBuilder);

export const handler = defineService({
  name: 'workspace',
  commands,
  events: {
    emits: ['workspace.fact.written'],
  },
});

export default handler;
