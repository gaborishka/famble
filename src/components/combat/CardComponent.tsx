import React from 'react';
import { Card } from '../../../shared/types/game';
import { GameImage } from '../GameImage';

interface CardProps {
  card: Card;
  disabled?: boolean;
}

export const CardComponent: React.FC<CardProps> = React.memo(({ card, disabled }) => {
  const typeColors = {
    Attack: { bg: 'bg-[#b91c1c]', border: 'border-[#ef4444]', text: 'text-red-100', bannerBg: 'bg-[#991b1b]', shadow: 'shadow-red-500/20' },
    Defense: { bg: 'bg-[#1d4ed8]', border: 'border-[#3b82f6]', text: 'text-blue-100', bannerBg: 'bg-[#1e40af]', shadow: 'shadow-blue-500/20' },
    Skill: { bg: 'bg-[#ca8a04]', border: 'border-[#facc15]', text: 'text-yellow-100', bannerBg: 'bg-[#a16207]', shadow: 'shadow-yellow-500/20' }
  };
  const colors = typeColors[card.type as keyof typeof typeColors] || { bg: 'bg-slate-700', border: 'border-slate-400', bannerBg: 'bg-slate-800', shadow: 'shadow-slate-500/20' };

  return (
    <div
      className={`relative w-56 h-[21rem] rounded-xl border-[4px] flex flex-col select-none group ${disabled ? 'opacity-50 grayscale border-slate-600 bg-slate-800 shadow-lg' : `${colors.border} bg-[#1e293b] shadow-2xl ${colors.shadow}`
        } ${card.upgraded ? 'ring-4 ring-orange-400 ring-offset-2 ring-offset-slate-900' : ''}`}
      style={{ overflow: 'visible' }}
    >
      {/* Cost Badge */}
      <div className="absolute -top-4 -left-4 w-10 h-10 rounded-full bg-[#1e293b] border-[3px] border-[#cbd5e1] flex items-center justify-center text-white font-black shadow-[0_4px_10px_rgba(0,0,0,0.6)] z-30 text-lg">
        {card.cost}
      </div>

      {/* Card Header (Ribbon-like) */}
      <div className="bg-gradient-to-b from-[#f1f5f9] to-[#cbd5e1] border-b-[3px] border-[#94a3b8] px-3 py-2.5 text-center rounded-t-[7px] z-10 relative flex items-center justify-center gap-1">
        <h3 className="text-[#0f172a] font-black text-sm leading-tight line-clamp-1 drop-shadow-sm uppercase tracking-wide">
          {card.name}{card.upgraded && <span className="text-orange-600 text-lg leading-none">+</span>}
        </h3>
      </div>

      {/* Card Image Area */}
      <div className="h-36 w-full bg-slate-900 relative border-y-[3px] border-[#94a3b8] flex items-center justify-center overflow-hidden shrink-0 shadow-[inset_0_0_20px_rgba(0,0,0,0.8)]">
        {card.imagePrompt ? (
          <GameImage
            src={card.imageUrl}
            prompt={card.imagePrompt}
            fileKey={card.imageObjectId}
            className="w-full h-full absolute inset-0 object-cover"
            alt={card.name}
          />
        ) : (
          <div className="text-slate-500 text-xs text-center px-2 z-10 font-bold uppercase tracking-wider">
            {card.tags.join(' • ')}
          </div>
        )}
      </div>

      {/* Card Type Badge (Overlapping) */}
      <div className="flex justify-center -mt-3.5 z-20 relative">
        <div className={`px-5 py-0.5 rounded border-[2px] ${colors.border} ${colors.bannerBg} shadow-[0_2px_5px_rgba(0,0,0,0.8)] text-[10px] font-black text-white uppercase tracking-wider`}>
          {card.type}
        </div>
      </div>

      {/* Card Description Block */}
      <div className="text-xs text-[#e2e8f0] text-center font-bold leading-relaxed flex-1 flex flex-col items-center justify-center px-3 pt-1.5 pb-7 relative z-10">
        <div className="drop-shadow-md">
          {card.description}
        </div>
      </div>

      {/* Sub-type Banner at Bottom */}
      <div className={`absolute bottom-0 inset-x-0 h-8 ${colors.bg} rounded-b-[7px] border-t-[3px] ${colors.border} flex items-center justify-center shadow-[inset_0_-2px_5px_rgba(0,0,0,0.3)] z-20`}>
        <span className="text-[11px] text-white font-black tracking-widest uppercase drop-shadow-md">
          {card.tags[0] || card.type}
        </span>
      </div>
    </div>
  );
});
