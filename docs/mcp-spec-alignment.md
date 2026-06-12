# MCP spec alignment — divergences, underuse, and discoverability

> Prompted by a live observation: an agent hunting for "the parc.land
> substrate" first landed on the legacy ancestors, and the connected server
> showed up in its harness as an inscrutable UUID (`mcp__f5bbef8d-…__read`).
> This document audits the gateway against the MCP spec (2025-06-18): where we
> diverge deliberately, where we were leaving spec affordances unused, and
> which end of the discoverability problem each fix lives on.

## The two ends of naming

The UUID tool prefixes are **client-side**: hosted harnesses (Claude Code on
the web, claude.ai connectors) key a remote server by its registration id
when no friendly name is configured. The server cannot reach into that — but
it controls three identity channels the spec provides, and until now we sent
almost nothing through them:

| Channel | Spec field | Before | Now |
| --- | --- | --- | --- |
| Programmatic name | `initialize → serverInfo.name` | `workspace` (an ancestor's name!) | `parc-substrate` |
| Display name | `serverInfo.title` (2025-06-18) | — | `parc.land substrate` |
| Self-introduction | `initialize → instructions` | — | what the substrate is, the three verbs, where to start (`$catalog` summary), query-over-recall guidance |

`instructions` is the highest-leverage one: it is the only channel a server
has to teach a model what it is *before* the first tool call. Clients inject
it into context — it is exactly the "server description with searchable
keywords" the ergonomics review asked for.

The other half stays with the user: name the server (`parc-substrate`) in the
client/harness registration so tools render as `mcp__parc-substrate__read`.
No server change can do that for you.

## Deliberate divergences (keep them)

- **Three meta-tools + catalog-as-data, not one MCP tool per capability.**
  The spec's natural grain is one named tool per operation; we expose
  `whoami`/`read`/`act` and put all capability in the `target` argument.
  Reason: clients cache `tools/list` at connect, so a new cell/command/tool
  would be invisible until reconnect; the catalog read is always current.
  Cost: harness-level tool search sees only three generic names — mitigated
  by `instructions` and the server name, not abandoned.
- **Capability schemas travel in the catalog, not `tools/list`.** Same
  rationale: the dynamic surface cannot be enumerated statically. The catalog
  now carries `resultSchema` alongside `inputSchema`, and supports
  `{detail:"summary"}` for a grouped, schema-free menu — progressive
  disclosure for the menu itself.
- **Scope-filtered advertising.** Both `tools/list` and the catalog only show
  what the caller's scopes permit. The spec is silent here; we keep it.

## Was missing, now adopted

- `instructions`, `serverInfo.title`, per-tool `title` (see above).
- **Tool `annotations`**: `readOnlyHint: true` on `whoami`/`read`,
  `readOnlyHint: false` on `act` (no `destructiveHint: false` — `cells.delete`
  is genuinely destructive). This is how a client learns blast radius without
  calling.
- **`outputSchema` plumbing** in `defineMcpService`: a tool may declare its
  result shape and `tools/list` advertises it. The gateway's own three verbs
  have open-world results (the envelope depends on the target), so the
  per-capability `resultSchema` in the catalog is the meaningful layer.

## Underutilized spec surface (assessed, not yet adopted)

- **Resources** — the best natural fit we are not using. Facts, views, and
  docs are *exactly* MCP resources: stable URIs (`parc://<owner>/<key>`),
  `resources/list` from registered views, `resources/templates` for key
  lookup. A client could subscribe/attach facts without tool calls. Worth a
  design pass when a second MCP client matters; today every consumer goes
  through `read` anyway.
- **`structuredContent`** (2025-06-18): tool results can return structured
  data alongside the text block when `outputSchema` is declared. Our
  `toContent` returns JSON-as-text only. Low cost to add; do it together with
  validating the declared `resultSchema`s so we don't advertise shapes we
  violate.
- **Prompts** — registered protocols/actions could surface as MCP prompts
  (user-invokable starting points). Niche until a client surfaces them well.
- **Completions** — argument autocomplete for `target` and fact keys. Nice
  for human-driven clients; agents don't use it.
- **Server→client notifications** (`tools/list_changed`, resource
  subscriptions, progress, cancellation): all require the client to hold the
  Streamable HTTP GET/SSE stream. A Lambda Function URL behind CloudFront
  cannot hold one (~30s edge cap; no response streaming on the URL path
  today). This is an *infrastructure* divergence, honestly constrained — the
  change feed (`workspace.changes`) is the substrate-native substitute, and
  polling it is cheap (`sinceSeq:"head"` to start).
- **Pagination of `tools/list`** — moot with three tools; the catalog has its
  own summary/cursor story.

## Recommendations, ranked

1. Done this pass: `instructions` + server naming + annotations + titles +
   catalog `resultSchema`/summary. Deploy and re-test discoverability cold.
2. User-side: rename the server registration to `parc-substrate` in clients.
3. Next code pass: `structuredContent` + result-schema validation in
   `defineMcpService`.
4. Design pass (with the salience-v2 doc): facts/views as MCP resources.
5. Revisit SSE only if/when the transport moves off Function URLs.
