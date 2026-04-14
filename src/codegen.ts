export type LocatorKind = 'accessibilityId' | 'predicate' | 'classChain' | 'xpath' | 'coordinates';

export type LocatorCandidate =
  | { kind: Exclude<LocatorKind, 'coordinates'>; value: string; note?: string }
  | { kind: 'coordinates'; value: { x: number; y: number }; note?: string };

export type Language = 'python' | 'java';
export type AppiumVersion = 1 | 2 | 3;

export type CodegenOptions = {
  language: Language;
  appiumVersion: AppiumVersion;
  action?: 'tap' | 'none';
};

export type CodegenResult = {
  locator?: LocatorCandidate;
  code: string;
};

export type BulkClickItem = {
  name?: string;
  locators: LocatorCandidate[];
};

export type BulkScriptResult = {
  code: string;
  resolved: { name?: string; locator?: LocatorCandidate }[];
};

const PRIORITY: LocatorKind[] = ['accessibilityId', 'predicate', 'classChain', 'xpath', 'coordinates'];

function pickLocator(candidates: LocatorCandidate[]): LocatorCandidate | undefined {
  for (const kind of PRIORITY) {
    const found = candidates.find((c) => c.kind === kind && c.value);
    if (found) return found;
  }
  return undefined;
}

function pythonFinder(locator: LocatorCandidate, version: AppiumVersion): string {
  const by =
    version === 1 ? 'MobileBy' : 'AppiumBy';
  if (locator.kind === 'coordinates') {
    return `driver.execute_script("mobile: tap", {"x": ${locator.value.x}, "y": ${locator.value.y}})`;
  }
  const map: Record<string, string> = {
    accessibilityId: `${by}.ACCESSIBILITY_ID`,
    predicate: `${by}.IOS_PREDICATE`,
    classChain: `${by}.IOS_CLASS_CHAIN`,
    xpath: `${by}.XPATH`
  };
  return `el = driver.find_element(${map[locator.kind]}, "${locator.value}")`;
}

function renderPython(locator: LocatorCandidate, opts: CodegenOptions): string {
  const importLine =
    opts.appiumVersion === 1
      ? 'from appium.webdriver.common.mobileby import MobileBy'
      : 'from appium.webdriver.common.appiumby import AppiumBy';
  if (locator.kind === 'coordinates') {
    return [
      importLine,
      '',
      pythonFinder(locator, opts.appiumVersion)
    ].join('\n');
  }
  const clickLine = opts.action === 'tap' ? 'el.click()' : '';
  return [importLine, '', pythonFinder(locator, opts.appiumVersion), clickLine].filter(Boolean).join('\n');
}

function javaFinder(locator: LocatorCandidate, version: AppiumVersion): string {
  const byClass = version === 1 ? 'MobileBy' : 'AppiumBy';
  if (locator.kind === 'coordinates') {
    return `driver.executeScript("mobile: tap", Map.of("x", ${locator.value.x}, "y", ${locator.value.y}));`;
  }
  const map: Record<string, string> = {
    accessibilityId: `${byClass}.accessibilityId("${locator.value}")`,
    predicate: `${byClass}.iOSNsPredicateString("${locator.value}")`,
    classChain: `${byClass}.iOSClassChain("${locator.value}")`,
    xpath: `By.xpath("${locator.value}")`
  };
  return `WebElement el = driver.findElement(${map[locator.kind]});`;
}

function renderJava(locator: LocatorCandidate, opts: CodegenOptions): string {
  const byImport =
    opts.appiumVersion === 1
      ? 'import io.appium.java_client.MobileBy;'
      : 'import io.appium.java_client.AppiumBy;';
  const imports = [
    'import org.openqa.selenium.By;',
    'import org.openqa.selenium.WebElement;',
    byImport,
    'import java.util.Map;'
  ];
  if (locator.kind === 'coordinates') {
    return [...imports, '', javaFinder(locator, opts.appiumVersion)].join('\n');
  }
  const clickLine = opts.action === 'tap' ? 'el.click();' : '';
  return [...imports, '', javaFinder(locator, opts.appiumVersion), clickLine]
    .filter(Boolean)
    .join('\n');
}

export function generateAppiumSnippet(
  candidates: LocatorCandidate[],
  opts: CodegenOptions
): CodegenResult {
  const locator = pickLocator(candidates);
  if (!locator) {
    return {
      locator: undefined,
      code: '# no locator candidates'
    };
  }
  if (opts.language === 'python') {
    return { locator, code: renderPython(locator, opts) };
  }
  return { locator, code: renderJava(locator, opts) };
}

function pythonImports(opts: CodegenOptions): string[] {
  return [
    opts.appiumVersion === 1
      ? 'from appium.webdriver.common.mobileby import MobileBy'
      : 'from appium.webdriver.common.appiumby import AppiumBy'
  ];
}

function javaImports(opts: CodegenOptions): string[] {
  return [
    'import org.openqa.selenium.By;',
    'import org.openqa.selenium.WebElement;',
    opts.appiumVersion === 1
      ? 'import io.appium.java_client.MobileBy;'
      : 'import io.appium.java_client.AppiumBy;',
    'import java.util.Map;'
  ];
}

function renderPythonBulk(items: BulkClickItem[], opts: CodegenOptions): BulkScriptResult {
  const imports = pythonImports(opts);
  const lines: string[] = [...imports, '', 'def click_all(driver):'];
  const resolved: { name?: string; locator?: LocatorCandidate }[] = [];
  for (const item of items) {
    const locator = pickLocator(item.locators);
    resolved.push({ name: item.name, locator });
    const label = item.name || 'item';
    if (!locator) {
      lines.push(`    # skipped ${label}: no locator`);
      continue;
    }
    if (locator.kind === 'coordinates') {
      lines.push(`    # ${label}`);
      lines.push(
        `    driver.execute_script("mobile: tap", {"x": ${locator.value.x}, "y": ${locator.value.y}})`
      );
      continue;
    }
    lines.push(`    # ${label}`);
    lines.push(pythonFinder(locator, opts.appiumVersion).replace(/^/gm, '    '));
    lines.push('    el.click()');
  }
  return { code: lines.join('\n'), resolved };
}

function renderJavaBulk(items: BulkClickItem[], opts: CodegenOptions): BulkScriptResult {
  const imports = javaImports(opts);
  const lines: string[] = [...imports, '', 'public void clickAll(AppiumDriver driver) {'];
  const resolved: { name?: string; locator?: LocatorCandidate }[] = [];
  for (const item of items) {
    const locator = pickLocator(item.locators);
    resolved.push({ name: item.name, locator });
    const label = item.name || 'item';
    if (!locator) {
      lines.push(`    // skipped ${label}: no locator`);
      continue;
    }
    if (locator.kind === 'coordinates') {
      lines.push(`    // ${label}`);
      lines.push(
        `    driver.executeScript("mobile: tap", Map.of("x", ${locator.value.x}, "y", ${locator.value.y}));`
      );
      continue;
    }
    lines.push(`    // ${label}`);
    lines.push(javaFinder(locator, opts.appiumVersion).replace(/^/gm, '    '));
    lines.push('    el.click();');
  }
  lines.push('}');
  return { code: lines.join('\n'), resolved };
}

export function generateBulkClickScript(
  items: BulkClickItem[],
  opts: CodegenOptions
): BulkScriptResult {
  if (opts.language === 'python') {
    return renderPythonBulk(items, opts);
  }
  return renderJavaBulk(items, opts);
}
