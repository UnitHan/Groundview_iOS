// Lightweight i18n for the iOS build, mirroring the Appkium Inspector (Android)
// renderer's useT() pattern but backed by the zustand store's `lang`.
import { useStore } from './store';

export type Translation = {
  appName: string;
  subtitle: string;
  langToggle: string; // label to switch to the OTHER language
  devices: {
    status: { red: string; yellow: string; green: string };
    connected: string; // "Connected Devices"
    found: (n: number) => string;
    refresh: string;
    selectDevice: string;
    noDevices: string;
    noDevicesHint: string;
    selectToCapture: string;
    capturing: string;
    capture: string;
    loadZip: string;
    readyFrom: (id: string) => string;
    usb: string;
    wifi: string;
  };
  wda: {
    connected: (type: string) => string;
    notConnected: string;
    checking: string;
    setupTitle: string;
    setupUsb: string;
    setupWifi: string;
    launch: string;
    launching: string;
    launchOk: string;
    stop: string;
    daemonHint: string;
  };
  wifiBox: {
    title: string;
    ipPlaceholder: string;
    namePlaceholder: string;
    connect: string;
    connecting: string;
  };
  analyze: {
    back: string;
    recapture: string;
    recapturing: string;
    save: string;
    saving: string;
    code: string;
    ocr: string;
    ocrRunning: string;
    settings: string;
    analyzing: string;
  };
  deviceInfo: {
    button: string;
    title: string;
    subtitle: string;
    refresh: string;
    refreshing: string;
    close: string;
    deviceSection: string;
    appSection: string;
    connection: string;
    usb: string;
    wifi: string;
    copyBundle: string;
    capsTitle: string;
    copy: string;
    copied: string;
    missingApp: string;
    loading: string;
    error: string;
  };
  loadZip: {
    failed: string;
    loaded: (id: string) => string;
  };
};

const ko: Translation = {
  appName: 'Appkium Inspector',
  subtitle: 'iOS UI Inspector & Test Automation Locator Tool',
  langToggle: 'EN',
  devices: {
    status: { red: '설정 필요', yellow: '일부 미완료', green: '정상' },
    connected: 'Connected Devices',
    found: (n) => `${n}개 기기 발견`,
    refresh: 'Refresh',
    selectDevice: 'Select Device',
    noDevices: '연결된 기기가 없습니다',
    noDevicesHint: 'USB로 연결하거나 WiFi로 연결하세요.',
    selectToCapture: '캡처하려면 기기를 선택하세요.',
    capturing: '★ 캡처 중...',
    capture: 'Capture Screen',
    loadZip: 'Load ZIP File',
    readyFrom: (id) => `캡처 준비됨: ${id}`,
    usb: 'USB',
    wifi: '무선',
  },
  wda: {
    connected: (type) => `✓ WDA 연결됨 (${type})`,
    notConnected: '✗ WDA 연결 안 됨',
    checking: 'WebDriverAgent 연결 확인 중...',
    setupTitle: '💡 설정 필요',
    setupUsb: 'USB: 터미널에서 iproxy를 실행하세요',
    setupWifi: 'WiFi: 아래에서 IP로 직접 연결하세요',
    launch: '▶ WDA 실행',
    launching: 'WDA 기동 중...',
    launchOk: '✓ WDA 실행됨',
    stop: 'WDA 중지',
    daemonHint: 'tunneld 데몬이 필요합니다: sudo bash sh/install_tunneld_daemon.sh',
  },
  wifiBox: {
    title: '📶 WiFi 연결',
    ipPlaceholder: 'iPhone IP (예: 192.168.0.100)',
    namePlaceholder: '이름 (선택)',
    connect: '📶 WiFi로 연결',
    connecting: '연결 중...',
  },
  analyze: {
    back: '← 기기',
    recapture: '다시 캡처',
    recapturing: '캡처 중...',
    save: '저장',
    saving: '저장 중...',
    code: '코드 생성',
    ocr: 'OCR',
    ocrRunning: 'OCR 중...',
    settings: '설정',
    analyzing: '🤖 Gemini AI가 분석 중입니다...',
  },
  loadZip: {
    failed: 'ZIP 불러오기 실패',
    loaded: (id) => `ZIP 불러옴: ${id}`,
  },
  deviceInfo: {
    button: '📱 기기 정보',
    title: '기기 · 앱 정보',
    subtitle: 'Appium capabilities 구성용',
    refresh: '🔄 새로고침',
    refreshing: '조회 중…',
    close: '닫기',
    deviceSection: '단말',
    appSection: '포그라운드 앱',
    connection: '연결',
    usb: 'USB',
    wifi: '무선(Wi-Fi)',
    copyBundle: '📋 번들 ID 복사',
    capsTitle: 'Appium Capabilities',
    copy: '📋 복사하기',
    copied: '복사됨',
    missingApp: '⚠️ 앱 정보를 못 읽었어요. 대상 앱을 화면 맨 앞에 두고 🔄 새로고침 하세요.',
    loading: '기기 정보를 불러오는 중…',
    error: '기기 정보 조회 실패',
  },
};

