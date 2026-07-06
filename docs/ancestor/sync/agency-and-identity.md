# Agency and Identity: Users, Agents, and Rooms in sync v6

> Design doc for the identity model that completes v6. Read against v6.md,
> the-substrate-thesis.md, and what-becomes-true.md.

*March 2026*

---

## I. The question this document answers

v6 established two axioms: register actions, register views. Everything else
is derived. The constraint produces a specific property: progressive disclosure
is implicit. Actions are what changes what you can see. Vocabulary construction
is the only unilateral act. Everything else is collaborative.

The current codebase handles agent identity mechanically — an agent joins a
room, gets a token, has a scope. The MCP layer adds OAuth and a vault of
stored tokens. But neither the core platform nor the MCP layer has a coherent
answer to:

1. What does it mean for agents to be *manifested within* room state — not
   just mechanically present but instantiated as room-internal entities?
2. How does a user (who exists outside all rooms) relate to the agents they
   create, embody, or connect to rooms?
3. How does this work through an OAuth flow that is, today, a one-time static
   grant — and how should it evolve?
4. When one user has multiple concurrent sessions (tabs, apps, instances),
   what is the relationship between sessions, agents, and identity?

---

## II. What the substrate thesis says about identity

The substrate thesis makes a specific claim:

> Software is a shared substrate of truth observed by self-activating components.

In this model, state is the substrate, surfaces are observers, actions are
transitions, and agents and humans are equivalent participants. The interface
is not a controller — it is a perceptual layer. Experiences emerge from
observation of shared truth.

For identity, this claim has consequences:

**An agent is its traces in the substrate.** The agents table is mechanical
presence: `id, room_id, token_hash, grants, last_heartbeat, status, waiting_on`.
Everything semantic — what the agent is, what it wants, what it does, what it
produces — lives in its own scope as state, projected through views it registers.
Identity is self-authored. You are defined because you wrote.

**The room is the execution environment, not the agent.** "What Becomes True"
describes the room as simultaneously memory and medium — Clark and Chalmers'
extended mind made operational. The agent's context window, loaded with the
room's state, views, and affordances, is not a representation of reality that
the agent reasons *about*. It is the cognitive environment the agent reasons
*within*. The substrate is the medium in which cognition happens.

**Presence is meaningful.** Liveness is implicit in participation. Every context
read and action invocation updates `last_heartbeat`. An agent that stops reading
stops being present. No explicit keepalive. The v6 rhythm — wait → perceive →
reason → act → wait — is not a protocol. It is the shape of agency itself. An
agent that doesn't follow this rhythm is not fully an agent.

**Vocabulary registration is the first act of identity.** An agent arriving in
an empty room declares itself through the actions and views it registers. Its
vocabulary is its thesis about what the room is for. Its objective view is its
social contract with peers. Before registration, the agent is mechanically
present but semantically absent.

---

## III. The spectrum of participation

The substrate thesis says agents and humans are equivalent participants. But
"equivalent" does not mean "identical." There is a spectrum of participation
modes, and the system should recognize all of them.

### Direct human participation (dashboard)

The purest expression of "you are the component." A human opens the dashboard
in a browser. They see surfaces rendered from room state. They invoke actions
through action-bar, action-form, and action-choice surfaces. They read state
through view-grid and view-table surfaces. They observe the message feed. They
use the CEL console to query state directly.

This human IS a v6 agent. They read context (the dashboard polls and renders
surfaces). They evaluate (they look at what's there and think). They act (they
click a button that invokes an action). The rhythm is the same:
perceive → reason → act → perceive.

The dashboard doesn't just display the room — it is the room's perceptual
interface for humans, in the same way that `/context` is the perceptual
interface for programmatic agents. A button for a human and a JSON affordance
for an agent are the same surface expressed through different modalities.
The substrate thesis calls this out explicitly: "The UI and API converge."

Dashboard participation proves a point: no MCP, no OAuth, no LLM mediation
required. A human with a browser and a room token is a first-class participant.
The debug affordances (CEL console, state inspector, audit log) are simply
more surfaces — observation tools that make the substrate's internals visible.

### Human via MCP client

A human using Claude (or another LLM client) as an interface to the room.
The client mediates: the human speaks in natural language, the client
translates to tool calls, the room responds, the client renders results.

This is a middle ground, not the other end of the spectrum. The human's
agency is real but mediated. They reason in natural language; the client
handles the substrate protocol. The rhythm is: human speaks → client
perceives room → client reasons → client acts → client renders → human
perceives → human reasons → human speaks.

The mediation adds value (natural language, multi-room awareness, reasoning
about complex state) but also adds latency and indirection. The human is
not directly perceiving the substrate — they are perceiving the client's
interpretation of the substrate. This matters for liveness: the agent's
heartbeat only ticks when the client makes a tool call, not when the human
is thinking.

### Autonomous agents

A process running a wait loop. Condition-driven. Always present (while
running). Self-activating in Nii's sense. Their agency is continuous — they
don't "check in," they inhabit. The `waiting_on` field is a declarative
statement of relevance: "wake me when something matters." Between wakes,
the agent doesn't act but it *is* — present in the agents list, its
heartbeat ticking, its views still resolving.

