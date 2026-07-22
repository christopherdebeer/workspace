/* ---------------------------------------------------------------------------
 * tune-panel.tsx — the graph tuner, native to the command palette.
 *
 * Rendered as the `graph tune` command's working view INSIDE the console sheet
 * (above the output tape) — no submit, no "changes substrate state" warning
 * (nothing is written on open; each dial applies live). A SECTION enum at the
 * head — `quick` (the curated high-impact subset) plus every schema group —
 * swaps which knobs show, in place. Each control dispatches TUNE_EVENT
 * {key,value}; graph.tsx applies it to the live scene and persists (localStorage
 * + the `_config/home.graph.tune` fact). No three.js import here — TUNE is a
 * pure data module — so the panel stays a light DOM control driving the render
 * closures across the window bridge, keeping the live-drag feel a submit-style
 * form can't.
 * ------------------------------------------------------------------------- */
import * as React from 'react';
import { TUNE, TUNE_DEFAULTS, TUNE_SCHEMA, TUNE_GROUPS, TUNE_EVENT, TUNE_RESET_EVENT, type TuneControl } from './graph/tune';
import { ink } from './ink';

const { useState } = React;

const QUICK = 'quick';

/** Trim a slider value to a short, readable readout (no trailing-zero noise). */
const fmt = (v: number): string => (Number.isInteger(v) ? String(v) : String(Math.round(v * 1000) / 1000));

/** One knob on ONE line: name · slider · value (or a select for enums) — the
 *  compact form that keeps a section legible without dominating the sheet. */
function Row({ ctl, value, onChange }: { ctl: TuneControl; value: unknown; onChange: (v: unknown) => void }): React.JSX.Element {
  const name = ctl.label ?? ctl.key;
  const nameStyle: React.CSSProperties = { width: 96, flexShrink: 0, fontFamily: ink.mono, fontSize: '0.72rem', color: ink.dim, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' };
  if (ctl.options) {
    return (
      <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.2rem 0' }}>
        <span style={nameStyle}>{name}</span>
        <select
          value={String(value)}
          onChange={(e) => onChange(e.target.value)}
          style={{ marginLeft: 'auto', background: ink.bg, color: ink.text, border: `1px solid ${ink.line}`, borderRadius: 6, fontSize: '0.74rem', padding: '0.15rem 0.35rem', fontFamily: ink.mono }}
        >
          {ctl.options.map((o) => <option key={o} value={o}>{o}</option>)}
        </select>
      </label>
    );
  }
  const num = typeof value === 'number' ? value : Number(value) || 0;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.2rem 0' }}>
      <span style={nameStyle}>{name}</span>
      <input
        type="range"
        min={ctl.min}
        max={ctl.max}
        step={ctl.step ?? 0.01}
        value={num}
        onChange={(e) => onChange(Number(e.target.value))}
        style={{ flex: 1, minWidth: 0, accentColor: ink.accent }}
      />
      <span style={{ width: 42, flexShrink: 0, textAlign: 'right', fontFamily: ink.mono, fontSize: '0.72rem', color: ink.text, fontVariantNumeric: 'tabular-nums' }}>{fmt(num)}</span>
    </div>
  );
}

/** The tuner's working view. Seeded from the LIVE TUNE object (so it opens on
 *  whatever's loaded, incl. the config fact), it writes changes straight back
 *  across the window bridge — it never owns truth, it drives it. The section
 *  enum picks which knobs show and replaces them in place. */
export function TunePanel({ onClose }: { onClose: () => void }): React.JSX.Element {
  const [vals, setVals] = useState<Record<string, unknown>>(() => ({ ...TUNE }));
  const [section, setSection] = useState<string>(QUICK);
  const setKey = (key: string, value: unknown): void => {
    setVals((s) => ({ ...s, [key]: value }));
    window.dispatchEvent(new CustomEvent(TUNE_EVENT, { detail: { key, value } }));
  };
  const reset = (): void => {
    window.dispatchEvent(new CustomEvent(TUNE_RESET_EVENT));
    setVals({ ...TUNE_DEFAULTS });
  };
  const copy = (): void => { void navigator.clipboard?.writeText(JSON.stringify(TUNE, null, 2)); };

  const btn: React.CSSProperties = {
    background: 'none', border: `1px solid ${ink.line}`, color: ink.dim, borderRadius: 999,
    fontFamily: ink.mono, fontSize: '0.66rem', padding: '0.12rem 0.5rem', cursor: 'pointer', flexShrink: 0,
  };
  const rows = section === QUICK ? TUNE_SCHEMA.filter((c) => c.quick) : TUNE_SCHEMA.filter((c) => c.group === section);
  return (
    <div style={{ display: 'grid', gap: '0.1rem', border: `1px solid ${ink.line}`, borderRadius: 8, padding: '0.4rem 0.6rem 0.55rem', background: ink.bg }}>
      <header style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', paddingBottom: '0.3rem' }}>
        <select
          value={section}
          onChange={(e) => setSection(e.target.value)}
          aria-label="tune section"
          style={{ background: ink.bg, color: ink.accent, border: `1px solid ${ink.line}`, borderRadius: 6, fontSize: '0.74rem', padding: '0.18rem 0.4rem', fontFamily: ink.mono }}
        >
          <option value={QUICK}>quick</option>
          {TUNE_GROUPS.map((g) => <option key={g} value={g}>{g}</option>)}
        </select>
        <button style={{ ...btn, marginLeft: 'auto' }} onClick={copy}>copy</button>
        <button style={btn} onClick={reset}>reset</button>
        <button style={{ ...btn, border: 'none' }} onClick={onClose} aria-label="close tuner">×</button>
      </header>
      {rows.map((c) => <Row key={c.key} ctl={c} value={vals[c.key]} onChange={(v) => setKey(c.key, v)} />)}
    </div>
  );
}
