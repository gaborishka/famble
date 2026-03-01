import React, { useMemo, useRef, useLayoutEffect, useEffect, useState, useCallback } from 'react';
import { MapNode } from '../../../shared/types/game';
import { motion } from 'motion/react';

// ────────────────────────────────────────────
// SVG Icon Components
// ────────────────────────────────────────────

const CombatIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" className={className}>
    <line x1="5" y1="5" x2="19" y2="19" />
    <line x1="19" y1="5" x2="5" y2="19" />
    <line x1="5" y1="9" x2="9" y2="5" />
    <line x1="15" y1="5" x2="19" y2="9" />
    <line x1="5" y1="15" x2="9" y2="19" />
    <line x1="15" y1="19" x2="19" y2="15" />
  </svg>
);

const EventIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg viewBox="0 0 24 24" fill="currentColor" className={className}>
    <path d="M11 4C9 4 7.5 5.5 7.5 7.5c0 1.5.8 2.7 2 3.3l-.3 3.2h5.6l-.3-3.2c1.2-.6 2-1.8 2-3.3C16.5 5.5 15 4 13 4h-2z" />
    <circle cx="12" cy="18" r="1.5" />
  </svg>
);

const ShopIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg viewBox="0 0 24 24" fill="currentColor" className={className}>
    <path d="M12 2C9.2 2 7 4.5 7 7v1H4.5c-.8 0-1.5.7-1.5 1.5V11l1.5 9c.1.6.6 1 1.2 1h12.6c.6 0 1.1-.4 1.2-1l1.5-9V9.5c0-.8-.7-1.5-1.5-1.5H17V7c0-2.5-2.2-5-5-5zm-3 5c0-1.7 1.3-3 3-3s3 1.3 3 3v1H9V7z" />
    <text x="12" y="17" textAnchor="middle" fontSize="8" fontWeight="bold" fill="white" fontFamily="sans-serif">$</text>
  </svg>
);

const TreasureIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg viewBox="0 0 24 24" fill="currentColor" className={className}>
    <rect x="3" y="11" width="18" height="9" rx="2" />
    <path d="M4 11V9a2 2 0 012-2h12a2 2 0 012 2v2" />
    <rect x="10" y="9" width="4" height="5" rx="1" />
    <circle cx="12" cy="12.5" r="1" fill="white" opacity="0.7" />
  </svg>
);

const BossIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg viewBox="0 0 24 24" fill="currentColor" className={className}>
    <path d="M12 3C7.6 3 4 6.6 4 11c0 2.8 1.5 5.3 3.7 6.7l-.2 1.3h9l-.2-1.3C18.5 16.3 20 13.8 20 11c0-4.4-3.6-8-8-8z" />
    <ellipse cx="9" cy="11" rx="1.8" ry="2" fill="white" />
    <ellipse cx="15" cy="11" rx="1.8" ry="2" fill="white" />
    <path d="M11 14.5l1 1.5 1-1.5" fill="none" stroke="white" strokeWidth="1" />
    <rect x="7.5" y="19" width="9" height="2.5" rx="1" />
    <line x1="9.5" y1="19" x2="9.5" y2="21.5" stroke="white" strokeWidth="0.8" />
    <line x1="12" y1="19" x2="12" y2="21.5" stroke="white" strokeWidth="0.8" />
    <line x1="14.5" y1="19" x2="14.5" y2="21.5" stroke="white" strokeWidth="0.8" />
  </svg>
);

const EliteIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" className={className}>
    <path d="M12 2L15 8L22 9L17 14L18.5 21L12 17.5L5.5 21L7 14L2 9L9 8L12 2Z" fill="currentColor" fillOpacity="0.2" />
  </svg>
);

const CampfireIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className={className}>
    <path d="M17 15C17 12.2386 14.7614 10 12 10C9.23858 10 7 12.2386 7 15C7 17.7614 9.23858 20 12 20C14.7614 20 17 17.7614 17 15Z" fill="currentColor" fillOpacity="0.4" />
    <path d="M12 22C12 22 20 18 20 12C20 6 12 2 12 2C12 2 4 6 4 12C4 18 12 22 12 22Z" stroke="currentColor" />
    <path d="M12 20C12 20 16 17 16 13C16 9 12 6 12 6C12 6 8 9 8 13C8 17 12 20 12 20Z" fill="currentColor" />
  </svg>
);

