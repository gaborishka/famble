import React, { useMemo, useState } from 'react';
import { Card, Relic, ShopRoomContent } from '../../../shared/types/game';
import { motion, AnimatePresence } from 'motion/react';
import { PlayerHUD } from './PlayerHUD';
import { CardComponent } from '../combat/CardComponent';

// ── Shop Relic Definitions ──

const SHOP_RELICS: (Relic & { price: number })[] = [
  { id: 'relic-atk', name: 'Iron Gauntlet', description: 'Attacks deal +2 damage', effect: 'StartStrength', value: 2, price: 120 },
  { id: 'relic-block', name: 'Crystal Shield', description: 'Start each combat with 5 Block', effect: 'CombatHeal', value: 5, price: 100 },
  { id: 'relic-energy', name: 'Energy Gem', description: 'Start each combat with +1 Energy', effect: 'StartEnergy', value: 1, price: 150 },
  { id: 'relic-draw', name: 'Lucky Coin', description: 'Draw 1 extra card each turn', effect: 'StartDraw', value: 1, price: 130 },
  { id: 'relic-hp', name: 'Heart Pendant', description: 'Gain 10 Max HP', effect: 'MaxHP', value: 10, price: 100 },
];

// ── Relic Icon SVGs ──

const relicIcons: Record<string, React.ReactNode> = {
  'relic-atk': (
    <svg viewBox="0 0 24 24" fill="currentColor" className="w-6 h-6 text-red-400">
      <path d="M6.92 5H5l7 7-1.5 1.5L5 8.08V10H3V3h7v2H7.92l5.58 5.58L15 9.08 20.92 15 15 20.92l-1.5-1.5L19.08 14l-5.58-5.58L12 9.92 6.92 5z"/>
    </svg>
  ),
  'relic-block': (
    <svg viewBox="0 0 24 24" fill="currentColor" className="w-6 h-6 text-blue-400">
      <path d="M12 1L3 5v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V5l-9-4zm0 10.99h7c-.53 4.12-3.28 7.79-7 8.94V12H5V6.3l7-3.11v8.8z"/>
    </svg>
  ),
  'relic-energy': (
    <svg viewBox="0 0 24 24" fill="currentColor" className="w-6 h-6 text-yellow-400">
      <path d="M7 2v11h3v9l7-12h-4l4-8z"/>
    </svg>
  ),
  'relic-draw': (
    <svg viewBox="0 0 24 24" fill="currentColor" className="w-6 h-6 text-emerald-400">
      <path d="M21 3H3v18h18V3zM9 17H7v-7h2v7zm4 0h-2V7h2v10zm4 0h-2v-4h2v4z"/>
    </svg>
  ),
  'relic-hp': (
    <svg viewBox="0 0 24 24" fill="currentColor" className="w-6 h-6 text-pink-400">
      <path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/>
    </svg>
  ),
};

// ── Helpers ──

const getCardPrice = (card: Card): number => {
  const base = card.type === 'Attack' ? 50 : card.type === 'Power' ? 80 : 65;
  return base + card.cost * 10;
};

const CARD_REMOVE_COST = 75;

// ── Gold Coin SVG ──

const GoldCoin: React.FC<{ size?: number }> = ({ size = 18 }) => (
  <svg viewBox="0 0 20 20" width={size} height={size} className="inline-block shrink-0">
    <circle cx="10" cy="10" r="9" fill="#facc15" stroke="#a16207" strokeWidth="1.5" />
    <text x="10" y="14.5" textAnchor="middle" fontSize="11" fontWeight="bold" fill="#a16207" fontFamily="sans-serif">C</text>
  </svg>
);

// ── Card Removal Modal ──

const CardRemovalModal: React.FC<{
  deck: Card[];
  onRemove: (index: number) => void;
  onClose: () => void;
}> = ({ deck, onRemove, onClose }) => (
  <motion.div
    initial={{ opacity: 0 }}
    animate={{ opacity: 1 }}
    exit={{ opacity: 0 }}
    className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4"
    onClick={onClose}
  >
    <motion.div
      initial={{ scale: 0.9, opacity: 0 }}
      animate={{ scale: 1, opacity: 1 }}
      exit={{ scale: 0.9, opacity: 0 }}
      className="bg-slate-900 border border-slate-700 rounded-2xl p-6 max-w-3xl w-full max-h-[80vh] overflow-y-auto"
      onClick={(e) => e.stopPropagation()}
    >
      <div className="flex items-center justify-between mb-6">
        <h3 className="text-2xl font-bold text-white">Remove a Card</h3>
        <button onClick={onClose} className="text-slate-400 hover:text-white transition-colors">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-6 h-6">
            <path d="M18 6L6 18M6 6l12 12" strokeLinecap="round" />
          </svg>
        </button>
      </div>
      <p className="text-slate-400 mb-6">Select a card to permanently remove from your deck.</p>
      <div className="flex flex-wrap gap-4 justify-center">
        {deck.map((card, idx) => (
          <motion.div
            key={`${card.id}-${idx}`}
            whileHover={{ scale: 1.05, y: -5 }}
            className="cursor-pointer"
            onClick={() => onRemove(idx)}
          >
            <div className="pointer-events-none scale-90">
              <CardComponent card={card} />
            </div>
          </motion.div>
        ))}
      </div>
    </motion.div>
  </motion.div>
);

