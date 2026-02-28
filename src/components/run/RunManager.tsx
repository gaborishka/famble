import React, { useState, useEffect, useMemo } from 'react';
import { RunData, MapNode, Card, Enemy, Boss, Relic } from '../../../shared/types/game';
import { NodeMap } from '../map/NodeMap';
import { CombatArena, CombatVictorySummary } from '../combat/CombatArena';
import { CardReward } from '../rewards/CardReward';
import { generateFallbackNodeMap } from '../../engine/mapGenerator';
import { EventScreen, EventEffects } from './EventScreen';
import { ShopScreen } from './ShopScreen';
import { CardUpgradeScreen } from './CardUpgradeScreen';
import { PlayerHUD } from './PlayerHUD';
import { GameImage } from '../GameImage';

interface RunManagerProps {
  runData: RunData;
  onReset: () => void;
}

const getNodeRow = (node: MapNode): number => node.row ?? Math.round(node.y / 20);

const calculateCurrentFloor = (nodeList: MapNode[], floorCount: number): number => {
  let maxCompletedRow = -1;
  nodeList.forEach(node => {
    if (node.completed) {
      const row = getNodeRow(node);
      if (row > maxCompletedRow) {
        maxCompletedRow = row;
      }
    }
  });
  return Math.min(maxCompletedRow + 2, Math.max(1, floorCount));
};

interface RewardStats {
  damageDealt: number;
  turns: number;
  hpRemaining: number;
  hpMax: number;
  deckCount: number;
  floor: number;
  totalFloors: number;
  gold: number;
}

