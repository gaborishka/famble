import React, { useMemo, useRef, useLayoutEffect, useState } from 'react';
import { MapNode } from '../../../shared/types/game';
import { motion } from 'motion/react';

// --- SVG Icon Components ---

const CombatIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className={className}>
    <path d="M14.5 2L17 4.5 9.5 12 7 9.5z" />
    <path d="M9.5 22L7 19.5 14.5 12 17 14.5z" />
    <path d="M2 14.5L4.5 17 12 9.5 9.5 7z" />
    <path d="M22 9.5L19.5 7 12 14.5 14.5 17z" />
  </svg>
);

const EventIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg viewBox="0 0 24 24" fill="currentColor" className={className}>
    <text x="12" y="18" textAnchor="middle" fontSize="20" fontWeight="bold" fontFamily="serif">?</text>
  </svg>
);

const ShopIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg viewBox="0 0 24 24" fill="currentColor" className={className}>
    <path d="M12 2C9.5 2 8 4 8 6v1H5a1 1 0 00-1 1v2l1.5 10a1 1 0 001 .9h11a1 1 0 001-.9L20 10V8a1 1 0 00-1-1h-3V6c0-2-1.5-4-4-4zm-2 4c0-1.1.9-2 2-2s2 .9 2 2v1h-4V6z" />
    <text x="12" y="16" textAnchor="middle" fontSize="8" fontWeight="bold" fill="white" fontFamily="sans-serif">$</text>
  </svg>
);

const TreasureIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg viewBox="0 0 24 24" fill="currentColor" className={className}>
    <rect x="3" y="10" width="18" height="10" rx="2" />
    <path d="M3 10h18V8a2 2 0 00-2-2H5a2 2 0 00-2 2v2z" />
    <rect x="10" y="8" width="4" height="6" rx="1" />
  </svg>
);

const BossIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg viewBox="0 0 24 24" fill="currentColor" className={className}>
    <path d="M12 2a9 9 0 00-9 9c0 3.1 1.6 5.8 4 7.4V20a2 2 0 002 2h6a2 2 0 002-2v-1.6c2.4-1.6 4-4.3 4-7.4a9 9 0 00-9-9z" />
    <circle cx="9" cy="10" r="1.5" fill="white" />
    <circle cx="15" cy="10" r="1.5" fill="white" />
    <path d="M9 15h6" stroke="white" strokeWidth="1.5" strokeLinecap="round" fill="none" />
  </svg>
);

const getIcon = (type: MapNode['type'], className?: string) => {
  switch (type) {
    case 'Combat': return <CombatIcon className={className} />;
    case 'Event': return <EventIcon className={className} />;
    case 'Shop': return <ShopIcon className={className} />;
    case 'Treasure': return <TreasureIcon className={className} />;
    case 'Boss': return <BossIcon className={className} />;
  }
};

// --- Border color by type ---

const getBorderColor = (type: MapNode['type']) => {
  switch (type) {
    case 'Combat': return 'border-slate-400';
    case 'Event': return 'border-amber-500';
    case 'Shop': return 'border-emerald-500';
    case 'Treasure': return 'border-amber-500';
    case 'Boss': return 'border-red-500';
  }
};

const getBorderColorCompleted = (type: MapNode['type']) => {
  switch (type) {
    case 'Combat': return 'border-slate-600';
    case 'Event': return 'border-amber-800';
    case 'Shop': return 'border-emerald-800';
    case 'Treasure': return 'border-amber-800';
    case 'Boss': return 'border-red-800';
  }
};

const getIconColor = (type: MapNode['type']) => {
  switch (type) {
    case 'Combat': return 'text-slate-200';
    case 'Event': return 'text-amber-400';
    case 'Shop': return 'text-emerald-400';
    case 'Treasure': return 'text-amber-400';
    case 'Boss': return 'text-red-400';
  }
};

