# Serverless Multi-Project Platform

A serverless architecture for hosting many independent projects on AWS behind a
single public entrypoint, while sharing a routing layer and platform library.
Each project ("service cell") is independently deployable, independently
persistent, and communicates with peers through explicit contracts — never
across each other's databases.

This document describes the architecture **and** how it is implemented in this
repository.

## High-level architecture

```
                         app.example.com
                                │
                                ▼
                       CloudFront Router          (platform/infra/service-router.ts)
                                │
                ┌───────────────┼───────────────┐
                ▼               ▼               ▼
           documents          render          ...           (services/*, HttpServiceCell)
          Lambda URL        Lambda URL
                │               │
                ▼               ▼
            DynamoDB         (stateless)
                └───────────────┬───────────────┘
                                ▼
                          EventBridge bus          (platform/infra/event-bus.ts)
```

## Layout

```
platform/
  manifest.ts            Shared ServiceManifest / registry types
  infra/                 CDK constructs (the "Infrastructure Layer")
    http-service-cell.ts   Lambda + Function URL + IAM + logs + table + manifest
    service-router.ts      One CloudFront distribution, behaviours from manifests
    event-bus.ts           Shared EventBridge bus
    table-factory.ts       Standardised DynamoDB tables (pk/sk, on-demand)
  runtime/               In-Lambda library (the "Runtime Layer")
    define-service.ts      Wraps commands into one Lambda handler (HTTP + invoke)
    service-client.ts      Mode 1: synchronous command invocation
    events.ts              Mode 2: emit domain events
    logger.ts              Structured, correlation-aware logging
    auth.ts                Edge-normalised identity
    config.ts              Environment-backed config

services/
  documents/             Example cell: DynamoDB + Turso flag, calls render, emits
  render/                Example peer: a single synchronous command

lib/platform-stack.ts    Wires the example services + router (< 50 lines)
```

## Runtime model

A service author writes only command handlers and a one-call definition:

```ts
// services/documents/service.ts
export const handler = defineService({
  name: 'documents',
  commands: { createDocument, getDocument },
  events: { emits: ['document.created'] },
});
```

`defineService` returns a single Lambda handler that understands two
invocation styles:

1. **HTTP** (Function URL behind CloudFront): `POST /<service>/<command>` with a
   JSON body dispatches to the command. `GET /<service>/_manifest` returns the
   manifest for discovery.
2. **Direct invoke** (service-to-service): a `{ __command, payload }` envelope
   routes straight to the command and returns `{ ok, result }`.

Each command receives a `ServiceContext` with `logger`, `events`,
`serviceClient`, `config`, and the normalised `identity` — so handlers never
touch the AWS SDK or `process.env` directly.

## Communication modes

| Mode | Mechanism | Helper | Use when |
|------|-----------|--------|----------|
| 1. Commands | Lambda request/response invoke | `ctx.serviceClient(name).command(...)` | a response is required, low latency |
| 2. Events | EventBridge `PutEvents` | `ctx.events.emit(type, detail)` | loose coupling, multiple subscribers |
| 3. Queues | SQS → worker Lambda | (wire per service) | retries, long-running, rate limiting |

Service discovery is **manifest-driven**: `HttpServiceCell` publishes a manifest
(name, version, routes, commands, emits) and the router generates its behaviours
from those routes. For synchronous calls, `cell.allow(peer)` grants
least-privilege `lambda:InvokeFunction` and injects the peer into the caller's
`SERVICE_REGISTRY`, which `serviceClient` resolves at runtime — no hardcoded
ARNs.

## Infrastructure model

A new service is a sub-50-line construct instantiation:

```ts
const documents = new HttpServiceCell(this, 'DocumentService', {
  name: 'documents',
  entry: serviceEntry('documents'),
  routes: ['/documents/*'],
  persistence: { dynamo: true, turso: true },
  commands: ['createDocument', 'getDocument'],
  emits: ['document.created'],
  eventBus,
});
documents.allow(render);            // documents may invoke render, not vice versa
new ServiceRouter(this, 'Router', { cells: [documents, render] });
```

Each cell owns its Lambda, Function URL, IAM role, log group, and (optionally) a
DynamoDB table. The router is the only public ingress and stays intentionally
"dumb": TLS, routing, and caching — no business logic.

### Persistence

- **DynamoDB** — provisioned per cell via `TableFactory` (single-table-friendly
  `pk`/`sk` schema, on-demand billing) for high-scale mutable state, event
  sourcing, and job queues.
- **Turso/libSQL** — relational data. Turso is an external service, so the
  platform does not provision it; `persistence: { turso: true }` sets a marker
  and the connection settings (`TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN`) are
  injected via `environment` (typically from Secrets Manager) and surfaced on
  `ctx.config.turso`.

## Observability

Every service emits the same structured log shape automatically:

```json
{ "service": "documents", "correlationId": "…", "traceId": "…",
  "level": "info", "message": "document created", "time": "…" }
```

Correlation IDs are read from `x-correlation-id` (or generated) and threaded
through events and downstream command invokes.

## Deploying

The platform lives in its own CloudFormation stack and deploys independently of
the existing app stacks:

```bash
npm run build
npx cdk deploy PlatformStack
```

The stack output `Router/DistributionDomain` is the public entrypoint; each
cell also outputs its manifest and Function URL.

## Security posture (current vs. production)

- Function URLs are `authType: NONE` and fronted by CloudFront. They are
  reachable directly but unadvertised. Production hardening would restrict
  origin access (OAC/IAM) so only CloudFront can reach a cell.
- DynamoDB tables use `RemovalPolicy.DESTROY` to match the repo's existing
  non-production posture; flip `retain` in `TableFactory` for production.
- Inter-service permissions are explicit and least-privilege via `cell.allow()`.
