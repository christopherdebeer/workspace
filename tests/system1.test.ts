/**
 * @c15r/system1 — the pure core of the ADR-0098 System One organ.
 * Fixtures only; the shell (gateway + @c15r/jev) is exercised live.
 */
import {
  perceivable,
  perceiveQuestions,
  planPerceive,
  planRelate,
  calibrate,
  projectSlug,
  subjectText,
  DEFAULT_THRESHOLDS,
  PERCEIVED_TAG,
  MIN_LABELS,
  type Subject,
  type LabelledAct,
} from '../cells/system1/index';

const projects = [
  { key: 'kb/proj_drive', slug: 'drive', label: 'game, osm' },
  { key: 'kb/proj_shelved', slug: 'shelved', label: 'books' },
];
const goals = [{ key: 'goal/consolidation', id: 'consolidation', title: 'Consolidate the substrate' }];
const subject: Subject = { key: 'inbox/2026-08-29/ocean', type: 'capture', tags: ['inbox'], value: { content: 'oceanAt(x,z) plan' }, version: 'v1', updatedAt: '2026-08-29T00:00:00Z' };

describe('perceivable', () => {
  it('skips plumbing, its own output and decomposition parts', () => {
    expect(perceivable('_docs/sync-manifest', null)).toBe(false);
    expect(perceivable('system1/run/x', 'system1-run')).toBe(false);
    expect(perceivable('judgment/perceive/v1/abc', 'judgment')).toBe(false);
    expect(perceivable('doc-block:docs/x/1', 'doc-block')).toBe(false);
    expect(perceivable('inbox/2026/x', 'capture')).toBe(true);
    expect(perceivable('kb/proj_drive', 'project')).toBe(true);
  });
});

describe('perceiveQuestions', () => {
  it('asks project over live projects + none, serves per goal, and type only when untyped', () => {
    const q = perceiveQuestions(subject, { projects, goals, types: ['capture', 'knowledge'] });
    expect(Object.keys((q.project as { criteria: object }).criteria)).toEqual(['drive', 'shelved', 'none']);
    expect(q['serves:consolidation']).toBeDefined();
    expect(q.type).toBeUndefined();
    const untyped = perceiveQuestions({ ...subject, type: null }, { projects, goals, types: ['capture', 'knowledge'] });
    expect(Object.keys((untyped.type as { criteria: object }).criteria)).toEqual(['capture', 'knowledge']);
  });
});

describe('planPerceive', () => {
  const answers = {
    project: { choice: 'drive', probabilities: { drive: 0.78, shelved: 0.02, none: 0.2 } },
    kind: { choice: 'work', probabilities: { work: 0.6, knowledge: 0.3, noise: 0.1 } },
    actionable: { noul: 0.89 },
    durability: { score: 2.7, probabilities: { '0': 0, '1': 0.01, '2': 0.24, '3': 0.75 } },
    'serves:consolidation': { noul: 0.1 },
  };

  it('materializes only what clears each gate', () => {
    const plan = planPerceive(subject, answers, { projects, goals });
    expect(plan.addTags).toEqual(expect.arrayContaining(['project:drive', 'actionable', 'durable', PERCEIVED_TAG]));
    expect(plan.addTags).not.toContain('s1:noise');
    expect(plan.edges).toEqual([{ rel: 'belongsTo', to: 'kb/proj_drive', p: 0.78, q: 'project' }]);
    expect(plan.type).toBeUndefined();
  });

  it('holds a below-threshold project and never links a fact to itself', () => {
    const weak = planPerceive(subject, { ...answers, project: { choice: 'drive', probabilities: { drive: 0.55 } } }, { projects, goals });
    expect(weak.addTags).not.toContain('project:drive');
    expect(weak.edges).toEqual([]);
    const self = planPerceive({ ...subject, key: 'kb/proj_drive' }, answers, { projects, goals });
    expect(self.edges.find((e) => e.to === 'kb/proj_drive')).toBeUndefined();
    expect(self.addTags).toContain('project:drive');
  });

  it('types an untyped fact above θ, links serves above θ, and does not re-add existing tags', () => {
    const plan = planPerceive(
      { ...subject, type: null, tags: ['actionable', PERCEIVED_TAG] },
      { ...answers, type: { choice: 'knowledge', probabilities: { knowledge: 0.9 } }, 'serves:consolidation': { noul: 0.8 } },
      { projects, goals },
    );
    expect(plan.type).toBe('knowledge');
    expect(plan.edges).toContainEqual({ rel: 'serves', to: 'goal/consolidation', p: 0.8, q: 'serves' });
    expect(plan.addTags).not.toContain('actionable');
    expect(plan.addTags).not.toContain(PERCEIVED_TAG);
  });
});

