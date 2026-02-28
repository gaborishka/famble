import React, { useState, useEffect, useMemo } from 'react';
import { RunData, MapNode, Card, Enemy, Boss } from '../../../shared/types/game';
import { NodeMap } from '../map/NodeMap';
import { CombatArena } from '../combat/CombatArena';
import { CardReward } from '../rewards/CardReward';
import { generateFallbackNodeMap } from '../../engine/mapGenerator';

interface RunManagerProps {
  runData: RunData;
  onReset: () => void;
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
    // Generate starter deck of 10 cards: 5 Strike, 4 Defend, 1 Unique
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
  const [currentEnemy, setCurrentEnemy] = useState<Enemy | Boss | null>(null);
  const [campfireAction, setCampfireAction] = useState<'choosing' | 'smithing'>('choosing');

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
  }, [runData]);

  const totalFloors = useMemo(() => {
    if (nodes.length === 0) return 1;
    const highestRow = nodes.reduce((maxRow, node) => {
      const row = node.row ?? Math.round(node.y / 20);
      return Math.max(maxRow, row);
    }, 0);
    return highestRow + 1;
  }, [nodes]);

  const handleNodeSelect = (node: MapNode) => {
    setCurrentNodeId(node.id);
    switch (node.type) {
      case 'Combat':
      case 'Elite':
      case 'Boss':
        // Generate an elite if it's an Elite node and no specific data was provided
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

  const handleCombatVictory = (hp: number) => {
    setPlayerHp(hp);
    setNodes(prev => prev.map(n => n.id === currentNodeId ? { ...n, completed: true } : n));

    if (currentEnemy === runData.boss) {
      // Victory!
      alert('Victory!');
      onReset();
    } else {
      setGold(g => g + 25);
      setView('reward');
    }
  };

  const handleCombatDefeat = () => {
    alert('Defeat!');
    onReset();
  };

  const handleCardSelect = (card: Card) => {
    setDeck(prev => [...prev, card]);
    setView('map');
  };

  const handleSkipReward = () => {
    setView('map');
  };

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
    handleEventComplete();
  };

  const handleEventComplete = () => {
    setNodes(prev => prev.map(n => n.id === currentNodeId ? { ...n, completed: true } : n));
    setView('map');
  };

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
    // Generate 3 random cards from runData.cards, excluding basic Strike/Defend
    const rewardPool = runData.cards.filter(c => !isBasicStarterCard(c));
    const rewardSource = rewardPool.length > 0 ? rewardPool : runData.cards;
    const rewardCards = [...rewardSource].sort(() => Math.random() - 0.5).slice(0, 3);
    return <CardReward cards={rewardCards} onSelect={handleCardSelect} onSkip={handleSkipReward} />;
  }

  if (view === 'event') {
    return (
      <div className="w-full h-full bg-slate-950 flex flex-col items-center justify-center p-8 text-white">
        <h2 className="text-4xl font-bold mb-8">Mysterious Event</h2>
        <p className="text-xl mb-8 text-slate-300">You find a strange shrine. It heals you for 10 HP.</p>
        <button
          onClick={() => {
            setPlayerHp(Math.min(playerMaxHp, playerHp + 10));
            handleEventComplete();
          }}
          className="px-8 py-3 bg-purple-600 hover:bg-purple-500 text-white font-bold rounded-lg transition-colors"
        >
          Accept
        </button>
      </div>
    );
  }

  if (view === 'shop') {
    return (
      <div className="w-full h-full bg-slate-950 flex flex-col items-center justify-center p-8 text-white">
        <h2 className="text-4xl font-bold mb-8">Merchant</h2>
        <p className="text-xl mb-8 text-slate-300">You have {gold} Gold.</p>
        <div className="flex gap-4 mb-8">
          <button
            onClick={() => {
              if (gold >= 50) {
                setGold(g => g - 50);
                setPlayerMaxHp(m => m + 5);
                setPlayerHp(h => h + 5);
              }
            }}
            disabled={gold < 50}
            className="px-8 py-3 bg-yellow-600 hover:bg-yellow-500 disabled:bg-slate-700 disabled:text-slate-500 text-white font-bold rounded-lg transition-colors"
          >
            Buy Waffle (50g) - +5 Max HP
          </button>
        </div>
        <button
          onClick={handleEventComplete}
          className="px-8 py-3 bg-slate-800 hover:bg-slate-700 text-white font-bold rounded-lg transition-colors"
        >
          Leave
        </button>
      </div>
    );
  }

  if (view === 'treasure') {
    return (
      <div className="w-full h-full bg-slate-950 flex flex-col items-center justify-center p-8 text-white">
        <h2 className="text-4xl font-bold mb-8">Treasure Chest</h2>
        <p className="text-xl mb-8 text-slate-300">You found 100 Gold!</p>
        <button
          onClick={() => {
            setGold(g => g + 100);
            handleEventComplete();
          }}
          className="px-8 py-3 bg-blue-600 hover:bg-blue-500 text-white font-bold rounded-lg transition-colors"
        >
          Open
        </button>
      </div>
    );
  }

  if (view === 'campfire') {
    const upgradableCards = deck.filter(card => !card.upgraded);

    return (
      <div className="w-full h-full bg-slate-950 flex flex-col items-center justify-center p-8 text-white relative">
        <div className="absolute inset-0 pointer-events-none flex items-center justify-center opacity-20">
          <div className="w-64 h-64 bg-orange-600 rounded-full blur-[100px] animate-pulse"></div>
        </div>

        <h2 className="text-5xl font-bold mb-12 relative z-10 text-orange-400">Rest Site</h2>

        {campfireAction === 'choosing' ? (
          <div className="flex gap-8 relative z-10">
            <button
              onClick={() => {
                const heal = Math.floor(playerMaxHp * 0.3);
                setPlayerHp(h => Math.min(playerMaxHp, h + heal));
                handleEventComplete();
              }}
              className="flex flex-col items-center justify-center w-48 h-48 bg-emerald-900/40 hover:bg-emerald-800/60 border-2 border-emerald-500/50 hover:border-emerald-400 rounded-2xl transition-all group"
            >
              <span className="text-4xl mb-4 group-hover:scale-110 transition-transform">💤</span>
              <span className="text-2xl font-bold text-white mb-2">Rest</span>
              <span className="text-sm text-emerald-300">Heal {Math.floor(playerMaxHp * 0.3)} HP</span>
            </button>

            <button
              onClick={() => setCampfireAction('smithing')}
              className="flex flex-col items-center justify-center w-48 h-48 bg-amber-900/40 hover:bg-amber-800/60 border-2 border-amber-500/50 hover:border-amber-400 rounded-2xl transition-all group"
            >
              <span className="text-4xl mb-4 group-hover:scale-110 transition-transform">🔨</span>
              <span className="text-2xl font-bold text-white mb-2">Smith</span>
              <span className="text-sm text-amber-300">Upgrade a card</span>
            </button>
          </div>
        ) : (
          <div className="relative z-10 w-full max-w-4xl">
            <div className="text-center mb-6">
              <h3 className="text-2xl font-semibold text-amber-300">Choose a card to upgrade</h3>
              <p className="text-slate-300 mt-2">Attack/Skill: +3 value, Power: -1 cost (min 0)</p>
            </div>

            {upgradableCards.length === 0 ? (
              <div className="bg-slate-900/70 border border-slate-700 rounded-xl p-6 text-center">
                <p className="text-lg text-slate-200 mb-4">All cards are already upgraded.</p>
                <button
                  onClick={handleEventComplete}
                  className="px-6 py-3 bg-slate-700 hover:bg-slate-600 rounded-lg font-bold transition-colors"
                >
                  Continue
                </button>
              </div>
            ) : (
              <>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 max-h-[420px] overflow-auto pr-1">
                  {deck.map((card, idx) => (
                    <button
                      key={`${card.id}-${idx}`}
                      onClick={() => handleCardUpgrade(idx)}
                      disabled={card.upgraded}
                      className={`text-left p-4 rounded-xl border transition-all ${card.upgraded
                          ? 'bg-slate-900/50 border-slate-700 text-slate-500 cursor-not-allowed'
                          : 'bg-amber-950/40 border-amber-500/40 hover:bg-amber-900/40 hover:border-amber-400'
                        }`}
                    >
                      <div className="flex items-center justify-between mb-2">
                        <span className="font-bold text-lg">{card.name}{card.upgraded ? ' +' : ''}</span>
                        <span className="text-sm text-slate-300">{card.type} • Cost {card.cost}</span>
                      </div>
                      <div className="text-sm text-slate-200 space-x-3">
                        {typeof card.damage === 'number' && <span>DMG {card.damage}</span>}
                        {typeof card.block === 'number' && <span>BLK {card.block}</span>}
                        {typeof card.damage !== 'number' && typeof card.block !== 'number' && <span>Utility card</span>}
                      </div>
                    </button>
                  ))}
                </div>

                <div className="mt-6 flex justify-center">
                  <button
                    onClick={() => setCampfireAction('choosing')}
                    className="px-6 py-3 bg-slate-800 hover:bg-slate-700 rounded-lg font-bold transition-colors"
                  >
                    Back
                  </button>
                </div>
              </>
            )}
          </div>
        )}
      </div>
    );
  }

  return null;
};
