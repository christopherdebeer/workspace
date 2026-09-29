// @c15r/run.exec body (analyze.js prepended): read judged shards back and
// analyse the merged matrix. input: { pool, shards: string[], emitKey }
const { pool, shards, emitKey = '_stems/v0/report' } = input;
const rows = [], meta = [];
for (const key of shards) {
  const f = await parc.read(key);
  const v = f?.value ?? f;
  for (const r of v.rows) {
    const row = {};
    v.qids.forEach((id, i) => { row[id] = r.d[i]; });
    rows.push(row);
    meta.push({ key: r.key, type: r.type });
  }
}
const report = analyze(pool, rows, { maxK: 24, minGain: 0.08, topPairs: 30 });
const fk = pool.questions.form_kind.options;
const byType = {};
rows.forEach((r, i) => {
  const d = r.form_kind; if (!d) return;
  const top = fk[d.indexOf(Math.max(...d))];
  (byType[meta[i].type] ??= {})[top] = (byType[meta[i].type][top] || 0) + 1;
});
const types = {};
meta.forEach((m) => { types[m.type] = (types[m.type] || 0) + 1; });
const summary = { pool: pool.version, items: rows.length, types, shards, byType, ...report };
await parc.emit(emitKey, summary, { type: 'stems-report', tags: ['stems'] });
return summary;