const getIcon = (type: MapNode['type'], className?: string) => {
  switch (type) {
    case 'Combat': return <CombatIcon className={className} />;
    case 'Event': return <EventIcon className={className} />;
    case 'Shop': return <ShopIcon className={className} />;
    case 'Treasure': return <TreasureIcon className={className} />;
    case 'Boss': return <BossIcon className={className} />;
    case 'Elite': return <EliteIcon className={className} />;
    case 'Campfire': return <CampfireIcon className={className} />;
  }
};

// ────────────────────────────────────────────
// Styling helpers
// ────────────────────────────────────────────

const borderStyle = (type: MapNode['type']): string => {
  switch (type) {
    case 'Combat': return 'border-slate-300';
    case 'Event': return 'border-amber-400';
    case 'Shop': return 'border-emerald-400';
    case 'Treasure': return 'border-amber-400';
    case 'Boss': return 'border-red-400';
    case 'Elite': return 'border-fuchsia-400';
    case 'Campfire': return 'border-orange-400';
  }
};

const borderStyleMuted = (type: MapNode['type']): string => {
  switch (type) {
    case 'Combat': return 'border-slate-500/60';
    case 'Event': return 'border-amber-600/55';
    case 'Shop': return 'border-emerald-600/55';
    case 'Treasure': return 'border-amber-600/55';
    case 'Boss': return 'border-red-600/55';
    case 'Elite': return 'border-fuchsia-600/55';
    case 'Campfire': return 'border-orange-600/55';
  }
};

const borderStyleDone = (): string => 'border-slate-600/40';

const iconColor = (type: MapNode['type']): string => {
  switch (type) {
    case 'Combat': return 'text-white';
    case 'Event': return 'text-amber-400';
    case 'Shop': return 'text-emerald-400';
    case 'Treasure': return 'text-amber-400';
    case 'Boss': return 'text-red-400';
    case 'Elite': return 'text-fuchsia-400';
    case 'Campfire': return 'text-orange-400';
  }
};

const bgAvailable = (type: MapNode['type']): string => {
  switch (type) {
    case 'Combat': return 'bg-slate-700';
    case 'Event': return 'bg-amber-900/90';
    case 'Shop': return 'bg-emerald-900/90';
    case 'Treasure': return 'bg-amber-900/80';
    case 'Boss': return 'bg-red-900/90';
    case 'Elite': return 'bg-fuchsia-900/90';
    case 'Campfire': return 'bg-orange-900/90';
  }
};

const glowStyle = (type: MapNode['type']): React.CSSProperties => {
  // Strong, unmissable glow for available nodes
  switch (type) {
    case 'Boss': return { boxShadow: '0 0 30px 10px rgba(239,68,68,0.6), 0 0 60px 20px rgba(239,68,68,0.2), inset 0 0 12px rgba(239,68,68,0.15)' };
    case 'Event': return { boxShadow: '0 0 24px 8px rgba(251,146,60,0.5), 0 0 50px 16px rgba(251,146,60,0.15)' };
    case 'Shop': return { boxShadow: '0 0 24px 8px rgba(16,185,129,0.5), 0 0 50px 16px rgba(16,185,129,0.15)' };
    case 'Treasure': return { boxShadow: '0 0 24px 8px rgba(245,158,11,0.5), 0 0 50px 16px rgba(245,158,11,0.15)' };
    case 'Elite': return { boxShadow: '0 0 26px 8px rgba(217,70,239,0.55), 0 0 50px 16px rgba(217,70,239,0.15), inset 0 0 8px rgba(217,70,239,0.2)' };
    case 'Campfire': return { boxShadow: '0 0 26px 10px rgba(249,115,22,0.55), 0 0 50px 16px rgba(249,115,22,0.15), inset 0 0 12px rgba(249,115,22,0.2)' };
    default: return { boxShadow: '0 0 24px 8px rgba(148,163,184,0.4), 0 0 50px 16px rgba(148,163,184,0.1)' };
  }
};

const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, value));

// ────────────────────────────────────────────
// Props
// ────────────────────────────────────────────

interface NodeMapProps {
  nodes: MapNode[];
  currentNodeId: string | null;
  onNodeSelect: (node: MapNode) => void;
  playerHp?: number;
  playerMaxHp?: number;
  gold?: number;
  bossName?: string;
  totalFloors?: number;
}

