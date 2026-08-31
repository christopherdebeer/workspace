import {
  app,
  BrowserWindow,
  ipcMain,
  net,
  protocol,
  shell,
} from 'electron';
import { existsSync } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const APP_ORIGIN = 'drive://app';
const CELL_ORIGIN = 'https://c15r-drive.on.parc.land';
const AUTH_ORIGIN = 'https://parc.land';
const HERE = dirname(fileURLToPath(import.meta.url));

protocol.registerSchemesAsPrivileged([
  {
    scheme: 'drive',
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
      stream: true,
    },
  },
]);

function safeExternal(raw) {
  try {
    const u = new URL(raw);
    return u.protocol === 'https:' && (
      u.hostname === 'parc.land'
      || u.hostname === 'c15r-drive.on.parc.land'
    ) ? u.toString() : null;
  } catch {
    return null;
  }
}

async function proxy(request, prefix, origin) {
  const incoming = new URL(request.url);
  const upstream = new URL(incoming.pathname.slice(prefix.length) || '/', origin);
  upstream.search = incoming.search;

  const headers = new Headers(request.headers);
  for (const name of ['host', 'origin', 'referer', 'sec-fetch-site', 'sec-fetch-mode', 'sec-fetch-dest']) {
    headers.delete(name);
  }
  const hasBody = request.method !== 'GET' && request.method !== 'HEAD';
  return net.fetch(upstream.toString(), {
    method: request.method,
    headers,
    body: hasBody ? await request.arrayBuffer() : undefined,
  });
}

function webRoot() {
  return app.isPackaged
    ? join(app.getAppPath(), 'web')
    : resolve(HERE, '../dist/web');
}

async function handleDrive(request) {
  const url = new URL(request.url);
  if (url.host !== 'app') return new Response('not found', { status: 404 });
  if (url.pathname === '/__cell' || url.pathname.startsWith('/__cell/')) {
    return proxy(request, '/__cell', CELL_ORIGIN);
  }
  if (url.pathname === '/__auth' || url.pathname.startsWith('/__auth/')) {
    return proxy(request, '/__auth', AUTH_ORIGIN);
  }

  const root = webRoot();
  let relative = decodeURIComponent(url.pathname).replace(/^\/+/, '') || 'index.html';
  let file = resolve(root, relative);
  if (!file.startsWith(root + sep) || !existsSync(file)) {
    relative = 'index.html';
    file = resolve(root, relative);
  }
  return net.fetch(pathToFileURL(file).toString());
}

let mainWindow;

function createWindow() {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: '#05070c',
    title: 'Drive',
    webPreferences: {
      preload: join(HERE, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      devTools: !app.isPackaged || process.env.DRIVE_DEVTOOLS === '1',
    },
  });

  win.webContents.setWindowOpenHandler(({ url }) => {
    const external = safeExternal(url);
    if (external) void shell.openExternal(external);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (event, url) => {
    if (url.startsWith(`${APP_ORIGIN}/`)) return;
    event.preventDefault();
    const external = safeExternal(url);
    if (external) void shell.openExternal(external);
  });
  win.webContents.on('did-fail-load', (_event, code, description, url) => {
    console.error(`[drive] load failed ${code} ${description}: ${url}`);
    if (process.env.DRIVE_SMOKE === '1') app.exit(1);
  });
  if (process.env.DRIVE_SMOKE === '1') {
    const timeout = setTimeout(() => {
      console.error('[drive-smoke] renderer did not load within 20 seconds');
      app.exit(1);
    }, 20000);
    win.webContents.on('console-message', (_event, details) => {
      if (details.level === 'warning' || details.level === 'error') {
        console.error(`[renderer] ${details.message}`);
      }
    });
    win.webContents.once('did-finish-load', () => {
      setTimeout(async () => {
        try {
          const state = await win.webContents.executeJavaScript(`({
            title: document.title,
            canvas: !!document.querySelector('#scene'),
            runtime: typeof window.__sync === 'function'
          })`);
          clearTimeout(timeout);
          console.log(`[drive-smoke] ${JSON.stringify(state)}`);
          app.exit(state.title === 'drive — the real world, top down'
            && state.canvas && state.runtime ? 0 : 1);
        } catch (error) {
          console.error(`[drive-smoke] ${error}`);
          app.exit(1);
        }
      }, 2500);
    });
  }
  win.once('ready-to-show', () => win.show());
  win.on('closed', () => {
    if (mainWindow === win) mainWindow = undefined;
  });
  void win.loadURL(`${APP_ORIGIN}/index.html`).catch((error) => {
    console.error(`[drive] ${error}`);
    if (process.env.DRIVE_SMOKE === '1') app.exit(1);
  });
  return win;
}

const singleInstance = app.requestSingleInstanceLock();
if (!singleInstance) {
  if (process.env.DRIVE_SMOKE === '1') {
    console.error('[drive-smoke] another Drive instance owns the application lock');
    app.exit(1);
  } else {
    app.quit();
  }
} else {
  app.on('second-instance', () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  });

  app.whenReady().then(() => {
    protocol.handle('drive', handleDrive);
    ipcMain.handle('drive:open-external', async (_event, raw) => {
      const external = safeExternal(raw);
      if (!external) throw new Error('external URL is not allowed');
      await shell.openExternal(external);
    });
    mainWindow = createWindow();
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) mainWindow = createWindow();
    });
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
}
