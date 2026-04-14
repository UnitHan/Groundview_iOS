import fs from 'fs';
import https from 'https';
import { readGeminiKey, resolveGeminiModel } from './secureStore';

type GeminiPart = { text?: string; inline_data?: { mime_type: string; data: string } };

type GeminiRequest = {
  contents: Array<{ role: 'user' | 'model'; parts: GeminiPart[] }>;
  generationConfig?: {
    temperature?: number;
    topP?: number;
    maxOutputTokens?: number;
  };
};

type GeminiResponse = {
  candidates?: Array<{
    content?: {
      parts?: Array<{ text?: string }>;
    };
  }>;
  error?: { message?: string };
};

export type GeminiSuggestion = {
  python: string;
  java: string;
  note?: string;
  hints?: string[];
  risks?: string[];
};

type GeminiCodePayload = {
  node: any;
  appiumVersion?: '1' | '2';
  lang?: 'python' | 'java';
  screenshotPath?: string;
  bounds?: string;
};

type GeminiOcrPayload = {
  screenshotPath: string;
  bounds?: string;
};

function normalizeModel(raw?: string): string {
  let m = (raw || '').trim();
  if (!m) m = 'gemini-2.5-flash';
  if (m.startsWith('models/')) m = m.slice('models/'.length);
  if (m.endsWith('-latest')) m = m.slice(0, -'-latest'.length);
  if (m.startsWith('gemini-1.5')) m = 'gemini-2.5-flash';
  return `models/${m}`;
}

type LocatorCandidate = {
  strategy: 'accessibility id' | 'predicate' | 'class chain' | 'xpath';
  value: string;
  note?: string;
};

