import React from 'react';
import { Card } from '../../../shared/types/game';
import { motion } from 'motion/react';
import { GameImage } from '../GameImage';

interface CardProps {
  card: Card;
  onPlay: (card: Card) => void;
  disabled?: boolean;
}

export const CardComponent: React.FC<CardProps> = ({ card, onPlay, disabled }) => {
  return (
    <motion.div
      whileHover={{ scale: 1.1, y: -20, zIndex: 50 }}
      whileTap={{ scale: 0.95 }}
      onClick={() => !disabled && onPlay(card)}
      className={`relative w-48 h-72 rounded-xl shadow-2xl border flex flex-col p-2 cursor-pointer select-none transition-colors ${
        disabled ? 'opacity-50 grayscale cursor-not-allowed border-slate-600 bg-slate-800' : 'border-blue-500 bg-[#1e2235] hover:border-blue-400'
      }`}
    >
      {/* Cost Badge */}
      <div className="absolute -top-3 -left-3 w-8 h-8 rounded-full bg-blue-600 border-2 border-blue-300 flex items-center justify-center text-white font-bold shadow-md z-20">
        {card.cost}
      </div>

      {/* Card Header */}
      <div className="text-center pb-1 mb-1 relative z-10">
        <h3 className="text-white font-bold text-sm leading-tight line-clamp-2">{card.name}</h3>
        <span className="text-[10px] text-blue-300 uppercase tracking-wider font-semibold">{card.type}</span>
      </div>

      {/* Card Image */}
      <div className="h-28 w-full bg-slate-900 rounded-lg mb-2 flex items-center justify-center overflow-hidden relative border border-slate-700">
        {card.imagePrompt ? (
          <GameImage prompt={card.imagePrompt} className="w-full h-full absolute inset-0 opacity-90" alt={card.name} />
        ) : (
          <div className="text-slate-600 text-[10px] text-center px-2 z-10">
            {card.tags.join(' • ')}
          </div>
        )}
      </div>

      {/* Card Description */}
      <div className="text-[11px] text-slate-300 text-center leading-snug flex-1 flex items-center justify-center px-1">
        {card.description}
      </div>

      {/* Card Stats */}
      <div className="flex justify-between mt-auto pt-1 text-xs font-bold px-1">
        {card.damage ? <span className="text-red-400 flex items-center gap-1">⚔️ {card.damage}</span> : <span />}
        {card.block ? <span className="text-blue-400 flex items-center gap-1">🛡️ {card.block}</span> : <span />}
      </div>
    </motion.div>
  );
};