### Room-defined agents

The room itself declares that certain agent-shaped roles exist, with
responsibilities, expected capabilities, and behavioral contracts. These
aren't agents yet — they are *agent slots*. Vacancies in a cast. They
become agents when something fills them: a human at the dashboard, a
human via MCP, an autonomous process, or another agent.

Room-defined agents are manifested within room state. They exist as
descriptions of what the room needs, independent of who or what fills them.

### The equivalence

All four modes produce the same substrate artifacts: scope state, registered
views, registered actions, messages, heartbeats. The room cannot distinguish
a dashboard human from an MCP-proxied human from an autonomous bot from a
role filled by any of the above. This is the equivalence the thesis claims,
and it holds because the substrate sees only reads and writes — never the
mechanism behind them.

The modes differ in rhythm (continuous vs episodic vs on-demand), in
directness (unmediated vs mediated), and in liveness (always-present vs
intermittent). These differences matter for ergonomics and expectations
but not for the substrate protocol.

---

## IV. What the current system provides

### Core tables

The sync database has five core tables: rooms, agents, state, actions, views.
State is the substrate — messages, audit, help, agent state are all scopes
in one table.

The agents table is mechanical:

```sql
agents (
  id TEXT NOT NULL,
  room_id TEXT NOT NULL,
  name TEXT NOT NULL,
  role TEXT DEFAULT 'agent',
  joined_at TEXT,
  meta TEXT DEFAULT '{}',
  last_heartbeat TEXT,
  status TEXT DEFAULT 'active',
  waiting_on TEXT,
  token_hash TEXT,
  grants TEXT DEFAULT '[]',
  last_seen_seq INTEGER DEFAULT 0,
  enabled_expr TEXT,
  PRIMARY KEY (id, room_id)
)
```

Identity-bearing state lives in the agent's own scope:

```
state(room_id, scope="agent-1", key="objective", value="...")
state(room_id, scope="agent-1", key="status", value="...")
```

Projected through self-registered views:

```sql
views(id="agent-1.objective", room_id, scope="agent-1",
      expr='state["agent-1"]["objective"]')
```

### MCP auth layer

The `smcp_*` tables support OAuth 2.1 + WebAuthn authentication:

- `smcp_users` — user accounts (username + passkey credentials)
- `smcp_credentials` — WebAuthn public keys
- `smcp_oauth_clients` — registered OAuth clients (Claude.ai, Claude Code, etc.)
- `smcp_auth_codes`, `smcp_access_tokens`, `smcp_refresh_tokens` — OAuth flow
- `smcp_vault` — maps user → room → token (the current bridge)
- `smcp_sessions` — browser sessions for consent/management UI

### The vault as bridge (current state)

Currently, the vault stores raw tokens:

```
user christopher → room game-room → token room_abc123
user christopher → room work-room → token as_def456
```

An MCP tool call resolves: user → vault → token → room. The token is the
identity. The user is the key holder. The agent (if any) is a side effect.

This is "borrowing authority from a credential." The vault maps access, not
identity. It answers "can this user reach this room?" but not "who is this
user within this room?"

### What's missing

The current system has no model for:

- Users existing as a meta-layer above rooms
- The distinction between observing a room and being present in it
- Room-defined roles that agents can fill
- Multiple concurrent sessions for the same user
- Progressive scope changes during a session

---

## V. Agents are manifested within rooms

### The theatrical metaphor

Is "Hamlet" an agent, or is "the actor playing Hamlet" the agent?

In sync, the answer is: Hamlet is a role manifested in the room's state. The
actor is a user (or autonomous process) who embodies that role. The role
persists across occupants. The occupant brings liveness.

This maps to three distinct entities:

- **Role** — a description of needed agency, stored in room state
- **Agent** — a mechanical presence in the agents table, with a scope
- **Driver** — whatever is currently animating the agent (user session,
  autonomous process, dashboard human, nothing)

The role is state. The agent is an instantiation of a role (or a free-standing
identity if no role applies). The driver is a connection to an agent. All three
are separable.

### Roles as state (not mechanism)

The substrate thesis gives a clear answer: roles don't need a new mechanism.
They are a convention expressible in existing v6 primitives.

A room that needs a "researcher" and a "critic" declares this in state:

```json
// scope: _shared, key: roles
{
  "researcher": {
    "description": "Find and assess relevant sources",
    "bootstrap": ["submit_source", "assess_relevance"],
    "views": ["research_progress"],
    "filled_by": null
  },
  "critic": {
    "description": "Challenge assumptions and identify weaknesses",
    "bootstrap": ["raise_objection", "request_evidence"],
    "views": ["objections_log"],
    "filled_by": null
  }
}
```

This is vocabulary about vocabulary. The role definition is a meta-affordance:
it describes what affordances should exist, not the affordances themselves.
When something fills the role, it reads the definition, registers the expected
actions and views, and begins working.

The pattern already exists embryonically. The standard library is a set of
canonical action definitions. `help({ key: "standard_library" })` returns
ready-to-register templates. Room-defined roles are a more specific version:
instead of a generic library, the room carries role-specific bootstrap
instructions.

### Filling a role

