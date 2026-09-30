import * as React from 'react';
import { useApi, Panel, Bar, Stat, pct, f3 } from '../ui';
import type { Scoring } from '../lib/types';

/** Jev's qualitative critique: 16 dimensions on ordered five-level scales, plus the
 *  weakness, strength and kind of change it names most. One run, or a train-split mean. */
export function CritiquePanel({ c, title, sub }: { c: { index: number | null; dims: Record<string, number | null>; weakest: Array<[string, number]>; strongest: Array<[string, number]>; fixes: Array<[string, number]>; n?: number }; title: string; sub: string }) {
  const { data: scoring } = useApi<Scoring>('scoring');
  const dims = scoring?.critique ?? Object.keys(c.dims).map((key) => ({ key, name: key, ask: '', levels: [] as string[] }));
  const Named = ({ label, items }: { label: string; items: Array<[string, number]> }) => (
    <div>
      <h3>{label}</h3>
      {items.length ? items.map(([k, v]) => <Bar key={k} label={k} value={v} text={pct(v)} />) : <p className="muted small">—</p>}
    </div>
  );
  return (
    <Panel title={title} sub={sub}>
      <div className="stats">
        <Stat v={f3(c.index)} l="critique index (0–1)" title="mean of the dimensions / 4 — 20% of score/v2" />
        {c.n ? <Stat v={c.n} l="games judged" /> : null}
      </div>
      <div className="grid two">
        <div>
          {dims.map((d) => {
            const v = c.dims[d.key];
            if (v === null || v === undefined) return null;
            return (
              <div key={d.key} title={d.ask}>
                <Bar label={d.name} value={v} max={4} text={d.levels[Math.round(v)] ?? f3(v)} />
              </div>
            );
          })}
          <p className="small muted">Each bar: where Jev puts the game on a five-step scale, worst → best (label = nearest step). Hover a row for the exact question.</p>
        </div>
        <div>
          <Named label="Biggest weakness" items={c.weakest} />
          <Named label="Greatest strength" items={c.strongest} />
          <Named label="Change that would most improve it" items={c.fixes} />
        </div>
      </div>
    </Panel>
  );
}
