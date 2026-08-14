import React from 'react';
import { useT } from './i18n';
import { pressableStyle, pressableHandlers } from './theme';

const API_BASE = 'http://localhost:4321';

export type IosDeviceInfo = {
  ok: boolean;
  udid: string;
  name: string;
  platform: string;
  platformVersion: string;
  sdkVersion?: string;
  connectionType?: string; // 'usb' | 'wifi'
  deviceIp?: string;
  wdaUrl?: string;
  wdaReady?: boolean;
  app?: { bundleId: string; name: string; pid?: number } | null;
  error?: string;
};

const q = (v?: string) => (v ? v : '');

// XCUITest Appium capabilities (only include fields we actually have).
function buildPythonCaps(info: IosDeviceInfo): string {
  const lines = [
    'caps = {',
    "    'platformName': 'iOS',",
    "    'appium:automationName': 'XCUITest',",
    `    'appium:udid': '${q(info.udid)}',`,
  ];
  if (info.name) lines.push(`    'appium:deviceName': '${info.name}',`);
  if (info.platformVersion) lines.push(`    'appium:platformVersion': '${info.platformVersion}',`);
  if (info.app?.bundleId) lines.push(`    'appium:bundleId': '${info.app.bundleId}',`);
  if (info.wdaUrl) lines.push(`    'appium:webDriverAgentUrl': '${info.wdaUrl}',`);
  lines.push("    'appium:usePreinstalledWDA': True,");
  lines.push("    'appium:noReset': True,");
  lines.push('}');
  return lines.join('\n');
}

function buildJavaCaps(info: IosDeviceInfo): string {
  const chain: string[] = [`.setUdid("${q(info.udid)}")`];
  if (info.name) chain.push(`.setDeviceName("${info.name}")`);
  if (info.platformVersion) chain.push(`.setPlatformVersion("${info.platformVersion}")`);
  if (info.app?.bundleId) chain.push(`.setBundleId("${info.app.bundleId}")`);
  chain.push('.setNoReset(true)');
  if (info.wdaUrl) chain.push(`.amend("appium:webDriverAgentUrl", "${info.wdaUrl}")`);
  chain.push('.amend("appium:usePreinstalledWDA", true)');
  const lines = ['XCUITestOptions options = new XCUITestOptions()'];
  chain.forEach((c, i) => lines.push(`    ${c}${i === chain.length - 1 ? ';' : ''}`));
  return lines.join('\n');
}

async function copy(text: string) {
  try { await navigator.clipboard.writeText(text); } catch { /* ignore */ }
}

const Row: React.FC<{ label: string; value?: string; mono?: boolean }> = ({ label, value, mono }) => (
  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, padding: '6px 0', borderBottom: '1px solid #1f2937' }}>
    <span style={{ color: '#9ca3af', fontSize: 13 }}>{label}</span>
    <span style={{
      color: value ? '#e5e7eb' : '#6b7280', fontSize: 13, fontWeight: 600,
      fontFamily: mono ? 'Consolas, Monaco, monospace' : undefined,
      userSelect: 'text', textAlign: 'right', wordBreak: 'break-all',
    }}>
      {value || '-'}
    </span>
  </div>
);

