/**
 * Roof Jumps' dials: every number worth turning while it runs, named, ranged, grouped, with the value the house keeps.
 * `TUNE` is them as they stand: the runner, the planner and the eye read it each step, so a dial turned is felt at
 * once. No DOM here (palette.ts draws them; the address keeps the ones that differ from the house).
 */
export interface Dial {
  key: string; name: string; group: string; min: number; max: number; step: number; house: number;
  /** on or off (1 or 0) */
  toggle?: boolean;
  /** what it's measured in, after the number */
  unit?: string;
}
const d = (group: string, key: string, name: string, min: number, max: number, step: number, house: number, unit = ''): Dial => ({ group, key, name, min, max, step, house, unit });
const t = (group: string, key: string, name: string, house: number): Dial => ({ group, key, name, min: 0, max: 1, step: 1, house, toggle: true });

export const DIALS: Dial[] = [
  t('plan', 'plan', 'show the plan', 0),
  t('plan', 'readout', 'say it in words', 0),
  d('plan', 'horizon', 'how far ahead', 0.5, 6, 0.1, 3, 's'),
  d('plan', 'fan', 'ways each side', 1, 6, 1, 4),
  d('plan', 'fanStep', 'between ways', 4, 30, 1, 11, '°'),
  d('plan', 'assist', 'steer onto the best', 0, 1, 0.05, 0),
  d('plan', 'wStreet', 'cost of the street', 0, 40, 1, 14),
  d('plan', 'wClimb', 'cost of a climb', 0, 20, 0.5, 6, '/s'),
  d('plan', 'wGlide', 'cost of gliding', 0, 10, 0.5, 2, '/s'),
  d('plan', 'wFlow', 'worth of a wall or ledge', 0, 10, 0.5, 2, '/s'),

  d('run', 'run', 'run', 4, 16, 0.5, 10.5, 'm/s'),
  d('run', 'sprint', 'sprint', 6, 22, 0.5, 14, 'm/s'),
  d('run', 'dash', 'dash', 8, 30, 0.5, 18.5, 'm/s'),
  d('run', 'dashTime', 'dash lasts', 0, 2, 0.05, 0.55, 's'),
  d('run', 'accel', 'quickness', 10, 120, 1, 42, 'm/s²'),
  d('run', 'ledgeSpeed', 'on a ledge', 4, 16, 0.5, 10.5, 'm/s'),
  d('run', 'ledgePull', 'a ledge draws you', 0, 1, 0.05, 0.6),

  d('leap', 'gravity', 'gravity', 6, 40, 0.5, 20, 'm/s²'),
  d('leap', 'jumpReach', 'reach', 3, 20, 0.5, 8, 'm'),
  d('leap', 'rise', 'springs up', 1, 7, 0.1, 3.4, 'm'),
  d('leap', 'drop', 'drops before looking higher', 2, 20, 0.5, 7, 'm'),
  d('leap', 'leapSpeed', 'fastest leap', 8, 30, 0.5, 19, 'm/s'),
  d('leap', 'diveDrop', 'dives from', 0.5, 8, 0.1, 2, 'm down'),
  d('leap', 'hang', 'extra height', 0, 2, 0.05, 0, 'm'),
  d('leap', 'apexHold', 'held at the top', 0, 0.3, 0.01, 0, 's'),
  d('leap', 'emphasis', 'effort shown', 0, 1, 0.05, 0),

  d('glide', 'glideDrop', 'glides from', 2, 20, 0.5, 6, 'm down'),
  d('glide', 'glideDist', 'or across', 4, 25, 0.5, 11, 'm'),
  d('glide', 'glideGravity', 'gravity, gliding', 1, 20, 0.5, 8, 'm/s²'),
  d('glide', 'sink', 'sinks at most', 2, 20, 0.5, 4.5, 'm/s'),
  d('glide', 'steer', 'steering in the air', 0, 40, 1, 16, 'm/s²'),

  t('wall', 'walls', 'runs along walls', 1),
  d('wall', 'wallTime', 'a wall run lasts', 0.2, 4, 0.05, 1.5, 's'),
  d('wall', 'wallLift', 'leaning in lifts you', 0, 60, 1, 30, 'm/s²'),
  d('wall', 'wallRise', 'climbing at most', 0, 14, 0.5, 6, 'm/s'),
  d('wall', 'wallCost', 'going up spends the run', 0, 4, 0.1, 1, '×'),
  d('wall', 'wallDrag', 'and the pace along', 0, 12, 0.5, 3, 'm/s²'),
  d('wall', 'climbSquare', 'a climb only if met within', 0, 60, 1, 20, '° of square'),
  d('wall', 'wallSpeed', 'at least', 4, 20, 0.5, 10.5, 'm/s'),
  d('wall', 'wallReach', 'takes a wall within', 0.4, 2.5, 0.05, 1.05, 'm'),
  d('wall', 'wallGravity', 'gravity on a wall', 0, 20, 0.5, 9, 'm/s²'),
  d('wall', 'kick', 'kick off', 2, 12, 0.5, 6, 'm/s'),
  d('wall', 'climb', 'up a wall', 4, 30, 0.5, 14, 'm/s'),

  t('holds', 'holds', 'show the holds', 1),
  d('holds', 'holdsNear', 'shown within', 3, 40, 1, 10, 'm'),
  t('holds', 'reach', 'hands and feet go to them', 1),
  t('holds', 'feet', 'feet are placed', 1),
  d('holds', 'armReach', 'a hand reaches up', 1.4, 3.2, 0.05, 2.4, 'm'),
  d('holds', 'vaultLow', 'a vault clears by', 0, 1, 0.05, 0.12, 'm'),
  d('holds', 'gripReach', 'finds a hold within', 0.3, 2, 0.05, 0.9, 'm'),

  d('eye', 'eyeDist', 'distance', 2, 20, 0.1, 4.6, 'm'),
  d('eye', 'eyePitch', 'from above', 0, 80, 1, 17, '°'),
  d('eye', 'fov', 'lens', 30, 110, 1, 68, '°'),
  d('eye', 'rush', 'widens with speed', 0, 30, 1, 13, '°'),
  d('eye', 'follow', 'comes round behind', 0, 4, 0.05, 0.9),
  d('eye', 'side', 'swung round', -180, 180, 5, 0, '°'),

  d('time', 'time', 'speed of time', 0.05, 1.5, 0.05, 1, '×'),
  t('time', 'pause', 'held', 0),
  t('time', 'auto', 'runs itself', 0),
];

export type Tune = Record<string, number>;
export const HOUSE: Tune = Object.fromEntries(DIALS.map((x) => [x.key, x.house]));
/** the dials as they stand */
export const TUNE: Tune = { ...HOUSE };

/** the dials an address names, over the house's */
export function readTune(q: URLSearchParams): void {
  for (const x of DIALS) {
    const legacy = q.get('reach');
    const v = x.key === 'jumpReach' && Number(legacy) > 1 ? q.get(x.key) ?? legacy : q.get(x.key);
    if (v === null) continue;
    const n = x.toggle ? (v === '0' || v === 'false' ? 0 : 1) : Number(v);
    if (Number.isFinite(n)) TUNE[x.key] = Math.min(x.max, Math.max(x.min, n));
  }
}
/** an address's query with the dials that differ from the house in it (and the ones that don't, out) */
export function writeTune(q: URLSearchParams): void {
  for (const x of DIALS) { if (TUNE[x.key] === x.house) q.delete(x.key); else q.set(x.key, String(TUNE[x.key])); }
}
