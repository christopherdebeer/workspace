/**
 * Every session, in order. Adding one is a new file and a line here; an old one is never opened again.
 */
import type { SessionFile } from '../record';
import s01 from './01';
import s02 from './02';
import s03 from './03';
import s04 from './04';
import s05 from './05';
import s06 from './06';
import s07 from './07';
import s08 from './08';
import s09 from './09';
import s10 from './10';
import s11 from './11';
export const SESSION_FILES: SessionFile[] = [s01, s02, s03, s04, s05, s06, s07, s08, s09, s10, s11];
