import React, { useState, useEffect } from 'react';
import { RunData, MapNode, Card, Enemy, Boss } from '../../../shared/types/game';
import { NodeMap } from '../map/NodeMap';
import { CombatArena } from '../combat/CombatArena';
import { CardReward } from '../rewards/CardReward';

interface RunManagerProps {
  runData: RunData;
  onReset: () => void;
}

export const RunManager: React.FC<RunManagerProps> = ({ runData, onReset }) => {
  const [nodes, setNodes] = useState<MapNode[]>([]);
  const [currentNodeId, setCurrentNodeId] = useState<string | null>(null);
  const [view, setView] = useState<'map' | 'combat' | 'reward' | 'event' | 'shop' | 'treasure'>('map');
  const [deck, setDeck] = useState<Card[]>(runData.cards);
  const [playerHp, setPlayerHp] = useState(50);
  const [playerMaxHp, setPlayerMaxHp] = useState(50);
  const [gold, setGold] = useState(100);
  const [currentEnemy, setCurrentEnemy] = useState<Enemy | Boss | null>(null);

  useEffect(() => {
    if (runData.node_map) {
      setNodes(runData.node_map);
    } else {
      // Generate a simple map
      const generatedNodes: MapNode[] = [
        { id: 'start', type: 'Combat', x: 50, y: 0, nextNodes: ['n1', 'n2'], completed: false, data: runData.enemies[0] },
        { id: 'n1', type: 'Event', x: 30, y: 20, nextNodes: ['n3'], completed: false },
        { id: 'n2', type: 'Combat', x: 70, y: 20, nextNodes: ['n3', 'n4'], completed: false, data: runData.enemies[1] || runData.enemies[0] },
        { id: 'n3', type: 'Treasure', x: 40, y: 40, nextNodes: ['n5'], completed: false },
        { id: 'n4', type: 'Shop', x: 80, y: 40, nextNodes: ['n5'], completed: false },
        { id: 'n5', type: 'Combat', x: 60, y: 60, nextNodes: ['boss'], completed: false, data: runData.enemies[0] },
        { id: 'boss', type: 'Boss', x: 50, y: 100, nextNodes: [], completed: false, data: runData.boss },
      ];
      setNodes(generatedNodes);
    }
  }, [runData]);

  const handleNodeSelect = (node: MapNode) => {
    setCurrentNodeId(node.id);
    switch (node.type) {
      case 'Combat':
      case 'Boss':
        setCurrentEnemy(node.data);
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

  const handleEventComplete = () => {
    setNodes(prev => prev.map(n => n.id === currentNodeId ? { ...n, completed: true } : n));
    setView('map');
  };

  if (view === 'map') {
    return <NodeMap nodes={nodes} currentNodeId={currentNodeId} onNodeSelect={handleNodeSelect} />;
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
    // Generate 3 random cards from runData.cards
    const rewardCards = [...runData.cards].sort(() => Math.random() - 0.5).slice(0, 3);
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

  return null;
};
