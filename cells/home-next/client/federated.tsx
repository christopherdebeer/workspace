/**
 * ADR-0044 Inc 5: the federated render/form sandbox frames (ADR-0039/0041),
 * split from app.tsx (moved verbatim).
 */
import * as React from 'react';
import { mountSandboxedRenderer, attachSandboxedRenderer, SANDBOX_HOST_HTML } from './federated-host';
import { mcpCall, mcpResourceRead } from './lib';

const { useState, useEffect } = React;

function rejectedCall(reason = 'renderer substrate call rejected by home policy'): Promise<never> {
  return Promise.reject(new Error(reason));
}

function safeRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

/**
 * A renderer gets only the exact reads its published implementation needs.
 * Acts are never proxied, and an unknown renderer gets no substrate channel.
 */
function rendererCall(uri: string, factKey: string | undefined) {
  return (kind: 'read' | 'act', target: string, input: unknown): Promise<unknown> => {
    if (kind !== 'read') return rejectedCall();
    const args = safeRecord(input);
    if (uri.startsWith('ui://@c15r/canvas/') && target === '@c15r/canvas.scene') {
      const view = args?.view;
      if (typeof view !== 'string' || view.length === 0 || view.length > 256) return rejectedCall('invalid canvas view');
      return mcpCall('read', target, { view }).then((r) => r.ok ? r.value : rejectedCall(String(r.value)));
    }
    if (uri.startsWith('ui://@c15r/machine/') && target === 'workspace.query' && factKey) {
      const prefix = args?.prefix;
      const allowed = ['claim', 'node', 'rail'].some((part) => prefix === `${factKey}/${part}/`);
      if (!allowed) return rejectedCall('machine query outside fact namespace');
      const requestedLimit = typeof args?.limit === 'number' && Number.isFinite(args.limit) ? args.limit : 50;
      const limit = Math.max(1, Math.min(300, Math.floor(requestedLimit)));
      return mcpCall('read', target, { prefix, limit }).then((r) => r.ok ? r.value : rejectedCall(String(r.value)));
    }
    return rejectedCall();
  };
}

const denyFormCalls = (): Promise<never> => rejectedCall('federated forms have no substrate channel');

/**
 * Run a cell-authored `ui://` renderer for a fact or tool result, isolated in a
 * sandboxed iframe (ADR-0041) — never injected into home's own document, since
 * the renderer may be authored by another tenant's cell. `placeholder` shows
 * until the sandbox confirms a successful render; on any failure (offline, CSP,
 * cell down, no renderer registered) it stays up — the same graceful-degrade
 * contract the conversation card uses (ADR-0039).
 */
export function FederatedRendererFrame({
  uri,
  type,
  value,
  factKey,
  placeholder,
}: {
  uri: string;
  type: string;
  value: unknown;
  factKey?: string;
  placeholder?: React.ReactNode;
}): React.JSX.Element {
  const iframeRef = React.useRef<HTMLIFrameElement | null>(null);
  const [height, setHeight] = useState(0);
  const [settled, setSettled] = useState<boolean | null>(null);

  useEffect(() => {
    const iframe = iframeRef.current;
    if (!iframe) return;
    setHeight(0);
    setSettled(null);
    return attachSandboxedRenderer(iframe, {
      call: rendererCall(uri, factKey),
      fetchSource: mcpResourceRead,
      uri,
      type,
      value,
      key: factKey,
      onResize: setHeight,
      onSettled: setSettled,
    });
  }, [uri, type, value, factKey]);

  return (
    <div style={{ position: 'relative' }}>
      {settled !== true ? placeholder ?? null : null}
      <iframe
        ref={iframeRef}
        sandbox="allow-scripts"
        referrerPolicy="no-referrer"
        title="federated renderer"
        style={{ display: settled === true ? 'block' : 'none', width: '100%', border: 'none', height: Math.max(24, height) }}
      />
    </div>
  );
}

/**
 * Run a cell-authored argument FORM (ADR-0041 Inc 3) — the input twin of
 * `FederatedRendererFrame`, same sandbox. Mounted ONCE with the schema +
 * starting value (not on every keystroke — re-mounting on every parent
 * re-render would rebuild the sandboxed form's DOM and drop focus/cursor
 * mid-edit); from then on the sandbox owns its own field state and reports
 * edits up via `onChange`. `placeholder` (the schema-form floor, ADR-0041
 * Inc 2) shows until the federated form confirms it mounted, and stays up
 * forever if it never does — the same graceful degrade as output renderers.
 */
export function FederatedFormFrame({
  uri,
  type,
  schema,
  initialValue,
  onChange,
  placeholder,
}: {
  uri: string;
  type: string;
  schema: unknown;
  initialValue: Record<string, unknown>;
  onChange: (v: Record<string, unknown>) => void;
  placeholder?: React.ReactNode;
}): React.JSX.Element {
  const iframeRef = React.useRef<HTMLIFrameElement | null>(null);
  const [height, setHeight] = useState(0);
  const [settled, setSettled] = useState<boolean | null>(null);
  const initialValueRef = React.useRef(initialValue);
  const schemaRef = React.useRef(schema);
  const onChangeRef = React.useRef(onChange);
  initialValueRef.current = initialValue;
  schemaRef.current = schema;
  onChangeRef.current = onChange;

  useEffect(() => {
    const iframe = iframeRef.current;
    if (!iframe) return;
    let disposed = false;
    let handle: ReturnType<typeof mountSandboxedRenderer> | null = null;
    setHeight(0);
    setSettled(null);
    const onLoad = (): void => {
      if (disposed) return;
      handle = mountSandboxedRenderer(iframe, {
        call: denyFormCalls,
        onResize: setHeight,
        onSettled: setSettled,
        onFormChange: (v) => onChangeRef.current(v),
      });
      void mcpResourceRead(uri).then((src) => {
        if (!disposed) handle?.mountForm(src, type, schemaRef.current, initialValueRef.current);
      });
    };
    iframe.addEventListener('load', onLoad);
    iframe.srcdoc = SANDBOX_HOST_HTML;
    return () => {
      disposed = true;
      iframe.removeEventListener('load', onLoad);
      handle?.dispose();
    };
    // Deliberately NOT depending on schema/initialValue/onChange — see the doc
    // comment above. A genuinely new form (a different command) gets a fresh
    // `uri`/`type` and so a fresh mount; the SAME form's value changes flow
    // through the live `onChangeRef`, never a remount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uri, type]);

  return (
    <div style={{ position: 'relative' }}>
      {settled !== true ? placeholder ?? null : null}
      <iframe
        ref={iframeRef}
        sandbox="allow-scripts"
        referrerPolicy="no-referrer"
        title="federated form"
        style={{ display: settled === true ? 'block' : 'none', width: '100%', border: 'none', height: Math.max(24, height) }}
      />
    </div>
  );
}
