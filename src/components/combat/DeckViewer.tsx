import React, { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import { Card } from '../../../shared/types/game';
import { motion, AnimatePresence } from 'motion/react';
import { CardComponent } from './CardComponent';

const TAG_COLORS = [
  'bg-red-400', 'bg-blue-400', 'bg-green-400', 'bg-yellow-400',
  'bg-purple-400', 'bg-pink-400', 'bg-cyan-400', 'bg-orange-400',
  'bg-emerald-400', 'bg-rose-400', 'bg-indigo-400', 'bg-amber-400',
];

const TAG_TEXT_COLORS = [
  'text-red-400', 'text-blue-400', 'text-green-400', 'text-yellow-400',
  'text-purple-400', 'text-pink-400', 'text-cyan-400', 'text-orange-400',
  'text-emerald-400', 'text-rose-400', 'text-indigo-400', 'text-amber-400',
];

type FilterType = 'All' | 'Attack' | 'Skill' | 'Power';
type SortType = 'cost' | 'name' | 'type';

interface DeckViewerProps {
  cards: Card[];
  title: string;
  onClose: () => void;
}

export const DeckViewer: React.FC<DeckViewerProps> = ({ cards, title, onClose }) => {
  const [filterType, setFilterType] = useState<FilterType>('All');
  const [sortBy, setSortBy] = useState<SortType>('cost');
  const [hoveredCardIndex, setHoveredCardIndex] = useState<number | null>(null);
  const [tooltipPos, setTooltipPos] = useState<{ x: number; y: number } | null>(null);
  const cardRefs = useRef<Map<number, HTMLDivElement>>(new Map());

  // Escape key to close
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [onClose]);

  // Type counts
  const typeCounts = useMemo(() => {
    const counts = { All: cards.length, Attack: 0, Skill: 0, Power: 0 };
    for (const card of cards) {
      if (card.type in counts) counts[card.type as keyof typeof counts]++;
    }
    return counts;
  }, [cards]);

  // Filtered & sorted cards
  const displayCards = useMemo(() => {
    let filtered = filterType === 'All' ? cards : cards.filter(c => c.type === filterType);
    return [...filtered].sort((a, b) => {
      if (sortBy === 'cost') return a.cost - b.cost || a.name.localeCompare(b.name);
      if (sortBy === 'name') return a.name.localeCompare(b.name);
      // type
      const typeOrder = { Attack: 0, Skill: 1, Power: 2 };
      const typeA = typeOrder[a.type as keyof typeof typeOrder] ?? 3;
      const typeB = typeOrder[b.type as keyof typeof typeOrder] ?? 3;
      return typeA - typeB || a.cost - b.cost;
    });
  }, [cards, filterType, sortBy]);

  // Average energy cost
  const avgCost = useMemo(() => {
    if (cards.length === 0) return 0;
    return cards.reduce((sum, c) => sum + c.cost, 0) / cards.length;
  }, [cards]);

  // Tag distribution
  const tagDistribution = useMemo(() => {
    const map = new Map<string, number>();
    for (const card of cards) {
      for (const tag of card.tags) {
        map.set(tag, (map.get(tag) || 0) + 1);
      }
    }
    // Sort by count descending
    return Array.from(map.entries()).sort((a, b) => b[1] - a[1]);
  }, [cards]);

  // Unique tag list for stable color assignment
  const tagColorMap = useMemo(() => {
    const colorMap = new Map<string, number>();
    tagDistribution.forEach(([tag], i) => colorMap.set(tag, i));
    return colorMap;
  }, [tagDistribution]);

  const handleCardHover = useCallback((index: number) => {
    setHoveredCardIndex(index);
    const el = cardRefs.current.get(index);
    if (el) {
      const rect = el.getBoundingClientRect();
      const viewportW = window.innerWidth;
      // Position tooltip to the right if space, else left
      const x = rect.right + 220 < viewportW
        ? rect.right + 16
        : rect.left - 210;
      const y = Math.max(20, Math.min(rect.top + rect.height / 2 - 144, window.innerHeight - 310));
      setTooltipPos({ x, y });
    }
  }, []);

  const filterTabs: { type: FilterType; label: string; activeBg: string; inactiveBg: string; activeBorder: string; inactiveBorder: string }[] = [
    { type: 'All', label: 'All', activeBg: 'bg-slate-600', inactiveBg: 'bg-transparent hover:bg-slate-800', activeBorder: 'border-slate-400', inactiveBorder: 'border-slate-600' },
    { type: 'Attack', label: 'Attack', activeBg: 'bg-red-900/70', inactiveBg: 'bg-transparent hover:bg-red-900/30', activeBorder: 'border-red-500', inactiveBorder: 'border-red-800/60' },
    { type: 'Skill', label: 'Skill', activeBg: 'bg-yellow-900/70', inactiveBg: 'bg-transparent hover:bg-yellow-900/30', activeBorder: 'border-yellow-500', inactiveBorder: 'border-yellow-800/60' },
    { type: 'Power', label: 'Power', activeBg: 'bg-blue-900/70', inactiveBg: 'bg-transparent hover:bg-blue-900/30', activeBorder: 'border-blue-500', inactiveBorder: 'border-blue-800/60' },
  ];

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-[100] bg-black/80 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <motion.div
        initial={{ scale: 0.9, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.9, opacity: 0 }}
        transition={{ type: 'spring', stiffness: 300, damping: 25 }}
        className="bg-slate-900/95 backdrop-blur-sm border border-slate-700 rounded-2xl max-w-[80rem] w-full max-h-[90vh] flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-8 pt-6 pb-4">
          <div className="flex items-center gap-4">
            <h2 className="text-3xl font-black text-white tracking-tight">{title}</h2>
            <span className="px-3 py-1 rounded-full bg-slate-700 text-slate-300 text-sm font-semibold">
              {cards.length} card{cards.length !== 1 ? 's' : ''}
            </span>
          </div>
          <button
            onClick={onClose}
            className="w-10 h-10 rounded-full bg-slate-800 hover:bg-slate-700 border border-slate-600 flex items-center justify-center text-slate-400 hover:text-white transition-colors"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Filter tabs + Sort */}
        <div className="flex items-center justify-between px-8 pb-4">
          <div className="flex gap-2">
            {filterTabs.map(tab => (
              <button
                key={tab.type}
                onClick={() => setFilterType(tab.type)}
                className={`px-4 py-1.5 rounded-full text-sm font-bold transition-colors border ${
                  filterType === tab.type
                    ? `${tab.activeBg} ${tab.activeBorder} text-white shadow-lg`
                    : `${tab.inactiveBg} ${tab.inactiveBorder} text-slate-300`
                }`}
              >
                {tab.label} ({typeCounts[tab.type]})
              </button>
            ))}
          </div>
          <div className="flex items-center gap-3">
            <span className="text-slate-400 text-sm font-medium">Sort by:</span>
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as SortType)}
              className="bg-slate-800 border border-slate-600 text-white text-sm rounded-lg px-3 py-1.5 outline-none focus:border-slate-400 cursor-pointer"
            >
              <option value="cost">Energy Cost</option>
              <option value="name">Name</option>
              <option value="type">Type</option>
            </select>
          </div>
        </div>

        {/* Card Grid */}
        <div className="flex-1 overflow-y-auto overflow-x-hidden px-10 pb-2">
          {displayCards.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 text-slate-500">
              <span className="text-5xl mb-4">🃏</span>
              <p className="text-lg font-semibold">No cards in this pile</p>
            </div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-x-4 gap-y-4 justify-items-center pt-4 pb-2">
              {displayCards.map((card, idx) => (
                <motion.div
                  key={`${card.id}-${idx}`}
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: Math.min(idx * 0.02, 0.5) }}
                  ref={(el) => {
                    if (el) cardRefs.current.set(idx, el);
                    else cardRefs.current.delete(idx);
                  }}
                  className="cursor-default hover:z-10 overflow-visible"
                  style={{ width: '134px', height: '200px' }}
                  onMouseEnter={() => handleCardHover(idx)}
                  onMouseLeave={() => setHoveredCardIndex(null)}
                >
                  <div className="origin-top-left" style={{ transform: 'scale(0.7)' }}>
                    <CardComponent card={card} />
                  </div>
                </motion.div>
              ))}
            </div>
          )}
        </div>

        {/* Bottom Stats Bar */}
        <div className="border-t border-slate-700/60 px-8 py-3 flex items-center gap-6 flex-wrap text-sm">
          <span className="text-slate-400 font-medium">
            Average Energy Cost: <span className="text-white font-bold">{avgCost.toFixed(1)}</span>
          </span>
          <div className="w-px h-4 bg-slate-700" />
          {tagDistribution.map(([tag, count]) => {
            const colorIdx = tagColorMap.get(tag) ?? 0;
            return (
              <span key={tag} className="flex items-center gap-1.5">
                <span className={`w-2.5 h-2.5 rounded-full ${TAG_COLORS[colorIdx % TAG_COLORS.length]}`} />
                <span className={`font-semibold ${TAG_TEXT_COLORS[colorIdx % TAG_TEXT_COLORS.length]}`}>{tag}</span>
                <span className="text-slate-500">&times;{count}</span>
              </span>
            );
          })}
        </div>
      </motion.div>

      {/* Hover Tooltip — enlarged card */}
      <AnimatePresence>
        {hoveredCardIndex !== null && tooltipPos && displayCards[hoveredCardIndex] && (
          <motion.div
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.9 }}
            transition={{ duration: 0.15 }}
            className="fixed z-[110] pointer-events-none"
            style={{ left: tooltipPos.x, top: tooltipPos.y }}
          >
            <CardComponent card={displayCards[hoveredCardIndex]} />
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
};
