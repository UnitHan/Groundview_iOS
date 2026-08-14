import React, { useRef, useState } from 'react';
import { useStore } from './store';
import { useT } from './i18n';
import { colors, pressableStyle, pressableHandlers } from './theme';
import geminiLogo from './gemini.png';

const API_BASE = 'http://localhost:4321';

type TrafficLight = 'red' | 'yellow' | 'green';
const LIGHT_COLORS: Record<TrafficLight, string> = {
  red: '#ef4444',
  yellow: '#f59e0b',
  green: '#22c55e',
};

export function DevicesPage() {
  const {
    health, devices, selectedDeviceId, capturing,
    setSelectedDeviceId, setPage, setCaptureResult, setParsedCapture, setCapturing,
    lang, setLang,
  } = useStore();
  const t = useT();
  const [wifiIp, setWifiIp] = useState('');
  const [wifiName, setWifiName] = useState('');
  const [wifiConnecting, setWifiConnecting] = useState(false);
  const [wifiError, setWifiError] = useState('');
  const [loadingZip, setLoadingZip] = useState(false);
  const [zipError, setZipError] = useState('');
  const [launching, setLaunching] = useState(false);
  const [launchMsg, setLaunchMsg] = useState<{ text: string; hint?: string; kind: 'ok' | 'err' } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const light: TrafficLight = !health?.ok
    ? 'red'
    : devices.length === 0
    ? 'yellow'
    : 'green';

  const isIp = (s: string) => /^\d{1,3}(\.\d{1,3}){3}(:\d+)?$/.test(s);
  // WDA can be launched (via tunneld) for any real device addressed by UDID —
  // USB or Xcode-wireless alike. Excludes manually-registered WiFi IP devices,
  // which already reach a running WDA directly by IP.
  const canLaunchWda =
    !!selectedDeviceId && !isIp(selectedDeviceId) && !selectedDeviceId.startsWith('wifi-');

  const runParse = async (screenshotPath: string, xmlPath: string, deviceId: string) => {
    const parseRes = await fetch(`${API_BASE}/api/parse`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ screenshotPath, xmlPath }),
    });
    const parsed = await parseRes.json();
    if (parsed?.error || !parsed?.tree) {
      throw new Error(parsed?.error || 'tree missing');
    }
    setParsedCapture({ screenshot: parsed.screenshot, tree: parsed.tree, deviceId });
    setPage('analyze');
  };

  const handleCapture = async () => {
    if (!selectedDeviceId) {
      alert(t.devices.selectToCapture);
      return;
    }
    setCapturing(true);
    try {
      const res = await fetch(`${API_BASE}/api/capture`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ deviceId: selectedDeviceId }),
      });
      const captureResult = await res.json();
      if (captureResult.error) {
        alert(`Capture failed: ${captureResult.error}`);
        setCapturing(false);
        return;
      }
      setCaptureResult(captureResult);
      await runParse(captureResult.screenshotPath, captureResult.xmlPath, selectedDeviceId);
    } catch (e) {
      console.error('Capture error:', e);
      alert(`Error: ${e}`);
    } finally {
      setCapturing(false);
    }
  };

  const handleLaunchWda = async () => {
    if (!selectedDeviceId) return;
    setLaunching(true);
    setLaunchMsg(null);
    try {
      const res = await fetch(`${API_BASE}/api/wda/launch`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ deviceId: selectedDeviceId }),
      });
      const r = await res.json();
      if (r.ok && r.ready) {
        setLaunchMsg({ text: t.wda.launchOk, kind: 'ok' });
        // Wireless: the UDID card is replaced by the working IP card — select it.
        if (r.transport === 'wireless' && r.wifiDeviceId) {
          setSelectedDeviceId(r.wifiDeviceId);
        }
      } else {
        setLaunchMsg({ text: r.error || 'WDA launch failed', hint: r.hint, kind: 'err' });
      }
    } catch (e) {
      setLaunchMsg({ text: `Error: ${e}`, kind: 'err' });
    } finally {
      setLaunching(false);
    }
  };

  const handleLoadZipClick = () => fileInputRef.current?.click();

  const handleZipSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ''; // allow re-selecting the same file
    if (!file) return;
    setLoadingZip(true);
    setZipError('');
    try {
      const buf = await file.arrayBuffer();
      let binary = '';
      const bytes = new Uint8Array(buf);
      for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
      const zipBase64 = btoa(binary);
      const res = await fetch(`${API_BASE}/api/load-zip`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ zipBase64, fileName: file.name }),
      });
      const result = await res.json();
      if (!result.ok || !result.tree) {
        setZipError(result.error || t.loadZip.failed);
        return;
      }
      const deviceId = result.metadata?.deviceId || 'imported';
      setParsedCapture({ screenshot: result.screenshot, tree: result.tree, deviceId });
      setPage('analyze');
    } catch (err) {
      setZipError(`${t.loadZip.failed}: ${err}`);
    } finally {
      setLoadingZip(false);
    }
  };

  const handleWifiConnect = async () => {
    if (!wifiIp.trim()) return;
    setWifiConnecting(true);
    setWifiError('');
    try {
      const res = await fetch(`${API_BASE}/api/wifi/connect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ip: wifiIp.trim(), name: wifiName.trim() || undefined }),
      });
      const result = await res.json();
      if (!result.ok) {
        setWifiError(result.error || 'Connection failed');
      } else {
        setWifiIp('');
        setWifiName('');
        if (result.device?.id) setSelectedDeviceId(result.device.id);
      }
    } catch (e) {
      setWifiError(`Error: ${e}`);
    } finally {
      setWifiConnecting(false);
    }
  };

  const inputStyle: React.CSSProperties = {
    flex: 1,
    background: '#fff',
    color: '#0f172a',
    border: '1px solid #cbd5e1',
    borderRadius: 8,
    padding: '10px 12px',
    fontSize: 14,
  };

  return (
    <>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <div style={{ fontSize: 28, fontWeight: 800, color: colors.textMain }}>{t.appName}</div>
        <img src={geminiLogo} alt="Gemini AI Logo" style={{ height: 40, objectFit: 'contain', marginLeft: 12 }} />
      </div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
        <div style={{ color: colors.textSub }}>{t.subtitle}</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <button
            onClick={() => setLang(lang === 'ko' ? 'en' : 'ko')}
            style={{
              padding: '6px 12px', borderRadius: 8, border: '1px solid #e2e8f0',
              background: '#fff', color: colors.textSub, cursor: 'pointer', fontWeight: 700,
              fontSize: 13, ...pressableStyle,
            }}
            {...pressableHandlers}
          >
            {t.langToggle}
          </button>
          {/* Traffic light — reflects WDA health */}
          <div
            title={t.devices.status[light]}
            style={{
              width: 28, height: 28, borderRadius: '50%',
              background: LIGHT_COLORS[light],
              border: `2px solid ${LIGHT_COLORS[light]}cc`,
              boxShadow: `0 0 8px ${LIGHT_COLORS[light]}88`,
              flexShrink: 0,
            }}
          />
        </div>
      </div>

      <div style={{ marginTop: 16, display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div style={{ background: colors.cardGreen, border: '1px solid #c8f5d3', borderRadius: 14, padding: 16 }}>
          {/* Section header */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <div style={{ width: 18, height: 18, borderRadius: 4, background: '#22c55e' }} />
                <div style={{ fontSize: 20, fontWeight: 800, color: colors.textMain }}>{t.devices.connected}</div>
              </div>
              <div style={{ color: colors.textSub, marginTop: 6 }}>{t.devices.found(devices.length)}</div>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 6 }}>
              <div style={{
                fontSize: 12, fontWeight: 700,
                color: health?.ok ? '#166534' : '#b91c1c',
                background: health?.ok ? '#dcfce7' : '#fee2e2',
                border: `1px solid ${health?.ok ? '#86efac' : '#fecaca'}`,
                borderRadius: 999, padding: '4px 10px',
              }}>
                {health?.ok
                  ? t.wda.connected(health.connectionType === 'wifi' ? 'WiFi' : 'USB')
                  : t.wda.notConnected}
              </div>
            </div>
          </div>

          {/* Body */}
          <div style={{
            marginTop: 14, background: '#f8fff9', border: '1px dashed #c8f5d3', borderRadius: 12,
            padding: 16, minHeight: 200,
          }}>
            {devices.length === 0 ? (
              <div style={{ textAlign: 'center', color: '#94a3b8', fontWeight: 600, padding: '12px 0' }}>
                <div style={{ fontSize: 32, marginBottom: 4 }}>📱</div>
                {t.devices.noDevices}
                <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 4 }}>{t.devices.noDevicesHint}</div>
                {!health?.ok && (
                  <div style={{
                    marginTop: 16, textAlign: 'left', background: '#fffbeb', border: '1px solid #fcd34d',
                    borderRadius: 10, padding: '12px 14px', color: '#92400e', fontSize: 13, lineHeight: 1.6,
                  }}>
                    <div style={{ fontWeight: 700, marginBottom: 6 }}>{t.wda.setupTitle}</div>
                    <div>{t.wda.setupUsb}</div>
                    <div style={{
                      margin: '6px 0', fontFamily: 'monospace', fontSize: 12, background: '#fef3c7',
                      padding: '4px 8px', borderRadius: 6, userSelect: 'all',
                    }}>
                      iproxy 8100:8100
                    </div>
                    <div>{t.wda.setupWifi}</div>
                  </div>
                )}
              </div>
            ) : (
              <div style={{ width: '100%', textAlign: 'left', color: '#0f172a' }}>
                <div style={{ marginBottom: 10, color: '#475569' }}>{t.devices.selectDevice}</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 12 }}>
                  {devices.map((d) => {
                    const isWireless = d.connectionType === 'wifi' || /^\d{1,3}(\.\d{1,3}){3}(:\d+)?$/.test(d.id);
                    const isSelected = selectedDeviceId === d.id;
                    return (
                      <button
                        key={d.id}
                        onClick={() => setSelectedDeviceId(d.id)}
                        style={{
                          width: '100%', padding: '12px 14px', borderRadius: 10,
                          border: isSelected ? '2px solid #16a34a' : '1px solid #c8f5d3',
                          background: isSelected ? '#dcfce7' : '#fff', cursor: 'pointer',
                          display: 'flex', alignItems: 'center', gap: 10, textAlign: 'left',
                          ...pressableStyle,
                        }}
                        {...pressableHandlers}
                      >
                        <span style={{ fontSize: 20 }}>{isWireless ? '📡' : '📱'}</span>
                        <div style={{ flex: 1 }}>
                          <div style={{ fontWeight: 700, fontSize: 14, color: '#0f172a' }}>{d.name || d.id}</div>
                          <div style={{ fontSize: 11, color: '#64748b', marginTop: 2 }}>
                            {d.id}{isWireless ? ` · ${t.devices.wifi}` : ` · ${t.devices.usb}`}
                          </div>
                        </div>
                        {isSelected && <span style={{ color: '#16a34a', fontWeight: 800, fontSize: 13 }}>✓ Selected</span>}
                      </button>
                    );
                  })}
                </div>

                {selectedDeviceId && (
                  <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 10 }}>
                    {/* WDA 실행 — USB/무선(Xcode wireless) 기기에서 설치된 WDA를 자체 기동 */}
                    {canLaunchWda && !health?.ok && (
                      <>
                        <button
                          onClick={handleLaunchWda}
                          disabled={launching}
                          style={{
                            width: '100%', padding: '14px 12px', borderRadius: 10, border: 'none',
                            background: launching ? '#86efac' : '#16a34a', color: '#fff', fontWeight: 800,
                            cursor: launching ? 'not-allowed' : 'pointer', ...pressableStyle,
                          }}
                          {...pressableHandlers}
                        >
                          {launching ? t.wda.launching : t.wda.launch}
                        </button>
                        {launchMsg && (
                          <div style={{
                            fontSize: 13, lineHeight: 1.6, borderRadius: 10, padding: '10px 12px',
                            color: launchMsg.kind === 'ok' ? '#166534' : '#b91c1c',
                            background: launchMsg.kind === 'ok' ? '#dcfce7' : '#fee2e2',
                            border: `1px solid ${launchMsg.kind === 'ok' ? '#86efac' : '#fecaca'}`,
                          }}>
                            <div style={{ fontWeight: 700 }}>{launchMsg.text}</div>
                            {launchMsg.hint && (
                              <div style={{
                                marginTop: 6, fontFamily: 'monospace', fontSize: 12,
                                background: '#fff', border: '1px solid #fecaca', borderRadius: 6,
                                padding: '4px 8px', userSelect: 'all',
                              }}>
                                {launchMsg.hint}
                              </div>
                            )}
                          </div>
                        )}
                      </>
                    )}
                    {capturing ? (
                      <div style={{
                        background: '#fee2e2', border: '1px solid #fecdd3', padding: 14, borderRadius: 10,
                        color: '#b91c1c', textAlign: 'center', fontWeight: 800,
                      }}>
                        {t.devices.capturing}
                      </div>
                    ) : (
                      <button
                        onClick={handleCapture}
                        style={{
                          width: '100%', padding: '14px 12px', borderRadius: 10, border: 'none',
                          background: '#ef4444', color: '#fff', fontWeight: 800, cursor: 'pointer', ...pressableStyle,
                        }}
                        {...pressableHandlers}
                      >
                        {t.devices.capture}
                      </button>
                    )}
                    <div style={{ color: '#94a3b8', fontSize: 13, textAlign: 'center' }}>
                      {t.devices.readyFrom(selectedDeviceId)}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Load ZIP — device-independent */}
          <input
            ref={fileInputRef}
            type="file"
            accept=".zip"
            style={{ display: 'none' }}
            onChange={handleZipSelected}
          />
          <button
            onClick={handleLoadZipClick}
            disabled={loadingZip}
            style={{
              width: '100%', marginTop: 12, padding: '14px 12px', borderRadius: 10, border: 'none',
              background: loadingZip ? '#93c5fd' : '#2563eb', color: '#fff', fontWeight: 800,
              cursor: loadingZip ? 'not-allowed' : 'pointer', ...pressableStyle,
            }}
            {...pressableHandlers}
          >
            {loadingZip ? '...' : t.devices.loadZip}
          </button>
          {zipError && (
            <div style={{ color: '#b91c1c', fontSize: 13, marginTop: 8 }}>{zipError}</div>
          )}

          {/* WiFi connection (iOS-specific) */}
          <div style={{ marginTop: 12, background: '#fff', border: '1px solid #dbeafe', borderRadius: 12, padding: 14 }}>
            <div style={{ color: colors.textMain, fontWeight: 700, fontSize: 15, marginBottom: 10 }}>{t.wifiBox.title}</div>
            <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
              <input
                type="text"
                placeholder={t.wifiBox.ipPlaceholder}
                value={wifiIp}
                onChange={(e) => setWifiIp(e.target.value)}
                style={inputStyle}
              />
              <input
                type="text"
                placeholder={t.wifiBox.namePlaceholder}
                value={wifiName}
                onChange={(e) => setWifiName(e.target.value)}
                style={{ ...inputStyle, flex: 'unset', width: 140 }}
              />
            </div>
            <button
              onClick={handleWifiConnect}
              disabled={wifiConnecting || !wifiIp.trim()}
              style={{
                width: '100%', background: wifiConnecting ? '#c4b5fd' : '#7c3aed', color: '#fff',
                border: 'none', borderRadius: 8, padding: 10, fontSize: 14, fontWeight: 700,
                cursor: wifiConnecting || !wifiIp.trim() ? 'not-allowed' : 'pointer', ...pressableStyle,
              }}
              {...pressableHandlers}
            >
              {wifiConnecting ? t.wifiBox.connecting : t.wifiBox.connect}
            </button>
            {wifiError && <div style={{ color: '#ef4444', fontSize: 13, marginTop: 8 }}>{wifiError}</div>}
          </div>
        </div>
      </div>
    </>
  );
}
