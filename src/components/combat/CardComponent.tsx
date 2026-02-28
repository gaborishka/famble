import React, { useState } from 'react';
import { Card } from '../../../shared/types/game';
import { motion } from 'motion/react';
import { GameImage } from '../GameImage';

interface CardProps {
  card: Card;
  onPlay: (card: Card) => void;
  disabled?: boolean;
}

export const CardComponent: React.FC<CardProps> = ({ card, onPlay, disabled }) => {
  const [isHovered, setIsHovered] = useState(false);

  // Colors based on type for border and lower section
  const typeColors = {
    Attack: { bg: 'bg-[#b91c1c]', border: 'border-[#ef4444]', text: 'text-red-100', bannerBg: 'bg-[#991b1b]' },
    Defense: { bg: 'bg-[#1d4ed8]', border: 'border-[#3b82f6]', text: 'text-blue-100', bannerBg: 'bg-[#1e40af]' },
    Skill: { bg: 'bg-[#ca8a04]', border: 'border-[#facc15]', text: 'text-yellow-100', bannerBg: 'bg-[#a16207]' }
  };
  const colors = typeColors[card.type as keyof typeof typeColors] || { bg: 'bg-slate-700', border: 'border-slate-400', bannerBg: 'bg-slate-800' };

  return (
    <motion.div
      onHoverStart={() => setIsHovered(true)}
      onHoverEnd={() => setIsHovered(false)}
      whileHover={{ scale: 1.15, y: -40, zIndex: 100 }}
      whileTap={{ scale: 0.95 }}
      onClick={() => !disabled && onPlay(card)}
      className={`relative w-48 h-72 rounded-xl border-[4px] shadow-2xl flex flex-col select-none transition-colors duration-200 group ${disabled ? 'opacity-50 grayscale cursor-not-allowed border-slate-600 bg-slate-800' : `${colors.border} bg-[#1e293b] hover:shadow-[0_15px_40px_rgba(255,255,255,0.15)] cursor-pointer`
        }`}
      style={{ overflow: 'visible' }}
    >
      {/* HOVERED BADGE */}
      {isHovered && !disabled && (
        <div className="absolute -top-7 left-1/2 -translate-x-1/2 bg-slate-900/90 border border-orange-500 text-orange-400 text-[9px] font-black px-4 py-0.5 rounded shadow-[0_0_15px_rgba(249,115,22,0.6)] z-50 tracking-widest uppercase pointer-events-none whitespace-nowrap">
          Hovered
        </div>
      )}

      {/* Cost Badge */}
      <div className="absolute -top-4 -left-4 w-9 h-9 rounded-full bg-[#1e293b] border-[3px] border-[#cbd5e1] flex items-center justify-center text-white font-black shadow-[0_4px_10px_rgba(0,0,0,0.6)] z-30 text-base">
        {card.cost}
      </div>

      {/* Card Header (Ribbon-like) */}
      <div className="bg-gradient-to-b from-[#f1f5f9] to-[#cbd5e1] border-b-[3px] border-[#94a3b8] px-2 py-2 text-center rounded-t-[7px] z-10 relative">
        <h3 className="text-[#0f172a] font-black text-[13px] leading-tight line-clamp-1 drop-shadow-sm uppercase tracking-wide">{card.name}</h3>
      </div>

      {/* Card Image Area */}
      <div className="h-[7.5rem] w-full bg-slate-900 relative border-y-[3px] border-[#94a3b8] flex items-center justify-center overflow-hidden shrink-0 shadow-[inset_0_0_20px_rgba(0,0,0,0.8)]">
        {card.imagePrompt ? (
          <GameImage prompt={card.imagePrompt} className="w-full h-full absolute inset-0 object-cover" alt={card.name} />
        ) : (
          <div className="text-slate-500 text-[10px] text-center px-2 z-10 font-bold uppercase tracking-wider">
            {card.tags.join(' • ')}
          </div>
        )}
      </div>

      {/* Card Type Badge (Overlapping) */}
      <div className="flex justify-center -mt-3.5 z-20 relative">
        <div className={`px-4 py-0.5 rounded border-[2px] ${colors.border} ${colors.bannerBg} shadow-[0_2px_5px_rgba(0,0,0,0.8)] text-[9px] font-black text-white uppercase tracking-wider`}>
          {card.type}
        </div>
      </div>

      {/* Card Description Block */}
      <div className="text-[11px] text-[#e2e8f0] text-center font-bold leading-relaxed flex-1 flex flex-col items-center justify-center px-3 pt-1 pb-6 relative z-10">
        <div className="drop-shadow-md">
          {card.description}
        </div>
      </div>

      {/* Sub-type Banner at Bottom */}
      <div className={`absolute bottom-0 inset-x-0 h-7 ${colors.bg} rounded-b-[7px] border-t-[3px] ${colors.border} flex items-center justify-center shadow-[inset_0_-2px_5px_rgba(0,0,0,0.3)] z-20`}>
        <span className="text-[10px] text-white font-black tracking-widest uppercase drop-shadow-md">
          {card.tags[0] || card.type}
        </span>
      </div>
    </motion.div>
  );
};
