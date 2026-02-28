import React from 'react';
import { Card } from '../../../shared/types/game';
import { motion } from 'motion/react';
import { CardComponent } from '../combat/CardComponent';
import { BookOpen, Coins, Sparkles } from 'lucide-react';

export interface CardRewardStats {
  damageDealt: number;
  turns: number;
  hpRemaining: number;
  hpMax: number;
  deckCount: number;
  floor: number;
  totalFloors: number;
  gold: number;
}

interface CardRewardProps {
  cards: Card[];
  onSelect: (card: Card) => void;
  onSkip: () => void;
  stats: CardRewardStats;
}

export const CardReward: React.FC<CardRewardProps> = ({ cards, onSelect, onSkip, stats }) => {
  return (
    <div className="relative w-full min-h-screen overflow-hidden bg-[#060f28] text-white">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_12%,rgba(98,130,192,0.42),rgba(8,18,45,0)_45%)]" />
      <div className="absolute inset-0 bg-[linear-gradient(90deg,rgba(5,13,35,0.2)_0%,rgba(14,34,80,0.45)_50%,rgba(5,13,35,0.2)_100%)]" />
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_58%,rgba(77,122,201,0.34),rgba(7,16,43,0)_56%)]" />
      <div className="pointer-events-none absolute inset-0 opacity-30 [background-image:radial-gradient(rgba(255,197,104,0.3)_1px,transparent_1px)] [background-size:180px_180px]" />

      <div className="relative z-10 flex min-h-screen flex-col">
        <header className="pt-8 sm:pt-10">
          <h1 className="text-center font-serif text-5xl font-bold tracking-wide text-[#f2b64d] drop-shadow-[0_2px_14px_rgba(250,181,62,0.6)] sm:text-6xl md:text-7xl">
            VICTORY
          </h1>
          <h2 className="mt-2 text-center font-serif text-4xl font-semibold text-slate-100 drop-shadow-[0_2px_10px_rgba(0,0,0,0.5)] sm:text-5xl md:text-6xl">
            Choose a Card Reward
          </h2>
          <div className="mt-5 h-px w-full bg-gradient-to-r from-transparent via-[#8397bf]/70 to-transparent" />
          <p className="mt-4 text-center text-xl text-[#9fb0ca] sm:text-2xl md:text-3xl">
            Damage Dealt: <span className="font-semibold text-[#dce8ff] tabular-nums">{stats.damageDealt}</span>
            <span className="mx-3 text-[#6f82a8]">|</span>
            Turns: <span className="font-semibold text-[#dce8ff] tabular-nums">{stats.turns}</span>
            <span className="mx-3 text-[#6f82a8]">|</span>
            HP Remaining: <span className="font-semibold text-[#dce8ff] tabular-nums">{stats.hpRemaining}/{stats.hpMax}</span>
          </p>
        </header>

        <section className="flex flex-1 items-center justify-center px-4 pb-6 pt-8 sm:px-8 sm:pb-8 sm:pt-10">
          <div className="flex w-full max-w-[1200px] flex-wrap items-start justify-center gap-8 sm:gap-10 lg:gap-16">
            {cards.map((card, index) => (
              <motion.div
                key={`${card.id}-${index}`}
                initial={{ opacity: 0, y: 42, scale: 0.93 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                transition={{ delay: index * 0.12, duration: 0.35, ease: 'easeOut' }}
                whileHover={{ y: -10, scale: 1.04 }}
                className="relative cursor-pointer select-none"
                onClick={() => onSelect(card)}
              >
                <div className="absolute inset-x-6 -bottom-3 h-10 rounded-full bg-[#4f7cc8]/40 blur-xl" />
                <div className="pointer-events-none origin-top scale-[1.03] sm:scale-110">
                  <CardComponent card={card} />
                </div>
              </motion.div>
            ))}
          </div>
        </section>

        <motion.button
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.4, duration: 0.25 }}
          onClick={onSkip}
          className="mx-auto mb-5 text-3xl text-slate-400 transition-colors hover:text-slate-200 sm:mb-7 sm:text-4xl md:text-5xl"
        >
          Skip Reward
        </motion.button>

        <footer className="relative border-t border-[#7489ad]/45 bg-[#071331]/75 backdrop-blur-[2px]">
          <div className="mx-auto flex h-[4.5rem] w-full max-w-[1400px] items-center justify-between px-4 sm:h-20 sm:px-8">
            <div className="flex items-center gap-2 text-slate-200 sm:gap-3">
              <BookOpen className="h-5 w-5 text-slate-300/90 sm:h-6 sm:w-6" />
              <span className="text-xl leading-none sm:text-2xl md:text-3xl">
                <span className="tabular-nums">{stats.deckCount}</span> Deck
              </span>
            </div>

            <span className="text-xl leading-none text-slate-300 sm:text-2xl md:text-3xl">
              Floor <span className="tabular-nums">{stats.floor}/{stats.totalFloors}</span>
            </span>

            <div className="flex items-center gap-2 text-[#f2c149] sm:gap-3">
              <Coins className="h-5 w-5 sm:h-6 sm:w-6" />
              <span className="text-xl font-semibold leading-none tabular-nums sm:text-2xl md:text-3xl">{stats.gold}</span>
            </div>
          </div>
          <Sparkles className="pointer-events-none absolute bottom-2 right-3 h-7 w-7 text-slate-300/70 sm:bottom-3 sm:right-4 sm:h-9 sm:w-9" />
        </footer>
      </div>
    </div>
  );
};