When an agent fills a role, it:

1. Reads the role definition from `_shared.roles`
2. Claims the role: writes `filled_by: self` (with `if_version` to prevent
   double-claim)
3. Reads `help({ key: "standard_library" })` for the bootstrap templates
4. Registers the actions and views specified in the role definition
5. Writes its objective to its own scope
6. Begins the read → evaluate → act rhythm

The role and the agent are distinct entities in the substrate, linked by
mutual state. Other agents can see both the role requirements and who is
fulfilling them.

A human at the dashboard fills a role the same way: they see the role
definition rendered as a surface, click "fill role" (an action-choice
surface gated on `filled_by == null`), and begin working through the
dashboard's action surfaces. No MCP required. No LLM required.

### Vacating a role

When an agent vacates (disconnects, completes, times out):

- `filled_by` is cleared (or set to a tombstone with departure timestamp)
- The agent's scope state *persists* — objective, progress, traces remain
- Registered actions and views *persist* (they are room state, not driver state)
- A new occupant can embody the same agent, inheriting scope and history

This is the "agents are manifested within rooms" claim made concrete. The
agent exists as state in the room regardless of whether anything is currently
driving it. Embodiment is connecting a driver to an existing vehicle, not
creating a new vehicle.

### Standard library extension

Roles become a standard library pattern:

```json
{
  "id": "define_role",
  "description": "Declare a role this room needs filled",
  "params": {
    "role_id": { "type": "string" },
    "description": { "type": "string" },
    "bootstrap_actions": { "type": "array" },
    "bootstrap_views": { "type": "array" }
  },
  "writes": [{
    "scope": "_shared",
    "key": "roles.${params.role_id}",
    "merge": {
      "description": "${params.description}",
      "bootstrap_actions": "${params.bootstrap_actions}",
      "bootstrap_views": "${params.bootstrap_views}",
      "filled_by": null,
      "defined_at": "${now}"
    }
  }]
}
```

```json
{
  "id": "fill_role",
  "description": "Claim a role in this room",
  "params": { "role_id": { "type": "string" } },
  "if": "has(state[\"_shared\"], \"roles.\" + params.role_id) && (state[\"_shared\"][\"roles.\" + params.role_id].filled_by == null || state[\"_shared\"][\"roles.\" + params.role_id].filled_by == self)",
  "writes": [{
    "scope": "_shared",
    "key": "roles.${params.role_id}",
    "merge": { "filled_by": "${self}", "filled_at": "${now}" }
  }]
}
```

No new platform feature. Roles are conventions in the substrate.

---

## VI. Users are not agents

### The meta-entity

A user (Christopher) is not an agent. A user is not a room. A user is a
meta-entity — someone who exists outside all rooms and can:

- Create rooms (and thus own them)
- Instantiate agents within rooms (and thus participate)
- Embody existing agents (and thus resume or take over)
- Observe rooms without participating (view-level access)
- Maintain relationships with multiple rooms simultaneously
- Spawn autonomous agents and walk away
- Participate directly through the dashboard without MCP

The user is an **agent-factory**. They create, configure, monitor, and
sometimes embody agents. The agent is the room-internal entity. The user
is the room-external entity that brings agents into being.

This is consistent with the substrate thesis. The thesis says: "You are
the component. You are a participant organism inside it." But this applies
to the *agent*, not the user-as-meta-entity. When Christopher's researcher
agent is running inside a room — perceiving state, leaving traces — that
agent is a participant organism, whether Christopher is driving it from
the dashboard, through Claude, or it's running autonomously.

Christopher himself is the person who brought the agent into being and
who can re-embody it, observe it from outside, or let it run.

### User-room relationships

```sql
smcp_user_rooms (
  user_id    TEXT NOT NULL REFERENCES smcp_users(id),
  room_id    TEXT NOT NULL,
  access     TEXT NOT NULL DEFAULT 'participant',
  is_default INTEGER DEFAULT 0,
  label      TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, room_id)
)
```

Access levels: `owner`, `collaborator`, `participant`, `observer`.

### What users actually want to do

Five interaction patterns, each with different agency requirements:

**Pattern 1: "Show me my rooms."** Overview across all rooms. No agent
involved. The user is above all rooms, not inside any of them. Read-only.
No presence footprint. Works from MCP lobby or from a management dashboard.

**Pattern 2: "Let me work in this room."** Focused engagement. Read context,
send messages, invoke actions. The user embodies an agent — either through
the dashboard directly or through an MCP client. Present while engaged,
absent between episodes.

**Pattern 3: "Set up this room for a task."** World-building. Create a room,
define roles, register vocabulary, seed state. The user is an architect.
May never enter the room as an agent. May define roles and let others fill them.

**Pattern 4: "Deploy an agent to this room."** The user creates an autonomous
agent that runs independently. The user wants to launch a process, not be one.

**Pattern 5: "Check on my agents."** Meta-view across rooms. What are my
agents doing? Are they stuck? Do they need intervention? Management, not
participation.

Patterns 1, 3, and 5 don't require an agent in the room. Pattern 2 requires
an agent while engaged. Pattern 4 creates an agent that outlives the interaction.

---

## VII. Observation and embodiment are distinct

