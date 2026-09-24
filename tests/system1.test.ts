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
    expect(plan.edges).toEqual([{ rel: 'belongsTo', to: 'kb/proj_drive', p: 0.78 }]);
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
    expect(plan.edges).toContainEqual({ rel: 'serves', to: 'goal/consolidation', p: 0.8 });
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
