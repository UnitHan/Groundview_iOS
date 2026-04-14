export type Device = {
  id: string;
  name?: string;
  platform?: 'ios';
  kind?: 'real' | 'simulator';
  connectionType?: 'usb' | 'wifi' | 'unknown';
  ipAddress?: string;
};

export type Health = {
  ok: boolean;
  details?: string;
  connectionType?: 'usb' | 'wifi';
  ip?: string;
};

export type CaptureResult = {
  platform: string;
  deviceId: string;
  screenshotPath: string;
  xmlPath: string;
  status?: string;
  error?: string;
  timestamp?: number;
};

export type UINode = {
  type: string;
  name?: string;
  label?: string;
  value?: string;
  enabled?: string;
  visible?: string;
  accessible?: string;
  x: string;
  y: string;
  width: string;
  height: string;
  index?: string;
  traits?: string;
  children?: UINode[];
};

export type ParsedCapture = {
  screenshot: string; // base64 or URL
  tree: UINode;
  deviceId: string;
};
