/**
 * Documents service runtime entry point.
 *
 * This is the entire runtime surface of the service: declare the commands and
 * the events it emits. `defineService` produces the Lambda `handler` that the
 * cell's NodejsFunction points at, wiring logging, auth, events, and peer
 * invocation automatically.
 */
import { defineService } from '../../platform/runtime';
import { createDocument, getDocument } from './handlers';

export const handler = defineService({
  name: 'documents',
  commands: {
    createDocument,
    getDocument,
  },
  events: {
    emits: ['document.created'],
  },
});

export default handler;
