/**
 * Shared service manifest types.
 *
 * A manifest is the single source of truth that describes a service: the
 * public routes it owns, the synchronous commands it exposes for
 * service-to-service invocation, and the events it emits. Both the
 * infrastructure layer (to generate routing/IAM) and the runtime layer (to
 * validate dispatch) depend on these shapes, so they live in a neutral module
 * that pulls in neither CDK nor the AWS SDK.
 */

/** Events published by a service onto the shared event bus. */
export interface ManifestEvents {
  emits: string[];
}

/** Public, versioned description of a single service cell. */
export interface ServiceManifest {
  /** Stable service identifier, e.g. "documents". Used for discovery + IAM. */
  name: string;
  /** Semantic version of the service contract. */
  version: string;
  /** CloudFront path patterns owned by this service, e.g. "/documents/*". */
  routes: string[];
  /** Synchronous commands callable via direct Lambda invoke. */
  commands: string[];
  /** Asynchronous events the service emits. */
  events: ManifestEvents;
}

/**
 * A registry maps service name -> resolvable Lambda function name. It is
 * injected into a cell's environment as JSON so the runtime serviceClient can
 * resolve a peer without hardcoded ARNs.
 */
export type ServiceRegistry = Record<string, string>;
