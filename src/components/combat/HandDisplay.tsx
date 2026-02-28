import React from 'react';
import { Card } from '../../../shared/types/game';
import { CardComponent } from './CardComponent';
import { motion } from 'motion/react';

interface HandDisplayProps {
  hand: Card[];
  energy: number;
  onPlayCard: (card: Card) => void;
}

export const HandDisplay: React.FC<HandDisplayProps> = ({ hand, energy, onPlayCard }) => {
  return (
    <div className="flex justify-center items-end h-72 relative w-full max-w-5xl mx-auto">
      {hand.map((card, index) => {
        const total = hand.length;
        const middle = (total - 1) / 2;
        const offset = index - middle;
        const rotation = offset * 4;
        const yOffset = Math.abs(offset) * 15;

        return (
          <motion.div
            key={card.id + index}
            initial={{ y: 200, opacity: 0 }}
            animate={{ y: yOffset, opacity: 1, rotate: rotation }}
            transition={{ type: 'spring', stiffness: 260, damping: 20, delay: index * 0.1 }}
            className="absolute origin-bottom"
            style={{
              left: `calc(50% + ${offset * 110}px - 96px)`,
              zIndex: index,
            }}
          >
            <CardComponent
              card={card}
              onPlay={onPlayCard}
              disabled={card.cost > energy}
            />
          </motion.div>
        );
      })}
    </div>
  );
};
