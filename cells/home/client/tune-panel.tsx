/* ---------------------------------------------------------------------------
 * tune-panel.tsx — the graph tuner, INLINE in the command palette.
 *
 * The same TUNE_SCHEMA the ?tune=1 lil-gui panel renders, but drawn as a slim
 * strip INSIDE the palette (not a floating overlay that eats the viewport): a
 * curated `quick` subset — the few high-impact feel dials — shown by default,
 * with the full grouped set one "more" tap away. Each control dispatches
 * TUNE_EVENT {key,value}; graph.tsx applies it to the live scene and persists
 * (localStorage + the `_config/home.graph.tune` fact). No three.js import here —
 * TUNE is a pure data module — so the panel stays a light DOM control that
 * drives the render closures across the window bridge, keeping the live-drag
 * feel a submit-style form can't.
 * ------------------------------------------------------------------------- */
import * as React from 'react';
import { TUNE, TUNE_DEFAULTS, TUNE_SCHEMA, TUNE_GROUPS, TUNE_EVENT, TUNE_RESET_EVENT, type TuneControl } from './graph/tune';
import { ink } from './ink';

const { useState } = React;

/** Trim a slider value to a short, readable readout (no trailing-zero noise). */
const fmt = (v: number): string => (Number.isInteger(v) ? String(v) : String(Math.round(v * 1000) / 1000));

/** One knob on ONE line: name · slider · value (or a select for enums) — the
 *  compact form that lets a handful sit inline without dominating the palette. */
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

/** The palette's inline tune strip. Seeded from the LIVE TUNE object (so it
 *  opens on whatever's loaded, incl. the config fact), it writes changes straight
 *  back across the window bridge — the strip never owns truth, it drives it. */
export function TunePanel({ onClose }: { onClose: () => void }): React.JSX.Element {
  const [vals, setVals] = useState<Record<string, unknown>>(() => ({ ...TUNE }));
  const [showAll, setShowAll] = useState(false);
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
  const quick = TUNE_SCHEMA.filter((c) => c.quick);
  return (
    <div
      style={{
        display: 'grid',
        gap: '0.1rem',
        padding: '0.4rem 0.7rem 0.5rem',
        borderBottom: `1px solid ${ink.line}`,
        maxHeight: showAll ? 'min(44dvh, 360px)' : 'none',
        overflowY: showAll ? 'auto' : 'visible',
        overscrollBehavior: 'contain',
      }}
    >
      <header style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', paddingBottom: '0.25rem' }}>
        <span style={{ fontFamily: ink.mono, fontSize: '0.72rem', color: ink.text }}>tune</span>
        <button style={{ ...btn, color: ink.accent, borderColor: ink.accent, marginLeft: 'auto' }} onClick={() => setShowAll((v) => !v)}>
          {showAll ? 'less ▴' : 'more ▾'}
        </button>
        <button style={btn} onClick={copy}>copy</button>
        <button style={btn} onClick={reset}>reset</button>
        <button style={{ ...btn, border: 'none' }} onClick={onClose} aria-label="close tuner">×</button>
      </header>
      {!showAll
        ? quick.map((c) => <Row key={c.key} ctl={c} value={vals[c.key]} onChange={(v) => setKey(c.key, v)} />)
        : TUNE_GROUPS.map((g) => (
            <div key={g} style={{ paddingTop: '0.25rem' }}>
              <div style={{ fontFamily: ink.mono, fontSize: '0.7rem', color: ink.accent, padding: '0.1rem 0' }}>{g}</div>
              {TUNE_SCHEMA.filter((c) => c.group === g).map((c) => (
                <Row key={c.key} ctl={c} value={vals[c.key]} onChange={(v) => setKey(c.key, v)} />
              ))}
            </div>
          ))}
    </div>
  );
}
