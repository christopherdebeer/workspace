/** Collision-proof ids for board entities. `Date.now()` alone collides the
 *  moment two entities are minted in one tick (bulk duplicate did exactly
 *  that: N copies sharing one id, node maps and fact keys collapsing onto
 *  one). Monotonic counter + time keeps ids short, sortable and unique
 *  within a session; the random tail de-dupes across sessions. */
let n = 0;
export function uid(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}${(n++).toString(36)}${Math.random().toString(36).slice(2, 5)}`;
}
