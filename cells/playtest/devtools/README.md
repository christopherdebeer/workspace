# playtest devtools (not synced to the cell)

`cell-local.ts` drives the REAL handler (`../index.ts`) locally: DynamoDB and
Lambda are swapped for in-memory fakes (`fakes/`), async jobs run in-process,
`./vendor/*` resolves to `cells/kernel/static`, and Jev is real (over /mcp,
token from `PARC_TOKEN` or `/tmp/parc-token.json`). Bundle it with the forge
resolution rules (relative imports try `.ts/.tsx/.js/index.*`, bare imports
external) plus those aliases, then:

    node cell-local.mjs steps.json      # [[tool, args], ...]; async tools are awaited

First local climb (2026-09-29, fortune-seekers, 8-game suite): eval 50 s,
$0.013, 52 batched decide_many calls for 323 decisions; train 0.737 / test
0.718. Proposal "points → score" (the treasure cards' effect had no handler)
lifted definition health but moved train −0.011: reverted. The judged term
swings 0.27–0.69 across similar games — measure `noise` before climbing.
