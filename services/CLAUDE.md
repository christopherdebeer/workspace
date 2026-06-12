# services/

## Purpose
Independent service cells built on the shared `platform/` library. Each service
owns its Lambda code, persistence, commands, and event contracts. Services never
read another service's database — they call its commands or react to its events.

## Layout
- `auth/` - Auth primitive (ported from c15r/mcp-auth): WebAuthn passkeys + OAuth 2.1 + scoped tokens
  - `service.ts` - `defineService` entry: commands (validateToken/mintToken/listTokens/tokens/revokeToken/describeTools — the last three are the gateway-facing `auth.*` token vocabulary; mintToken narrows to the minter's own scope ceiling) + raw `http` routes (`/oauth/*`, `/webauthn/*`, `/.well-known/*`, `/auth/device*`)
  - `store.ts` - `AuthStore` interface, entity types, crypto helpers
  - `dynamo-store.ts` / `memory-store.ts` - storage implementations (prod / tests+local)
  - `oauth.ts` - OAuth 2.1 handlers (DCR, consent, token, PKCE, refresh, device)
  - `webauthn.ts` - passkey register/authenticate (uses `@simplewebauthn/server`; kept out of unit tests)
  - `ui.ts` - passkey authorize/device-approval HTML page
- `documents/` - Example cell with DynamoDB persistence; calls `render` and emits `document.created`
  - `service.ts` - `defineService({ name, commands, events })` entry (exports `handler`)
  - `handlers.ts` - Command implementations
- `render/` - Minimal peer exposing a single synchronous command

## Conventions
- A service's runtime entry is `service.ts` exporting `handler` (the value
  returned by `defineService`). The matching `HttpServiceCell` in
  `lib/platform-stack.ts` points its `entry` at this file.
- The `name` passed to `defineService` MUST match the `name` in the cell props.
- Command handlers receive `(input, ctx)`; use `ctx.config.tableName`,
  `ctx.serviceClient`, `ctx.events`, `ctx.logger`, and `ctx.identity` rather than
  reaching for globals.
- Use `requireUser(ctx.identity)` to enforce authentication.
- No `any` types; type each command's input and output.

## Adding a service
1. Create `services/<name>/service.ts` + handlers.
2. Add an `HttpServiceCell` in `lib/platform-stack.ts` and pass it to the
   `ServiceRouter`.
3. Grant any synchronous dependencies with `caller.allow(target)`.
