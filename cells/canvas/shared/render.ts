/**
 * Isomorphic canvas render — the single source of element markup, imported by
 * BOTH the cell's Lambda (SSR first paint) and the browser client (hydration).
 *
 * Pure: no DOM, no `window`, no imports. Given a placement (geometry) and its
 * content fact, it returns the exact `.canvas-element` HTML the live renderer
 * builds (`main.ts` `applyPositionStyles` + `setElementContent`) — so the
 * server-rendered document and the client agree by construction. The outer
 * node carries `data-type`/`data-content`/`data-src`, which makes the client's
 * `setElementContent` early-return on boot: SSR static elements are never
 * rebuilt, so there is no hydration flash.
 *
 * Static types (text/markdown/html/img + code) render fully here. Dynamic
 * types (view/board/minimap/repl/mermaid/…) get the positioned shell + a
 * `data-hydrate` marker; the client mounts their live renderer over it.
 */

export interface Placement {
  x: number;
  y: number;
  width: number;
  height: number;
  scale?: number;
  rotation?: number;
  zIndex?: number;
  static?: boolean;
  fixedLeft?: number;
  fixedTop?: number;
  blendMode?: string;
}

export interface Content {
  type: string;
  content?: string;
  src?: string;
  color?: string;
  id?: string;
}

/** Types whose final HTML we can produce without running client JS. */
const STATIC_TYPES = new Set(['text', 'markdown', 'html', 'img']);

export function isStaticType(type: string): boolean {
  return STATIC_TYPES.has(type);
}

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function escapeAttr(s: string): string {
  return escapeHtml(s).replace(/\n/g, '&#10;');
}

/**
 * The outer node's inline style — a faithful port of `applyPositionStyles`.
 * `cam` (camera scale) is only consulted for `static` (screen-fixed) elements,
 * which position by percentage and need the live zoom var.
 */
export function positionStyle(p: Placement, cam?: { scale: number; tx: number; ty: number }): string {
  const scale = p.scale || 1;
  const rotation = p.rotation || 0;
  const zIndex = Math.floor(p.zIndex || 0) || 1;
  const blend = p.blendMode || 'normal';
  const w = (p.width * scale).toFixed(2);
  const h = (p.height * scale).toFixed(2);
  const transform = `rotate(${rotation}deg) translate(calc(0px - var(--padding)), calc(0px - var(--padding)))`;
  const common = `--width:${w}px;--height:${h}px;--scale:${scale};--blend-mode:${blend};z-index:${zIndex};transform:${transform};`;
  if (p.static) {
    return (
      `position:fixed;left:${p.fixedLeft || 0}%;top:${p.fixedTop || 0}%;` +
      `--translateX:${cam?.tx ?? 0};--translateY:${cam?.ty ?? 0};--zoom:${cam?.scale ?? 1};` +
      common
    );
  }
  const left = (p.x - (p.width * scale) / 2).toFixed(2);
  const top = (p.y - (p.height * scale) / 2).toFixed(2);
  return `position:absolute;left:${left}px;top:${top}px;${common}`;
}

// ── a compact, dependency-free Markdown subset (isomorphic) ─────────
// Covers the common cases on a board: headings, bold/italic/code, links,
// images, lists, blockquote, hr, paragraphs. Identical on server and client,
// so an SSR markdown card and a client one are byte-equal (no flash).

