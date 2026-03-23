# Claude Code Slash Commands Reference

A comprehensive reference for all slash commands (skills) available in Claude Code.

## Table of Contents

- [Skill Infrastructure](#skill-infrastructure)
- [Active Skills](#active-skills)
  - [/simplify](#simplify)
  - [/batch](#batch)
  - [/loop](#loop)
  - [/schedule](#schedule)
  - [/debug](#debug)
  - [/claude-api](#claude-api)
  - [/claude-in-chrome](#claude-in-chrome)
  - [/update-config](#update-config)
  - [/keybindings-help](#keybindings-help)
- [File-Based Skills](#file-based-skills)
  - [/session-start-hook](#session-start-hook)
- [Stubbed / Inactive Skills](#stubbed--inactive-skills)

---

## Skill Infrastructure

### How Skills Are Registered

Skills are registered via an internal `d4()` function. Each skill provides:

| Property | Description |
|----------|-------------|
| `name` | Identifier used as the `/command` name |
| `description` | Shown to the model and in listings |
| `whenToUse` | Guidance for when the model should auto-invoke |
| `allowedTools` | Tools the skill can access (restricts the model) |
| `argumentHint` | Usage hint shown to the user |
| `userInvocable` | Whether the user can type `/name` directly |
| `disableModelInvocation` | If `true`, the model cannot auto-invoke — user must type it |
| `isEnabled` | Function gating availability (feature flags, env checks) |

### Master Registration

All built-in skills are registered in a single startup function that calls each skill's registration function sequentially. Some skills (like `/claude-in-chrome`) are conditionally registered behind feature-flag or environment checks.

### File-Based Skills

In addition to built-in skills, Claude Code loads **file-based skills** from `SKILL.md` files in:

| Directory | Source | Scope |
|-----------|--------|-------|
| `~/.claude/skills/<name>/SKILL.md` | `userSettings` | Personal, all projects |
| `.claude/skills/<name>/SKILL.md` | `projectSettings` | Project-specific, committed |
| Managed/policy directory | `policySettings` | Enterprise-managed |

File-based skills use YAML frontmatter for configuration (name, description, allowed-tools, model, etc.) and markdown body for the prompt template. Supported frontmatter fields include: `name`, `description`, `allowed-tools`, `argument-hint`, `arguments`, `when_to_use`, `version`, `model`, `effort`, `disable-model-invocation`, `user-invocable`, `shell`, `hooks`, `context` (`"fork"` for sub-agent execution), `agent`, and `paths`.

### Skill Visibility

Skills are surfaced to the model in `system-reminder` messages. The listing is budget-capped at ~2% of context window size. Each entry shows the skill name, description, and when-to-use guidance.

---

## Active Skills

### /simplify

**Purpose**: Code review and cleanup of changed files.

| Property | Value |
|----------|-------|
| User-invocable | Yes |
| Model can auto-invoke | Yes |
| Allowed tools | (unrestricted — launches sub-agents) |

**What it does**:

1. **Identifies changes** via `git diff` (or `git diff HEAD` for staged changes). If no git changes exist, reviews recently modified files.
2. **Launches three parallel review agents**:
   - **Code Reuse Review** — searches for existing utilities/helpers that could replace newly written code; flags duplication of existing functionality.
   - **Code Quality Review** — flags redundant state, parameter sprawl, copy-paste patterns, leaky abstractions, stringly-typed code, unnecessary JSX nesting, and unnecessary comments.
   - **Efficiency Review** — flags redundant computations, missed concurrency, hot-path bloat, recurring no-op updates, unnecessary existence checks (TOCTOU), memory leaks, and overly broad operations.
3. **Fixes issues** by aggregating findings from all three agents and applying fixes directly. False positives are noted and skipped.

**Usage**:
```
/simplify
```

No arguments. Operates on the current git diff automatically.

---

### /batch

**Purpose**: Orchestrate large-scale parallel changes across a codebase using isolated git worktrees.

| Property | Value |
|----------|-------|
| User-invocable | Yes |
| Model can auto-invoke | No (`disableModelInvocation: true`) |
| Requires | Git repository |
| Worker count | 5–30 parallel agents |

**What it does**:

1. **Phase 1 — Research and Plan**: Enters plan mode, launches sub-agents to research the scope of changes, decomposes into 5–30 independent work units, determines an e2e test recipe (asks user if unclear), and presents the plan for approval.
2. **Phase 2 — Spawn Workers**: After approval, launches one background agent per work unit, each in an isolated `git worktree`. All agents run concurrently.
3. **Phase 3 — Track Progress**: Renders a status table tracking each unit's status and PR link. Updates as agents complete.

**Each worker**:
- Implements its change in isolation
- Invokes `/simplify` to clean up
- Runs unit tests and e2e tests
- Commits, pushes, and creates a PR via `gh pr create`
- Reports `PR: <url>` on completion

**Worktree details**:
- Created under `<git-root>/.claude/worktrees/<agent-name>`
- Branch name: `worktree-<name>`
- Supports `worktree.symlinkDirectories` setting (e.g., `node_modules`) to avoid disk bloat
- Supports `worktree.sparsePaths` for monorepo sparse checkout
- Stale worktrees without uncommitted changes are auto-pruned

**Usage**:
```
/batch migrate from react to vue
/batch replace all uses of lodash with native equivalents
/batch add type annotations to all untyped function parameters
```

---

### /loop

**Purpose**: Schedule a prompt or slash command to run on a recurring interval.

| Property | Value |
|----------|-------|
| User-invocable | Yes |
| Model can auto-invoke | Yes |
| Feature gate | `tengu_kairos_cron` flag (default: enabled) |
| Kill switch | `CLAUDE_CODE_DISABLE_CRON` env var |

**What it does**:

Parses `[interval] <prompt>` and creates a recurring cron job via the `CronCreate` tool. The prompt executes immediately on first invocation, then repeats on the cron schedule.

**Interval parsing** (priority order):
1. **Leading token**: `5m /babysit-prs` → interval `5m`, prompt `/babysit-prs`
2. **Trailing "every" clause**: `check the deploy every 20m` → interval `20m`, prompt `check the deploy`
3. **Default**: `check the deploy` → interval `10m` (default), prompt `check the deploy`

**Interval conversion**:

| Pattern | Cron | Notes |
|---------|------|-------|
| `Nm` (N ≤ 59) | `*/N * * * *` | Every N minutes |
| `Nm` (N ≥ 60) | `0 */H * * *` | Rounded to hours |
| `Nh` (N ≤ 23) | `0 */N * * *` | Every N hours |
| `Nd` | `0 0 */N * *` | Every N days at midnight |
| `Ns` | `ceil(N/60)m` | Minimum granularity is 1 minute |

**Scheduler details**:
- 1-second polling loop
- Deterministic jitter per task (up to 10% of interval, capped at 15 min) to avoid thundering herd
- Maximum 50 concurrent scheduled jobs
- Recurring tasks auto-expire after **7 days**
- Session-scoped by default (dies when session ends); `durable: true` persists to `.claude/scheduled_tasks.json`

**Usage**:
```
/loop 5m /babysit-prs
/loop 30m check the deploy
/loop 1h /standup 1
/loop check the deploy              # defaults to 10m
/loop check the deploy every 20m
```

---

### /schedule

**Purpose**: Create, update, list, or run scheduled **remote** Claude Code agents (triggers) that execute on a cron schedule in Anthropic's cloud.

| Property | Value |
|----------|-------|
| User-invocable | Yes |
| Model can auto-invoke | Yes |
| Feature gate | `tengu_surreal_dali` flag + `allow_remote_sessions` capability |
| Requires | claude.ai OAuth authentication (not API keys) |
| Allowed tools | `RemoteTrigger`, `AskUserQuestion` |

**What it does**:

Manages remote triggers via the claude.ai CCR (Cloud Code Runner) API. Each trigger spawns a fully isolated remote session with its own git checkout, tools, and optional MCP connections.

**Operations**:

| Action | Description |
|--------|-------------|
| `create` | Create a new scheduled trigger |
| `list` | List all triggers with schedule, status, repos |
| `update` | Modify an existing trigger |
| `run` | Execute a trigger immediately |

**Cannot delete triggers** — users are directed to `https://claude.ai/code/scheduled`.

**Create workflow**:
1. Understand the goal (remote agent, no local access)
2. Craft the agent prompt
3. Set the cron schedule (converts local timezone → UTC; minimum interval: 1 hour)
4. Choose model (default: `claude-sonnet-4-6`)
5. Validate MCP connections (infers needed services from description)
6. Review and confirm
7. Create and provide management link

**Pre-prompt setup** automatically:
- Checks authentication
- Fetches/creates execution environments
- Detects git repo and GitHub App access
- Discovers connected MCP connectors (decodes `mcpsrv_`-prefixed IDs)
- Detects user timezone

**Key URLs**:
- Trigger management: `https://claude.ai/code/scheduled`
- MCP connectors: `https://claude.ai/settings/connectors`

**Usage**:
```
/schedule
/schedule create a daily PR review agent
```

---

### /debug

**Purpose**: Enable debug logging for the current session and help diagnose issues.

| Property | Value |
|----------|-------|
| User-invocable | Yes |
| Model can auto-invoke | No (`disableModelInvocation: true`) |
| Allowed tools | `Read`, `Grep`, `Glob` |
| Argument | Optional issue description |

**What it does**:

1. **Enables debug logging** if not already active (sets an internal flag and clears the memoized debug-check cache).
2. **Reads the tail of the debug log** — last 20 lines from up to 64 KB at the end of the file.
3. **Generates a diagnostic prompt** including:
   - The log tail content
   - The user's issue description (or a fallback instruction to summarize errors)
   - Settings file paths (user, project, local)
   - Instructions to grep for `[ERROR]` and `[WARN]` entries

**Debug log location**: `~/.claude/debug/<session-id>.txt` (overridable via `--debug-file=<path>` or `CLAUDE_CODE_DEBUG_LOGS_DIR` env var). A `latest` symlink is maintained.

**Debug can also be enabled via**: `--debug` CLI flag, `-d` flag, `DEBUG=true` env var, `DEBUG_SDK=true` env var.

**Usage**:
```
/debug
/debug my completions are slow
/debug MCP server not connecting
```

---

### /claude-api

**Purpose**: Help build applications with the Claude API, Anthropic SDK, or Agent SDK.

| Property | Value |
|----------|-------|
| User-invocable | Yes |
| Model can auto-invoke | Yes (when code imports `anthropic`/`@anthropic-ai/sdk`/`claude_agent_sdk`) |
| Allowed tools | `Read`, `Grep`, `Glob`, `WebFetch` |

**What it does**:

1. **Auto-detects project language** by scanning the working directory for characteristic files:

   | Language | Detection signals |
   |----------|-------------------|
   | Python | `.py`, `requirements.txt`, `pyproject.toml`, `setup.py`, `Pipfile` |
   | TypeScript | `.ts`, `.tsx`, `tsconfig.json`, `package.json` |
   | Java | `.java`, `pom.xml`, `build.gradle` |
   | Go | `.go`, `go.mod` |
   | Ruby | `.rb`, `Gemfile` |
   | C# | `.cs`, `.csproj` |
   | PHP | `.php`, `composer.json` |
   | cURL | Never auto-detected |

2. **Assembles a context-specific prompt** with:
   - Language-filtered documentation (only relevant language + shared docs)
   - Current model catalog with pricing
   - Surface selection guidance (single call vs workflow vs agent)
   - SDK-specific patterns (tool runner, streaming, structured outputs)
   - Common pitfalls and best practices

3. **Embeds 24+ documentation files** covering each language's SDK, Agent SDK, streaming, tool use, batches, Files API, error codes, and model catalog.

**Key guidance provided**:
- Default model: Claude Opus 4.6
- Default thinking: `adaptive` for Opus/Sonnet 4.6
- Prefers streaming for long input/output
- Agent SDK available for Python and TypeScript
- Tool Runner (beta) available for Python, TypeScript, Java, Go, Ruby
- WebFetch URLs for live documentation at `platform.claude.com`

**Usage**:
```
/claude-api
/claude-api how do I use streaming with tool use?
```

---

### /claude-in-chrome

**Purpose**: Automate Chrome browser interactions — clicking, filling forms, screenshots, console logs, navigation.

| Property | Value |
|----------|-------|
| User-invocable | Yes |
| Model can auto-invoke | Yes |
| Feature gate | Interactive session + Chrome extension installed + `tengu_chrome_auto_enable` flag |
| Allowed tools | 17+ `mcp__claude-in-chrome__*` tools |

**What it does**:

Provides browser automation through a Chrome extension connected via Native Messaging + MCP over stdio.

**Available capabilities**:

| Category | Tools | Description |
|----------|-------|-------------|
| Navigation | `navigate`, `tabs_context_mcp`, `tabs_create_mcp`, `switch_browser` | URL navigation, tab management, browser switching |
| Page Reading | `read_page`, `get_page_text`, `find` | Accessibility tree, text extraction, element search |
| Interaction | `computer`, `form_input`, `javascript_tool`, `upload_image` | Mouse/keyboard, form filling, JS execution, image upload |
| Visual | `resize_window`, `gif_creator` | Responsive testing, animated GIF recording with overlays |
| Debugging | `read_console_messages`, `read_network_requests` | Console log reading (with regex filtering), network request inspection |
| Planning | `update_plan` | Present domain visit plan for user approval |
| Automation | `shortcuts_list`, `shortcuts_execute` | Extension shortcuts/workflows |

**Architecture**: Chrome Extension (Native Messaging Host) → WebSocket Bridge → MCP Server (stdio) → Claude Code

**Key guidelines embedded in the prompt**:
- Always start with `tabs_context_mcp` to get current tab state
- Avoid triggering JavaScript alerts/confirms (they block the extension)
- Stop and ask user after 2–3 failed attempts
- Record multi-step interactions as GIFs with meaningful filenames

**Chrome Extension ID**: `fcoeoabgfenejglbffodgkkbkcdhcgfn`

**Usage**:
```
/claude-in-chrome
/claude-in-chrome fill out the login form on the current page
```

---

### /update-config

**Purpose**: Configure Claude Code settings — hooks, permissions, env vars, and other `settings.json` properties.

| Property | Value |
|----------|-------|
| User-invocable | Yes |
| Model can auto-invoke | Yes |
| Allowed tools | `Read` |

**What it does**:

Guides modifications to Claude Code's settings files. Two modes:
- **Full settings mode**: Provides the complete settings JSON schema reference
- **Hooks-only mode**: Focused on hook configuration (triggered internally for automation requests)

**Settings file locations**:

| File | Scope | Git |
|------|-------|-----|
| `~/.claude/settings.json` | Global | N/A |
| `.claude/settings.json` | Project | Committed |
| `.claude/settings.local.json` | Project | Gitignored |

Settings load in order: user → project → local (later overrides earlier).

**Configurable areas**:
- **Permissions**: `allow`, `deny`, `ask` rules with prefix wildcards (e.g., `Bash(git:*)`)
- **Environment variables**: `env` object
- **Model & agent**: model selection, always-thinking mode
- **Attribution**: custom commit/PR trailer text
- **MCP servers**: enable/disable project MCP servers
- **Plugins**: enable marketplace/official plugins
- **Hooks**: lifecycle event automation (see below)

**Hook events**:

| Event | Matcher | Purpose |
|-------|---------|---------|
| `PreToolUse` | Tool name | Run before tool execution, can block |
| `PostToolUse` | Tool name | Run after successful tool execution |
| `PostToolUseFailure` | Tool name | Run after tool failure |
| `PermissionRequest` | Tool name | Run before permission prompt |
| `Notification` | Type | Run on notifications |
| `Stop` | — | Run when Claude stops |
| `PreCompact` / `PostCompact` | `"manual"` / `"auto"` | Before/after context compaction |
| `UserPromptSubmit` | — | When user submits input |
| `SessionStart` | — | When session starts |

**Hook types**: `command` (shell command), `prompt` (LLM evaluation), `agent` (agent with tools).

**Usage**:
```
/update-config
/update-config allow npm commands
/update-config add a hook to format files after writes
```

---

### /keybindings-help

**Purpose**: Help customize keyboard shortcuts in `~/.claude/keybindings.json`.

| Property | Value |
|----------|-------|
| User-invocable | Yes |
| Model can auto-invoke | Yes |

Provides guidance on rebinding keys, adding chord bindings, and modifying the keybindings configuration.

**Usage**:
```
/keybindings-help
/keybindings-help rebind ctrl+s
```

---

## File-Based Skills

### /session-start-hook

**Purpose**: Guide creation of `SessionStart` hooks for remote/web Claude Code sessions.

| Property | Value |
|----------|-------|
| Location | `~/.claude/skills/session-start-hook/SKILL.md` |
| Source | `userSettings` |
| User-invocable | Yes (default for file-based skills) |

**What it does**:

Walks through an 8-step process:
1. Analyze project dependencies
2. Design the hook script
3. Create the hook file
4. Register in `.claude/settings.json` under `hooks.SessionStart`
5. Validate hook execution
6. Verify linter/test functionality
7. Commit and push

**Hook stdin JSON schema**:
```json
{
  "session_id": "...",
  "source": "...",
  "transcript_path": "...",
  "permission_mode": "...",
  "hook_event_name": "SessionStart",
  "cwd": "..."
}
```

**Available environment variables**: `$CLAUDE_PROJECT_DIR`, `$CLAUDE_ENV_FILE`, `$CLAUDE_CODE_REMOTE`

**Supports async mode**: First line of stdout can be `{"async": true, "asyncTimeout": 300000}` for long-running setup.

---

## Stubbed / Inactive Skills

The following skills have prompt text defined in the binary but their registration functions are **no-ops** — they return immediately without calling the registration function. They are not available to users or the model.

| Skill | Registration Function | Notes |
|-------|-----------------------|-------|
| `/stuck` | `FRf()` | Diagnoses frozen/slow Claude Code sessions; would post to Slack |
| `/skillify` | `CRf()` | Captures a session's repeatable process as a reusable SKILL.md |
| Verification specialist | `kRf()` | E2E verification of changes |
| Unknown | `SRf()` | Stub with no clear purpose |
| Unknown | `bRf()` | Stub with no clear purpose |

These may be gated behind different build configurations or awaiting re-enablement in future releases.
