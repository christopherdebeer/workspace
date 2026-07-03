/* command-palette.js  – enhanced command palette with categories, shortcuts, and recent commands */

import { buildRootItems } from './menu-items.ts';
import { editElementWithPrompt } from '../network/generation.ts';
import { searchFacts, addFactToCanvas } from '../network/storage.ts';
import { installKeyboardShortcuts } from './keyboard-shortcuts.ts';
import { fitRegion } from '../../../shared/frame.ts';
import type { CanvasController, CommandItem, ElementSuggestion, FactSuggestion, SuggestionItem, MenuItem } from '../../types.ts';

/** User/agent content flows into the suggestion list (element snippets, fact
 *  titles) — escape it before innerHTML. */
const esc = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// Import CSS
import './command-palette.css';

interface CommandPaletteConfig {
  maxResults: number;
  fuzziness: boolean;
  recentCommandsCount: number;
}

type PaletteMode = 'browse' | 'awaiting' | 'pending';

export function installCommandPalette(controller: CanvasController, opts: Partial<CommandPaletteConfig> = {}): (() => void) | undefined {
  const cfg: CommandPaletteConfig = { maxResults: 10, fuzziness: true, recentCommandsCount: 5, ...opts };

  

  /* ── flatten commands ── */
  function flattenCommands(): CommandItem[] {
    const out: CommandItem[] = [];
    function walk(items: MenuItem[], path: string[], category: string | null = null): void {
      items.forEach(it => {
        try {
          if (it.visible && !it.visible(controller)) return;
          if (it.enabled && !it.enabled(controller)) return;
        } catch { return; }
        const lbl = typeof it.label === 'function' ? it.label(controller, cfg) : it.label;
        const nextPath = [...path, lbl];
        const currentCategory = it.category || category;

        if (it.children) walk(it.children, nextPath, currentCategory);
        else out.push({
          kind: 'command',
          path: nextPath,
          action: it.action,
          needsInput: it.needsInput,
          shortcut: it.shortcut || null,
          category: currentCategory,
          icon: it.icon || null,
          // aliases buy synonym reach ("remove" finds Delete) for free.
          searchText: nextPath.join(' ').toLowerCase() + ' ' + (currentCategory || '').toLowerCase()
            + (it.aliases ? ' ' + String(it.aliases).toLowerCase() : '')
        });
      });
    }
    walk(buildRootItems(controller), []);
    return out;
  }
  const commandPool = (): CommandItem[] => flattenCommands();
  
  // Recent commands persist across reloads (they're the empty-state content —
  // a page-lifetime array made every fresh open start blank).
  const RECENTS_KEY = 'parc.canvas.recents';
  let recentKeys: string[] = [];
  try { recentKeys = JSON.parse(localStorage.getItem(RECENTS_KEY) || '[]'); } catch { /* fresh */ }
  /** Resolve stored keys against the LIVE pool (guards apply, stale keys drop). */
  const recentItems = (): CommandItem[] => {
    const pool = commandPool();
    return recentKeys
      .map((k) => pool.find((c) => c.path.join(' ') === k))
      .filter(Boolean) as CommandItem[];
  };
  const addToRecent = (cmd: CommandItem): void => {
    const key = cmd.path.join(' ');
    recentKeys = [key, ...recentKeys.filter((k) => k !== key)].slice(0, cfg.recentCommandsCount);
    try { localStorage.setItem(RECENTS_KEY, JSON.stringify(recentKeys)); } catch { /* storage full */ }
  };

  /* ── element suggestions ── */
  const iconForType = (t: string): string =>
    t === 'img' ? 'fa-image' : t === 'markdown' ? 'fa-brands fa-markdown' :
      t === 'html' ? 'fa-code' : 'fa-font';

  const buildElementPool = (): ElementSuggestion[] => controller.canvasState.elements.map(el => {
    const raw = (el.content ?? '').replace(/\s+/g, ' ').trim();
    const txt = raw.length > 40 ? raw.slice(0, 40) + '…' : raw || '(empty)';
    return {
      kind: 'element' as const,
      id: el.id,
      label: txt,
      icon: iconForType(el.type),
      type: el.type,
      searchText: txt.toLowerCase() + ' ' + el.type.toLowerCase()
    };
  });
  
  /* ── fuzzy search ── */
  function fuzzyMatch(text: string, query: string): boolean {
    if (!cfg.fuzziness) return text.includes(query);

    // Simple fuzzy matching algorithm
    let textIndex = 0;
    let queryIndex = 0;
    let score = 0;

    while (textIndex < text.length && queryIndex < query.length) {
      if (text[textIndex] === query[queryIndex]) {
        score += 2; // Consecutive matches get higher score
        queryIndex++;
      } else {
        score -= 0.5; // Penalty for skipping
      }
      textIndex++;
    }

    // Return true if we matched all query characters with a positive score
    return queryIndex === query.length && score > 0;
  }

  /* ── DOM skeleton ── */
  const root = document.createElement('div');
  root.id = 'cmd-palette';
  root.classList.add('empty');
  root.innerHTML = `
    <div class="cmd-header">
      <div class="recent-commands-label">Recent Commands</div>
    </div>
    <div class="cmd-context" style="display:none"></div>
    <ul class="suggestions"></ul>
    <div class="cmd-wrapper">
      <span class="cmd-icon">
        <i class="fa-solid fa-search"></i>
        <i class="fa-solid fa-spinner"></i>
        <i class="fa-solid fa-terminal"></i>
      </span>
      <input type="text" autocomplete="off" spellcheck="false" placeholder="› Type a command…" />
      <button id="cmd-clear">&times;</button>
    </div>
    <div class="cmd-footer">
      <span class="presence"></span>
      <div class="desktop">
        <span class="cmd-tip"><kbd>↑</kbd><kbd>↓</kbd> navigate</span>
        <span class="cmd-tip"><kbd>Enter</kbd> select</span>
        <span class="cmd-tip"><kbd>?</kbd> search workspace</span>
        <span class="cmd-tip"><kbd>&gt;</kbd> commands only</span>
        <span class="cmd-tip">type:name filters</span>
      </div>
      <div class="mobile">
        <span class="cmd-tip"><kbd>?</kbd> workspace</span>
        <span class="cmd-tip">type:machine</span>
      </div>
    </div>
    `;
  document.body.appendChild(root);

  const $input = root.querySelector('input') as HTMLInputElement;
  const $list = root.querySelector('.suggestions') as HTMLUListElement;
  const $clear = root.querySelector('#cmd-clear') as HTMLButtonElement;
  const $recentLabel = root.querySelector('.recent-commands-label') as HTMLDivElement;
  const $save = root.querySelector('.cmd-footer .presence') as HTMLSpanElement;

  /* ── save-state dot: persistence used to fail silently (console-only) ── */
  let saveFade: ReturnType<typeof setTimeout> | undefined;
  const onSaveState = (ev: Event): void => {
    const state = (ev as CustomEvent<{ state: string }>).detail?.state;
    clearTimeout(saveFade);
    if (state === 'saving') { $save.textContent = 'saving…'; $save.style.color = '#8a8a82'; }
    else if (state === 'failed') { $save.textContent = '⚠ save failed — changes may be lost'; $save.style.color = '#b3261e'; }
    else { $save.textContent = 'saved'; $save.style.color = '#2f6f4f'; saveFade = setTimeout(() => { $save.textContent = ''; }, 1600); }
  };
  window.addEventListener('parc:save-state', onSaveState);

  /* ── dynamic placeholder: teach the free-text behaviours in place —
   *    Enter with a selection AI-edits it; with none it creates a note. ── */
  const onSelForPlaceholder = (ev: Event): void => {
    if (mode !== 'browse') return;
    const ids = (ev as CustomEvent<{ ids: string[] }>).detail?.ids ?? [];
    if (ids.length === 1) {
      const el = controller.findElementById(ids[0]);
      const raw = typeof el?.content === 'string' ? el.content.trim().split('\n')[0] : '';
      const title = raw.length > 24 ? raw.slice(0, 23) + '…' : raw;
      $input.placeholder = title ? `Ask AI to edit “${title}” — or type a command…` : 'Ask AI to edit the selection — or type a command…';
    } else {
      $input.placeholder = '› Type a command — or text to create a note…';
    }
  };
  window.addEventListener('parc:selection-changed', onSelForPlaceholder);
  $input.placeholder = '› Type a command — or text to create a note…';

  /* ── state ── */
  let filtered: SuggestionItem[] = [];
  let sel = -1;
  let mode: PaletteMode = 'browse';           // 'browse' | 'awaiting' | 'pending'
  let pending: CommandItem | null = null;            // command awaiting free-text
  let showingRecent = false;     // whether we're showing recent commands

  /* ── render ── */
  const render = (): void => {
    $list.innerHTML = '';
    $recentLabel.style.display = showingRecent ? 'block' : 'none';

    let prevKind: string | null = null;
    (mode === 'browse' ? filtered : []).forEach((it, i) => {
      // Scope headers: say WHERE each hit lives (a command, an element already
      // on this board, or a workspace fact the selection would ADD).
      if (!showingRecent && it.kind !== 'more' && it.kind !== prevKind) {
        prevKind = it.kind;
        const h = document.createElement('li');
        h.textContent = it.kind === 'command' ? 'Commands' : it.kind === 'element' ? 'On this board' : 'Workspace — select to add';
        h.style.cssText = 'list-style:none;padding:7px 10px 2px;font-size:10px;letter-spacing:.08em;text-transform:uppercase;color:#a8a89e;pointer-events:none';
        $list.appendChild(h);
      }
      const li = document.createElement('li');
      li.className = 'suggestion' + (i === sel ? ' active' : '');

      if (it.kind === 'more') {
        li.innerHTML = `
          <span class="s-icon"><i class="fa-solid fa-ellipsis"></i></span>
          <div class="cmd-content"><span class="crumb last-crumb" style="color:#2f6f4f">${esc(it.label)}</span></div>`;
      } else if (it.kind === 'command') {
        let iconHtml = '';
        if (it.icon) {
          iconHtml = `<span class="s-icon"><i class="fa-solid ${it.icon}"></i></span>`;
        }
        
        let categoryHtml = '';
        if (it.category) {
          categoryHtml = `<span class="cmd-category">${it.category}</span>`;
        }

        let inputHtml = '';
        if (it.needsInput) {
          inputHtml = `<span class="cmd-input"><kbd>${it.needsInput}</kbd></span>`;
        }
        
        let shortcutHtml = '';
        if (it.shortcut) {
          shortcutHtml = `<span class="cmd-shortcut"><kbd>${it.shortcut}</kbd></span>`;
        }
        
        const pathHtml = it.path.map((p, idx) => {
          const isLast = idx === it.path.length - 1;
          return `<span class="crumb${isLast ? ' last-crumb' : ''}">${esc(p)}</span>`;
        }).join('');
        
        li.innerHTML = `
          ${iconHtml}
          <div class="cmd-content">
            ${pathHtml}
            ${inputHtml}
          </div>
          ${categoryHtml}
          ${shortcutHtml}
        `;
      } else if (it.kind === 'fact') {
        // A substrate fact not yet on the board — the icon is a kernel glyph
        // (emoji / •) or a fontawesome class; the + marks "bring it in".
        const icon = it.icon.startsWith('fa-') ? `<i class="fa-solid ${it.icon}"></i>` : esc(it.icon);
        li.innerHTML = `
          <span class="s-icon">${icon}</span>
          <div class="cmd-content">
            <span class="crumb last-crumb">${esc(it.label)}</span>
            <span class="cmd-category">add · ${esc(it.type)}</span>
          </div>
          <span class="cmd-shortcut"><kbd>+</kbd></span>
        `;
      } else {
        li.innerHTML = `
          <span class="s-icon"><i class="fa-solid ${it.icon}"></i></span>
          <div class="cmd-content">
            <span class="crumb last-crumb">${esc(it.label)}</span>
            <span class="cmd-category">${esc(it.type)}</span>
          </div>
        `;
      }

      li.onclick = () => run(it);
      $list.appendChild(li);
    });
  };

  const computeFiltered = (q: string): SuggestionItem[] => {
    if (!q) {
      // Show recent commands when no query
      const rec = recentItems();
      showingRecent = rec.length > 0;
      return rec;
    }

    showingRecent = false;
    const term = q.toLowerCase();

    // Combine command pool and element pool
    const allItems: SuggestionItem[] = [...commandPool(), ...buildElementPool()];

    // Filter based on fuzzy search or regular includes
    const matchedItems = cfg.fuzziness
      ? allItems.filter(i => fuzzyMatch(i.searchText, term))
      : allItems.filter(i => i.searchText.includes(term));

    // Sort by relevance - exact matches first, then by path length (shorter paths first)
    return matchedItems
      .sort((a, b) => {
        // Exact matches first
        const aExact = a.searchText.includes(' ' + term + ' ');
        const bExact = b.searchText.includes(' ' + term + ' ');
        if (aExact && !bExact) return -1;
        if (!aExact && bExact) return 1;

        // Then by path length (shorter paths first)
        if (a.kind === 'command' && b.kind === 'command') {
          return a.path.length - b.path.length;
        }

        return 0;
      })
      .slice(0, cfg.maxResults);
  };

  /* ── helpers ── */
  const startInput = (cmd: CommandItem): void => {
    mode = 'awaiting';
    pending = cmd;
    $input.value = '';
    $input.placeholder = (cmd.path[cmd.path.length - 1] || '') + '…';
    $input.focus();
    root.classList.add('awaiting');
    filtered = []; sel = -1; render();
  };
  const quitInput = (): void => {
    mode = 'browse'; pending = null;
    root.classList.remove('awaiting');
    root.classList.remove('pending');
    $input.placeholder = '› Type a command — or text to create a note…';
    reset();
  };

  const enterPending = (): void => {
    mode = 'pending';
    $input.value = '';
    root.classList.add('pending');
    root.classList.remove('awaiting');
  };

  /* ── run ── */
  function run(item: SuggestionItem | undefined): void {
    if (!item) return;
    if (item.kind === 'more') {
      loadMoreFacts(); // page in the next batch; keep the query + list
      return;
    }
    if (item.kind === 'command') {
      // Add to recent commands
      addToRecent(item);

      if (item.needsInput) {
        startInput(item);
        return;
      }
      item.action?.(controller);
    } else if (item.kind === 'fact') {
      // Bring an existing substrate fact onto this board (membership + placement).
      void addFactToCanvas(controller, item.key);
    } else {
      controller.selectElement(item.id);
      zoomToElement(controller, item.id);
      controller.switchMode?.('navigate');
    }
    reset();
  }

  const reset = (): void => {
    $input.value = '';
    sel = -1;
    filtered = recentItems();
    showingRecent = filtered.length > 0;
    root.classList.add('empty');
    render();
  };

  /* ── zoom helper — through the one shared camera resolver ── */
  const zoomToElement = (ctrl: CanvasController, id: string): void => {
    const el = ctrl.findElementById(id); if (!el) return;
    const s = el.scale || 1;
    const hw = (el.width * s) / 2, hh = (el.height * s) / 2;
    const cam = fitRegion(
      { minX: el.x - hw, minY: el.y - hh, maxX: el.x + hw, maxY: el.y + hh },
      ctrl.canvas.clientWidth, ctrl.canvas.clientHeight, 0.15, ctrl.MAX_SCALE);
    ctrl.viewState.scale = cam.scale;
    ctrl.viewState.translateX = cam.tx;
    ctrl.viewState.translateY = cam.ty;
    ctrl.updateCanvasTransform(); ctrl.saveLocalViewState?.();
  };

  /* ── events ── */
  $input.addEventListener('focus', () => {
    root.classList.add('focused');
    // Only scroll in real browser environments
    if (typeof window.scrollTo === 'function') {
      try {
        window.scrollTo(0, 0);
      } catch (e) {
        // scrollTo may not be implemented in test environment
      }
    }
    
    // Show recent commands when focused with empty input
    if (!$input.value.trim()) {
      filtered = recentItems();
      showingRecent = filtered.length > 0;
      render();
    }
  });
  
  /* ── scoped search ──────────────────────────────────────────────────────
   * Plain text searches EVERYTHING (commands + this board + workspace).
   * `>` prefixes a commands/board-only query; `?` searches the WORKSPACE only
   * (semantic, salience-ranked — `type:machine` filters by declared type).
   * The footer advertises the prefixes; sections label each scope in the
   * results, so it's always clear WHERE a hit lives. */
  type Scope = 'all' | 'local' | 'facts';
  const parseScope = (raw: string): { scope: Scope; q: string } =>
    raw.startsWith('>') ? { scope: 'local', q: raw.slice(1).trim() }
    : raw.startsWith('?') ? { scope: 'facts', q: raw.slice(1).trim() }
    : { scope: 'all', q: raw };
  let lastScope: Scope = 'all';
  let factCursor: string | null = null;
  let factTotal = 0;
  let lastFactQuery = '';

  const moreRow = (): SuggestionItem =>
    ({ kind: 'more', label: `More from workspace… (${factTotal} match${factTotal === 1 ? '' : 'es'} total)`, searchText: '' });

  const applyFactHits = (page: { hits: { key: string; title: string; icon: string; type: string | null }[]; nextCursor: string | null; total: number }, append: boolean): void => {
    const base = filtered.filter((i) => i.kind !== 'more' && (append || i.kind !== 'fact'));
    const have = new Set(base.filter((i) => i.kind === 'fact').map((i) => (i as FactSuggestion).key));
    const add: FactSuggestion[] = page.hits
      .filter((h) => !have.has(h.key))
      .map((h) => ({ kind: 'fact', key: h.key, label: h.title, icon: h.icon, type: h.type ?? 'fact', searchText: '' }));
    factCursor = page.nextCursor;
    factTotal = page.total;
    filtered = [...base, ...add];
    if (factCursor && page.hits.length) filtered.push(moreRow());
    render();
  };

  // Debounced substrate search: facts NOT on this board, in their own
  // "Workspace" section with an "Add to board" affordance. Async, so it lands
  // a beat after the synchronous matches and only if the query still holds.
  let factTimer: ReturnType<typeof setTimeout> | undefined;
  const scheduleFactSearch = (q: string, scope: Scope): void => {
    clearTimeout(factTimer);
    if (scope === 'local') return;
    if (q.length < 2 && !/\btype:/.test(q)) return;
    lastFactQuery = q;
    factCursor = null;
    factTimer = setTimeout(() => {
      void searchFacts(q, controller, scope === 'facts' ? 12 : 6).then((page) => {
        if (parseScope($input.value.trim()).q !== q) return; // stale — the query moved on
        applyFactHits(page, false);
      });
    }, 250);
  };

  const loadMoreFacts = (): void => {
    if (!factCursor) return;
    void searchFacts(lastFactQuery, controller, 12, factCursor).then((page) => {
      if (parseScope($input.value.trim()).q !== lastFactQuery) return;
      applyFactHits(page, true);
    });
  };

  $input.addEventListener('input', (e: Event) => {
    const target = e.target as HTMLInputElement;
    const raw = target.value.trim();
    const { scope, q } = parseScope(raw);
    lastScope = scope;
    root.classList.toggle('empty', raw === '');
    filtered = scope === 'facts' ? [] : computeFiltered(q);
    sel = -1;
    render();
    scheduleFactSearch(q, scope);
  });

  $input.addEventListener('blur', () => {
    root.classList.remove('focused');
  });

  $input.addEventListener('keydown', async (e: KeyboardEvent) => {
    // Tab completion - select first item
    if (e.key === 'Tab' && filtered.length && sel === -1) {
      sel = 0;
      render();
      e.preventDefault();
      return;
    }

    // Navigation
    if (e.key === 'ArrowDown' && filtered.length) {
      sel = (sel + 1) % filtered.length;
      render();
      e.preventDefault();
    }
    else if (e.key === 'ArrowUp' && filtered.length) {
      sel = (sel - 1 + filtered.length) % filtered.length;
      render();
      e.preventDefault();
    }
    else if (e.key === 'Enter') {
      const val = $input.value.trim();
      if (mode === 'awaiting') {
        enterPending();
        await pending?.action?.(controller, val);
        quitInput();
        return;
      }

      if (sel >= 0) {
        run(filtered[sel]);
      }
      else if (val && lastScope !== 'all') {
        // A scoped query's Enter takes the top hit — free-text side effects
        // (AI edit / create note) belong to the unscoped scratchpad only.
        if (filtered.length) run(filtered[0]);
      }
      else if (val) {
        const selId = controller.selectedElementId;
        if (selId) {
          const el = controller.findElementById(selId);
          if (el) {
            editElementWithPrompt(val, el, controller).catch(console.error);
          }
          reset();
        } else {
          const r = controller.canvas.getBoundingClientRect();
          const pt = controller.screenToCanvas(r.width / 2, r.height / 2);
          controller.createNewElement(pt.x, pt.y, 'markdown', val);
          reset();
        }
      }
    } else if (e.key === 'Escape') {
      mode === 'awaiting' ? quitInput() : reset();
      root.classList.remove('focused');
    }
  });

  // ✕ clears the QUERY; only in an awaiting flow does it cancel the flow —
  // clearing text used to abort a pending input command as a side effect.
  $clear.onclick = () => { mode === 'awaiting' ? quitInput() : reset(); };

  // Global keyboard shortcut to open command palette
  const globalKeydownHandler = (e: KeyboardEvent): void => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      $input.focus();
      $input.select();

      // Show recent commands when opened
      filtered = recentItems();
      showingRecent = filtered.length > 0;
      render();
    }
  };

  window.addEventListener('keydown', globalKeydownHandler);

  // Initialize with recent commands if available
  filtered = recentItems();
  showingRecent = filtered.length > 0;
  render();

  // Install keyboard shortcuts
  const uninstallShortcuts = installKeyboardShortcuts(controller);

  // Return cleanup function
  return () => {
    uninstallShortcuts();
    window.removeEventListener('keydown', globalKeydownHandler);
    window.removeEventListener('parc:save-state', onSaveState);
    window.removeEventListener('parc:selection-changed', onSelForPlaceholder);
    clearTimeout(factTimer);
    clearTimeout(saveFade);
    root.remove();
  };
}
