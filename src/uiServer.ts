import http from 'http';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { execFileSync } from 'child_process';
import { parse as parseUrl } from 'url';
import { parseString } from 'xml2js';
import { loadWdaConfig, loadLauncherConfig } from './config';
import { launchWda, stopWda, launchStatus } from './wdaLauncher';
import { createFileLogger, combineLoggers, Logger } from './logging';
import { WdaService } from './service';
import { captureAndNormalize } from './captureAdapter';
import { ensureIproxyConnection, getConnectedDevice } from './iproxyManager';
import { geminiGenerateCode, geminiOcr } from './gemini';
import { addManualWifiDevice, removeManualWifiDevice } from './deviceList';
import { WdaClient } from './wdaClient';
import { extractZipBase64, resolveBundleFiles } from './loadZip';
import {
  clearGeminiKey,
  loadSettings,
  readGeminiKey,
  resolveGeminiModel,
  saveGeminiModel,
  storeGeminiKey
} from './secureStore';

function resolveLogDir(): string {
  if (process.platform === 'darwin') {
    return path.join(os.homedir(), 'Documents', 'GroundView_log');
  }
  return path.join(os.homedir(), 'GroundView_log');
}

const LOG_DIR = resolveLogDir();
try {
  fs.mkdirSync(LOG_DIR, { recursive: true });
} catch {
  // ignore
}

const LOG_FILE = path.join(LOG_DIR, 'groundview-ios.log');
const mainLogger = createFileLogger(LOG_FILE);

function log(message: string) {
  const timestamp = new Date().toISOString();
  const logMessage = `[${timestamp}] ${message}`;
  console.log(logMessage);
  mainLogger(logMessage);
}

log('=== GroundView iOS Server Starting ===');
log('Log file: ' + LOG_FILE);

const cfg = loadWdaConfig();
log('Config loaded: ' + JSON.stringify(cfg.options));

const launcherCfg = loadLauncherConfig();
log('Launcher config: ' + JSON.stringify({
  pymobiledevice3Path: launcherCfg.pymobiledevice3Path,
  iproxyPath: launcherCfg.iproxyPath,
  tunneldPort: launcherCfg.tunneldPort,
  wdaPort: launcherCfg.wdaPort,
  runnerBundleId: launcherCfg.runnerBundleId,
}));

const service = new WdaService(cfg.options);
const logger: Logger | undefined = cfg.logFile ? createFileLogger(cfg.logFile) : undefined;

// WiFi WDA client cache (keyed by IP address)
const wifiClients = new Map<string, WdaClient>();

function getWifiWdaClient(ip: string): WdaClient {
  let client = wifiClients.get(ip);
  if (!client) {
    client = new WdaClient({ ...cfg.options, host: ip, port: cfg.options.port ?? 8100 });
    wifiClients.set(ip, client);
    log(`Created WiFi WDA client for ${ip}:${cfg.options.port ?? 8100}`);
  }
  return client;
}

// Track active WiFi connection
let activeWifiIp: string | null = null;

const serverPort = Number(process.env.UI_PORT || 4321);
log('Server port: ' + serverPort);

function sanitizeName(value: string): string {
  const cleaned = value.replace(/[^a-zA-Z0-9._-]+/g, '_').replace(/^_+|_+$/g, '');
  return cleaned || 'capture';
}

function exportsRoot(): string {
  if (process.platform === 'darwin') {
    return path.join(os.homedir(), 'Documents', 'GroundView iOS', 'exports');
  }
  return path.join(os.homedir(), '.groundview-ios', 'exports');
}

function ensureExportsRoot(): string {
  const root = exportsRoot();
  try {
    fs.mkdirSync(root, { recursive: true });
  } catch {
    // ignore
  }
  return root;
}

function ensureZipPath(targetPath: string): string {
  const trimmed = targetPath.trim();
  if (!trimmed) return trimmed;
  return trimmed.toLowerCase().endsWith('.zip') ? trimmed : `${trimmed}.zip`;
}

