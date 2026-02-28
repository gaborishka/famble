import React, { useState } from 'react';
import { Card } from '../../../shared/types/game';
import { CardComponent } from './CardComponent';
import { motion, AnimatePresence } from 'motion/react';

interface HandDisplayProps {
  hand: Card[];
  energy: number;
  onPlayCard: (card: Card) => void;
}

export const HandDisplay: React.FC<HandDisplayProps> = ({ hand, energy, onPlayCard }) => {
  const [hoveredCard, setHoveredCard] = useState<string | null>(null);
  const [draggingCard, setDraggingCard] = useState<string | null>(null);
  const [arrowRotation, setArrowRotation] = useState<number>(0);

  return (
    <div className="flex justify-center items-end h-72 relative w-full max-w-5xl mx-auto pointer-events-none">
      <AnimatePresence>
        {hand.map((card, index) => {
          const total = hand.length;
          const middle = (total - 1) / 2;
          const offset = index - middle;
          const rotation = offset * 6;
          const yOffset = Math.abs(offset) * 10 + Math.pow(offset, 2) * 8; // deeper curve

          const isHovered = hoveredCard === card.id;
          const isDragging = draggingCard === card.id;
          const disabled = card.cost > energy;

          return (
            <motion.div
              layoutId={card.id}
              key={card.id + "-" + index}
              initial={{ y: 200, opacity: 0, scale: 0.8 }}
              animate={{
                y: isDragging || isHovered ? yOffset - 40 : yOffset,
                opacity: 1,
                rotate: isDragging || isHovered ? 0 : rotation,
                scale: isDragging ? 1.05 : (isHovered ? 1.15 : 1)
              }}
              exit={{ y: -300, opacity: 0, scale: 0.5, transition: { duration: 0.2 } }}
              transition={{ type: 'spring', stiffness: 300, damping: 20 }}
              className={`absolute origin-bottom ${disabled ? 'pointer-events-auto' : 'pointer-events-auto cursor-grab active:cursor-grabbing'}`}
              style={{
                left: `calc(50% + ${offset * 105}px - 96px)`, // tighter overlap
                zIndex: isDragging ? 200 : (isHovered ? 100 : index),
              }}
              onHoverStart={() => !isDragging && setHoveredCard(card.id)}
              onHoverEnd={() => setHoveredCard(null)}
              drag={!disabled}
              dragSnapToOrigin
              dragElastic={0.1}
              dragConstraints={{ top: -1000, bottom: 0, left: -1000, right: 1000 }}
              onDragStart={() => {
                setDraggingCard(card.id);
                setHoveredCard(null);
                setArrowRotation(0);
              }}
              onDrag={(e, info) => {
                // Calculate angle from origin to current drag position
                // info.offset is the displacement from original position
                if (Math.abs(info.offset.x) > 5 || Math.abs(info.offset.y) > 5) {
                  const angle = Math.atan2(info.offset.y, info.offset.x) * (180 / Math.PI);
                  setArrowRotation(angle + 90);
                }
              }}
              onDragEnd={(e, info) => {
                setDraggingCard(null);
                setArrowRotation(0);
                if (info.offset.y < -150) {
                  onPlayCard(card);
                }
              }}
              onClick={() => !disabled && !isDragging && onPlayCard(card)}
              whileTap={!disabled && !isDragging ? { scale: 0.95 } : {}}
            >
              <CardComponent
                card={card}
                disabled={disabled}
              />

              {/* Target Arrow when dragging - pointing straight up */}
              {isDragging && (
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1, rotate: arrowRotation }}
                  className="absolute top-0 left-1/2 -translate-x-1/2 -translate-y-full pointer-events-none z-50 flex flex-col items-center justify-end pb-4"
                  style={{ height: '300px', originX: 0.5, originY: 1 }}
                >
                  <div className={`w-0 h-0 border-l-[15px] border-r-[15px] border-b-[30px] border-l-transparent border-r-transparent ${card.type === 'Attack' ? 'border-b-red-500' : card.type === 'Defense' ? 'border-b-blue-500' : 'border-b-yellow-500'} drop-shadow-[0_0_10px_rgba(255,0,0,0.5)]`} />
                  <div className={`w-4 h-full bg-gradient-to-t ${card.type === 'Attack' ? 'from-red-500/0 via-red-500 to-red-500' : card.type === 'Defense' ? 'from-blue-500/0 via-blue-500 to-blue-500' : 'from-yellow-500/0 via-yellow-500 to-yellow-500'} animate-pulse opacity-80`} />
                </motion.div>
              )}
            </motion.div>
          );
        })}
      </AnimatePresence>
    </div>
  );
};