function escapeLocator(value: string): string {
  return value.replace(/"/g, '\\"');
}

function buildIosLocatorCandidates(node: any): LocatorCandidate[] {
  const name = (node?.name || '').trim();
  const label = (node?.label || '').trim();
  const value = (node?.value || '').trim();
  const type = (node?.type || '').trim();
  const candidates: LocatorCandidate[] = [];

  if (name) {
    candidates.push({ strategy: 'accessibility id', value: name, note: 'name' });
  }
  if (label && label !== name) {
    candidates.push({ strategy: 'accessibility id', value: label, note: 'label' });
  }

  if (label || name || value) {
    const parts: string[] = [];
    if (label) parts.push(`label CONTAINS "${escapeLocator(label)}"`);
    if (name) parts.push(`name CONTAINS "${escapeLocator(name)}"`);
    if (value) parts.push(`value CONTAINS "${escapeLocator(value)}"`);
    const predicate = parts.join(' OR ');
    candidates.push({ strategy: 'predicate', value: predicate, note: 'predicate' });
  }

  if (type) {
    candidates.push({ strategy: 'class chain', value: `**/${type}`, note: 'class chain' });
  }

  if (type && (name || label || value)) {
    const attrs: string[] = [];
    if (name) attrs.push(`@name="${escapeLocator(name)}"`);
    if (label) attrs.push(`@label="${escapeLocator(label)}"`);
    if (value) attrs.push(`@value="${escapeLocator(value)}"`);
    const predicate = attrs.length ? `[${attrs.map((a) => `(${a})`).join(' and ')}]` : '';
    candidates.push({ strategy: 'xpath', value: `//${type}${predicate}`, note: 'xpath' });
  }

  return candidates;
}

function pythonBy(strategy: LocatorCandidate['strategy'], version: '1' | '2'): string {
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
}

function javaLocatorExpr(strategy: LocatorCandidate['strategy'], value: string, version: '1' | '2'): string {
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
}

function buildBeginnerSuggestion(node: any, version: '1' | '2'): GeminiSuggestion {
  const candidates = buildIosLocatorCandidates(node);
  const primary = candidates[0];
  const fallback = candidates[1];
  const enabled = node?.enabled === 'true' || node?.enabled === true;
  const waitFn = enabled ? 'element_to_be_clickable' : 'presence_of_element_located';
  const javaWaitFn = enabled ? 'elementToBeClickable' : 'presenceOfElementLocated';

  const pythonImport =
    version === '1'
      ? 'from appium.webdriver.common.mobileby import MobileBy'
      : 'from appium.webdriver.common.appiumby import AppiumBy';
  const javaImport =
    version === '1' ? 'import io.appium.java_client.MobileBy;' : 'import io.appium.java_client.AppiumBy;';

  const pythonLocator = primary
    ? `(${pythonBy(primary.strategy, version)}, "${escapeLocator(primary.value)}")`
    : '(None, "")';
  const pythonFallback = fallback
    ? `# Plan B: (${pythonBy(fallback.strategy, version)}, "${escapeLocator(fallback.value)}")`
    : '# Plan B: 없음';

  const python = `${pythonImport}
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC

def run_test(driver, timeout: int = 10) -> bool:
    \"\"\"
    선택한 요소를 찾고 클릭하는 간단한 예제입니다.
    \"\"\"
    # Step 1) 로케이터 준비
    locator = ${pythonLocator}
    ${pythonFallback}

    # Step 2) 요소를 기다렸다가 클릭
    try:
        el = WebDriverWait(driver, timeout).until(
            EC.${waitFn}(locator)
        )
        el.click()
        return True
    except Exception:
        return False
`;

  const java = `${javaImport}
import io.appium.java_client.AppiumDriver;
import org.openqa.selenium.By;
import org.openqa.selenium.WebElement;
import org.openqa.selenium.support.ui.ExpectedConditions;
import org.openqa.selenium.support.ui.WebDriverWait;
import java.time.Duration;

public boolean runTest(AppiumDriver driver, int timeoutSeconds) {
    // Step 1) 로케이터 준비
    By locator = ${primary ? javaLocatorExpr(primary.strategy, primary.value, version) : 'By.xpath("//*")'};
    ${fallback ? `// Plan B: ${javaLocatorExpr(fallback.strategy, fallback.value, version)}` : '// Plan B: 없음'}

    // Step 2) 요소를 기다렸다가 클릭
    try {
        WebDriverWait wait = new WebDriverWait(driver, Duration.ofSeconds(timeoutSeconds));
        WebElement el = wait.until(ExpectedConditions.${javaWaitFn}(locator));
        el.click();
        return true;
    } catch (Exception e) {
        return false;
    }
}
`;

  return { python, java, note: 'Gemini 응답을 보완한 기본 템플릿입니다.' };
}

function cleanCodeBlock(code: string): string {
  let result = (code || '').trim();
  if (!result) return result;
  const wrapped =
    (result.startsWith('"') && result.endsWith('"')) || (result.startsWith("'") && result.endsWith("'"));
  if (wrapped) {
    result = result.slice(1, -1);
  }
  if (/\\n|\\r|\\t|\\"/.test(result)) {
    result = result.replace(/\\r\\n/g, '\n').replace(/\\n/g, '\n').replace(/\\r/g, '\r');
    result = result.replace(/\\t/g, '    ').replace(/\\"/g, '"');
  }
  return result.trim();
}

function finalizeSuggestion(
  suggestion: GeminiSuggestion | undefined,
  fallback: GeminiSuggestion
): GeminiSuggestion {
  const merged: GeminiSuggestion = {
    python: cleanCodeBlock(suggestion?.python || ''),
    java: cleanCodeBlock(suggestion?.java || ''),
    note: suggestion?.note,
    hints: suggestion?.hints,
    risks: suggestion?.risks
  };

  const missingPython =
    !merged.python ||
    merged.python.includes('Gemini 응답 원문') ||
    merged.python.includes('Python 코드가 누락');
  const missingJava =
    !merged.java ||
    merged.java.includes('Gemini 응답 원문') ||
    merged.java.includes('Java 코드가 누락');

  if (missingPython) merged.python = fallback.python;
  if (missingJava) merged.java = fallback.java;

  if (!merged.note) merged.note = fallback.note;

  return merged;
}

async function postJson(url: string, body: GeminiRequest, timeoutMs = 30000): Promise<{ status: number; text: string }> {
  const payload = JSON.stringify(body);
  return new Promise((resolve, reject) => {
    const target = new URL(url);
    const req = https.request(
      {
        method: 'POST',
        hostname: target.hostname,
        path: target.pathname + target.search,
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload)
        },
        timeout: timeoutMs
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (d) => chunks.push(typeof d === 'string' ? Buffer.from(d) : d));
        res.on('end', () => {
          resolve({ status: res.statusCode || 0, text: Buffer.concat(chunks).toString('utf8') });
        });
      }
    );
    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy(new Error(`Gemini request timeout after ${timeoutMs}ms`));
    });
    req.write(payload);
    req.end();
  });
}

function extractText(resp: GeminiResponse): string | undefined {
  return resp.candidates?.[0]?.content?.parts?.map((p) => p.text || '').join('') || undefined;
}

function extractCodeBlocks(text: string): Array<{ lang: string; code: string }> {
  const blocks: Array<{ lang: string; code: string }> = [];
  const re = /```([a-zA-Z0-9_-]+)?\s*([\s\S]*?)```/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(text)) !== null) {
    const lang = (match[1] || '').toLowerCase();
    const code = match[2]?.trim();
    if (!code) continue;
    blocks.push({ lang, code });
  }
  return blocks;
}

function escapeNewlinesInJsonStrings(raw: string): string {
  let out = '';
  let inString = false;
  let escaped = false;
  for (let i = 0; i < raw.length; i += 1) {
    const ch = raw[i];
    if (escaped) {
      out += ch;
      escaped = false;
      continue;
    }
    if (ch === '\\') {
      out += ch;
      escaped = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      out += ch;
      continue;
    }
    if (inString && ch === '\n') {
      out += '\\n';
      continue;
    }
    if (inString && ch === '\r') {
      out += '\\r';
      continue;
    }
    out += ch;
  }
  return out;
}

function safeJsonParse(text: string): any | undefined {
  const trimmed = text.trim();
  if (!trimmed) return undefined;
  try {
    return JSON.parse(trimmed);
  } catch {
    // ignore
  }

  try {
    return JSON.parse(escapeNewlinesInJsonStrings(trimmed));
  } catch {
    // ignore
  }

  const blocks = extractCodeBlocks(trimmed);
  const jsonBlocks = blocks.filter((b) => b.lang === 'json' || b.lang === 'application/json');
  const hasLikelyCodeFields = (raw: any): boolean => {
    if (!raw || typeof raw !== 'object') return false;
    if (typeof raw.python === 'string' || typeof raw.java === 'string' || typeof raw.py === 'string') return true;
    if (raw.result && typeof raw.result === 'object') return hasLikelyCodeFields(raw.result);
    if (raw.data && typeof raw.data === 'object') return hasLikelyCodeFields(raw.data);
    if (raw.code && typeof raw.code === 'object') return hasLikelyCodeFields(raw.code);
    return false;
  };

  for (const block of jsonBlocks) {
    try {
      const parsed = JSON.parse(block.code);
      if (hasLikelyCodeFields(parsed)) return parsed;
      return parsed;
    } catch {
      // continue
    }
    try {
      const parsed = JSON.parse(escapeNewlinesInJsonStrings(block.code));
      if (hasLikelyCodeFields(parsed)) return parsed;
      return parsed;
    } catch {
      // continue
    }
  }

  const matches = trimmed.match(/\{[\s\S]*?\}/g);
  if (!matches) return undefined;
  let fallback: any | undefined;
  for (const candidate of matches) {
    try {
      const parsed = JSON.parse(candidate);
      if (hasLikelyCodeFields(parsed)) return parsed;
      if (!fallback) fallback = parsed;
    } catch {
      // continue
    }
    try {
      const parsed = JSON.parse(escapeNewlinesInJsonStrings(candidate));
      if (hasLikelyCodeFields(parsed)) return parsed;
      if (!fallback) fallback = parsed;
    } catch {
      // continue
    }
  }
  return fallback;
}

function normalizeSuggestion(raw: any): GeminiSuggestion | undefined {
  if (!raw) return undefined;
  const root = Array.isArray(raw) ? raw[0] : raw;
  if (!root || typeof root !== 'object') return undefined;
  const container =
    (root.result && typeof root.result === 'object' && root.result) ||
    (root.data && typeof root.data === 'object' && root.data) ||
    (root.code && typeof root.code === 'object' && root.code) ||
    root;
  const pythonRaw =
    container.python ??
    container.py ??
    container.python_code ??
    container.pythonCode ??
    container.codePython ??
    container.code_python;
  const javaRaw =
    container.java ??
    container.java_code ??
    container.javaCode ??
    container.codeJava ??
    container.code_java;

  const python = typeof pythonRaw === 'string' ? pythonRaw : Array.isArray(pythonRaw) ? pythonRaw.join('\n') : '';
  const java = typeof javaRaw === 'string' ? javaRaw : Array.isArray(javaRaw) ? javaRaw.join('\n') : '';
  if (!python && !java) return undefined;
  const note =
    typeof container.note === 'string'
      ? container.note
      : typeof container.summary === 'string'
      ? container.summary
      : undefined;
  const hintsRaw = container.hints ?? container.hint;
  const risksRaw = container.risks ?? container.risk;
  const hints =
    Array.isArray(hintsRaw) ? hintsRaw.map(String).filter(Boolean) : typeof hintsRaw === 'string' ? [hintsRaw] : undefined;
  const risks =
    Array.isArray(risksRaw) ? risksRaw.map(String).filter(Boolean) : typeof risksRaw === 'string' ? [risksRaw] : undefined;
  return { python, java, note, hints, risks };
}

function extractSection(text: string, label: 'python' | 'java'): string | undefined {
  const re = new RegExp(`${label}\\s*[:：]\\s*([\\s\\S]*?)(?=\\n\\s*(python|java)\\s*[:：]|$)`, 'i');
  const match = text.match(re);
  const section = match?.[1]?.trim();
  return section || undefined;
}

function extractLabeledBlock(text: string, label: 'python' | 'java'): string | undefined {
  const lines = text.split(/\r?\n/);
  const labelRe = new RegExp(`^\\s*(?:[-*]\\s*)?(?:#+\\s*)?(?:\\*\\*\\s*)?${label}\\b`, 'i');
  const otherRe = new RegExp(`^\\s*(?:[-*]\\s*)?(?:#+\\s*)?(?:\\*\\*\\s*)?(python|java)\\b`, 'i');
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (!labelRe.test(line)) continue;
    let tail = line.replace(labelRe, '').trim();
    tail = tail.replace(/^[:：\-]+/, '').trim();
    if (tail === '|' || tail === '```') tail = '';
    const collected: string[] = [];
    if (tail) collected.push(tail);
    for (let j = i + 1; j < lines.length; j += 1) {
      const next = lines[j];
      if (otherRe.test(next)) break;
      collected.push(next);
    }
    const joined = collected.join('\n').trim();
    if (!joined) return undefined;
    return joined.replace(/^```[a-zA-Z0-9_-]*\s*|```$/g, '').trim();
  }
  return undefined;
}

