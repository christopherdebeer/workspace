/**
 * Service client (communication Mode 1: synchronous commands).
 *
 * Resolves a peer service to its Lambda function name via the injected
 * SERVICE_REGISTRY and performs a request/response invoke carrying a command
 * envelope. Use for low-latency calls where a response is required; prefer
 * events or queues for fan-out and long-running work.
 */
import type { Lambda } from 'aws-sdk';
import type { ActorClass, PrincipalPosture } from './auth';

/** Envelope recognised by `defineService` to route a direct invoke to a command. */
export interface CommandEnvelope {
  __command: string;
  payload: unknown;
  correlationId?: string;
  /** Identity propagated from the calling service, if any. */
  user?: string;
  /**
   * The caller's token scopes, propagated with the user. Trusted on the same
   * basis as `user`: only allow-listed peers can invoke, and the originating
   * cell validated the bearer itself (the gateway is the PEP). Needed wherever
   * the callee applies the `effective = grants ∩ token` ceiling (e.g. the auth
   * cell narrowing a minted token to the minter's own standing).
   */
  scopes?: string[];
  /** The token's grant ceiling, propagated so the callee can tell a self-serve
   *  widen (within grant) from a hard denial (incremental authorization). */
  grantScopes?: string[];
  /** The caller's token id, so a session can mutate its own effective scope
   *  (`auth.focusScope`/`auth.requestScope`). */
  tokenId?: string;
  /** The embodiment class behind the call (ADR-0022 mediation), propagated so a
   *  downstream cell's attention accounting matches what the edge validated. */
  actor?: ActorClass;
  /** The caller's adopted posture (ADR-0074), propagated so a downstream read
   *  resolves through the same principal the edge validated. */
  posture?: PrincipalPosture;
}

export interface ServiceClientOptions {
  registry: Record<string, string>;
  correlationId?: string;
  user?: string;
  scopes?: string[];
  grantScopes?: string[];
  tokenId?: string;
  actor?: ActorClass;
  posture?: PrincipalPosture;
}

export class ServiceInvokeError extends Error {
  constructor(message: string, readonly service: string) {
    super(message);
    this.name = 'ServiceInvokeError';
  }
}

export interface ServiceHandle {
  command<T = unknown>(name: string, payload: unknown): Promise<T>;
}

let client: Lambda | undefined;

export function __setLambda(stub: Lambda | undefined): void {
  client = stub;
}

function getClient(): Lambda {
  if (!client) {
    const AWS = require('aws-sdk') as typeof import('aws-sdk');
    client = new AWS.Lambda();
  }
  return client;
}

export function createServiceClient(options: ServiceClientOptions) {
  return function serviceClient(target: string): ServiceHandle {
    const functionName = options.registry[target];
    if (!functionName) {
      throw new ServiceInvokeError(
        `Service "${target}" is not in the registry; is it listed in allow[]?`,
        target,
      );
    }

    return {
      async command<T = unknown>(name: string, payload: unknown): Promise<T> {
        const envelope: CommandEnvelope = {
          __command: name,
          payload,
          correlationId: options.correlationId,
          user: options.user,
          scopes: options.scopes,
          grantScopes: options.grantScopes,
          tokenId: options.tokenId,
          actor: options.actor,
          posture: options.posture,
        };
        const result = await getClient()
          .invoke({
            FunctionName: functionName,
            InvocationType: 'RequestResponse',
            Payload: JSON.stringify(envelope),
          })
          .promise();

        if (result.FunctionError) {
          throw new ServiceInvokeError(
            `Invoke of ${target}.${name} failed: ${result.FunctionError}`,
            target,
          );
        }

        const raw = typeof result.Payload === 'string' ? result.Payload : result.Payload?.toString();
        if (!raw) return undefined as T;
        const parsed = JSON.parse(raw) as { ok: boolean; result?: T; error?: string };
        if (parsed.ok === false) {
          throw new ServiceInvokeError(
            `${target}.${name} returned an error: ${parsed.error}`,
            target,
          );
        }
        return parsed.result as T;
      },
    };
  };
}