function mdInline(s: string): string {
  let t = escapeHtml(s);
  t = t.replace(/`([^`]+)`/g, (_m, c) => `<code>${c}</code>`);
  t = t.replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, (_m, a, u) => `<img alt="${a}" src="${u}">`);
  t = t.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_m, a, u) => `<a href="${u}" target="_blank" rel="noopener">${a}</a>`);
  t = t.replace(/\*\*([^*]+)\*\*/g, (_m, c) => `<strong>${c}</strong>`);
  t = t.replace(/(^|[^*])\*([^*]+)\*/g, (_m, p, c) => `${p}<em>${c}</em>`);
  t = t.replace(/(^|[^_])_([^_]+)_/g, (_m, p, c) => `${p}<em>${c}</em>`);
  return t;
}

export function renderMarkdown(src: string): string {
  const lines = src.replace(/\r\n/g, '\n').split('\n');
  const out: string[] = [];
  let para: string[] = [];
  let list: { type: 'ul' | 'ol' } | null = null;
  const flushPara = (): void => {
    if (para.length) {
      out.push(`<p>${mdInline(para.join(' '))}</p>`);
      para = [];
    }
  };
  const closeList = (): void => {
    if (list) {
      out.push(`</${list.type}>`);
      list = null;
    }
  };
  for (const raw of lines) {
    const line = raw.replace(/\s+$/, '');
    if (!line.trim()) {
      flushPara();
      closeList();
      continue;
    }
    const h = line.match(/^(#{1,6})\s+(.*)$/);
    if (h) {
      flushPara();
      closeList();
      const n = h[1].length;
      out.push(`<h${n}>${mdInline(h[2])}</h${n}>`);
      continue;
    }
    if (/^(---|\*\*\*|___)\s*$/.test(line)) {
      flushPara();
      closeList();
      out.push('<hr>');
      continue;
    }
    if (/^>\s?/.test(line)) {
      flushPara();
      closeList();
      out.push(`<blockquote>${mdInline(line.replace(/^>\s?/, ''))}</blockquote>`);
      continue;
    }
    const ul = line.match(/^[-*+]\s+(.*)$/);
    const ol = line.match(/^\d+\.\s+(.*)$/);
    if (ul || ol) {
      flushPara();
      const type = ul ? 'ul' : 'ol';
      if (!list || list.type !== type) {
        closeList();
        list = { type };
        out.push(`<${type}>`);
      }
      const item = (ul ? ul[1] : ol![1]).replace(/^\[([ xX])\]\s+/, (_m, c) =>
        c === ' ' ? '☐ ' : '☑ ',
      );
      out.push(`<li>${mdInline(item)}</li>`);
      continue;
    }
    closeList();
    para.push(line);
  }
  flushPara();
  closeList();
  return out.join('\n');
}

/** The inner `.content` HTML for a content fact (matches `setElementContent`). */
export function contentHtml(c: Content, geom: { width: number; height: number }): string {
  const color = c.color ? `color:${escapeAttr(c.color)}` : '';
  const text = c.content ?? '';
  switch (c.type) {
    case 'text':
      return `<p class="content" style="${color}">${escapeHtml(text)}</p>`;
    case 'markdown':
      return `<div class="content" style="${color}">${renderMarkdown(text)}</div>`;
    case 'html':
      // Trust the owner's own HTML (same trust as the live client); inline
      // <script> is NOT executed at SSR — the client re-runs it on hydrate.
      return `<div class="content">${text}</div>`;
    case 'img': {
      const src =
        c.src ||
        `https://placehold.co/${Math.round(geom.width)}x${Math.round(geom.height)}?text=${encodeURIComponent(text)}&font=lora`;
      return `<img class="content" src="${escapeAttr(src)}" title="${escapeAttr(text)}">`;
    }
    default:
      // Dynamic type: leave an empty content shell; the client mounts it.
      return '';
  }
}

/** Whole element node: outer `.canvas-element` + inner content (or hydrate shell). */
export function elementHtml(
  p: Placement,
  c: Content,
  id: string,
  cam?: { scale: number; tx: number; ty: number },
): string {
  const dynamic = !isStaticType(c.type);
  // data-content/data-src make the client's setElementContent early-return on
  // static nodes (no rebuild, no flash). Dynamic nodes carry data-hydrate so
  // the client knows to mount their live renderer.
  const attrs = [
    `class="canvas-element"`,
    `data-el-id="${escapeAttr(id)}"`,
    `data-type="${escapeAttr(c.type)}"`,
    `type="${escapeAttr(c.type)}"`,
    dynamic ? `data-hydrate="1"` : `data-content="${escapeAttr(c.content ?? '')}"`,
    !dynamic && c.src ? `data-src="${escapeAttr(c.src)}"` : '',
    `style="${positionStyle(p, cam)}"`,
  ]
    .filter(Boolean)
    .join(' ');
  return `<div ${attrs}>${dynamic ? '' : contentHtml(c, p)}</div>`;
}

export interface BoardElement {
  id: string;
  placement: Placement;
  content: Content;
}

/** The board's element layer — what goes inside `#canvas-container`. */
export function renderBoard(
  elements: BoardElement[],
  cam?: { scale: number; tx: number; ty: number },
): { dynamic: string; static: string } {
  const dyn: string[] = [];
  const stat: string[] = [];
  for (const el of elements) {
    const html = elementHtml(el.placement, el.content, el.id, cam);
    (el.placement.static ? stat : dyn).push(html);
  }
  return { dynamic: dyn.join(''), static: stat.join('') };
}
