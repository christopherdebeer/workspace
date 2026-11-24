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

## If landing in the street is a failure (a life lost, back to a checkpoint)

Then street landings per minute is the number that matters. The autopilot stands in for a competent player.

| autopilot (4 characters × 5 seeds × 60 s) | street landings / min |
|---|---|
| house, street cost 14 (as now) | 2.0 |
| house, street cost 40 | 1.1 |
| house, street cost 40, fan ±132° | 1.05 |
| proposed + wallSpeed 8, street cost 40 | 1.4 |
| proposed + wallSpeed 8, street cost 40, fan ±132° | 1.15 |

Even with the planner pushed as far as its dials go, it's about one life a minute. A 3.8 s horizon didn't help.

Each street landing was logged (`why` in the autopilot's output). In about 95% of them, every route in the fan already went down at the last plan: by then, nothing could be done. They come from:
- **misses in the air:** bound › fall, spring › fall, kick › fall, hang › fall;
- **deliberate drops:** the leap's choice takes "the highest place in reach, however far down" when nothing is level, and dives can end in the street;
- **boxed in:** a roof with no way on, where every heading leads down.

What it would take:
1. **The leap shouldn't choose the street.** Under this rule, with nothing in reach but the street, the runner should stop at the edge (and the planner then sees a route that stops).
2. **Saves matter more.** A miss should look for a catch (a lip, a sill, a pipe, a fire escape) before it falls through. That's where the gravity fix pays off.
3. **The city must be passable for the dials.** Which gaps can be crossed depends on gravity, the speeds and the leap's reach. Changing the dials changes which roofs are dead ends, and with this rule a dead end is fatal. A reachability check over the roofs, using the jump envelope the dials allow, should shape generation and place the checkpoints.
4. **Checkpoints** on roofs the check knows have a way on.
5. **The planner:** street cost at its maximum, a wider fan (a small gain), and routes that stop or turn back.

## Done: the street as a fall (`streetFail`, on by default)

1. **The leap never chooses the street.** The street isn't counted as a landing (neither within `drop`, nor in the "highest place in reach" fallback). With nothing else in reach, the runner balks: it stops at the edge. Running off an edge onto the street stops it too.
2. **Saves.** Falling toward the street, the hands reach further for a lip or a hold (0.7 m rather than 0.35 m out; holds within 1.2 m), and hold on at a faster fall (15 m/s rather than 10–11 m/s at house gravity). A hang over the street holds on: it doesn't let go when steered away, or when nothing else is to be had (it waits).
3. **The city passable for the dials** (`reach.ts`). A roof graph is built from the leap's envelope (`maxGap(dh)`, `upReach`). A roof with no way on gets a bridge (a slab at its height across the narrowest gap to a neighbour it can then get onto). By this envelope, dead ends are rare: 2 of 10,535 roofs under the house dials, 10 under the proposed (2 of those bridged). The envelope ignores holds, so it errs toward bridging. The city wasn't the problem; the runner was.
4. **Checkpoints** (`checkpoint.ts`). The place to come back to is the last place the runner was surefooted (on a roof, on its feet, 3 s without leaving the ground; kept up to date while it stays so) or the last checkpoint collected, whichever is later. Checkpoints are about 2.5 a chunk, on roofs with two or more ways on, in a clear spot. They're taken within 1.3 m. For now each is a post with a flag (painted as strokes in the stroke looks, drawn as blocks in the others). Coming down to the street is a life lost: the runner is put back, fresh, at that place.
5. **The planner** can stop: when every way in its fan leads down to the street, it stands still until the way asked turns. In autopilot mode it follows its chosen way faster (lean rate 12/s rather than 5/s), so the way taken is the way foreseen.

Lives lost a minute, by the autopilot (4 characters × 3 seeds × 60 s, street cost 40):

| | house | proposed + wallSpeed 8 |
|---|---|---|
| rule off (street landings per roof-minute) | 1.06 | 1.84 |
| rule on: leap, balk and saves | 1.33 | 1.92 |
| + the planner can stop | 1.25 | 1.83 |
| + hold on over the street, follow the plan faster | **0.5** | **0.67** |

What still brings it down: single misses in the air (a spring, a bound or a kick short, a climb that fails).

Checkpoints collected: about 1 a minute (house) and 0.1 a minute (proposed). The wander doesn't seek them; the planner doesn't value them yet.

## Adopted (24 November): the proposed dials are the house

The house is now the proposed set (the autopilot left off), with `wallSpeed 8` and `wStreet 40` added: plan 1, assist 1, wStreet 40, run 6.5, sprint 11, dash 14, dashTime 1.15, accel 31, grip 4, ledgeSpeed 7.5, ledgePull 0.6, gravity 29.5, jumpReach 11, rise 4.6, drop 4, leapSpeed 15, diveDrop 6.9, hang 0.55, emphasis 1, wallLift 47, wallSpeed 8, wallGravity 16, kick 9, climb 23.5, eyeLope 1.5, eyeImpact 1.55.

The authored scenes, and the unit tests' scripted runs on the practice line, run under the dials they were written against (`SCENE_TUNE` in tune.ts: the old house), so they stay tests of the mechanics they were made for. An address's dials, or the scenes devtool's `--dials=`, go over those. The scenes hold 195/198 that way.
