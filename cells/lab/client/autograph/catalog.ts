/**
 * The catalogue: every sample, what it was made for, and what I made of it; and each session, what it found and what it
 * decided. It's the journey: read back at the start of each session (I don't remember the last), and only ever added to.
 * Each session keeps its own file (sessions/NN.ts, in order in sessions/index.ts), so adding one never touches another;
 * this assembles them. A sample's review is what I thought then; if I think differently later, that goes in a later
 * session's notes, not over the old words.
 */

import type { Entry, Hand, HandId, Session } from './record';
import { SESSION_FILES } from './sessions';
export type { Entry, Hand, HandId, Session } from './record';

/** every hand, in the order the sessions made them */
export const HANDS = Object.assign({}, ...SESSION_FILES.map((f) => f.hands ?? {})) as Record<HandId, Hand>;
/** every session, in order */
export const SESSIONS: Session[] = SESSION_FILES.map((f) => f.session);
/** every sample, in order */
export const CATALOG: Entry[] = SESSION_FILES.flatMap((f) => f.entries);
/** the newest hand: the last one a session made (the font aside) */
export const NEWEST = (Object.keys(HANDS) as HandId[]).filter((h) => h !== 'font').pop() as HandId;
