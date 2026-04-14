import { UINode } from '../ui/src/types';

// Test data: simulated click at (102, 460) - "설정 확인하러 가기" button area
const testClickX = 102;
const testClickY = 460;
const tolerance = 50;

// Simulated UI tree structure (from your actual app)
const testTree: UINode = {
  type: 'XCUIElementTypeApplication',
  x: '0', y: '0', width: '390', height: '844',
  label: '와이모', name: '', value: '', enabled: 'true', visible: 'true',
  children: [
    {
      type: 'XCUIElementTypeWindow',
      x: '0', y: '0', width: '390', height: '844',
      label: '', name: '', value: '', enabled: 'true', visible: 'true',
      children: [
        // Large Other containers
        {
          type: 'XCUIElementTypeOther',
          x: '0', y: '89', width: '390', height: '755',
          label: '', name: '', value: '', enabled: 'true', visible: 'true',
          children: [
            {
              type: 'XCUIElementTypeOther',
              x: '0', y: '89', width: '390', height: '755',
              label: '', name: '', value: '', enabled: 'true', visible: 'true',
              children: [
                // Button area Other
                {
                  type: 'XCUIElementTypeOther',
                  x: '85', y: '441', width: '220', height: '48',
                  label: '', name: '', value: '', enabled: 'true', visible: 'true',
                  children: [
                    // Actual button StaticText (if exists)
                    {
                      type: 'XCUIElementTypeStaticText',
                      x: '93', y: '449', width: '204', height: '32',
                      label: '설정 확인하러 가기',
                      name: '', value: '', enabled: 'true', visible: 'true',
                    }
                  ]
                }
              ]
            }
          ]
        }
      ]
    }
  ]
};

// Priority calculation (same as Overlay.tsx)
function getPriority(node: UINode): number {
  const typeName = node.type.replace('XCUIElementType', '');
  const hasText = !!(node.label || node.name || node.value);
  const hasChildren = node.children && node.children.length > 0;
  
  if (['Application', 'Window'].includes(typeName)) return 1000;
  if (['WebView', 'ScrollView'].includes(typeName)) return 999;
  
  if (typeName === 'Other') {
    const area = parseFloat(node.width) * parseFloat(node.height);
    if (area > 50000 && hasChildren && node.children && node.children.length === 1) return 998;
    if (hasChildren && node.children && node.children.length > 3) return 997;
  }
  
  if (typeName === 'StaticText' && hasText) return 1;
  if (typeName === 'Button') return 2;
  if (typeName === 'Link') return 2;
  
  if (['TextField', 'SearchField'].includes(typeName)) return 3;
  if (['Switch', 'Slider'].includes(typeName)) return 4;
  if (typeName === 'Image') return 5;
  
  if (typeName === 'Other') {
    const area = parseFloat(node.width) * parseFloat(node.height);
    if (hasText) return 30;
    if (area < 5000) return 35;
    if (area < 50000) return 50;
    return 996;
  }
  
  return 50;
}

// Collect nodes at click point
function collectNodesAt(node: UINode, clickX: number, clickY: number, tolerance: number, result: UINode[] = []): UINode[] {
  const x = parseFloat(node.x);
  const y = parseFloat(node.y);
  const w = parseFloat(node.width);
  const h = parseFloat(node.height);

  if (clickX >= x - tolerance && clickX <= x + w + tolerance && 
      clickY >= y - tolerance && clickY <= y + h + tolerance) {
    result.push(node);
    
    if (node.children) {
      for (const child of node.children) {
        collectNodesAt(child, clickX, clickY, tolerance, result);
      }
    }
  }
  return result;
}

// Run test
console.log('='.repeat(80));
console.log('🧪 Click Detection Test');
console.log('='.repeat(80));
console.log(`Click position: (${testClickX}, ${testClickY})`);
console.log(`Tolerance: ${tolerance}px`);
console.log('');

const allNodes = collectNodesAt(testTree, testClickX, testClickY, tolerance);
console.log(`📊 Total nodes at click: ${allNodes.length}`);
console.log('');

console.log('📋 All nodes found:');
allNodes.forEach((node, i) => {
  const typeName = node.type.replace('XCUIElementType', '');
  const priority = getPriority(node);
  const area = parseFloat(node.width) * parseFloat(node.height);
  const text = node.label || node.name || node.value || '';
  const bounds = `[${node.x},${node.y} ${node.width}x${node.height}]`;
  
  console.log(`  ${i}: ${typeName} ${bounds}`);
  console.log(`     Priority: ${priority}, Area: ${area.toFixed(0)}, Text: "${text}"`);
  
  if (priority >= 99) {
    const reason = priority === 1000 ? 'Application/Window' :
                  priority === 999 ? 'WebView/ScrollView' :
                  priority === 998 ? 'Other with 1 child (wrapper)' :
                  priority === 997 ? 'Other with >3 children' :
                  priority === 996 ? 'Large Other (>50k px²)' : 'Container';
    console.log(`     ❌ FILTERED: ${reason}`);
  } else {
    console.log(`     ✅ SELECTABLE`);
  }
  console.log('');
});

const selectableNodes = allNodes.filter(n => getPriority(n) < 99);
console.log(`✅ Selectable nodes: ${selectableNodes.length}`);
console.log(`❌ Filtered nodes: ${allNodes.length - selectableNodes.length}`);
console.log('');

if (selectableNodes.length > 0) {
  const sorted = selectableNodes.sort((a, b) => {
    const pA = getPriority(a);
    const pB = getPriority(b);
    if (pA !== pB) return pA - pB;
    const areaA = parseFloat(a.width) * parseFloat(a.height);
    const areaB = parseFloat(b.width) * parseFloat(b.height);
    return areaA - areaB;
  });
  
  console.log('🎯 Top 3 selectable nodes:');
  sorted.slice(0, 3).forEach((node, i) => {
    const typeName = node.type.replace('XCUIElementType', '');
    const priority = getPriority(node);
    const text = node.label || node.name || node.value || '';
    console.log(`  ${i + 1}. [P${priority}] ${typeName} "${text}"`);
  });
  
  console.log('');
  console.log(`✅ EXPECTED SELECTION: ${sorted[0].type.replace('XCUIElementType', '')} "${sorted[0].label || sorted[0].name || sorted[0].value}"`);
} else {
  console.log('❌ NO SELECTABLE NODES - ALL FILTERED!');
  console.log('');
  console.log('💡 Analysis:');
  console.log('   - All nodes at this position are large containers (Other with priority >= 996)');
  console.log('   - The actual StaticText or Button may be:');
  console.log('     1. Outside the tolerance range (increase tolerance)');
  console.log('     2. Nested inside a wrapper that gets filtered');
  console.log('     3. Has incorrect bounds in the XML');
}

console.log('='.repeat(80));
