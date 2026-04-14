import { exec, spawn } from 'child_process';
import { promisify } from 'util';
import fs from 'fs';
import os from 'os';
import path from 'path';

const execAsync = promisify(exec);

function resolveLogDir(): string {
  if (process.platform === 'darwin') {
    return path.join(os.homedir(), 'Documents', 'GroundView_log');
  }
  return path.join(os.homedir(), 'GroundView_log');
}

const LOG_DIR = resolveLogDir();
const LOG_FILE = path.join(LOG_DIR, 'iproxy-manager.log');

function ensureLogDir() {
  try {
    fs.mkdirSync(LOG_DIR, { recursive: true });
  } catch {
    // ignore
  }
}

// Get bundled binary paths
function getBundledBinaryPath(name: string): string {
  try {
    // In packaged app: app.asar/dist -> Resources/bin/<name>
    const bundledPath = path.join(__dirname, '..', '..', 'resources', 'bin', name);
    if (fs.existsSync(bundledPath)) {
      return bundledPath;
    }
    // Development mode: use system binary
    return name;
  } catch (e) {
    return name;
  }
}

function getBundledLibPath(): string | null {
  try {
    const libPath = path.join(__dirname, '..', '..', 'resources', 'lib');
    if (fs.existsSync(libPath)) {
      return libPath;
    }
    return null;
  } catch (e) {
    return null;
  }
}

function log(message: string) {
  const timestamp = new Date().toISOString();
  const logMessage = `[${timestamp}] [iproxyManager] ${message}`;
  console.log(logMessage);
  try {
    ensureLogDir();
    fs.appendFileSync(LOG_FILE, logMessage + '\n');
  } catch (e) {
    // ignore
  }
}

let iproxyProcess: ReturnType<typeof exec> | null = null;
let currentDeviceId: string | null = null;

export async function getConnectedDevice(): Promise<string | null> {
  try {
    const ideviceIdPath = getBundledBinaryPath('idevice_id');
    const libPath = getBundledLibPath();
    
    const env = { ...process.env };
    if (libPath) {
      env.DYLD_LIBRARY_PATH = libPath + ':' + (env.DYLD_LIBRARY_PATH || '');
    }
    
    const { stdout } = await execAsync(`"${ideviceIdPath}" -l 2>/dev/null || echo ""`, { env });
    const deviceId = stdout.trim().split('\n')[0];
    if (deviceId) {
      log(`Device detected: ${deviceId}`);
    }
    return deviceId || null;
  } catch (e) {
    log(`Error detecting device: ${e instanceof Error ? e.message : String(e)}`);
    return null;
  }
}

export async function isIproxyRunning(): Promise<boolean> {
  try {
    const { stdout } = await execAsync('lsof -i :8100 -t 2>/dev/null || echo ""');
    return stdout.trim().length > 0;
  } catch (e) {
    return false;
  }
}

export async function stopIproxy(): Promise<void> {
  if (iproxyProcess) {
    try {
      iproxyProcess.kill();
    } catch (e) {
      // ignore
    }
    iproxyProcess = null;
  }
  try {
    await execAsync('pkill -f "iproxy 8100" 2>/dev/null || true');
  } catch (e) {
    // ignore
  }
}

export async function startIproxy(deviceId: string): Promise<boolean> {
  try {
    log(`Starting iproxy for device: ${deviceId}`);
    await stopIproxy();
    
    const iproxyPath = getBundledBinaryPath('iproxy');
    log(`Using iproxy at: ${iproxyPath}`);
    
    // Spawn iproxy with proper environment
    const env = { ...process.env };
    
    // Set DYLD_LIBRARY_PATH to find bundled libs
    const libPath = getBundledLibPath();
    if (libPath) {
      env.DYLD_LIBRARY_PATH = libPath + ':' + (env.DYLD_LIBRARY_PATH || '');
      log(`Set DYLD_LIBRARY_PATH: ${libPath}`);
    }
    
    iproxyProcess = spawn(iproxyPath, ['8100:8100', '-u', deviceId], {
      env,
      stdio: 'ignore',
      detached: false
    });
    
    currentDeviceId = deviceId;
    
    // Handle process events
    iproxyProcess.on('error', (err) => {
      log(`✗ iproxy process error: ${err.message}`);
      iproxyProcess = null;
      currentDeviceId = null;
    });
    
    iproxyProcess.on('exit', (code) => {
      log(`iproxy exited with code: ${code}`);
      iproxyProcess = null;
      currentDeviceId = null;
    });
    
    // Wait for iproxy to start
    await new Promise((resolve) => setTimeout(resolve, 1500));
    
    const running = await isIproxyRunning();
    if (!running) {
      log(`✗ iproxy failed to start`);
      iproxyProcess = null;
      currentDeviceId = null;
      return false;
    }
    
    log(`✓ iproxy started successfully on port 8100`);
    return true;
  } catch (e) {
    log(`✗ Failed to start iproxy: ${e instanceof Error ? e.message : String(e)}`);
    iproxyProcess = null;
    currentDeviceId = null;
    return false;
  }
}

export async function ensureIproxyConnection(): Promise<{ connected: boolean; deviceId: string | null }> {
  const deviceId = await getConnectedDevice();
  
  if (!deviceId) {
    if (currentDeviceId !== null) {
      log('Device disconnected, stopping iproxy');
      await stopIproxy();
      currentDeviceId = null;
    }
    return { connected: false, deviceId: null };
  }
  
  const running = await isIproxyRunning();
  
  // If device changed or iproxy not running, check connection
  if (!running || currentDeviceId !== deviceId) {
    if (currentDeviceId !== deviceId && currentDeviceId !== null) {
      log(`Device changed: ${currentDeviceId} → ${deviceId}`);
    } else if (!running) {
      log('iproxy not running. User must start manually: iproxy 8100:8100');
    }
    const started = await startIproxy(deviceId);
    return { connected: started, deviceId: started ? deviceId : null };
  }
  
  return { connected: true, deviceId };
}

export function getCurrentDeviceId(): string | null {
  return currentDeviceId;
}
