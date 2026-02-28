import React, { useState, useMemo } from 'react';
import { Card } from '../../../shared/types/game';
import { motion, AnimatePresence } from 'motion/react';
import { CardComponent } from '../combat/CardComponent';

// ── Gold Coin ──

const GoldCoin: React.FC<{ size?: number }> = ({ size = 18 }) => (
  <svg viewBox="0 0 20 20" width={size} height={size} className="inline-block shrink-0">
    <circle cx="10" cy="10" r="9" fill="#facc15" stroke="#a16207" strokeWidth="1.5" />
    <text x="10" y="14.5" textAnchor="middle" fontSize="11" fontWeight="bold" fill="#a16207" fontFamily="sans-serif">C</text>
  </svg>
);

// ── Helpers ──

const getUpgradedCard = (card: Card): Card => {
  return {
    ...card,
    upgraded: true,
    name: card.name,
    damage: typeof card.damage === 'number' ? card.damage + 3 : card.damage,
    block: typeof card.block === 'number' ? card.block + 3 : card.block,
    cost: card.type === 'Power' ? Math.max(0, card.cost - 1) : card.cost,
  };
};

const getUpgradeDescription = (card: Card): string => {
  const upgraded = getUpgradedCard(card);
  const parts: string[] = [];
  if (typeof card.damage === 'number' && typeof upgraded.damage === 'number') {
    parts.push(`Damage: ${card.damage} → ${upgraded.damage}`);
  }
  if (typeof card.block === 'number' && typeof upgraded.block === 'number') {
    parts.push(`Block: ${card.block} → ${upgraded.block}`);
  }
  if (card.cost !== upgraded.cost) {
    parts.push(`Cost: ${card.cost} → ${upgraded.cost}`);
  } else {
    parts.push(`Cost: ${card.cost} → ${card.cost}`);
  }
  if (card.tags.length > 0) {
    parts.push(`Tag: ${card.tags[0]} (unchanged)`);
  }
  return parts.join('  •  ');
};

// ── Component ──

interface CardUpgradeScreenProps {
  deck: Card[];
  cost?: number; // 0 = free (campfire), > 0 = costs gold
  playerGold?: number;
  onUpgrade: (cardIndex: number) => void;
  onBack: () => void;
}