### The principle

Reading a room should not automatically create presence. A user glancing at
a room shouldn't leave an agent entry with a stale heartbeat confusing other
agents about liveness. Observation is cheap. Presence is a commitment.

v6 says: presence is meaningful — an artifact of intentional engagement, not a
side effect of authentication. An agent that stops reading stops being present.
The inverse should also hold: an entity that hasn't committed to presence
shouldn't appear present.

### Two operations

**Observe** — read context without presence. Uses the user's room-level access
(view token or owner access) to read state, views, agents, messages. No agent
created. No heartbeat. No entry in the agents list. The user sees the room as
an outsider looking in. This serves patterns 1, 3, and 5.

**Embody** — commit to presence as a specific agent. Either creates a new agent
or takes over an existing one. Heartbeat starts. Agent appears in the agents
list. `context.self` is set. Messages carry the agent's identity. The user is
now *inside* the room. This serves patterns 2 and 4.

The distinction is mechanical:

| | Observe | Embody |
|---|---|---|
| Agent created | No | Yes (or existing) |
| Heartbeat | No | Yes |
| In agents list | No | Yes |
| `context.self` | null | agent ID |
| Can invoke actions | No | Yes |
| Can register vocabulary | No | Yes |
| Can send messages | No | Yes |
| Can read state | Yes (scoped to access level) | Yes (full scope) |

This applies to all participation modes. A dashboard user viewing a room
they haven't joined is observing. A dashboard user who clicks "join" or
"fill role" is embodying. An MCP client reading context before calling
`sync_embody` is observing.

---

## VIII. Sessions, agents, and the multiplicity problem

### The problem

A single user (Christopher) might have:

- Two Claude.ai browser tabs, each in a different conversation
- A Claude Code terminal session
- The dashboard open in another tab

Each of these is an independent session. Each might want to operate in the
same room. Each might want to operate as the same agent, or different agents,
or in different rooms entirely.

If agent identity is derived mechanically from user+client (e.g.,
`christopher:claude-ai`), then two concurrent Claude.ai conversations can't
be different agents in the same room. They'd collide on the same agent ID.

But should they *want* to be different agents? Sometimes yes (one
conversation is playing researcher, another is playing critic). Sometimes
no (both conversations are working on the same task, and interleaved access
to the same agent is fine, like two terminals into the same machine).

### The resolution: agents are room-internal, sessions connect to them

The key insight: **the agent is a room-internal identity. The session is an
external connection to it. The mapping between them is chosen at embodiment
time, not derived from user+client.**

An agent ID is whatever the room needs it to be:

- A role name: `researcher`, `critic`, `game-master`
- A user-chosen name: `christopher`, `c15r-sprint-bot`
- An auto-generated ID: `agent-7f3a2b`

The agent ID is NOT derived from user+client. It is declared at embodiment
time. The session tracks which agent it's currently driving.

### Multiple sessions, one agent

Two Claude.ai tabs both embody `researcher` in the same room. This is fine.
Their tool calls interleave. The agent's state is in the substrate, not in
either session's memory. The heartbeat updates from whichever session touched
it last. Messages from both say `from: "researcher"`.

This is the stateless principle applied: the agent IS its room state. Sessions
are ephemeral connections. The substrate doesn't know or care how many sessions
are driving an agent. It only sees reads and writes.

