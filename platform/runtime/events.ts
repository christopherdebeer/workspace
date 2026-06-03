/**
 * Event emission (communication Mode 2).
 *
 * Publishes domain events to the shared EventBridge bus. Emitting is
 * fire-and-forget from the caller's perspective: subscribers are wired in
 * infrastructure, not here. The AWS client is created lazily so modules that
 * only need types/dispatch can be imported without the SDK, and so tests can
 * inject a stub.
 */
import type { EventBridge } from 'aws-sdk';

export interface EventEmitterOptions {
  /** Service name used as the EventBridge `Source`. */
  source: string;
  /** Target event bus name. When absent, emitting is a no-op (logged upstream). */
  busName?: string;
  correlationId?: string;
}

export interface Events {
  emit(detailType: string, detail: Record<string, unknown>): Promise<void>;
}

// Lazily-instantiated singleton; overridable for tests via __setEventBridge.
let client: EventBridge | undefined;

export function __setEventBridge(stub: EventBridge | undefined): void {
  client = stub;
}

function getClient(): EventBridge {
  if (!client) {
    // Require lazily so importing this module never forces the SDK to load.
    const AWS = require('aws-sdk') as typeof import('aws-sdk');
    client = new AWS.EventBridge();
  }
  return client;
}

export function createEvents(options: EventEmitterOptions): Events {
  return {
    async emit(detailType, detail): Promise<void> {
      if (!options.busName) {
        // No bus configured (e.g. local invoke); nothing to publish.
        return;
      }
      await getClient()
        .putEvents({
          Entries: [
            {
              EventBusName: options.busName,
              Source: options.source,
              DetailType: detailType,
              Detail: JSON.stringify({ ...detail, correlationId: options.correlationId }),
            },
          ],
        })
        .promise();
    },
  };
}
