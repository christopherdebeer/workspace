# Frontend Unification: Single Domain, Multi-Page SSR + Hydration

## Decision

Merge MCP auth pages into the sync frontend on a single domain (`sync.parc.land`).
Architecture: multi-page app with per-page SSR (React + styled-components) and
per-page client hydration. No SPA, no client-side router. The server *is* the router.

### What this replaces

- ~750 lines of inline HTML template strings in `mcp/auth.ts`
- Separate `mcp/mcp.ts` HTTP entry point at `mcp.sync.parc.land`
- Duplicated CSS, vanilla JS WebAuthn flows
- The current client-side SPA (`frontend/index.tsx` + React Router)

### What we gain

- Single domain: `sync.parc.land` handles everything
- Type-safe JSX templating (replaces template strings)
- Shared design system via styled-components
- Progressive enhancement: forms work without JS, hydration adds interactivity
- Each page is independent: own component tree, own client bundle, own hydration
- Navigation is `<a href>`. It's just the web.

---

## Architecture

### Server-side rendering pattern

Each page follows the same shape:

```typescript
// In main.ts route handler
import { renderToString } from "react-dom/server";
import { ServerStyleSheet } from "styled-components";
import { ManagePage } from "./frontend/pages/manage/ManagePage.tsx";

const sheet = new ServerStyleSheet();
const html = renderToString(sheet.collectStyles(<ManagePage vault={vault} />));
const css = sheet.getStyleTags();

return new Response(shell({ html, css, props: { vault }, entry: "/frontend/pages/manage/client.tsx" }));
```

### Per-page hydration

```typescript
// frontend/pages/manage/client.tsx
import { hydrateRoot } from "react-dom/client";
import { ManagePage } from "./ManagePage.tsx";

const props = JSON.parse(document.getElementById("__PROPS__")!.textContent!);
hydrateRoot(document.getElementById("root")!, <ManagePage {...props} />);
```

### Shell function

```typescript
// shell() emits:
<html>
  <head>${css}</head>          <!-- styled-components extracted CSS -->
  <body>
    <div id="root">${html}</div>
    <script id="__PROPS__" type="application/json">${serializedProps}</script>
    <script type="module" src="${entry}"></script>
  </body>
</html>
```

### File structure

```
frontend/
  shell.ts                — HTML wrapper (head, props injection, script tag)
  theme.ts                — styled-components theme tokens, shared
  components/             — shared across pages (Card, Button, StatusText, Toast...)
  pages/
    landing/
      LandingPage.tsx     — isomorphic component
      client.tsx          — hydrateRoot entry
    dashboard/
      DashboardPage.tsx   — isomorphic component
      client.tsx          — hydrateRoot entry
    docs/
      DocPage.tsx         — isomorphic component
      client.tsx          — hydrateRoot entry
    authorize/
      AuthorizePage.tsx   — OAuth sign-in/register + consent
      client.tsx          — hydrateRoot entry
    manage/
      ManagePage.tsx      — Vault, passkeys, recovery management
      client.tsx          — hydrateRoot entry
    recover/
      RecoverPage.tsx     — Recovery token → new passkey
      client.tsx          — hydrateRoot entry
```

---

## Domain Unification

### Merging mcp/mcp.ts into main.ts

The MCP HTTP handler becomes a function imported by `main.ts`, not a separate entry point.

```typescript
// main.ts
import { handleMcpRequest } from "./mcp/mcp.ts";

// In the route handler, before room routes:
if (url.pathname.startsWith("/mcp") ||
    url.pathname.startsWith("/oauth/") ||
    url.pathname.startsWith("/webauthn/") ||
    url.pathname.startsWith("/manage") ||
    url.pathname.startsWith("/recover") ||
    url.pathname.startsWith("/vault") ||
    url.pathname.startsWith("/.well-known/oauth")) {
  return handleMcpRequest(req);
}
```

`mcp/mcp.ts` changes from `export default async function` to
`export async function handleMcpRequest(req: Request): Promise<Response>`.

### What changes for MCP clients