export const DeviceInfoModal: React.FC<{ deviceId: string; onClose: () => void }> = ({ deviceId, onClose }) => {
  const t = useT();
  const [state, setState] = React.useState<{ loading: boolean; error?: string; info?: IosDeviceInfo }>({ loading: true });
  const [lang, setLang] = React.useState<'python' | 'java'>('python');

  const load = React.useCallback(() => {
    setState({ loading: true });
    fetch(`${API_BASE}/api/device-info?deviceId=${encodeURIComponent(deviceId)}`)
      .then((r) => r.json())
      .then((info: IosDeviceInfo) => {
        if (info?.ok) setState({ loading: false, info });
        else setState({ loading: false, error: info?.error || t.deviceInfo.error });
      })
      .catch((e) => setState({ loading: false, error: String(e) }));
  }, [deviceId, t.deviceInfo.error]);

  React.useEffect(() => { load(); }, [load]);
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const info = state.info;
  const caps = info ? (lang === 'python' ? buildPythonCaps(info) : buildJavaCaps(info)) : '';
  const missingApp = info && !info.app?.bundleId;

  const btn = (bg: string): React.CSSProperties => ({
    border: 'none', background: bg, color: '#fff', borderRadius: 6,
    padding: '6px 12px', cursor: 'pointer', fontSize: 12, fontWeight: 600, ...pressableStyle,
  });

  return (
    <div
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 2100 }}
      onClick={onClose}
    >
      <div
        style={{
          background: '#0b1221', borderRadius: 14, padding: 18, border: '1px solid #1f2937',
          width: 640, maxWidth: '94%', maxHeight: '90vh', overflowY: 'auto',
          boxShadow: '0 16px 60px rgba(0,0,0,0.6)', color: '#e5e7eb',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ fontSize: 22 }}>📱</span>
            <div>
              <div style={{ fontWeight: 800, fontSize: 16 }}>{t.deviceInfo.title}</div>
              <div style={{ color: '#9ca3af', fontSize: 12 }}>{t.deviceInfo.subtitle}</div>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={load} disabled={state.loading}
              style={{ border: '1px solid #1f2937', background: '#111827', color: '#e5e7eb', borderRadius: 8, padding: '6px 12px', cursor: state.loading ? 'wait' : 'pointer', fontWeight: 600, ...pressableStyle }}
              {...pressableHandlers}>
              {state.loading ? t.deviceInfo.refreshing : t.deviceInfo.refresh}
            </button>
            <button onClick={onClose}
              style={{ border: 'none', background: '#111827', color: '#e5e7eb', borderRadius: 8, padding: '6px 12px', cursor: 'pointer', ...pressableStyle }}
              {...pressableHandlers}>
              {t.deviceInfo.close}
            </button>
          </div>
        </div>

        {state.loading && <div style={{ color: '#9ca3af', padding: '20px 0' }}>{t.deviceInfo.loading}</div>}
        {!state.loading && state.error && <div style={{ color: '#f87171', padding: '12px 0' }}>⚠️ {state.error}</div>}

        {!state.loading && info && (
          <>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 14 }}>
              <div style={{ background: '#0e1726', borderRadius: 10, padding: 12, border: '1px solid #1f2937' }}>
                <div style={{ fontWeight: 700, marginBottom: 6, fontSize: 13 }}>{t.deviceInfo.deviceSection}</div>
                <Row label="name" value={info.name} />
                <Row label="iOS" value={info.platformVersion} />
                <Row label="udid" value={info.udid} mono />
                <Row label={t.deviceInfo.connection} value={info.connectionType === 'wifi' ? t.deviceInfo.wifi : t.deviceInfo.usb} />
                <Row label="IP" value={info.deviceIp} mono />
                <Row label="WDA URL" value={info.wdaUrl} mono />
                <Row label="WDA" value={info.wdaReady ? 'ready' : '-'} />
              </div>
              <div style={{ background: '#0e1726', borderRadius: 10, padding: 12, border: '1px solid #1f2937' }}>
                <div style={{ fontWeight: 700, marginBottom: 6, fontSize: 13 }}>{t.deviceInfo.appSection}</div>
                <Row label="bundleId" value={info.app?.bundleId} mono />
                <Row label="name" value={info.app?.name} />
                <Row label="pid" value={info.app?.pid != null ? String(info.app.pid) : ''} />
                {info.app?.bundleId && (
                  <button onClick={() => copy(info.app!.bundleId)} style={{ marginTop: 8, ...btn('#3b82f6') }} {...pressableHandlers}>
                    {t.deviceInfo.copyBundle}
                  </button>
                )}
                {missingApp && <div style={{ marginTop: 8, fontSize: 11, color: '#fca5a5' }}>{t.deviceInfo.missingApp}</div>}
              </div>
            </div>

            {/* Appium Capabilities */}
            <div style={{ background: '#0e1726', borderRadius: 10, padding: 12, border: '1px solid #1f2937' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                <div style={{ fontWeight: 700, fontSize: 13 }}>{t.deviceInfo.capsTitle}</div>
                <div style={{ display: 'flex', gap: 6 }}>
                  {(['python', 'java'] as const).map((l) => (
                    <button key={l} onClick={() => setLang(l)}
                      style={{ border: '1px solid #1f2937', background: lang === l ? '#22c55e' : '#111827', color: '#e5e7eb', borderRadius: 6, padding: '4px 10px', cursor: 'pointer', fontSize: 12, ...pressableStyle }}
                      {...pressableHandlers}>
                      {l === 'python' ? 'Python' : 'Java'}
                    </button>
                  ))}
                </div>
              </div>
              <pre style={{ whiteSpace: 'pre-wrap', color: '#e5e7eb', fontSize: 12, lineHeight: 1.6, userSelect: 'text', fontFamily: 'Consolas, Monaco, monospace', margin: 0, maxHeight: 260, overflowY: 'auto' }}>
                {caps}
              </pre>
              <button onClick={() => copy(caps)} style={{ marginTop: 8, ...btn('#10b981') }} {...pressableHandlers}>
                {t.deviceInfo.copy}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
};
