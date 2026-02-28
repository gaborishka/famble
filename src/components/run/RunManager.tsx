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
      // Generate a row-based tree map
      const enemies = runData.enemies;
      const pickEnemy = (i: number) => enemies[i % enemies.length];

      const rowDefs: { types: MapNode['type'][]; data?: any[] }[] = [
        // Row 0 (start): 3 nodes
        { types: ['Combat', 'Event', 'Combat'], data: [pickEnemy(0), undefined, pickEnemy(1)] },
        // Row 1: 4 nodes
        { types: ['Combat', 'Shop', 'Shop', 'Treasure'], data: [pickEnemy(0), undefined, undefined, undefined] },
        // Row 2: 4 nodes
        { types: ['Combat', 'Event', 'Combat', 'Combat'], data: [pickEnemy(1), undefined, pickEnemy(0), pickEnemy(1)] },
        // Row 3: 3 nodes
        { types: ['Combat', 'Event', 'Combat'], data: [pickEnemy(0), undefined, pickEnemy(1)] },
        // Row 4 (boss): 1 node
        { types: ['Boss'], data: [runData.boss] },
      ];

      const allNodes: MapNode[] = [];
      const rowNodeIds: string[][] = [];

      rowDefs.forEach((rowDef, rowIdx) => {
        const ids: string[] = [];
        rowDef.types.forEach((type, colIdx) => {
          const id = rowIdx === rowDefs.length - 1 ? 'boss' : `r${rowIdx}c${colIdx}`;
          ids.push(id);
          allNodes.push({
            id,
            type,
            x: 0,
            y: 0,
            row: rowIdx,
            nextNodes: [], // filled below
            completed: false,
            data: rowDef.data?.[colIdx],
          });
        });
        rowNodeIds.push(ids);
      });

      // Connect each node to 1-2 nodes in the next row
      for (let r = 0; r < rowNodeIds.length - 1; r++) {
        const current = rowNodeIds[r];
        const next = rowNodeIds[r + 1];

        if (next.length === 1) {
          // All connect to boss
          current.forEach(id => {
            const node = allNodes.find(n => n.id === id)!;
            node.nextNodes = [next[0]];
          });
        } else {
          // Each node connects to closest 1-2 nodes in next row
          current.forEach((id, ci) => {
            const node = allNodes.find(n => n.id === id)!;
            const ratio = current.length > 1 ? ci / (current.length - 1) : 0.5;
            const targetIdx = Math.round(ratio * (next.length - 1));
            const targets = new Set<string>();
            targets.add(next[targetIdx]);
            // Add one neighbor for variety
            if (targetIdx > 0 && Math.random() > 0.4) targets.add(next[targetIdx - 1]);
            if (targetIdx < next.length - 1 && Math.random() > 0.4) targets.add(next[targetIdx + 1]);
            node.nextNodes = Array.from(targets);
          });

          // Ensure every next-row node is reachable
          next.forEach(nextId => {
            const isReachable = current.some(id => allNodes.find(n => n.id === id)!.nextNodes.includes(nextId));
            if (!isReachable) {
              // Connect from closest current node
              const nextIdx = next.indexOf(nextId);
              const ratio = next.length > 1 ? nextIdx / (next.length - 1) : 0.5;
              const closestIdx = Math.round(ratio * (current.length - 1));
              allNodes.find(n => n.id === current[closestIdx])!.nextNodes.push(nextId);
            }
          });
        }
      }

      setNodes(allNodes);
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
    return (
      <NodeMap
        nodes={nodes}
        currentNodeId={currentNodeId}
        onNodeSelect={handleNodeSelect}
        playerHp={playerHp}
        playerMaxHp={playerMaxHp}
        gold={gold}
        bossName={runData.boss.name}
        totalFloors={5}
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
