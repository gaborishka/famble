import React from 'react';
import { MapNode } from '../../../shared/types/game';
import { motion } from 'motion/react';

interface NodeMapProps {
  nodes: MapNode[];
  currentNodeId: string | null;
  onNodeSelect: (node: MapNode) => void;
}

export const NodeMap: React.FC<NodeMapProps> = ({ nodes, currentNodeId, onNodeSelect }) => {
  const getNodeColor = (type: MapNode['type'], isAvailable: boolean, isCompleted: boolean) => {
    if (isCompleted) return '#475569'; // slate-600
    if (!isAvailable) return '#334155'; // slate-700
    switch (type) {
      case 'Combat': return '#ef4444'; // red-500
      case 'Event': return '#a855f7'; // purple-500
      case 'Shop': return '#eab308'; // yellow-500
      case 'Treasure': return '#3b82f6'; // blue-500
      case 'Boss': return '#dc2626'; // red-600
      default: return '#94a3b8'; // slate-400
    }
  };

  const getIcon = (type: MapNode['type']) => {
    switch (type) {
      case 'Combat': return '⚔️';
      case 'Event': return '❓';
      case 'Shop': return '💰';
      case 'Treasure': return '💎';
      case 'Boss': return '👑';
      default: return '📍';
    }
  };

  const currentNode = nodes.find(n => n.id === currentNodeId);
  const availableNodes = currentNode ? currentNode.nextNodes : nodes.filter(n => n.y === 0).map(n => n.id);

  return (
    <div className="w-full h-full bg-slate-950 flex flex-col items-center justify-center p-8 relative overflow-hidden">
      <h2 className="text-3xl font-bold text-white mb-8 absolute top-8">Select Your Path</h2>
      <div className="relative w-full max-w-3xl h-[600px] border border-slate-800 rounded-xl bg-slate-900/50">
        <svg className="absolute inset-0 w-full h-full pointer-events-none">
          {nodes.map(node => 
            node.nextNodes.map(nextId => {
              const target = nodes.find(n => n.id === nextId);
              if (!target) return null;
              const isAvailable = availableNodes.includes(target.id) && (currentNodeId === node.id || node.completed);
              const isCompleted = target.completed;
              return (
                <line
                  key={`${node.id}-${nextId}`}
                  x1={`${node.x}%`}
                  y1={`${100 - node.y}%`}
                  x2={`${target.x}%`}
                  y2={`${100 - target.y}%`}
                  stroke={isCompleted ? '#475569' : isAvailable ? '#94a3b8' : '#334155'}
                  strokeWidth="4"
                  strokeDasharray={isAvailable && !isCompleted ? "8 8" : "none"}
                />
              );
            })
          )}
        </svg>
        {nodes.map(node => {
          const isAvailable = availableNodes.includes(node.id);
          const isCompleted = node.completed;
          const isCurrent = node.id === currentNodeId;
          
          return (
            <motion.button
              key={node.id}
              className={`absolute w-12 h-12 -ml-6 -mt-6 rounded-full flex items-center justify-center text-xl shadow-lg border-4 transition-all ${
                isAvailable ? 'cursor-pointer hover:scale-110 z-10' : 'cursor-not-allowed opacity-50 z-0'
              } ${isCurrent ? 'ring-4 ring-white ring-opacity-50' : ''}`}
              style={{
                left: `${node.x}%`,
                top: `${100 - node.y}%`,
                backgroundColor: getNodeColor(node.type, isAvailable, isCompleted),
                borderColor: isAvailable ? '#fff' : '#1e293b'
              }}
              onClick={() => isAvailable && onNodeSelect(node)}
              disabled={!isAvailable}
              whileHover={isAvailable ? { scale: 1.2 } : {}}
              whileTap={isAvailable ? { scale: 0.9 } : {}}
            >
              {getIcon(node.type)}
            </motion.button>
          );
        })}
      </div>
    </div>
  );
};
