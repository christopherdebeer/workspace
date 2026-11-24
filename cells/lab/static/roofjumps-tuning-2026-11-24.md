# Tuning analysis: the proposed dials as the house set (24 November)

The proposed set (from the address):
`gravity=29.5 sprint=11 run=6.5 dash=14 dashTime=1.15 accel=31 grip=4 ledgeSpeed=7.5 ledgePull=0.6 leapSpeed=15 diveDrop=6.9 hang=0.55 emphasis=1 wallLift=47 wallGravity=16 kick=9 climb=23.5 rise=4.6 jumpReach=11 drop=4 eyeLope=1.5 eyeImpact=1.55 assist=1`.

How it was measured:
- `devtools/roofjumps-autopilot.mjs`: the autopilot headless (the wander, the planner's fan every 0.12 s, the lean onto its best), at 120 Hz.
- `devtools/roofjumps-scenes.mjs --dials=<query>`: the 39 authored scenes run and judged under a dial set.

## The autopilot: 7 characters, 5 seeds, 60 s each

| | house | proposed |
|---|---|---|
| path (m a minute) | 561 | 446 |
| down to the street (a minute) | 2.0 | 2.7 |
| missed landings (a minute) | 1.9 | 0.9 |
| leaps (a minute) | 70 | 74 |
| time in the air | 47% | 36% |
| mean flight | 0.64 s | 0.58 s |
| ground speed | 10.2 m/s | 7.8 m/s |
| stuck (s a run) | 1.0 | 2.2 |
| how far the plan's best route reaches in its 3 s | 27 m | 21 m |

The move mix changes most: dives go from 104 to 8, while shimmies (6 to 224), hangs (51 to 113), chimneys (84 to 116) and climbs (84 to 100) all rise. It becomes a slower game of walls and ledges with fewer long drops: fewer missed landings, but more trips to the street.

## Which dial does what: the proposed set with one group put back to the house

Four characters, 3 seeds, 45 s each. Proposed: 3.2 street drops a minute, a 329 m path.
- gravity, rise and hang back: 2.0 street drops, 367 m, 47% in the air. **Gravity was the main cause.**
- run, sprint, dash and accel back: 2.1 street drops, 386 m.
- the wall dials back: 2.2 street drops.
- grip (4 to 14): no help (3.4). The predicted turning problem didn't show in the autopilot.
- reach, drop and dive, ledge: little change; with drop back, the dives return.

## Why gravity: speeds set against gravity 20

Several of the body's own speeds were fixed numbers tuned for the house gravity:
- the plain jump (9.5 m/s);
- the committed jump (9 to 10.5 m/s);
- the check for whether a wall's lip can be reached (it assumed a 10.5 m/s spring);
- the vertical-speed and airtime windows for catching a lip or a wall;
- the impact thresholds that decide a heavy landing or a roll.

At gravity 29.5, a 10.5 m/s spring rises 1.9 m instead of 2.8 m, so lips were missed. **Fixed:** these now scale by √(g/20), and time windows by 1/√(g/20). A jump goes as high, and a drop lands as hard, under any gravity, only quicker. The house values are unchanged: the full suite still holds 195/198.

After the fix (autopilot, proposed set): 2.4 street drops a minute (from 3.2), a 346 m path.

## Wall speed against a slower run

A wall run needs `wallSpeed` (10.5 m/s, unchanged), but the proposed sprint is 11, so wall runs barely trigger. Scaled with the speeds (`wallSpeed=8`): 1.8 street drops a minute (house: 2.4), a 377 m path.

## The scenes

- house: 195/198;
- proposed: 157/198;
- proposed after the gravity fix, with wallSpeed=8: 171/198.

What still fails is mostly authored timing: the scripted stick was written against the house's arcs and pace. Examples: the short lip catch (it arrives short at 6.5 m/s), the tic-tac (needs pace), the courtyard's swing out and opening, the three-box vault set, and the dead-end chimney.

## What it would take to make the proposed set the house

1. Take the gravity fix (done) and scale `wallSpeed` (about 8) with the slower speeds.
2. Re-author or re-time the scenes that assume house pace. Some may want their courses shortened rather than the stick retimed.
3. Decide on dives. `diveDrop=6.9` with `drop=4` all but removes them; `diveDrop` around 5 brings some back.
4. The camera's `eyeLope 1.5` and `eyeImpact 1.55` are nearly four times the house values. The sim can't judge that; it needs checking on a phone for comfort.
5. Planning: the planner foresees with the runner itself, so its routes stay true under any dials. But its 3 s horizon reaches only 21 m at the slower pace, against 27 m. A horizon of about 3.8 s would see as far, at about 25% more planning cost. Its weights are in metres made, so the street cost (14) weighs relatively more at the slower pace; that probably helps.
