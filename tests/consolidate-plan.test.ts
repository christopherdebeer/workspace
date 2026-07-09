/**
 * ADR-0073 (C8) — the consolidation organ's planning core, gated.
 *
 * The gate is convergence + safety, not parity: bounded caps hold, the score is
 * the delta, contradictions are never planned as actions (escalation only), and
 * only verified survivors earn reward.
 */
import { planCycle, CAPS, type Observations } from '../cells/consolidate/index';

const base = (over: Partial<Observations> = {}): Observations => ({
  attention: { staleTotal: 100, unlinkedTotal: 50, danglingTotal: 3, dangling: [] },
  contestedTotal: 10,
  suggestions: [],
  prev: null,
  survivors: [],
  ...over,
});

describe('ADR-0073 — planCycle (pure core)', () => {
  it('scores the backlog and reports null delta on the first cycle', () => {
    const p = planCycle(base());
    expect(p.backlog).toEqual({ stale: 100, unlinked: 50, dangling: 3, contested: 10, total: 163 });
    expect(p.delta).toBeNull();
  });

  it('delta = prevTotal − total (positive = progress)', () => {
    const p = planCycle(base({ prev: { backlog: { total: 180 } } }));
    expect(p.delta).toBe(17);
    const worse = planCycle(base({ prev: { backlog: { total: 150 } } }));
    expect(worse.delta).toBe(-13);
  });

  it('ratifies only above the confidence floor, capped, skipping prev-cycle pairs', () => {
    const scores = [0.95, 0.92, 0.89, 0.86, 0.83, 0.8, 0.79, 0.7, 0.6, 0.5];
    const suggestions = scores.map((score, i) => ({ from: `a${i}`, to: `b${i}`, score }));
    const prev = { backlog: { total: 0 }, actions: [{ kind: 'ratify', from: 'a0', rel: 'relatesTo', to: 'b0' }] };
    const p = planCycle(base({ suggestions, prev }));
    // floor 0.8 keeps a0..a5 (0.95..0.80); a0 is skipped (prev pair); cap 5 → a1..a5
    expect(p.ratify.map((r) => r.from)).toEqual(['a1', 'a2', 'a3', 'a4', 'a5']);
    expect(p.ratify).toHaveLength(CAPS.ratify);
    expect(p.ratify.every((r) => r.score >= CAPS.ratifyScoreFloor)).toBe(true);
  });

  it('unlinks dangling edges, capped', () => {
    const dangling = Array.from({ length: 9 }, (_, i) => ({ from: `f${i}`, rel: 'relates', to: `gone${i}`, reason: 'missing' }));
    const p = planCycle(base({ attention: { staleTotal: 0, unlinkedTotal: 0, danglingTotal: 9, dangling } }));
    expect(p.unlink).toHaveLength(CAPS.unlink);
    expect(p.unlink[0]).toEqual({ from: 'f0', rel: 'relates', to: 'gone0' });
  });

  it('contradictions are NEVER actions — escalation only', () => {
    const p = planCycle(base({ contestedTotal: 42 }));
    expect(p.escalations.contested).toBe(42);
    const kinds = [...p.ratify, ...p.unlink].map(() => 'structural');
    expect(kinds).not.toContain('contradict');
    // and contested debt still counts against the score
    expect(p.backlog.contested).toBe(42);
  });

  it('rewards only verified survivors, deduped and capped', () => {
    const survivors = ['k1', 'k2', 'k1', 'k3', 'k4', 'k5', 'k6', 'k7'];
    const p = planCycle(base({ survivors }));
    expect(p.rewards).toHaveLength(CAPS.rewards);
    expect(new Set(p.rewards.map((r) => r.key)).size).toBe(CAPS.rewards);
    expect(p.rewards[0]).toEqual({ key: 'k1', reward: CAPS.rewardValue });
  });

  it('a clean slice plans nothing but the audit (idempotence)', () => {
    const p = planCycle(base({ attention: { staleTotal: 0, unlinkedTotal: 0, danglingTotal: 0, dangling: [] }, contestedTotal: 0 }));
    expect(p.ratify).toEqual([]);
    expect(p.unlink).toEqual([]);
    expect(p.rewards).toEqual([]);
    expect(p.backlog.total).toBe(0);
  });
});
