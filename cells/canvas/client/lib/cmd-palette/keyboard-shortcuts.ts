/* keyboard-shortcuts.ts - register global keyboard shortcuts */

import { buildRootItems } from './menu-items.ts';

interface MenuItem {
  shortcut?: string;
  action?: (controller: any, input?: any) => void | Promise<void> | any;
  children?: MenuItem[];
  needsInput?: string;
  visible?: (controller: any) => boolean;
  enabled?: (controller: any) => boolean;
}

/**
 * Maps keyboard shortcuts to their menu items (guards evaluated at dispatch).
 * needsInput commands are excluded — firing them without their input argument
 * ran the action with `undefined`. Collisions are loud: last-registered-wins
 * silently hid that ⌘V/⌘E/⌘G each meant two different commands.
 * @param controller - The canvas controller
 */
function buildShortcutMap(controller: any): Map<string, MenuItem> {
  const shortcutMap = new Map<string, MenuItem>();

  function walkItems(items: MenuItem[]): void {
    items.forEach((item: MenuItem) => {
      if (item.shortcut && item.action && !item.needsInput) {
        if (shortcutMap.has(item.shortcut)) {
          console.warn('[shortcuts] collision — keeping first registration:', item.shortcut);
        } else {
          shortcutMap.set(item.shortcut, item);
        }
      }

      if (item.children) {
        walkItems(item.children);
      }
    });
  }

  walkItems(buildRootItems(controller));
  return shortcutMap;
}

/**
 * Normalizes a keyboard event to a shortcut string
 * @param e - The keyboard event
 * @returns A normalized shortcut string
 */
function normalizeKeyboardEvent(e: KeyboardEvent): string {
  const modifiers = [];
  if (e.metaKey) modifiers.push('⌘');
  if (e.ctrlKey) modifiers.push('Ctrl');
  if (e.altKey) modifiers.push('⌥');
  if (e.shiftKey) modifiers.push('⇧');
  
  // Handle special keys
  let key = e.key;
  if (key === ' ') key = 'Space';
  if (key === 'ArrowUp') key = '↑';
  if (key === 'ArrowDown') key = '↓';
  if (key === 'ArrowLeft') key = '←';
  if (key === 'ArrowRight') key = '→';
  if (key === 'Escape') key = 'Esc';
  if (key === 'Delete') key = 'Del';
  if (key === 'Backspace') key = '⌫';
  
  // For single character keys, uppercase them
  if (key.length === 1) key = key.toUpperCase();
  
  return [...modifiers, key].join('');
}

/**
 * Installs keyboard shortcuts for the application. Returns an uninstaller —
 * a drill swaps controllers, and a leaked listener means every shortcut fires
 * once per drill, against detached controllers.
 * @param controller - The canvas controller
 */
export function installKeyboardShortcuts(controller: any): () => void {
  const shortcutMap = buildShortcutMap(controller);

  const onKeydown = (e: KeyboardEvent): void => {
    // Don't trigger shortcuts while typing (inputs, textareas, CodeMirror's
    // contenteditable surface).
    const target = e.target as HTMLElement;
    if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) {
      return;
    }

    const shortcut = normalizeKeyboardEvent(e);
    const entry = shortcutMap.get(shortcut);
    if (!entry) return;
    // Guards are live state — evaluate at DISPATCH, not at map build:
    // a shortcut must not fire a command its menu entry would hide/disable.
    try {
      if (entry.visible && !entry.visible(controller)) return;
      if (entry.enabled && !entry.enabled(controller)) return;
    } catch { return; }
    e.preventDefault();
    entry.action!(controller);
  };
  window.addEventListener('keydown', onKeydown);

  // Log available shortcuts for debugging
  console.log('Registered keyboard shortcuts:', [...shortcutMap.keys()]);
  return () => window.removeEventListener('keydown', onKeydown);
}