describe('planRelate', () => {
  it('ratifies a confident rel, declines confident unrelated, holds the rest', () => {
    expect(planRelate({ probabilities: { elaborates: 0.9, unrelated: 0.02 } })).toEqual({ action: 'ratify', rel: 'elaborates', p: 0.9 });
    expect(planRelate({ probabilities: { unrelated: 0.92, relatesTo: 0.08 } })).toEqual({ action: 'decline', p: 0.92 });
    expect(planRelate({ probabilities: { unrelated: 0.6, relatesTo: 0.4 } }).action).toBe('hold');
  });
  it('treats split-but-clearly-related mass as relatesTo, never as contradicts/duplicates', () => {
    expect(planRelate({ probabilities: { elaborates: 0.5, relatesTo: 0.45, unrelated: 0.05 } })).toEqual({ action: 'ratify', rel: 'relatesTo', p: 0.95 });
    expect(planRelate({ probabilities: { contradicts: 0.55, relatesTo: 0.4, unrelated: 0.05 } }).action).toBe('hold');
  });
  it('holds on a missing answer', () => {
    expect(planRelate(undefined).action).toBe('hold');
  });
});

describe('calibrate (the learner)', () => {
  const mk = (q: LabelledAct['q'], n: number, p: number, ok: boolean): LabelledAct[] => Array.from({ length: n }, () => ({ q, p, ok }));

  it('keeps θ with too few labels', () => {
    const { thresholds } = calibrate(mk('relate', MIN_LABELS - 1, 0.9, true));
    expect(thresholds.relate).toBe(DEFAULT_THRESHOLDS.relate);
  });

  it('loosens toward a lower cut that still meets target precision, by ≤0.05 a cycle, above the floor', () => {
    const labels = [...mk('relate', 30, 0.62, true), ...mk('relate', 30, 0.9, true)];
    const { thresholds } = calibrate(labels);
    expect(thresholds.relate).toBeCloseTo(0.65, 5);
  });

  it('tightens when the target is unmet at every supported cut', () => {
    const labels = [...mk('project', 20, 0.75, false), ...mk('project', 20, 0.9, true)];
    const { thresholds, report } = calibrate(labels);
    // above 0.9: 20/20 ok → cut 0.9, step +0.05 from 0.7
    expect(thresholds.project).toBeCloseTo(0.75, 5);
    expect((report.project as { cut: number }).cut).toBe(0.9);
    const bad = calibrate(mk('project', 40, 0.9, false));
    expect(bad.thresholds.project).toBeCloseTo(0.75, 5);
    expect((bad.report.project as { why: string }).why).toMatch(/tightened/);
  });

  it('weights audit labels 3×', () => {
    const labels: LabelledAct[] = [...mk('serves', 8, 0.8, true).map((l) => ({ ...l, weight: 3 }))];
    expect(calibrate(labels).report.serves).toMatchObject({ n: 24 });
  });
});

describe('helpers', () => {
  it('slugs projects and bounds subject text', () => {
    expect(projectSlug('kb/proj_mental_models')).toBe('mental-models');
    expect(projectSlug('kb/27ffd0926f1b4a', { content: 'proj_parcland — parc.land (c15r/parcland …)' })).toBe('parcland');
    expect(projectSlug('kb/5beb39bb9e6d4b', { content: 'proj_blob_admin: c15r/blob_admin' })).toBe('blob-admin');
    expect(projectSlug('kb/proj_remarkable', { summary: 'GitHub repo' })).toBe('remarkable');
    expect(subjectText({ title: 'T', content: 'x'.repeat(3000) }).length).toBeLessThanOrEqual(1801);
    expect(subjectText('plain')).toBe('plain');
  });
});

describe('referencesEachOther', () => {
  const { referencesEachOther } = jest.requireActual('../cells/system1/index');
  it('holds an asset/capture pair where one names the other', () => {
    const asset = { key: 'visual/image/04b280ed-a69f-4aa1-8f07-a0b9418f1213', type: 'image', tags: [], value: { title: 'IMG_1617.jpeg' } };
    const cap = { key: 'inbox/2026-09-21/image-04b', type: 'capture', tags: [], value: { image: 'visual/image/04b280ed-a69f-4aa1-8f07-a0b9418f1213' } };
    expect(referencesEachOther(asset, cap)).toBe(true);
    expect(referencesEachOther(cap, { ...asset, key: 'kb/other' })).toBe(false);
  });
});

