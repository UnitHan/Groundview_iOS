import { describe, expect, it } from 'vitest';
import { generateAppiumSnippet, generateBulkClickScript, LocatorCandidate, BulkClickItem } from './codegen';

const candidates: LocatorCandidate[] = [
  { kind: 'predicate', value: "name == 'Settings'" },
  { kind: 'accessibilityId', value: 'settings_button' },
  { kind: 'classChain', value: '**/XCUIElementTypeButton[`name == "Settings"`]' }
];

describe('generateAppiumSnippet', () => {
  it('picks accessibilityId first and renders python Appium 2/3 snippet', () => {
    const result = generateAppiumSnippet(candidates, {
      language: 'python',
      appiumVersion: 2,
      action: 'tap'
    });
    expect(result.locator?.kind).toBe('accessibilityId');
    expect(result.code).toContain('AppiumBy.ACCESSIBILITY_ID');
    expect(result.code).toContain('driver.find_element');
    expect(result.code).toContain('el.click()');
  });

  it('renders MobileBy for Appium 1 (java)', () => {
    const result = generateAppiumSnippet(candidates, {
      language: 'java',
      appiumVersion: 1,
      action: 'tap'
    });
    expect(result.locator?.kind).toBe('accessibilityId');
    expect(result.code).toContain('MobileBy');
    expect(result.code).toContain('driver.findElement');
    expect(result.code).toContain('el.click();');
  });

  it('falls back to coordinates', () => {
    const result = generateAppiumSnippet(
      [{ kind: 'coordinates', value: { x: 120, y: 240 } }],
      { language: 'java', appiumVersion: 3, action: 'tap' }
    );
    expect(result.locator?.kind).toBe('coordinates');
    expect(result.code).toContain('mobile: tap');
  });
});

describe('generateBulkClickScript', () => {
  const items: BulkClickItem[] = [
    {
      name: 'settings',
      locators: [
        { kind: 'predicate', value: "name == 'Settings'" },
        { kind: 'accessibilityId', value: 'settings_button' }
      ]
    },
    {
      name: 'fallback',
      locators: [{ kind: 'coordinates', value: { x: 10, y: 20 } }]
    }
  ];

  it('renders python bulk click function', () => {
    const result = generateBulkClickScript(items, { language: 'python', appiumVersion: 2 });
    expect(result.code).toContain('def click_all');
    expect(result.code).toContain('settings');
    expect(result.code).toContain('driver.execute_script');
    expect(result.resolved[0].locator?.kind).toBe('accessibilityId');
  });

  it('renders java bulk click method', () => {
    const result = generateBulkClickScript(items, { language: 'java', appiumVersion: 3 });
    expect(result.code).toContain('public void clickAll');
    expect(result.code).toContain('driver.executeScript');
    expect(result.resolved[1].locator?.kind).toBe('coordinates');
  });
});
