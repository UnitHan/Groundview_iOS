import { create } from 'zustand';
import type { Device, Health, CaptureResult, ParsedCapture, UINode } from './types';

type AppState = {
  // Navigation
  page: 'devices' | 'analyze';
  setPage: (page: 'devices' | 'analyze') => void;

  // Health & Devices
  health: Health | null;
  devices: Device[];
  selectedDeviceId: string;
  setHealth: (health: Health) => void;
  setDevices: (devices: Device[]) => void;
  setSelectedDeviceId: (id: string) => void;

  // Capture
  capturing: boolean;
  captureResult: CaptureResult | null;
  parsedCapture: ParsedCapture | null;
  setCaptureResult: (result: CaptureResult | null) => void;
  setParsedCapture: (parsed: ParsedCapture | null) => void;
  setCapturing: (capturing: boolean) => void;

  // Tree selection
  selectedNode: UINode | null;
  setSelectedNode: (node: UINode | null) => void;

  // Gemini
  geminiEnabled: boolean;
  geminiModel: string;
  setGeminiStatus: (enabled: boolean, model?: string) => void;

  // UI language (matches the Appkium Inspector Android app: ko default, en toggle)
  lang: 'ko' | 'en';
  setLang: (lang: 'ko' | 'en') => void;
};

const initialLang = (): 'ko' | 'en' => {
  try {
    const v = localStorage.getItem('appkium.lang');
    return v === 'en' ? 'en' : 'ko';
  } catch {
    return 'ko';
  }
};

export const useStore = create<AppState>((set) => ({
  // Navigation
  page: 'devices',
  setPage: (page) => set({ page }),

  // Health & Devices
  health: null,
  devices: [],
  selectedDeviceId: '',
  setHealth: (health) => set({ health }),
  setDevices: (devices) => set({ devices }),
  setSelectedDeviceId: (selectedDeviceId) => set({ selectedDeviceId }),

  // Capture
  capturing: false,
  captureResult: null,
  parsedCapture: null,
  setCaptureResult: (captureResult) => set({ captureResult }),
  setParsedCapture: (parsedCapture) => set({ parsedCapture }),
  setCapturing: (capturing) => set({ capturing }),

  // Tree selection
  selectedNode: null,
  setSelectedNode: (selectedNode) => set({ selectedNode }),

  // Gemini
  geminiEnabled: false,
  geminiModel: 'gemini-2.5-flash',
  setGeminiStatus: (geminiEnabled, geminiModel) =>
    set({ geminiEnabled, geminiModel: geminiModel || 'gemini-2.5-flash' }),

  // UI language
  lang: initialLang(),
  setLang: (lang) => {
    try { localStorage.setItem('appkium.lang', lang); } catch { /* ignore */ }
    set({ lang });
  }
}));
