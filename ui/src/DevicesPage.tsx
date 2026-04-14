import React, { useState } from 'react';
import { useStore } from './store';
import type { Device } from './types';

const API_BASE = 'http://localhost:4321';

export function DevicesPage() {
  const { health, devices, selectedDeviceId, capturing, setSelectedDeviceId, setPage, setCaptureResult, setParsedCapture, setCapturing } = useStore();
  const [wifiIp, setWifiIp] = useState('');
  const [wifiName, setWifiName] = useState('');
  const [wifiConnecting, setWifiConnecting] = useState(false);
  const [wifiError, setWifiError] = useState('');

  const handleCapture = async () => {
    if (!selectedDeviceId) {
      alert('Select a device');
      return;
    }
    setCapturing(true);
    try {
      console.log('Starting capture for device:', selectedDeviceId);
      const res = await fetch(`${API_BASE}/api/capture`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ deviceId: selectedDeviceId })
      });
      const captureResult = await res.json();
      console.log('Capture result:', captureResult);
      
      if (captureResult.error) {
        alert(`Capture failed: ${captureResult.error}`);
        setCapturing(false);
        return;
      }
      setCaptureResult(captureResult);
      
      // Parse the captured data
      console.log('Parsing captured data...');
      const parseRes = await fetch(`${API_BASE}/api/parse`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          screenshotPath: captureResult.screenshotPath,
          xmlPath: captureResult.xmlPath
        })
      });
      const parsed = await parseRes.json();
      console.log('Parsed data:', parsed);
      if (parsed?.error || !parsed?.tree) {
        alert(`Parse failed: ${parsed?.error || 'tree missing'}`);
        setCapturing(false);
        return;
      }
      const treeJson = JSON.stringify(parsed.tree, null, 2);
      console.log('Tree structure:', treeJson.substring(0, 1000));
      
      // Count nodes in tree
      const countNodes = (node: any): number => {
        if (!node) return 0;
        let count = 1;
        if (node.children) {
          for (const child of node.children) {
            count += countNodes(child);
          }
        }
        return count;
      };
      
      const totalNodes = countNodes(parsed.tree);
      console.log('Total nodes in tree:', totalNodes);
      console.log('Root node:', parsed.tree);
      console.log('Root children count:', parsed.tree?.children?.length || 0);

      setParsedCapture({
        screenshot: parsed.screenshot,
        tree: parsed.tree,
        deviceId: selectedDeviceId
      });
      setPage('analyze');
    } catch (e) {
      console.error('Capture error:', e);
      alert(`Error: ${e}`);
    } finally {
      setCapturing(false);
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
        body: JSON.stringify({ ip: wifiIp.trim(), name: wifiName.trim() || undefined })
      });
      const result = await res.json();
      if (!result.ok) {
        setWifiError(result.error || 'Connection failed');
      } else {
        setWifiIp('');
        setWifiName('');
        // Select the new WiFi device
        if (result.device?.id) {
          setSelectedDeviceId(result.device.id);
        }
      }
    } catch (e) {
      setWifiError(`Error: ${e}`);
    } finally {
      setWifiConnecting(false);
    }
  };

  return (
    <div style={{
      minHeight: '100vh',
      background: 'radial-gradient(circle at 50% 0%, #1f2937 0%, #0b1221 100%)',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '32px',
    }}>
      <div style={{
        background: '#0e1726',
        border: '1px solid #1f2937',
        borderRadius: '16px',
        padding: '48px 40px',
        maxWidth: '600px',
        width: '100%',
        boxShadow: '0 20px 60px rgba(0,0,0,0.4)',
      }}>
        <div style={{
          width: '120px',
          height: '120px',
          borderRadius: '32px',
          background: 'linear-gradient(135deg, #2563eb, #1d4ed8)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: '56px',
          margin: '0 auto 24px',
        }}>
          🔍
        </div>
        <h1 style={{
          color: '#e5e7eb',
          textAlign: 'center',
          fontSize: '32px',
          fontWeight: '800',
          margin: '0 0 8px',
        }}>
          GroundView
        </h1>
        <p style={{
          color: '#94a3b8',
          textAlign: 'center',
          margin: '0 0 32px',
        }}>
          WDA capture & locator generator
        </p>

        <div style={{
          background: health?.ok ? '#22c55e' : '#ef4444',
          borderRadius: '12px',
          padding: '16px',
          marginBottom: '16px',
        }}>
          <div style={{ color: health?.ok ? '#065f46' : '#7f1d1d', fontWeight: '700', marginBottom: '8px' }}>
            {health?.ok
              ? `✓ WDA CONNECTED ${health.connectionType === 'wifi' ? '(WiFi)' : '(USB)'}`
              : '✗ WDA NOT CONNECTED'}
          </div>
          <div style={{ color: health?.ok ? '#064e3b' : '#991b1b', fontSize: '13px', fontFamily: 'monospace' }}>
            {health?.details || 'Checking WebDriverAgent connection...'}
            {health?.ip ? ` | IP: ${health.ip}` : ''}
          </div>
        </div>

        {!health?.ok && (
          <div style={{
            background: '#1f2937',
            border: '1px solid #374151',
            borderRadius: '12px',
            padding: '16px',
            marginBottom: '24px',
          }}>
            <div style={{ color: '#fbbf24', fontWeight: '600', marginBottom: '8px', fontSize: '14px' }}>
              💡 Setup Required
            </div>
            <div style={{ color: '#9ca3af', fontSize: '13px', marginBottom: '12px', lineHeight: '1.5' }}>
              USB: Run this command in Terminal to start iproxy:
            </div>
            <div style={{
              background: '#0b1221',
              border: '1px solid #374151',
              borderRadius: '8px',
              padding: '12px',
              fontFamily: 'monospace',
              fontSize: '13px',
              color: '#22c55e',
              userSelect: 'all',
              cursor: 'text',
              marginBottom: '12px',
            }}>
              iproxy 8100:8100
            </div>
            <div style={{ color: '#9ca3af', fontSize: '13px', marginBottom: '8px', lineHeight: '1.5' }}>
              WiFi: Or connect directly via IP address below
            </div>
          </div>
        )}

        {/* WiFi Connection */}
        <div style={{
          background: '#0b1221',
          border: '1px solid #1f2937',
          borderRadius: '12px',
          padding: '16px',
          marginBottom: '16px',
        }}>
          <h3 style={{ color: '#cbd5e1', margin: '0 0 12px', fontSize: '16px', fontWeight: '700' }}>
            📶 WiFi Connection
          </h3>
          <div style={{ display: 'flex', gap: '8px', marginBottom: '8px' }}>
            <input
              type="text"
              placeholder="iPhone IP (e.g. 192.168.219.100)"
              value={wifiIp}
              onChange={(e) => setWifiIp(e.target.value)}
              style={{
                flex: 1,
                background: '#0e1726',
                color: '#e5e7eb',
                border: '1px solid #1f2937',
                borderRadius: '8px',
                padding: '10px 12px',
                fontSize: '14px',
              }}
            />
            <input
              type="text"
              placeholder="Name (optional)"
              value={wifiName}
              onChange={(e) => setWifiName(e.target.value)}
              style={{
                width: '140px',
                background: '#0e1726',
                color: '#e5e7eb',
                border: '1px solid #1f2937',
                borderRadius: '8px',
                padding: '10px 12px',
                fontSize: '14px',
              }}
            />
          </div>
          <button
            onClick={handleWifiConnect}
            disabled={wifiConnecting || !wifiIp.trim()}
            style={{
              width: '100%',
              background: wifiConnecting ? '#64748b' : '#7c3aed',
              color: '#fff',
              border: 'none',
              borderRadius: '8px',
              padding: '10px',
              fontSize: '14px',
              fontWeight: '700',
              cursor: wifiConnecting ? 'not-allowed' : 'pointer',
            }}
          >
            {wifiConnecting ? 'Connecting...' : '📶 Connect via WiFi'}
          </button>
          {wifiError && (
            <div style={{ color: '#ef4444', fontSize: '13px', marginTop: '8px' }}>
              {wifiError}
            </div>
          )}
        </div>

        <div style={{
          background: '#0b1221',
          border: '1px solid #1f2937',
          borderRadius: '12px',
          padding: '16px',
          marginBottom: '24px',
        }}>
          <div style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: '12px',
          }}>
            <h3 style={{ color: '#cbd5e1', margin: 0, fontSize: '16px', fontWeight: '700' }}>
              Connected Devices
            </h3>
            <span style={{
              background: '#22c55e',
              color: '#000',
              padding: '4px 10px',
              borderRadius: '8px',
              fontSize: '13px',
              fontWeight: '700',
            }}>
              {devices.length} device(s) found
            </span>
          </div>
          
          <select
            value={selectedDeviceId}
            onChange={(e) => setSelectedDeviceId(e.target.value)}
            style={{
              width: '100%',
              background: '#0e1726',
              color: '#e5e7eb',
              border: '1px solid #1f2937',
              borderRadius: '10px',
              padding: '12px 14px',
              fontSize: '14px',
              cursor: 'pointer',
            }}
          >
            {devices.map((d) => (
              <option key={d.id} value={d.id}>
                {d.connectionType === 'wifi' ? '📶 ' : '🔌 '}{d.name || 'iOS Device'} ({d.id})
              </option>
            ))}
          </select>
        </div>

        <button
          onClick={handleCapture}
          disabled={capturing || !selectedDeviceId}
          style={{
            width: '100%',
            background: capturing ? '#64748b' : '#2563eb',
            color: '#fff',
            border: 'none',
            borderRadius: '12px',
            padding: '16px',
            fontSize: '16px',
            fontWeight: '800',
            cursor: capturing ? 'not-allowed' : 'pointer',
            boxShadow: '0 8px 20px rgba(37,99,235,0.4)',
            transition: 'transform 0.1s ease',
          }}
          onMouseDown={(e) => {
            if (!capturing) e.currentTarget.style.transform = 'scale(0.98)';
          }}
          onMouseUp={(e) => {
            e.currentTarget.style.transform = 'scale(1)';
          }}
        >
          {capturing ? '★ Capturing...' : '📸 Capture Screen'}
        </button>

        {selectedDeviceId && (
          <div style={{
            marginTop: '16px',
            textAlign: 'center',
            color: '#64748b',
            fontSize: '13px',
          }}>
            Ready to capture from: <span style={{ color: '#22c55e', fontWeight: '600' }}>{selectedDeviceId}</span>
          </div>
        )}
      </div>

      <div style={{
        marginTop: '24px',
        textAlign: 'center',
        color: '#64748b',
        fontSize: '13px',
      }}>
        Health: {health ? (health.ok ? '✓ OK' : `✗ ${health.details}`) : 'Checking...'}
      </div>
    </div>
  );
}
