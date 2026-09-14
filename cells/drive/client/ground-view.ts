import { COVER_INK, ECO_INK, type ChartLayerId } from './chart-layers';

/**
 * ── A GROUND VIEW IS A CHANNEL IN THE RENDERER, NOT A LAYER OVER IT ──
 *
 * `?tdetail=dom` paints the substrate's own classification into the terrain's
 * fragment — red outcrop, green turf, blue regolith — and it works from the
 * seat, from the cab and from the chart, because it is not a thing drawn over
 * the ground, it IS the ground, coloured by what it is made of instead of by
 * what it looks like. The seat's verdict on that was the reason for this file:
 * *that is how we should be showing the overview layers*.
 *
 * The thematic chart layers were built the other way — a class raster baked per
 * FAR SHELL TILE, hung as a decal, drawn only in the top camera past 15 m a
 * pixel. Three consequences, none of them chosen:
 *
 *   - they cannot answer the question from the seat, which is where every
 *     fault in this game has been found;
 *   - they read the SHELL's cover (a 19 km tile at 64 texels, about 300 m a
 *     texel) and draw it over a fine world holding the z12 raster at 38 m —
 *     so the layer is coarser than the ground it is describing;
 *   - and they carry a bake, a re-bake ladder, a settle rule and a lifetime
 *     keyed to a mesh, all of which a fragment term simply does not have.
 *
 * So a view is one uniform on the terrain material and the evidence rides on
 * the geometry, exactly as the substrate's does.
 *
 * ── THE PALETTE IS A 256-WIDE LOOKUP INDEXED BY THE CLASS BYTE ITSELF ──
 *
 * GLSL ES 1.00 forbids dynamically indexing a uniform array in a fragment
 * shader (see markTins in facade.ts, the worked example), so a palette has to
 * be a texture. Making it 256 wide and indexing it by the RAW class byte — 10,
 * 20, … 95, 100 for WorldCover; 1..14 for RESOLVE — means there is no ordinal
 * mapping anywhere: not in the kernel, not in the shader, not in this file.
 * A table that exists in two places is a table that will disagree, and the
 * cover classes are not contiguous, so the mapping would have been a real one.
 * A kilobyte of texture buys its absence.
 *
 * ALPHA IS THE COVERAGE CLAIM. A class the dataset does not define — byte 0,
 * an unloaded tile, ground nothing has measured — is alpha 0 and the ground
 * keeps its own colour. An overlay that fills its gaps with a colour is lying
 * about its coverage, and saying where the data IS is most of what these views
 * are for.
 */
export type GroundViewId = 'off' | 'substrate' | 'cover' | 'eco';

/** What the uniform carries. Appended to, never reordered: the value is read
 *  by the shader and by every probe and log line that reports a view. */
export const GROUND_VIEW: Record<GroundViewId, number> = Object.freeze({
  off: 0, substrate: 1, cover: 2, eco: 3,
});

/**
 * The chart layers the CHANNEL serves. A chip for one of these sets the
 * uniform; `roads` and `places` stay booleans on passes that were already
 * running, and anything thematic that is NOT here keeps its baked sheet.
 *
 * ECO IS NOT HERE YET, and the reason is the data path rather than the shader.
 * Cover rides the geometry — the kernel already samples the class per vertex
 * and the shell's bake already reads it, so `aTd.w` costs one extra
 * `sampleCover` and nothing else, and the view is then exact at the raster's
 * own resolution with no reach limit and no repaint. An ecoregion is a
 * point-in-polygon over a z5 tile, which the terrain kernel cannot do at all
 * (it runs in a worker that has never heard of the eco store) and which costs
 * about 7 ms a tile to fill in on the main thread at apply time. That is
 * affordable ON DEMAND — only when the view is asked for — and it is its own
 * unit. Until then the eco chip keeps the sheet it has.
 */
export const VIEW_FOR_LAYER: Partial<Record<ChartLayerId, GroundViewId>> =
  Object.freeze({ cover: 'cover', substrate: 'substrate' });

/** The palette as 256 RGBA texels, indexed by the class byte. Alpha 255 where
 *  the dataset defines a class and 0 everywhere else. */
// `Uint8Array<ArrayBuffer>`, not the bare name: typed arrays became generic in
// their buffer at TypeScript 5.7 and lib.dom's BufferSource is invariant
// `ArrayBufferView<ArrayBuffer>`, so a DataTexture will not take the loose one.
// The same five-declaration fix is recorded against HydroTileField and WxField.
export function groundInkPixels(layer: 'cover' | 'eco'): Uint8Array<ArrayBuffer> {
  const px = new Uint8Array(256 * 4);
  const table = layer === 'cover' ? COVER_INK : ECO_INK;
  for (const [k, ink] of Object.entries(table)) {
    const b = Number(k);
    if (!Number.isInteger(b) || b < 0 || b > 255) continue;
    px[b * 4] = ink.rgb[0]; px[b * 4 + 1] = ink.rgb[1];
    px[b * 4 + 2] = ink.rgb[2]; px[b * 4 + 3] = 255;
  }
  return px;
}

/**
 * The fragment half. `gvInk` returns the class's ink with alpha as the
 * coverage claim; the caller decides what to do with a class it has no ink
 * for, which is always "leave the ground alone".
 *
 * THE FALSE COLOUR IS STILL LIT, deliberately. It is assigned to
 * `diffuseColor` and takes the sun, the cloud shadow and the sun march like
 * any other ground, so the landform reads THROUGH the classification — a
 * ridge is still a ridge and a valley still a valley. A flat unlit wash would
 * be a truer map and a worse instrument: the question these views answer is
 * "what does the game think THIS ground is", and the ground has to be legible
 * for the answer to land on it.
 */
export const GV_GLSL = `
vec4 gvInk(sampler2D lut, float cls) {
  return texture2D(lut, vec2((floor(cls + 0.5) + 0.5) / 256.0, 0.5));
}
`;
