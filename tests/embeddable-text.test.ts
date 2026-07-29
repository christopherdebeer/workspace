/**
 * What a fact is INDEXED AS (ADR-0094 Inc 2).
 *
 * The bug this closes, measured live: `embeddableText` collected known fields
 * and fell back to the whole JSON *only if it found none* — so a fact carrying
 * exactly one known field had everything else silently dropped. All 98
 * `mental-model` facts are `{name, gloss, category, source}`; `name` was the
 * only listed field, so each was indexed as its two-word name — "Second-Order
 * Thinking" — and its gloss was never in the vector index at all. The
 * latticework clustered with itself and reached nothing, so ADR-0045's "the
 * lens shows up beside the work" could not fire. `task`/`goal` lost `detail`,
 * `machine` lost `context`, `log` lost everything but its title.
 *
 * The second half is the trigger: `applies`/`when` lead the field order, because
 * a field whose job is to say WHEN a fact is relevant is a different and better
 * retrieval signal than what the fact is ABOUT.
 */
import { embeddableText } from '../platform/runtime';

describe('embeddableText — one known field must not silence the rest', () => {
  it('indexes a mental model by its GLOSS, not just its name (the live bug)', () => {
    const model = {
      name: 'Second-Order Thinking',
      source: 'reading/farnam-street-mental-models',
      id: 'model/second-order-thinking',
      gloss: "ask \"and then what?\" of a decision's consequences",
      category: 'general-thinking-tools',
    };
    const text = embeddableText('model/second-order-thinking', model)!;
    expect(text).toContain('Second-Order Thinking');
    expect(text).toContain('and then what?'); // was absent from the index entirely
  });

  it('indexes a task by its detail, not just its title', () => {
    const task = {
      id: 'x',
      goal: 'consolidation',
      title: 'Prevent lit decompose cursor edges from dangling',
      detail: 'Cursor facts are superseded without a successor while their outgoing similarTo edges remain.',
      status: 'todo',
    };
    const text = embeddableText('task/consolidation/x', task)!;
    expect(text).toContain('superseded without a successor');
  });

  it('leads with applicability when a fact declares it', () => {
    const model = {
      name: "Hanlon's Razor",
      gloss: "don't attribute to malice what is adequately explained by incompetence",
      applies: 'you are reading bad intent into behaviour that plain incompetence would explain',
    };
    const text = embeddableText('model/hanlon-s-razor', model)!;
    // The trigger is FIRST — it is the signal a situational query matches on.
    expect(text.indexOf('reading bad intent')).toBeLessThan(text.indexOf("Hanlon's Razor"));
    expect(text.indexOf("Hanlon's Razor")).toBeLessThan(text.indexOf('attribute to malice'));
  });

  it('sweeps prose but never identifiers, hashes or paths', () => {
    const file = {
      path: 'docs/x.md',
      sha: 'b8de1247a375626a6951812438960f390d0d3f31a681afe2e234735df911b25e',
      s3Key: 'corpus/docs/x.md',
      url: 'https://example.com/a/very/long/looking/url/that/has/no/spaces',
      contentType: 'text/markdown',
      note: 'A hand-written note about why this file matters to the corpus.',
    };
    const text = embeddableText('file/docs/x.md', file)!;
    expect(text).toContain('hand-written note');
    expect(text).not.toContain('b8de1247');
    expect(text).not.toContain('corpus/docs/x.md');
    expect(text).not.toContain('example.com');
    // Short non-prose values are not swept either.
    expect(text).not.toContain('text/markdown');
  });

  it('keeps the JSON fallback for a fact with no textual field at all', () => {
    const text = embeddableText('run-job/1', { at: 1, lang: 'js', codeBytes: 40 })!;
    expect(text).toContain('codeBytes');
  });

  it('still refuses plumbing keys, and still excepts capabilities (ADR-0052)', () => {
    expect(embeddableText('_presence/probe/a', { participant: 'probe/a' })).toBeNull();
    const cap = embeddableText('_caps/@c15r/tasks.next', {
      name: '@c15r/tasks.next',
      summary: 'Actionable work: doing tasks plus todo tasks whose dependencies are all done.',
    })!;
    expect(cap).toContain('Actionable work');
  });

  it('stays bounded', () => {
    const huge = { content: 'x'.repeat(20000), note: 'y'.repeat(20000) };
    expect(embeddableText('doc:big', huge)!.length).toBeLessThanOrEqual(8000);
  });
});