export const RunManager: React.FC<RunManagerProps> = ({ runData, onReset }) => {
  const isBasicStarterCard = (card: Card): boolean => {
    const normalized = card.name.trim().toLowerCase();
    return normalized === 'strike' || normalized === 'defend';
  };

  const [nodes, setNodes] = useState<MapNode[]>([]);
  const [currentNodeId, setCurrentNodeId] = useState<string | null>(null);
  const [view, setView] = useState<'map' | 'combat' | 'reward' | 'event' | 'shop' | 'treasure' | 'campfire'>('map');
  const [deck, setDeck] = useState<Card[]>(() => {
    const strike = runData.cards.find(c => c.name.trim().toLowerCase() === 'strike') || runData.cards[0];
    const defend = runData.cards.find(c => c.name.trim().toLowerCase() === 'defend') || runData.cards[1] || runData.cards[0];
    const specials = runData.cards.filter(c => c !== strike && c !== defend);
    const uniqueCard = specials[0] || runData.cards[2] || strike;

    return [
      ...Array(5).fill(null).map((_, i) => ({ ...strike, id: `strike-start-${i}` })),
      ...Array(4).fill(null).map((_, i) => ({ ...defend, id: `defend-start-${i}` })),
      { ...uniqueCard, id: `unique-start-0` }
    ];
  });
  const [playerHp, setPlayerHp] = useState(50);
  const [playerMaxHp, setPlayerMaxHp] = useState(50);
  const [gold, setGold] = useState(100);
  const [relics, setRelics] = useState<Relic[]>([]);
  const [currentEnemy, setCurrentEnemy] = useState<Enemy | Boss | null>(null);
  const [campfireAction, setCampfireAction] = useState<'choosing' | 'smithing'>('choosing');
  const [rewardCards, setRewardCards] = useState<Card[]>([]);
  const [rewardStats, setRewardStats] = useState<RewardStats | null>(null);

  useEffect(() => {
    if (runData.node_map) {
      setNodes(runData.node_map.map(node => ({
        ...node,
        nextNodes: node.nextNodes ?? [],
        completed: Boolean(node.completed),
      })));
    } else {
      setNodes(generateFallbackNodeMap(runData));
    }
    setRewardCards([]);
    setRewardStats(null);
  }, [runData]);

  const totalFloors = useMemo(() => {
    if (nodes.length === 0) return 1;
    const highestRow = nodes.reduce((maxRow, node) => {
      const row = getNodeRow(node);
      return Math.max(maxRow, row);
    }, 0);
    return highestRow + 1;
  }, [nodes]);

  const currentFloor = useMemo(() => calculateCurrentFloor(nodes, totalFloors), [nodes, totalFloors]);

  const getRewardSource = (): Card[] => {
    const rewardPool = runData.cards.filter(card => !isBasicStarterCard(card));
    return rewardPool.length > 0 ? rewardPool : runData.cards;
  };

  const getRandomRewardCards = (): Card[] => {
    const source = getRewardSource();
    return [...source]
      .sort(() => Math.random() - 0.5)
      .slice(0, Math.min(3, source.length));
  };

  const clearRewardState = () => {
    setRewardCards([]);
    setRewardStats(null);
  };

  const availableCards = useMemo(() => {
    return runData.cards.filter(c => !isBasicStarterCard(c));
  }, [runData.cards]);

  // ── Node Selection ──

  const handleNodeSelect = (node: MapNode) => {
    setCurrentNodeId(node.id);
    switch (node.type) {
      case 'Combat':
      case 'Elite':
      case 'Boss':
        if (node.type === 'Elite' && !node.data) {
          setCurrentEnemy({
            id: 'elite-1',
            name: 'Corrupted Guardian',
            maxHp: 80,
            currentHp: 80,
            description: 'A powerful elite foe.',
            intents: [{ type: 'Attack', value: 15, description: 'Deals 15 damage.' }, { type: 'Defend', value: 12, description: 'Gains 12 block.' }]
          });
        } else {
          setCurrentEnemy(node.data);
        }
        setView('combat');
        break;
      case 'Event':
        setView('event');
        break;
      case 'Shop':
        setView('shop');
        break;
      case 'Treasure':
        setView('treasure');
        break;
      case 'Campfire':
        setCampfireAction('choosing');
        setView('campfire');
        break;
    }
  };

  // ── Completion Helpers ──

  const markNodeCompleted = () => {
    setNodes(prev => prev.map(n => n.id === currentNodeId ? { ...n, completed: true } : n));
  };

  const returnToMap = () => {
    markNodeCompleted();
    setView('map');
  };

  // ── Combat ──

  const handleCombatVictory = (summary: CombatVictorySummary) => {
    const updatedNodes = nodes.map(node => (
      node.id === currentNodeId ? { ...node, completed: true } : node
    ));

    setPlayerHp(summary.hp);
    setPlayerMaxHp(summary.maxHp);
    setNodes(updatedNodes);

    if (currentEnemy?.id === runData.boss.id) {
      alert('Victory!');
      onReset();
    } else {
      const nextGold = gold + 25;
      const nextRewardCards = getRandomRewardCards();
      const nextFloor = calculateCurrentFloor(updatedNodes, totalFloors);

      setGold(nextGold);
      setRewardCards(nextRewardCards);
      setRewardStats({
        damageDealt: summary.damageDealt,
        turns: summary.turns,
        hpRemaining: summary.hp,
        hpMax: summary.maxHp,
        deckCount: deck.length,
        floor: nextFloor,
        totalFloors,
        gold: nextGold,
      });
      setView('reward');
    }
  };

  const handleCombatDefeat = () => {
    alert('Defeat!');
    onReset();
  };

  // ── Reward ──

  const handleCardSelect = (card: Card) => {
    const rewardCard = {
      ...card,
      id: `${card.id}-reward-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    };
    setDeck(prev => [...prev, rewardCard]);
    clearRewardState();
    setView('map');
  };

  const handleSkipReward = () => {
    clearRewardState();
    setView('map');
  };

  // ── Event ──

  const handleEventComplete = (effects: EventEffects) => {
    if (effects.hpDelta) {
      setPlayerHp(h => Math.max(1, Math.min(playerMaxHp + (effects.maxHpDelta || 0), h + effects.hpDelta!)));
    }
    if (effects.maxHpDelta) {
      setPlayerMaxHp(m => Math.max(1, m + effects.maxHpDelta!));
      if (effects.maxHpDelta > 0 && !effects.hpDelta) {
        setPlayerHp(h => h + effects.maxHpDelta!);
      }
    }
    if (effects.goldDelta) {
      setGold(g => Math.max(0, g + effects.goldDelta!));
    }
    if (effects.addCard) {
      setDeck(prev => [...prev, effects.addCard!]);
    }
    returnToMap();
  };

  // ── Shop ──

  const handleBuyCard = (card: Card, price: number) => {
    setGold(g => g - price);
    setDeck(prev => [...prev, { ...card, id: `shop-buy-${Date.now()}-${Math.random().toString(36).slice(2, 8)}` }]);
  };

  const handleBuyRelic = (relic: Relic, price: number) => {
    setGold(g => g - price);
    setRelics(prev => [...prev, relic]);
    // Apply relic effects immediately where applicable
    if (relic.effect === 'MaxHP') {
      setPlayerMaxHp(m => m + relic.value);
      setPlayerHp(h => h + relic.value);
    }
  };

  const handleRemoveCard = (cardIndex: number, price: number) => {
    setGold(g => g - price);
    setDeck(prev => prev.filter((_, idx) => idx !== cardIndex));
  };

  const handleShopLeave = () => {
    returnToMap();
  };

  // ── Campfire ──

  const handleCardUpgrade = (cardIndex: number) => {
    setDeck(prev => prev.map((c, idx) => {
      if (idx !== cardIndex || c.upgraded) return c;
      return {
        ...c,
        upgraded: true,
        damage: typeof c.damage === 'number' ? c.damage + 3 : c.damage,
        block: typeof c.block === 'number' ? c.block + 3 : c.block,
        cost: c.type === 'Power' ? Math.max(0, c.cost - 1) : c.cost
      };
    }));
    returnToMap();
  };

  // ── Render ──

  if (view === 'map') {
    return (
      <NodeMap
        nodes={nodes}
        currentNodeId={currentNodeId}
        onNodeSelect={handleNodeSelect}
        playerHp={playerHp}
        playerMaxHp={playerMaxHp}
        gold={gold}
        bossName={runData.boss.name}
        totalFloors={totalFloors}
      />
    );
  }

  if (view === 'combat' && currentEnemy) {
    return (
      <CombatArena
        runData={runData}
        deck={deck}
        enemy={currentEnemy}
        playerHp={playerHp}
        playerMaxHp={playerMaxHp}
        onVictory={handleCombatVictory}
        onDefeat={handleCombatDefeat}
      />
    );
  }

  if (view === 'reward') {
    const cardsToShow = rewardCards.length > 0 ? rewardCards : getRewardSource().slice(0, 3);
    const statsToShow: RewardStats = rewardStats ?? {
      damageDealt: 0,
      turns: 1,
      hpRemaining: playerHp,
      hpMax: playerMaxHp,
      deckCount: deck.length,
      floor: currentFloor,
      totalFloors,
      gold,
    };

    return (
      <CardReward
        cards={cardsToShow}
        onSelect={handleCardSelect}
        onSkip={handleSkipReward}
        stats={statsToShow}
      />
    );
  }

  if (view === 'event') {
    return (
      <EventScreen
        playerHp={playerHp}
        playerMaxHp={playerMaxHp}
        gold={gold}
        currentFloor={currentFloor}
        totalFloors={totalFloors}
        availableCards={availableCards}
        onComplete={handleEventComplete}
      />
    );
  }

  if (view === 'shop') {
    return (
      <ShopScreen
        playerHp={playerHp}
        playerMaxHp={playerMaxHp}
        gold={gold}
        currentFloor={currentFloor}
        totalFloors={totalFloors}
        deck={deck}
        availableCards={availableCards}
        ownedRelics={relics}
        onBuyCard={handleBuyCard}
        onBuyRelic={handleBuyRelic}
        onRemoveCard={handleRemoveCard}
        onLeave={handleShopLeave}
      />
    );
  }

  if (view === 'treasure') {
    return (
      <div className="w-full h-full bg-[#0b1021] flex flex-col overflow-y-auto text-white relative">
        {/* Ambient gold glow */}
        <div className="absolute inset-0 pointer-events-none overflow-hidden">
          <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-96 h-96 bg-amber-500/8 rounded-full blur-[120px] animate-pulse" />
        </div>

        <PlayerHUD
          playerHp={playerHp}
          playerMaxHp={playerMaxHp}
          gold={gold}
          currentFloor={currentFloor}
          totalFloors={totalFloors}
        />

        <div className="flex-1 flex flex-col items-center px-4 sm:px-6 pb-8 pt-2 relative z-10">
          {/* Treasure Illustration */}
          <div className="w-full max-w-md h-44 sm:h-52 rounded-lg border-2 border-amber-600/30 overflow-hidden mb-8 bg-slate-800 shadow-2xl shadow-amber-500/10">
            <GameImage
              prompt="ornate treasure chest overflowing with gold coins and gems in a stone dungeon, warm golden light emanating from chest, fantasy game art, atmospheric, digital painting"
              className="w-full h-full"
              alt="Treasure Chest"
              type="background"
            />
          </div>

          {/* Title + Divider + Description */}
          <div className="text-center mb-8 max-w-lg">
            <h2 className="text-3xl sm:text-4xl font-bold text-amber-300 mb-3 tracking-tight">Treasure Chest</h2>
            <div className="w-48 h-px mx-auto bg-gradient-to-r from-transparent via-amber-500/50 to-transparent mb-5" />
            <p className="text-slate-400 text-base leading-relaxed px-2">
              A hidden cache of riches, untouched for ages. The gold glimmers in the dim light, beckoning you to claim it.
            </p>
          </div>

          {/* Reward Display */}
          <div className="flex items-center gap-3 bg-amber-900/20 border border-amber-500/30 rounded-xl px-6 py-4 mb-8">
            <div className="w-12 h-12 rounded-full bg-gradient-to-br from-amber-300 to-amber-500 flex items-center justify-center border-2 border-amber-600 shadow-lg shadow-amber-500/30">
              <span className="text-lg font-black text-amber-900">C</span>
            </div>
            <div>
              <div className="text-2xl font-bold text-amber-300">+100 Gold</div>
              <div className="text-sm text-slate-400">Added to your purse</div>
            </div>
          </div>

          {/* Claim Button */}
          <button
            onClick={() => {
              setGold(g => g + 100);
              returnToMap();
            }}
            className="w-full max-w-lg flex items-center gap-4 px-4 py-4 rounded-lg border-l-4 border-l-amber-500 bg-slate-800/60 hover:bg-slate-700/80 transition-all cursor-pointer text-left group"
          >
            <div className="w-10 h-10 rounded-full bg-amber-500 flex items-center justify-center shrink-0 text-white shadow-lg">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5">
                <path d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                <path d="M9 12l2 2 4-4" />
              </svg>
            </div>
            <div className="flex-1 min-w-0">
              <div className="font-bold text-white text-base leading-snug">Claim the treasure</div>
              <div className="text-sm text-slate-400 leading-snug mt-0.5">Take the gold and continue your journey</div>
            </div>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} className="w-5 h-5 text-slate-500 group-hover:text-white transition-colors shrink-0">
              <path d="M9 18l6-6-6-6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>

          {/* Footer */}
          <p className="text-slate-500 italic text-sm tracking-wide mt-8">
            Fortune favors the bold.
          </p>
        </div>
      </div>
    );
  }

  if (view === 'campfire') {
    const healAmount = Math.floor(playerMaxHp * 0.3);

    return (
      <div className="w-full h-full bg-[#0b1021] flex flex-col overflow-y-auto text-white relative">
        {/* Ambient campfire glows */}
        <div className="absolute inset-0 pointer-events-none overflow-hidden">
          <div className="absolute left-1/2 top-1/3 -translate-x-1/2 w-80 h-80 bg-orange-600/15 rounded-full blur-[120px] animate-pulse" />
          <div className="absolute left-1/2 top-1/2 -translate-x-1/2 w-48 h-48 bg-amber-500/10 rounded-full blur-[80px] animate-pulse" style={{ animationDelay: '1s' }} />
        </div>

        <PlayerHUD
          playerHp={playerHp}
          playerMaxHp={playerMaxHp}
          gold={gold}
          currentFloor={currentFloor}
          totalFloors={totalFloors}
        />

        <div className="flex-1 flex flex-col items-center px-4 sm:px-6 pb-8 pt-2 relative z-10">
          {campfireAction === 'choosing' ? (
            <>
              {/* Campfire Illustration */}
              <div className="w-full max-w-md h-44 sm:h-52 rounded-lg border-2 border-orange-600/30 overflow-hidden mb-8 bg-slate-800 shadow-2xl shadow-orange-500/10">
                <GameImage
                  prompt="cozy campfire at night in a dark forest clearing with warm orange flames and glowing embers, fantasy game art, atmospheric lighting, digital painting"
                  className="w-full h-full"
                  alt="Rest Site"
                  type="background"
                />
              </div>

              {/* Title + Description */}
              <div className="text-center mb-8 max-w-lg">
                <h2 className="text-3xl sm:text-4xl font-bold text-orange-400 mb-3 tracking-tight">Rest Site</h2>
                <div className="w-48 h-px mx-auto bg-gradient-to-r from-transparent via-orange-500/50 to-transparent mb-5" />
                <p className="text-slate-400 text-base leading-relaxed px-2">
                  The warmth of the fire soothes your aching muscles. You may rest to recover your strength, or use the forge to hone your cards.
                </p>
              </div>

              {/* Choices */}
              <div className="w-full max-w-lg space-y-3 mb-8">
                {/* Rest Option */}
                <button
                  onClick={() => {
                    setPlayerHp(h => Math.min(playerMaxHp, h + healAmount));
                    returnToMap();
                  }}
                  className="w-full flex items-center gap-4 px-4 py-4 rounded-lg border-l-4 border-l-emerald-500 bg-slate-800/60 hover:bg-slate-700/80 transition-all cursor-pointer text-left group"
                >
                  <div className="w-10 h-10 rounded-full bg-emerald-500 flex items-center justify-center shrink-0 text-white shadow-lg">
                    <svg viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5">
                      <path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/>
                    </svg>
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="font-bold text-white text-base leading-snug">Rest by the fire</div>
                    <div className="text-sm text-slate-400 leading-snug mt-0.5">Heal <span className="text-emerald-400 font-semibold">{healAmount} HP</span> (30% of max)</div>
                  </div>
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} className="w-5 h-5 text-slate-500 group-hover:text-white transition-colors shrink-0">
                    <path d="M9 18l6-6-6-6" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </button>

                {/* Smith Option */}
                <button
                  onClick={() => setCampfireAction('smithing')}
                  className="w-full flex items-center gap-4 px-4 py-4 rounded-lg border-l-4 border-l-amber-500 bg-slate-800/60 hover:bg-slate-700/80 transition-all cursor-pointer text-left group"
                >
                  <div className="w-10 h-10 rounded-full bg-amber-500 flex items-center justify-center shrink-0 text-white shadow-lg">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-5 h-5">
                      <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="font-bold text-white text-base leading-snug">Smith at the forge</div>
                    <div className="text-sm text-slate-400 leading-snug mt-0.5">Upgrade a card in your deck</div>
                  </div>
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} className="w-5 h-5 text-slate-500 group-hover:text-white transition-colors shrink-0">
                    <path d="M9 18l6-6-6-6" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </button>
              </div>

              {/* Footer */}
              <p className="text-slate-500 italic text-sm tracking-wide">
                The fire crackles softly. Take your time.
              </p>
            </>
          ) : (
            <CardUpgradeScreen
              deck={deck}
              cost={0}
              onUpgrade={handleCardUpgrade}
              onBack={() => setCampfireAction('choosing')}
            />
          )}
        </div>
      </div>
    );
  }

  return null;
};
