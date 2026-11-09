// Test file to diagnose XML parsing issues
import { parseString } from 'xml2js';
import fs from 'fs';

// Sample WDA JSON response
const wdaJsonSample = `{
  "value": "<?xml version=\\"1.0\\" encoding=\\"UTF-8\\"?>\\n<XCUIElementTypeApplication type=\\"XCUIElementTypeApplication\\" name=\\"익시오\\" label=\\"익시오\\" enabled=\\"true\\" visible=\\"true\\" accessible=\\"false\\" x=\\"0\\" y=\\"0\\" width=\\"390\\" height=\\"844\\" index=\\"0\\" traits=\\"\\">\\n  <XCUIElementTypeWindow type=\\"XCUIElementTypeWindow\\" enabled=\\"true\\" visible=\\"true\\" accessible=\\"false\\" x=\\"0\\" y=\\"0\\" width=\\"390\\" height=\\"844\\" index=\\"0\\" traits=\\"\\">\\n    <XCUIElementTypeOther type=\\"XCUIElementTypeOther\\" enabled=\\"true\\" visible=\\"true\\" accessible=\\"false\\" x=\\"0\\" y=\\"0\\" width=\\"390\\" height=\\"844\\" index=\\"0\\" traits=\\"\\">\\n      <XCUIElementTypeStaticText type=\\"XCUIElementTypeStaticText\\" value=\\"설정\\" name=\\"설정\\" label=\\"설정\\" enabled=\\"true\\" visible=\\"true\\" accessible=\\"true\\" x=\\"14\\" y=\\"61\\" width=\\"40\\" height=\\"28\\" index=\\"0\\" traits=\\"StaticText\\"/>\\n      <XCUIElementTypeButton type=\\"XCUIElementTypeButton\\" name=\\"button1\\" label=\\"button1\\" enabled=\\"true\\" visible=\\"true\\" accessible=\\"true\\" x=\\"301\\" y=\\"62\\" width=\\"26\\" height=\\"26\\" index=\\"1\\" traits=\\"Button\\"/>\\n      <XCUIElementTypeImage type=\\"XCUIElementTypeImage\\" name=\\"image1\\" label=\\"image1\\" enabled=\\"true\\" visible=\\"true\\" accessible=\\"true\\" x=\\"25\\" y=\\"253\\" width=\\"26\\" height=\\"25\\" index=\\"1\\" traits=\\"Image\\"/>\\n    </XCUIElementTypeOther>\\n  </XCUIElementTypeWindow>\\n</XCUIElementTypeApplication>\\n"
}`;

// Extract XML from WDA JSON response
function extractXmlFromWdaResponse(jsonStr: string): string {
  try {
    const parsed = JSON.parse(jsonStr);
    return parsed.value || jsonStr;
  } catch (e) {
    return jsonStr;
  }
}

// Current parsing approach (BROKEN)
async function parseXmlToTreeCurrent(xml: string): Promise<any> {
  return new Promise((resolve, reject) => {
    parseString(xml, { explicitArray: false, mergeAttrs: true }, (err, result) => {
      if (err) {
        reject(err);
        return;
      }
      
      console.log('=== CURRENT PARSER DEBUG ===');
      console.log('Root keys:', Object.keys(result));
      console.log('Result structure:', JSON.stringify(result, null, 2).substring(0, 500));
      
      const transform = (node: any, elementType?: string): any => {
        if (!node || typeof node !== 'object') return null;
        
        const output: any = {
          type: elementType || node.type || 'Unknown',
          name: node.name || undefined,
          label: node.label || undefined,
          value: node.value || undefined,
          x: node.x || '0',
          y: node.y || '0',
          width: node.width || '0',
          height: node.height || '0',
        };
        
        const children: any[] = [];
        for (const key of Object.keys(node)) {
          if (!key.startsWith('XCUIElementType')) continue;
          
          const childOrChildren = node[key];
          if (Array.isArray(childOrChildren)) {
            for (const child of childOrChildren) {
              const transformed = transform(child, key);
              if (transformed) children.push(transformed);
            }
          } else if (childOrChildren && typeof childOrChildren === 'object') {
            const transformed = transform(childOrChildren, key);
            if (transformed) children.push(transformed);
          }
        }
        
        if (children.length > 0) {
          output.children = children;
        }
        
        return output;
      };
      
      let root = result.XCUIElementTypeApplication;
      if (!root) {
        reject(new Error('Could not find root element'));
        return;
      }
      
      const transformed = transform(root, 'XCUIElementTypeApplication');
      console.log('Transformed result:', JSON.stringify(transformed, null, 2).substring(0, 500));
      resolve(transformed);
    });
  });
}