function createCaptureBundleInDir(
  outDir: string,
  params: {
    screenshotPath: string;
    xmlPath: string;
    deviceId: string;
    tree?: any;
  }
): { dir: string; files: { screenshot: string; xml: string } } {
  const screenshotExt = path.extname(params.screenshotPath) || '.png';
  const xmlExt = path.extname(params.xmlPath) || '.xml';
  const screenshotName = `screenshot${screenshotExt}`;
  const xmlName = `source${xmlExt}`;
  fs.copyFileSync(params.screenshotPath, path.join(outDir, screenshotName));
  fs.copyFileSync(params.xmlPath, path.join(outDir, xmlName));

  if (params.tree) {
    fs.writeFileSync(path.join(outDir, 'tree.json'), JSON.stringify(params.tree, null, 2), 'utf8');
  }
  const meta = {
    savedAt: new Date().toISOString(),
    deviceId: params.deviceId,
    screenshot: screenshotName,
    xml: xmlName,
    sourceScreenshotPath: params.screenshotPath,
    sourceXmlPath: params.xmlPath
  };
  fs.writeFileSync(path.join(outDir, 'meta.json'), JSON.stringify(meta, null, 2), 'utf8');

  return { dir: outDir, files: { screenshot: screenshotName, xml: xmlName } };
}

function createCaptureBundle(params: {
  screenshotPath: string;
  xmlPath: string;
  deviceId: string;
  tree?: any;
}): { dir: string; files: { screenshot: string; xml: string } } {
  const baseDir = ensureExportsRoot();
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const dirName = `${stamp}_${sanitizeName(params.deviceId)}`;
  const outDir = path.join(baseDir, dirName);
  fs.mkdirSync(outDir, { recursive: true });

  return createCaptureBundleInDir(outDir, params);
}

function zipDirectory(sourceDir: string, targetZipPath: string): void {
  const zipBin = process.platform === 'darwin' ? '/usr/bin/zip' : 'zip';
  execFileSync(zipBin, ['-r', targetZipPath, '.'], { cwd: sourceDir });
}

// Auto-check iproxy connection every 3 seconds
let lastDeviceId: string | null = null;
let connectionCheckCount = 0;

setInterval(async () => {
  try {
    connectionCheckCount++;
    const result = await ensureIproxyConnection();
    
    if (result.connected && result.deviceId !== lastDeviceId) {
      if (lastDeviceId === null) {
        log(`✓ Device connected: ${result.deviceId}`);
      } else {
        log(`⚠ Device changed: ${lastDeviceId} → ${result.deviceId}`);
      }
      lastDeviceId = result.deviceId;
    } else if (!result.connected && lastDeviceId !== null) {
      log(`✗ Device disconnected: ${lastDeviceId}`);
      lastDeviceId = null;
    }
    
    // Log status every 20 checks (1 minute)
    if (connectionCheckCount % 20 === 0) {
      log(`Status check #${connectionCheckCount}: ${result.connected ? '✓ Connected' : '✗ Disconnected'} ${result.deviceId || ''}`);
    }
  } catch (e) {
    log(`✗ Connection check error: ${e instanceof Error ? e.message : String(e)}`);
  }
}, 3000);

// Initial connection check
(async () => {
  log('Checking initial device connection...');
  try {
    const result = await ensureIproxyConnection();
    if (result.connected) {
      log(`✓ iproxy connected to device: ${result.deviceId}`);
      lastDeviceId = result.deviceId;
    } else {
      log('⚠ No iOS device connected. Waiting for device...');
      log('Please connect iPhone and ensure WDA is running.');
    }
  } catch (e) {
    log(`✗ Initial connection check failed: ${e instanceof Error ? e.message : String(e)}`);
  }
})();

