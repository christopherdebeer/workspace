# Mistwood

*A walk through a seeded wood, beside a stream, towards the light.* Started 30
September 2026 from two pictures: a green-grey woodland fog with a bare,
leaning tree over dry grass; and a sunlit birch colonnade with a puddled stream
running to bright water and mossy crags (in the manner of Kuindzhi).

Nothing to do and nothing to finish. Hold to walk; drag to look about. The
light over the water stays ahead.

## One seed, one wood

The seed is in the address (`?seed=moss-ford-7`) and at the foot of the screen;
touch it for another wood. Everything comes from it and nothing is stored:
any stretch of the wood is regenerated the same from (seed, chunk).

- **Two poles.** *Mist* (0): bare, leaning trees, green-grey fog, dry russet
  grass, a thin stream. *Light* (1): birches in leaf in rows along the banks,
  green grass in pools of sun, puddles joining into open water, crags standing
  in the far water, leaves closing overhead. A seed sets where its wood sits
  between them; the weather drifts as you walk (seeded noise along the path),
  so one walk can pass from mist into light and back.
- **The stream** is two sines; the walk follows it, a step to one side.
- **Trees** are placed per 8 m chunk: bank trees close to the stream, the rest
  thinning into the wood. Birch, bare, or a small beech keeping russet leaves,
  in proportions set by the weather there.
- **The painting.** Each seed paints its own atlas (`client/sprites.ts`, a 2D
  canvas): birches with cream bark, lenticels, black patches, chevron scars and
  a fissured foot, in leaf or bare; wide bare trees grown by recursive strokes;
  beeches; dry and green tufts. No two woods have the same trees.

## Rendering (`client/render.ts`, WebGL2)

1. One fragment shader for everything behind the trees: a ray per pixel. Sky
   (haze low, the glow of the light ahead, crags, leaves overhead); ground
   (grass, the stream's puddles mirroring the sky, open water far ahead); fog
   by distance.
2. Trees and tufts as billboards from the atlas, back to front, fogged by
   distance and more thickly near the ground, swaying in a wind that rises and
   falls.

Resolution drops by itself if frames are slow (`?fixed` keeps it).

## Sound (`client/audio.ts`)

Synthesised: wind in the trees, steps in the grass while walking, birds — many
in the light, one far call now and then in the mist. Starts on the first touch.

## Debug

`?seed=` · `?at=<metres>` · `?walk=1` (walks on its own) · `?look=<radians>` ·
`?fixed` · `window.__mistwood`.
