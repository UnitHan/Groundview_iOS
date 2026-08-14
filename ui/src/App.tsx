import React, { useEffect } from 'react';
import { useStore } from './store';
import { DevicesPage } from './DevicesPage';
import { AnalyzePage } from './AnalyzePage';
import { selectionStyle } from './theme';
import './style.css';

const API_BASE = 'http://localhost:4321';

function App() {
  const { page, setHealth, setDevices, setSelectedDeviceId, setGeminiStatus } = useStore();

  useEffect(() => {
    const init = async () => {
      try {
        const healthRes = await fetch(`${API_BASE}/api/health`);
        const health = await healthRes.json();
        setHealth(health);

        const devicesRes = await fetch(`${API_BASE}/api/devices`);
        const devices = await devicesRes.json();
        setDevices(devices);
        if (devices[0]) setSelectedDeviceId(devices[0].id);

        const settingsRes = await fetch(`${API_BASE}/api/settings`);
        const settings = await settingsRes.json();
        if (settings?.gemini) {
          setGeminiStatus(!!settings.gemini.enabled, settings.gemini.model);
        }
      } catch (e) {
        setHealth({ ok: false, details: 'API unreachable' });
      }
    };
    init();

    // Auto-refresh health and devices every 3 seconds
    const interval = setInterval(async () => {
      try {
        const healthRes = await fetch(`${API_BASE}/api/health`);
        const health = await healthRes.json();
        setHealth(health);

        const devicesRes = await fetch(`${API_BASE}/api/devices`);
        const devices = await devicesRes.json();
        setDevices(devices);
        if (devices[0] && !devices.find(d => d.id === useStore.getState().selectedDeviceId)) {
          setSelectedDeviceId(devices[0].id);
        }
      } catch (e) {
        // ignore
      }
    }, 3000);

    return () => clearInterval(interval);
  }, [setHealth, setDevices, setSelectedDeviceId, setGeminiStatus]);

  // Devices uses the light, padded shell (matches the Appkium Inspector Android
  // app). Analyze is full-bleed — AnalyzePage owns its own dark full-height layout.
  if (page === 'analyze') {
    return (
      <>
        <style>{selectionStyle}</style>
        <AnalyzePage />
      </>
    );
  }
  return (
    <div style={{
      minHeight: '100vh',
      background: '#f5f7fb',
      color: '#0f172a',
      padding: 16,
      fontFamily: 'Inter, system-ui, sans-serif',
      position: 'relative',
    }}>
      <style>{selectionStyle}</style>
      <DevicesPage />
    </div>
  );
}

export default App;
