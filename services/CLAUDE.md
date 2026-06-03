# services/

## Purpose
Independent service cells built on the shared `platform/` library. Each service
owns its Lambda code, persistence, commands, and event contracts. Services never
read another service's database — they call its commands or react to its events.

## Layout
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
