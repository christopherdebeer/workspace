/* ---------------------------------------------------------------------------
 * graph/seats.ts — owner-scoped semantic-coordinate lookup (ADR-0092 Inc 1).
 *
 * A node id is either an own-slice key (`file/docs/x.md`) or a grant-folded
 * `owner/key` (`c15r/file/docs/x.md`). Coordinates live in per-owner maps:
 * the viewer's own layout atlas, and one public map (`_home/embed2d.pub`)
 * per granting owner. The lookup is OWNER-SCOPED, never a flat key strip
 * (ADR-0092 A1): a stripped foreign key could collide with an unrelated own
 * fact of the same name and seat the node at a meaningless position in the
 * wrong basis; and two owners' maps are in incomparable bases, so a merged
 * flat map would be wrong twice over. Per-owner constellations render as
 * islands — the honest interim until a shared public basis (Inc 4a).
 *
 * Pure + dependency-free so it unit-tests without the browser bundle.
 * ------------------------------------------------------------------------- */

export type CoordMap = Record<string, number[]>;
export type PubMaps = Record<string, CoordMap>;

/** The semantic coordinate for a node id, or undefined (→ the caller's
 *  golden-spiral fallback seat). Own map first, EXACT id only — own keys
 *  legitimately contain `/` (`file/docs/x`), so the own lookup never parses.
 *  Then, when the id's leading segment names an owner we hold a public map
 *  for, that owner's map under the bare remainder. */
export function lookupCoord(id: string, own: CoordMap | null, pub: PubMaps | null): number[] | undefined {
  const exact = own?.[id];
  if (exact) return exact;
  if (!pub) return undefined;
  const slash = id.indexOf('/');
  if (slash <= 0) return undefined;
  const ownerMap = pub[id.slice(0, slash)];
  return ownerMap?.[id.slice(slash + 1)];
}
