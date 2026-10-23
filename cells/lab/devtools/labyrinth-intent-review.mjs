/** Offline blind review. No browser, renderer, network, or model dependency.
 * next -> edit expectation.json -> expect -> reveal -> edit critique.json -> critique -> next
 * The sealed directory is an accidental-leakage boundary, not a security boundary.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync, copyFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
export const digest = (x) => createHash('sha256').update(x).digest('hex');
export const readJSON = (p) => JSON.parse(readFileSync(p, 'utf8'));
export function writeJSON(p, value, exclusive = false) {
  writeFileSync(p, JSON.stringify(value, null, 2) + '\n', { flag: exclusive ? 'wx' : 'w' });
}
const assert = (ok, why) => { if (!ok) throw new Error(why); };
const text = (x) => typeof x === 'string' && x.trim().length > 0;
const strings = (xs) => Array.isArray(xs) && xs.every(text);
const safeId = (id) => typeof id === 'string' && /^[a-zA-Z0-9_-]+$/.test(id);
export function validateExpectation(e, id) {
  assert(e.id === id, 'Expectation id does not match the active gesture');
  assert(text(e.reviewer), 'Name the reviewer');
  assert(e.blind === true, 'Confirm blind=true only if no result has been inspected');
  assert(text(e.sceneReading), 'Describe the visible scene');
  assert(Array.isArray(e.hypotheses) && e.hypotheses.length > 0, 'Supply at least one plausible interpretation');
  const ids = new Set();
  for (const h of e.hypotheses) {
    assert(safeId(h.id) && !ids.has(h.id), 'Hypothesis ids must be unique and simple'); ids.add(h.id);
    assert(text(h.intent) && text(h.visibleEvidence), 'Each hypothesis needs an intention and visible evidence');
    assert(Number.isFinite(h.plausibility) && h.plausibility >= 0 && h.plausibility <= 1, 'Plausibility must be 0..1');
    assert(strings(h.successCriteria) && h.successCriteria.length > 0, 'Each hypothesis needs observable success criteria');
  }
  assert(ids.has(e.preferred), 'preferred must name a hypothesis');
  assert(strings(e.mustPreserve) && strings(e.unacceptable) && strings(e.ambiguities), 'Supply preservation, unacceptable and ambiguity arrays');
  assert(text(e.expectedFeedback), 'Describe expected feedback while drawing');
}
export function validateCritique(c, id, e) {
  assert(c.id === id && text(c.reviewer), 'Critique needs matching id and reviewer');
  assert(['fulfilled', 'acceptable-alternative', 'partial', 'misread', 'no-effect', 'unjudgeable'].includes(c.verdict), 'Choose a verdict');
  assert(c.matchedHypothesis === null || e.hypotheses.some(h => h.id === c.matchedHypothesis), 'Match a precommitted hypothesis, or null');
  assert(text(c.observed) && text(c.delta) && text(c.evidence), 'Describe observed result, delta and evidence');
  assert(Array.isArray(c.criteria) && c.criteria.length === e.hypotheses.reduce((n,h) => n + h.successCriteria.length, 0), 'Assess every precommitted success criterion');
  const covered = new Set();
  for (const r of c.criteria) {
    const h = e.hypotheses.find(h => h.id === r.hypothesis);
    const key = `${r.hypothesis}:${r.index}`;
    assert(h && Number.isInteger(r.index) && r.index >= 0 && r.index < h.successCriteria.length && !covered.has(key), 'Invalid or duplicate criterion');
    covered.add(key);
    assert(['met', 'missed', 'uncertain'].includes(r.result) && text(r.evidence), 'Each criterion needs a result and evidence');
  }
  assert(text(c.preservation) && text(c.feedback) && text(c.recovery) && text(c.nextExperiment), 'Assess preservation, feedback, recovery and next experiment (use unknown if unobserved)');
  assert(strings(c.possibleCauses), 'possibleCauses must be an array; these are hypotheses, not observations');
  // (the scene axes, where given: optional, so earlier reviews stay valid)
  if (c.scene && Object.values(c.scene).some((v) => v !== '' && v !== null)) {
    const s = c.scene, one = (v, xs, what) => assert(xs.includes(v), `scene.${what}: one of ${xs.join(', ')}`);
    one(s.locationHonoured, ['yes', 'partly', 'no', 'n/a'], 'locationHonoured');
    one(s.endpointsHonoured, ['yes', 'partly', 'no', 'n/a'], 'endpointsHonoured');
    assert(Number.isInteger(s.coherence) && s.coherence >= 0 && s.coherence <= 3, 'scene.coherence: 0..3');
    one(s.surprise, ['none', 'welcome', 'neutral', 'unwelcome'], 'surprise');
    one(s.handResponse, ['build-on', 'keep', 'look-for-alternative', 'undo-and-retry', 'unsure'], 'handResponse');
    assert(typeof s.disconnect === 'string', 'scene.disconnect: a short phrase, or empty if none');
  }
}
function manifest(root) {
  const m = readJSON(join(root, 'manifest.json'));
  assert(m.schema === 'labyrinth-intent/2' && m.complete, 'Capture is incomplete or has an unsupported schema');
  assert(m.ids.length > 0 && m.ids.every(safeId) && new Set(m.ids).size === m.ids.length, 'Invalid manifest ids');
  return m;
}
const imagePath = (dir, name) => {
  for (const ext of ['jpg', 'svg']) { const p = join(dir, `${name}.${ext}`); if (existsSync(p)) return p; }
  throw new Error(`Missing ${name} image in ${dir}`);
};
function packet(root, id) {
  const dir = join(root, 'sealed', id), raw = readFileSync(join(dir, 'before.json'));
  const img = readFileSync(imagePath(dir, 'before'));
  return { dir, before: JSON.parse(raw), hash: digest(Buffer.concat([raw, img])) };
}
/** an authored gesture (intent written before it was drawn) has one more stage, after the critique: the intent shown */
const authoredOf = (root, id) => join(root, 'sealed', id, 'authored.json');
const done = (root, id) => existsSync(join(root, 'reviews', id, 'critique.lock.json')) && (!existsSync(authoredOf(root, id)) || existsSync(join(root, 'reviews', id, 'authored.lock.json')));
function active(root, m) {
  return m.ids.find(id => !done(root, id));
}
export function validateJudgment(j, id, e) {
  assert(j.id === id && text(j.reviewer), 'Judgment needs matching id and reviewer');
  assert(['yes', 'partly', 'no'].includes(j.recovered), 'recovered: did your preferred reading express the authored intent (yes, partly, no)?');
  assert(j.recoveredBy === null || e.hypotheses.some(h => h.id === j.recoveredBy), 'recoveredBy: the hypothesis of yours that matches the authored intent, or null');
  assert(['fulfilled', 'acceptable-alternative', 'partial', 'misread', 'no-effect', 'unjudgeable'].includes(j.toyVerdict), 'toyVerdict: the result against the AUTHORED intent');
  assert(text(j.evidence) && typeof j.gap === 'string', 'Give evidence, and the gap in a phrase (empty if none)');
}
function locked(root, id) {
  const p = packet(root, id), dir = join(root, 'reviews', id);
  const e = readJSON(join(dir, 'expectation.lock.json'));
  validateExpectation(e.value, id);
  assert(e.packetHash === p.hash && e.valueHash === digest(JSON.stringify(e.value)), 'Expectation or before packet changed after commitment');
  return { p, dir, e };
}
export function review(root, command, file) {
  root = resolve(root);
  const m = manifest(root), id = active(root, m);
  if (command === 'status') return { total: m.ids.length, reviewed: m.ids.filter(x => done(root, x)).length, active: id ?? null };
  assert(['next', 'expect', 'reveal', 'critique', 'author', 'judge'].includes(command), 'Commands: next, expect, reveal, critique, author, judge, status');
  if (!id) return { complete: true, message: 'All gestures reviewed' };
  const dir = join(root, 'reviews', id);
  mkdirSync(dir, { recursive: true });
  const critiqued = existsSync(join(dir, 'critique.lock.json'));
  if (command === 'next' && critiqued) return { id, instruction: 'This gesture was drawn for an intent written beforehand: run author to see it, then judge' };
  if (command === 'next') {
    assert(!existsSync(join(dir, 'revealed.json')), 'Finish the current critique before requesting the next gesture');
    const p = packet(root, id);
    const beforeImage = imagePath(p.dir, 'before');
    const beforeName = beforeImage.endsWith('.svg') ? 'before.svg' : 'before.jpg';
    copyFileSync(beforeImage, join(dir, beforeName));
    writeJSON(join(dir, 'before.json'), p.before);
    if (!existsSync(join(dir, 'expectation.json'))) writeJSON(join(dir, 'expectation.json'), {
      id, reviewer: '', blind: false, sceneReading: '',
      hypotheses: [{ id: 'h1', intent: '', visibleEvidence: '', plausibility: 0.5, successCriteria: [''] }],
      preferred: 'h1', mustPreserve: [], unacceptable: [], ambiguities: [], expectedFeedback: '',
    });
    writeFileSync(join(dir, 'EXPECT.md'), `# ${id}: BEFORE ONLY\n\nInspect the before image and before.json. Do not open sealed/ or any after files.\nRecord what the hand could reasonably mean, independently of implementation rules.\nAllow multiple hypotheses and ambiguous or unjudgeable cases. Cite visible evidence.\nState observable criteria, what should remain unchanged, unacceptable surprises, and expected live feedback.\nDo not infer intent from a future result. Fill expectation.json, set blind=true only if accurate, then commit with expect.\n`);
    return { id, image: join(dir, beforeName), context: join(dir, 'before.json'), expectation: join(dir, 'expectation.json'), instruction: 'Read only these before files; fill expectation.json, then run expect' };
  }
  if (command === 'expect') {
    assert(!existsSync(join(dir, 'revealed.json')), 'Result already revealed; a blind expectation cannot be rewritten');
    assert(existsSync(join(dir, 'before.json')), 'Run next first');
    const value = readJSON(file ?? join(dir, 'expectation.json')); validateExpectation(value, id);
    const p = packet(root, id);
    writeJSON(join(dir, 'expectation.lock.json'), { committedAt: new Date().toISOString(), packetHash: p.hash, valueHash: digest(JSON.stringify(value)), value }, true);
    return { id, committed: true, instruction: 'Expectation is locked. Run reveal.' };
  }
  const { p, e } = locked(root, id);
  if (command === 'author' || command === 'judge') {
    assert(critiqued, 'Commit the critique against your own expectation first');
    const a = readJSON(authoredOf(root, id));
    if (command === 'author') {
      writeJSON(join(dir, 'authored.json'), a);
      if (!existsSync(join(dir, 'judgment.json'))) writeJSON(join(dir, 'judgment.json'), { id, reviewer: '', recovered: '', recoveredBy: null, toyVerdict: '', evidence: '', gap: '' });
      writeFileSync(join(dir, 'AUTHORED.md'), '# What the gesture was drawn for\n\nThis intent was written down before the gesture was drawn. Your expectation and critique are locked; do not revise them. Two separate questions:\n\n- recovered (yes, partly, no) and recoveredBy: did your PREFERRED reading express this intent? Which of your hypotheses (if any) matches it?\n- toyVerdict: judged against THIS intent, not yours, what did the toy make of it (fulfilled, acceptable-alternative, partial, misread, no-effect, unjudgeable)?\n\nevidence: from the before/after images and the visible text. gap: the difference in a phrase, empty if none. Fill judgment.json and run judge.\n');
      return { id, authored: join(dir, 'authored.json'), judgment: join(dir, 'judgment.json'), instruction: 'Fill judgment.json, then run judge' };
    }
    const value = readJSON(file ?? join(dir, 'judgment.json')); validateJudgment(value, id, e.value);
    writeJSON(join(dir, 'authored.lock.json'), { committedAt: new Date().toISOString(), value }, true);
    return { id, committed: true, instruction: 'Run next for the next blind gesture' };
  }
  if (command === 'reveal') {
    const resultRaw = readFileSync(join(p.dir, 'result.json')), after = readFileSync(imagePath(p.dir, 'after'));
    const resultHash = digest(Buffer.concat([resultRaw, after]));
    const receipt = join(dir, 'revealed.json');
    if (existsSync(receipt)) assert(readJSON(receipt).resultHash === resultHash, 'Result changed since reveal');
    else writeJSON(receipt, { revealedAt: new Date().toISOString(), expectationHash: e.valueHash, resultHash }, true);
    const afterImage = imagePath(p.dir, 'after');
    const afterName = afterImage.endsWith('.svg') ? 'after.svg' : 'after.jpg';
    copyFileSync(afterImage, join(dir, afterName));
    copyFileSync(join(p.dir, 'result.json'), join(dir, 'result.json'));
    if (!existsSync(join(dir, 'critique.json'))) writeJSON(join(dir, 'critique.json'), {
      id, reviewer: '', verdict: '', matchedHypothesis: null, observed: '', delta: '', evidence: '',
      criteria: e.value.hypotheses.flatMap(h => h.successCriteria.map((criterion, index) => ({ hypothesis: h.id, index, criterion, result: 'uncertain', evidence: '' }))),
      preservation: '', feedback: '', recovery: '', possibleCauses: [], nextExperiment: '',
      // (for comparing across gestures and rounds, judged from the scene, not the implementation)
      scene: { locationHonoured: '', endpointsHonoured: '', coherence: null, surprise: '', handResponse: '', disconnect: '' },
    });
    writeFileSync(join(dir, 'CRITIQUE.md'), '# Compare against the locked expectation\n\nRead expectation.lock.json BEFORE the after image and result.json. Score the original criteria; do not retrofit them. Distinguish observed geometry, implementation diagnostics and speculative causes. Operation appended is not intent fulfilled; reached is not proof of visual agreement. Say unknown for feedback/recovery not observed. Record surprising but acceptable results as alternatives. Judge from the after image first; the diagnostics only after.\n\nscene: locationHonoured / endpointsHonoured (yes, partly, no, n/a): did it act where the hand touched, and join what the stroke joined? coherence 0..3: does the result read as one sensible piece of construction in this landscape (0 nonsense, 3 inevitable)? surprise: none, welcome, neutral or unwelcome. handResponse: what would this hand most likely do next (build-on, keep, look-for-alternative, undo-and-retry, unsure)? disconnect: in a short phrase, the gap between what was meant and what happened, in your own words (empty if none).\n\nFill critique.json and run critique.\n');
    return { id, expectation: join(dir, 'expectation.lock.json'), image: join(dir, afterName), diagnostics: join(dir, 'result.json'), critique: join(dir, 'critique.json') };
  }
  assert(existsSync(join(dir, 'revealed.json')), 'Reveal the result before critiquing it');
  const value = readJSON(file ?? join(dir, 'critique.json')); validateCritique(value, id, e.value);
  const receipt = readJSON(join(dir, 'revealed.json'));
  assert(receipt.expectationHash === e.valueHash, 'Reveal receipt does not match expectation');
  assert(receipt.resultHash === digest(Buffer.concat([readFileSync(join(p.dir, 'result.json')), readFileSync(imagePath(p.dir, 'after'))])), 'Result changed after reveal');
  writeJSON(join(dir, 'critique.lock.json'), { committedAt: new Date().toISOString(), expectationHash: e.valueHash, resultHash: receipt.resultHash, value }, true);
  return { id, committed: true, instruction: existsSync(authoredOf(root, id)) ? 'Run author: this gesture was drawn for an intent written beforehand' : 'Run next for the next blind gesture' };
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [command, root, file] = process.argv.slice(2);
  try { assert(root, 'Usage: node labyrinth-intent-review.mjs <next|expect|reveal|critique|author|judge|status> OUT [input.json]'); console.log(JSON.stringify(review(root, command, file), null, 2)); }
  catch (e) { console.error(e.message); process.exitCode = 1; }
}