// --- Props ---

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

  const currentNode = nodes.find(n => n.id === currentNodeId);
  const availableNodes = currentNode
    ? currentNode.nextNodes
    : nodes.filter(n => n.row === 0 || (n.row === undefined && n.y === 0)).map(n => n.id);

  // Group nodes by row
  const rows = useMemo(() => {
    const rowMap = new Map<number, MapNode[]>();
    nodes.forEach(n => {
      const row = n.row ?? Math.round(n.y / 20);
      if (!rowMap.has(row)) rowMap.set(row, []);
      rowMap.get(row)!.push(n);
    });
    // Sort rows ascending (bottom to top in data, will be rendered top to bottom reversed)
    return Array.from(rowMap.entries()).sort((a, b) => a[0] - b[0]);
  }, [nodes]);

  const maxRow = rows.length > 0 ? rows[rows.length - 1][0] : 0;

  // Current floor = the row of the furthest completed node + 1, or 1
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
  useLayoutEffect(() => {
    const positions: Record<string, { x: number; y: number }> = {};
    const container = mapRef.current;
    if (!container) return;
    const containerRect = container.getBoundingClientRect();

    Object.entries(nodeRefs.current).forEach(([id, el]) => {
      if (el) {
        const rect = el.getBoundingClientRect();
        positions[id] = {
          x: rect.left - containerRect.left + rect.width / 2,
          y: rect.top - containerRect.top + rect.height / 2,
        };
      }
    });
    setNodePositions(positions);
  }, [nodes, rows]);

  // Render connections
  const connections = useMemo(() => {
    const lines: React.ReactNode[] = [];
    nodes.forEach(node => {
      node.nextNodes.forEach(nextId => {
        const fromPos = nodePositions[node.id];
        const toPos = nodePositions[nextId];
        if (!fromPos || !toPos) return;

        const target = nodes.find(n => n.id === nextId);
        const isCompleted = node.completed && target?.completed;
        const isAvailable = availableNodes.includes(nextId) && (currentNodeId === node.id || node.completed);

        const fromY = fromPos.y - 24; // top of node
        const toY = toPos.y + 24; // bottom of next node
        const midY = (fromY + toY) / 2;

        const pathD = `M ${fromPos.x} ${fromY} C ${fromPos.x} ${midY}, ${toPos.x} ${midY}, ${toPos.x} ${toY}`;

        lines.push(
          <path
            key={`${node.id}-${nextId}`}
            d={pathD}
            fill="none"
            stroke={isCompleted ? '#475569' : isAvailable ? '#94a3b8' : '#1e293b'}
            strokeWidth={2.5}
            strokeLinecap="round"
          />
        );
      });
    });
    return lines;
  }, [nodes, nodePositions, availableNodes, currentNodeId]);

  const hpPercent = Math.round((playerHp / playerMaxHp) * 100);

  return (
    <div className="w-full h-full bg-slate-950 flex flex-col items-center overflow-hidden">
      {/* HUD Bar */}
      <div className="w-full max-w-2xl flex items-center justify-between px-6 py-3 gap-4 shrink-0">
        {/* HP */}
        <div className="flex items-center gap-2">
          <span className="text-sm font-bold text-white">HP</span>
          <div className="w-32 h-5 bg-slate-800 rounded-full overflow-hidden border border-slate-700">
            <div
              className="h-full bg-emerald-500 rounded-full transition-all duration-300"
              style={{ width: `${hpPercent}%` }}
            />
          </div>
          <span className="text-sm font-semibold text-white">{playerHp}/{playerMaxHp}</span>
        </div>
        {/* Gold */}
        <div className="flex items-center gap-1.5">
          <span className="text-yellow-400 text-lg">&#x1F4B0;</span>
          <span className="text-sm font-bold text-white">{gold}</span>
        </div>
        {/* Floor */}
        <span className="text-sm font-semibold text-slate-300">Floor {currentFloor}/{totalFloors}</span>
      </div>

      {/* Map Container */}
      <div className="flex-1 w-full max-w-2xl flex overflow-y-auto">
        {/* Map Column */}
        <div className="flex-1 relative flex flex-col items-center px-4 py-4" ref={mapRef}>
          {/* SVG layer for connections */}
          <svg className="absolute inset-0 w-full h-full pointer-events-none z-0">
            {connections}
          </svg>

          {/* Rows, rendered from top (boss) to bottom (start) */}
          {[...rows].reverse().map(([rowIdx, rowNodes]) => {
            const isBossRow = rowIdx === maxRow;
            const isStartRow = rowIdx === 0;

            return (
              <div key={rowIdx} className="relative z-10 flex flex-col items-center w-full mb-2">
                {/* Boss label */}
                {isBossRow && (
                  <div className="text-white text-sm font-semibold mb-1">{bossName}</div>
                )}

                {/* Row of nodes */}
                <div className="flex items-center justify-center gap-6 w-full py-3">
                  {rowNodes.map(node => {
                    const isAvailable = availableNodes.includes(node.id);
                    const isCurrent = node.id === currentNodeId;
                    const isCompleted = node.completed;

                    return (
                      <motion.button
                        key={node.id}
                        ref={(el: HTMLButtonElement | null) => { nodeRefs.current[node.id] = el; }}
                        className={`
                          relative w-14 h-14 rounded-xl flex items-center justify-center border-2 transition-all
                          ${isCompleted
                            ? `bg-slate-800/80 ${getBorderColorCompleted(node.type)} opacity-60`
                            : isAvailable
                              ? `bg-slate-800 ${getBorderColor(node.type)} cursor-pointer hover:brightness-125`
                              : `bg-slate-900 border-slate-700 opacity-40 cursor-not-allowed`
                          }
                          ${isCurrent ? 'ring-2 ring-orange-400 ring-offset-2 ring-offset-slate-950' : ''}
                          ${isAvailable && !isCompleted ? 'shadow-lg' : ''}
                        `}
                        style={
                          isAvailable && !isCompleted && !isCurrent
                            ? { boxShadow: `0 0 12px 2px ${node.type === 'Boss' ? 'rgba(239,68,68,0.4)' : 'rgba(251,146,60,0.3)'}` }
                            : node.type === 'Boss' && !isCompleted
                              ? { boxShadow: '0 0 20px 4px rgba(239,68,68,0.5)' }
                              : undefined
                        }
                        onClick={() => isAvailable && onNodeSelect(node)}
                        disabled={!isAvailable}
                        whileHover={isAvailable && !isCompleted ? { scale: 1.1 } : {}}
                        whileTap={isAvailable && !isCompleted ? { scale: 0.93 } : {}}
                      >
                        {getIcon(
                          node.type,
                          `w-7 h-7 ${isCompleted ? 'text-slate-500' : getIconColor(node.type)}`
                        )}
                        {/* Available indicator dot */}
                        {isAvailable && !isCompleted && !isCurrent && (
                          <span className="absolute -top-1 -right-1 w-2.5 h-2.5 bg-orange-400 rounded-full animate-pulse" />
                        )}
                      </motion.button>
                    );
                  })}
                </div>

                {/* Start label */}
                {isStartRow && (
                  <div className="flex flex-col items-center mt-2">
                    <div className="w-2.5 h-2.5 bg-slate-400 rounded-full" />
                    <span className="text-slate-400 text-xs mt-1">Start</span>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Legend */}
        <div className="shrink-0 flex flex-col gap-3 py-8 pr-6 pl-2">
          {([
            ['Combat', CombatIcon, 'text-slate-200'],
            ['Event', EventIcon, 'text-amber-400'],
            ['Shop', ShopIcon, 'text-emerald-400'],
            ['Treasure', TreasureIcon, 'text-amber-400'],
            ['Boss', BossIcon, 'text-red-400'],
          ] as const).map(([label, Icon, color]) => (
            <div key={label} className="flex items-center gap-2">
              <Icon className={`w-5 h-5 ${color}`} />
              <span className="text-xs text-slate-400">{label}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