- MCP server URL: `mcp.sync.parc.land` → `sync.parc.land` (or `sync.parc.land/mcp`)
- OAuth discovery URLs: issuer changes to `https://sync.parc.land`
- Claude.ai connector config needs updating
- Existing tokens should survive (same DB, validation doesn't check issuer)

### What stays the same

- All API endpoints (paths unchanged)
- SQLite database (shared, same as today)
- WebAuthn RP ID (`parc.land` — domain-level, unaffected)
- Token format and validation

---

## Route Map (after unification)

| Path | Method | Handler | Page/Response |
|------|--------|---------|---------------|
| `/` | GET | main.ts | SSR LandingPage |
| `/?room=X` | GET | main.ts | SSR DashboardPage |
| `/?doc=X` | GET | main.ts | SSR DocPage |
| `/manage` | GET | main.ts → mcp | SSR ManagePage |
| `/recover` | GET | main.ts → mcp | SSR RecoverPage |
| `/oauth/authorize` | GET | main.ts → mcp | SSR AuthorizePage |
| `/mcp` | POST | main.ts → mcp | MCP JSON-RPC |
| `/oauth/*` | POST | main.ts → mcp | OAuth API |
| `/webauthn/*` | POST | main.ts → mcp | WebAuthn API |
| `/manage/api/*` | * | main.ts → mcp | Management API |
| `/recover/*` | POST | main.ts → mcp | Recovery API |
| `/vault` | * | main.ts → mcp | Vault API |
| `/.well-known/*` | GET | main.ts → mcp | OAuth discovery |
| `/rooms/*` | * | main.ts | Room API |
| `/frontend/*` | GET | main.ts | Module proxy (esm.town) |
| `/reference/*` | GET | main.ts | Reference docs |

---

## Design System

### Unified theme

Adopt the sync dashboard palette as the single source of truth. The MCP pages'
slightly different dark theme (#0a0a0f vs #0d1117, #4a4aff vs #58a6ff) converges
to the dashboard variables.

```typescript
// frontend/theme.ts
export const theme = {
  bg: '#0d1117',
  fg: '#c9d1d9',
  dim: '#484f58',
  border: '#21262d',
  accent: '#58a6ff',
  green: '#3fb950',
  yellow: '#d29922',
  red: '#f85149',
  surface: '#161b22',
  surface2: '#1c2129',
  purple: '#bc8cff',
  orange: '#f0883e',
  // Landing/docs (light default, dark media query)
  landing: { ... },
};
```

### Shared components

```
frontend/components/
  Card.tsx          — Surface container
  Button.tsx        — Primary, secondary variants
  StatusText.tsx    — Status/error messages
  Toast.tsx         — Toast notifications
  TokenBadge.tsx    — Token type badges (room/agent/view)
  PasskeyChip.tsx   — Passkey credential display
  VaultTable.tsx    — Token vault table with actions
```

---

## WebAuthn

### ESM import (replaces UMD script tag)

```typescript
import {
  startRegistration,
  startAuthentication,
} from "https://esm.sh/@simplewebauthn/browser@13";
```

This is client-only — used in hydration scripts, not in SSR.

### Shared hook

```typescript
// frontend/hooks/useWebAuthn.ts
export function useWebAuthn(origin: string) {
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  // signIn(): Promise<string | null>  — returns sessionId
  // register(username): Promise<{ sessionId } | null>
  return { signIn, register, status, error, setError };
}
```

### Progressive enhancement

WebAuthn requires JS (browser API). Forms that don't need WebAuthn can work
without JS via `<form method="POST" action="...">`. The server handles the POST,
re-renders the page with updated state.

Pages that require WebAuthn (all three MCP pages):
- Server renders the initial state (sign-in form, token input, etc.)
- Client hydration adds the WebAuthn interaction
- Without JS: page renders but WebAuthn buttons are inert (acceptable — passkeys
  require JS anyway)

---

## Implementation Sequence

### Phase 1: Infrastructure

1. Create `frontend/shell.ts` — SSR HTML wrapper
2. Create `frontend/theme.ts` — shared design tokens
3. Create `frontend/components/` shared components
4. Verify `styled-components` ServerStyleSheet works in Val.town Deno runtime

### Phase 2: Migrate existing pages to SSR

5. Convert LandingPage to SSR + hydration (replaces SPA)
6. Convert DashboardPage to SSR + hydration
7. Convert DocPage to SSR + hydration
8. Remove React Router dependency
9. Update main.ts to SSR each page

### Phase 3: Domain unification

10. Convert `mcp/mcp.ts` from default export to named export
11. Import handleMcpRequest in main.ts, add route delegation
12. Test all MCP endpoints work on sync.parc.land
13. Update OAuth discovery metadata (issuer URL)

### Phase 4: MCP auth pages as React SSR

14. Create RecoverPage.tsx (simplest — proof of pattern)
15. Create ManagePage.tsx (medium complexity)
16. Create AuthorizePage.tsx (most complex — OAuth flow critical path)
17. Create client.tsx hydration entries for each
18. Create useWebAuthn hook
19. Add authorize params validation endpoint (`GET /oauth/authorize/params`)

### Phase 5: Cleanup

20. Delete inline HTML templates from mcp/auth.ts (~600 lines)
21. Delete CSS constant
22. Delete escapeHtml function
23. Remove mcp/mcp.ts as HTTP entry point (becomes plain module)
24. Update MCP client configs (Claude.ai connector)
25. Test OAuth flow end-to-end

---

## Risks & Mitigations

| Risk | Severity | Mitigation |
|------|----------|------------|
| styled-components ServerStyleSheet fails in Deno | High | Test early in Phase 1. Fallback: inline `<style>` tags |
| WebAuthn ESM import differs from UMD behavior | High | Test isolated. Fallback: keep UMD script tag in shell |
| MCP clients break when domain changes | High | Keep mcp.sync.parc.land redirect → sync.parc.land |
| SSR cold start adds latency | Medium | Templates are small, renderToString is fast. Monitor |
| OAuth authorize page fails mid-flow | High | Test with Claude.ai connector. Keep old handlers on branch |
| Hydration mismatch (server/client render differ) | Low | Keep components deterministic, no browser-only logic in render |

---

## Testing Checklist

### SSR basics
- [ ] Shell renders valid HTML with extracted CSS
- [ ] Props serialize/deserialize correctly via `__PROPS__` script tag
- [ ] Hydration attaches without mismatch warnings
- [ ] Pages render correctly without JS (progressive enhancement)
- [ ] Module proxy serves client.tsx entries correctly

### Domain unification
- [ ] MCP JSON-RPC works at sync.parc.land/mcp
- [ ] OAuth discovery returns correct issuer
- [ ] WebAuthn RP ID unchanged (parc.land)
- [ ] Existing tokens validate correctly
- [ ] mcp.sync.parc.land redirects (or 404s cleanly)

### Page-specific (same as original plan)
- [ ] RecoverPage: token → verify → register passkey → success
- [ ] ManagePage: sign in → vault table, passkeys, recovery tokens
- [ ] AuthorizePage: sign in/register → consent → redirect with code
- [ ] LandingPage: renders, Mermaid diagrams work
- [ ] DashboardPage: polling, tab panels, surfaces
- [ ] DocPage: markdown rendering

### Cross-cutting
- [ ] Mobile responsive
- [ ] No console errors
- [ ] styled-components CSS in SSR output (no FOUC)
- [ ] Toast notifications work after hydration
