# Round six: the figure painter rebuilt as masses, then passages (23 November)

This round answers the critique of the 13:29 build ("joins, light, hair, cloth splines"), using the acceptance test it proposed: the runner's head, neck and jacket from behind, in profile and from the front.

- `gloss-on-then-off.jpg`: the same pose with the paint's ridge gloss and relief lighting on (top) and off (bottom, `paint=flat`). Most of the plastic shine on skin, and much of the corrugation, came from the gloss. Its default is now a quarter of what it was.
- `runner-head-masses-then-full.jpg`: the head close-ups. The top row is the broad masses alone (`paint=masses`); the bottom row adds the passages (locks, fringe, collar, along-strokes).
- `runner-play-size-masses-then-full.jpg`: the same at play size. The left three are masses only, the right three are full; each set is behind, profile, front.
- `cast.jpg`: the schoolgirl running, the older figure running, the teen and the slight figure standing.

What changed in the painter:
- Every stroke is fixed on the body: in bone space, seeded by place, with a fixed count. Nothing is chosen by the eye or by distance. Strokes are laid all round a form, and a stroke on the far side hides itself (the new `front` spline flag), so the eye decides only what shows, never where paint goes.
- The jacket is blocked in as its panels (back, two sides, and two fronts meeting at the opening), the shoulder slope from nape to shoulder point (behind and in front), sleeves hung from the shoulder through the elbow to the cuff, and a collar band round the neck that runs under the hair.
- The neck runs from inside the collar to under the jaw, in the head's shadow; the jaw goes over it.
- The head is blocked in whole in the hair's dark (on its axis, a little behind the middle, facing the eye). The face is laid over that as one plane from brow to chin, with a plane down each side (the sun's side lighter) and a faint turn at the brow. Hair masses: crown, skull, temples. The locks stay clear of the face.
- Attachments (the collar flaps, neckerchief, socks, hood, cap, bag, ponytail) are now splines, layered over the garment they sit on. Before, the spline pass painted over them, which is why the schoolgirl's collar got lost.
- All the figure's strokes are painted far to near by form, with a garment's layer lifted over what lies under it.
