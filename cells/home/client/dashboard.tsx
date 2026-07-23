/**
 * ADR-0044 Inc 5: the two faces' chrome, split from app.tsx (moved verbatim) —
 * the painted scenery, the signed-out trailhead (Landing), and the dashboard
 * shell (greeting header, stat cards + activity sparkline, recent writes,
 * quick capture).
 */
import * as React from 'react';
import { Card, Heading, Badge, Button, theme } from '@parc/ui';
import { localize, heroUrl, heroCutUrl, stripUrl, mcpCall, type Session } from './lib';
import { primeViews, type ViewDef } from './views';
import { FactReading, FactReadingFooter, DocBody, type ListEntry } from './facts';
import type { GraphNode } from './graph';

const { useState, useEffect } = React;

/** Peek a fact by key (null when nothing's selected). The trailhead reads the
 *  SELECTED star this way, to show it in place of the pitch — hero head, ground
 *  body — via the shared, mode-aware FactReading.
 *
 *  Cached (module-level) so returning to the trailhead with a previously-read
 *  star is INSTANT — no "reading…" flash on every round-trip. And while a NEW
 *  key loads, the last entry stays on screen until the fetch resolves, so the
 *  ground never blanks mid-transition. */
const peekCache = new Map<string, ListEntry>();
function useFactPeek(key: string | null | undefined, seed?: ListEntry): ListEntry | null {
  // Seed synchronously from cache — or the server's SSR-peeked entry (a
  // /r/<key> deep link) — so the first paint shows the fact, no flash. The
  // seed is per-request boot data, NEVER primed into the module cache from
  // the server side (a Lambda-global cache would leak one caller's fact into
  // another's render).
  const [entry, setEntry] = useState<ListEntry | null>(() => (key ? peekCache.get(key) ?? (seed && seed.key === key ? seed : null) ?? null : null));
  useEffect(() => {
    if (!key) { setEntry(null); return; }
    const cached = peekCache.get(key);
    if (cached) { setEntry(cached); return; } // instant — no refetch, no flash
    if (seed && seed.key === key) setEntry(seed); // SSR seed paints; live read still refreshes below
    // New key: keep showing whatever's on screen while the fetch runs (don't
    // blank to null); swap in the result when it lands.
    let live = true;
    void mcpCall('read', 'workspace.peek', { key })
      .then((r) => {
        if (!live) return;
        const v = r.ok ? (r.value as { value?: unknown; _meta?: ListEntry['_meta'] } | null) : null;
        const next = v ? { key, value: v.value, _meta: v._meta } as ListEntry : null;
        if (next) peekCache.set(key, next);
        setEntry(next);
      })
      .catch(() => { /* keep the current entry on error rather than blanking */ });
    return () => { live = false; };
  }, [key]);
  return entry;
}

// ─── the scenery (the painted assets) ──────────────────────────────

/** The painted valley. `tall` = the landing hero; short = the dashboard strip. */
function DuskScene({ tall, children }: { tall?: boolean; children?: React.ReactNode }): React.JSX.Element {
  return (
    <div
      style={{
        position: 'relative',
        borderRadius: theme.radius,
        overflow: 'hidden',
        boxShadow: theme.shadow,
        border: `1px solid ${theme.border}`,
        background: theme.dusk,
      }}
    >
      <img
        src={tall ? heroUrl : stripUrl}
        alt=""
        aria-hidden
        style={{
          position: 'absolute',
          inset: 0,
          width: '100%',
          height: '100%',
          objectFit: 'cover',
          objectPosition: tall ? 'center bottom' : 'center 70%',
          display: 'block',
        }}
      />
      {tall ? (
        // Legibility veil for the overlaid text — quiet in the sky, gone by mid-frame.
        <div
          style={{
            position: 'absolute',
            inset: 0,
            background: 'linear-gradient(150deg, rgba(8,29,36,0.62) 0%, rgba(8,29,36,0.28) 38%, rgba(8,29,36,0) 62%)',
          }}
        />
      ) : (
        <div style={{ position: 'absolute', inset: 0, background: 'rgba(8,29,36,0.30)' }} />
      )}
      <div style={{ position: 'relative', minHeight: tall ? 'min(56vh, 430px)' : 96, display: 'grid' }}>{children}</div>
    </div>
  );
}

/**
 * The trailhead's DUSK SKY — a painted-daytime gradient that shows through the
 * chroma-keyed hero's transparent sky, sitting in FRONT of the live night graph
 * so the graph reads as a faint pre-dawn starfield behind a dusk sky. On enter,
 * this whole layer dissolves away (day → night), revealing the graph at full
 * strength. Tunable live via window.__skyGradient for iterating on the palette.
 *
 * Default: the icon/scenery dusk ramp (theme.dusk vocabulary) — deep indigo
 * zenith → warm horizon gold, matching both the painting's amber band and the
 * graph atmosphere shader's own horizon glow.
 */
