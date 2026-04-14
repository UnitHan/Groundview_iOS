import React, { useEffect } from 'react';
import { useStore } from './store';
import { DevicesPage } from './DevicesPage';
import { AnalyzePage } from './AnalyzePage';
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

  return page === 'devices' ? <DevicesPage /> : <AnalyzePage />;
}

export default App;
