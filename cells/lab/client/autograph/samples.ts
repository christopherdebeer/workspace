/**
 * The samples, as made: each written fresh from the hand that made it (the hands are kept as they were, so a sample
 * always comes out the same). Each session's file says how its own are made (sessions/NN.ts); this gathers them.
 */
import type { Sig } from '../switchback/sign';
import { SESSION_FILES } from './sessions';
export { ANSWER } from './sessions/09';
export { E_TEST } from './sessions/10';
export { STOLE, MEANS, MEANINGS } from './sessions/11';

export const MADE: Record<string, () => Sig[]> = Object.assign({}, ...SESSION_FILES.map((f) => f.made ?? {}));