describe('judge rail (planDecision / yieldCriteria)', () => {
  const { planDecision, yieldCriteria } = jest.requireActual('../cells/system1/index');
  it('normalises string and object choices', () => {
    expect(yieldCriteria(['a', { to: 'b', when: 'if x' }, { name: 'c' }, 42])).toEqual({ a: null, b: 'if x', c: null });
  });
  it('advances only on an allowed branch at or above θ.decide, else escalates', () => {
    expect(planDecision({ probabilities: { yes: 0.9, no: 0.1 } }, ['yes', 'no'])).toMatchObject({ action: 'advance', to: 'yes', p: 0.9 });
    expect(planDecision({ probabilities: { yes: 0.6, no: 0.4 } }, ['yes', 'no'])).toMatchObject({ action: 'escalate', best: 'yes' });
    expect(planDecision({ probabilities: { rogue: 0.99 } }, ['yes', 'no'])).toMatchObject({ action: 'escalate', best: null });
  });
});

describe('continuation (self-chaining backfill)', () => {
  const { continuation } = jest.requireActual('../cells/system1/index');
  it('perceive continues the cursor and counts the chain down', () => {
    expect(continuation('perceive', { chain: 2, prefix: 'inbox/' }, { next: '40', errors: [] })).toEqual({ chain: 1, prefix: 'inbox/', cursor: '40' });
    expect(continuation('perceive', { chain: 0 }, { next: '40', errors: [] })).toBeNull();
    expect(continuation('perceive', { chain: 3 }, { errors: [] })).toBeNull();
  });
  it('sweep skips past what stays at the head of the queue', () => {
    const out = { errors: [], counts: { pairs: 60, live: 55, structural: 3, hold: 4, error: 1 } };
    // stay = hold 4 + structural 3 + error 1 + missing-fact pairs (60 − 55 − 3 = 2)
    expect(continuation('sweep_suggestions', { chain: 1, mode: 'act', offset: 10 }, out)).toMatchObject({ offset: 20, chain: 0 });
    expect(continuation('sweep_suggestions', { chain: 1, mode: 'shadow' }, out)).toMatchObject({ offset: 60 });
  });
  it('stops a chain whose batch is failing', () => {
    expect(continuation('perceive', { chain: 5 }, { next: '9', errors: new Array(11).fill('x') })).toBeNull();
  });
});

describe('embeddedMeta (lifting a malformed write)', () => {
  const { embeddedMeta } = jest.requireActual('../cells/system1/index');
  const s = { key: 'proposal/x', type: null, tags: ['s1:perceive-v1'], value: { type: 'proposal', tags: ['proposal', 'consolidation'], title: 't' } };
  it('lifts a declared type and its value-embedded tags', () => {
    expect(embeddedMeta(s, ['proposal', 'capture'])).toEqual({ type: 'proposal', tags: ['proposal', 'consolidation'] });
  });
  it('ignores undeclared types and already-typed facts', () => {
    expect(embeddedMeta(s, ['capture'])).toEqual({ tags: [] });
    expect(embeddedMeta({ ...s, type: 'capture' }, ['proposal'])).toEqual({ tags: [] });
  });
});

describe('relatable (plumbing is pruned, not judged)', () => {
  const { relatable } = jest.requireActual('../cells/system1/index');
  it('keeps content (incl. doc blocks) and drops storage/log/bookkeeping', () => {
    expect(relatable('doc-block:docs/architecture/12', 'doc-block')).toBe(true);
    expect(relatable('kb/x', 'knowledge')).toBe(true);
    expect(relatable('file/cells/input-ce2b7db7/data/images/x/original-000.b64', null)).toBe(false);
    expect(relatable('tending/triage/2026-09-01', null)).toBe(false);
    expect(relatable('inbox/x', 'decompose-status')).toBe(false);
  });
});

describe('isDecisionYield (the judge rail never skips work)', () => {
  const { isDecisionYield } = jest.requireActual('../cells/system1/index');
  it('judges agent/task yields only', () => {
    expect(isDecisionYield('agent')).toBe(true);
    expect(isDecisionYield('task')).toBe(true);
    expect(isDecisionYield('work')).toBe(false);
    expect(isDecisionYield('section')).toBe(false);
    expect(isDecisionYield(undefined)).toBe(false);
  });
});

