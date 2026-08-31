/**
 * Browser cells are same-origin; packaged shells are not. Keep that distinction
 * here so game code never has to know whether it is running under CloudFront,
 * Electron's private protocol, or Capacitor's local WebView origin.
 */
declare const __DRIVE_PACKAGED__: boolean | undefined;
declare const __DRIVE_BUILD__: string | undefined;

interface DriveNativeBridge {
  openExternal?(url: string): Promise<void>;
  closeExternal?(): Promise<void>;
}

declare global {
  interface Window {
    driveNative?: DriveNativeBridge;
  }
}

export const PACKAGED =
  typeof __DRIVE_PACKAGED__ !== 'undefined' && __DRIVE_PACKAGED__ === true;
export const DRIVE_BUILD =
  typeof __DRIVE_BUILD__ !== 'undefined' ? __DRIVE_BUILD__ : 'web';

export const LIVE_CELL_ORIGIN = 'https://c15r-drive.on.parc.land';
export const LIVE_AUTH_ORIGIN = 'https://parc.land';

const electron = PACKAGED && location.protocol === 'drive:';
const browserCellPath = (location.pathname.match(/^\/@[^/]+\/[^/]+/) ?? [''])[0];

/** Base for cell routes such as /~/osm, /state, /tape, and /gmaps. */
export const CELL_BASE = PACKAGED
  ? electron ? 'drive://app/__cell' : LIVE_CELL_ORIGIN
  : browserCellPath;

/** Electron proxies auth to preserve web security; Capacitor uses native HTTP. */
export const AUTH_BASE = electron ? 'drive://app/__auth' : LIVE_AUTH_ORIGIN;
export const AUTH_MODE: 'redirect' | 'device' = PACKAGED ? 'device' : 'redirect';

/** A URL another person can open, never a private native-shell URL. */
export function publicGameUrl(search = ''): string {
  if (!PACKAGED) return `${location.origin}${location.pathname}${search}`;
  return new URL(search || '/', `${LIVE_CELL_ORIGIN}/`).toString();
}

/** Expand a public cell route returned by the API. */
export function publicCellUrl(path: string): string {
  if (!PACKAGED) return `${location.origin}${path}`;
  return new URL(path, `${LIVE_CELL_ORIGIN}/`).toString();
}

export async function openExternalUrl(url: string): Promise<void> {
  const u = new URL(url);
  if (u.protocol !== 'https:') throw new Error('external URL must use HTTPS');
  if (window.driveNative?.openExternal) {
    await window.driveNative.openExternal(u.toString());
    return;
  }
  const opened = window.open(u.toString(), '_blank', 'noopener,noreferrer');
  if (!opened) throw new Error('could not open the approval page');
}

export async function closeExternalUrl(): Promise<void> {
  await window.driveNative?.closeExternal?.();
}
