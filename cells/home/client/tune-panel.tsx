/* ---------------------------------------------------------------------------
 * tune-panel.tsx — the graph tuner, native to the command palette.
 *
 * The same TUNE_SCHEMA the ?tune=1 lil-gui panel renders, drawn here as a
 * grouped sheet of live sliders in the paper/ink idiom — so the tuner is
 * DISCOVERABLE (search "tune" in the palette) instead of hidden behind a URL
 * flag. Each control dispatches TUNE_EVENT {key,value}; graph.tsx applies it to
 * the live scene and persists (localStorage + the `_config/home.graph.tune`
 * fact). No three.js import here — TUNE is a pure data module — so the panel
 * stays a light DOM overlay that drives the render closures across the window
 * bridge, keeping the live-drag feel a submit-style form can't.
 * ------------------------------------------------------------------------- */
import * as React from 'react';
import { TUNE, TUNE_DEFAULTS, TUNE_SCHEMA, TUNE_GROUPS, TUNE_EVENT, TUNE_RESET_EVENT, type TuneControl } from './graph/tune';
import { ink } from './ink';

const { useState } = React;

/** Trim a slider value to a short, readable readout (no trailing-zero noise). */
const fmt = (v: number): string => (Number.isInteger(v) ? String(v) : String(Math.round(v * 1000) / 1000));

function Row({ ctl, value, onChange }: { ctl: TuneControl; value: unknown; onChange: (v: unknown) => void }): React.JSX.Element {
  const name = ctl.label ?? ctl.key;
  if (ctl.options) {
    return (
      <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.28rem 0' }}>
        <span style={{ flex: 1, fontFamily: ink.mono, fontSize: '0.72rem', color: ink.dim }}>{name}</span>
        <select
          value={String(value)}
          onChange={(e) => onChange(e.target.value)}
          style={{ background: ink.bg, color: ink.text, border: `1px solid ${ink.line}`, borderRadius: 6, fontSize: '0.74rem', padding: '0.2rem 0.35rem', fontFamily: ink.mono }}
        >
          {ctl.options.map((o) => <option key={o} value={o}>{o}</option>)}
        </select>
      </label>
    );
  }
  const num = typeof value === 'number' ? value : Number(value) || 0;
  return (
    <div style={{ display: 'grid', gap: '0.15rem', padding: '0.28rem 0' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.5rem' }}>
        <span style={{ flex: 1, fontFamily: ink.mono, fontSize: '0.72rem', color: ink.dim, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{name}</span>
        <span style={{ fontFamily: ink.mono, fontSize: '0.72rem', color: ink.text, fontVariantNumeric: 'tabular-nums' }}>{fmt(num)}</span>
      </div>
      <input
        type="range"
        min={ctl.min}
        max={ctl.max}
        step={ctl.step ?? 0.01}
        value={num}
        onChange={(e) => onChange(Number(e.target.value))}
        style={{ width: '100%', accentColor: ink.accent }}
      />
    </div>
  );
}

/** The palette's tune sheet. Seeded from the LIVE TUNE object (so it opens on
 *  whatever's loaded, incl. the config fact), it writes changes straight back
 *  across the window bridge — the panel never owns truth, it drives it. */
export function TunePanel({ onClose }: { onClose: () => void }): React.JSX.Element {
  const [vals, setVals] = useState<Record<string, unknown>>(() => ({ ...TUNE }));
  const setKey = (key: string, value: unknown): void => {
    setVals((s) => ({ ...s, [key]: value }));
    window.dispatchEvent(new CustomEvent(TUNE_EVENT, { detail: { key, value } }));
  };
  const reset = (): void => {
    window.dispatchEvent(new CustomEvent(TUNE_RESET_EVENT));
    setVals({ ...TUNE_DEFAULTS });
  };
  const copy = (): void => { void navigator.clipboard?.writeText(JSON.stringify(TUNE, null, 2)); };

  const headerBtn: React.CSSProperties = {
    background: 'none', border: `1px solid ${ink.line}`, color: ink.dim, borderRadius: 999,
    fontFamily: ink.mono, fontSize: '0.68rem', padding: '0.15rem 0.5rem', cursor: 'pointer',
  };
  return (
    <div
      style={{
        position: 'fixed',
        top: 'max(8px, env(safe-area-inset-top))',
        right: 8,
        width: 'min(340px, calc(100vw - 16px))',
        maxHeight: 'calc(100dvh - 96px)',
        overflowY: 'auto',
        overscrollBehavior: 'contain',
        zIndex: 55,
        background: ink.bg,
        border: `1px solid ${ink.line}`,
        borderRadius: 12,
        boxShadow: '0 12px 40px rgba(0,0,0,0.5)',
        color: ink.text,
        padding: '0.6rem 0.7rem',
      }}
    >
      <header style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', paddingBottom: '0.5rem', borderBottom: `1px solid ${ink.line}` }}>
        <span style={{ flex: 1, fontFamily: ink.mono, fontSize: '0.78rem', color: ink.text }}>graph tune</span>
        <button style={headerBtn} onClick={copy}>copy</button>
        <button style={headerBtn} onClick={reset}>reset</button>
        <button style={{ ...headerBtn, border: 'none' }} onClick={onClose} aria-label="close tuner">×</button>
      </header>
      {TUNE_GROUPS.map((g, gi) => (
        <details key={g} open={gi === 0} style={{ borderBottom: `1px solid ${ink.line}`, padding: '0.35rem 0' }}>
          <summary style={{ cursor: 'pointer', fontFamily: ink.mono, fontSize: '0.74rem', color: ink.accent, listStyle: 'none', userSelect: 'none' }}>{g}</summary>
          <div style={{ paddingTop: '0.2rem' }}>
            {TUNE_SCHEMA.filter((c) => c.group === g).map((c) => (
              <Row key={c.key} ctl={c} value={vals[c.key]} onChange={(v) => setKey(c.key, v)} />
            ))}
          </div>
        </details>
      ))}
    </div>
  );
}