export const NodeMap: React.FC<NodeMapProps> = ({
  nodes,
  currentNodeId,
  onNodeSelect,
  playerHp = 50,
  playerMaxHp = 50,
  gold = 0,
  bossName = 'Boss',
  totalFloors = 5,
}) => {
  const mapRef = useRef<HTMLDivElement>(null);
  const nodeRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const [nodePositions, setNodePositions] = useState<Record<string, { x: number; y: number }>>({});
  const [containerSize, setContainerSize] = useState({ width: 0, height: 0 });

  const currentNode = nodes.find(n => n.id === currentNodeId);

  // Compute available nodes: after completing a node, its nextNodes become available
  const availableNodes = useMemo(() => {
    if (!currentNode) {
      // No node selected yet — row 0 nodes are available
      return nodes.filter(n => n.row === 0 || (n.row === undefined && n.y === 0)).map(n => n.id);
    }
    if (currentNode.completed) {
      // Current node is done — show its next nodes as available
      return currentNode.nextNodes;
    }
    // Current node is in-progress (shouldn't happen on map view, but safe fallback)
    return [currentNode.id];
  }, [currentNode, nodes]);
  const availableNodeSet = useMemo(() => new Set(availableNodes), [availableNodes]);
  const completedNodeSet = useMemo(
    () => new Set(nodes.filter(node => node.completed).map(node => node.id)),
    [nodes],
  );
  const hasStartedRun = completedNodeSet.size > 0;

  // Visualized as the "player path" (already traversed edges).
  const completedPathEdges = useMemo(() => {
    const traversedEdges = new Set<string>();
    nodes.forEach(node => {
      if (!completedNodeSet.has(node.id)) return;
      node.nextNodes.forEach(nextId => {
        if (completedNodeSet.has(nextId)) {
          traversedEdges.add(`${node.id}->${nextId}`);
        }
      });
    });
    return traversedEdges;
  }, [nodes, completedNodeSet]);

  // Visualized as immediate route options from the current node.
  const frontierEdges = useMemo(() => {
    const nextEdges = new Set<string>();
    if (!currentNode || !currentNode.completed) return nextEdges;
    currentNode.nextNodes.forEach(nextId => {
      if (availableNodeSet.has(nextId)) {
        nextEdges.add(`${currentNode.id}->${nextId}`);
      }
    });
    return nextEdges;
  }, [currentNode, availableNodeSet]);

  const initialAvailableNodeId = useMemo(() => {
    if (hasStartedRun) return null;
    const firstStartNode = nodes.find(node => (
      (node.row === 0 || (node.row === undefined && node.y === 0))
      && availableNodeSet.has(node.id)
    ));
    return firstStartNode?.id || null;
  }, [nodes, hasStartedRun, availableNodeSet]);

  // Group nodes by row
  const rows = useMemo(() => {
    const rowMap = new Map<number, MapNode[]>();
    nodes.forEach(n => {
      const row = n.row ?? Math.round(n.y / 20);
      if (!rowMap.has(row)) rowMap.set(row, []);
      rowMap.get(row)!.push(n);
    });
    return Array.from(rowMap.entries()).sort((a, b) => a[0] - b[0]);
  }, [nodes]);

  const maxRow = rows.length > 0 ? rows[rows.length - 1][0] : 0;
  const rowCount = rows.length || 1;
  const maxNodesInRow = useMemo(
    () => rows.reduce((max, [, rowNodes]) => Math.max(max, rowNodes.length), 1),
    [rows],
  );

  const rowGapClass = maxNodesInRow >= 6 ? 'gap-5 sm:gap-7 lg:gap-10' : 'gap-6 sm:gap-9 lg:gap-12';

  // Current floor
  const currentFloor = useMemo(() => {
    let maxCompletedRow = -1;
    nodes.forEach(n => {
      if (n.completed) {
        const row = n.row ?? Math.round(n.y / 20);
        if (row > maxCompletedRow) maxCompletedRow = row;
      }
    });
    return Math.min(maxCompletedRow + 2, totalFloors);
  }, [nodes, totalFloors]);

  // Measure node positions for SVG connections
  const measurePositions = useCallback(() => {
    const positions: Record<string, { x: number; y: number }> = {};
    const container = mapRef.current;
    if (!container) return;
    const containerRect = container.getBoundingClientRect();
    const nextWidth = Math.round(containerRect.width);
    const nextHeight = Math.round(containerRect.height);

    setContainerSize(prev => (
      prev.width === nextWidth && prev.height === nextHeight
        ? prev
        : { width: nextWidth, height: nextHeight }
    ));

    (Object.entries(nodeRefs.current) as [string, HTMLButtonElement | null][]).forEach(([id, el]) => {
      if (el) {
        const rect = el.getBoundingClientRect();
        positions[id] = {
          x: rect.left - containerRect.left + rect.width / 2,
          y: rect.top - containerRect.top + rect.height / 2,
        };
      }
    });
    setNodePositions(positions);
  }, []);

  useLayoutEffect(() => {
    measurePositions();
    const container = mapRef.current;
    const observer = container ? new ResizeObserver(() => measurePositions()) : null;
    if (container && observer) observer.observe(container);
    window.addEventListener('resize', measurePositions);
    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', measurePositions);
    };
  }, [nodes, rows, measurePositions]);

  // Adapt node size based on screen size
  const { NODE_SIZE, BOSS_SIZE } = useMemo(() => {
    const width = containerSize.width || (typeof window !== 'undefined' ? window.innerWidth : 960);
    const isMobile = width < 640;
    const nodeSize = isMobile ? 60 : 76;
    const bossSize = isMobile ? 84 : 108;
    return { NODE_SIZE: nodeSize, BOSS_SIZE: bossSize };
  }, [containerSize.width]);

  const HALF = NODE_SIZE / 2;
  const BOSS_HALF = BOSS_SIZE / 2;

  useLayoutEffect(() => {
    measurePositions();
  }, [measurePositions, NODE_SIZE, BOSS_SIZE]);

  // Auto-scroll to show the available nodes area
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    // Find the first available node ref and scroll it into view
    const targetId = availableNodes[0];
    if (!targetId) return;
    const el = nodeRefs.current[targetId];
    if (!el || !scrollContainerRef.current) return;
    // Small delay to let layout settle
    const timer = setTimeout(() => {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 150);
    return () => clearTimeout(timer);
  }, [availableNodes, nodes]);

  // Render connections (curved bezier paths)
  const connections = useMemo(() => {
    const lines: React.ReactNode[] = [];
    nodes.forEach(node => {
      node.nextNodes.forEach(nextId => {
        const fromPos = nodePositions[node.id];
        const toPos = nodePositions[nextId];
        if (!fromPos || !toPos) return;

        const target = nodes.find(n => n.id === nextId);
        const edgeId = `${node.id}->${nextId}`;
        const isCompletedPath = completedPathEdges.has(edgeId);
        const isFrontier = frontierEdges.has(edgeId);

        const isBossTarget = target?.type === 'Boss';
        const fromHalf = node.type === 'Boss' ? BOSS_HALF : HALF;
        const toHalf = isBossTarget ? BOSS_HALF : HALF;

        const fromY = fromPos.y - fromHalf;
        const toY = toPos.y + toHalf;
        const midY = (fromY + toY) / 2;

        const pathD = `M ${fromPos.x} ${fromY} C ${fromPos.x} ${midY}, ${toPos.x} ${midY}, ${toPos.x} ${toY}`;

        const baseStroke = isCompletedPath ? '#2dd4bf' : isFrontier ? '#f8fafc' : '#334155';
        const strokeWidth = isCompletedPath ? 4.8 : isFrontier ? 4.2 : 2.6;
        const strokeOpacity = isCompletedPath ? 0.9 : isFrontier ? 0.92 : 0.38;

        lines.push(
          <g key={`${node.id}-${nextId}`}>
            {(isCompletedPath || isFrontier) && (
              <path
                d={pathD}
                fill="none"
                stroke={isCompletedPath ? '#2dd4bf66' : '#e2e8f055'}
                strokeWidth={isCompletedPath ? 9.5 : 8}
                strokeLinecap="round"
              />
            )}
            <path
              d={pathD}
              fill="none"
              stroke={baseStroke}
              strokeWidth={strokeWidth}
              strokeOpacity={strokeOpacity}
              strokeLinecap="round"
            />
          </g>
        );
      });
    });
    return lines;
  }, [nodes, nodePositions, completedPathEdges, frontierEdges, HALF, BOSS_HALF]);

  const hpPercent = Math.round((playerHp / playerMaxHp) * 100);

  return (
    <div ref={scrollContainerRef} className="w-full h-screen bg-slate-950 flex flex-col items-center overflow-x-hidden overflow-y-auto">
      {/* ── HUD Bar ── */}
      <div className="w-full flex items-center justify-between px-4 sm:px-8 py-3 gap-6 shrink-0 sticky top-0 bg-slate-950/95 backdrop-blur-sm z-30 border-b border-slate-800/50">
        {/* HP */}
        <div className="flex items-center gap-3">
          <span className="text-sm font-bold text-white tracking-wide">HP</span>
          <div className="w-32 h-5 bg-slate-800 rounded-full overflow-hidden border border-slate-700">
            <div
              className="h-full bg-emerald-500 rounded-full transition-all duration-300"
              style={{ width: `${hpPercent}%` }}
            />
          </div>
          <span className="text-sm font-semibold text-white tabular-nums">{playerHp}/{playerMaxHp}</span>
        </div>
        {/* Gold */}
        <div className="flex items-center gap-2">
          <svg viewBox="0 0 20 20" className="w-5 h-5">
            <circle cx="10" cy="10" r="9" fill="#facc15" stroke="#a16207" strokeWidth="1.5" />
            <text x="10" y="14.5" textAnchor="middle" fontSize="11" fontWeight="bold" fill="#a16207" fontFamily="sans-serif">$</text>
          </svg>
          <span className="text-sm font-bold text-white tabular-nums">{gold}</span>
        </div>
        {/* Floor */}
        <span className="text-sm font-bold text-slate-300 tracking-wide">Floor {currentFloor}/{totalFloors}</span>
      </div>

      {/* ── Map + Legend ── */}
      <div className="flex-1 w-full flex flex-col lg:flex-row items-stretch justify-center min-h-0 px-3 sm:px-4 lg:px-6 pb-4 gap-4">

        {/* Map Panel — compact with reduced gaps */}
        <div
          ref={mapRef}
          className="relative flex flex-col items-center flex-1 min-w-0 w-full max-w-[750px] gap-8 sm:gap-12 lg:gap-14 py-8 sm:py-12 lg:py-16"
        >
          {/* SVG layer */}
          <svg className="absolute inset-0 w-full h-full pointer-events-none z-0" style={{ overflow: 'visible' }}>
            {connections}
          </svg>

          {/* Rows: top = boss, bottom = start */}
          {[...rows].reverse().map(([rowIdx, rowNodes]) => {
            const isBossRow = rowIdx === maxRow;
            const isStartRow = rowIdx === 0;

            return (
              <div key={rowIdx} className="relative z-10 flex flex-col items-center w-full">
                {/* Boss name label */}
                {isBossRow && (
                  <div className="text-white text-base sm:text-lg font-semibold mb-3 tracking-wide text-center">{bossName}</div>
                )}

                {/* Row of nodes */}
                <div className={`flex items-center justify-center w-full ${rowGapClass}`}>
                  {rowNodes.map(node => {
                    const isNodeAvailable = availableNodes.includes(node.id);
                    const isCurrent = node.id === currentNodeId;
                    const isCompleted = node.completed;
                    const isBoss = node.type === 'Boss';
                    const size = isBoss ? BOSS_SIZE : NODE_SIZE;
                    const isInitialAvailable = node.id === initialAvailableNodeId;

                    let containerClasses: string;
                    let iconClasses: string;
                    let style: React.CSSProperties = {};
                    let borderWidth = 'border-2';

                    if (isCompleted) {
                      // Visited — faded, muted border
                      containerClasses = `bg-slate-800/50 ${borderStyleDone()} opacity-55`;
                      iconClasses = 'text-slate-500';
                    } else if (isNodeAvailable) {
                      // Can be selected — bright, glowing, thick border
                      containerClasses = `${bgAvailable(node.type)} ${borderStyle(node.type)} cursor-pointer`;
                      iconClasses = iconColor(node.type);
                      style = glowStyle(node.type);
                      borderWidth = 'border-[3px]';
                    } else {
                      // Locked — dark, very muted
                      containerClasses = `bg-slate-800/60 ${borderStyleMuted(node.type)} cursor-not-allowed`;
                      iconClasses = iconColor(node.type);
                      style = { opacity: 0.45 };
                    }

                    return (
                      <div key={node.id} className="relative flex flex-col items-center">
                        <motion.button
                          ref={(el: HTMLButtonElement | null) => { nodeRefs.current[node.id] = el; }}
                          className={`
                            relative flex items-center justify-center rounded-full ${borderWidth} transition-all
                            ${containerClasses}
                          `}
                          style={{
                            width: size,
                            height: size,
                            ...style,
                          }}
                          onClick={() => isNodeAvailable && onNodeSelect(node)}
                          disabled={!isNodeAvailable}
                          whileHover={isNodeAvailable && !isCompleted ? { scale: 1.1 } : {}}
                          whileTap={isNodeAvailable && !isCompleted ? { scale: 0.94 } : {}}
                          animate={isNodeAvailable && !isCompleted ? {
                            scale: [1, 1.05, 1],
                          } : {}}
                          transition={isNodeAvailable && !isCompleted ? {
                            duration: 2,
                            repeat: Infinity,
                            ease: 'easeInOut',
                          } : {}}
                          aria-label={`${node.type} node ${isNodeAvailable ? '(available)' : isCompleted ? '(completed)' : '(locked)'}`}
                        >
                          {isNodeAvailable && !isCompleted && (
                            <span className="absolute inset-[-5px] rounded-full border border-cyan-200/70 animate-pulse pointer-events-none" />
                          )}
                          {getIcon(
                            node.type,
                            `${isBoss ? 'w-[44%] h-[44%]' : 'w-[42%] h-[42%]'} ${iconClasses}`
                          )}
                        </motion.button>

                        {isCompleted && (
                          <span className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-teal-500 border border-teal-200 text-[11px] leading-none flex items-center justify-center text-slate-950 font-bold shadow-md shadow-teal-500/30">
                            ✓
                          </span>
                        )}
                        {!isCompleted && !isNodeAvailable && (
                          <span className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-slate-800 border border-slate-600 text-[11px] leading-none flex items-center justify-center text-slate-300">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-3 h-3">
                              <rect x="5" y="11" width="14" height="10" rx="2" />
                              <path d="M8 11V8a4 4 0 018 0v3" />
                            </svg>
                          </span>
                        )}

                        {isInitialAvailable && (
                          <div className="flex flex-col items-center mt-1.5">
                            <span className="text-cyan-200 text-xs leading-none">▼</span>
                            <span className="text-cyan-200 text-[11px] font-bold tracking-wider uppercase">Start Here</span>
                          </div>
                        )}

                        {/* Current position marker — "▲ YOU" below the node */}
                        {isCurrent && !isInitialAvailable && (
                          <div className="flex flex-col items-center mt-1">
                            <span className="text-orange-400 text-xs leading-none">▲</span>
                            <span className="text-orange-400 text-[10px] font-bold tracking-wider">YOU</span>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>

                {/* Start indicator */}
                {isStartRow && (
                  <div className="flex flex-col items-center mt-2">
                    <div className="w-2.5 h-2.5 bg-slate-500 rounded-full" />
                    <span className="text-slate-500 text-xs mt-0.5 font-medium">Start</span>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* ── Legend ── */}
        <div className="shrink-0 w-full lg:w-[240px] flex flex-col gap-3 lg:gap-4 px-1 sm:px-2 lg:pl-4 lg:pr-2 content-center">
          <div className="rounded-xl border border-slate-800 bg-slate-900/80 p-3">
            <div className="text-[11px] uppercase tracking-wider text-slate-400 font-semibold mb-2">Node Type</div>
            <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-1 gap-x-3 gap-y-2 lg:gap-3 place-items-start">
              {([
                ['Combat', CombatIcon, 'text-white'],
                ['Event', EventIcon, 'text-amber-400'],
                ['Elite', EliteIcon, 'text-fuchsia-400'],
                ['Shop', ShopIcon, 'text-emerald-400'],
                ['Campfire', CampfireIcon, 'text-orange-400'],
                ['Treasure', TreasureIcon, 'text-amber-400'],
                ['Boss', BossIcon, 'text-red-400'],
              ] as const).map(([label, Icon, color]) => (
                <div key={label} className="flex items-center gap-2">
                  <div className="w-6 h-6 sm:w-7 sm:h-7 flex items-center justify-center">
                    <Icon className={`w-5 h-5 sm:w-6 sm:h-6 ${color}`} />
                  </div>
                  <span className="text-xs sm:text-sm text-slate-300 font-medium">{label}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-xl border border-slate-800 bg-slate-900/80 p-3">
            <div className="text-[11px] uppercase tracking-wider text-slate-400 font-semibold mb-2">Path Status</div>
            <div className="flex flex-col gap-2 text-xs sm:text-sm text-slate-300">
              <div className="flex items-center gap-2">
                <span className="w-3 h-3 rounded-full border border-cyan-200 bg-cyan-400/40 shadow-sm shadow-cyan-300/40" />
                <span>Available node</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="w-3 h-3 rounded-full bg-teal-400/85" />
                <span>Completed node</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="w-3 h-3 rounded-full bg-slate-700 border border-slate-500" />
                <span>Locked node</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="w-8 h-1 rounded-full bg-teal-400" />
                <span>Your route</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="w-8 h-1 rounded-full bg-slate-100" />
                <span>Next possible path</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
