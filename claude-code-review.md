# Claude Code Deep Review: Latent Capabilities Analysis

**Date:** 2026-03-31
**Source:** github.com/SIGKITTEN/claude-code (decompiled build)
**Methodology:** 8 parallel Sonnet subagents analyzing ~2000 source files across 5 dimensions + 3 project lenses

---

## Executive Summary

Claude Code is significantly more capable than its public surface suggests. The decompiled source reveals **~90+ slash commands** (most hidden/stubbed), a **mature plugin marketplace**, **multi-agent swarm orchestration**, **voice mode**, **computer use (desktop automation)**, **browser automation**, a **coordinator/orchestrator pattern**, **session teleportation**, and deep **MCP-native architecture**. Many capabilities are gated behind GrowthBook feature flags, build-time constants, or ant-only (Anthropic employee) checks.

---

## Part 1: Hidden Command Inventory

### Fully Stubbed (exist as placeholders, disabled in external builds)
| Command | What it would do |
|---|---|
| `/autofix-pr` | Automated PR fixing |
| `/share` | Session sharing |
| `/summary` | Session summarization |
| `/teleport` | BYOC (Bring Your Own Compute) session migration |
| `/agents-platform` | Internal agents platform |
| `/assistant` | Persistent proactive assistant mode (KAIROS) |
| `/onboarding` | Guided onboarding flow |
| `/ctx-viz` | Token/byte breakdown of full context window |
| `/good-claude` | Reinforcement/feedback mechanism |
| `/debug-tool-call` | Tool call debugging |
| `/mock-limits` | Rate limit simulation |
| `/backfill-sessions` | Session data migration |

### Feature-Flagged (exist but gated)
| Command | Gate | What it does |
|---|---|---|
| `/voice` | GrowthBook + OAuth | Push-to-talk STT via WebSocket, SoX audio |
| `/ultrareview` | GrowthBook `tengu_review_bughunter_config` | 10-20min deep bug-finding review via remote Opus session |
| `/ultraplan` | Build-time ant check | 30-min remote Opus planning session with approval loop |
| `/think-back` | Statsig `tengu_thinkback` | "Year in Review" - loads marketplace plugin, generates narrative |
| `/brief` | Build flag `KAIROS` + GrowthBook | Forces all output through a BriefTool (lean output mode) |
| `/remote-control` (`/rc`) | Build flag `BRIDGE_MODE` | Bidirectional WebSocket bridge: CLI <-> claude.ai |
| `/web-setup` | GrowthBook `tengu_cobalt_lantern` | GitHub-connected web session setup |
| `/fast` | `isFastModeEnabled()` | Same model, faster output mode |
| `/passes` | Eligibility check | Referral system - share free weeks |

### Hidden but Active
| Command | Notes |
|---|---|
| `/listen` | macOS dictation via AppleScript. `isHidden: isEnabled` - hidden *precisely when it works* |
| `/heapdump` | Dumps JS heap to ~/Desktop |
| `/advisor` | Configure secondary "advisor" model alongside primary |
| `/buddy` | Virtual companion/pet system (duck, dragon, capybara, etc.) with stats and rarity tiers |

### Ant-Only (Anthropic internal)
| Command | What it does |
|---|---|
| `/ctx-viz` | Full context window token breakdown table |
| `/insights` | Cross-session Opus-powered narrative analysis, pulls from remote Coder homespaces via SSH |
| `/bridge-kick` | Inject bridge failure states for recovery testing |
| `/tag` | Searchable session tagging |
| `/files` | List all files currently in context |

---

## Part 2: Core Systems Architecture

### Plugin System (Very Mature)
- **Three-layer model:** Intent -> Materialization -> Active components
- Plugins contribute: commands, agents, skills, hooks, output formatters
- Full marketplace lifecycle with enterprise MDM controls
- `.claude-plugin/` directory format with `plugin.json` + `marketplace.json`
- Hot-reload via `/reload-plugins`
- `BuiltinPlugin` scaffolding exists but unused in external builds
- `createMovedToPluginCommand` migration pattern (moving core commands to plugins)