function extractJsonLikeField(text: string, field: 'python' | 'java'): string | undefined {
  const re = new RegExp(`"${field}"\\s*:\\s*([\\s\\S]*?)(?=,\\s*"(python|java|note|hints|risks|summary|reason)"\\s*:|\\s*\\})`, 'i');
  const match = text.match(re);
  if (!match || !match[1]) return undefined;
  let value = match[1].trim();
  if (value.startsWith('"') && value.endsWith('"')) {
    value = value.slice(1, -1);
    value = value.replace(/\\\\/g, '\\').replace(/\\n/g, '\n').replace(/\\r/g, '\r').replace(/\\"/g, '"');
  }
  return value.trim() || undefined;
}

function parseGeminiSuggestion(text: string): GeminiSuggestion | undefined {
  const json = safeJsonParse(text);
  const normalized = normalizeSuggestion(json);
  if (normalized) return normalized;

  const blocks = extractCodeBlocks(text);
  let python = blocks.find((b) => b.lang.startsWith('python') || b.lang === 'py')?.code;
  let java = blocks.find((b) => b.lang.startsWith('java'))?.code;

  if (!python || !java) {
    const unlabeled = blocks.filter((b) => !b.lang);
    if (!python && unlabeled[0]) python = unlabeled[0].code;
    if (!java && unlabeled[1]) java = unlabeled[1].code;
  }

  if (!python || !java) {
    python = python || extractSection(text, 'python') || extractLabeledBlock(text, 'python');
    java = java || extractSection(text, 'java') || extractLabeledBlock(text, 'java');
  }

  if (!python || !java) {
    python = python || extractJsonLikeField(text, 'python');
    java = java || extractJsonLikeField(text, 'java');
  }

  if (!python && !java) return undefined;
  if (!python) {
    python = '# Gemini 응답에서 Python 코드가 누락되었습니다.';
  }
  if (!java) {
    java = '// Gemini 응답에서 Java 코드가 누락되었습니다.';
  }

  return {
    python: python.trim(),
    java: java.trim(),
    note: 'Gemini 응답 형식이 예상과 달라 추출 로직으로 복구했습니다.'
  };
}

function readImageBase64(filePath?: string): string | undefined {
  if (!filePath) return undefined;
  try {
    if (!fs.existsSync(filePath)) return undefined;
    return fs.readFileSync(filePath, { encoding: 'base64' });
  } catch {
    return undefined;
  }
}

export async function geminiGenerateCode(payload: GeminiCodePayload): Promise<{ ok: boolean; suggestion?: GeminiSuggestion; error?: string }>{
  const apiKey = await readGeminiKey();
  if (!apiKey) return { ok: false, error: 'GEMINI_API_KEY 가 설정되지 않았습니다.' };

  const model = normalizeModel(resolveGeminiModel());
  const versionLabel = payload.appiumVersion === '1' ? '1.x' : '2.x';
  const byClass = payload.appiumVersion === '1' ? 'MobileBy' : 'AppiumBy';

  const node = payload.node || {};
  const nodeSummary = {
    type: node.type,
    name: node.name,
    label: node.label,
    value: node.value,
    enabled: node.enabled,
    visible: node.visible,
    accessible: node.accessible,
    bounds: payload.bounds
  };

  const prompt = [
    `역할: 당신은 Appium ${versionLabel} 기반 iOS 테스트 자동화 전문가입니다.`,
    '입력: 선택된 iOS 노드 정보와 캡처 이미지를 제공합니다. 다른 요소 정보는 사용하지 마세요.',
    '목표: 초보자가 바로 실행할 수 있는 간단한 테스트 함수 코드를 생성합니다.',
    `버전 규칙: Appium ${versionLabel}에서는 ${byClass}를 사용합니다.`,
    payload.lang ? `선호 언어: ${payload.lang}` : '',
    '각 언어는 테스트 함수 하나만 포함합니다.',
    'Python: run_test(driver, timeout: int = 10) -> bool',
    'Java: public boolean runTest(AppiumDriver driver, int timeoutSeconds)',
    'driver 초기화 예시나 __main__ 블록은 넣지 마세요.',
    'WebDriverWait 필수. 클릭은 element_to_be_clickable(locator), 존재확인은 presence_of_element_located(locator).',
    'iOS 로케이터 우선순위:',
    `1) name(Accessibility ID) -> ${byClass}.ACCESSIBILITY_ID`,
    `2) label(Accessibility Label) -> ${byClass}.ACCESSIBILITY_ID`,
    `3) predicate(label/name/value) -> ${byClass}.IOS_PREDICATE`,
    `4) class chain -> ${byClass}.IOS_CLASS_CHAIN`,
    'Plan A 로케이터만 코드에 사용하고, Plan B 후보는 한 줄 주석으로만 남기세요.',
    'JSON 문자열은 줄바꿈을 \\n 이스케이프로만 포함하세요.',
    '응답은 오직 JSON 객체 하나만 반환합니다. 마크다운/백틱/자연어는 포함하지 마세요.',
    '{"python":"<Python 코드>", "java":"<Java 코드>", "risks":["..."], "hints":["..."], "note":"..."}',
    '아래는 선택된 노드 요약입니다.',
    JSON.stringify(nodeSummary)
  ]
    .filter(Boolean)
    .join('\n');

  const imageBase64 = readImageBase64(payload.screenshotPath);
  const parts: GeminiPart[] = [{ text: prompt }];
  if (imageBase64) {
    parts.push({ inline_data: { mime_type: 'image/png', data: imageBase64 } });
  }

  const body: GeminiRequest = {
    contents: [{ role: 'user', parts }],
    generationConfig: { temperature: 0.2, topP: 0.9, maxOutputTokens: 1200 }
  };

  const url = `https://generativelanguage.googleapis.com/v1/${model}:generateContent?key=${apiKey}`;
  try {
    const res = await postJson(url, body);
    if (res.status >= 400) {
      return { ok: false, error: `Gemini 오류 ${res.status}: ${res.text.slice(0, 300)}` };
    }
    const parsed = JSON.parse(res.text) as GeminiResponse;
    if (parsed.error?.message) return { ok: false, error: parsed.error.message };
    const text = extractText(parsed);
    if (!text) return { ok: false, error: 'Gemini 응답에 텍스트가 없습니다.' };
    const fallback = buildBeginnerSuggestion(node, payload.appiumVersion === '1' ? '1' : '2');
    const suggestion = parseGeminiSuggestion(text);
    const finalSuggestion = finalizeSuggestion(suggestion, fallback);
    if (!finalSuggestion.python || !finalSuggestion.java) {
      return { ok: false, error: 'Gemini 응답 파싱 실패' };
    }
    return { ok: true, suggestion: finalSuggestion };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function geminiOcr(payload: GeminiOcrPayload): Promise<{ ok: boolean; text?: string; error?: string }>{
  const apiKey = await readGeminiKey();
  if (!apiKey) return { ok: false, error: 'GEMINI_API_KEY 가 설정되지 않았습니다.' };

  const model = normalizeModel(resolveGeminiModel());
  const imageBase64 = readImageBase64(payload.screenshotPath);
  if (!imageBase64) return { ok: false, error: '스크린샷을 읽을 수 없습니다.' };

  const boundsHint = payload.bounds ? `선택 영역(bounds): ${payload.bounds}` : '선택 영역: 전체 화면';
  const prompt = [
    '이미지에서 보이는 모든 한글/영문 텍스트를 빠짐없이 추출하세요.',
    '출력은 HTML 조각으로만 반환하세요. Markdown/JSON/코드펜스는 금지입니다.',
    '문장은 <p>로 감싸고 읽는 순서를 유지하세요.',
    '표가 있으면 <table><tbody>...</tbody></table> 형태로 복원하세요.',
    boundsHint
  ].join('\n');

  const body: GeminiRequest = {
    contents: [
      {
        role: 'user',
        parts: [
          { text: prompt },
          { inline_data: { mime_type: 'image/png', data: imageBase64 } }
        ]
      }
    ],
    generationConfig: { temperature: 0.2, topP: 0.9, maxOutputTokens: 1200 }
  };

  const url = `https://generativelanguage.googleapis.com/v1/${model}:generateContent?key=${apiKey}`;
  try {
    const res = await postJson(url, body);
    if (res.status >= 400) {
      return { ok: false, error: `Gemini 오류 ${res.status}: ${res.text.slice(0, 300)}` };
    }
    const parsed = JSON.parse(res.text) as GeminiResponse;
    if (parsed.error?.message) return { ok: false, error: parsed.error.message };
    const text = extractText(parsed);
    if (!text) return { ok: false, error: 'Gemini OCR 응답이 비어있습니다.' };
    return { ok: true, text };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
