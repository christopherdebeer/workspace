// @c15r/run.exec body (analyze.js is prepended at send time). input:
//   { pool, caps: {type: n}, batch, concurrency, pilot?, emitPrefix }
// Samples content-bearing facts per type, asks every pool question of every
// item via @c15r/jev.decide_many, stores the compact answer matrix under
// `_stems/…` (underscore keys: unindexed, no perception), returns the analysis.
const { pool, caps, batch = 100, concurrency = 20, pilot = false, judgeOnly = false, emitPrefix = '_stems/v0' } = input;

const FIELDS = ['title', 'name', 'question', 'statement', 'claim', 'summary', 'content', 'text', 'body', 'detail', 'description', 'note'];
function textOf(v) {
  if (typeof v === 'string') return v;
  if (!v || typeof v !== 'object') return '';
  const parts = FIELDS.map((f) => (typeof v[f] === 'string' ? v[f] : '')).filter(Boolean);
  if (parts.length) return parts.join('\n');
  const clean = Object.fromEntries(Object.entries(v).filter(([k]) => !k.startsWith('_')));
  return JSON.stringify(clean);
}

const questions = {};
for (const [id, q] of Object.entries(pool.questions)) {
  if (q.type === 'noul') questions[id] = { type: 'noul', instructions: q.instructions };
  else if (q.type === 'choice') questions[id] = { type: 'choice', instructions: q.instructions, criteria: Object.fromEntries(q.options.map((o) => [o, null])) };
  else questions[id] = { type: 'score', instructions: q.instructions, criteria: q.criteria };
}

function toDist(q, a) {
  if (!a) return null;
  if (q.type === 'noul') return [+(1 - a.noul).toFixed(3), +a.noul.toFixed(3)];
  const p = a.probabilities || {};
  const labels = q.type === 'choice' ? q.options : q.criteria;
  return labels.map((l, k) => +((q.type === 'choice' ? p[l] : p[String(k)]) ?? 0).toFixed(3));
}

// 1. corpus
const items = [];
const corpus = {};
for (const [type, cap] of Object.entries(caps)) {
  // `whole`: server-side the 60KB read budget would otherwise turn a page of
  // long facts into an {error} with no entries — silently shrinking the corpus.
  const r = await parc.call('workspace.query', { type, limit: cap, rankBy: 'recency', whole: true });
  if (r.error || !r.entries) console.log('query', type, r.error ?? 'no entries');
  corpus[type] = (r.entries || []).length;
  for (const e of r.entries || []) {
    const t = textOf(e.value).replace(/\s+/g, ' ').trim();
    if (t.length < 15) continue;
    items.push({ key: e.key, type, state: t.slice(0, 1200) });
  }
}
if (pilot) items.splice(1);

// 2. judge
const rows = [];
const meta = [];
let tokens = 0, errors = 0;
for (let i = 0; i < items.length; i += batch) {
  const slice = items.slice(i, i + batch);
  const res = await parc.call('@c15r/jev.decide_many', {
    questions, concurrency,
    items: slice.map((it, j) => ({ id: i + j, state: it.state })),
  });
  tokens += res.usage?.input_tokens ?? 0;
  for (const r of res.results || []) {
    if (r.error) { errors++; if (errors < 4) console.log('err', r.id, r.error); continue; }
    const row = {};
    for (const [id, q] of Object.entries(pool.questions)) row[id] = toDist(q, r.answers?.[id]);
    rows.push(row);
    meta.push({ key: items[r.id].key, type: items[r.id].type, chars: items[r.id].state.length });
  }
}

if (pilot) return { tokens, errors, items: items.length, stateChars: items[0]?.state.length, row: rows[0] };

// 3. persist the matrix compactly (question order = pool order), 40 items/shard
const qids = Object.keys(pool.questions);
const shards = [];
for (let s = 0; s * 40 < rows.length; s++) {
  const part = rows.slice(s * 40, s * 40 + 40).map((r, j) => ({ ...meta[s * 40 + j], d: qids.map((id) => r[id]) }));
  const key = `${emitPrefix}/matrix/${String(s).padStart(2, '0')}`;
  await parc.emit(key, { pool: pool.version, qids, rows: part }, { type: 'stems-matrix', tags: ['stems'] });
  shards.push(key);
}

if (judgeOnly) return { corpus, items: rows.length, errors, tokens, shards };

// 4. analyse
const report = analyze(pool, rows, { maxK: 24, minGain: 0.08, topPairs: 30 });
// form_kind × fact type sanity table (argmax counts)
const fk = pool.questions.form_kind.options;
const byType = {};
rows.forEach((r, i) => {
  const d = r.form_kind; if (!d) return;
  const top = fk[d.indexOf(Math.max(...d))];
  const t = meta[i].type;
  (byType[t] ??= {})[top] = (byType[t][top] || 0) + 1;
});
const summary = { pool: pool.version, corpus, items: rows.length, errors, tokens, usd: +(tokens * 0.042e-6).toFixed(4), shards, byType, ...report };
await parc.emit(`${emitPrefix}/report`, summary, { type: 'stems-report', tags: ['stems'] });
return summary;
