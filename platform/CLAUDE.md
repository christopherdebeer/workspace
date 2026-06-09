# platform/

## Purpose
Shared platform library for the serverless multi-project architecture. Provides
reusable CDK constructs (infrastructure) and an in-Lambda runtime library so a
new service needs minimal boilerplate. See `docs/serverless-platform.md`.

## Layout
- `manifest.ts` - Shared `ServiceManifest` / `ServiceRegistry` types (no CDK, no SDK)
- `infra/` - CDK constructs ("Infrastructure Layer")
  - `http-service-cell.ts` - `HttpServiceCell`: Lambda + Function URL + IAM + logs + optional DynamoDB table + manifest
  - `service-router.ts` - `ServiceRouter`: one CloudFront distribution, behaviours generated from manifests
  - `event-bus.ts` - `PlatformEventBus`: shared EventBridge bus
  - `table-factory.ts` - `TableFactory`: standardised DynamoDB tables (pk/sk, on-demand)
  - `substrate-table.ts` - `SubstrateTable`: the shared observed-state store (the "blackboard") — scope-partitioned, GSI'd for inbound edges + typed reads, Streams on; see `docs/substrate-storage.md`
- `runtime/` - In-Lambda library ("Runtime Layer")
  - `define-service.ts` - `defineService`: one handler for HTTP + direct invoke
  - `define-mcp-service.ts` - `defineMcpService`: expose a cell as an MCP tool server
  - `service-client.ts` - Mode 1 synchronous commands
  - `events.ts` - Mode 2 event emission
  - `logger.ts`, `auth.ts`, `config.ts`, `types.ts`
- `ui/` - Shared composable React components for cell front-ends (`platform/ui`)

## Conventions
- No `any` types; define interfaces for all props and contracts.
- The runtime must not force the AWS SDK to load at import time — SDK clients are
  created lazily and are injectable for tests (`__setLambda`, `__setEventBridge`).
- `infra/` may depend on `manifest.ts` but never on `runtime/`.
- Service authors import from `platform/runtime`; infra authors from `platform/infra`.

## Communication modes
1. Commands - `ctx.serviceClient(name).command(...)` (request/response invoke)
2. Events - `ctx.events.emit(type, detail)` (EventBridge)
3. Queues - SQS → worker Lambda (wire per service)

## Testing
Runtime is unit-tested in `tests/platform-runtime.test.ts` using injected SDK
stubs. Infra is validated via `cdk synth PlatformStack`.
