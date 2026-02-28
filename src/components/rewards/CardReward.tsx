import React from 'react';
import { Card } from '../../../shared/types/game';
import { motion } from 'motion/react';
import { GameImage } from '../GameImage';

interface CardRewardProps {
  cards: Card[];
  onSelect: (card: Card) => void;
  onSkip: () => void;
}

export const CardReward: React.FC<CardRewardProps> = ({ cards, onSelect, onSkip }) => {
  return (
    <div className="w-full h-full bg-slate-950 flex flex-col items-center justify-center p-8 relative overflow-hidden">
      <h2 className="text-4xl font-bold text-white mb-12">Choose a Card</h2>
      <div className="flex gap-8 mb-12">
        {cards.map((card, index) => (
          <motion.button
            key={card.id + index}
            initial={{ opacity: 0, y: 50 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: index * 0.1 }}
            className={`w-48 h-64 rounded-xl border-4 shadow-2xl flex flex-col p-4 text-left transition-transform hover:scale-105 relative overflow-hidden ${
              card.type === 'Attack' ? 'bg-red-950 border-red-500' :
              card.type === 'Skill' ? 'bg-blue-950 border-blue-500' :
              'bg-purple-950 border-purple-500'
            }`}
            onClick={() => onSelect(card)}
          >
            <div className="flex justify-between items-start mb-2 z-10">
              <span className="font-bold text-lg text-white drop-shadow-md">{card.name}</span>
              <span className="bg-slate-800 text-white w-6 h-6 rounded-full flex items-center justify-center text-sm font-mono border border-slate-600 shadow-md">
                {card.cost}
              </span>
            </div>
            <div className="text-xs font-bold text-slate-300 mb-2 uppercase tracking-wider z-10 drop-shadow-md">
              {card.type}
            </div>
            
            {/* Card Image */}
            <div className="flex-1 bg-slate-900/50 rounded-lg mb-2 flex items-center justify-center overflow-hidden relative z-10 border border-white/10">
              {card.imagePrompt ? (
                <GameImage prompt={card.imagePrompt} className="w-full h-full absolute inset-0 opacity-80" alt={card.name} />
              ) : null}
            </div>

            <div className="text-sm text-slate-200 flex-1 z-10 drop-shadow-md bg-black/40 p-1 rounded">
              {card.description}
            </div>
            {card.tags && card.tags.length > 0 && (
              <div className="flex flex-wrap gap-1 mt-2 z-10">
                {card.tags.map(tag => (
                  <span key={tag} className="text-[10px] bg-black/70 text-slate-300 px-2 py-1 rounded-full border border-slate-700">
                    {tag}
                  </span>
                ))}
              </div>
            )}
          </motion.button>
        ))}
      </div>
      <motion.button
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.5 }}
        onClick={onSkip}
        className="px-8 py-3 bg-slate-800 hover:bg-slate-700 text-white font-bold rounded-lg border border-slate-600 transition-colors"
      >
        Skip Reward
      </motion.button>
    </div>
  );
};