export const DEFAULT_SKY = 'linear-gradient(rgb(26, 39, 64) 0%, rgb(58, 74, 107) 39%, rgb(138, 122, 142) 52%, rgb(232, 180, 107) 62%, rgb(243, 210, 126) 100%)';
/**
 * The dusk-sky wash. Rendered as a SIBLING of the graph canvas (not inside the
 * landing overlay), with mix-blend-mode:screen so the dark sky picks up the dusk
 * tint while the bright stars punch straight through — the graph glows through
 * the daytime sky. `fade` drives the day→night dissolve (1 = full dusk, 0 = clear
 * night). Tunable live via window.__skyGradient.
 */
/** The hero band height — the graph + sky occupy only this on the landing, so
 *  the content below sits on solid ground (nothing live behind it). Kept in
 *  sync with the Hero section's minHeight. */
export const HERO_VH = '66.67svh'; // the hero band + sky-wash height (the GRAPH's rest height is 2/3 of this — see app.tsx)
export function SkyGradient({ fade = 1, heroOnly = false, height, instant = false }: { fade?: number; heroOnly?: boolean; height?: string; instant?: boolean }): React.JSX.Element {
  const g = (typeof window !== 'undefined' && (window as unknown as { __skyGradient?: string }).__skyGradient) || DEFAULT_SKY;
  return (
    <div
      className='SkyGradient'
      aria-hidden
      style={{
        // On the landing the wash covers only the hero band (matches the graph);
        // entered, it's full-viewport (heroOnly=false) as the graph fills the page.
        // `height` overrides both: during pull-to-enter it GROWS with the pull so
        // the wash's horizon rides down with the descending landscape, and its
        // opacity deepens toward the night graph. `instant` kills the transition
        // while a pull is live so it tracks the finger (the deepen mustn't lag).
        position: 'fixed', top: 0, left: 0, right: 0,
        height: height ?? (heroOnly ? HERO_VH : '100%'),
        zIndex: 1, pointerEvents: 'none',
        background: g,
        mixBlendMode: 'screen',
        opacity: fade,
        transition: instant ? 'none' : 'opacity 0.9s ease-in',
      }}
    />
  );
}

/**
 * HeroLandscape — the painted trailhead as a FULL-FRAME scene: valley, sun-lit
 * mountains, the Visitor Centre sign, and a painted dusk sky whose own stars at
 * the top edge dissolve into the live graph's star dome behind it. The mask
 * fades only the top band to transparent, so the real starfield takes over
 * exactly where the painting's sky would continue upward — a seamless handoff
 * from painted sky to live sky.
 */
function HeroLandscape(): React.JSX.Element {
  // Prod uses the chroma-keyed transparent plate (heroCutUrl): real alpha in the
  // sky, so the live graph shows through the painted silhouette — no CSS mask.
  // The harness can still override the image via window.__heroSrc for art
  // iteration; if that override is NOT transparent, fall back to the top-band
  // gradient mask so a flat painting still blends into the sky.
  const w = typeof window !== 'undefined' ? (window as unknown as { __heroSrc?: string; __heroTransparent?: boolean }) : undefined;
  const override = w?.__heroSrc;
  const src = override || heroCutUrl;
  const transparent = override ? !!w?.__heroTransparent : true; // published asset IS transparent
  const mask = transparent
    ? undefined
    : 'linear-gradient(to bottom, rgba(0,0,0,0) 0%, rgba(0,0,0,0.5) 14%, rgba(0,0,0,1) 34%)';
  return (
    <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
      <img
        src={src}
        alt=""
        aria-hidden
        style={{
          position: 'absolute',
          inset: 0,
          width: '100%',
          height: '100%',
          objectFit: 'cover',
          objectPosition: 'center bottom',
          display: 'block',
          maskImage: mask,
          WebkitMaskImage: mask,
        }}
      />
    </div>
  );
}

export function Wordmark({ light }: { light?: boolean }): React.JSX.Element {
  return (
    <span style={{ fontFamily: theme.mono, fontWeight: 700, letterSpacing: '0.02em', color: light ? theme.cream : theme.text }}>
      parc.land
    </span>
  );
}

/**
 * The persistent SITE FOOTER — wordmark + docs/agents nav. Rendered ONCE at the
 * end of the Content section so every landing state (a selected fact, the
 * landing doc, or the featured/pitch ground) ends on the same anchor, instead
 * of the footer appearing only on some branches (the drift this consolidates).
 * Landing-only: the immersive graph has the top wordmark + palette instead.
 */