describe('self-invoke hop cap (AWS recursive-loop detection)', () => {
  const { MAX_HOPS } = jest.requireActual('../cells/system1/index');
  it('stays well under the 16-hop limit', () => {
    expect(MAX_HOPS).toBeLessThan(16);
  });
});

describe('declared judgments (ADR-0098 addendum)', () => {
  const m = jest.requireActual('../cells/system1/index');
  const bug = { key: 'kb/some-bug', type: 'bug', tags: ['bug', 'priority:p1'], value: { content: 'x' } };
  const decls = m.parseJudgments({
    priority: { v: 1, type: 'score', criteria: ['p3', 'p2', 'p1', 'p0'], materialize: { tag: 'priority:{level}' } },
    'looks-resolved': { v: 2, type: 'noul', materialize: { tag: 's1:looks-resolved' } },
    'BAD NAME': { type: 'noul' },
    nope: { type: 'essay' },
  }, 'bug');

  it('parses a facet, dropping invalid names and types', () => {
    expect(decls.map((d: { name: string }) => d.name)).toEqual(['priority', 'looks-resolved']);
    expect(decls[1]).toMatchObject({ v: 2, owner: 'bug' });
  });

  it('selects the type\'s own judgments plus global ones that apply to it', () => {
    const global = m.parseJudgments({ 'applies-model': { type: 'choice', appliesToTypes: ['bug', 'decision'] }, other: { type: 'noul', appliesToTypes: ['capture'] } }, 'global');
    expect(m.judgmentsFor(bug, { bug: decls }, global).map((d: { name: string }) => d.name)).toEqual(['priority', 'looks-resolved', 'applies-model']);
  });

  it('always gives a choice a "none" option (the taxonomy growth signal)', () => {
    const q = m.judgmentQuestions(m.parseJudgments({ kind: { type: 'choice', options: ['a', 'b'] } }, 't'), {});
    expect(Object.keys(q['j:kind'].criteria)).toEqual(['a', 'b', 'none']);
  });

  it('human-authored tags win; markers are always written', () => {
    const jp = m.planJudgments(bug, {
      'j:priority': { probabilities: { '0': 0.02, '1': 0.03, '2': 0.05, '3': 0.9 }, score: 2.8 },
      'j:looks-resolved': { noul: 0.91 },
    }, decls, {}, {});
    expect(jp.addTags).not.toContain('priority:p0'); // priority:p1 was authored
    expect(jp.addTags).toEqual(expect.arrayContaining(['s1:looks-resolved', 's1:j:priority@1', 's1:j:looks-resolved@2']));
  });

  it('materializes a live-option choice as a (reversible) edge and records residue', () => {
    const d = m.parseJudgments({ 'applies-model': { type: 'choice', optionsFrom: { type: 'mental-model' }, materialize: { edge: { rel: 'appliesTo', reverse: true } } } }, 'global');
    const sets = { 'applies-model': { criteria: { scarcity: 'x', none: null }, keyOf: { scarcity: 'model/scarcity' } } };
    const hit = m.planJudgments(bug, { 'j:applies-model': { probabilities: { scarcity: 0.9, none: 0.1 } } }, d, sets, {});
    expect(hit.edges).toEqual([{ rel: 'appliesTo', to: 'model/scarcity', p: 0.9, q: 'j:applies-model', reverse: true }]);
    const miss = m.planJudgments(bug, { 'j:applies-model': { probabilities: { scarcity: 0.2, none: 0.8 } } }, d, sets, {});
    expect(miss.edges).toEqual([]);
    expect(miss.residue).toEqual([{ judgment: 'applies-model', top: 'none', p: 0.8 }]);
  });

  it('aggregates residue per judgment', () => {
    const agg = m.aggregateResidue([
      { judgment: 'project', top: 'none', p: 0.9, key: 'a' },
      { judgment: 'project', top: 'none', p: 0.8, key: 'b' },
      { judgment: 'type', top: 'note', p: 0.4, key: 'c' },
    ]);
    expect(Object.keys(agg)).toEqual(['project', 'type']);
    expect(agg.project).toMatchObject({ residue: 2, closest: [['none', 2]] });
  });

  it('calibrates a declared judgment it has never seen', () => {
    const labels = Array.from({ length: 30 }, () => ({ q: 'j:applies-model', p: 0.95, ok: true }));
    const { thresholds } = m.calibrate(labels);
    expect(thresholds['j:applies-model']).toBeGreaterThan(0.8);
  });
});
