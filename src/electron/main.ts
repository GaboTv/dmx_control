import { app, BrowserWindow, dialog, shell } from 'electron';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DEFAULT_PORT = 4174;
const SERVER_HOST = '127.0.0.1';

let mainWindow: BrowserWindow | undefined;
let serverProcess: ChildProcessWithoutNullStreams | undefined;

function serverPort(): number {
  const rawPort = Number.parseInt(process.env.PORT ?? '', 10);
  return Number.isFinite(rawPort) ? rawPort : DEFAULT_PORT;
}

function serverUrl(): string {
  return `http://${SERVER_HOST}:${serverPort()}`;
}

function appRoot(): string {
  return app.isPackaged ? app.getAppPath() : process.cwd();
}

function bundledServerEntry(): string {
  return path.join(appRoot(), 'dist', 'server', 'server', 'index.js');
}

function staticDir(): string {
  return path.join(appRoot(), 'dist', 'client');
}

function spawnBundledServer(): void {
  if (serverProcess) {
    return;
  }

  serverProcess = spawn(process.execPath, [bundledServerEntry()], {
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: '1',
      HOST: SERVER_HOST,
      PORT: String(serverPort()),
      STATIC_DIR: staticDir(),
    },
    stdio: 'pipe',
    windowsHide: true,
  });

  serverProcess.stdout.on('data', (chunk) => {
    console.log(`[dmx-server] ${String(chunk).trimEnd()}`);
  });

  serverProcess.stderr.on('data', (chunk) => {
    console.error(`[dmx-server] ${String(chunk).trimEnd()}`);
  });

  serverProcess.on('exit', (code, signal) => {
    if (serverProcess) {
      console.log(
        `[dmx-server] exited code=${code ?? 'null'} signal=${signal ?? 'null'}`,
      );
      serverProcess = undefined;
    }
  });
}

async function waitForServer(url: string): Promise<void> {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${url}/api/status`);
      if (response.ok) {
        return;
      }
    } catch {
      // Server is still starting.
    }

    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  throw new Error(`Timed out waiting for DMX server at ${url}`);
}

async function createMainWindow(): Promise<void> {
  const rendererUrl = process.env.ELECTRON_RENDERER_URL ?? serverUrl();

  mainWindow = new BrowserWindow({
    backgroundColor: '#050711',
    height: 900,
    minHeight: 720,
    minWidth: 1120,
    show: false,
    title: 'DMX Light Control',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, 'preload.js'),
    },
    width: 1440,
  });

  mainWindow.once('ready-to-show', () => {
    mainWindow?.show();
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: 'deny' };
  });

  await mainWindow.loadURL(rendererUrl);
}

async function startApp(): Promise<void> {
  if (!process.env.ELECTRON_RENDERER_URL) {
    spawnBundledServer();
    await waitForServer(serverUrl());
  }

  await createMainWindow();
}

function stopServer(): void {
  if (!serverProcess) {
    return;
  }

  serverProcess.kill('SIGTERM');
  serverProcess = undefined;
}

app.whenReady().then(() => {
  void startApp().catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    dialog.showErrorBox('DMX Light Control failed to start', message);
    app.quit();
  });
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    void createMainWindow();
  }
});

app.on('before-quit', () => {
  stopServer();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
