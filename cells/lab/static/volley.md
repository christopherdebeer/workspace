# Volley

> A ball thrown up into fractured sheets and caught again. There is no paddle: the screen is a pane, and you return the ball with a hand on it.

![Before the first ball](volley/v-ready.jpg)
![A sheet being broken](volley/v-struck.jpg)

You are lying on your back, throwing a bouncy ball up at what hangs above you: sheets of fractured plaster, one behind another, each with holes through it. The ball breaks the shard it strikes and falls back; wherever it comes back through the pane, a hand has to be there. Break most of a sheet and the rest of it gives way, and you rise to the next. A ball let through is one of five gone.

Touch the pane to pick the ball up, and let go to throw it: a flick is a hard throw that way, a plain lift is a toss straight up. The ring that closes on the pane is where the ball is going to come through.

## Sheets and shards

A sheet is one broken thing, not a wall of parts. It is a scatter of points, each point's nearest ground a shard (a Voronoi figure), so every shard is a flat-sided, many-cornered piece that fits its neighbours; the holes are where shards were left out (an eye, a few rounds, rows of arches, a rose, bands), and the sheet's own edge is ragged, a piece broken off something larger. Sheets fill in the further you go.

- **The ball meets a shard as the solid it is**: its face, or its broken edge inside a hole.
- **Struck, a shard breaks**, and the ball comes off it and falls.
- **Struck hard and square, it bursts** and the ball goes on through, a fifth slower, and the shards round the place go with it: the harder the throw, the bigger the hole, and one good throw can go through two sheets.
- **Glazed shards** (blue, usually ringing a hole) take two blows, craze at the first, and always turn the ball.
- **Three fifths of a sheet broken** (or sixteen shards, if that's fewer) and the rest gives way, outward from where it was last struck, and falls toward you.

![Glazed shards](volley/v-glazed.jpg)

## The ball

- **It falls back.** Thrown up, it slows all the way; if it meets nothing it stops, hangs, and comes down again as fast as it left. Nothing else brings it back.
- **How hard is how high.** How fast your finger is going is how hard the ball goes, and so how far up it gets.
- **It comes down harder off a shard**: the nearer the sheet, the quicker and sharper the volley.
- **It can come down on top of the sheet it went through**, and break its way back.
- **It spins.** The sideways motion of your finger leaves the ball spinning that way, and the spin bends its flight for about a second, or until a bounce takes most of it off.
- **The four sides of the screen are sides**: it comes off them, keeping nine tenths.

## One hand

What a finger is to the ball is decided at the moment the ball lands on it, by two things: whether the finger is moving, and how long ago it touched down.

| as the ball lands, the finger is | it is | and the ball |
|---|---|---|
| still, and only just down (under a third of a second) | a **catch** | stops under the finger and stays there; thrown when you let go, the way and as hard as the finger is then moving |
| still, and long down | a **pad** | springs back by where on the pad it landed (off the middle, straight up; off the rim, sharply away), about as hard as it came |
| moving, and only just down | a **swipe** at it | leaves the way the finger was going, as hard as it was going; the most the ball can be turned |
| moving, and long down | a **bat being moved** | leaves partly the finger's way and partly by where it landed: turned less than half as much as by a swipe at it |

A finger left on the pane is a bat, and will keep the ball up on its own. Sliding it to get under the ball turns the return into a hit. Lifting off and coming down late is a catch, which is the one that needs timing, and buys you the time to look and throw.

The ring under your finger shows which of these it would be right now: a washed disc for a pad, the disc dotted round for a catch, a wide dashed ring for a hit. A mouse with no button down is a long-held finger; pressing is touching down.

**hand** (shown when the ball isn't in play) steps through the one hand and each of the three alone (`pad`, `swipe`, `catch`), for comparing; each keeps its own best.

## Reading it

- **Shadows.** One low, warm light from behind your shoulder, and it casts: each sheet's holes fall on the sheet behind, and so does the ball. The gap between the ball and its shadow is its height off that sheet.
- **Haze.** Everything further is paler, into the sky's own colour, so sheets sort themselves by depth.
- **The ring on the pane**, for the last second and a third of the ball's fall. `guide=0` takes it away.
- **Sound.** Fired clay, placed left and right and quieter with distance: a crack for a break, a lower burst for a ball going through, a ring for glaze, a rumble when a sheet goes.
- **Never hidden.** Behind a sheet the ball is drawn faintly through it.
- The air changes colour every hundred and fifty metres.

![On a wider screen](volley/v-wide.jpg)

## How it is made

- `client/volley/sim.ts` is the game and nothing else: a falling, spinning sphere against convex prisms and four sides, in fixed steps of 1/240 s, everything random from the seed. Hands are given to it as points on the pane with a velocity and an age. It also holds the stand-in player. Tested on its own in `devtools/volley.test.mjs`.
- `client/volley/draw.ts` draws it. Every solid is a flat-faced prism: a shard (its face tilted a little off the sheet's plane, so no two catch the light alike), or a piece of one in the air; even the ball is faceted. A sheet's mesh is made again when a shard of it changes. What a face is made of (plaster, fired red, crazed glaze, the bare body on a broken edge) is worked out where it's drawn. A shadow map from the one light; haze into a sky gradient. No assets, no libraries.
- `client/volley/main.ts` is the fingers, the pieces in the air (a struck shard chips into a few, a burst one into many, a fallen sheet's go whole), the ball's wake, the dust, the sound and the words.
- `static/volley-brief.md` describes the game with no picture in it, for anyone who wants to imagine it differently. This look began from four such imaginings.

## Flags

`seed` (a number, or a name like `moss-ford-7`), `hand` (`all`, or `pad`, `swipe`, `catch` alone), `auto` (the stand-in plays), `t` (run on this many seconds first, the stand-in playing), `still` (and hold there), `guide=0`, `mute`, `preview` (the index's card). `window.__volley.probe()` reports the game and the renderer.

## Before this

Four earlier versions are in the repository's history: a court seen from behind a dragged paddle; a tunnel of block slabs with three separate hands and an arcade ball; the same with a ball that fell down the screen; and the same with the fall turned toward you and the hands made one.