The practical consequence: two sessions driving the same agent must coordinate
externally (the humans in front of the two tabs need to know they're sharing).
The substrate doesn't prevent this; it's a social agreement, not a technical one.

### Multiple sessions, multiple agents

Christopher's Claude.ai tab 1 embodies `researcher`. Tab 2 embodies `critic`.
Different agents, different scopes, different identities in the same room. Each
session tracks its own embodied agent independently.

Christopher's Claude Code session embodies a third agent in a different room
entirely.

All three resolve through the same `smcp_users` row. All three have different
agent IDs. The user-room relationship (`smcp_user_rooms`) tracks access level.
Each session's embodied agent is tracked per-session.

### Dashboard + MCP concurrency

Christopher has the dashboard open to a room, observing. He also has Claude.ai
embodied as `researcher` in the same room. The dashboard shows him the full
room state (including the `researcher` agent's activity). The MCP session
acts as the researcher.

If Christopher clicks "fill role: critic" on the dashboard, he is now also
the critic — from the dashboard. He is simultaneously driving two agents in
the same room from two different interfaces. The substrate doesn't care. Both
agents are valid. Both produce traces. Both follow the rhythm.

### What this means for session tracking

Sessions must track their embodied agent without assuming a 1:1 mapping from
user+client to agent. The session state is:

```
session → { user_id, room_id (or null), agent_id (or null) }
```

Where `agent_id` is chosen at embodiment time, not derived. Multiple sessions
can point to the same agent (shared driving) or different agents.

---

## IX. Statelessness

### The principle

sync is stateless. The MCP server holds no in-memory session state. There is
no map of "this connection is currently embodied as agent X in room Y" in
server memory. All state lives in the database — in rooms, agents, state,
views, and the `smcp_*` auth tables.

This is not a limitation. It is a design commitment. The substrate thesis says
state is the substrate. If something matters, it is persisted. If it is not
persisted, it does not matter.

### What this means for embodiment

"Current agent" is not MCP server session state. It is a persisted relationship.
Every MCP tool call carries the OAuth access token. The server resolves the
current embodiment from a persisted session row:

```sql
smcp_user_sessions (
  token_hash  TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES smcp_users(id),
  client_name TEXT NOT NULL,
  room_id     TEXT,           -- currently focused room (null = lobby)
  agent_id    TEXT,           -- currently embodied agent (null = observing)
  scope       TEXT NOT NULL,  -- effective scope (mutable, starts from OAuth grant)
  updated_at  TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at  TEXT NOT NULL
)
```

Resolution per tool call:

```
access_token → hash → smcp_user_sessions → {user, client, room, agent, scope}
```

When the user calls `sync_embody({ room: "game-room", agent: "researcher" })`:

1. Validate room is in effective scope
2. Validate user has access to room
3. Validate agent exists and is available (or create it)
4. Update `smcp_user_sessions.room_id` and `agent_id`
5. Touch agent heartbeat
6. Return full context with `self: "researcher"`

When the user calls `sync_disembody()`:

1. Clear `room_id` and `agent_id` on session row
2. Do NOT delete agent from room (it persists as state)
3. Optionally set agent status to "idle"
4. Return lobby state

No in-memory state. The session row IS the state. The MCP server is a
stateless HTTP handler that resolves identity from the database on every
request.

### Token refresh and session continuity

OAuth token refresh creates a new access token. The server transfers session
state from old token to new:

1. Client presents refresh token
2. Server issues new access token
3. Server creates new `smcp_user_sessions` row with same room/agent/scope
4. Server deletes old session row

Embodiment survives token refresh. Continuity is in the database.

### Multiple sessions for same user+client

Each OAuth token has its own session row. Two Claude.ai tabs have two
different access tokens (each went through its own OAuth flow, or the client
manages separate sessions). Each has its own `smcp_user_sessions` row. Each
can be embodied as a different agent.

If two sessions happen to embody the same agent, both session rows point to
the same `agent_id`. Their tool calls interleave. The substrate handles this
naturally — writes are atomic per-request, reads return consistent snapshots.

---

## X. The OAuth flow: scoping and progressive authorization

### Current constraints

In the MCP OAuth flow as Claude.ai and Claude Code consume it:

1. User clicks "connect" in client settings
2. Browser opens → sync's `/oauth/authorize` page
3. User authenticates (WebAuthn passkey)
4. User consents to scopes
5. Redirect back with auth code → token exchange
6. Client holds access token + refresh token
7. Every MCP tool call carries that token
8. Token refreshes silently when expired

The scope is fixed at step 4. Whatever is granted is what the client has
until the user goes to settings and re-authorizes. No mid-conversation
scope changes in current MCP products.

### Scope granularity: rooms and roles

The OAuth scope defines the ceiling — what the client is *permitted* to
access. This ceiling should be expressible at multiple granularities:

**Room-level scope:**
```
rooms:game-room rooms:work-room
```
Grants the client access to these rooms. Within each room, the client can
observe, embody any available agent, or create new agents (subject to the
user's access level).

**Role-level scope:**
```
rooms:game-room:role:researcher rooms:work-room
```
Grants the client access to game-room but *only* to embody the researcher
role. Access to work-room is unrestricted (full room-level). This allows
a user to limit what a specific client can do — e.g., granting Claude.ai
only the researcher role while granting Claude Code full room access.

**Observe-only scope:**
```
rooms:game-room:observe rooms:work-room
```
Grants the client observation access to game-room (no embodiment, no actions)
and full access to work-room.

**Create-rooms scope:**
```
create_rooms
```
Grants the client permission to create new rooms on the user's behalf.

### What the consent screen shows

```
┌─────────────────────────────────────────────────┐
│  sync.parc.land — authorize Claude.ai           │
│                                                 │
│  christopher, grant access to:                  │
│                                                 │
│  ☑ game-room                       [owner]      │
│    ● Full access                                │
│    ○ Researcher role only                       │
│    ○ Observe only                               │
│    Agents: researcher (idle 2h), game-master    │
│                                                 │
│  ☑ work-room                       [owner]      │
│    ● Full access                                │
│                                                 │
│  □ shared-project                  [participant] │
│                                                 │
│  ☑ Can create new rooms                         │
│                                                 │
│  [Authorize]                                    │
└─────────────────────────────────────────────────┘
```

Room and role information is displayed for context. The user sets the ceiling
per-room. The tool layer governs the *current* focus within that ceiling.

### Scope as ceiling, tools as arbiter

The OAuth scope defines the *ceiling* of what the client can access. The tools
govern the *current* focus within that ceiling:

- **Scope** (OAuth, set at auth time): "I can access game-room (researcher
  only) and work-room (full)"
- **Focus** (tool layer, changes per interaction): "I am currently embodied as
  researcher in game-room"

This separation means:

1. The consent screen handles trust boundaries — what the client is *allowed*
   to do
2. The tool layer handles intent — what the client is *currently* doing
3. The scope can be restrictive without limiting the tool-layer fluidity within
   the permitted space

### Progressive scope: widening and narrowing

Within the current OAuth constraints, the *effective scope* can change during
a session. The OAuth token's encoded scope is the initial ceiling. The server
maintains a mutable effective scope per session:

```
OAuth grant (static, encoded in token)
  → smcp_user_sessions.scope (mutable, server-side, starts from grant)
    → effective scope per tool call
```

**Widening — room creation:**
When `sync_create_room` succeeds, the server extends the session's effective
scope to include the new room. Consent is implied: the user created the room
through the authenticated client.

**Widening — room sharing:**
If another user shares a room with Christopher during an active session, the
server can include the new room in his effective scope on the next tool call.

**Narrowing — explicit revocation:**
```
sync_revoke_access({ room: "work-room" })
```
Removes the room from effective scope. The client can no longer access that
room until re-authorized. Useful for privacy: "I don't want this conversation
to see my work room."

**Narrowing — role restriction:**
```
sync_restrict_scope({ room: "game-room", role: "researcher" })
```
Narrows the effective scope from full room access to role-only, mid-session.
The ceiling lowers. The client can only embody the researcher in that room
until the session ends or scope is re-widened.

All scope changes are persisted in `smcp_user_sessions.scope`. No in-memory
state.

### When re-authorization IS required

Re-authorization (re-running the OAuth flow in client settings) is needed when:

- The user wants to add a room they didn't grant at auth time and that wasn't
  created or shared during the session
- The user wants to raise the ceiling above what was originally granted
- The refresh token expires

The server communicates this clearly in tool responses:

```json
{
  "error": "room_not_in_scope",
  "room": "someone-elses-room",
  "message": "This room is not in your current session scope.",
  "options": [
    "Ask the room owner to share it (will auto-widen)",
    "Re-authorize in client settings to add this room"
  ]
}
```

---

## XI. The lobby pattern

### Why a lobby

Given that OAuth scoping is coarse-grained, fine-grained room and agent
selection happens at the tool layer. The "lobby" is the first interaction
pattern — a meta-view of the user's rooms, agents, and available roles.

### The lobby is not a special endpoint

Consistent with statelessness, the lobby is not a stateful concept. It is
the *absence of embodiment*. When `smcp_user_sessions.agent_id` is null, the
user is "in the lobby" — they can observe rooms in their scope but cannot act.

The `sync_lobby` tool returns:

```json
{
  "user": "christopher",
  "client": "claude-ai",
  "rooms": [
    {
      "id": "game-room",
      "access": "owner",
      "scope_level": "role:researcher",
      "label": "D&D Campaign",
      "roles": {
        "researcher": { "filled_by": null, "idle_since": "2h ago" },
        "game-master": { "filled_by": "bot-gm", "status": "active" }
      },
      "free_agents": [
        { "id": "christopher:prev-session", "status": "done" }
      ],
      "state_summary": { "phase": "active", "turn": 7 }
    },
    {
      "id": "work-room",
      "access": "owner",
      "scope_level": "full",
      "label": null,
      "roles": {},
      "free_agents": [],
      "state_summary": {}
    }
  ],
  "can_create_rooms": true,
  "embodied": null
}
```

The user sees their rooms, the roles and agents in each, which are vacant,
which are active, what scope level their current session has per room. They
choose:

- "Join game-room as the researcher" → `sync_embody`
- "Just show me game-room's state" → `sync_read_context` (observe)
- "Create a new room" → `sync_create_room`
- "Narrow my access to work-room to observe-only" → `sync_restrict_scope`

### The lobby as affordance map

In substrate terms, the lobby IS a context read — but at the user level, not
the room level. It is the user's affordance map across all their rooms. Just
as `/context` presents a room's available actions, the lobby presents the
user's available engagements.

This is the v6 principle of progressive disclosure applied to the meta-layer:
the lobby shows you what you can do. Your choice of room and mode is the first
act. Everything else follows.

---

## XII. Embodiment mechanics

### Embodying a new agent in a room

```
sync_embody({ room: "game-room" })
```

Server:
1. Validate room in scope
2. User provides or server generates an agent ID
3. Insert agent via `insertAgentDirect(room, { id, name, role, grants })`
4. Update `smcp_user_sessions`: set `room_id`, `agent_id`
5. Return full context with `self: agentId`

### Embodying an existing agent

```
sync_embody({ room: "game-room", agent: "researcher" })
```

Server:
1. Validate room in scope
2. Validate agent exists in the room
3. Validate agent is available (not currently driven, or driven by this user)
4. Rotate agent's `token_hash` to this session
5. Update `smcp_user_sessions`: set `room_id`, `agent_id`
6. Touch heartbeat, set status to "active"
7. Return full context with inherited scope, state, views

The user picks up where they (or a previous driver) left off.

### Embodying a role

```
sync_embody({ room: "game-room", role: "researcher" })
```

Server:
1. Validate room in scope (and scope permits this role if role-restricted)
2. Read `_shared.roles.researcher` — check `filled_by` is null or is this user
3. If role has an existing agent (previous occupant left state):
   - Take over that agent identity
   - Rotate token hash
4. If role has no agent yet:
   - Create agent with `id: "researcher"` (the role IS the identity)
   - Set grants per user's access level
5. Update `smcp_user_sessions`: set `room_id`, `agent_id`
6. Write `filled_by: self` to role state (with `if_version`)
7. Return full context — agent inherits role's scope and any prior state

### Disembodying

```
sync_disembody()
```

Server:
1. Clear `smcp_user_sessions.room_id` and `agent_id`
2. Do NOT delete agent from room
3. Do NOT clear agent's scope state
4. Optionally set agent status to "idle"
5. If role-defined, optionally clear `filled_by` (policy: configurable per role)
6. Return lobby state

The agent persists in the room as state. It can be re-embodied later.

### Switching

```
sync_embody({ room: "work-room", agent: "sprint-lead" })
```

If already embodied elsewhere, the server implicitly disembodies from the
current agent first (same as calling `sync_disembody` then `sync_embody`).
One session, one active embodiment. Multiple agents require multiple sessions.

---

## XIII. MCP tool mapping

```
sync_lobby         → observe all rooms (patterns 1, 5)
sync_read_context  → observe one room (patterns 1, 3, 5) — NO agent created
sync_embody        → commit to an agent/role in a room (pattern 2)
sync_invoke_action → act as embodied agent (pattern 2)
sync_send_message  → send message as embodied agent (pattern 2)
sync_spawn_agent   → create autonomous agent (pattern 4)
sync_disembody     → release agent, return to lobby
sync_restrict_scope  → narrow effective scope mid-session
sync_revoke_access   → remove room from effective scope
sync_create_room   → create room (auto-widens scope)
```

The default is observation. Embodiment is explicit. This preserves v6's
commitment that presence is meaningful.

---

## XIV. Implementation sequence

### Step 0: Export `waitForCondition`

1. `export` `waitForCondition` in `main.ts`
2. Import and call directly in `mcp/tools.ts`
3. Remove HTTP proxy for `sync_wait`

### Step 1: `smcp_user_rooms` + `smcp_user_sessions` schema

Add both tables to `schema.ts` migrate():

```sql
CREATE TABLE IF NOT EXISTS smcp_user_rooms (
  user_id    TEXT NOT NULL REFERENCES smcp_users(id),
  room_id    TEXT NOT NULL,
  access     TEXT NOT NULL DEFAULT 'participant',
  is_default INTEGER DEFAULT 0,
  label      TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, room_id)
)

CREATE TABLE IF NOT EXISTS smcp_user_sessions (
  token_hash  TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES smcp_users(id),
  client_name TEXT NOT NULL,
  room_id     TEXT,
  agent_id    TEXT,
  scope       TEXT NOT NULL,
  updated_at  TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at  TEXT NOT NULL
)
```

### Step 2: CRUD helpers in `mcp/db.ts`

User-room helpers: `upsertUserRoom`, `getUserRoom`, `listUserRooms`.
Session helpers: `getSession`, `updateSessionFocus`, `updateSessionScope`.

### Step 3: `insertAgentDirect` in `main.ts`

Extract a lower-level agent creation function that doesn't require Request-based
auth. Used by `joinRoom` internally and by MCP embodiment. The existing
`joinRoom` keeps its Request validation for REST callers.

### Step 4: Observe/embody split in MCP tools

Modify `sync_read_context` to NOT auto-join. Reads room via view-level access
when no agent is embodied. Add `sync_embody`, `sync_disembody` tools. Add
`sync_lobby` tool.

### Step 5: Role conventions in standard library

Add `define_role`, `fill_role`, `vacate_role` to the standard library help
content. No platform changes — these are action templates.

### Step 6: Progressive scope

Implement scope widening on `sync_create_room` and room sharing. Implement
`sync_restrict_scope` and `sync_revoke_access`. Scope changes mutate
`smcp_user_sessions.scope`.

### Step 7: Consent screen update

Update `/oauth/authorize` to show rooms with role information and per-room
scope level selection (full / role-restricted / observe-only).

---

## XV. What this does NOT do

- Does not change the REST API. Non-MCP clients use tokens directly as before.
  The dashboard is already a first-class participation mode.
- Does not force roles on any room. Roles are a convention, not a requirement.
  Rooms without role definitions work exactly as they do today.
- Does not add user identity to the core agents table. The link is through
  `smcp_user_rooms` and `smcp_user_sessions` — the sync platform stays
  decoupled from the auth layer.
- Does not implement autonomous agent spawning infrastructure (pattern 4). That
  requires a separate execution environment — a process that runs the wait loop
  independently. The design supports it; the infrastructure is future work.
- Does not build room sharing UI. Schema supports it; the flow is future work.

---

## Appendix A: MCP spec and dynamic scope evolution

### Current state (March 2026)

The MCP specification treats OAuth scope as a static grant. The authorization
flow runs once at connection time. There is no mechanism for the server to
request additional scope mid-session, and no mechanism for the client to offer
it.

The MCP spec does include notification channels:

- `notifications/resources/updated` — server notifies client of resource changes
- `notifications/tools/list_changed` — server notifies client of tool changes

These are informational — they don't change authorization scope. But they
establish a precedent: the server can push information to the client outside
the request/response cycle.

### The gap: incremental authorization

The missing primitive is **incremental authorization**: the ability for a
server to request additional scope during an active session, and for the
client to prompt the user and grant it without a full re-authorization flow.

This is a solved problem elsewhere. Google's OAuth APIs support incremental
auth — services request additional scopes as needed, the user sees a targeted
consent prompt. GitHub's OAuth supports scope upgrades. The pattern is
well-established in the broader OAuth ecosystem.

### How sync could use dynamic scope

If MCP clients supported incremental authorization:

1. Initial auth: user identity + initial room selection
2. User asks about a room not in scope
3. Tool returns `room_not_in_scope` error
4. Server sends scope-upgrade request via MCP
5. Client prompts user: "sync wants access to new-room. Allow?"
6. User approves → scope widens → tool call succeeds
7. Conversation continues without interruption

### Proposed MCP extensions

sync's progressive scope model could inform the MCP spec. Three extensions:

**1. `authorization/scope_request` — server-initiated scope upgrade**

```json
{
  "jsonrpc": "2.0",
  "method": "authorization/scope_request",
  "params": {
    "additional_scope": "rooms:new-room-id",
    "reason": "User requested access to room 'new-room'",
    "consent_url": "https://sync.parc.land/oauth/consent?add_scope=rooms:new-room-id",
    "required": false
  }
}
```

The client can: auto-approve (if policy allows), prompt the user inline, open
the consent URL, or reject.

**2. `authorization/scope_reduced` — server notifies scope reduction**

```json
{
  "jsonrpc": "2.0",
  "method": "authorization/scope_reduced",
  "params": {
    "removed_scope": "rooms:work-room",
    "reason": "User revoked access via sync_revoke_access",
    "effective_scope": "rooms:game-room:role:researcher create_rooms"
  }
}
```

Informational — the client updates its understanding of available resources.

**3. `authorization/scope_offer` — server offers available scope**

```json
{
  "jsonrpc": "2.0",
  "method": "authorization/scope_offer",
  "params": {
    "available_scope": "rooms:shared-project",
    "context": "alice shared 'shared-project' with you"
  }
}
```

The server notifies the client that new scope is *available*. The client
presents this to the user as an option. The user can accept (widening scope)
or ignore.

### Forward compatibility

The `smcp_user_sessions.scope` mechanism is designed for this future. Today,
scope starts from the OAuth grant and changes through tool calls (server-side
mutations). When MCP clients support incremental auth, the same session scope
field becomes the target of client-mediated scope changes. The server remains
the arbiter. The mechanism is the same. Only the trigger changes: from
tool-call-initiated to client-protocol-initiated.

sync doesn't need to wait for the spec to evolve. The progressive scope model
works today through tool-mediated widening/narrowing. Dynamic scope in the MCP
spec would be a UX improvement, not an architectural change.

### Could sync inform the spec?

The sync use case is a clean example of why incremental authorization matters
for MCP. The pattern — a server managing multiple scoped resources that a user
wants to access dynamically — will recur across MCP integrations (Google Drive
folders, GitHub repos, Slack channels, database schemas). sync's
`scope_request` / `scope_reduced` / `scope_offer` trio captures the three
directions of scope change (server requests more, server removes some, server
offers optional) in a way that generalizes beyond sync.

If the MCP spec working group is considering authorization extensions, sync's
experience with progressive scope on a stateless server is a concrete
reference implementation worth sharing.

---

## Appendix B: The substrate alignment check

Does this design honor the substrate thesis?

**"State is the substrate."** ✓ — Roles are state. Agent identity is state.
Session focus is persisted state. Effective scope is persisted state. No
in-memory server state.

**"Surfaces are observers."** ✓ — Role definitions, agent objectives, and
vacancy status are observable through views. The lobby is a meta-surface.
The dashboard is a surface layer. A role's "fill" button is an action-choice
surface gated on `filled_by == null`.

**"Actions are transitions."** ✓ — `fill_role`, `vacate_role`, `define_role`
are standard library actions. Embodiment writes to room state through actions.
Dashboard interactions invoke the same actions that MCP and autonomous agents do.

**"Agents and humans are equivalent participants."** ✓ — A dashboard human, an
MCP-proxied human, and an autonomous bot all produce the same substrate
artifacts. The room cannot distinguish them. The substrate sees only reads
and writes.

**"Progressive disclosure is implicit."** ✓ — The lobby shows available rooms.
Observing a room shows available roles. Filling a role reveals bootstrap
instructions. Each step discloses the next.

**"Vocabulary construction is the only unilateral act."** ✓ — Defining a role
is vocabulary construction. Filling a role is claiming vocabulary.

**"No setup phase."** ⚠ Partial — The OAuth consent screen is a setup phase,
but it operates at the user level, not the room level. Within the room, the
principle holds. The consent screen is infrastructure — it decides *whether*
you can enter, not *what you find* when you arrive.

**"Presence is meaningful."** ✓ — Observation does not create presence.
Embodiment does. Disembodiment preserves state without claiming liveness.
Multiple sessions can share an agent (shared liveness) or drive separate
agents (separate presence). The distinction is structural.

---

*Christopher · Edinburgh · March 2026*