const en: Translation = {
  appName: 'Appkium Inspector',
  subtitle: 'iOS UI Inspector & Test Automation Locator Tool',
  langToggle: '한국어',
  devices: {
    status: { red: 'Setup Required', yellow: 'Partially Configured', green: 'Ready' },
    connected: 'Connected Devices',
    found: (n) => `${n} device(s) found`,
    refresh: 'Refresh',
    selectDevice: 'Select Device',
    noDevices: 'No devices connected',
    noDevicesHint: 'Connect via USB or WiFi.',
    selectToCapture: 'Select a device to capture.',
    capturing: '★ Capturing...',
    capture: 'Capture Screen',
    loadZip: 'Load ZIP File',
    readyFrom: (id) => `Ready to capture from: ${id}`,
    usb: 'USB',
    wifi: 'WiFi',
  },
  wda: {
    connected: (type) => `✓ WDA CONNECTED (${type})`,
    notConnected: '✗ WDA NOT CONNECTED',
    checking: 'Checking WebDriverAgent connection...',
    setupTitle: '💡 Setup Required',
    setupUsb: 'USB: Run iproxy in Terminal',
    setupWifi: 'WiFi: Or connect directly via IP below',
    launch: '▶ Launch WDA',
    launching: 'Launching WDA...',
    launchOk: '✓ WDA launched',
    stop: 'Stop WDA',
    daemonHint: 'tunneld daemon required: sudo bash sh/install_tunneld_daemon.sh',
  },
  wifiBox: {
    title: '📶 WiFi Connection',
    ipPlaceholder: 'iPhone IP (e.g. 192.168.0.100)',
    namePlaceholder: 'Name (optional)',
    connect: '📶 Connect via WiFi',
    connecting: 'Connecting...',
  },
  analyze: {
    back: '← Devices',
    recapture: 'Recapture',
    recapturing: 'Capturing...',
    save: 'Save',
    saving: 'Saving...',
    code: 'Generate Code',
    ocr: 'OCR',
    ocrRunning: 'OCR...',
    settings: 'Settings',
    analyzing: '🤖 Gemini AI is analyzing...',
  },
  loadZip: {
    failed: 'Failed to load ZIP',
    loaded: (id) => `Loaded ZIP: ${id}`,
  },
  deviceInfo: {
    button: '📱 Device Info',
    title: 'Device · App Info',
    subtitle: 'For Appium capabilities',
    refresh: '🔄 Refresh',
    refreshing: 'Loading…',
    close: 'Close',
    deviceSection: 'Device',
    appSection: 'Foreground App',
    connection: 'Connection',
    usb: 'USB',
    wifi: 'Wireless (Wi-Fi)',
    copyBundle: '📋 Copy Bundle ID',
    capsTitle: 'Appium Capabilities',
    copy: '📋 Copy',
    copied: 'Copied',
    missingApp: '⚠️ Could not read app info. Bring the target app to the foreground and 🔄 Refresh.',
    loading: 'Loading device info…',
    error: 'Failed to load device info',
  },
};

const translations: Record<'ko' | 'en', Translation> = { ko, en };

export function useT(): Translation {
  const lang = useStore((s) => s.lang);
  return translations[lang] ?? ko;
}