function SiteFooter(): React.JSX.Element {
  return (
    <div style={{ pointerEvents: 'auto', display: 'flex', gap: '1rem', alignItems: 'center', flexWrap: 'wrap', justifyContent: 'center', paddingBottom: '1rem' }}>
      <a href={localize('/@c15r/lit')} style={{ color: theme.accent, fontSize: '0.78rem', textDecoration: 'none' }}>docs →</a>
      <span style={{ color: theme.dim, fontSize: '0.72rem' }}><Wordmark /> · a personal substrate</span>
      <a href="https://parc.land/mcp" style={{ color: theme.accent, fontSize: '0.78rem', textDecoration: 'none' }}>agents →</a>
    </div>
  );
}

// ─── face 1: the trailhead (landing) ───────────────────────────────

export function Landing({ session, onExplore, authed, canEnter, selectedKey, selectedNode, featured, landingKey, landingBody, initialFact, selectedMd, enterGrip }: {
  session: Session & { signIn: () => void };
  onExplore?: () => void;
  /** The pull-to-explore GRIP on the content sheet's top edge (owner): drag it
   *  DOWN to peel the overlay and grow the graph → enter. Enter lives here now,
   *  not on a window over-scroll, so the graph itself is free for spin. `progress`
   *  (0–1 toward the commit threshold) drives the grip's label + affordance. */
  enterGrip?: {
    onDown: (e: React.PointerEvent) => void;
    onMove: (e: React.PointerEvent) => void;
    onUp: () => void;
    progress: number;
  };
  /** Signed in: the CTA walks into the graph instead of starting WebAuthn. */
  authed?: boolean;
  /** Can walk into the sky even when signed out (a public @guest token is live) —
   *  keeps the sign-in CTA but adds the enter-the-sky gesture hint. */
  canEnter?: boolean;
  /** The default ground fact (a landing doc): when nothing is selected, the
   *  ground renders THIS doc's full body instead of the pitch/featured cards —
   *  the home page IS a fact, editable in lit. Configurable via _config/home-landing. */
  landingKey?: string;
  /** SSR'd markdown for the landing doc (the public file mirror) — first paint
   *  renders the doc itself; the live read then refreshes it in place. */
  landingBody?: string;
  /** SSR-seeded entry for a /r/<key> deep link (ADR-0090): the server peeked
   *  the fact as the caller, so the head paints server-side — no peek flash. */
  initialFact?: ListEntry;
  /** SSR'd markdown body for the deep-linked doc (public file mirror). */
  selectedMd?: string;
  /** When set, the ground below the horizon reads THAT fact instead of the pitch
   *  (a deep-linked star, or one still selected when you stepped back here). */
  selectedKey?: string | null;
  /** The graph already holds the selected node (title/type) — pass it so the
   *  hero head paints INSTANTLY on the way back, no peek round-trip, no flash.
   *  The body still streams from the peek (cached). */
  selectedNode?: GraphNode | null;
  /** Curated PUBLIC docs, server-read for anonymous visitors — the signed-out
   *  ground shows these (a real slice of the substrate) instead of the pitch. */
  featured?: Array<{ key: string; title: string; summary?: string }>;
}): React.JSX.Element {
  const signCard: React.CSSProperties = {
    background: 'rgba(253,249,239,0.88)',
    border: `1px solid ${theme.border}`,
    borderRadius: 10,
    padding: '0.8rem 0.95rem',
    boxShadow: theme.shadow,
    display: 'grid',
    gap: '0.25rem',
    backdropFilter: 'blur(8px)',
  };
  // The interactive islands sit in a pointer-events:none column (so drags on the
  // bare hero fall through to the live graph and spin it) — only the buttons,
  // links, and cards re-enable pointer events for themselves.
  const island: React.CSSProperties = { pointerEvents: 'auto' };
  // The SELECTED star (deep-link or stepped-back): its head reads over the hero
  // in place of the pitch, its body as paper on the ground below.
  const peeked = useFactPeek(selectedKey, initialFact);
  // Instant head: if the graph handed us the node, synthesize a head-only entry
  // whose value IS the graph's own label — factTitle→heuristicTitle returns that
  // string verbatim, so the hero head paints with NO round-trip. The peek
  // (cached) then supplies the full value for the body once it lands.
  const nodeEntry: ListEntry | null =
    selectedNode && selectedNode.key === selectedKey
      ? { key: selectedNode.key, value: selectedNode.label, _meta: { type: selectedNode.type } }
      : null;
  // Prefer the peeked entry (full value → real body); fall back to the node
  // entry so the head is instant while the body streams in.
  const reading = peeked ?? nodeEntry;
  // The default ground: with nothing selected, the ground reads the landing doc
  // (a real fact, editable in lit) rather than the pitch/featured cards. DocBody
  // needs only the key + type to assemble (blocks when authed, the public file
  // markdown when signed out), so a synthetic entry avoids an extra peek.
  const landingEntry: ListEntry | null = landingKey
    ? { key: landingKey, value: {}, _meta: { type: landingKey.startsWith('doc:') ? 'doc' : undefined, tags: [] } }
    : null;
  return (
    <div className="MainContent" style={{ position: 'relative', width: '100%', minHeight: '100vh', display: 'flex', flexDirection: 'column', pointerEvents: 'none' }}>
      {/* ── HERO SCREEN (first viewport): painted valley + the pitch + CTA ── */}
      <section className="Hero" style={{
        // ~2/3 viewport (HERO_VH) — the painted hero + sky wash. The live GRAPH
        // behind it is a smaller preview strip (2/3 of this, see app.tsx), so the
        // stars sit in the sky band above the painted mountains, not the whole hero.
        position: 'relative', minHeight: HERO_VH,
        display: 'grid', alignContent: 'end', justifyItems: 'center',
        padding: 'clamp(1rem, 3vw, 2rem)',
        // Lifted off the bottom now that supplementary content lives below the
        // hero — the pitch sits over the valley/treeline, not the frame edge.
        //paddingBottom: 'max(env(safe-area-inset-bottom, 0px), 10vh)',
        paddingBottom: 0,
        // FADE OUT with the pull (owner): the painted day-hero dissolves toward
        // the night graph growing behind it as you pull down — the day→night
        // handoff made continuous, not just a commit-time flip. Tracks the finger
        // while pulling; springs back at rest.
        opacity: enterGrip ? 1 - 0.72 * enterGrip.progress : 1,
        transition: enterGrip && enterGrip.progress > 0 ? 'none' : 'opacity 0.4s cubic-bezier(.22,1,.36,1)',
      }}>
        {/* Painted landscape, pinned to this first screen only */}
        <div className='HeroLandscape'style={{ position: 'absolute', inset: 0, overflow: 'hidden' }}><HeroLandscape /></div>
        <div className='HeroContent' style={{ position: 'relative', width: '100%', maxWidth: 480, display: 'grid', gap: '0.8rem', pointerEvents: 'auto', paddingBottom: '7vh',
    paddingTop: '2em' }}>
          <div style={{ display: 'grid', gap: '0.6rem' }}>
            {reading ? (
              // The selected star, IN PLACE of the pitch — title + metadata, over
              // the painting (mode-aware FactReading, dark tone + image shadow).
              <FactReading e={reading} tone="dark" onImage />
            ) : selectedKey ? (
              <span style={{ color: theme.cream, opacity: 0.8, fontFamily: theme.mono, fontSize: '0.85rem', textShadow: '0 1px 8px rgba(8,29,36,0.55)' }}>reading…</span>
            ) : (
              <>
                <h1 style={{
                  margin: 0, fontFamily: theme.serif, fontWeight: 600,
                  fontSize: 'clamp(1.3rem, 4vw, 1.9rem)', color: theme.cream,
                  maxWidth: '20ch', lineHeight: 1.25, textShadow: '0 1px 12px rgba(8,29,36,0.55)',
                }}>
                  a personal substrate for exploring the world
                </h1>
                <p style={{ margin: 0, color: theme.cream, opacity: 0.9, maxWidth: '40ch', fontSize: '0.9rem', textShadow: '0 1px 8px rgba(8,29,36,0.55)' }}>
                  Your home for notes, plans, and discoveries.
                </p>
              </>
            )}
            {/* The prominent CTA is reserved for AUTH IN. Signed in, entering the
                sky is a gesture (pull down), not a button — so no CTA here. */}
            {!authed ? (
              <div style={{ display: 'flex', gap: '0.6rem', marginTop: '0.4rem', flexWrap: 'wrap' }}>
                <div style={{ ...island, width: 'min(260px, 100%)' }}>
                  <Button onClick={session.signIn}>Sign-in/Register</Button>
                </div>
              </div>
            ) : null}
            <span style={{ color: theme.cream, opacity: 0.8, fontSize: '0.78rem', marginTop: authed ? '0.4rem' : 0, textShadow: '0 1px 6px rgba(8,29,36,0.55)' }}>
              {authed
                ? `Spin the sky to look around — pull the handle below to explore, or scroll to ${selectedKey ? 'read' : 'learn more'}.`
                : canEnter
                  ? 'Spin the public sky to look around — pull the handle below to explore, or scroll to read. Sign in to make it yours.'
                  : 'New here? Sign-in with existing or register a passkey.'}
            </span>
            {session.error ? <Badge tone="danger">{session.error}</Badge> : null}
          </div>
        </div>
        {/* No scroll cue here — the content sheet's own grip (just below) carries
            the "pull down to explore" affordance, so a second ↓ would only muddy
            it (drag-to-explore vs scroll-to-read are different gestures). */}
      </section>

      {/* ── CONTENT BELOW THE HERO ── OPAQUE ground: occludes the fixed graph +
          sky gradient so neither leaks past the horizon into the content. It's
          shaped as a SHEET — rounded top edge, lifted over the hero horizon with
          a soft top shadow — so a summoned peek (a second rounded sheet, same
          14px radius + top shadow) reads as a growing STACK rising over it. */}
      <section className="Content" style={{
        position: 'relative', zIndex: 2,
        display: 'grid', justifyItems: 'center',
        // Reduced top padding (owner): less dead space between the grip/sheet lip
        // and the first content; sides + bottom keep their comfortable breathing.
        padding: '0.7rem clamp(1rem, 3vw, 2rem) clamp(1.5rem, 5vw, 3.5rem)',
        gap: '1.4rem',
        flexGrow: 1,
        background: theme.bg, // opaque day paper — the ground below the horizon
        borderTopLeftRadius: 14, borderTopRightRadius: 14,
        marginTop: '-2.6rem', // overlap the hero more (owner: was -18px) — the lip sits deeper on the horizon
        boxShadow: '0 -12px 40px rgba(8,29,36,0.28)', // the sheet's rising edge
        pointerEvents: 'auto', // solid ground: whole section interactive (nothing behind it)
        // PARALLAX on pull (owner): the sheet drifts faster than the hero above it
        // as you pull down — foreground depth. Tracks the finger while pulling (no
        // transition), springs back at rest.
        transform: enterGrip && enterGrip.progress > 0 ? `translateY(${(enterGrip.progress * 34).toFixed(1)}px)` : undefined,
        transition: enterGrip && enterGrip.progress > 0 ? 'none' : 'transform 0.4s cubic-bezier(.22,1,.36,1)',
      }}>
        {/* PULL-TO-EXPLORE GRIP (owner): the sheet's own handle, mirroring the
            palette grip — pill only, no label (the hero copy carries the words).
            A generous full-width hit strip (touchAction:none owns the vertical
            gesture); the pill firms up as the pull nears the commit. Negative
            bottom margin pulls the content up under it (little dead space). */}
        {enterGrip && canEnter ? (
          <div
            onPointerDown={enterGrip.onDown}
            onPointerMove={enterGrip.onMove}
            onPointerUp={enterGrip.onUp}
            onPointerCancel={enterGrip.onUp}
            role="button"
            aria-label="pull down to explore the graph"
            style={{
              justifySelf: 'stretch', display: 'flex', alignItems: 'center', justifyContent: 'center',
              padding: '0.5rem 0 0.55rem', marginTop: '-0.3rem', marginBottom: '-0.8rem',
              cursor: 'grab', touchAction: 'none', userSelect: 'none',
            }}
          >
            <span aria-hidden style={{ width: 40, height: 5, borderRadius: 999, background: theme.border, opacity: 0.5 + 0.5 * enterGrip.progress, transform: `scaleX(${1 + 0.3 * enterGrip.progress})` }} />
          </div>
        ) : null}
        {selectedKey ? (
          // The selected star's BODY, as PAPER (flat ink-on-cream, not a card) —
          // the head already reads in the hero above, so body-only here, then the
          // shared reading footer (provenance · relationships · actions) so the
          // fact reads the same here as in the peek.
          <div className="FactReading_loader" style={{ width: '100%', maxWidth: 680, display: 'grid', gap: '1rem' }}>
            { reading ? (
              <>
                <FactReading e={reading} tone="light" head={false} showBody footer initialMd={selectedMd} />
                <FactReadingFooter e={reading} tone="light" authed={!!authed} />
              </>
            ) : selectedMd ? (
              // No peeked entry yet (an anonymous /r/<key> first paint — SSR
              // reads run only for authed callers) but the server DID load the
              // public doc body: render it now, server and client alike, so
              // the deep link paints content instead of "reading…". The live
              // peek still lands and upgrades to the full FactReading.
              <DocBody e={{ key: selectedKey as string, value: {}, _meta: { type: 'doc', tags: [] } }} initialMd={selectedMd} tone="light" />
            ) : (
              <span style={{ color: theme.dim, fontFamily: theme.mono, fontSize: '0.8rem' }}>reading…</span>
            )}
          </div>
        ) : landingEntry ? (
          // DEFAULT GROUND = the landing doc, full body as paper (blocks when
          // authed, the public file markdown when signed out). The home page is a
          // fact, editable in lit — not a hardcoded pitch. SiteFooter renders once
          // at the Content bottom (below), for every branch.
          <div style={{ width: '100%', maxWidth: 780, display: 'grid', gap: '1.4rem' }}>
            <div className="FactReading_loader" style={{ width: '100%', maxWidth: 680, display: 'grid', gap: '1rem', margin: '0 auto' }}>
              <DocBody e={landingEntry} initialMd={landingBody} tone="light" />
            </div>
          </div>
        ) : (
        <div style={{ width: '100%', maxWidth: 780, display: 'grid', gap: '1.4rem' }}>
          {featured && featured.length ? (
            // The unauthed public slice: real curated docs (server-read, tokenless),
            // shown in place of the generic pitch. Cards link out to the doc surface.
            <div style={{ display: 'grid', gap: '0.6rem' }}>
              <span style={{ color: theme.dim, fontFamily: theme.mono, fontSize: '0.7rem', textTransform: 'uppercase', letterSpacing: '0.06em' }}>from the substrate</span>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(260px, 100%), 1fr))', gap: '0.8rem' }}>
                {featured.map((d) => (
                  <a key={d.key} href={localize('/r/' + d.key)} style={{ ...signCard, ...island, textDecoration: 'none', color: 'inherit' }}>
                    <strong style={{ fontFamily: theme.serif, fontSize: '0.92rem', color: theme.text }}>{d.title}</strong>
                    {d.summary ? <span style={{ color: theme.dim, fontSize: '0.82rem', display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', overflow: 'hidden' } as React.CSSProperties}>{d.summary}</span> : null}
                    <span style={{ color: theme.accent, fontSize: '0.78rem', marginTop: '0.1rem' }}>read →</span>
                  </a>
                ))}
              </div>
            </div>
          ) : null}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(220px, 100%), 1fr))', gap: '0.8rem' }}>
            <div style={{ ...signCard, ...island }}>
              <strong style={{ fontFamily: theme.serif, fontSize: '0.9rem', color: theme.text }}>A workspace that remembers</strong>
              <span style={{ color: theme.dim, fontSize: '0.82rem' }}>
                Facts with provenance and history — nothing is lost, the important rises. What you save stays where you can find it.
              </span>
            </div>
            <div style={{ ...signCard, ...island }}>
              <strong style={{ fontFamily: theme.serif, fontSize: '0.9rem', color: theme.text }}>Tools you can grow</strong>
              <span style={{ color: theme.dim, fontSize: '0.82rem' }}>
                Cells are small programs you deploy into the land — a tracker, a board, a feed — each with its own address and its own logs.
              </span>
            </div>
            <div style={{ ...signCard, ...island }}>
              <strong style={{ fontFamily: theme.serif, fontSize: '0.9rem', color: theme.text }}>Agents welcome</strong>
              <span style={{ color: theme.dim, fontSize: '0.82rem' }}>
                One vocabulary for people and AI: <code style={{ fontFamily: theme.mono, fontSize: '0.78rem' }}>whoami · read · act</code> over MCP at <code style={{ fontFamily: theme.mono, fontSize: '0.78rem' }}>parc.land/mcp</code>.
              </span>
            </div>
          </div>

          {/* Docs call-to-action */}
          <div style={{ ...signCard, ...island, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', display: 'flex', flexWrap: 'wrap', gap: '0.6rem' }}>
            <div style={{ display: 'grid', gap: '0.2rem' }}>
              <strong style={{ fontFamily: theme.serif, color: theme.text }}>Public documentation</strong>
              <span style={{ color: theme.dim, fontSize: '0.82rem' }}>Read the parc.land substrate docs — server-rendered, no sign-in needed.</span>
            </div>
            <a href={localize('/@c15r/lit')} style={{ display: 'inline-block', background: theme.pine, color: theme.cream, borderRadius: 8, padding: '0.4rem 0.9rem', fontSize: '0.85rem', textDecoration: 'none', whiteSpace: 'nowrap' }}>
              Read the docs →
            </a>
          </div>

          <p style={{ margin: 0, textAlign: 'center', color: theme.dim, opacity: 0.85, fontSize: '0.8rem', fontStyle: 'italic' }}>
            “A digital communal green space.” — the Visitor Centre, est. v1
          </p>
        </div>
        )}

        {/* The persistent site footer — ONE copy, below whichever ground
            rendered above (selected fact, landing doc, or pitch/featured). */}
        <SiteFooter />
      </section>
    </div>
  );
}

// ─── face 2: the dashboard ─────────────────────────────────────────

function greetingFor(hour: number | null): string {
  if (hour === null) return 'Welcome'; // time-of-day is client-local — neutral until mounted (SSR-safe)
  if (hour < 5) return 'Up late';
  if (hour < 12) return 'Good morning';
  if (hour < 18) return 'Good afternoon';
  return 'Good evening';
}

export function DashboardHeader({ session }: { session: Session & { signOut: () => void } }): React.JSX.Element {
  // The greeting depends on the viewer's local hour, which the server can't know.
  // Render a neutral greeting on the server AND the first client render (so
  // hydration matches), then refine to the time-of-day greeting after mount.
  const [hour, setHour] = useState<number | null>(null);
  useEffect(() => setHour(new Date().getHours()), []);
  return (
    <DuskScene>
      <div
        style={{
          padding: '0.9rem 1.1rem',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '0.8rem',
          flexWrap: 'wrap',
        }}
      >
        <div style={{ display: 'grid', gap: '0.1rem' }}>
          <strong style={{ fontFamily: theme.serif, fontSize: '1.25rem', color: theme.cream, textShadow: '0 1px 8px rgba(8,29,36,0.7)' }}>
            {greetingFor(hour)}, {session.user}.
          </strong>
          <span style={{ color: theme.cream, opacity: 0.8, fontSize: '0.82rem', textShadow: '0 1px 6px rgba(8,29,36,0.7)' }}>
            Here’s what’s true in your corner of the substrate.
          </span>
        </div>
        <button
          onClick={session.signOut}
          style={{
            background: 'rgba(253,246,216,0.14)',
            border: `1px solid rgba(253,246,216,0.4)`,
            color: theme.cream,
            borderRadius: 8,
            padding: '0.35rem 0.8rem',
            fontSize: '0.8rem',
            cursor: 'pointer',
          }}
        >
          Sign out
        </button>
      </div>
    </DuskScene>
  );
}

function Sparkline({ points }: { points: number[] }): React.JSX.Element | null {
  if (points.length < 2) return null;
  const max = Math.max(...points, 1);
  const pts = points.map((v, i) => `${((i / (points.length - 1)) * 100).toFixed(1)},${(28 - (v / max) * 24).toFixed(1)}`).join(' ');
  return (
    <svg viewBox="0 0 100 30" style={{ width: '100%', height: 30, display: 'block' }} aria-hidden>
      <polyline points={pts} fill="none" stroke={theme.accent} strokeWidth="1.6" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

export interface ChangeEvent {
  op: string;
  key: string | null;
  at: string;
  seq: number;
}

export interface DashboardData {
  facts: number;
  cells: number;
  views: number;
  edges: number;
  /** Write events bucketed across their ACTUAL time span (oldest → newest) —
   *  honest write-activity, not facts-over-time. Empty when there's too little. */
  activity: number[];
  /** Milliseconds the activity series covers (first → last write), for the label. */
  activitySpanMs: number;
  /** Latest write-ish events, newest first. */
  recent: ChangeEvent[];
}

const ACTIVITY_BUCKETS = 16;

export async function loadDashboard(): Promise<DashboardData> {
  // ADR-0048 shaped reads: the edge stat wants a COUNT ({limit:0} → `total`),
  // and the activity chart wants the NEWEST window (`last` folds the old
  // head-then-window two-step into one call).
  const [q, c, v, l, ch] = await Promise.all([
    mcpCall('read', 'workspace.query', { limit: 1, shape: 'refs' }),
    mcpCall('read', 'cells.list'),
    mcpCall('read', 'workspace.views'),
    mcpCall('read', 'workspace.edges', { derived: false, limit: 0 }),
    mcpCall('read', 'workspace.changes', { last: 1000 }),
  ]);
  // The dashboard already fetched the view list (for the stat count) — feed the
  // shared cache so the "All views" card + Add-section picker don't refetch.
  if (v.ok) primeViews((v.value as { views?: ViewDef[] }).views ?? []);
  const events = ch.ok ? (((ch.value as { events?: ChangeEvent[] }).events ?? []) as ChangeEvent[]) : [];
  const writes = events.filter((e) => e.op !== 'read');
  // Adaptive bucketing: the substrate is young and bursty, so a fixed 14-day
  // chart is mostly empty and reads as "unchanging". Instead split the writes'
  // real time span (first → last) into N buckets, so the line always shows a
  // meaningful shape over whatever period the fetched window actually covers.
  const times = writes
    .map((e) => Date.parse(e.at))
    .filter((t) => !Number.isNaN(t))
    .sort((a, b) => a - b);
  let activity: number[] = [];
  let activitySpanMs = 0;
  if (times.length >= 2) {
    const lo = times[0];
    const hi = times[times.length - 1];
    activitySpanMs = hi - lo;
    const span = Math.max(1, hi - lo);
    const buckets = new Array(ACTIVITY_BUCKETS).fill(0);
    for (const t of times) buckets[Math.min(ACTIVITY_BUCKETS - 1, Math.floor(((t - lo) / span) * ACTIVITY_BUCKETS))]++;
    activity = buckets;
  }
  return {
    facts: q.ok ? ((q.value as { total?: number }).total ?? 0) : 0,
    cells: c.ok ? (((c.value as { cells?: unknown[] }).cells ?? []).length) : 0,
    views: v.ok ? (((v.value as { views?: unknown[] }).views ?? []).length) : 0,
    edges: l.ok ? ((l.value as { total?: number; edges?: unknown[] }).total ?? ((l.value as { edges?: unknown[] }).edges ?? []).length) : 0,
    activity,
    activitySpanMs,
    recent: writes.slice(-8).reverse(),
  };
}

/** Human-readable duration for the activity caption ("past 3h", "past 2d"). */
function humanSpan(ms: number): string {
  const m = Math.round(ms / 60000);
  if (m < 60) return `past ${Math.max(1, m)}m`;
  const h = Math.round(m / 60);
  if (h < 48) return `past ${h}h`;
  return `past ${Math.round(h / 24)}d`;
}

export function StatCards({ data }: { data: DashboardData | null }): React.JSX.Element {
  const cell = (label: string, value: number | null, foot?: React.ReactNode): React.JSX.Element => (
    <div
      style={{
        background: theme.panel,
        border: `1px solid ${theme.border}`,
        borderRadius: 10,
        boxShadow: theme.shadow,
        padding: '0.7rem 0.85rem',
        display: 'grid',
        gap: '0.15rem',
        alignContent: 'start',
      }}
    >
      <span style={{ color: theme.dim, fontSize: '0.74rem', textTransform: 'uppercase', letterSpacing: '0.06em' }}>{label}</span>
      <strong style={{ fontFamily: theme.serif, fontSize: '1.5rem' }}>{value === null ? '…' : value}</strong>
      {foot}
    </div>
  );
  const showSpark = !!data && data.activity.length >= 2;
  return (
    <div style={{ display: 'grid', gap: '0.7rem' }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(130px, 100%), 1fr))', gap: '0.7rem' }}>
        {cell('Facts', data ? data.facts : null)}
        {cell('Links', data ? data.edges : null)}
        {cell('Views', data ? data.views : null)}
        {cell('Cells', data ? data.cells : null)}
      </div>
      {showSpark ? (
        // Honest label: this is write activity over the window we actually
        // fetched, not facts-over-time — every op (writes, links, deploys) counts.
        <div style={{ background: theme.panel, border: `1px solid ${theme.border}`, borderRadius: 10, boxShadow: theme.shadow, padding: '0.6rem 0.85rem', display: 'grid', gap: '0.3rem' }}>
          <span style={{ color: theme.dim, fontSize: '0.72rem', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
            Write activity · {humanSpan(data!.activitySpanMs)}
          </span>
          <Sparkline points={data!.activity} />
        </div>
      ) : null}
    </div>
  );
}

const OP_LABEL: Record<string, string> = {
  write: 'remembered',
  supersede: 'retired',
  link: 'linked',
  unlink: 'unlinked',
};

export function RecentActivity({ data }: { data: DashboardData | null }): React.JSX.Element {
  return (
    <Card>
      <Heading sub="The change feed — the land's own record of what happened (reads excluded).">Recent activity</Heading>
      {!data ? (
        <p style={{ color: theme.dim }}>Loading…</p>
      ) : data.recent.length === 0 ? (
        <p style={{ color: theme.dim, margin: 0, fontSize: '0.85rem' }}>Nothing yet.</p>
      ) : (
        <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'grid', gap: '0.35rem' }}>
          {data.recent.map((e) => (
            <li key={e.seq} style={{ display: 'flex', gap: '0.5rem', alignItems: 'baseline', fontSize: '0.85rem', flexWrap: 'wrap' }}>
              <Badge tone="dim">{OP_LABEL[e.op] ?? e.op}</Badge>
              <code style={{ fontFamily: theme.mono, fontSize: '0.78rem' }}>{e.key}</code>
              <span style={{ color: theme.dim, fontSize: '0.72rem' }}>{e.at.slice(5, 16).replace('T', ' ')}</span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

/** One-box capture: a thought lands as an inbox fact in one act. */
export function QuickCapture(): React.JSX.Element {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);

  const capture = async (): Promise<void> => {
    const content = text.trim();
    if (!content) return;
    setBusy(true);
    try {
      const key = `inbox/${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}`;
      const r = await mcpCall('act', 'workspace.remember', {
        key,
        value: { content },
        type: 'capture',
        tags: ['inbox'],
        via: 'home:quick-capture',
      });
      if (r.ok) {
        setText('');
        setDone(key);
        setTimeout(() => setDone(null), 4000);
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <Heading sub="Drop a thought — it lands in your inbox as a fact, provenance stamped.">Quick capture</Heading>
      <div style={{ display: 'grid', gap: '0.5rem' }}>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={2}
          placeholder="What's on your mind?"
          style={{
            width: '100%',
            boxSizing: 'border-box',
            padding: '0.6rem',
            background: '#fffef9',
            border: `1px solid ${theme.border}`,
            borderRadius: 8,
            color: theme.text,
            fontFamily: 'inherit',
            fontSize: '0.9rem',
            resize: 'vertical',
          }}
        />
        <div style={{ display: 'flex', gap: '0.6rem', alignItems: 'center' }}>
          <div style={{ width: 160 }}>
            <Button onClick={() => void capture()} disabled={busy || !text.trim()}>
              {busy ? 'Remembering…' : 'Remember'}
            </Button>
          </div>
          {done ? (
            <span style={{ color: theme.accent, fontSize: '0.8rem' }}>
              ✓ remembered at <code style={{ fontFamily: theme.mono }}>{done}</code>
            </span>
          ) : null}
        </div>
      </div>
    </Card>
  );
}
