const { app, BrowserWindow, dialog, ipcMain } = require('electron');
const http = require('http');
const net = require('net');
const path = require('path');

// Check if app is packaged (running from app.asar)
const isDev = !app.isPackaged;
const devURL = process.env.VITE_DEV_SERVER_URL || 'http://localhost:5173';
const UI_HOST = process.env.UI_HOST || '127.0.0.1';
const UI_PORT = Number(process.env.UI_PORT || 4321);
const appIconPath = path.join(__dirname, 'icon.icns');
const preloadPath = path.join(__dirname, 'preload.js');

let httpServer = null;

function tryConnect(host, port, timeoutMs) {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host, port });
    let settled = false;

    const finish = (result) => {
      if (settled) return;
      settled = true;
      socket.removeAllListeners();
      socket.destroy();
      resolve(result);
    };

    socket.setTimeout(timeoutMs);
    socket.on('connect', () => finish(true));
    socket.on('timeout', () => finish(false));
    socket.on('error', () => finish(false));
  });
}

function tryHealth(host, port, timeoutMs) {
  return new Promise((resolve) => {
    const req = http.request(
      {
        hostname: host,
        port,
        path: '/api/health',
        method: 'GET',
        timeout: timeoutMs
      },
      (res) => {
        const chunks = [];
        res.on('data', (d) => chunks.push(typeof d === 'string' ? Buffer.from(d) : d));
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          try {
            const parsed = JSON.parse(text);
            if (typeof parsed.ok === 'boolean') {
              const detail = parsed.details ? `ok=${parsed.ok} ${parsed.details}` : `ok=${parsed.ok}`;
              resolve({ ok: true, detail });
              return;
            }
          } catch {
            // ignore parse errors
          }
          resolve({ ok: false, detail: `status ${res.statusCode || 0}` });
        });
      }
    );

    req.on('error', (err) => resolve({ ok: false, detail: err.message }));
    req.on('timeout', () => {
      req.destroy();
      resolve({ ok: false, detail: 'health check timeout' });
    });
    req.end();
  });
}

async function probeUiServer() {
  const connected = await tryConnect(UI_HOST, UI_PORT, 300);
  if (!connected) return { status: 'free' };
  const health = await tryHealth(UI_HOST, UI_PORT, 500);
  if (health.ok) return { status: 'groundview', detail: health.detail };
  return { status: 'in-use', detail: health.detail };
}

function buildDefaultZipName() {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  return `GroundView-iOS-${stamp}.zip`;
}

async function startAPIServer() {
  try {
    const probe = await probeUiServer();
    if (probe.status === 'groundview') {
      console.log(`[Electron] API server already running at ${UI_HOST}:${UI_PORT}. Skipping in-process start.`);
      return;
    }
    if (probe.status === 'in-use') {
      console.error(`[Electron] Port ${UI_PORT} already in use (${probe.detail || 'unknown service'}).`);
      return;
    }
    console.log('[Electron] Starting API server in-process...');
    console.log('[Electron] isDev:', isDev);
    console.log('[Electron] __dirname:', __dirname);
    console.log('[Electron] app.getAppPath():', app.getAppPath());
    
    // Always start the server (both dev and prod need it)
    // In packaged app, files are in app.asar and require() works directly
    const serverPath = path.join(app.getAppPath(), 'dist', 'uiServer.js');
    console.log('[Electron] Loading server from:', serverPath);
    
    // Just require directly - Electron's require handles asar files automatically
    require(serverPath);
    console.log('[Electron] API server started successfully');
  } catch (err) {
    console.error('[Electron] Failed to start API server:', err);
    console.error('[Electron] Error stack:', err.stack);
    
    // Try alternative path for dev mode
    try {
      const altPath = path.join(__dirname, '..', 'dist', 'uiServer.js');
      console.log('[Electron] Trying alternative path:', altPath);
      require(altPath);
      console.log('[Electron] API server started from alternative path');
    } catch (err2) {
      console.error('[Electron] Alternative path also failed:', err2);
    }
  }
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    backgroundColor: '#0b1221',
    title: 'GroundView iOS',
    icon: appIconPath,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: preloadPath
    }
  });

  // DevTools disabled in production builds
  // Forward console messages from renderer to main process for debugging
  win.webContents.on('console-message', (event, level, message, line, sourceId) => {
    console.log(`[Renderer] ${message}`);
  });

  if (isDev) {
    console.log('[Electron] Loading dev URL:', devURL);
    win.loadURL(devURL);
  } else {
    // In production, dist-ui is inside app.asar
    // Electron's loadFile handles asar paths automatically
    const index = path.join(app.getAppPath(), 'dist-ui', 'index.html');
    console.log('[Electron] Loading index from:', index);
    
    win.loadFile(index).catch(err => {
      console.error('[Electron] Failed to load index.html:', err);
      // Try alternative path for dev builds
      const altIndex = path.join(__dirname, '..', 'dist-ui', 'index.html');
      console.log('[Electron] Trying alternative path:', altIndex);
      win.loadFile(altIndex).catch(err2 => {
        console.error('[Electron] Failed to load from alternative path:', err2);
      });
    });
  }

  // Log any errors
  win.webContents.on('did-fail-load', (event, errorCode, errorDescription) => {
    console.error('[Electron] Failed to load:', errorCode, errorDescription);
  });

  // Log console messages from renderer
  win.webContents.on('console-message', (event, level, message, line, sourceId) => {
    console.log('[Renderer]', message);
  });
}

app.whenReady().then(async () => {
  console.log('[Electron] App ready, isDev:', isDev);
  console.log('[Electron] NODE_ENV:', process.env.NODE_ENV);

  ipcMain.handle('dialog:save', async (_event, options = {}) => {
    const requestedPath = options.defaultPath;
    const fallbackPath = path.join(app.getPath('documents'), buildDefaultZipName());
    const resolvedDefaultPath = requestedPath
      ? (path.isAbsolute(requestedPath) ? requestedPath : path.join(app.getPath('documents'), requestedPath))
      : fallbackPath;
    const result = await dialog.showSaveDialog({
      title: 'Save Capture',
      defaultPath: resolvedDefaultPath,
      filters: [{ name: 'Zip Archive', extensions: ['zip'] }],
      ...options
    });
    return result;
  });
  
  // Start API server first
  await startAPIServer();
  
  // Wait a bit for server to start
  await new Promise(resolve => setTimeout(resolve, 2000));
  
  createWindow();
  
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('quit', () => {
  // Server will be cleaned up automatically
  console.log('[Electron] App quitting');
});
