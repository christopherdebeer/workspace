/**
 * Membrane teaching surfaces (wave-7) — the generalization of the W5-2 class.
 *
 * The retired-alias guard in `workspace.test.ts` asserts the old verbs are GONE
 * from the membrane. That is only half the invariant: a verb can be gone and
 * still be *taught*. Live probes found `workspace.recall`'s own `hints` — the
 * most-read teaching surface in the system, returned by every bare `recall()` —
 * instructing agents to call `search({ text })` and `neighbors({ key })`, both
 * retired since ADR-0069/0071. Following the hints produced `capability_retired`.
 *
 * The invariant here: NOTHING THE MEMBRANE SAYS MAY NAME A VERB THE MEMBRANE NO
 * LONGER ACCEPTS. Prose drifts; a derived list cannot.
 */
import { OVERVIEW_HINTS, liveHints } from '../services/workspace/commands-read';
import { TOOL_DESCRIPTORS } from '../services/workspace/descriptors';

const LIVE = new Set(TOOL_DESCRIPTORS.map((d) => d.name));

/** The gateway's tombstoned names (services/gateway/service.ts RETIRED). */
const RETIRED = [
  'search', 'neighbors', 'links', 'graph', 'members',
  'registerAction', 'invoke', 'registerView', 'view', 'registerSubscription',
];

describe('recall hints never teach a retired verb', () => {
  it('every hint names only verbs the workspace still declares', () => {
    for (const hint of OVERVIEW_HINTS) {
      for (const verb of hint.verbs) {
        // Fail LOUD in CI when a verb is retired without its hint being rewritten.
        // (In prod `liveHints()` drops the hint instead — a missing hint is safe,
        // a wrong one is not.)
        expect({ verb, hint: hint.text, live: LIVE.has(verb) }).toEqual({ verb, hint: hint.text, live: true });
      }
    }
  });

  it('no hint TEXT mentions a retired verb name in a call position', () => {
    for (const { text } of OVERVIEW_HINTS) {
      for (const dead of RETIRED) {
        // `dead(` or `dead({` — the shape a hint uses to teach a call. This is
        // what the live defect looked like: "search({ text })", "neighbors({ key })".
        expect(text).not.toMatch(new RegExp(`\\b${dead}\\s*\\(`));
      }
    }
  });

  it('the shipped hints are the live ones (nothing dropped today)', () => {
    expect(liveHints()).toHaveLength(OVERVIEW_HINTS.length);
  });

  it('drops a hint whose verb is not live, rather than shipping it', () => {
    const withDead = [
      { verbs: ['query'], text: 'live one' },
      { verbs: ['neighbors'], text: 'its links: neighbors({ key })' },
      { verbs: ['peek', 'neighbors'], text: 'partly dead' },
    ];
    expect(liveHints(withDead)).toEqual(['live one']);
  });

  it('teaches the ADR-0069/0071 successors', () => {
    const all = liveHints().join('\n');
    expect(all).toMatch(/query\(\{ text \}\)/); // was search({ text })
    expect(all).toMatch(/edges\(\{ around: key \}\)/); // was neighbors({ key })
  });
});
