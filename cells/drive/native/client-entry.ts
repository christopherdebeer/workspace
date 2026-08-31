import { Browser } from '@capacitor/browser';

// Electron installs its narrower IPC-backed bridge in preload. Capacitor uses
// SFSafariViewController so OAuth device approval does not replace the game.
if (!window.driveNative) {
  window.driveNative = {
    openExternal: async (url: string): Promise<void> => {
      await Browser.open({ url, presentationStyle: 'popover' });
    },
    closeExternal: async (): Promise<void> => {
      await Browser.close();
    },
  };
}

void import('../client/main');
