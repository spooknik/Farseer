import { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import TerminalPane from './TerminalPane';
import type { Machine } from '../types';
import { useKeyboardShortcuts, type KeyboardShortcut } from '../hooks/useKeyboardShortcuts';

// Split node types
interface LeafNode {
  type: 'leaf';
  id: string;
  machineId: number; // Which machine this pane is connected to
}

interface SplitNode {
  type: 'split';
  direction: 'horizontal' | 'vertical';
  children: [TreeNode, TreeNode];
  // Ratio of first child (0-1), second child gets the rest
  ratio: number;
}

type TreeNode = LeafNode | SplitNode;

// Represents a pane's position and size (in percentages)
interface PaneLayout {
  id: string;
  machineId: number;
  left: number;   // percentage from left
  top: number;    // percentage from top
  width: number;  // percentage width
  height: number; // percentage height
}

// Represents a divider between panes
interface DividerLayout {
  id: string;
  direction: 'horizontal' | 'vertical';
  left: number;
  top: number;
  width: number;
  height: number;
}

interface SplitTerminalContainerProps {
  machine: Machine;
  availableMachines: Machine[];
  onStatusChange?: (machineId: number, status: 'connecting' | 'connected' | 'disconnected' | 'error') => void;
}

// Generate unique pane IDs
let paneIdCounter = 0;
function generatePaneId(): string {
  return `pane-${++paneIdCounter}`;
}

// Divider thickness in pixels
const DIVIDER_SIZE = 4;

export default function SplitTerminalContainer({ machine, availableMachines, onStatusChange }: SplitTerminalContainerProps) {
  // Tree structure for managing splits
  const [tree, setTree] = useState<TreeNode>(() => ({
    type: 'leaf',
    id: generatePaneId(),
    machineId: machine.id,
  }));
  
  // Track focused pane
  const [focusedPaneId, setFocusedPaneId] = useState<string>(() => {
    if (tree.type === 'leaf') return tree.id;
    return '';
  });

  // Track status of each pane (use the "best" status for parent reporting)
  const [paneStatuses, setPaneStatuses] = useState<Record<string, 'connecting' | 'connected' | 'disconnected' | 'error'>>({});

  // Get all pane IDs from tree
  const getAllPaneIds = useCallback((node: TreeNode): string[] => {
    if (node.type === 'leaf') {
      return [node.id];
    }
    return [...getAllPaneIds(node.children[0]), ...getAllPaneIds(node.children[1])];
  }, []);

  // Get machine for a pane
  const getPaneMachine = useCallback((node: TreeNode, paneId: string): Machine | null => {
    if (node.type === 'leaf') {
      if (node.id === paneId) {
        return availableMachines.find(m => m.id === node.machineId) || machine;
      }
      return null;
    }
    return getPaneMachine(node.children[0], paneId) || getPaneMachine(node.children[1], paneId);
  }, [availableMachines, machine]);

  // Report aggregate status to parent - for each machine, report best status across all its panes
  
  // Get all leaf nodes with their machine IDs
  const getAllLeafNodes = useCallback((node: TreeNode): { id: string; machineId: number }[] => {
    if (node.type === 'leaf') {
      return [{ id: node.id, machineId: node.machineId }];
    }
    return [...getAllLeafNodes(node.children[0]), ...getAllLeafNodes(node.children[1])];
  }, []);

  // Store onStatusChange in a ref to avoid dependency issues in cleanup
  const onStatusChangeRef = useRef(onStatusChange);
  onStatusChangeRef.current = onStatusChange;

  // Store tree in a ref for cleanup
  const treeRef = useRef(tree);
  treeRef.current = tree;

  // Clear statuses when container unmounts (tab closed)
  useEffect(() => {
    return () => {
      // On unmount, report disconnected for all machines in this container
      const leafNodes = getAllLeafNodes(treeRef.current);
      const machineIds = new Set(leafNodes.map(n => n.machineId));
      machineIds.forEach(machineId => {
        onStatusChangeRef.current?.(machineId, 'disconnected');
      });
    };
  }, [getAllLeafNodes]);

  // Report status for each machine that has panes in this container
  useEffect(() => {
    const leafNodes = getAllLeafNodes(tree);
    
    // Group panes by machine ID
    const machineStatuses: Record<number, ('connecting' | 'connected' | 'disconnected' | 'error')[]> = {};
    
    leafNodes.forEach(({ id, machineId }) => {
      if (!machineStatuses[machineId]) {
        machineStatuses[machineId] = [];
      }
      machineStatuses[machineId].push(paneStatuses[id] || 'connecting');
    });
    
    // For each machine, determine the best status and report it
    Object.entries(machineStatuses).forEach(([machineIdStr, statuses]) => {
      const machineId = parseInt(machineIdStr, 10);
      let bestStatus: 'connecting' | 'connected' | 'disconnected' | 'error' = 'disconnected';
      
      if (statuses.some(s => s === 'connected')) {
        bestStatus = 'connected';
      } else if (statuses.some(s => s === 'connecting')) {
        bestStatus = 'connecting';
      } else if (statuses.some(s => s === 'error')) {
        bestStatus = 'error';
      }
      
      onStatusChange?.(machineId, bestStatus);
    });
  }, [tree, paneStatuses, getAllLeafNodes, onStatusChange]);

  // Calculate flat layout from tree structure
  // This computes the absolute position and size of each pane
  const { paneLayouts, dividerLayouts } = useMemo(() => {
    const panes: PaneLayout[] = [];
    const dividers: DividerLayout[] = [];
    let dividerId = 0;

    function calculateLayout(
      node: TreeNode,
      left: number,
      top: number,
      width: number,
      height: number
    ): void {
      if (node.type === 'leaf') {
        panes.push({
          id: node.id,
          machineId: node.machineId,
          left,
          top,
          width,
          height,
        });
        return;
      }

      const { direction, ratio, children } = node;
      const isVertical = direction === 'vertical';

      if (isVertical) {
        // Split left/right
        const firstWidth = width * ratio;
        const secondWidth = width * (1 - ratio);

        calculateLayout(children[0], left, top, firstWidth, height);
        calculateLayout(children[1], left + firstWidth, top, secondWidth, height);

        // Add vertical divider
        dividers.push({
          id: `divider-${dividerId++}`,
          direction: 'vertical',
          left: left + firstWidth,
          top,
          width: 0, // Will be styled with fixed pixel width
          height,
        });
      } else {
        // Split top/bottom
        const firstHeight = height * ratio;
        const secondHeight = height * (1 - ratio);

        calculateLayout(children[0], left, top, width, firstHeight);
        calculateLayout(children[1], left, top + firstHeight, width, secondHeight);

        // Add horizontal divider
        dividers.push({
          id: `divider-${dividerId++}`,
          direction: 'horizontal',
          left,
          top: top + firstHeight,
          width,
          height: 0, // Will be styled with fixed pixel height
        });
      }
    }

    calculateLayout(tree, 0, 0, 100, 100);
    return { paneLayouts: panes, dividerLayouts: dividers };
  }, [tree]);

  // Find and replace a node in the tree
  const replaceNode = useCallback((root: TreeNode, targetId: string, newNode: TreeNode): TreeNode => {
    if (root.type === 'leaf') {
      if (root.id === targetId) {
        return newNode;
      }
      return root;
    }
    
    return {
      ...root,
      children: [
        replaceNode(root.children[0], targetId, newNode),
        replaceNode(root.children[1], targetId, newNode),
      ] as [TreeNode, TreeNode],
    };
  }, []);

  // Remove a node from the tree (replace parent split with sibling)
  const removeNode = useCallback((root: TreeNode, targetId: string): TreeNode | null => {
    if (root.type === 'leaf') {
      if (root.id === targetId) {
        return null; // This node should be removed
      }
      return root;
    }
    
    const [first, second] = root.children;
    
    // Check if either child is the target
    if (first.type === 'leaf' && first.id === targetId) {
      return second; // Return sibling
    }
    if (second.type === 'leaf' && second.id === targetId) {
      return first; // Return sibling
    }
    
    // Recurse into children
    const newFirst = removeNode(first, targetId);
    const newSecond = removeNode(second, targetId);
    
    if (newFirst === null) return newSecond;
    if (newSecond === null) return newFirst;
    
    return {
      ...root,
      children: [newFirst, newSecond] as [TreeNode, TreeNode],
    };
  }, []);

  // Get the machine ID for a pane from the tree
  const getPaneMachineId = useCallback((node: TreeNode, paneId: string): number | null => {
    if (node.type === 'leaf') {
      return node.id === paneId ? node.machineId : null;
    }
    return getPaneMachineId(node.children[0], paneId) ?? getPaneMachineId(node.children[1], paneId);
  }, []);

  // Split a pane with a specific machine
  const handleSplit = useCallback((paneId: string, direction: 'horizontal' | 'vertical', targetMachine: Machine) => {
    const newPaneId = generatePaneId();
    
    // Get current pane's machine ID
    const currentMachineId = getPaneMachineId(tree, paneId) || machine.id;
    
    const newNode: SplitNode = {
      type: 'split',
      direction,
      ratio: 0.5,
      children: [
        { type: 'leaf', id: paneId, machineId: currentMachineId },
        { type: 'leaf', id: newPaneId, machineId: targetMachine.id },
      ],
    };
    
    setTree(current => replaceNode(current, paneId, newNode));
    // Focus the new pane
    setFocusedPaneId(newPaneId);
  }, [replaceNode, tree, getPaneMachineId, machine.id]);

  // Close a pane
  const handleClosePane = useCallback((paneId: string) => {
    // Can't close the last pane
    if (tree.type === 'leaf') return;
    
    const newTree = removeNode(tree, paneId);
    if (newTree) {
      setTree(newTree);
      // Update focus if the closed pane was focused
      if (focusedPaneId === paneId) {
        const remainingPanes = getAllPaneIds(newTree);
        if (remainingPanes.length > 0) {
          setFocusedPaneId(remainingPanes[0]);
        }
      }
      // Clean up status
      setPaneStatuses(prev => {
        const next = { ...prev };
        delete next[paneId];
        return next;
      });
    }
  }, [tree, removeNode, focusedPaneId, getAllPaneIds]);

  // Handle pane status change
  const handlePaneStatusChange = useCallback((paneId: string, status: 'connecting' | 'connected' | 'disconnected' | 'error') => {
    setPaneStatuses(prev => ({ ...prev, [paneId]: status }));
  }, []);

  // Navigate to next/previous pane
  const navigatePane = useCallback((direction: 'next' | 'prev') => {
    const panes = getAllPaneIds(tree);
    if (panes.length <= 1) return;
    
    const currentIndex = panes.indexOf(focusedPaneId);
    let newIndex: number;
    
    if (direction === 'next') {
      newIndex = (currentIndex + 1) % panes.length;
    } else {
      newIndex = (currentIndex - 1 + panes.length) % panes.length;
    }
    
    setFocusedPaneId(panes[newIndex]);
  }, [tree, focusedPaneId, getAllPaneIds]);

  // Get the focused pane's machine for keyboard shortcuts
  const focusedPaneMachine = useMemo(() => {
    if (!focusedPaneId) return machine;
    return getPaneMachine(tree, focusedPaneId) || machine;
  }, [focusedPaneId, tree, getPaneMachine, machine]);

  // Keyboard shortcuts for split operations
  const splitShortcuts: KeyboardShortcut[] = useMemo(() => [
    {
      key: 'd',
      ctrl: true,
      shift: true,
      action: () => {
        if (focusedPaneId) {
          // Default to same machine for keyboard shortcut
          handleSplit(focusedPaneId, 'vertical', focusedPaneMachine);
        }
      },
      description: 'Split pane vertically',
    },
    {
      key: 'e',
      ctrl: true,
      shift: true,
      action: () => {
        if (focusedPaneId) {
          handleSplit(focusedPaneId, 'horizontal', focusedPaneMachine);
        }
      },
      description: 'Split pane horizontally',
    },
    {
      key: 'x',
      ctrl: true,
      shift: true,
      action: () => {
        if (focusedPaneId && tree.type !== 'leaf') {
          handleClosePane(focusedPaneId);
        }
      },
      description: 'Close focused pane',
    },
    {
      key: 'ArrowRight',
      ctrl: true,
      alt: true,
      action: () => navigatePane('next'),
      description: 'Focus next pane',
    },
    {
      key: 'ArrowLeft',
      ctrl: true,
      alt: true,
      action: () => navigatePane('prev'),
      description: 'Focus previous pane',
    },
  ], [focusedPaneId, focusedPaneMachine, handleSplit, handleClosePane, tree, navigatePane]);

  useKeyboardShortcuts(splitShortcuts);

  const isOnlyPane = tree.type === 'leaf';

  return (
    <div className="h-full w-full overflow-hidden relative">
      {/* Render all terminal panes at the same DOM level with absolute positioning */}
      {paneLayouts.map((layout) => {
        const paneMachine = availableMachines.find(m => m.id === layout.machineId) || machine;
        
        return (
          <div
            key={layout.id}
            className="absolute overflow-hidden"
            style={{
              left: `${layout.left}%`,
              top: `${layout.top}%`,
              width: `${layout.width}%`,
              height: `${layout.height}%`,
            }}
          >
            <TerminalPane
              machine={paneMachine}
              paneId={layout.id}
              isFocused={focusedPaneId === layout.id}
              availableMachines={availableMachines}
              onFocus={() => setFocusedPaneId(layout.id)}
              onClose={isOnlyPane ? undefined : () => handleClosePane(layout.id)}
              onSplitHorizontal={(targetMachine) => handleSplit(layout.id, 'horizontal', targetMachine)}
              onSplitVertical={(targetMachine) => handleSplit(layout.id, 'vertical', targetMachine)}
              onStatusChange={(status) => handlePaneStatusChange(layout.id, status)}
            />
          </div>
        );
      })}

      {/* Render dividers */}
      {dividerLayouts.map((divider) => (
        <div
          key={divider.id}
          className="absolute bg-slate-700 z-10"
          style={
            divider.direction === 'vertical'
              ? {
                  left: `${divider.left}%`,
                  top: `${divider.top}%`,
                  width: `${DIVIDER_SIZE}px`,
                  height: `${divider.height}%`,
                  transform: 'translateX(-50%)',
                }
              : {
                  left: `${divider.left}%`,
                  top: `${divider.top}%`,
                  width: `${divider.width}%`,
                  height: `${DIVIDER_SIZE}px`,
                  transform: 'translateY(-50%)',
                }
          }
        />
      ))}
    </div>
  );
}
