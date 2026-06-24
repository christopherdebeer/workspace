/* ---------------------------------------------------------------------------
 *  inspectorPanel.ts — the single contextual editing surface (consolidation).
 *
 *  Edge + frame editors used to be competing bottom sheets that overlapped the
 *  command palette. They answer the same question the palette does — "I have
 *  something selected; what can I do with it?" — so they now render into ONE
 *  place: a `.cmd-context` slot at the top of #cmd-palette, above its input.
 *  Search stays usable below; selecting clears the slot's previous occupant.
 *
 *  If the palette isn't mounted (it always is in practice), a fixed bottom
 *  container is used as a fallback so the editors still work.
 * ------------------------------------------------------------------------- */

const SLOT = 'cmd-context';

/** The palette's context slot, created lazily at the top of #cmd-palette. */
function paletteSlot(): HTMLElement | null {
  const palette = document.getElementById('cmd-palette');
  if (!palette) return null;
  let slot = palette.querySelector('.' + SLOT) as HTMLElement | null;
  if (!slot) {
    slot = document.createElement('div');
    slot.className = SLOT;
    slot.style.display = 'none';
    const header = palette.querySelector('.cmd-header');
    if (header?.nextSibling) palette.insertBefore(slot, header.nextSibling);
    else palette.insertBefore(slot, palette.firstChild);
  }
  return slot;
}

function fallback(): HTMLElement {
  let f = document.getElementById('inspector-fallback');
  if (!f) {
    f = document.createElement('div');
    f.id = 'inspector-fallback';
    f.setAttribute('style', 'position:fixed;bottom:0;left:0;right:0;z-index:9500;background:#fbfbf8;border-top:1px solid #e4e4dc;box-shadow:0 -3px 16px rgba(0,0,0,.12);padding:12px 14px calc(12px + env(safe-area-inset-bottom));max-width:560px;margin:0 auto;border-radius:14px 14px 0 0;display:none');
    document.body.appendChild(f);
  }
  return f;
}

function host(): HTMLElement { return paletteSlot() ?? fallback(); }

/** Who last populated the panel ('selection' | 'edge' | 'frame'). Several modules
 *  share the one slot; ownership lets each clear only its own content so they
 *  don't stomp each other (e.g. a pan firing selection-changed mustn't close an
 *  open edge editor). */
let owner: string | null = null;
export function inspectorOwner(): string | null { return owner; }

/** Render an editor node into the context surface, replacing any prior one. */
export function showInspector(node: HTMLElement, ownerName = 'misc'): void {
  owner = ownerName;
  const h = host();
  h.innerHTML = '';
  h.appendChild(node);
  h.style.display = 'block';
  document.getElementById('cmd-palette')?.classList.add('inspecting');
}

/** Enter the full detent: the editor takes over the sheet. Hides the palette's
 *  search/suggestions (via .sheet-full), empties the slot and returns it as the
 *  host for the editor to fill. (Phase 2 of the unified sheet.) */
export function enterFull(): HTMLElement {
  owner = 'editor';
  const h = host();
  h.innerHTML = '';
  h.style.display = 'block';
  document.getElementById('cmd-palette')?.classList.add('inspecting', 'sheet-full');
  return h;
}

/** Leave the full detent (restoring the palette) and clear the editor. Force
 *  clears (no owner guard) so the editor always closes. */
export function exitFull(): void {
  document.getElementById('cmd-palette')?.classList.remove('sheet-full');
  clearInspector();
}

/** Empty + hide the context surface. With an owner name, only clears when that
 *  owner currently holds the panel; with none, force-clears. */
export function clearInspector(ownerName?: string): void {
  if (ownerName && owner !== ownerName) return;
  owner = null;
  const slot = document.querySelector('#cmd-palette .' + SLOT) as HTMLElement | null;
  const fb = document.getElementById('inspector-fallback');
  for (const h of [slot, fb]) {
    if (h) { h.innerHTML = ''; h.style.display = 'none'; }
  }
  document.getElementById('cmd-palette')?.classList.remove('inspecting');
}

/** Build the standard inspector header (title + Done) wired to onClose. */
export function inspectorHeader(title: string, onClose: () => void): HTMLElement {
  const head = document.createElement('div');
  head.style.cssText = 'display:flex;justify-content:space-between;align-items:center;margin-bottom:8px';
  head.innerHTML = `<strong style="font-family:Georgia,serif">${title}</strong>`;
  const done = document.createElement('button');
  done.textContent = 'Deselect';
  done.style.cssText = 'border:0;background:transparent;color:#8a8a82;font:inherit;cursor:pointer;padding:4px 6px';
  // Call with NO args — passing the click Event straight to a handler like
  // clearInspector(ownerName?) made the event the owner-guard, so it never fired.
  done.addEventListener('click', () => onClose());
  head.appendChild(done);
  return head;
}
