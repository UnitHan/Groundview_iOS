import React, { useState } from 'react';
import type { UINode } from './types';

// Helper to get display info for a node
function getNodeDisplayInfo(node: UINode) {
  const typeName = node.type.replace('XCUIElementType', '');
  
  // Extract automation-critical attributes
  const label = node.label || '';
  const name = node.name || '';
  const value = node.value || '';
  const text = label || name || value;
  const hasText = !!text;
  const isAccessible = node.accessible === 'true';
  const traits = (node.traits || '').toLowerCase();
  
  // All nodes are meaningful - show full hierarchy
  const isMeaningful = true;
  
  // Check if node is interactive (by type or traits)
  const isInteractiveByType = ['Button', 'TextField', 'SearchField', 'Switch', 'Slider', 'Link'].includes(typeName);
  const isInteractiveByTraits = /button|link/.test(traits);
  const isInteractive = isInteractiveByType || isInteractiveByTraits;
  
  // Get icon for node type (with accessibility/traits awareness)
  const getIcon = () => {
    // If traits say it's a button but type is Other, show button icon
    if (!isInteractiveByType && isInteractiveByTraits) return '🔘';
    switch (typeName) {
      case 'Button': return '🔘';
      case 'StaticText': return '📝';
      case 'TextField': return '✏️';
      case 'Image': return '🖼️';
      case 'ScrollView': return '📜';
      case 'WebView': return '🌐';
      case 'Switch': return '🔀';
      case 'Slider': return '🎚️';
      case 'SearchField': return '🔍';
      case 'NavigationBar': return '📍';
      case 'TabBar': return '📑';
      case 'Table': return '📊';
      case 'Cell': return '📦';
      case 'Link': return '🔗';
      default: return '';
    }
  };

  // Get color for node type
  const getColor = () => {
    if (isAccessible && isInteractive) return '#818cf8'; // Indigo for accessible+interactive
    if (isInteractive) return '#60a5fa'; // Blue for interactive
    if (isAccessible && hasText) return '#a78bfa'; // Purple for accessible with text
    if (hasText) return '#34d399'; // Green for text content
    switch (typeName) {
      case 'Image': return '#f472b6'; // Pink
      case 'ScrollView':
      case 'WebView': return '#a78bfa'; // Purple
      case 'Other': return '#6b7280'; // Gray
      default: return '#60a5fa'; // Blue
    }
  };

  return {
    typeName,
    label,
    name,
    value,
    text,
    hasText,
    isMeaningful,
    isInteractive,
    isAccessible,
    traits,
    icon: getIcon(),
    color: getColor(),
    bounds: `${node.width}×${node.height}`,
    position: `(${node.x}, ${node.y})`,
    enabled: node.enabled === 'true',
    visible: node.visible === 'true',
  };
}

type ListItemProps = {
  node: UINode;
  level: number;
  isSelected: boolean;
  onSelect: (node: UINode) => void;
  nodeRef?: (node: UINode, element: HTMLDivElement | null) => void;
};

