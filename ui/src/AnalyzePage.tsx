import React from 'react';
import { useStore } from './store';
import { Overlay } from './Overlay';
import { TreeView } from './TreeView';

const API_BASE = 'http://localhost:4321';
const APP_ICON =
  typeof window !== 'undefined' ? new URL('icon.png', window.location.href).toString() : '/icon.png';

type LocatorCandidate = {
  strategy: 'accessibility id' | 'predicate' | 'class chain' | 'xpath';
  value: string;
  note?: string;
  score?: number;
  risks?: string[];
};

type LocatorSuggestion = {
  strategy: string;
  value: string;
  codePython: string;
  codeJava: string;
  score: number;
  tier: 'recommended' | 'alternative' | 'fallback';
  notes?: string[];
  risks?: string[];
};

const escapeLocator = (value: string) => value.replace(/"/g, '\\"');

const parseNum = (value?: string) => {
  if (value === undefined || value === null) return 0;
  const num = Number(value);
  return Number.isFinite(num) ? num : 0;
};

const buildBounds = (node: { x?: string; y?: string; width?: string; height?: string }) => {
  const x = parseNum(node.x);
  const y = parseNum(node.y);
  const w = parseNum(node.width);
  const h = parseNum(node.height);
  return `[${Math.round(x)},${Math.round(y)}][${Math.round(x + w)},${Math.round(y + h)}]`;
};

const buildIosLocatorCandidates = (node: any): LocatorCandidate[] => {
  const name = (node.name || '').trim();
  const label = (node.label || '').trim();
  const value = (node.value || '').trim();
  const type = (node.type || '').trim();
  const isAccessible = node.accessible === 'true';
  const traits = (node.traits || '').toLowerCase();
  const candidates: LocatorCandidate[] = [];

  // accessible="true" + name is the most stable locator (iOS accessibility tree guarantees it)
  if (name && isAccessible) {
    candidates.push({
      strategy: 'accessibility id',
      value: name,
      note: 'name (accessible ✓)',
      score: 99,
      risks: []
    });
  } else if (name) {
    candidates.push({
      strategy: 'accessibility id',
      value: name,
      note: 'name',
      score: 96,
      risks: isAccessible ? [] : ['accessible=false: Appium이 이 요소를 못 찾을 수 있습니다.']
    });
  }
  if (label && label !== name) {
    const labelScore = isAccessible ? 95 : 90;
    candidates.push({
      strategy: 'accessibility id',
      value: label,
      note: isAccessible ? 'label (accessible ✓)' : 'label',
      score: labelScore,
      risks: isAccessible ? [] : ['accessible=false일 경우 Appium이 못 찾을 수 있습니다.', 'label 값이 변경되면 깨질 수 있습니다.']
    });
  }

  // Predicate with type constraint from traits for better specificity
  if (label || name || value) {
    const parts: string[] = [];
    // If traits indicate a specific type, add type constraint
    const traitType = /button/.test(traits) ? 'XCUIElementTypeButton' :
                      /link/.test(traits) ? 'XCUIElementTypeLink' :
                      /static\s*text/.test(traits) ? 'XCUIElementTypeStaticText' : '';
    if (label) parts.push(`label == "${escapeLocator(label)}"`);
    else if (name) parts.push(`name == "${escapeLocator(name)}"`);
    else if (value) parts.push(`value == "${escapeLocator(value)}"`);
    
    // Use exact match (==) when accessible, CONTAINS as fallback
    const predicate = parts.join(' AND ');
    const predicateScore = isAccessible ? 88 : 84;
    candidates.push({
      strategy: 'predicate',
      value: traitType ? `type == "${traitType}" AND ${predicate}` : predicate,
      note: traitType ? `predicate (traits: ${traitType.replace('XCUIElementType', '')})` : 'predicate',
      score: predicateScore,
      risks: ['텍스트 기반이라 문구 변경 시 실패할 수 있습니다.']
    });
  }

  if (type) {
    candidates.push({
      strategy: 'class chain',
      value: `**/${type}`,
      note: 'class chain',
      score: 78,
      risks: ['구조 변경에 민감합니다.']
    });
  }

  if (type && (name || label || value)) {
    const attrs: string[] = [];
    if (name) attrs.push(`@name="${escapeLocator(name)}"`);
    if (label) attrs.push(`@label="${escapeLocator(label)}"`);
    if (value) attrs.push(`@value="${escapeLocator(value)}"`);
    const predicate = attrs.length ? `[${attrs.map((a) => `(${a})`).join(' and ')}]` : '';
    candidates.push({
      strategy: 'xpath',
      value: `//${type}${predicate}`,
      note: 'xpath',
      score: 60,
      risks: ['XPath는 구조 변경에 취약합니다.']
    });
  }

  return candidates;
};

const pythonBy = (strategy: string, version: '1' | '2') => {
  const by = version === '1' ? 'MobileBy' : 'AppiumBy';
  switch (strategy) {
    case 'accessibility id':
      return `${by}.ACCESSIBILITY_ID`;
    case 'predicate':
      return `${by}.IOS_PREDICATE`;
    case 'class chain':
      return `${by}.IOS_CLASS_CHAIN`;
    default:
      return `${by}.XPATH`;
  }
};

const pythonLocatorTuple = (strategy: string, value: string, version: '1' | '2') =>
  `(${pythonBy(strategy, version)}, "${escapeLocator(value)}")`;

const javaLocatorExpr = (strategy: string, value: string, version: '1' | '2') => {
  if (version === '1') {
    switch (strategy) {
      case 'accessibility id':
        return `MobileBy.AccessibilityId("${escapeLocator(value)}")`;
      case 'predicate':
        return `MobileBy.iOSNsPredicateString("${escapeLocator(value)}")`;
      case 'class chain':
        return `MobileBy.iOSClassChain("${escapeLocator(value)}")`;
      default:
        return `By.xpath("${escapeLocator(value)}")`;
    }
  }
  switch (strategy) {
    case 'accessibility id':
      return `AppiumBy.accessibilityId("${escapeLocator(value)}")`;
    case 'predicate':
      return `AppiumBy.iOSNsPredicateString("${escapeLocator(value)}")`;
    case 'class chain':
      return `AppiumBy.iOSClassChain("${escapeLocator(value)}")`;
    default:
      return `AppiumBy.xpath("${escapeLocator(value)}")`;
  }
};

const buildEasyLocator = (node: any, version: '1' | '2') => {
  const candidate = buildIosLocatorCandidates(node)[0];
  if (!candidate) {
    return {
      python: '# no locator candidates',
      java: '// no locator candidates',
      note: 'no candidates'
    };
  }
  const pythonImport =
    version === '1'
      ? 'from appium.webdriver.common.mobileby import MobileBy'
      : 'from appium.webdriver.common.appiumby import AppiumBy';
  const javaImport =
    version === '1'
      ? 'import io.appium.java_client.MobileBy;'
      : 'import io.appium.java_client.AppiumBy;';
  const python = `${pythonImport}

el = driver.find_element(
    by=${pythonBy(candidate.strategy, version)},
    value="${escapeLocator(candidate.value)}"
)
el.click()`;
  const java = `${javaImport}
import org.openqa.selenium.WebElement;

WebElement el = driver.findElement(
    ${javaLocatorExpr(candidate.strategy, candidate.value, version)}
);
el.click();`;
  return {
    python,
    java,
    note: candidate.note || candidate.strategy
  };
};

const buildTestExample = (node: any, version: '1' | '2') => {
  const candidates = buildIosLocatorCandidates(node);
  const primary = candidates[0];
  const fallback = candidates[1];
  const enabled = node?.enabled === 'true';
  const waitFn = enabled ? 'element_to_be_clickable' : 'presence_of_element_located';
  const javaWaitFn = enabled ? 'elementToBeClickable' : 'presenceOfElementLocated';
  const pythonImports =
    version === '1'
      ? 'from appium.webdriver.common.mobileby import MobileBy'
      : 'from appium.webdriver.common.appiumby import AppiumBy';
  const javaImports = version === '1' ? 'import io.appium.java_client.MobileBy;' : 'import io.appium.java_client.AppiumBy;';

  const python = `${pythonImports}
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC
from selenium.common.exceptions import TimeoutException, NoSuchElementException

def run_test(driver, timeout: int = 10) -> bool:
    \"\"\"
    선택한 요소를 클릭하는 iOS Appium ${version}.x 예제 (Wait 포함)
    \"\"\"
    locator = ${primary ? pythonLocatorTuple(primary.strategy, primary.value, version) : '(None, \"\")'}
    ${fallback ? `plan_b_locator = ${pythonLocatorTuple(fallback.strategy, fallback.value, version)}` : '# plan_b_locator 없음'}

    try:
        el = WebDriverWait(driver, timeout).until(
            EC.${waitFn}(locator)
        )
        el.click()
        return True
    except (TimeoutException, NoSuchElementException):
        ${fallback ? `try:
            el = WebDriverWait(driver, timeout).until(
                EC.${waitFn}(plan_b_locator)
            )
            el.click()
            return True
        except Exception:
            return False` : 'return False'}
`;

  const java = `${javaImports}
import org.openqa.selenium.By;
import org.openqa.selenium.WebElement;
import org.openqa.selenium.support.ui.ExpectedConditions;
import org.openqa.selenium.support.ui.WebDriverWait;
import java.time.Duration;

public boolean runTest(AppiumDriver driver, int timeoutSeconds) {
    By locator = ${primary ? javaLocatorExpr(primary.strategy, primary.value, version) : 'By.xpath(\"//*\")'};
    ${fallback ? `By planB = ${javaLocatorExpr(fallback.strategy, fallback.value, version)};` : 'By planB = locator;'}

    WebDriverWait wait = new WebDriverWait(driver, Duration.ofSeconds(timeoutSeconds));
    try {
      WebElement el = wait.until(ExpectedConditions.${javaWaitFn}(locator));
      el.click();
      return true;
    } catch (Exception first) {
      ${fallback ? `try {
        WebElement el = wait.until(ExpectedConditions.${javaWaitFn}(planB));
        el.click();
        return true;
      } catch (Exception second) {
        return false;
      }` : 'return false;'}
    }
}
`;
  return { python, java };
};

const buildLocatorSuggestions = (node: any, version: '1' | '2'): LocatorSuggestion[] => {
  const candidates = buildIosLocatorCandidates(node);
  const toTier = (score: number) => (score >= 85 ? 'recommended' : score >= 70 ? 'alternative' : 'fallback');
  const suggestions = candidates.map((c) => {
    const score = c.score || 60;
    const python = `from selenium.webdriver.support.ui import WebDriverWait\nfrom selenium.webdriver.support import expected_conditions as EC\n${version === '1' ? 'from appium.webdriver.common.mobileby import MobileBy' : 'from appium.webdriver.common.appiumby import AppiumBy'}\n\nlocator = ${pythonLocatorTuple(c.strategy, c.value, version)}\nel = WebDriverWait(driver, 10).until(EC.presence_of_element_located(locator))`;
    const java = `${version === '1' ? 'import io.appium.java_client.MobileBy;' : 'import io.appium.java_client.AppiumBy;'}\nimport org.openqa.selenium.By;\nimport org.openqa.selenium.WebElement;\nimport org.openqa.selenium.support.ui.ExpectedConditions;\nimport org.openqa.selenium.support.ui.WebDriverWait;\nimport java.time.Duration;\n\nBy locator = ${javaLocatorExpr(c.strategy, c.value, version)};\nWebElement el = new WebDriverWait(driver, Duration.ofSeconds(10)).until(ExpectedConditions.presenceOfElementLocated(locator));`;
    return {
      strategy: c.strategy,
      value: c.value,
      codePython: python,
      codeJava: java,
      score,
      tier: toTier(score),
      notes: c.note ? [c.note] : [],
      risks: c.risks
    };
  });
  const seen = new Set<string>();
  return suggestions.filter((s) => {
    const key = `${s.strategy}-${s.value}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

const copyToClipboard = async (txt: string) => {
  try {
    await navigator.clipboard.writeText(txt);
  } catch {
    // ignore
  }
};

export function AnalyzePage() {
  const {
    parsedCapture,
    selectedNode,
    captureResult,
    capturing,
    setSelectedNode,
    setPage,
    setParsedCapture,
    setCaptureResult,
    setCapturing,
    geminiEnabled,
    geminiModel,
    setGeminiStatus
  } = useStore();
  const [showDebugPanel, setShowDebugPanel] = React.useState(false);
  const [showSettingsModal, setShowSettingsModal] = React.useState(false);
  const [codeModalOpen, setCodeModalOpen] = React.useState(false);
  const [codeTab, setCodeTab] = React.useState<'appium1' | 'appium2' | 'gemini'>('appium2');
  const [codeLang, setCodeLang] = React.useState<'python' | 'java'>('python');
  const [geminiVersion, setGeminiVersion] = React.useState<'1' | '2'>('2');
  const [geminiLocator, setGeminiLocator] = React.useState<{ loading: boolean; error?: string | null; data?: any | null }>(
    { loading: false, error: null, data: null }
  );
  const [ocrModal, setOcrModal] = React.useState<{ text?: string; error?: string; source?: string } | null>(null);
  const [ocrLoading, setOcrLoading] = React.useState(false);
  const [saveLoading, setSaveLoading] = React.useState(false);
  const [saveMessage, setSaveMessage] = React.useState<string | null>(null);
  const [saveMessageError, setSaveMessageError] = React.useState(false);
  const [geminiKeyInput, setGeminiKeyInput] = React.useState('');
  const [geminiModelInput, setGeminiModelInput] = React.useState(geminiModel || 'gemini-2.5-flash');
  const [geminiSaving, setGeminiSaving] = React.useState(false);
  const [geminiSaveMessage, setGeminiSaveMessage] = React.useState<string | null>(null);
  const geminiAbortRef = React.useRef<AbortController | null>(null);
  const [geminiKeyEditing, setGeminiKeyEditing] = React.useState(false);
  const geminiKeyInputRef = React.useRef<HTMLInputElement | null>(null);
  const saveMessageTimerRef = React.useRef<number | null>(null);

  React.useEffect(() => {
    setGeminiModelInput(geminiModel || 'gemini-2.5-flash');
  }, [geminiModel]);

  React.useEffect(() => {
    return () => {
      if (saveMessageTimerRef.current) {
        window.clearTimeout(saveMessageTimerRef.current);
      }
    };
  }, []);

  const handleRecapture = async () => {
    if (!parsedCapture || capturing) return;
    setCapturing(true);
    
    try {
      const res = await fetch(`${API_BASE}/api/capture`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ deviceId: parsedCapture.deviceId })
      });
      const captureResult = await res.json();

      if (captureResult.error) {
        alert(`Capture failed: ${captureResult.error}`);
        return;
      }
      setCaptureResult(captureResult);
      
      const parseRes = await fetch(`${API_BASE}/api/parse`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          screenshotPath: captureResult.screenshotPath,
          xmlPath: captureResult.xmlPath
        })
      });
      const parsed = await parseRes.json();
      
      setParsedCapture({
        screenshot: parsed.screenshot,
        tree: parsed.tree,
        deviceId: parsedCapture.deviceId
      });
    } catch (e) {
      console.error('Recapture error:', e);
      alert(`Error: ${e}`);
    } finally {
      setCapturing(false);
    }
  };

  const setSaveStatus = (message: string, isError = false) => {
    setSaveMessage(message);
    setSaveMessageError(isError);
    if (saveMessageTimerRef.current) {
      window.clearTimeout(saveMessageTimerRef.current);
    }
    saveMessageTimerRef.current = window.setTimeout(() => {
      setSaveMessage(null);
    }, 5000);
  };

  const handleSave = async () => {
    if (saveLoading) return;
    if (!captureResult?.screenshotPath || !captureResult?.xmlPath || !parsedCapture?.tree) {
      setSaveStatus('저장할 캡처가 없습니다.', true);
      return;
    }
    const showSaveDialog = (window as any)?.groundview?.showSaveDialog as
      | ((options?: Record<string, any>) => Promise<{ canceled: boolean; filePath?: string }>)
      | undefined;
    if (!showSaveDialog) {
      setSaveStatus('저장 창을 열 수 없습니다. Electron 환경을 확인하세요.', true);
      return;
    }
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const suggestedName = `GroundView-iOS-${parsedCapture.deviceId}-${stamp}.zip`;
    setSaveLoading(true);
    setSaveMessage(null);
    try {
      const dialogResult = await showSaveDialog({
        defaultPath: suggestedName,
        filters: [{ name: 'Zip Archive', extensions: ['zip'] }]
      });
      if (!dialogResult || dialogResult.canceled || !dialogResult.filePath) {
        setSaveStatus('저장이 취소되었습니다.', false);
        return;
      }
      const res = await fetch(`${API_BASE}/api/save-zip`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          screenshotPath: captureResult.screenshotPath,
          xmlPath: captureResult.xmlPath,
          deviceId: parsedCapture.deviceId,
          tree: parsedCapture.tree,
          targetPath: dialogResult.filePath
        })
      });
      const data = await res.json();
      if (data?.ok) {
        setSaveStatus(`저장 완료: ${data.file || dialogResult.filePath}`, false);
      } else {
        setSaveStatus(data?.error || '저장 실패', true);
      }
    } catch (e) {
      setSaveStatus(String(e), true);
    } finally {
      setSaveLoading(false);
    }
  };

  const selectedBounds = selectedNode ? buildBounds(selectedNode) : undefined;
  const activeVersion = codeTab === 'appium1' ? '1' : codeTab === 'appium2' ? '2' : geminiVersion;
  const easyBlock = selectedNode ? buildEasyLocator(selectedNode, activeVersion) : null;
  const testExample = selectedNode ? buildTestExample(selectedNode, activeVersion) : null;
  const locatorSuggestions = selectedNode ? buildLocatorSuggestions(selectedNode, activeVersion) : [];

  const openCodeModal = () => {
    if (!selectedNode) {
      alert('요소를 먼저 선택하세요.');
      return;
    }
    setCodeTab('appium2');
    setGeminiLocator({ loading: false, error: null, data: null });
    setCodeModalOpen(true);
  };

  const requestGemini = async () => {
    if (!selectedNode) {
      setGeminiLocator({ loading: false, error: '요소를 먼저 선택하세요.', data: null });
      return;
    }
    if (!geminiEnabled) {
      setGeminiLocator({ loading: false, error: 'GEMINI_API_KEY 가 설정되지 않았습니다.', data: null });
      return;
    }
    if (geminiAbortRef.current) {
      geminiAbortRef.current.abort();
    }
    const controller = new AbortController();
    geminiAbortRef.current = controller;
    setGeminiLocator({ loading: true, error: null, data: null });
    try {
      const res = await fetch(`${API_BASE}/api/gemini/code`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          node: selectedNode,
          appiumVersion: geminiVersion,
          lang: codeLang,
          screenshotPath: captureResult?.screenshotPath,
          bounds: selectedBounds
        }),
        signal: controller.signal
      });
      const data = await res.json();
      if (data?.ok && data?.suggestion) {
        setGeminiLocator({ loading: false, error: null, data: data.suggestion });
      } else {
        setGeminiLocator({ loading: false, error: data?.error || 'Gemini 제안 실패', data: null });
      }
    } catch (e: any) {
      if (e?.name === 'AbortError') {
        setGeminiLocator({ loading: false, error: '요청이 취소되었습니다.', data: null });
      } else {
        setGeminiLocator({ loading: false, error: String(e), data: null });
      }
    }
  };

  const cancelGemini = () => {
    if (geminiAbortRef.current) {
      geminiAbortRef.current.abort();
      geminiAbortRef.current = null;
    }
  };

  const runGeminiOcr = async () => {
    if (!geminiEnabled) {
      setOcrModal({ error: 'GEMINI_API_KEY 가 설정되지 않았습니다.' });
      return;
    }
    if (!captureResult?.screenshotPath) {
      setOcrModal({ error: '스크린샷이 없습니다. 캡처 후 다시 시도하세요.' });
      return;
    }
    setOcrLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/gemini/ocr`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          screenshotPath: captureResult.screenshotPath,
          bounds: selectedBounds
        })
      });
      const data = await res.json();
      if (data?.ok) {
        setOcrModal({ text: data.text, source: captureResult.screenshotPath });
      } else {
        setOcrModal({ error: data?.error || 'Gemini OCR 실패' });
      }
    } catch (e) {
      setOcrModal({ error: String(e) });
    } finally {
      setOcrLoading(false);
    }
  };

  const saveGeminiSettings = async () => {
    if (geminiSaving) return;
    setGeminiSaving(true);
    setGeminiSaveMessage(null);
    try {
      const res = await fetch(`${API_BASE}/api/settings/gemini`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...(geminiKeyInput.trim() ? { apiKey: geminiKeyInput.trim() } : {}),
          model: geminiModelInput.trim()
        })
      });
      const data = await res.json();
      if (data?.ok) {
        setGeminiStatus(!!data.enabled, data.model);
        setGeminiKeyInput('');
        setGeminiKeyEditing(false);
        setGeminiSaveMessage('저장되었습니다.');
      } else {
        setGeminiSaveMessage(data?.error || '저장 실패');
      }
    } catch (e) {
      setGeminiSaveMessage(String(e));
    } finally {
      setGeminiSaving(false);
    }
  };

  const clearGeminiSettings = async () => {
    if (geminiSaving) return;
    setGeminiSaving(true);
    setGeminiSaveMessage(null);
    try {
      const res = await fetch(`${API_BASE}/api/settings/gemini`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clear: true, model: geminiModelInput.trim() })
      });
      const data = await res.json();
      if (data?.ok) {
        setGeminiStatus(false, data.model);
        setGeminiKeyInput('');
        setGeminiKeyEditing(false);
        setGeminiSaveMessage('Gemini 키가 제거되었습니다.');
      } else {
        setGeminiSaveMessage(data?.error || '제거 실패');
      }
    } catch (e) {
      setGeminiSaveMessage(String(e));
    } finally {
      setGeminiSaving(false);
    }
  };

  if (!parsedCapture) {
    return <div>No capture data</div>;
  }
  
  // Debug tree structure
  React.useEffect(() => {
    if (parsedCapture?.tree) {
      console.log('[AnalyzePage] Tree received:', parsedCapture.tree);
      console.log('[AnalyzePage] Tree type:', parsedCapture.tree.type);
      console.log('[AnalyzePage] Tree children:', parsedCapture.tree.children?.length || 0);
      if (parsedCapture.tree.children && parsedCapture.tree.children[0]) {
        console.log('[AnalyzePage] First child:', parsedCapture.tree.children[0]);
        console.log('[AnalyzePage] First child children:', parsedCapture.tree.children[0].children?.length || 0);
      }
    }
  }, [parsedCapture]);

  return (
    <div style={{
      height: '100vh',
      background: 'radial-gradient(circle at 50% 0%, #1f2937 0%, #0b1221 100%)',
      display: 'flex',
      flexDirection: 'column',
    }}>
      {/* Header */}
      <div style={{
        background: '#0e1726',
        borderBottom: '1px solid #1f2937',
        padding: '12px 20px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
      }}>
        <button
          onClick={() => setPage('devices')}
          style={{
            background: '#1f2937',
            border: '1px solid #374151',
            color: '#e5e7eb',
            padding: '8px 16px',
            borderRadius: '8px',
            cursor: 'pointer',
            fontWeight: '600',
            fontSize: '14px',
          }}
        >
          ← Back to Devices
        </button>
        
        <div style={{ color: '#94a3b8', fontSize: '13px' }}>
          Captured from: <span style={{ color: '#22c55e', fontWeight: '600' }}>{parsedCapture.deviceId}</span>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '6px' }}>
          <div style={{ display: 'flex', gap: '8px' }}>
            <button
              onClick={() => setShowSettingsModal(true)}
              aria-label="Settings"
              aria-haspopup="dialog"
              aria-expanded={showSettingsModal}
              style={{
                background: '#1f2937',
                border: '1px solid #4b5563',
                color: '#e5e7eb',
                padding: '8px 12px',
                borderRadius: '8px',
                cursor: 'pointer',
                fontWeight: '600',
                fontSize: '16px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
              title="Settings"
            >
              ⚙️
            </button>
            <button
              onClick={handleRecapture}
              style={{
                background: capturing ? '#64748b' : '#0ea5e9',
                border: 'none',
                color: '#fff',
                padding: '8px 16px',
                borderRadius: '8px',
                cursor: capturing ? 'not-allowed' : 'pointer',
                fontWeight: '600',
                fontSize: '14px',
                opacity: capturing ? 0.7 : 1
              }}
              disabled={capturing}
            >
              {capturing ? 'Capturing...' : 'Capture'}
            </button>
            <button
              onClick={handleSave}
              style={{
                background: saveLoading ? '#64748b' : '#8b5cf6',
                border: 'none',
                color: '#fff',
                padding: '8px 16px',
                borderRadius: '8px',
                cursor: saveLoading ? 'not-allowed' : 'pointer',
                fontWeight: '600',
                fontSize: '14px',
                opacity: saveLoading ? 0.7 : 1
              }}
              disabled={saveLoading}
            >
              {saveLoading ? 'Saving...' : 'Save'}
            </button>
            <button
              onClick={openCodeModal}
              disabled={!selectedNode}
              style={{
                background: selectedNode ? '#2563eb' : '#475569',
                border: 'none',
                color: '#fff',
                padding: '8px 16px',
                borderRadius: '8px',
                cursor: selectedNode ? 'pointer' : 'not-allowed',
                fontWeight: '600',
                fontSize: '14px',
                opacity: selectedNode ? 1 : 0.7
              }}
              title={selectedNode ? '코드 추천' : '요소를 먼저 선택하세요.'}
            >
              코드 추천
            </button>
            <button
              onClick={runGeminiOcr}
              style={{
                background: geminiEnabled && !ocrLoading ? '#22c55e' : '#475569',
                border: 'none',
                color: '#000',
                padding: '8px 16px',
                borderRadius: '8px',
                cursor: geminiEnabled && !ocrLoading ? 'pointer' : 'not-allowed',
                fontWeight: '700',
                fontSize: '14px',
                opacity: geminiEnabled ? 1 : 0.7
              }}
              disabled={!geminiEnabled || ocrLoading}
              title={geminiEnabled ? 'Gemini OCR' : 'GEMINI_API_KEY 가 설정되지 않았습니다.'}
            >
              {ocrLoading ? 'Gemini…' : 'Gemini OCR'}
            </button>
          </div>
          {saveMessage && (
            <div
              title={saveMessage}
              style={{
                color: saveMessageError ? '#f87171' : '#34d399',
                fontSize: '11px',
                maxWidth: '420px',
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis'
              }}
            >
              {saveMessage}
            </div>
          )}
        </div>
      </div>

      {/* Main Content: Dual Panel */}
      <div style={{
        flex: 1,
        display: 'grid',
        gridTemplateColumns: '1fr 1fr',
        gap: '16px',
        padding: '16px',
        overflow: 'hidden',
      }}>
        <Overlay
          screenshot={parsedCapture.screenshot}
          tree={parsedCapture.tree}
          selectedNode={selectedNode}
          onSelect={setSelectedNode}
          showDebug={showDebugPanel}
        />
        <TreeView
          tree={parsedCapture.tree}
          selectedNode={selectedNode}
          onSelect={setSelectedNode}
          showDebug={showDebugPanel}
        />
      </div>

      {/* Selected Node Info - Always visible */}
      {selectedNode && (
        <div style={{
          background: '#0e1726',
          borderTop: '1px solid #1f2937',
          padding: '16px 20px',
          height: '180px',
          overflow: 'auto',
        }}>
          <div style={{ color: '#cbd5e1', fontWeight: '700', marginBottom: '8px' }}>
            Selected Element
            {selectedNode.accessible === 'true' && (
              <span style={{ marginLeft: '8px', fontSize: '11px', color: '#a78bfa', fontWeight: '600' }}>♿ accessible</span>
            )}
          </div>
          <div style={{ fontFamily: 'monospace', fontSize: '13px', color: '#94a3b8' }}>
            <div><span style={{ color: '#60a5fa' }}>type:</span> {selectedNode.type}</div>
            {selectedNode.name && <div><span style={{ color: '#34d399' }}>name:</span> {selectedNode.name}</div>}
            {selectedNode.label && <div><span style={{ color: '#a78bfa' }}>label:</span> {selectedNode.label}</div>}
            {selectedNode.value && <div><span style={{ color: '#f472b6' }}>value:</span> {selectedNode.value}</div>}
            {selectedNode.traits && <div><span style={{ color: '#fb923c' }}>traits:</span> {selectedNode.traits}</div>}
            <div><span style={{ color: '#fbbf24' }}>bounds:</span> [{selectedNode.x}, {selectedNode.y}, {selectedNode.width}, {selectedNode.height}]</div>
          </div>
        </div>
      )}

      {/* Settings Modal */}
      {showSettingsModal && (
        <div
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: 'rgba(0, 0, 0, 0.7)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
          }}
          onClick={() => setShowSettingsModal(false)}
        >
          <div
            style={{
              background: '#0e1726',
              border: '1px solid #1f2937',
              borderRadius: '12px',
              padding: '24px',
              minWidth: '400px',
              boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.5)',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '20px' }}>
              <img
                src={APP_ICON}
                alt=""
                aria-hidden="true"
                style={{ width: '28px', height: '28px', borderRadius: '6px' }}
              />
              <h2 style={{ color: '#cbd5e1', margin: 0, fontSize: '18px', fontWeight: '700' }}>
                Settings
              </h2>
            </div>

            <div style={{ background: '#0b1221', border: '1px solid #1f2937', borderRadius: '10px', padding: '12px', marginBottom: '16px' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '6px' }}>
                <div style={{ color: '#e5e7eb', fontSize: '14px', fontWeight: '600' }}>Gemini API</div>
                <span
                  style={{
                    padding: '2px 8px',
                    borderRadius: '999px',
                    fontSize: '11px',
                    fontWeight: '600',
                    background: geminiEnabled ? 'rgba(34,197,94,0.12)' : 'rgba(248,113,113,0.12)',
                    color: geminiEnabled ? '#4ade80' : '#fca5a5',
                    border: '1px solid #1f2937'
                  }}
                >
                  {geminiEnabled ? '활성화됨' : '비활성화됨'}
                </span>
              </div>
              <div style={{ color: '#9ca3af', fontSize: '12px', marginBottom: '6px' }}>
                키는 Keychain에 안전 저장되며, 설정 파일에는 해시+솔트만 기록됩니다.
              </div>
              <div style={{ color: '#9ca3af', fontSize: '12px', marginBottom: '10px' }}>
                API 키는 Google AI Studio에서 발급할 수 있습니다.{' '}
                <a
                  href="https://aistudio.google.com/app/apikey"
                  target="_blank"
                  rel="noreferrer"
                  style={{ color: '#60a5fa', textDecoration: 'none' }}
                >
                  Gemini API 관리 페이지 열기
                </a>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                <input
                  type="password"
                  placeholder={geminiEnabled ? '설정됨 (변경 시 새 키 입력)' : 'Gemini API Key 입력'}
                  value={geminiEnabled && !geminiKeyEditing ? '••••••••••••' : geminiKeyInput}
                  onChange={(e) => setGeminiKeyInput(e.target.value)}
                  disabled={geminiEnabled && !geminiKeyEditing}
                  ref={geminiKeyInputRef}
                  style={{
                    width: '100%',
                    background: geminiEnabled && !geminiKeyEditing ? '#111827' : '#0e1726',
                    border: '1px solid #1f2937',
                    borderRadius: '8px',
                    padding: '8px 10px',
                    color: geminiEnabled && !geminiKeyEditing ? '#9ca3af' : '#e5e7eb',
                    fontSize: '13px'
                  }}
                />
                <input
                  type="text"
                  placeholder="gemini-2.5-flash"
                  value={geminiModelInput}
                  onChange={(e) => setGeminiModelInput(e.target.value)}
                  style={{
                    width: '100%',
                    background: '#0e1726',
                    border: '1px solid #1f2937',
                    borderRadius: '8px',
                    padding: '8px 10px',
                    color: '#e5e7eb',
                    fontSize: '13px'
                  }}
                />
                {geminiSaveMessage && (
                  <div style={{ color: '#fbbf24', fontSize: '12px' }}>{geminiSaveMessage}</div>
                )}
                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
                  {geminiEnabled && !geminiKeyEditing && (
                    <button
                      onClick={() => {
                        setGeminiKeyEditing(true);
                        setGeminiKeyInput('');
                        setTimeout(() => geminiKeyInputRef.current?.focus(), 0);
                      }}
                      disabled={geminiSaving}
                      style={{
                        background: '#111827',
                        border: '1px solid #374151',
                        color: '#cbd5e1',
                        padding: '6px 10px',
                        borderRadius: '8px',
                        cursor: geminiSaving ? 'wait' : 'pointer',
                        fontWeight: '600',
                        fontSize: '12px'
                      }}
                    >
                      키 변경
                    </button>
                  )}
                  <button
                    onClick={clearGeminiSettings}
                    disabled={geminiSaving}
                    style={{
                      background: '#1f2937',
                      border: '1px solid #374151',
                      color: '#9ca3af',
                      padding: '6px 10px',
                      borderRadius: '8px',
                      cursor: geminiSaving ? 'wait' : 'pointer',
                      fontWeight: '600',
                      fontSize: '12px'
                    }}
                  >
                    키 제거
                  </button>
                  <button
                    onClick={saveGeminiSettings}
                    disabled={geminiSaving || (!geminiKeyInput.trim() && !geminiEnabled)}
                    style={{
                      background: geminiSaving ? '#475569' : '#2563eb',
                      border: 'none',
                      color: '#fff',
                      padding: '6px 12px',
                      borderRadius: '8px',
                      cursor: geminiSaving ? 'wait' : 'pointer',
                      fontWeight: '600',
                      fontSize: '12px'
                    }}
                  >
                    {geminiSaving ? '저장 중...' : '저장'}
                  </button>
                </div>
              </div>
            </div>
            
            <div style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '12px 0',
              borderBottom: '1px solid #1f2937',
            }}>
              <div>
                <div style={{ color: '#e5e7eb', fontSize: '14px', fontWeight: '600', marginBottom: '4px' }}>
                  Debug Panel
                </div>
                <div style={{ color: '#9ca3af', fontSize: '12px' }}>
                  Show click detection debug info
                </div>
              </div>
              <button
                onClick={() => setShowDebugPanel(!showDebugPanel)}
                aria-pressed={showDebugPanel}
                aria-label="Debug Panel"
                style={{
                  background: showDebugPanel ? '#22c55e' : '#374151',
                  border: 'none',
                  color: showDebugPanel ? '#000' : '#9ca3af',
                  padding: '8px 16px',
                  borderRadius: '8px',
                  cursor: 'pointer',
                  fontWeight: '600',
                  fontSize: '13px',
                  minWidth: '60px',
                }}
              >
                {showDebugPanel ? 'ON' : 'OFF'}
              </button>
            </div>

            <div style={{ marginTop: '20px', display: 'flex', justifyContent: 'flex-end' }}>
              <button
                onClick={() => setShowSettingsModal(false)}
                style={{
                  background: '#2563eb',
                  border: 'none',
                  color: '#fff',
                  padding: '8px 20px',
                  borderRadius: '8px',
                  cursor: 'pointer',
                  fontWeight: '600',
                  fontSize: '14px',
                }}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {codeModalOpen && selectedNode && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.45)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1200
          }}
          onClick={() => setCodeModalOpen(false)}
        >
          <div
            style={{
              background: '#0b1221',
              borderRadius: 12,
              padding: 16,
              border: '1px solid #1f2937',
              width: '92vw',
              maxWidth: '1200px',
              maxHeight: '88vh',
              overflowY: 'auto',
              boxShadow: '0 10px 40px rgba(0,0,0,0.45)'
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <img
                  src={APP_ICON}
                  alt=""
                  aria-hidden="true"
                  style={{ width: '28px', height: '28px', borderRadius: '6px' }}
                />
                <div>
                  <div style={{ fontWeight: 800, color: '#e5e7eb' }}>
                    {selectedNode.label || selectedNode.name || selectedNode.value || selectedNode.type}
                  </div>
                  <div style={{ color: '#9ca3af', fontSize: 12 }}>
                    type: {selectedNode.type} · bounds: {buildBounds(selectedNode)}
                  </div>
                </div>
              </div>
              <button
                onClick={() => setCodeModalOpen(false)}
                style={{
                  border: 'none',
                  background: '#111827',
                  color: '#e5e7eb',
                  borderRadius: 6,
                  padding: '6px 10px',
                  cursor: 'pointer'
                }}
              >
                Close
              </button>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
              <div style={{ background: '#0e1726', borderRadius: 8, padding: 10, border: '1px solid #1f2937' }}>
                <div style={{ fontWeight: 700, marginBottom: 6 }}>Basic</div>
                <div style={{ fontSize: 12, color: '#9ca3af', lineHeight: 1.5 }}>
                  <div>Type: {selectedNode.type}</div>
                  <div>Name: {selectedNode.name || '-'}</div>
                  <div>Label: {selectedNode.label || '-'}</div>
                  <div>Value: {selectedNode.value || '-'}</div>
                  <div>Bounds: {buildBounds(selectedNode)}</div>
                </div>
              </div>
              <div style={{ background: '#0e1726', borderRadius: 8, padding: 10, border: '1px solid #1f2937' }}>
                <div style={{ fontWeight: 700, marginBottom: 6 }}>Flags</div>
                <div style={{ fontSize: 12, color: '#9ca3af', lineHeight: 1.5 }}>
                  <div>enabled: {String(selectedNode.enabled)}</div>
                  <div>visible: {String(selectedNode.visible)}</div>
                  <div>accessible: {String(selectedNode.accessible)}</div>
                </div>
              </div>
            </div>

            <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
              <button
                onClick={() => setCodeTab('appium1')}
                aria-pressed={codeTab === 'appium1'}
                style={{
                  border: '1px solid #1f2937',
                  background: codeTab === 'appium1' ? '#22c55e' : '#111827',
                  color: '#e5e7eb',
                  borderRadius: 6,
                  padding: '4px 10px',
                  cursor: 'pointer'
                }}
              >
                Appium 1.x
              </button>
              <button
                onClick={() => setCodeTab('appium2')}
                aria-pressed={codeTab === 'appium2'}
                style={{
                  border: '1px solid #1f2937',
                  background: codeTab === 'appium2' ? '#22c55e' : '#111827',
                  color: '#e5e7eb',
                  borderRadius: 6,
                  padding: '4px 10px',
                  cursor: 'pointer'
                }}
              >
                Appium 2.x
              </button>
              <button
                onClick={() => setCodeTab('gemini')}
                aria-pressed={codeTab === 'gemini'}
                style={{
                  border: '1px solid #1f2937',
                  background: codeTab === 'gemini' ? '#22c55e' : '#111827',
                  color: '#e5e7eb',
                  borderRadius: 6,
                  padding: '4px 10px',
                  cursor: geminiEnabled ? 'pointer' : 'not-allowed',
                  opacity: geminiEnabled ? 1 : 0.6
                }}
                disabled={!geminiEnabled}
              >
                Gemini
              </button>
            </div>

            {!geminiEnabled && (
              <div style={{ color: '#f87171', fontSize: 12, marginBottom: 10 }}>
                GEMINI_API_KEY 가 설정되지 않아 Gemini 기능이 비활성화되었습니다.
              </div>
            )}

            {codeTab !== 'gemini' && easyBlock && (
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fit, minmax(380px, 1fr))',
                  gap: 12,
                  marginBottom: 8
                }}
              >
                <div style={{ background: '#0e1726', borderRadius: 8, padding: 10, border: '1px solid #1f2937' }}>
                  <div style={{ fontWeight: 700, marginBottom: 4 }}>Easy (Python)</div>
                  <div style={{ color: '#94a3b8', fontSize: 12, marginBottom: 4 }}>
                    선택한 요소만 바로 찾고 클릭하는 기본 코드입니다. (가능하면 name/label 우선 사용)
                    <br />
                    {easyBlock.note}
                  </div>
                  <pre style={{ whiteSpace: 'pre-wrap', color: '#e5e7eb', fontSize: 12, lineHeight: 1.5, minHeight: 60, userSelect: 'text' }}>
                    {easyBlock.python}
                  </pre>
                  <button
                    onClick={() => copyToClipboard(easyBlock.python)}
                    style={{ marginTop: 4, background: '#2563eb', border: 'none', borderRadius: 6, color: '#fff', padding: '6px 10px', cursor: 'pointer' }}
                  >
                    Copy
                  </button>
                </div>
                <div style={{ background: '#0e1726', borderRadius: 8, padding: 10, border: '1px solid #1f2937' }}>
                  <div style={{ fontWeight: 700, marginBottom: 4 }}>Easy (Java)</div>
                  <div style={{ color: '#94a3b8', fontSize: 12, marginBottom: 4 }}>
                    선택한 요소만 바로 찾고 클릭하는 기본 코드입니다. (가능하면 name/label 우선 사용)
                    <br />
                    {easyBlock.note}
                  </div>
                  <pre style={{ whiteSpace: 'pre-wrap', color: '#e5e7eb', fontSize: 12, lineHeight: 1.5, minHeight: 60, userSelect: 'text' }}>
                    {easyBlock.java}
                  </pre>
                  <button
                    onClick={() => copyToClipboard(easyBlock.java)}
                    style={{ marginTop: 4, background: '#2563eb', border: 'none', borderRadius: 6, color: '#fff', padding: '6px 10px', cursor: 'pointer' }}
                  >
                    Copy
                  </button>
                </div>
              </div>
            )}

            {codeTab === 'gemini' && (
              <div style={{ background: '#0e1726', borderRadius: 8, padding: 10, border: '1px solid #1f2937', marginBottom: 10 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center' }}>
                  <div>
                    <div style={{ fontWeight: 700, marginBottom: 4 }}>Gemini 제안 (LLM)</div>
                    <div style={{ color: '#94a3b8', fontSize: 12 }}>화면과 선택한 요소를 보고 AI가 추천한 안정적인 코드입니다.</div>
                  </div>
                  <div style={{ display: 'flex', gap: 8 }}>
                    {geminiLocator.loading && (
                      <button
                        onClick={cancelGemini}
                        style={{ background: '#f97316', border: 'none', borderRadius: 6, color: '#fff', padding: '6px 10px', cursor: 'pointer' }}
                      >
                        취소
                      </button>
                    )}
                    <button
                      onClick={() => requestGemini()}
                      style={{
                        background: geminiEnabled && !geminiLocator.loading ? '#2563eb' : '#9ca3af',
                        border: 'none',
                        borderRadius: 6,
                        color: '#fff',
                        padding: '6px 10px',
                        cursor: geminiEnabled && !geminiLocator.loading ? 'pointer' : 'not-allowed'
                      }}
                      disabled={!geminiEnabled || geminiLocator.loading}
                    >
                      {geminiLocator.loading ? '요청 중...' : 'Gemini 추천'}
                    </button>
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 6, marginTop: 8, marginBottom: 8 }}>
                  <button
                    onClick={() => setGeminiVersion('1')}
                    aria-pressed={geminiVersion === '1'}
                    style={{
                      border: '1px solid #1f2937',
                      background: geminiVersion === '1' ? '#22c55e' : '#111827',
                      color: '#e5e7eb',
                      borderRadius: 6,
                      padding: '4px 10px',
                      cursor: 'pointer'
                    }}
                  >
                    Appium 1.x
                  </button>
                  <button
                    onClick={() => setGeminiVersion('2')}
                    aria-pressed={geminiVersion === '2'}
                    style={{
                      border: '1px solid #1f2937',
                      background: geminiVersion === '2' ? '#22c55e' : '#111827',
                      color: '#e5e7eb',
                      borderRadius: 6,
                      padding: '4px 10px',
                      cursor: 'pointer'
                    }}
                  >
                    Appium 2.x
                  </button>
                </div>

                {geminiLocator.loading && <div style={{ color: '#9ca3af' }}>Gemini 제안을 불러오는 중입니다...</div>}
                {!geminiLocator.loading && geminiLocator.error && (
                  <div style={{ color: '#f87171' }}>
                    오류: {geminiLocator.error}{' '}
                    <button
                      onClick={() => requestGemini()}
                      style={{ marginLeft: 8, background: '#2563eb', border: 'none', borderRadius: 6, color: '#fff', padding: '4px 8px', cursor: 'pointer' }}
                    >
                      재시도
                    </button>
                  </div>
                )}
                {!geminiLocator.loading && !geminiLocator.error && geminiLocator.data && (
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                    <div style={{ background: '#0b1221', borderRadius: 6, padding: 8, border: '1px solid #1f2937' }}>
                      <div style={{ fontWeight: 700, marginBottom: 4 }}>Python (Wait 포함)</div>
                      <pre style={{ whiteSpace: 'pre-wrap', color: '#e5e7eb', fontSize: 12, minHeight: 60, userSelect: 'text' }}>
                        {geminiLocator.data?.python || '(empty)'}
                      </pre>
                      <button
                        onClick={() => copyToClipboard(geminiLocator.data?.python || '')}
                        style={{ marginTop: 4, background: '#2563eb', border: 'none', borderRadius: 6, color: '#fff', padding: '4px 8px', cursor: 'pointer' }}
                      >
                        Copy
                      </button>
                    </div>
                    <div style={{ background: '#0b1221', borderRadius: 6, padding: 8, border: '1px solid #1f2937' }}>
                      <div style={{ fontWeight: 700, marginBottom: 4 }}>Java (Wait 포함)</div>
                      <pre style={{ whiteSpace: 'pre-wrap', color: '#e5e7eb', fontSize: 12, minHeight: 60, userSelect: 'text' }}>
                        {geminiLocator.data?.java || '(empty)'}
                      </pre>
                      <button
                        onClick={() => copyToClipboard(geminiLocator.data?.java || '')}
                        style={{ marginTop: 4, background: '#2563eb', border: 'none', borderRadius: 6, color: '#fff', padding: '4px 8px', cursor: 'pointer' }}
                      >
                        Copy
                      </button>
                    </div>
                    <div style={{ gridColumn: '1 / span 2', color: '#9ca3af', fontSize: 12 }}>
                      {geminiLocator.data?.note && <div>요약: {geminiLocator.data.note}</div>}
                      {geminiLocator.data?.hints && geminiLocator.data.hints.length > 0 && (
                        <div>힌트: {geminiLocator.data.hints.join(' · ')}</div>
                      )}
                      {geminiLocator.data?.risks && geminiLocator.data.risks.length > 0 && (
                        <div style={{ color: '#f87171' }}>위험: {geminiLocator.data.risks.join(' · ')}</div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            )}

            {codeTab !== 'gemini' && testExample && (
              <div style={{ marginTop: 12, background: '#0e1726', borderRadius: 8, padding: 10, border: '1px solid #1f2937', marginBottom: 10 }}>
                <div style={{ fontWeight: 700, marginBottom: 4 }}>
                  테스트 예제 (Appium {activeVersion}.x · Wait 포함)
                </div>
                <div style={{ color: '#94a3b8', fontSize: 12, marginBottom: 6 }}>
                  바로 붙여 넣어 실행할 수 있는 간단 예제입니다. driver 초기화만 추가하면 됩니다.
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                  <div style={{ background: '#0b1221', borderRadius: 6, padding: 8, border: '1px solid #1f2937' }}>
                    <div style={{ fontWeight: 700, marginBottom: 4 }}>Python</div>
                    <pre style={{ whiteSpace: 'pre-wrap', color: '#e5e7eb', fontSize: 12, minHeight: 60, userSelect: 'text' }}>
                      {testExample.python}
                    </pre>
                    <button
                      onClick={() => copyToClipboard(testExample.python)}
                      style={{ marginTop: 4, background: '#2563eb', border: 'none', borderRadius: 6, color: '#fff', padding: '4px 8px', cursor: 'pointer' }}
                    >
                      Copy
                    </button>
                  </div>
                  <div style={{ background: '#0b1221', borderRadius: 6, padding: 8, border: '1px solid #1f2937' }}>
                    <div style={{ fontWeight: 700, marginBottom: 4 }}>Java</div>
                    <pre style={{ whiteSpace: 'pre-wrap', color: '#e5e7eb', fontSize: 12, minHeight: 60, userSelect: 'text' }}>
                      {testExample.java}
                    </pre>
                    <button
                      onClick={() => copyToClipboard(testExample.java)}
                      style={{ marginTop: 4, background: '#2563eb', border: 'none', borderRadius: 6, color: '#fff', padding: '4px 8px', cursor: 'pointer' }}
                    >
                      Copy
                    </button>
                  </div>
                </div>
              </div>
            )}

            {codeTab !== 'gemini' && locatorSuggestions.length > 0 && (
              <>
                <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
                  <button
                    onClick={() => setCodeLang('python')}
                    aria-pressed={codeLang === 'python'}
                    style={{
                      border: '1px solid #1f2937',
                      background: codeLang === 'python' ? '#22c55e' : '#111827',
                      color: '#e5e7eb',
                      borderRadius: 6,
                      padding: '4px 10px',
                      cursor: 'pointer'
                    }}
                  >
                    Python
                  </button>
                  <button
                    onClick={() => setCodeLang('java')}
                    aria-pressed={codeLang === 'java'}
                    style={{
                      border: '1px solid #1f2937',
                      background: codeLang === 'java' ? '#22c55e' : '#111827',
                      color: '#e5e7eb',
                      borderRadius: 6,
                      padding: '4px 10px',
                      cursor: 'pointer'
                    }}
                  >
                    Java
                  </button>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 8 }}>
                  {locatorSuggestions.slice(0, 5).map((loc, idx) => (
                    <div key={idx} style={{ background: '#0e1726', borderRadius: 8, padding: 10, border: '1px solid #1f2937' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <div style={{ fontWeight: 700 }}>{loc.strategy}: {loc.value}</div>
                        <div
                          style={{
                            padding: '2px 8px',
                            borderRadius: 999,
                            fontSize: 11,
                            background:
                              loc.tier === 'recommended'
                                ? 'rgba(34,197,94,0.15)'
                                : loc.tier === 'alternative'
                                ? 'rgba(14,165,233,0.12)'
                                : 'rgba(248,113,113,0.14)',
                            color:
                              loc.tier === 'recommended' ? '#4ade80' : loc.tier === 'alternative' ? '#38bdf8' : '#fca5a5',
                            border: '1px solid #1f2937'
                          }}
                        >
                          {loc.tier} · {loc.score}
                        </div>
                      </div>
                      {loc.notes && loc.notes.length > 0 && (
                        <div style={{ color: '#94a3b8', fontSize: 12, marginTop: 4 }}>{loc.notes.join(' · ')}</div>
                      )}
                      {loc.risks && loc.risks.length > 0 && (
                        <div style={{ color: '#f87171', fontSize: 12, marginTop: 4 }}>위험: {loc.risks.join(' · ')}</div>
                      )}
                      <pre style={{ whiteSpace: 'pre-wrap', color: '#e5e7eb', fontSize: 12, minHeight: 60, userSelect: 'text' }}>
                        {codeLang === 'python' ? loc.codePython : loc.codeJava}
                      </pre>
                      <button
                        onClick={() => copyToClipboard(codeLang === 'python' ? loc.codePython : loc.codeJava)}
                        style={{ marginTop: 4, background: '#2563eb', border: 'none', borderRadius: 6, color: '#fff', padding: '4px 8px', cursor: 'pointer' }}
                      >
                        Copy
                      </button>
                    </div>
                  ))}
                </div>
              </>
            )}

            <div style={{ marginTop: 8, fontSize: 12, color: '#9ca3af' }}>
              선택한 요소 기준으로 코드가 생성됩니다.
            </div>
          </div>
        </div>
      )}

      {ocrModal && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.45)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1300
          }}
          onClick={() => setOcrModal(null)}
        >
          <div
            style={{
              background: '#0b1221',
              borderRadius: 12,
              padding: 16,
              border: '1px solid #1f2937',
              width: '780px',
              maxWidth: '94%',
              maxHeight: '88vh',
              overflowY: 'auto',
              boxShadow: '0 10px 40px rgba(0,0,0,0.55)'
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <img
                  src={APP_ICON}
                  alt=""
                  aria-hidden="true"
                  style={{ width: '28px', height: '28px', borderRadius: '6px' }}
                />
                <div>
                  <div style={{ fontWeight: 800, color: '#e5e7eb' }}>Gemini OCR 결과</div>
                  <div style={{ color: '#9ca3af', fontSize: 12 }}>
                    {ocrModal.error ? '에러' : 'mode: gemini'} {selectedBounds ? `· selected ${selectedBounds}` : ''}
                  </div>
                </div>
              </div>
              <button
                onClick={() => setOcrModal(null)}
                style={{
                  border: 'none',
                  background: '#111827',
                  color: '#e5e7eb',
                  borderRadius: 6,
                  padding: '6px 10px',
                  cursor: 'pointer'
                }}
              >
                Close
              </button>
            </div>
            {ocrModal.error && (
              <div style={{ color: '#f87171', marginBottom: 8, userSelect: 'text' }}>
                오류: {ocrModal.error}
                <button
                  onClick={runGeminiOcr}
                  style={{ marginLeft: 8, background: '#2563eb', border: 'none', borderRadius: 6, color: '#fff', padding: '4px 8px', cursor: 'pointer' }}
                >
                  재시도
                </button>
              </div>
            )}
            {!ocrModal.error && !ocrModal.text && <div style={{ color: '#9ca3af' }}>텍스트를 찾지 못했습니다.</div>}
            {!ocrModal.error && ocrModal.text && (
              <div style={{ background: '#0e1726', border: '1px solid #1f2937', borderRadius: 8, padding: 8, userSelect: 'text' }}>
                <div style={{ fontWeight: 700, color: '#e5e7eb', marginBottom: 4 }}>Gemini OCR</div>
                <div style={{ background: '#0b1221', borderRadius: 6, padding: 8, border: '1px solid #1f2937', color: '#e5e7eb', fontSize: 12, overflowX: 'auto' }}>
                  <div
                    style={{ lineHeight: 1.5 }}
                    dangerouslySetInnerHTML={{
                      __html: ocrModal.text
                        ? `<style>.gemini-html table { border-collapse: collapse; border: 1px solid #e5e7eb; } .gemini-html td, .gemini-html th { border: 1px solid #e5e7eb; padding: 4px 6px; vertical-align: top; }</style><div class=\"gemini-html\">${ocrModal.text}</div>`
                        : ''
                    }}
                  />
                </div>
                <button
                  onClick={() => copyToClipboard(ocrModal.text || '')}
                  style={{ background: '#2563eb', border: 'none', borderRadius: 6, color: '#fff', padding: '4px 8px', cursor: 'pointer', marginTop: 6 }}
                >
                  Copy
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
