// Keyboard Shortcuts Hook - Handle global keyboard shortcuts
import { useEffect, useCallback } from 'react';

export interface ShortcutHandler {
  key: string;
  ctrlKey?: boolean;
  metaKey?: boolean;
  shiftKey?: boolean;
  altKey?: boolean;
  handler: (e: KeyboardEvent) => void;
  preventDefault?: boolean;
}

export function useKeyboardShortcuts(shortcuts: ShortcutHandler[], enabled: boolean = true) {
  const handleKeyDown = useCallback((event: KeyboardEvent) => {
    if (!enabled) return;
    if (!event.key) return;

    for (const shortcut of shortcuts) {
      const keyMatches = shortcut.key.toLowerCase() === event.key.toLowerCase();
      const ctrlMatches = shortcut.ctrlKey === undefined || shortcut.ctrlKey === event.ctrlKey;
      const metaMatches = shortcut.metaKey === undefined || shortcut.metaKey === event.metaKey;
      const shiftMatches = shortcut.shiftKey === undefined || shortcut.shiftKey === event.shiftKey;
      const altMatches = shortcut.altKey === undefined || shortcut.altKey === event.altKey;

      if (keyMatches && ctrlMatches && metaMatches && shiftMatches && altMatches) {
        if (shortcut.preventDefault !== false) {
          event.preventDefault();
          event.stopPropagation();
        }
        shortcut.handler(event);
        break;
      }
    }
  }, [shortcuts, enabled]);

  useEffect(() => {
    if (enabled) {
      document.addEventListener('keydown', handleKeyDown);
      return () => document.removeEventListener('keydown', handleKeyDown);
    }
  }, [handleKeyDown, enabled]);
}