function ListItem({ node, level, isSelected, onSelect, nodeRef }: ListItemProps) {
  const typeName = node.type.replace('XCUIElementType', '');
  const displayText = node.label || node.name || node.value || '';
  const isAccessible = node.accessible === 'true';
  const traits = (node.traits || '').toLowerCase();
  const isTraitButton = /button|link/.test(traits);
  
  const handleCopy = (text: string, e: React.MouseEvent) => {
    e.stopPropagation();
    navigator.clipboard.writeText(text);
    console.log('Copied to clipboard:', text);
  };

  return (
    <div
      ref={(el) => nodeRef?.(node, el)}
      onClick={(e) => {
        e.stopPropagation();
        onSelect(node);
      }}
      style={{
        padding: '8px 12px',
        cursor: 'pointer',
        borderRadius: '6px',
        background: isSelected ? '#2563eb' : 'transparent',
        color: isSelected ? '#fff' : '#e5e7eb',
        marginBottom: '2px',
        transition: 'all 0.15s ease',
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
        fontSize: '12px',
        borderLeft: isSelected ? '3px solid #22c55e' : '3px solid transparent',
      }}
      onMouseEnter={(e) => {
        if (!isSelected) e.currentTarget.style.background = '#1f2937';
      }}
      onMouseLeave={(e) => {
        if (!isSelected) e.currentTarget.style.background = 'transparent';
      }}
    >
      {isAccessible && (
        <span title="accessible=true" style={{ fontSize: '10px', opacity: 0.7 }}>♿</span>
      )}
      <span style={{ 
        color: typeName === 'Other' && !isTraitButton ? '#6b7280' : isTraitButton ? '#818cf8' : '#60a5fa',
        fontWeight: '600',
        minWidth: '100px',
      }}>
        {typeName}{isTraitButton && typeName !== 'Button' && typeName !== 'Link' ? ' ⟨btn⟩' : ''}
      </span>
      {displayText && (
        <>
          <span style={{ 
            color: '#34d399',
            flex: 1,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}>
            {displayText}
          </span>
          <button
            onClick={(e) => handleCopy(displayText, e)}
            style={{
              background: '#1f2937',
              border: '1px solid #374151',
              color: '#9ca3af',
              padding: '2px 8px',
              borderRadius: '4px',
              fontSize: '10px',
              cursor: 'pointer',
              transition: 'all 0.15s ease',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = '#374151';
              e.currentTarget.style.color = '#e5e7eb';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = '#1f2937';
              e.currentTarget.style.color = '#9ca3af';
            }}
          >
            Copy
          </button>
        </>
      )}
      <span style={{ 
        color: '#6b7280',
        fontSize: '10px',
        marginLeft: 'auto',
      }}>
        {node.width}×{node.height}
      </span>
    </div>
  );
}

type Props = {
  node: UINode;
  level: number;
  selectedNode: UINode | null;
  onSelect: (node: UINode) => void;
  nodeRef?: (node: UINode, element: HTMLDivElement | null) => void;
};

export function TreeNode({ node, level, selectedNode, onSelect, nodeRef }: Props) {
  const displayInfo = getNodeDisplayInfo(node);
  
  // Check if selected node is a descendant of this node
  const hasSelectedDescendant = React.useMemo(() => {
    if (!selectedNode) return false;
    const checkDescendant = (n: UINode): boolean => {
      if (n === selectedNode) return true;
      if (n.type === selectedNode.type && 
          n.x === selectedNode.x && 
          n.y === selectedNode.y &&
          n.width === selectedNode.width &&
          n.height === selectedNode.height) return true;
      if (n.children) {
        return n.children.some(checkDescendant);
      }
      return false;
    };
    return node.children?.some(checkDescendant) || false;
  }, [node, selectedNode]);

  // Expand only first few levels to avoid UI clutter, but always expand if contains selected node
  const [expanded, setExpanded] = useState(level < 8 || hasSelectedDescendant);
  
  // Auto-expand if this node contains the selected node
  React.useEffect(() => {
    if (hasSelectedDescendant) {
      setExpanded(true);
    }
  }, [hasSelectedDescendant]);

  const hasChildren = node.children && node.children.length > 0;
  const isSelected = selectedNode?.type === node.type && 
                     selectedNode?.x === node.x && 
                     selectedNode?.y === node.y &&
                     selectedNode?.width === node.width &&
                     selectedNode?.height === node.height;

  // Android style: NO indentation, only vertical spacing
  const verticalSpacing = level * 1; // Minimal spacing between levels

  // Skip rendering if this is a meaningless container
  const isGenericContainer = displayInfo.typeName === 'Other' && 
                             hasChildren && 
                             node.children!.length === 1 &&
                             !displayInfo.hasText &&
                             parseFloat(node.width) === parseFloat(node.children![0].width) &&
                             parseFloat(node.height) === parseFloat(node.children![0].height);
  
  if (isGenericContainer && !isSelected && !hasSelectedDescendant) {
    // Render child directly, skip this container
    return <TreeNode node={node.children![0]} level={level} selectedNode={selectedNode} onSelect={onSelect} nodeRef={nodeRef} />;
  }
  
  // Show all children normally - maintain hierarchy structure
  const meaningfulChildren = hasChildren ? node.children! : [];

  return (
    <div style={{ marginTop: verticalSpacing }}>
      <div
        ref={(el) => nodeRef?.(node, el)}
        onClick={(e) => {
          e.stopPropagation();
          console.log('TreeNode clicked:', node);
          onSelect(node);
        }}
        style={{
          padding: '4px 8px',
          cursor: 'pointer',
          background: isSelected ? '#2563eb' : 'transparent',
          color: isSelected ? '#fff' : '#e5e7eb',
          display: 'flex',
          alignItems: 'center',
          gap: '6px',
          fontSize: '12px',
          fontFamily: 'Monaco, monospace',
          transition: 'background 0.15s ease',
          userSelect: 'none',
        }}
        onMouseEnter={(e) => {
          if (!isSelected) e.currentTarget.style.background = '#1f2937';
        }}
        onMouseLeave={(e) => {
          if (!isSelected) e.currentTarget.style.background = 'transparent';
        }}
      >
        {/* Bullet point instead of arrow - Android style */}
        <span style={{ 
          color: '#64748b',
          fontSize: '10px',
          width: '12px',
          display: 'inline-block',
        }}>
          •
        </span>
        
        {/* Type name - Android style */}
        <span style={{ 
          color: '#06b6d4',
          fontWeight: '500',
          opacity: node.visible === 'false' ? 0.4 : 1,
        }}>
          {displayInfo.typeName}
        </span>
        
        {/* Hidden indicator */}
        {node.visible === 'false' && (
          <span style={{ color: '#fbbf24', fontSize: '10px', opacity: 0.6 }} title="visible=false">👻</span>
        )}
        
        {/* Text content - Android style */}
        {displayInfo.text && (
          <>
            <span style={{ color: '#94a3b8', marginLeft: '6px' }}>text:</span>
            <span style={{ 
              color: '#10b981',
              marginLeft: '4px',
            }}>
              {displayInfo.text}
            </span>
          </>
        )}
        
        {/* Bounds */}
        <span style={{ 
          color: '#64748b',
          fontSize: '11px',
          marginLeft: 'auto',
          whiteSpace: 'nowrap',
        }}>
          {displayInfo.bounds}
        </span>
      </div>
      {/* Always show children - no expand/collapse, Android style flat list */}
      {meaningfulChildren.length > 0 && (
        <div>
          {meaningfulChildren.map((child, i) => (
            <TreeNode
              key={i}
              node={child}
              level={level + 1}
              selectedNode={selectedNode}
              onSelect={onSelect}
              nodeRef={nodeRef}
            />
          ))}
        </div>
      )}
    </div>
  );
}

type TreeProps = {
  tree: UINode;
  selectedNode: UINode | null;
  onSelect: (node: UINode) => void;
  showDebug?: boolean;
};

export function TreeView({ tree, selectedNode, onSelect, showDebug = false }: TreeProps) {
  const [searchTerm, setSearchTerm] = React.useState('');
  const [viewMode, setViewMode] = React.useState<'tree' | 'list'>('tree');
  const scrollContainerRef = React.useRef<HTMLDivElement>(null);
  const nodeElementsRef = React.useRef<Map<UINode, HTMLDivElement>>(new Map());
  
  React.useEffect(() => {
    console.log('[TreeView] Received tree:', tree);
    console.log('[TreeView] Tree type:', tree?.type);
    console.log('[TreeView] Tree children:', tree?.children?.length || 0);
  }, [tree]);

  // Auto-scroll to selected node with delay to ensure DOM is updated
  React.useEffect(() => {
    if (selectedNode && scrollContainerRef.current) {
      // Wait for DOM to update before scrolling
      const timer = setTimeout(() => {
        const element = nodeElementsRef.current.get(selectedNode);
        if (element) {
          console.log(`[TreeView] Scrolling to node in ${viewMode} mode:`, selectedNode.type);
          element.scrollIntoView({ behavior: 'smooth', block: 'center' });
        } else {
          console.log('[TreeView] Element not found for scrolling in', viewMode, 'mode');
        }
      }, 300);
      return () => clearTimeout(timer);
    }
  }, [selectedNode, viewMode]);

  const handleNodeRef = React.useCallback((node: UINode, element: HTMLDivElement | null) => {
    if (element) {
      nodeElementsRef.current.set(node, element);
    } else {
      nodeElementsRef.current.delete(node);
    }
  }, []);

  // Flatten tree for list view
  const flattenTree = (node: UINode, level = 0): Array<{ node: UINode; level: number }> => {
    const result: Array<{ node: UINode; level: number }> = [{ node, level }];
    if (node.children) {
      for (const child of node.children) {
        result.push(...flattenTree(child, level + 1));
      }
    }
    return result;
  };

  const flatNodes = React.useMemo(() => flattenTree(tree), [tree]);

  const filteredNodes = React.useMemo(() => {
    if (!searchTerm) return flatNodes;
    const term = searchTerm.toLowerCase();
    return flatNodes.filter(({ node }) => 
      node.type.toLowerCase().includes(term) ||
      node.name?.toLowerCase().includes(term) ||
      node.label?.toLowerCase().includes(term) ||
      node.value?.toLowerCase().includes(term)
    );
  }, [flatNodes, searchTerm]);

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
        fontFamily: 'Monaco, Consolas, monospace',
        fontSize: '13px',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px' }}>
        <div style={{ color: '#cbd5e1', fontWeight: '700', fontSize: '14px' }}>
          UI Hierarchy
        </div>
        <div style={{ display: 'flex', gap: '8px' }}>
          <button
            onClick={() => setViewMode('tree')}
            aria-pressed={viewMode === 'tree'}
            style={{
              background: viewMode === 'tree' ? '#22c55e' : '#1f2937',
              color: viewMode === 'tree' ? '#000' : '#9ca3af',
              border: 'none',
              padding: '4px 12px',
              borderRadius: '6px',
              fontSize: '11px',
              cursor: 'pointer',
              fontWeight: '600',
            }}
          >
            Tree
          </button>
          <button
            onClick={() => setViewMode('list')}
            aria-pressed={viewMode === 'list'}
            style={{
              background: viewMode === 'list' ? '#22c55e' : '#1f2937',
              color: viewMode === 'list' ? '#000' : '#9ca3af',
              border: 'none',
              padding: '4px 12px',
              borderRadius: '6px',
              fontSize: '11px',
              cursor: 'pointer',
              fontWeight: '600',
            }}
          >
            List
          </button>
        </div>
      </div>
      <input
        type="text"
        placeholder="Search elements..."
        value={searchTerm}
        onChange={(e) => setSearchTerm(e.target.value)}
        style={{
          width: '100%',
          background: '#0e1726',
          border: '1px solid #1f2937',
          borderRadius: '8px',
          padding: '8px 12px',
          color: '#e5e7eb',
          fontSize: '13px',
          marginBottom: '12px',
        }}
      />
      <div ref={scrollContainerRef} style={{ flex: 1, overflow: 'auto' }}>
        {viewMode === 'tree' ? (
          <TreeNode node={tree} level={0} selectedNode={selectedNode} onSelect={onSelect} nodeRef={handleNodeRef} />
        ) : (
          <div>
            {filteredNodes.map(({ node, level }, index) => {
              const isSelected = selectedNode && 
                                selectedNode.type === node.type && 
                                selectedNode.x === node.x && 
                                selectedNode.y === node.y &&
                                selectedNode.width === node.width &&
                                selectedNode.height === node.height;
              return (
                <ListItem
                  key={index}
                  node={node}
                  level={level}
                  isSelected={!!isSelected}
                  onSelect={onSelect}
                  nodeRef={handleNodeRef}
                />
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