export const CardUpgradeScreen: React.FC<CardUpgradeScreenProps> = ({
  deck,
  cost = 0,
  playerGold = 0,
  onUpgrade,
  onBack,
}) => {
  const upgradableCards = useMemo(() => {
    return deck
      .map((card, index) => ({ card, index }))
      .filter(({ card }) => !card.upgraded);
  }, [deck]);

  const [selectedIndex, setSelectedIndex] = useState<number | null>(
    upgradableCards.length > 0 ? upgradableCards[0].index : null
  );

  const selectedCard = selectedIndex !== null ? deck[selectedIndex] : null;
  const upgradedPreview = selectedCard ? getUpgradedCard(selectedCard) : null;
  const canAfford = cost === 0 || playerGold >= cost;

  const handleUpgrade = () => {
    if (selectedIndex === null || !canAfford) return;
    onUpgrade(selectedIndex);
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 bg-black/85 flex items-center justify-center p-4"
    >
      <motion.div
        initial={{ scale: 0.9, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.9, opacity: 0 }}
        className="bg-[#0f172a] border border-slate-700 rounded-2xl w-full max-w-4xl max-h-[90vh] overflow-y-auto relative"
      >
        {/* Close Button */}
        <button
          onClick={onBack}
          className="absolute top-4 right-4 z-10 w-8 h-8 rounded-full bg-slate-800 hover:bg-slate-700 flex items-center justify-center text-slate-400 hover:text-white transition-colors"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} className="w-4 h-4">
            <path d="M18 6L6 18M6 6l12 12" strokeLinecap="round" />
          </svg>
        </button>

        <div className="p-6 sm:p-8">
          {/* Header */}
          <div className="text-center mb-6">
            <h2 className="text-3xl sm:text-4xl font-black text-white uppercase tracking-wider mb-1">Upgrade a Card</h2>
            <p className="text-slate-400">Choose a card from your deck to upgrade</p>
          </div>

          {/* Cost Badge */}
          {cost > 0 && (
            <div className="flex justify-center mb-2">
              <div className="flex items-center gap-2 bg-amber-900/40 border border-amber-600/40 rounded-full px-4 py-1.5">
                <GoldCoin size={20} />
                <span className="font-bold text-white">Cost: <span className="text-amber-300">{cost} gold</span></span>
              </div>
            </div>
          )}
          {cost > 0 && (
            <p className="text-center text-slate-400 text-sm mb-4">You have: {playerGold} gold</p>
          )}

          {upgradableCards.length === 0 ? (
            <div className="text-center py-12">
              <p className="text-xl text-slate-300 mb-6">All cards are already upgraded.</p>
              <button
                onClick={onBack}
                className="px-6 py-3 bg-slate-700 hover:bg-slate-600 rounded-lg font-bold text-white transition-colors"
              >
                Go Back
              </button>
            </div>
          ) : (
            <>
              {/* Deck Strip */}
              <div className="mb-8">
                <div className="flex gap-2 overflow-x-auto pb-3 px-1 scrollbar-thin scrollbar-thumb-slate-600 scrollbar-track-transparent">
                  {deck.map((card, idx) => {
                    const isUpgraded = card.upgraded;
                    const isSelected = selectedIndex === idx;
                    const typeColor = card.type === 'Attack' ? 'border-red-500' : card.type === 'Skill' ? 'border-yellow-500' : 'border-blue-500';
                    return (
                      <button
                        key={`${card.id}-${idx}`}
                        onClick={() => !isUpgraded && setSelectedIndex(idx)}
                        disabled={isUpgraded}
                        className={`shrink-0 w-20 h-28 rounded-lg border-2 flex flex-col items-center justify-center p-1 text-center transition-all ${
                          isUpgraded
                            ? 'border-slate-700 bg-slate-900/50 opacity-40 cursor-not-allowed'
                            : isSelected
                              ? `${typeColor} bg-slate-700/60 shadow-lg shadow-blue-500/20 ring-2 ring-blue-400`
                              : 'border-slate-600 bg-slate-800/60 hover:bg-slate-700/60 hover:border-slate-500 cursor-pointer'
                        }`}
                      >
                        <span className="text-[9px] font-bold text-slate-400 uppercase">{card.type}</span>
                        <span className="text-[10px] font-bold text-white mt-0.5 line-clamp-2 leading-tight">{card.name}{card.upgraded ? '+' : ''}</span>
                        <div className="text-[9px] text-slate-400 mt-0.5">
                          {typeof card.damage === 'number' && <span>DMG {card.damage}</span>}
                          {typeof card.block === 'number' && <span>{typeof card.damage === 'number' ? ' / ' : ''}BLK {card.block}</span>}
                        </div>
                        <div className="text-[9px] font-bold mt-auto">
                          <span className="bg-slate-700 text-slate-300 rounded px-1 py-0.5">{card.cost}</span>
                        </div>
                      </button>
                    );
                  })}
                </div>
                {/* Scroll indicator line */}
                <div className="w-full h-0.5 bg-slate-800 rounded-full mt-1">
                  <div className="w-1/3 h-full bg-amber-500/60 rounded-full" />
                </div>
              </div>

              {/* Card Comparison */}
              {selectedCard && upgradedPreview && (
                <motion.div
                  key={selectedIndex}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="flex flex-col items-center"
                >
                  {/* Side by side cards */}
                  <div className="flex items-center gap-4 sm:gap-8 mb-6">
                    {/* Current Card */}
                    <div className="flex flex-col items-center gap-2">
                      <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">Current</span>
                      <div className="scale-90 sm:scale-100">
                        <CardComponent card={selectedCard} />
                      </div>
                    </div>

                    {/* Arrow */}
                    <div className="flex flex-col items-center gap-1">
                      <svg viewBox="0 0 60 40" className="w-16 sm:w-24 h-10 sm:h-14">
                        <defs>
                          <linearGradient id="arrowGrad" x1="0%" y1="0%" x2="100%" y2="0%">
                            <stop offset="0%" stopColor="#f97316" />
                            <stop offset="100%" stopColor="#f59e0b" />
                          </linearGradient>
                        </defs>
                        <polygon points="0,12 40,12 40,4 60,20 40,36 40,28 0,28" fill="url(#arrowGrad)" />
                      </svg>
                      {/* Sparkles */}
                      <div className="flex gap-1">
                        <span className="text-amber-400 text-xs animate-pulse">✦</span>
                        <span className="text-amber-300 text-[10px] animate-pulse" style={{ animationDelay: '0.3s' }}>✦</span>
                        <span className="text-amber-400 text-xs animate-pulse" style={{ animationDelay: '0.6s' }}>✦</span>
                      </div>
                    </div>

                    {/* Upgraded Card */}
                    <div className="flex flex-col items-center gap-2">
                      <span className="text-xs font-bold text-amber-400 uppercase tracking-wider">Upgraded</span>
                      <div className="scale-90 sm:scale-100">
                        <CardComponent card={upgradedPreview} />
                      </div>
                    </div>
                  </div>

                  {/* Upgrade Button */}
                  <motion.button
                    whileHover={canAfford ? { scale: 1.02 } : undefined}
                    whileTap={canAfford ? { scale: 0.98 } : undefined}
                    onClick={handleUpgrade}
                    disabled={!canAfford}
                    className={`flex items-center gap-2 px-8 py-3.5 rounded-xl font-bold text-lg transition-all shadow-lg mb-2 ${
                      canAfford
                        ? 'bg-gradient-to-r from-orange-500 to-amber-500 hover:from-orange-400 hover:to-amber-400 text-white shadow-orange-500/30'
                        : 'bg-slate-700 text-slate-400 cursor-not-allowed'
                    }`}
                  >
                    <GoldCoin size={22} />
                    {cost > 0 ? `Upgrade for ${cost} gold` : 'Upgrade'}
                  </motion.button>
                  <p className="text-slate-500 text-xs mb-6">This cannot be undone</p>

                  {/* Stats Summary */}
                  <div className="bg-slate-800/60 border border-slate-700/50 rounded-lg px-5 py-3 text-center">
                    <p className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-1">Upgrade Stats Summary</p>
                    <p className="text-sm text-slate-300">{getUpgradeDescription(selectedCard)}</p>
                  </div>
                </motion.div>
              )}
            </>
          )}
        </div>
      </motion.div>
    </motion.div>
  );
};
