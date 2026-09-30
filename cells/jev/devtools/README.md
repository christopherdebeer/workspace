# jev devtools (not synced to the cell)

Node checks for the Playtest experiment (`client/playtest/`). They bundle with
the same resolution rules as the cell's client bundler (relative imports try
`.ts/.tsx/.js/index.*`; bare imports are external), e.g. with esbuild and a
small vfs plugin, then run under node.

| file | what |
|---|---|
| `engine-smoke.ts` | vendored engine + in-memory fs: init → start → random legal moves |
| `validate-purity.ts` | validating every candidate must not mutate state (the runner relies on it) — all 18 games: only a lazy `contestState` init on the first call |
| `playtest-run.ts` | the full runner (classify → play → judge) against real Jev over `/mcp`; auth as `scripts/cell-sync.mjs`. `--no-jev` for random play, `--turns` to print every move |
| `browser-smoke.ts` | the runner in a real page (Chromium) with random play |

Refresh the engine with `node scripts/vendor-playtest.mjs <playtest clone>`.