### MCP Integration (Production-Grade)
- **5 transports:** stdio, SSE, HTTP, WebSocket, SDK (in-process)
- Full OAuth 2.1 + PKCE flow
- XAA (Cross-App Authentication) - enterprise federated auth (SEP-990)
- Per-server enable/disable, reconnect logic, tool/prompt exposure
- Hidden `mcp xaa` subcommand for OIDC browser login + keychain storage

### Hooks System (26 Event Types)
- Nearly every lifecycle point covered
- **Mutating hooks** can modify data in-flight: `updatedMCPToolOutput`, `updatedInput`, `updatedPermissions`
- Both shell hooks and TypeScript callbacks
- Latent events not yet exposed: `FileChanged` watcher, `TeammateIdle`, `TaskCreated`, `TaskCompleted` (swarm coordination)

### Skills System
- User skills, 11+ bundled skills, MCP-provided skills
- `skillify` tool for interactive skill authoring (internal-only)
- Full hot-reload and change detection
- `AGENT_TRIGGERS` for scheduled execution (not exposed externally)
- `AGENT_TRIGGERS_REMOTE` for cloud-scheduled remote agents

### Coordinator Mode (Internal, Sophisticated)
- Agentic orchestration where Claude coordinates parallel workers
- 900+ line system prompt with detailed operational doctrine
- Shared scratchpad for cross-worker knowledge sharing (gated)
- Workers can be spawned in isolated git worktrees
- Not exposed in external builds but infrastructure is complete

### Multi-Agent Swarms
- **Three backends:** tmux, iTerm2, in-process
- In-process backend enables single-process parallelism with context isolation
- Permission escalation routed through leader agent
- Enable via `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1` or GrowthBook `tengu_amber_flint`
- `TeamCreateTool`, `SendMessageTool` for inter-agent communication

---

## Part 3: Transport & Communication Layer

### Three Transport Generations
1. **WebSocketTransport** - Full-duplex, exponential backoff (1s-30s), 10-min reconnect budget, 1000-message replay buffer, sleep/wake detection
2. **HybridTransport** - WS for reads, HTTP POST batching (100ms window) for writes
3. **SSETransport** - Server-Sent Events for reads, HTTP POST for writes, 45s frame timeout, sequence deduplication

### Bridge System (Remote Control)
- **Env-based bridge:** 60s long-poll for work, v1/v2 transport selection
- **Env-less bridge:** Direct OAuth flow, proactive JWT refresh, 401 recovery with sequence carryover
- Epoch-based worker registration with 409 supersession detection
- Text delta coalescing (100ms flush intervals)
- Delivery ACK pipeline: `received` -> `processing` -> `processed`

### Session Management
- CCRClient atop SSETransport for worker registration, heartbeats, state/metadata reporting
- Sequence number resumption across transport swaps
- Multi-session concurrent transport support

---

## Part 4: Advanced Capabilities

### Computer Use ("Chicago")
- Native macOS desktop automation
- Rust native modules for mouse/keyboard, Swift for screenshots
- Max/Pro subscription tier required
- Exposed as MCP tools with per-app permission UI
- Configurable via GrowthBook `tengu_malort_pedway`

### Browser Automation ("Claude in Chrome")
- Extension supporting Chrome, Brave, Edge, Opera, Vivaldi, Chromium
- GIF recording capability for multi-step interactions
- Beta feature, gated

### Voice Mode
- WebSocket-based push-to-talk STT
- Language fallback support
- Requires Anthropic OAuth (not API keys)
- SoX audio tools dependency

### KAIROS (Assistant/Proactive Mode)
- Persistent mode with webhooks, notifications, scheduled tasks
- Background memory consolidation ("DreamTask" subagent)
- Build-flagged, not in external builds

### Deep Link Protocol (LODESTONE)
- Registers `cc://` protocol handler
- Currently disabled in production
- Would allow external apps to trigger Claude Code sessions

### Web Browser Tool
- Full embedded WebView panel
- LLM-over-fetched-content pattern (WebFetchTool)
- Domain filtering for web search

---

## Part 5: Environment Variable Gates

These env vars unlock hidden capabilities:

