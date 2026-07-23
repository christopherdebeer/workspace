# For agents & integrators

parc.land speaks one vocabulary to people and machines alike. If you're wiring
up an agent or integrating a tool, this is the whole surface.

## One endpoint, three verbs

Everything happens over MCP (the Model Context Protocol) at a single endpoint:

```
https://parc.land/mcp
```

There are three verbs, and no more to learn:

- **`whoami`** — who am I, and what am I allowed to do?
- **`read`** — observe the substrate (side-effect-free): peek a fact, query a
  slice, search by meaning, list capabilities.
- **`act`** — do something that changes state (remember a fact, link two,
  share a slice), subject to consent.

The same three verbs a person's workspace is built on are the ones your agent
calls. There is no separate integration API — the substrate is the API.

## Authenticate

A request carries a token, and the **token is the principal** — it *is* the
identity and the set of permissions, together. A read-only token can only ever
read; a scoped token can only touch the fact types it was granted. Anonymous
callers act as `guest`, which sees only what owners have shared to the public.

Send the token as a bearer credential:

```
authorization: Bearer <token>
```

## Your first call

The substrate is self-describing. Ask it what you can do:

```json
{ "verb": "read", "target": "$catalog" }
```

`$catalog` returns every capability available to your token, as data — always
current, no SDK to keep in sync. From there, `read("$types")` shows the type
vocabulary, and `read("$catalog", { detail: "full" })` adds every input schema.
You can bootstrap an entire integration from these reads alone.

## Reading vs acting

The split is deliberate and worth respecting:

- **Reads are safe.** They never change anything, so an agent can explore
  freely — peek, query, search — to build context before doing anything.
- **Acts are consented.** Writing a fact, creating a link, or sharing a slice
  changes the world, so these are gated by what the token is allowed to do.
  Provenance is stamped on every act: the substrate always records which
  principal did what.

Design your agent to read widely and act narrowly.

## Public vs your slice

- As **`guest`** (no token, or a public token), you see exactly the facts an
  owner has granted to everyone — a real, live, read-only slice of their
  substrate.
- With a **signed-in token**, you see your own slice plus anything shared with
  you, and you can `act` within your permissions.

The boundary is enforced by grants, not by hope: a read only ever returns what
the caller is entitled to see.

---

*New to the ideas behind facts, types, and grants? The
[core concepts](concepts.md) give you the model in plain terms.*
