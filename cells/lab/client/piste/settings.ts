/**
 * The player's settings, kept on this device (localStorage), and the challenge's progress. A flag in the address
 * (`?thumb=point`, `?cloth=sim`, …) still wins over a setting, so links and the devtools keep working as they did.
 * Storage can be missing or refuse (a private window, blocked site data): then the defaults, and nothing is kept.
 */
export interface Settings {
  thumb: 'hand' | 'point';
  cloth: 'sim' | 'posed';
  ceremony: 'on' | 'off';
  replay: 'on' | 'off';
  readout: 'off' | 'on';
  view: 'mask' | 'side' | 'over';
}
export const DEFAULTS: Settings = { thumb: 'hand', cloth: 'sim', ceremony: 'on', replay: 'on', readout: 'off', view: 'mask' };

/** what the settings card offers: each setting, its name, and its choices */
export const CHOICES: { key: keyof Settings; label: string; options: [string, string][] }[] = [
  { key: 'thumb', label: 'right thumb', options: [['hand', 'moves the hand'], ['point', 'moves the point']] },
  { key: 'view', label: 'camera', options: [['mask', 'through your mask'], ['side', 'from the side'], ['over', 'over your shoulder']] },
  { key: 'cloth', label: 'kit', options: [['sim', 'simulated cloth'], ['posed', 'posed (lighter)']] },
  { key: 'ceremony', label: 'between touches', options: [['on', 'walk back, salute'], ['off', 'straight back on guard']] },
  { key: 'replay', label: 'replays', options: [['on', 'after each touch'], ['off', 'off']] },
  { key: 'readout', label: 'readout', options: [['off', 'off'], ['on', 'the numbers']] },
];

// (v2: the simulated cloth became the default; a v1 setting for the kit, saved when it was only ever the default, is
// dropped, the others kept)
const KEY = 'piste.settings.v2', OLD = 'piste.settings', CHALLENGE = 'piste.challenge';
const read = (k: string): string | null => { try { return localStorage.getItem(k); } catch { return null; } };
const write = (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* not kept */ } };

export function loadSettings(): Settings {
  try {
    const now = read(KEY);
    if (now) return { ...DEFAULTS, ...(JSON.parse(now) as Partial<Settings>) };
    const { cloth: _, ...old } = JSON.parse(read(OLD) ?? '{}') as Partial<Settings>;
    return { ...DEFAULTS, ...old };
  } catch { return { ...DEFAULTS }; }
}
export function saveSettings(s: Settings) { write(KEY, JSON.stringify(s)); }

/** the challenge: how many levels in turn have been beaten */
export function challengeBeaten(): number { const n = Number(read(CHALLENGE)); return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0; }
export function setChallengeBeaten(n: number) { write(CHALLENGE, String(n)); }