// Fixed parsing approach
async function parseXmlToTreeFixed(xml: string): Promise<any> {
  return new Promise((resolve, reject) => {
    parseString(xml, { explicitArray: false, mergeAttrs: true }, (err, result) => {
      if (err) {
        reject(err);
        return;
      }
      
      console.log('\\n=== FIXED PARSER DEBUG ===');
      console.log('Root keys:', Object.keys(result));
      
      const transform = (node: any, elementType: string): any => {
        if (!node || typeof node !== 'object') return null;
        
        // Build output node with attributes
        const output: any = {
          type: elementType,
          name: node.name || undefined,
          label: node.label || undefined,
          value: node.value || undefined,
          enabled: node.enabled || undefined,
          visible: node.visible || undefined,
          accessible: node.accessible || undefined,
          x: node.x || '0',
          y: node.y || '0',
          width: node.width || '0',
          height: node.height || '0',
          index: node.index || undefined,
          traits: node.traits || undefined,
        };
        
        // Find all child elements (keys starting with XCUIElementType)
        const children: any[] = [];
        for (const key of Object.keys(node)) {
          if (!key.startsWith('XCUIElementType')) continue;
          
          const childOrChildren = node[key];
          
          if (Array.isArray(childOrChildren)) {
            // Multiple children of same type
            for (const child of childOrChildren) {
              const transformed = transform(child, key);
              if (transformed) children.push(transformed);
            }
          } else if (childOrChildren && typeof childOrChildren === 'object') {
            // Single child
            const transformed = transform(childOrChildren, key);
            if (transformed) children.push(transformed);
          }
        }
        
        if (children.length > 0) {
          output.children = children;
        }
        
        return output;
      };
      
      const root = result.XCUIElementTypeApplication;
      if (!root) {
        reject(new Error('Could not find root element'));
        return;
      }
      
      const transformed = transform(root, 'XCUIElementTypeApplication');
      console.log('Fixed transformed result:', JSON.stringify(transformed, null, 2).substring(0, 1000));
      resolve(transformed);
    });
  });
}

// Count nodes in tree
function countNodes(node: any): number {
  if (!node) return 0;
  let count = 1;
  if (node.children) {
    for (const child of node.children) {
      count += countNodes(child);
    }
  }
  return count;
}

// Run tests
async function runTests() {
  console.log('\\n============================================');
  console.log('WDA XML PARSER DIAGNOSTIC TEST');
  console.log('============================================\\n');
  
  const xml = extractXmlFromWdaResponse(wdaJsonSample);
  console.log('Extracted XML length:', xml.length);
  console.log('First 200 chars:', xml.substring(0, 200));
  
  try {
    console.log('\\n--- Testing CURRENT parser ---');
    const currentResult = await parseXmlToTreeCurrent(xml);
    const currentCount = countNodes(currentResult);
    console.log('\\n✓ Current parser result:');
    console.log('  Total nodes:', currentCount);
    console.log('  Root type:', currentResult.type);
    console.log('  Root children:', currentResult.children?.length || 0);
    if (currentResult.children && currentResult.children[0]) {
      console.log('  First child type:', currentResult.children[0].type);
      console.log('  First child children:', currentResult.children[0].children?.length || 0);
    }
  } catch (e) {
    console.error('✗ Current parser failed:', e);
  }
  
  try {
    console.log('\\n--- Testing FIXED parser ---');
    const fixedResult = await parseXmlToTreeFixed(xml);
    const fixedCount = countNodes(fixedResult);
    console.log('\\n✓ Fixed parser result:');
    console.log('  Total nodes:', fixedCount);
    console.log('  Root type:', fixedResult.type);
    console.log('  Root children:', fixedResult.children?.length || 0);
    if (fixedResult.children && fixedResult.children[0]) {
      console.log('  First child type:', fixedResult.children[0].type);
      console.log('  First child children:', fixedResult.children[0].children?.length || 0);
      if (fixedResult.children[0].children && fixedResult.children[0].children[0]) {
        console.log('  Second level child type:', fixedResult.children[0].children[0].type);
        console.log('  Second level children:', fixedResult.children[0].children[0].children?.length || 0);
      }
    }
  } catch (e) {
    console.error('✗ Fixed parser failed:', e);
  }
  
  console.log('\\n============================================');
  console.log('TEST COMPLETE');
  console.log('============================================\\n');
}

runTests().catch(console.error);
