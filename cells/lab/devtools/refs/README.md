# Reference clips

Clips we study for movement and feel, kept as **manifests, not media**: each set (`<set>.json`) says
where every clip came from (URL, author, title, date), what it is (size, frame rate, how it was
made), and what is in it, segment by segment (time from the clip's start in seconds, a label for
what's seen, the parkour moves, the eye, our nearest move or state, and measured timings). The
clips and their frames are not ours and are never committed. `../refs.mjs` makes them again into
`../out/refs/<id>/` (git-ignored): the source, a timed contact sheet, and one labelled, timed strip
a segment.

```
node cells/lab/devtools/refs.mjs roofjumps --list          what's recorded
node cells/lab/devtools/refs.mjs roofjumps                 fetch and lay out every clip
node cells/lab/devtools/refs.mjs roofjumps kyo-stair       one clip
```

To add a clip: an entry in the set's manifest (id, url, author, title and its English, uploaded,
duration, source, notes), then segments. Label what is **seen**, not what was meant; where a clip
was made to a prompt and differs from it, say both (`"kong vault (asked)", "leap (seen)"`). Timings
in a segment's notes are the measurements we use: read them off a 24 fps strip (`"fps": 24`). A
clip whose source has gone can't be made again; its labels and timings still stand.

## roofjumps

| id | what | studied for |
|---|---|---|
| `kyo-rooftops` | the first reference: one take over low rooftops, the glide, down an alley (URL not recorded) | the eye, the city's grain, lightness |
| `kyo-stair` | a sprint, a step up, a fire escape climbed rail to rail a storey a beat, the roof, the bag | the climb chain, body length, the landing beat, rhythm |
| `kyo-kling-parkour` | eight cut shots, each a named move: kong, wall run and tic tac, cat leap, webster, dive roll, underbar and side flip, a parapet, a last flip | the move vocabulary, momentum through moves, contact; with its prompt (`kyo-kling-parkour.prompt.md`) |

All three are by 梔虚月 (@KYOGETSU_2026) and, by the author's account, generated (Kling).

### The prompt, read for how it directs movement

`kyo-kling-parkour.prompt.md` is the author's prompt for that clip. Read for its direction of motion
(not its look, not as a brief for us):

- **It directs by vocabulary and schedule.** Each shot names one or two parkour moves and gets
  1.6-2.1 s. Eight named moves in fifteen seconds is dense: what came back summarises several (the
  kong is a high leap with the arms spread; the dash vault, the speed vault and the palm spin aren't
  there to be seen). A named move is a label; it doesn't carry the mechanics.
- **What it asks of the motion is outcomes and continuity:** "lands precisely and continues running",
  "without losing momentum", "clearly show the relationship between her foot placement, the wall,
  and the landing point", "immediately rising from the roll". Those are the same things we direct
  the runner by: momentum carried through takeoffs, a contact for every jump, no stop on landing.
- **What it leaves out is timing inside a move:** the wind-up, the load, the hang, the body's change
  of length, the weight on landing, the beat. Adjectives stand in for them ("exceptional athletic
  ability, precise body control, powerful acceleration, graceful aerial movements"), and the
  generator fills them generically. `kyo-stair`, one continuous action with the eye wide and still,
  shows those far better: it is where our timings came from.
- **The cuts hide the joins.** A cut every two seconds means no move has to flow into the next on
  screen. A game is one take with no cuts: the joins are most of the work (Roof Jumps' strips
  exist to look at them).
- **As a coverage map** its list is useful. Ours, against it: kong, the two-hand vault; wall run,
  wallrun; tic tac, the kick off a wall (wall to wall); precision, a bound to a narrow landing (no
  stuck landing yet); cat leap, the plant and catch, or a hang (the feet walking up the wall while
  hanging, seen at 3.9-4.3 s, we don't do); dash and speed vaults, the vault; webster, the flip
  (forward only); dive roll, the dive and roll. Not yet: underbar, side flip, palm spin, a stuck
  precision landing.