const INDEX_HTML = `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <title>GroundView iOS</title>
  <style>
    body { background:#0b1221; color:#e5e7eb; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; margin:0; padding:24px; }
    .card { background:#0e1726; border:1px solid #1f2937; border-radius:12px; padding:16px; margin-bottom:16px; }
    button { background:#2563eb; color:#fff; border:none; border-radius:8px; padding:10px 14px; cursor:pointer; font-weight:700; }
    input, select { background:#0b1221; color:#e5e7eb; border:1px solid #1f2937; border-radius:8px; padding:8px 10px; }
    pre { background:#0b1221; border:1px solid #1f2937; border-radius:8px; padding:10px; overflow:auto; max-height:200px; }
    a { color:#93c5fd; }
  </style>
</head>
<body>
  <h2>GroundView iOS (WDA)</h2>
  <div class="card">
    <div style="display:flex;gap:12px;align-items:center;flex-wrap:wrap;">
      <button onclick="checkHealth()">Check WDA</button>
      <div id="health">-</div>
    </div>
  </div>
  <div class="card">
    <div style="display:flex;gap:12px;align-items:center;flex-wrap:wrap;margin-bottom:8px;">
      <button onclick="loadDevices()">List Devices</button>
      <select id="deviceSelect"></select>
      <button onclick="capture()">Capture</button>
      <span id="status"></span>
    </div>
    <pre id="result"></pre>
  </div>
  <script>
    async function checkHealth() {
      const res = await fetch('/api/health').then(r => r.json());
      document.getElementById('health').textContent = (res.ok ? 'OK' : 'FAIL') + ' ' + (res.details || '');
    }
    async function loadDevices() {
      const res = await fetch('/api/devices').then(r => r.json());
      const sel = document.getElementById('deviceSelect');
      sel.innerHTML = '';
      res.forEach(d => {
        const opt = document.createElement('option');
        opt.value = d.id;
        opt.textContent = d.name ? d.name + ' (' + d.id + ')' : d.id;
        sel.appendChild(opt);
      });
      document.getElementById('status').textContent = 'devices: ' + res.length;
    }
    async function capture() {
      const sel = document.getElementById('deviceSelect');
      const id = sel.value;
      if (!id) { alert('Select device'); return; }
      document.getElementById('status').textContent = 'capturing...';
      const res = await fetch('/api/capture', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ deviceId:id }) }).then(r => r.json());
      document.getElementById('result').textContent = JSON.stringify(res, null, 2);
      document.getElementById('status').textContent = res.status || (res.error ? 'error' : 'ok');
    }
    checkHealth(); loadDevices();
  </script>
</body>
</html>`;

function sendJson(res: http.ServerResponse, body: any, status = 200) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.end(JSON.stringify(body));
}

function sendHtml(res: http.ServerResponse, html: string) {
  res.statusCode = 200;
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.end(html);
}

async function parseXmlToTree(xml: string): Promise<any> {
  return new Promise((resolve, reject) => {
    log(`[parseXmlToTree] Starting parse, XML length: ${xml.length} chars`);
    log(`[parseXmlToTree] XML preview: ${xml.substring(0, 150)}...`);
    
    parseString(xml, { explicitArray: false, mergeAttrs: true }, (err, result) => {
      if (err) {
        console.error('[parseXmlToTree] Parse error:', err);
        reject(err);
        return;
      }
      
      console.log('[parseXmlToTree] Parsed. Root keys:', Object.keys(result));
      
      const transform = (node: any, elementType?: string, depth = 0): any => {
        if (!node || typeof node !== 'object') return null;
        
        // Extract attributes (they're merged into the node object)
        const output: any = {
          type: elementType || node.type || 'Unknown',
          name: node.name || undefined,
          label: node.label || undefined,
          value: node.value || undefined,
          enabled: node.enabled || undefined,
          visible: node.visible || undefined,
          accessible: node.accessible || undefined,
          x: node.x || '0',
          y: node.y || '0',
          width: node.width || '0',
          height: node.height || '0',
          index: node.index || undefined,
          traits: node.traits || undefined,
        };
        
        // Collect all child elements (all keys starting with XCUIElementType)
        const children: any[] = [];
        const nodeKeys = Object.keys(node);
        
        if (depth < 3) {
          console.log(`[parseXmlToTree] Depth ${depth}, type ${elementType}, keys:`, nodeKeys.filter(k => k.startsWith('XCUI')));
        }
        
        for (const key of nodeKeys) {
          // Skip attribute keys
          if (!key.startsWith('XCUIElementType')) continue;
          
          const childOrChildren = node[key];
          
          // Handle both single element and array of elements
          if (Array.isArray(childOrChildren)) {
            if (depth < 3) console.log(`[parseXmlToTree]   Found array of ${childOrChildren.length} ${key}`);
            for (const child of childOrChildren) {
              const transformed = transform(child, key, depth + 1);
              if (transformed) children.push(transformed);
            }
          } else if (childOrChildren && typeof childOrChildren === 'object') {
            if (depth < 3) console.log(`[parseXmlToTree]   Found single ${key}`);
            const transformed = transform(childOrChildren, key, depth + 1);
            if (transformed) children.push(transformed);
          }
        }
        
        if (children.length > 0) {
          output.children = children;
        }
        
        return output;
      };
      
      // Find the root element
      let root = null;
      if (result.AppiumAUT) {
        root = result.AppiumAUT;
      } else if (result.XCUIElementTypeApplication) {
        root = result.XCUIElementTypeApplication;
      } else {
        // Try to find any XCUIElement type
        const keys = Object.keys(result);
        for (const key of keys) {
          if (key.startsWith('XCUIElement')) {
            root = result[key];
            break;
          }
        }
      }
      
      if (!root) {
        console.error('[parseXmlToTree] No root element found!');
        reject(new Error('Could not find root element'));
        return;
      }
      
      const transformed = transform(root, 'XCUIElementTypeApplication', 0);
      
      // Count nodes
      const countNodes = (n: any): number => {
        if (!n) return 0;
        let c = 1;
        if (n.children) for (const ch of n.children) c += countNodes(ch);
        return c;
      };
      
      const total = countNodes(transformed);
      log(`[parseXmlToTree] ✓ Parse complete. Total nodes: ${total}`);
      
      resolve(transformed);
    });
  });
}

