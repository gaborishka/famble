import React from 'react';
import { Card } from '../../../shared/types/game';
import { motion } from 'motion/react';
import { CardComponent } from '../combat/CardComponent';

interface CardRewardProps {
  cards: Card[];
  onSelect: (card: Card) => void;
  onSkip: () => void;
}

export const CardReward: React.FC<CardRewardProps> = ({ cards, onSelect, onSkip }) => {
  return (
    <div className="w-full h-full bg-[#0a0f1c] flex flex-col items-center justify-center p-8 relative overflow-hidden">
      <h2 className="text-4xl font-bold text-white mb-16 drop-shadow-md">Choose a Card</h2>

      <div className="flex gap-8 mb-16 z-10">
        {cards.map((card, index) => (
          <motion.div
            key={card.id + index}
            initial={{ opacity: 0, y: 50, scale: 0.9 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            transition={{ delay: index * 0.15, type: 'spring', stiffness: 200, damping: 20 }}
            whileHover={{ scale: 1.05, y: -10 }}
            className="cursor-pointer"
            onClick={() => onSelect(card)}
          >
            {/* Wrapper to handle click and hover scaling, delegating visual rendering to CardComponent */}
            <div className="pointer-events-none">
              <CardComponent card={card} />
            </div>
          </motion.div>
        ))}
      </div>

      <motion.button
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.6 }}
        onClick={onSkip}
        className="px-8 py-3 bg-[#1e293b] hover:bg-[#334155] text-white font-bold rounded-lg border border-[#3b82f6]/30 transition-all shadow-[0_4px_10px_rgba(0,0,0,0.5)] z-10"
      >
        Skip Reward
      </motion.button>
    </div>
  );
};