// ── Main ShopScreen ──

interface ShopScreenProps {
  playerHp: number;
  playerMaxHp: number;
  gold: number;
  currentFloor: number;
  totalFloors: number;
  deck: Card[];
  availableCards: Card[];
  roomShop?: ShopRoomContent | null;
  ownedRelics: Relic[];
  onBuyCard: (card: Card, price: number) => void;
  onBuyRelic: (relic: Relic, price: number) => void;
  onRemoveCard: (cardIndex: number, price: number) => void;
  onLeave: () => void;
}

export const ShopScreen: React.FC<ShopScreenProps> = ({
  playerHp,
  playerMaxHp,
  gold,
  currentFloor,
  totalFloors,
  deck,
  availableCards,
  roomShop,
  ownedRelics,
  onBuyCard,
  onBuyRelic,
  onRemoveCard,
  onLeave,
}) => {
  // Generate shop inventory once per mount
  const shopCards = useMemo(() => {
    if (roomShop?.shopCards && roomShop.shopCards.length > 0) {
      return roomShop.shopCards.slice(0, 3).map((card, idx) => ({
        card: { ...card, id: `shop-room-${idx}-${card.id}-${Date.now()}` },
        price: getCardPrice(card),
      }));
    }
    const pool = availableCards.filter(c => {
      const n = c.name.trim().toLowerCase();
      return n !== 'strike' && n !== 'defend';
    });
    const shuffled = [...pool].sort(() => Math.random() - 0.5);
    return shuffled.slice(0, 3).map(card => ({
      card: { ...card, id: `shop-${card.id}-${Date.now()}` },
      price: getCardPrice(card),
    }));
  }, [availableCards, roomShop]);

  const shopRelics = useMemo(() => {
    const ownedIds = new Set(ownedRelics.map(r => r.id));
    const available = SHOP_RELICS.filter(r => !ownedIds.has(r.id));
    return [...available].sort(() => Math.random() - 0.5).slice(0, 2);
  }, [ownedRelics]);

  const [boughtCards, setBoughtCards] = useState<Set<number>>(new Set());
  const [boughtRelics, setBoughtRelics] = useState<Set<string>>(new Set());
  const [showRemoval, setShowRemoval] = useState(false);
  const [removedCard, setRemovedCard] = useState(false);

  const handleBuyCard = (index: number) => {
    const item = shopCards[index];
    if (boughtCards.has(index) || gold < item.price) return;
    setBoughtCards(prev => new Set(prev).add(index));
    onBuyCard(item.card, item.price);
  };

  const handleBuyRelic = (relic: typeof SHOP_RELICS[0]) => {
    if (boughtRelics.has(relic.id) || gold < relic.price) return;
    setBoughtRelics(prev => new Set(prev).add(relic.id));
    const { price: _, ...relicData } = relic;
    onBuyRelic(relicData, relic.price);
  };

  const handleRemoveCard = (cardIndex: number) => {
    if (removedCard || gold < CARD_REMOVE_COST) return;
    setRemovedCard(true);
    setShowRemoval(false);
    onRemoveCard(cardIndex, CARD_REMOVE_COST);
  };

  return (
    <div className="w-full h-full bg-[#0b1021] flex flex-col overflow-y-auto">
      <PlayerHUD
        playerHp={playerHp}
        playerMaxHp={playerMaxHp}
        gold={gold}
        currentFloor={currentFloor}
        totalFloors={totalFloors}
      />

      <div className="flex-1 flex flex-col items-center px-4 sm:px-6 pb-8 pt-2">
        {/* Shop Title */}
        <motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          className="text-center mb-6"
        >
          <h2 className="text-3xl sm:text-4xl font-bold text-white mb-1.5">The Merchant</h2>
          <p className="text-slate-400 italic text-base">Buy wisely. Every card shapes your deck.</p>
        </motion.div>

        <div className="w-full max-w-4xl">
          {/* ── Divider ── */}
          <div className="w-full h-px bg-gradient-to-r from-transparent via-slate-600 to-transparent mb-6" />

          {/* ── Cards For Sale ── */}
          <div className="mb-8">
            <p className="text-xs font-bold text-slate-500 uppercase tracking-widest mb-4">Cards</p>
            <div className="flex flex-wrap gap-6 justify-center">
              {shopCards.map((item, index) => {
                const sold = boughtCards.has(index);
                const canAfford = gold >= item.price;
                return (
                  <motion.div
                    key={item.card.id}
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: index * 0.1 }}
                    className="flex flex-col items-center gap-3"
                  >
                    <motion.div
                      whileHover={!sold && canAfford ? { scale: 1.05, y: -8 } : undefined}
                      onClick={() => handleBuyCard(index)}
                      className={`cursor-pointer transition-all ${sold ? 'opacity-30 grayscale pointer-events-none' : !canAfford ? 'opacity-50 cursor-not-allowed' : ''}`}
                    >
                      <div className="pointer-events-none">
                        <CardComponent card={item.card} disabled={sold} />
                      </div>
                    </motion.div>
                    {/* Price */}
                    <div className={`flex items-center gap-1.5 ${sold ? 'opacity-30' : !canAfford ? 'text-red-400' : 'text-white'}`}>
                      <GoldCoin />
                      <span className="font-bold text-sm">{item.price}</span>
                    </div>
                  </motion.div>
                );
              })}
            </div>
          </div>

          {/* ── Divider ── */}
          <div className="w-full h-px bg-gradient-to-r from-transparent via-slate-600 to-transparent mb-6" />

          {/* ── Relics For Sale ── */}
          <div className="mb-8">
            <p className="text-xs font-bold text-slate-500 uppercase tracking-widest mb-4">Relics</p>
            <div className="flex flex-wrap gap-4 justify-center">
              {shopRelics.map((relic, index) => {
                const sold = boughtRelics.has(relic.id);
                const canAfford = gold >= relic.price;
                return (
                  <motion.button
                    key={relic.id}
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.3 + index * 0.1 }}
                    onClick={() => handleBuyRelic(relic)}
                    disabled={sold || !canAfford}
                    className={`flex items-center gap-3 px-4 py-3 rounded-xl border transition-all ${
                      sold
                        ? 'border-slate-700 bg-slate-900/30 opacity-30'
                        : canAfford
                          ? 'border-slate-600 bg-slate-800/60 hover:bg-slate-700/70 hover:border-slate-500 cursor-pointer'
                          : 'border-slate-700 bg-slate-900/40 opacity-50 cursor-not-allowed'
                    }`}
                  >
                    {/* Relic Icon */}
                    <div className="w-10 h-10 rounded-lg bg-slate-700/80 flex items-center justify-center shrink-0">
                      {relicIcons[relic.id] || (
                        <svg viewBox="0 0 24 24" fill="currentColor" className="w-6 h-6 text-slate-400">
                          <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/>
                        </svg>
                      )}
                    </div>
                    {/* Text */}
                    <div className="text-left">
                      <div className="font-bold text-white text-sm">{relic.name}</div>
                      <div className="text-xs text-slate-400">{relic.description}</div>
                    </div>
                    {/* Price */}
                    <div className="flex items-center gap-1 ml-4 shrink-0">
                      <GoldCoin />
                      <span className={`font-bold text-sm ${canAfford ? 'text-white' : 'text-red-400'}`}>{relic.price}</span>
                    </div>
                  </motion.button>
                );
              })}
            </div>
          </div>

          {/* ── Divider ── */}
          <div className="w-full h-px bg-gradient-to-r from-transparent via-slate-600 to-transparent mb-6" />

          {/* ── Remove a Card ── */}
          <div className="mb-8 flex justify-center">
            <motion.button
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.5 }}
              onClick={() => !removedCard && gold >= CARD_REMOVE_COST && setShowRemoval(true)}
              disabled={removedCard || gold < CARD_REMOVE_COST}
              className={`flex items-center gap-3 px-6 py-3.5 rounded-xl border-2 border-dashed transition-all ${
                removedCard
                  ? 'border-slate-700 bg-slate-900/30 opacity-30'
                  : gold >= CARD_REMOVE_COST
                    ? 'border-red-500/50 bg-red-950/20 hover:bg-red-900/30 hover:border-red-400/60 cursor-pointer'
                    : 'border-slate-700 bg-slate-900/40 opacity-50 cursor-not-allowed'
              }`}
            >
              {/* Minus Icon */}
              <div className="w-8 h-8 rounded-full bg-red-500/20 border-2 border-red-500/50 flex items-center justify-center shrink-0">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={3} className="w-4 h-4 text-red-400">
                  <path d="M5 12h14" strokeLinecap="round" />
                </svg>
              </div>
              <span className="font-bold text-white">Remove a Card from Your Deck</span>
              <div className="flex items-center gap-1 ml-2">
                <GoldCoin />
                <span className={`font-bold text-sm ${gold >= CARD_REMOVE_COST ? 'text-white' : 'text-red-400'}`}>{CARD_REMOVE_COST}</span>
              </div>
            </motion.button>
          </div>

          {/* ── Divider ── */}
          <div className="w-full h-px bg-gradient-to-r from-transparent via-slate-600 to-transparent mb-6" />

          {/* ── Leave Button ── */}
          <div className="flex justify-center">
            <motion.button
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.6 }}
              onClick={onLeave}
              className="flex items-center gap-2 px-6 py-3 text-slate-400 hover:text-white transition-colors group"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-5 h-5 group-hover:translate-x-0.5 transition-transform">
                <path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4M16 17l5-5-5-5M21 12H9" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              <span className="font-bold">Leave Shop</span>
            </motion.button>
          </div>
        </div>
      </div>

      {/* Card Removal Modal */}
      <AnimatePresence>
        {showRemoval && (
          <CardRemovalModal
            deck={deck}
            onRemove={handleRemoveCard}
            onClose={() => setShowRemoval(false)}
          />
        )}
      </AnimatePresence>
    </div>
  );
};