async function handleApi(req: http.IncomingMessage, res: http.ServerResponse) {
  const parsed = parseUrl(req.url || '', true);
  const pathName = parsed.pathname || '';
  log(`${req.method} ${pathName}`);
  
  // Set CORS headers on ALL responses
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  
  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    res.end();
    return;
  }
  if (pathName === '/api/health') {
    // Try WiFi connection first if active
    if (activeWifiIp) {
      const wifiClient = getWifiWdaClient(activeWifiIp);
      const wifiHealth = await wifiClient.health();
      if (wifiHealth.ok) {
        log(`Health check (WiFi ${activeWifiIp}): OK - ${wifiHealth.details || ''}`);
        sendJson(res, { ...wifiHealth, connectionType: 'wifi', ip: activeWifiIp });
        return;
      }
      log(`WiFi health failed for ${activeWifiIp}: ${wifiHealth.details}, trying USB`);
    }
    // Fall back to USB/iproxy
    const conn = await ensureIproxyConnection();
    const health = await service.health();
    log(`Health check (USB): conn=${conn.connected} ${health.ok ? 'OK' : 'FAIL'} - ${health.details || ''}`);
    sendJson(res, { ...health, connectionType: 'usb' });
    return;
  }
  if (pathName === '/api/devices') {
    // Ensure iproxy is connected for USB devices
    await ensureIproxyConnection();
    const devices = await service.listDevices();
    sendJson(res, devices);
    return;
  }
  if (pathName === '/api/wda/status') {
    const udid = String(parsed.query?.deviceId || parsed.query?.udid || '') || (await getConnectedDevice()) || '';
    if (!udid) { sendJson(res, { ok: false, error: 'no device' }, 200); return; }
    try {
      const st = await launchStatus(udid, launcherCfg);
      sendJson(res, { ok: true, udid, ...st });
    } catch (e) {
      sendJson(res, { ok: false, error: e instanceof Error ? e.message : String(e) }, 500);
    }
    return;
  }
  if (pathName === '/api/wda/launch' && req.method === 'POST') {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', async () => {
      try {
        const b = body ? JSON.parse(body) : {};
        const udid = String(b.deviceId || b.udid || '') || (await getConnectedDevice()) || '';
        if (!udid) { sendJson(res, { ok: false, error: 'deviceId required' }, 400); return; }
        // WDA launch addresses the device by UDID (USB or Xcode-wireless).
        // Reject manually-registered WiFi IP devices, which already reach a
        // running WDA directly by IP.
        if (/^\d{1,3}(\.\d{1,3}){3}(:\d+)?$/.test(udid) || udid.startsWith('wifi-')) {
          sendJson(res, { ok: false, error: '이 기기는 이미 IP로 WDA에 직접 연결됩니다. WDA 실행은 UDID 기기(USB/무선)에서 사용하세요.' }, 400);
          return;
        }
        log(`[wda] launch requested for ${udid}`);
        const result = await launchWda(udid, launcherCfg, log);
        // Wireless: no iproxy/localhost. Register the device LAN IP so the app's
        // health/capture path talks to WDA directly at <ip>:<port>.
        if (result.ok && result.transport === 'wireless' && result.deviceIp) {
          try {
            addManualWifiDevice(result.deviceIp, `WDA (${result.deviceIp})`);
            activeWifiIp = result.deviceIp;
            log(`[wda] wireless: activated WiFi WDA at ${result.deviceIp}`);
          } catch (e) {
            log(`[wda] wireless registration failed: ${e instanceof Error ? e.message : String(e)}`);
          }
        } else if (result.ok && result.transport === 'usb') {
          // USB path uses iproxy/127.0.0.1; clear any stale WiFi override.
          activeWifiIp = null;
        }
        sendJson(res, result);
      } catch (e) {
        sendJson(res, { ok: false, error: e instanceof Error ? e.message : String(e) }, 500);
      }
    });
    return;
  }
  if (pathName === '/api/wda/stop' && req.method === 'POST') {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', async () => {
      try {
        const b = body ? JSON.parse(body) : {};
        const udid = String(b.deviceId || b.udid || '') || (await getConnectedDevice()) || '';
        if (!udid) { sendJson(res, { ok: false, error: 'deviceId required' }, 400); return; }
        const r = await stopWda(udid, launcherCfg);
        sendJson(res, r);
      } catch (e) {
        sendJson(res, { ok: false, error: e instanceof Error ? e.message : String(e) }, 500);
      }
    });
    return;
  }
  if (pathName === '/api/settings' && req.method === 'GET') {
    const key = await readGeminiKey();
    const model = resolveGeminiModel();
    const settings = loadSettings();
    sendJson(res, {
      ok: true,
      gemini: {
        enabled: !!key,
        model: settings.geminiModel || model
      }
    });
    return;
  }
  if (pathName === '/api/settings/gemini' && req.method === 'POST') {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
    });
    req.on('end', async () => {
      try {
        const parsedBody = body ? JSON.parse(body) : {};
        const hasApiKeyField = Object.prototype.hasOwnProperty.call(parsedBody, 'apiKey');
        const apiKey = hasApiKeyField && typeof parsedBody.apiKey === 'string' ? parsedBody.apiKey.trim() : '';
        const model = typeof parsedBody.model === 'string' ? parsedBody.model.trim() : '';
        if (parsedBody.clear || (hasApiKeyField && !apiKey)) {
          await clearGeminiKey();
          saveGeminiModel(model || resolveGeminiModel());
          sendJson(res, { ok: true, enabled: false, model: resolveGeminiModel() });
          return;
        }
        if (apiKey) {
          await storeGeminiKey(apiKey);
        }
        saveGeminiModel(model || resolveGeminiModel());
        const key = await readGeminiKey();
        sendJson(res, { ok: true, enabled: !!key, model: resolveGeminiModel() });
      } catch (e) {
        sendJson(res, { ok: false, error: e instanceof Error ? e.message : String(e) }, 500);
      }
    });
    return;
  }
  if (pathName === '/api/capture' && req.method === 'POST') {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
    });
    req.on('end', async () => {
      try {
        const parsedBody = body ? JSON.parse(body) : {};
        const deviceId = parsedBody.deviceId || parsed.query?.deviceId || parsed.query?.device;
        if (!deviceId) {
          log(`Capture failed: no deviceId provided`);
          sendJson(res, { error: 'deviceId required' }, 400);
          return;
        }
        log(`Capture requested for device: ${deviceId}`);
        
        // Check if this is a WiFi device
        const devices = await service.listDevices();
        const device = devices.find(d => d.id === deviceId);
        const isWifi = device?.connectionType === 'wifi' && device?.ipAddress;
        
        if (isWifi && device?.ipAddress) {
          // WiFi capture: use direct IP connection, no iproxy needed
          log(`WiFi capture for ${device.name} at ${device.ipAddress}`);
          const wifiClient = getWifiWdaClient(device.ipAddress);
          const wifiHealth = await wifiClient.health();
          if (!wifiHealth.ok) {
            log(`✗ WiFi WDA not reachable at ${device.ipAddress}: ${wifiHealth.details}`);
            sendJson(res, { error: `WiFi WDA not reachable at ${device.ipAddress}. Ensure WDA is running on the device.` }, 500);
            return;
          }
          log(`✓ WiFi WDA ready at ${device.ipAddress}`);
          const captureLogger = logger ? combineLoggers(logger, mainLogger) : mainLogger;
          const wifiOpts = { ...cfg.options, host: device.ipAddress, port: cfg.options.port ?? 8100 };
          const cap = await captureAndNormalize(deviceId, wifiOpts, { log: captureLogger });
          if (cap.error) {
            log(`✗ WiFi capture failed: ${cap.error}`);
          } else {
            log(`✓ WiFi capture success: screenshot=${cap.screenshotPath}, xml=${cap.xmlPath}`);
          }
          sendJson(res, cap);
          return;
        }
        
        // USB capture: use iproxy
        const connection = await ensureIproxyConnection();
        if (!connection.connected) {
          log(`✗ Capture failed: no device connected`);
          sendJson(res, { error: 'No iOS device connected. Please connect device and ensure WDA is running.' }, 500);
          return;
        }
        log(`✓ Device ready for capture: ${connection.deviceId}`);
        const captureLogger = logger ? combineLoggers(logger, mainLogger) : mainLogger;
        const cap = await captureAndNormalize(deviceId, cfg.options, { log: captureLogger });
        
        if (cap.error) {
          log(`✗ Capture failed: ${cap.error}`);
        } else {
          log(`✓ Capture success: screenshot=${cap.screenshotPath}, xml=${cap.xmlPath}`);
        }
        
        sendJson(res, cap);
      } catch (e) {
        sendJson(res, { error: e instanceof Error ? e.message : String(e) }, 500);
      }
    });
    return;
  }
  if (pathName === '/api/parse' && req.method === 'POST') {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
    });
    req.on('end', async () => {
      try {
        const parsedBody = body ? JSON.parse(body) : {};
        const { screenshotPath, xmlPath } = parsedBody;
        if (!screenshotPath || !xmlPath) {
          log(`Parse failed: missing paths`);
          sendJson(res, { error: 'screenshotPath and xmlPath required' }, 400);
          return;
        }
        log(`Parse requested: screenshot=${screenshotPath}, xml=${xmlPath}`);
        const screenshotBuffer = fs.readFileSync(screenshotPath);
        const screenshotBase64 = `data:image/png;base64,${screenshotBuffer.toString('base64')}`;
        
        // Read XML file (which is already plain XML, not JSON)
        let xmlContent = fs.readFileSync(xmlPath, 'utf8');
        
        // Try to extract XML from JSON wrapper if present
        try {
          const possibleJson = JSON.parse(xmlContent);
          if (possibleJson.value && typeof possibleJson.value === 'string') {
            xmlContent = possibleJson.value;
          }
        } catch (e) {
          // Not JSON, already plain XML
        }
        
        const tree = await parseXmlToTree(xmlContent);
        
        // Debug: Save tree structure to file for inspection
        const treeDebugPath = path.join(LOG_DIR, 'tree-debug.json');
        fs.writeFileSync(treeDebugPath, JSON.stringify(tree, null, 2));
        log(`✓ Tree structure saved to: ${treeDebugPath}`);
        
        const responseData = { screenshot: screenshotBase64, tree };
        const responseJson = JSON.stringify(responseData);
        log(`✓ Parse complete. Response size: ${responseJson.length} bytes, Tree node count from root: ${tree.children?.length || 0}`);
        
        sendJson(res, responseData);
      } catch (e) {
        sendJson(res, { error: e instanceof Error ? e.message : String(e) }, 500);
      }
    });
    return;
  }
  if (pathName === '/api/save' && req.method === 'POST') {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
    });
    req.on('end', async () => {
      try {
        const parsedBody = body ? JSON.parse(body) : {};
        const screenshotPath = parsedBody.screenshotPath;
        const xmlPath = parsedBody.xmlPath;
        const deviceId = typeof parsedBody.deviceId === 'string' ? parsedBody.deviceId : 'device';
        const tree = parsedBody.tree;

        if (!screenshotPath || !xmlPath) {
          sendJson(res, { ok: false, error: 'screenshotPath and xmlPath required' }, 400);
          return;
        }
        if (!fs.existsSync(screenshotPath) || !fs.existsSync(xmlPath)) {
          sendJson(res, { ok: false, error: 'capture files not found' }, 404);
          return;
        }

        const bundle = createCaptureBundle({ screenshotPath, xmlPath, deviceId, tree });
        sendJson(res, { ok: true, dir: bundle.dir });
      } catch (e) {
        sendJson(res, { ok: false, error: e instanceof Error ? e.message : String(e) }, 500);
      }
    });
    return;
  }
  if (pathName === '/api/save-zip' && req.method === 'POST') {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
    });
    req.on('end', async () => {
      try {
        const parsedBody = body ? JSON.parse(body) : {};
        const screenshotPath = parsedBody.screenshotPath;
        const xmlPath = parsedBody.xmlPath;
        const deviceId = typeof parsedBody.deviceId === 'string' ? parsedBody.deviceId : 'device';
        const tree = parsedBody.tree;
        const targetPathRaw = typeof parsedBody.targetPath === 'string' ? parsedBody.targetPath : '';

        if (!screenshotPath || !xmlPath) {
          sendJson(res, { ok: false, error: 'screenshotPath and xmlPath required' }, 400);
          return;
        }
        if (!targetPathRaw) {
          sendJson(res, { ok: false, error: 'targetPath required' }, 400);
          return;
        }
        if (!fs.existsSync(screenshotPath) || !fs.existsSync(xmlPath)) {
          sendJson(res, { ok: false, error: 'capture files not found' }, 404);
          return;
        }

        const targetPath = ensureZipPath(targetPathRaw);
        fs.mkdirSync(path.dirname(targetPath), { recursive: true });

        const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'groundview-ios-'));
        const bundle = createCaptureBundleInDir(tempRoot, { screenshotPath, xmlPath, deviceId, tree });
        zipDirectory(bundle.dir, targetPath);
        try {
          fs.rmSync(tempRoot, { recursive: true, force: true });
        } catch {
          // ignore cleanup errors
        }

        sendJson(res, { ok: true, file: targetPath });
      } catch (e) {
        sendJson(res, { ok: false, error: e instanceof Error ? e.message : String(e) }, 500);
      }
    });
    return;
  }
  if (pathName === '/api/load-zip' && req.method === 'POST') {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
    });
    req.on('end', async () => {
      let outDir = '';
      try {
        const parsedBody = body ? JSON.parse(body) : {};
        const zipBase64 = typeof parsedBody.zipBase64 === 'string' ? parsedBody.zipBase64 : '';
        if (!zipBase64) {
          sendJson(res, { ok: false, error: 'zipBase64 required' }, 400);
          return;
        }

        outDir = extractZipBase64(zipBase64);
        const { screenshotPath, xmlPath, deviceId } = resolveBundleFiles(outDir);

        const screenshotBuffer = fs.readFileSync(screenshotPath);
        const screenshot = `data:image/png;base64,${screenshotBuffer.toString('base64')}`;

        let xmlContent = fs.readFileSync(xmlPath, 'utf8');
        // XML may be wrapped in a JSON envelope ({ value: "<xml>" }) — unwrap it.
        try {
          const possibleJson = JSON.parse(xmlContent);
          if (possibleJson && typeof possibleJson.value === 'string') {
            xmlContent = possibleJson.value;
          }
        } catch {
          // already plain XML
        }
        const tree = await parseXmlToTree(xmlContent);

        log(`✓ Load-zip complete: device=${deviceId}, root children=${tree.children?.length || 0}`);
        sendJson(res, { ok: true, screenshot, tree, metadata: { deviceId } });
      } catch (e) {
        sendJson(res, { ok: false, error: e instanceof Error ? e.message : String(e) }, 500);
      } finally {
        if (outDir) {
          try {
            fs.rmSync(path.dirname(outDir), { recursive: true, force: true });
          } catch {
            // ignore cleanup errors
          }
        }
      }
    });
    return;
  }
  if (pathName === '/api/gemini/code' && req.method === 'POST') {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
    });
    req.on('end', async () => {
      try {
        const parsedBody = body ? JSON.parse(body) : {};
        const node = parsedBody.node;
        if (!node) {
          sendJson(res, { ok: false, error: 'node required' }, 400);
          return;
        }
        const result = await geminiGenerateCode({
          node,
          appiumVersion: parsedBody.appiumVersion,
          lang: parsedBody.lang,
          screenshotPath: parsedBody.screenshotPath,
          bounds: parsedBody.bounds
        });
        sendJson(res, result, result.ok ? 200 : 500);
      } catch (e) {
        sendJson(res, { ok: false, error: e instanceof Error ? e.message : String(e) }, 500);
      }
    });
    return;
  }
  if (pathName === '/api/gemini/ocr' && req.method === 'POST') {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
    });
    req.on('end', async () => {
      try {
        const parsedBody = body ? JSON.parse(body) : {};
        const screenshotPath = parsedBody.screenshotPath;
        if (!screenshotPath) {
          sendJson(res, { ok: false, error: 'screenshotPath required' }, 400);
          return;
        }
        const result = await geminiOcr({
          screenshotPath,
          bounds: parsedBody.bounds
        });
        sendJson(res, result, result.ok ? 200 : 500);
      } catch (e) {
        sendJson(res, { ok: false, error: e instanceof Error ? e.message : String(e) }, 500);
      }
    });
    return;
  }
  if (pathName === '/api/wifi/connect' && req.method === 'POST') {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
    });
    req.on('end', async () => {
      try {
        log(`WiFi connect body: ${body}`);
        const parsedBody = body ? JSON.parse(body) : {};
        const ip = typeof parsedBody.ip === 'string' ? parsedBody.ip.trim() : '';
        const name = typeof parsedBody.name === 'string' ? parsedBody.name.trim() : '';
        if (!ip) {
          sendJson(res, { ok: false, error: 'ip required' }, 400);
          return;
        }
        if (!/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(ip)) {
          sendJson(res, { ok: false, error: 'Invalid IP address format' }, 400);
          return;
        }
        const port = cfg.options.port ?? 8100;
        log(`WiFi connect request: ${ip}:${port} (${name || 'unnamed'})`);
        
        // Test WDA connection at this IP with short timeout
        const testClient = new WdaClient({ host: ip, port, timeoutMs: 3000 });
        const health = await testClient.health();
        log(`WiFi WDA test result: ok=${health.ok} details=${health.details}`);
        
        if (!health.ok) {
          sendJson(res, { ok: false, error: `WDA not reachable at ${ip}:${port}. ${health.details || ''}` });
          return;
        }
        
        // Register the device and activate WiFi mode
        const device = addManualWifiDevice(ip, name || `WiFi Device (${ip})`);
        activeWifiIp = ip;
        log(`✓ WiFi device registered: ${device.name} at ${ip}`);
        sendJson(res, { ok: true, device, health });
      } catch (e) {
        log(`✗ WiFi connect error: ${e instanceof Error ? e.message : String(e)}`);
        sendJson(res, { ok: false, error: e instanceof Error ? e.message : String(e) }, 500);
      }
    });
    return;
  }
  if (pathName === '/api/wifi/disconnect' && req.method === 'POST') {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
    });
    req.on('end', async () => {
      try {
        const parsedBody = body ? JSON.parse(body) : {};
        const ip = typeof parsedBody.ip === 'string' ? parsedBody.ip.trim() : activeWifiIp || '';
        if (ip) {
          removeManualWifiDevice(ip);
          wifiClients.delete(ip);
          if (activeWifiIp === ip) activeWifiIp = null;
          log(`WiFi device disconnected: ${ip}`);
        }
        sendJson(res, { ok: true });
      } catch (e) {
        sendJson(res, { ok: false, error: e instanceof Error ? e.message : String(e) }, 500);
      }
    });
    return;
  }
  res.statusCode = 404;
  res.end('not found');
}

const server = http.createServer((req, res) => {
  const parsed = parseUrl(req.url || '', true);
  if (parsed.pathname && parsed.pathname.startsWith('/api/')) {
    handleApi(req, res).catch((e) => {
      sendJson(res, { error: e instanceof Error ? e.message : String(e) }, 500);
    });
    return;
  }
  sendHtml(res, INDEX_HTML);
});

server.on('error', (err: NodeJS.ErrnoException) => {
  if (err.code === 'EADDRINUSE') {
    log(`✗ Port ${serverPort} already in use. Close the existing server or change UI_PORT.`);
    return;
  }
  log(`✗ Server error: ${err.message}`);
});

server.listen(serverPort, () => {
  const msg = `UI server running at http://localhost:${serverPort}`;
  log(msg);
  log('=== Server Ready ===');
  if (logger) logger(msg);
});
