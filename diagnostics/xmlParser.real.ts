// Test with real WDA XML
import { parseString } from 'xml2js';
import fs from 'fs';

async function parseXmlToTree(xml: string): Promise<any> {
  return new Promise((resolve, reject) => {
    parseString(xml, { explicitArray: false, mergeAttrs: true }, (err, result) => {
      if (err) {
        reject(err);
        return;
      }
      
      const transform = (node: any, elementType: string): any => {
        if (!node || typeof node !== 'object') return null;
        
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
      
      const root = result.XCUIElementTypeApplication;
      if (!root) {
        reject(new Error('Could not find root element'));
        return;
      }
      
      resolve(transform(root, 'XCUIElementTypeApplication'));
    });
  });
}

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

function countNodesByType(node: any, counts: Map<string, number> = new Map()): Map<string, number> {
  if (!node) return counts;
  
  const type = node.type.replace('XCUIElementType', '');
  counts.set(type, (counts.get(type) || 0) + 1);
  
  if (node.children) {
    for (const child of node.children) {
      countNodesByType(child, counts);
    }
  }
  
  return counts;
}

function getMaxDepth(node: any, depth = 0): number {
  if (!node || !node.children || node.children.length === 0) {
    return depth;
  }
  
  let maxChildDepth = depth;
  for (const child of node.children) {
    const childDepth = getMaxDepth(child, depth + 1);
    maxChildDepth = Math.max(maxChildDepth, childDepth);
  }
  
  return maxChildDepth;
}

async function runTest() {
  const xmlPath = '/tmp/wda_full.xml';
  
  if (!fs.existsSync(xmlPath)) {
    console.error('❌ XML file not found:', xmlPath);
    console.log('Run: curl -s http://localhost:8100/source | jq -r .value > /tmp/wda_full.xml');
    process.exit(1);
  }
  
  const xml = fs.readFileSync(xmlPath, 'utf8');
  
  console.log('\n============================================');
  console.log('REAL WDA XML PARSING TEST');
  console.log('============================================\n');
  console.log('XML file size:', xml.length, 'bytes');
  console.log('XML lines:', xml.split('\n').length);
  
  try {
    const tree = await parseXmlToTree(xml);
    const totalNodes = countNodes(tree);
    const maxDepth = getMaxDepth(tree);
    const typeCounts = countNodesByType(tree);
    
    console.log('\n✓ Parsing successful!\n');
    console.log('📊 STATISTICS:');
    console.log('  Total nodes:', totalNodes);
    console.log('  Max depth:', maxDepth);
    console.log('  Root:', tree.type);
    console.log('  Root children:', tree.children?.length || 0);
    
    console.log('\n📋 NODE TYPES:');
    const sortedTypes = Array.from(typeCounts.entries()).sort((a, b) => b[1] - a[1]);
    for (const [type, count] of sortedTypes) {
      console.log(`  ${type}: ${count}`);
    }
    
    console.log('\n🌳 TREE SAMPLE (first 3 levels):');
    function printTree(node: any, indent = '', maxDepth = 3, currentDepth = 0) {
      if (currentDepth > maxDepth) return;
      
      const type = node.type.replace('XCUIElementType', '');
      const attrs: string[] = [];
      if (node.name) attrs.push(`name="${node.name}"`);
      if (node.label) attrs.push(`label="${node.label}"`);
      if (node.value) attrs.push(`value="${node.value}"`);
      
      const attrStr = attrs.length > 0 ? ' ' + attrs.join(' ') : '';
      console.log(`${indent}${type}${attrStr}`);
      
      if (node.children && currentDepth < maxDepth) {
        const childCount = node.children.length;
        const showCount = Math.min(childCount, 5);
        
        for (let i = 0; i < showCount; i++) {
          printTree(node.children[i], indent + '  ', maxDepth, currentDepth + 1);
        }
        
        if (childCount > showCount) {
          console.log(`${indent}  ... (${childCount - showCount} more)`);
        }
      }
    }
    
    printTree(tree);
    
    console.log('\n============================================');
    console.log('TEST PASSED ✓');
    console.log('============================================\n');
    
  } catch (e) {
    console.error('\n❌ Parsing failed:', e);
    process.exit(1);
  }
}

runTest().catch(console.error);