| Variable | Effect |
|---|---|
| `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1` | Enables multi-agent swarms |
| `CLAUDE_CODE_COORDINATOR_MODE=1` | Enables orchestrator mode |
| `DISABLE_COMPACT` | Disables conversation compaction |
| `DISABLE_INSTALL_GITHUB_APP_COMMAND` | Disables GitHub app install |
| `DISABLE_FEEDBACK_COMMAND` | Disables feedback command |

---

## Part 6: Project Lens Analysis

### Through the ctxl Lens (Self-Authoring Components)

**Key intersections:**
1. **Claude Code uses Ink (React for CLI)**. Its entire UI is React components. ctxl's AbstractComponent pattern could theoretically generate claude-code UI components at runtime.
2. **Plugin system as seed distribution.** Claude Code's plugin marketplace could distribute ctxl seeds - the `.claude-plugin/` format already supports contributing UI components and commands.
3. **Coordinator -> Agent hierarchy.** Claude Code's coordinator pattern (leader orchestrating workers) maps directly to ctxl's component tree as agent hierarchy. Each worker is an AbstractComponent with its own reasoning loop.
4. **Skills as guidelines.** Claude Code's skill definitions (prompt + tool constraints) are structurally identical to ctxl's `guidelines` prop on AbstractComponent.
5. **DreamTask pattern.** Claude Code has a "DreamTask" memory consolidation subagent that runs in background - this is exactly the kind of self-modifying behavior ctxl enables.
6. **Hot-reload infrastructure.** Both systems have HMR/hot-reload. Claude Code's `/reload-plugins` and skill change detection parallel ctxl's React Refresh source swapping.

**Opportunity:** ctxl could be the visual authoring layer for claude-code plugins/skills - AbstractComponents that generate their own plugin manifests.

### Through the sync.parc.land Lens (Multi-Agent Coordination)

**Key intersections:**
1. **Coordinator mode IS a sync room.** Claude Code's coordinator (leader + workers with shared scratchpad) is architecturally identical to a sync room where agents embody, declare actions, and invoke them through vocabulary.
2. **Salience-driven context shaping.** Claude Code already does context compression/compaction. Sync's `{ value, _meta }` wrapping with salience scores and elision is a more principled version of what claude-code does ad-hoc.
3. **Action vocabulary = tool declarations.** Sync's "agents declare write capabilities as actions, then invoke them" is exactly how claude-code's tool system works. The declaration IS the commitment.
4. **Audit/replay.** Claude Code has session export, thinkback (year in review), and the `/insights` command for cross-session analysis. Sync's audit trail and replay capabilities are the formalized version.
5. **Hook events as sync entries.** Claude Code's 26 hook event types (including latent `TeammateIdle`, `TaskCreated`) map to sync state entries that agents observe.
6. **Bridge = sync transport.** The bridge system (WebSocket/SSE/HTTP) is a bespoke version of what sync provides generically.
7. **`.claude-plugin/` format.** Sync already uses this exact format. The marketplace.json + plugin.json structure is shared.

**Opportunity:** Sync could replace claude-code's bespoke coordinator scratchpad, bridge polling, and inter-agent messaging with a proper coordination substrate. Multi-agent claude-code sessions become sync rooms. Audit comes free.

### Through the DyGram/Machine Lens (State Machine DSL)

**Key intersections:**
1. **Plan mode IS a state machine.** Claude Code's `/plan` command creates a plan with steps that execute sequentially - this is literally a DyGram machine with tasks.
2. **Coordinator doctrine as .dy file.** The coordinator's 900-line system prompt describes a state machine: assess situation -> spawn workers -> monitor progress -> synthesize results. This could be a DyGram definition.
3. **Skills as tasks.** Each claude-code skill (prompt template + tool constraints + trigger conditions) maps to a DyGram Task node with prompt and tooling attributes.
4. **Agent spawning = rail transitions.** When claude-code spawns sub-agents, each with a specific role, that's rail-based execution. The agent rides the machine rails.
5. **Meta-programming.** Claude Code's `skillify` tool (interactive skill authoring) and dynamic tool registration parallel DyGram's meta-programming where agents construct tools.
6. **Execution recording.** DyGram records execution traces. Claude Code has session export, thinkback, and insights. These are the same need.
7. **VS Code extension.** Both have VS Code integration. DyGram's LSP + extension could provide visual state machine editing for claude-code workflows.
8. **ctx_viz.** The ant-only context visualization command is a primitive version of DyGram's ExecutionStateVisualizer.

