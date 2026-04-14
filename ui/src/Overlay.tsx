import React, { useRef, useEffect, useState } from 'react';
import type { UINode } from './types';

type Props = {
  screenshot: string;
  tree: UINode;
  selectedNode: UINode | null;
  onSelect: (node: UINode) => void;
  showDebug?: boolean;
};

export function Overlay({ screenshot, tree, selectedNode, onSelect, showDebug = false }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [dimensions, setDimensions] = useState({ width: 0, height: 0 });
  const [imgSize, setImgSize] = useState({ width: 0, height: 0 });
  const [debugInfo, setDebugInfo] = useState<string>('');
  const [layerIndex, setLayerIndex] = useState(0); // For cycling through overlapping layers
  const lastClickPosRef = useRef<{x: number, y: number} | null>(null);

  useEffect(() => {
    const img = new Image();
    img.onload = () => {
      console.log('[Overlay] Image loaded:', img.naturalWidth, 'x', img.naturalHeight);
      // Use logical dimensions from tree root, not physical image size
      // iPhone uses @3x resolution: physical 1170x2532, logical 390x844
      const logicalWidth = tree.width ? parseFloat(tree.width) : img.naturalWidth;
      const logicalHeight = tree.height ? parseFloat(tree.height) : img.naturalHeight;
      console.log('[Overlay] Using logical dimensions:', logicalWidth, 'x', logicalHeight);
      setDimensions({ width: logicalWidth, height: logicalHeight });
    };
    img.onerror = (e) => {
      console.error('[Overlay] Image load error:', e);
    };
    img.src = screenshot;
    imgRef.current = img;
  }, [screenshot, tree]);

  useEffect(() => {
    const updateSize = () => {
      if (imgRef.current && imgRef.current.complete && dimensions.width > 0) {
        const container = containerRef.current;
        if (!container) return;

        const containerWidth = container.clientWidth;
        const containerHeight = container.clientHeight;
        const imgRatio = dimensions.width / dimensions.height;
        const containerRatio = containerWidth / containerHeight;

        let displayWidth, displayHeight;
        if (imgRatio > containerRatio) {
          displayWidth = containerWidth;
          displayHeight = containerWidth / imgRatio;
        } else {
          displayHeight = containerHeight;
          displayWidth = containerHeight * imgRatio;
        }

        console.log('[Overlay] Size update:', { containerWidth, containerHeight, displayWidth, displayHeight, imgRatio });
        setImgSize({ width: displayWidth, height: displayHeight });
      }
    };

    updateSize();
    window.addEventListener('resize', updateSize);
    return () => window.removeEventListener('resize', updateSize);
  }, [dimensions]);

  useEffect(() => {
    if (!canvasRef.current || !imgRef.current || !imgRef.current.complete || imgSize.width === 0) return;

    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    canvas.width = imgSize.width;
    canvas.height = imgSize.height;
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const scaleX = imgSize.width / dimensions.width;
    const scaleY = imgSize.height / dimensions.height;

    console.log('[Overlay] Drawing with scale:', { scaleX, scaleY, imgSize, dimensions });

    // Flatten all nodes for independent rendering (no parent-child dependency)
    const flattenForDrawing = (node: UINode, result: UINode[] = []): UINode[] => {
      result.push(node);
      if (node.children) {
        node.children.forEach(child => flattenForDrawing(child, result));
      }
      return result;
    };

    const allNodesFlat = flattenForDrawing(tree);
    
    // Filter nodes that should be drawn
    const nodesToDraw = allNodesFlat.filter(node => {
      const typeName = node.type.replace('XCUIElementType', '');
      const hasText = !!(node.label || node.name || node.value);
      const isAccessible = node.accessible === 'true';
      const isVisible = node.visible !== 'false';
      const w = parseFloat(node.width);
      const h = parseFloat(node.height);
      const hasMeaningfulSize = w > 2 && h > 2;
      
      // Never draw these containers
      if (['Application', 'Window', 'WebView', 'ScrollView'].includes(typeName)) {
        return false;
      }
      
      // Draw accessible elements even if they're Other without text
      if (isAccessible && hasMeaningfulSize) return true;
      
      // Draw visible elements normally
      if (isVisible) {
        // Only draw Other if it has text
        if (typeName === 'Other' && !hasText) return false;
        return true;
      }
      
      // Draw hidden elements that have text or are interactive types (dimmed)
      if (!isVisible && hasMeaningfulSize) {
        if (hasText) return true;
        if (['Button', 'TextField', 'SearchField', 'Switch', 'Link', 'StaticText'].includes(typeName)) return true;
      }
      
      return false;
    });

    console.log(`[Overlay] Drawing ${nodesToDraw.length} nodes (from ${allNodesFlat.length} total)`);

    // Draw all visible nodes independently
    nodesToDraw.forEach(node => {
      const x = parseFloat(node.x) * scaleX;
      const y = parseFloat(node.y) * scaleY;
      const w = parseFloat(node.width) * scaleX;
      const h = parseFloat(node.height) * scaleY;

      if (w > 1 && h > 1) {
        const isSelected = selectedNode && 
                          node.x === selectedNode.x && 
                          node.y === selectedNode.y &&
                          node.width === selectedNode.width && 
                          node.height === selectedNode.height &&
                          node.type === selectedNode.type;
        const isAccessible = node.accessible === 'true';
        const isHidden = node.visible === 'false';
        
        if (isSelected) {
          ctx.strokeStyle = '#22c55e';
          ctx.lineWidth = 3;
          ctx.setLineDash([]);
        } else if (isHidden) {
          ctx.strokeStyle = 'rgba(251, 191, 36, 0.4)'; // yellow/amber for hidden
          ctx.lineWidth = 1;
          ctx.setLineDash([4, 4]);
        } else if (isAccessible) {
          ctx.strokeStyle = 'rgba(168, 85, 247, 0.6)'; // purple for accessible
          ctx.lineWidth = 1.5;
          ctx.setLineDash([]);
        } else {
          ctx.strokeStyle = 'rgba(37, 99, 235, 0.5)';
          ctx.lineWidth = 1;
          ctx.setLineDash([]);
        }
        ctx.strokeRect(x, y, w, h);
        ctx.setLineDash([]);
        
        if (isSelected) {
          ctx.fillStyle = 'rgba(34, 197, 94, 0.1)';
          ctx.fillRect(x, y, w, h);
        }
      }
    });
  }, [tree, selectedNode, dimensions, imgSize]);

  const handleClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!canvasRef.current) return;
    
    const rect = canvasRef.current.getBoundingClientRect();
    const canvasClickX = e.clientX - rect.left;
    const canvasClickY = e.clientY - rect.top;
    const clickX = (canvasClickX / rect.width) * dimensions.width;
    const clickY = (canvasClickY / rect.height) * dimensions.height;

    console.log('='.repeat(60));
    console.log('[Overlay] 🎯 CLICK DEBUG');
    console.log('[Overlay] Canvas rect:', { left: rect.left, top: rect.top, width: rect.width, height: rect.height });
    console.log('[Overlay] Mouse client:', { x: e.clientX, y: e.clientY });
    console.log('[Overlay] Canvas click:', canvasClickX.toFixed(1), canvasClickY.toFixed(1));
    console.log('[Overlay] Logical click:', clickX.toFixed(1), clickY.toFixed(1));
    console.log('[Overlay] Dimensions:', dimensions.width, 'x', dimensions.height);
    console.log('[Overlay] Image size:', imgSize.width, 'x', imgSize.height);
    console.log('[Overlay] Shift key:', e.shiftKey);
    
    // Check if clicking same position (for layer cycling)
    const isSamePosition = lastClickPosRef.current && 
                          Math.abs(lastClickPosRef.current.x - clickX) < 5 &&
                          Math.abs(lastClickPosRef.current.y - clickY) < 5;
    
    lastClickPosRef.current = { x: clickX, y: clickY };
    
    // If Shift key or clicking same position, cycle to next layer
    const shouldCycleLayer = e.shiftKey || isSamePosition;
    if (!shouldCycleLayer) {
      setLayerIndex(0); // Reset layer index for new position
    }

    // Dynamic tolerance based on element size
    const getDynamicTolerance = (node: UINode): number => {
      const w = parseFloat(node.width);
      const h = parseFloat(node.height);
      const area = w * h;
      const typeName = node.type.replace('XCUIElementType', '');
      
      // StaticText: very precise (small tolerance)
      if (typeName === 'StaticText') {
        return Math.min(10, Math.max(5, Math.min(w, h) * 0.2));
      }
      
      // Button: moderate tolerance based on size
      if (typeName === 'Button') {
        return Math.min(30, Math.max(15, Math.min(w, h) * 0.3));
      }
      
      // Small elements (< 2000px²): small tolerance
      if (area < 2000) {
        return Math.min(15, Math.max(5, Math.min(w, h) * 0.25));
      }
      
      // Medium elements (2000-10000px²): medium tolerance
      if (area < 10000) {
        return Math.min(30, Math.max(10, Math.min(w, h) * 0.3));
      }
      
      // Large elements: larger tolerance but capped
      return Math.min(50, Math.max(20, Math.min(w, h) * 0.2));
    };
    
    // First, flatten ALL nodes into independent list (break parent-child hierarchy)
    const flattenAllNodes = (node: UINode, result: UINode[] = []): UINode[] => {
      result.push(node); // Add every node, regardless of visibility
      
      if (node.children) {
        for (const child of node.children) {
          flattenAllNodes(child, result);
        }
      }
      return result;
    };
    
    const allFlatNodes = flattenAllNodes(tree);
    console.log('[Overlay] Total flattened nodes:', allFlatNodes.length);
    
    // Filter to nodes at click point (including hidden elements with meaningful size)
    const allNodes = allFlatNodes.filter(node => {
      const x = parseFloat(node.x);
      const y = parseFloat(node.y);
      const w = parseFloat(node.width);
      const h = parseFloat(node.height);
      
      // Skip zero-size elements
      if (w < 2 || h < 2) return false;
      
      const tolerance = getDynamicTolerance(node);
      
      return clickX >= x - tolerance && clickX <= x + w + tolerance && 
             clickY >= y - tolerance && clickY <= y + h + tolerance;
    });
    console.log('[Overlay] All nodes at click:', allNodes.length);
    
    // If no nodes found, find nearest node for debugging
    if (allNodes.length === 0) {
      console.log('[Overlay] ⚠️ NO NODES FOUND! Finding nearest node...');
      const findNearest = (node: UINode): { node: UINode; distance: number } | null => {
        const x = parseFloat(node.x);
        const y = parseFloat(node.y);
        const w = parseFloat(node.width);
        const h = parseFloat(node.height);
        const centerX = x + w / 2;
        const centerY = y + h / 2;
        const distance = Math.sqrt(Math.pow(clickX - centerX, 2) + Math.pow(clickY - centerY, 2));
        
        let nearest = { node, distance };
        if (node.children) {
          for (const child of node.children) {
            const childNearest = findNearest(child);
            if (childNearest && childNearest.distance < nearest.distance) {
              nearest = childNearest;
            }
          }
        }
        return nearest;
      };
      
      const nearest = findNearest(tree);
      if (nearest) {
        const n = nearest.node;
        console.log(`[Overlay] Nearest node: ${n.type} at [${n.x},${n.y}] distance=${nearest.distance.toFixed(1)}px`);
        console.log(`[Overlay] Node text: "${n.label || n.name || n.value || ''}"`);
      }
    }
    
    console.log('[Overlay] ==================== DIAGNOSTIC INFO ====================');
    
    // Priority-based selection (prefer interactive/text elements over containers)
    // Uses accessible attribute and traits for better accuracy
    const getPriority = (node: UINode): number => {
      const typeName = node.type.replace('XCUIElementType', '');
      const hasText = !!(node.label || node.name || node.value);
      const textLength = (node.label || node.name || node.value || '').length;
      const hasChildren = node.children && node.children.length > 0;
      const isAccessible = node.accessible === 'true';
      const traits = (node.traits || '').toLowerCase();
      
      // NEVER select these top-level containers
      if (['Application', 'Window'].includes(typeName)) return 1000;
      
      // Filter out large containers (WebView, ScrollView)
      if (['WebView', 'ScrollView'].includes(typeName)) return 999;
      
      // Hidden elements: selectable but lower priority than visible ones
      const isHidden = node.visible === 'false';
      const hiddenPenalty = isHidden ? 60 : 0; // push hidden elements down in priority
      
      // Filter out large Other containers (wrapper elements)
      if (typeName === 'Other') {
        const area = parseFloat(node.width) * parseFloat(node.height);
        // Large Other (> 50k px²) with exactly 1 child: it's just a wrapper, skip it
        if (area > 50000 && hasChildren && node.children && node.children.length === 1) return 998;
        // Other with many children (likely a container) — unless it's accessible
        if (!isAccessible && hasChildren && node.children && node.children.length > 3) return 997;
      }
      
      // --- Traits-aware priority ---
      // An XCUIElementTypeOther with button/link traits is actually interactive
      const isTraitButton = /button|link/.test(traits);
      const isTraitText = /static\s*text|text/.test(traits) && !/button|link/.test(traits);
      
      // Highest priority: accessible elements with name/label (Appium can reliably find these)
      // Button or element with button traits
      if (typeName === 'Button' || isTraitButton) {
        return (isAccessible ? 1 : 2) + hiddenPenalty;
      }
      if (typeName === 'Link') {
        return (isAccessible ? 1 : 2) + hiddenPenalty;
      }
      
      // High priority: text elements
      if ((typeName === 'StaticText' || isTraitText) && hasText) {
        return (isAccessible ? 2 : 3) + hiddenPenalty;
      }
      
      // High priority: input elements
      if (['TextField', 'SearchField'].includes(typeName)) {
        return (isAccessible ? 2 : 3) + hiddenPenalty;
      }
      
      // Medium priority: other interactive
      if (['Switch', 'Slider'].includes(typeName)) return 4 + hiddenPenalty;
      
      // Accessible Other with name/label: likely a custom interactive element
      if (typeName === 'Other' && isAccessible && hasText) return 5 + hiddenPenalty;
      
      // Low priority: images
      if (typeName === 'Image') return (isAccessible ? 5 : 6) + hiddenPenalty;
      
      // Other: lower priority, prefer by size and content
      if (typeName === 'Other') {
        const area = parseFloat(node.width) * parseFloat(node.height);
        // Other with text: medium priority (might be interactive)
        if (hasText) return 30;
        // Small Other (< 5k px²): medium priority
        if (area < 5000) return 35;
        // Medium Other (5k-50k px²): low priority
        if (area < 50000) return 50;
        // Large Other (>50k px²): filter out
        return 996;
      }
      
      // Accessible unknown type with text: treat as meaningful
      if (isAccessible && hasText) return 10 + hiddenPenalty;
      
      // Default: unknown types
      return 50 + hiddenPenalty;
    };
    
    allNodes.forEach((node, i) => {
      const typeName = node.type.replace('XCUIElementType', '');
      const text = node.label || node.name || node.value || '';
      const area = parseFloat(node.width) * parseFloat(node.height);
      const hasChildren = node.children && node.children.length > 0;
      const priority = getPriority(node);
      const tolerance = getDynamicTolerance(node);
      const acc = node.accessible === 'true' ? '♿✓' : '';
      const traits = node.traits || '';
      const hidden = node.visible === 'false' ? '👻' : '';
      
      console.log(`  ${i}: ${typeName} [${node.x},${node.y} ${node.width}x${node.height}] ${acc} ${hidden}`);
      console.log(`      Priority: ${priority}, Area: ${area.toFixed(0)}, Tolerance: ${tolerance.toFixed(1)}px, HasChildren: ${hasChildren}`);
      console.log(`      Text: "${text}" ${traits ? `Traits: "${traits}"` : ''} ${hidden ? 'HIDDEN' : ''}`);
      
      if (priority >= 99) {
        const reason = priority === 1000 ? 'Application/Window' : 
                      priority === 999 ? 'WebView/ScrollView' : 
                      priority === 998 ? 'Other with >3 children' : 'Large container';
        console.log(`      ❌ FILTERED OUT: ${reason}`);
      }
    });
    console.log('[Overlay] ============================================');
    
    // Filter out high priority (>= 99) nodes, then sort
    let selectableNodes = allNodes.filter(node => {
      const priority = getPriority(node);
      return priority < 99; // Only keep nodes with priority less than 99
    });
    
    // If no selectable nodes, fall back to Button/StaticText only, or all nodes
    if (selectableNodes.length === 0) {
      console.log('[Overlay] ⚠️ No selectable nodes, trying Button/StaticText only');
      selectableNodes = allNodes.filter(n => {
        const type = n.type.replace('XCUIElementType', '');
        return type === 'Button' || type === 'StaticText' || type === 'Link';
      });
      
      if (selectableNodes.length === 0) {
        console.log('[Overlay] ⚠️ No Button/Text found, using all nodes as last resort');
        selectableNodes = allNodes;
      }
    }
    
    // Sort by priority first, then by area (smallest first)
    const sortedNodes = [...selectableNodes].sort((a, b) => {
      const priorityA = getPriority(a);
      const priorityB = getPriority(b);
      
      // Lower priority number = higher priority
      if (priorityA !== priorityB) {
        return priorityA - priorityB;
      }
      
      // Same priority: prefer smaller area (more specific elements)
      const areaA = parseFloat(a.width) * parseFloat(a.height);
      const areaB = parseFloat(b.width) * parseFloat(b.height);
      
      // If one is much smaller (less than 10% of the other), strongly prefer it
      if (areaA < areaB * 0.1) return -1;
      if (areaB < areaA * 0.1) return 1;
      
      return areaA - areaB;
    });
    
    console.log('[Overlay] Selectable nodes:', selectableNodes.length);
    console.log('[Overlay] Sorted nodes (top 15):');
    sortedNodes.slice(0, 15).forEach((node, i) => {
      const typeName = node.type.replace('XCUIElementType', '');
      const text = (node.label || node.name || node.value || '').substring(0, 30);
      const priority = getPriority(node);
      const area = parseFloat(node.width) * parseFloat(node.height);
      const childCount = node.children ? node.children.length : 0;
      console.log(`  ${i}: priority=${priority} ${typeName} area=${area.toFixed(0)} children=${childCount} "${text}"`);
    });
    
    if (sortedNodes.length === 0) {
      console.log('[Overlay] ⚠️ ALL NODES FILTERED OUT!');
      console.log('[Overlay] Showing all node priorities:');
      allNodes.slice(0, 10).forEach((node, i) => {
        const typeName = node.type.replace('XCUIElementType', '');
        const priority = getPriority(node);
        const area = parseFloat(node.width) * parseFloat(node.height);
        console.log(`  ${i}: priority=${priority} ${typeName} area=${area.toFixed(0)}`);
      });
    }
    
    // Layer cycling: pick node at current layer index
    let currentIndex = layerIndex % Math.max(1, sortedNodes.length);
    const smallest = sortedNodes.length > 0 ? sortedNodes[currentIndex] : null;
    
    console.log(`[Overlay] Layer index: ${currentIndex}/${sortedNodes.length - 1}`);
    
    // Increment layer index for next click at same position
    if (shouldCycleLayer) {
      setLayerIndex(currentIndex + 1);
    }

    // Count filtered nodes by reason
    const filteredByReason = allNodes.reduce((acc, node) => {
      const priority = getPriority(node);
      if (priority === 996) acc.largeOther++;
      else if (priority === 997) acc.otherManyChildren++;
      else if (priority === 998) acc.otherWrapper++;
      else if (priority === 999) acc.webViewScroll++;
      else if (priority === 1000) acc.topLevel++;
      else if (priority >= 99) acc.containers++;
      return acc;
    }, { largeOther: 0, otherManyChildren: 0, otherWrapper: 0, webViewScroll: 0, topLevel: 0, containers: 0 });
    
    const totalFiltered = filteredByReason.otherManyChildren + filteredByReason.webViewScroll + filteredByReason.topLevel + filteredByReason.containers;

    // Update debug info
    const debugText = `📍 Click: (${clickX.toFixed(0)}, ${clickY.toFixed(0)})
🔢 Layer: ${currentIndex + 1}/${sortedNodes.length}
${e.shiftKey ? '🔄 Shift: Cycle layers' : '💡 Shift+Click to cycle'}

📊 Total nodes: ${allNodes.length}
✅ Selectable: ${sortedNodes.length}
❌ Filtered: ${totalFiltered}
   • Large Other(>50k): ${filteredByReason.largeOther}
   • Other(>3 children): ${filteredByReason.otherManyChildren}
   • Other(wrapper): ${filteredByReason.otherWrapper}
   • WebView/Scroll: ${filteredByReason.webViewScroll}
   • App/Window: ${filteredByReason.topLevel}
   • Other containers: ${filteredByReason.containers}

🎯 Top candidates:
${sortedNodes.slice(0, 5).map((n: UINode, i: number) => {
  const type = n.type.replace('XCUIElementType', '');
  const text = (n.label || n.name || n.value || '').substring(0, 20);
  const marker = i === currentIndex ? '→' : ' ';
  const priority = getPriority(n);
  const area = parseFloat(n.width) * parseFloat(n.height);
  return `${marker} [P${priority}] ${type} ${area.toFixed(0)}px²\n    "${text}"`;
}).join('\n')}`;
    setDebugInfo(debugText);

    if (smallest) {
      console.log('[Overlay] ✓ Selected:', smallest.type.replace('XCUIElementType', ''), 
                  `"${smallest.label || smallest.name || smallest.value || ''}"`);
      onSelect(smallest);
    } else {
      console.log('[Overlay] ✗ No meaningful node found');
    }
  };

  return (
    <div
      style={{
        flex: 1,
        background: '#0b1221',
        border: '1px solid #1f2937',
        borderRadius: '12px',
        padding: '16px',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
      }}
    >
      <div style={{ color: '#cbd5e1', fontWeight: '700', marginBottom: '12px', fontSize: '14px' }}>
        Screen Capture
      </div>
      <div
        ref={containerRef}
        style={{
          flex: 1,
          display: 'flex',
          alignItems: 'flex-start',
          justifyContent: 'center',
          position: 'relative',
          overflow: 'auto',
        }}
      >
        <div style={{ position: 'relative', width: imgSize.width, height: imgSize.height }}>
          <img
            ref={imgRef}
            src={screenshot}
            alt="Screenshot"
            style={{
              width: '100%',
              height: '100%',
              objectFit: 'fill',
              borderRadius: '8px',
              display: 'block',
            }}
          />
          <canvas
            ref={canvasRef}
            onClick={handleClick}
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              width: '100%',
              height: '100%',
              cursor: 'crosshair',
            }}
          />
        </div>
      </div>
      
      {/* Debug Info Panel - Only show when debug is enabled */}
      {showDebug && debugInfo && (
        <div style={{
          marginTop: '12px',
          padding: '12px',
          background: '#1f2937',
          borderRadius: '8px',
          fontSize: '11px',
          fontFamily: 'Monaco, monospace',
          color: '#94a3b8',
          whiteSpace: 'pre-wrap',
          maxHeight: '200px',
          overflow: 'auto',
          lineHeight: '1.4',
        }}>
          {debugInfo}
        </div>
      )}
    </div>
  );
}