**Opportunity:** DyGram could be the DSL for defining claude-code workflows, skills, and coordinator strategies. `.dy` files as a more expressive alternative to skill YAML. The playground could visualize claude-code agent execution graphs in real-time.

### Through the Workspace Lens (Productivity Hub)

**Key intersections:**
1. **Command registry pattern.** Both have command registration, discovery, and execution. Claude Code's is more mature (conditional availability, feature flags, aliases, non-interactive mode).
2. **Command palette.** Workspace has `CommandPalette.tsx`. Claude Code has command discovery via `/help` and tab completion. Cross-pollination opportunity.
3. **MCP client.** Both implement MCP clients. Claude Code's is far more mature (5 transports, OAuth, XAA). Workspace's `mcpClient.ts` could adopt claude-code's patterns.
4. **Plugin system.** Workspace has `commandPlugin.ts` and `examplePlugins.ts`. Claude Code's plugin marketplace is the mature version of this same pattern.
5. **WebAuthn/passkeys.** Workspace uses passkeys. Claude Code's XAA system does OIDC + keychain. Sync does passkey-minted scoped tokens. All three share auth primitives.

---

## Part 7: Synthesis - The Unrealized Platform

What emerges from this analysis is that claude-code is not just a CLI tool - it's an **agent platform** with most of its capabilities unrealized in the public build. The latent architecture supports:

1. **Multi-agent orchestration** (coordinator + swarms + bridge)
2. **Persistent proactive agents** (KAIROS/assistant mode + scheduled triggers)
3. **Cross-session intelligence** (insights + thinkback + DreamTask memory consolidation)
4. **Multi-modal interaction** (voice + computer use + browser automation)
5. **Plugin marketplace** (full lifecycle + enterprise MDM)
6. **Remote execution** (teleport + bridge + CCR)
7. **Deep link protocol** (cc:// for external triggering)

### Where Your Projects Fit

```
                    +------------------+
                    |    DyGram DSL    |  <- Workflow definition language
                    |  (.dy machines)  |
                    +--------+---------+
                             |
                    +--------v---------+
                    |   Claude Code    |  <- Execution engine
                    |  (coordinator +  |
                    |   agent swarms)  |
                    +--------+---------+
                             |
                    +--------v---------+
                    |  sync.parc.land  |  <- Coordination substrate
                    |  (rooms, actions |
                    |   vocabulary)    |
                    +--------+---------+
                             |
              +--------------+--------------+
              |                             |
    +---------v----------+      +-----------v--------+
    |       ctxl         |      |     workspace      |
    | (self-authoring    |      |  (productivity     |
    |  visual agents)    |      |   hub / terminal)  |
    +--------------------+      +--------------------+
```

**DyGram** defines the workflow. **Claude Code** executes it with agents. **Sync** coordinates the agents. **ctxl** provides the self-authoring visual layer. **Workspace** is the human-facing surface.

---

## Part 8: Specific Latent Capabilities Worth Watching

1. **`AGENT_TRIGGERS_REMOTE`** - Cloud-scheduled autonomous agents. When this ships, claude-code becomes a cron-like agent platform.
2. **`TeammateIdle` / `TaskCreated` hook events** - Swarm coordination primitives. Agents reacting to each other's state changes.
3. **`skillify`** - Interactive skill authoring tool. Currently ant-only. When public, users can teach claude-code new capabilities interactively.
4. **Shared scratchpad** - Cross-worker knowledge sharing in coordinator mode. Currently gated.
5. **`sdk` MCP transport** - In-process MCP servers. No subprocess overhead. Plugins become first-class MCP servers.
6. **DreamTask** - Background memory consolidation subagent. Claude Code sleeping on problems.
7. **`cc://` deep links** - External apps triggering claude-code sessions with context.
8. **XAA (Cross-App Auth)** - Enterprise federated identity for MCP. Agents authenticating to enterprise services.
