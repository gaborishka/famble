import React, { useState, useEffect } from 'react';
import { GameState, Card, Enemy, Boss, RunData } from '../../../shared/types/game';
import { initializeCombat, endTurn } from '../../engine/combatEngine';
import { resolveCard } from '../../engine/cardResolver';
import { checkSynergies } from '../../engine/synergyEngine';
import { HandDisplay } from './HandDisplay';
import { getNextIntent } from '../../engine/enemyAI';
import { motion, AnimatePresence } from 'motion/react';
import { GameImage } from '../GameImage';

interface CombatArenaProps {
  runData: RunData;
  deck: Card[];
  enemy: Enemy | Boss;
  playerHp: number;
  playerMaxHp: number;
  onVictory: (hp: number) => void;
  onDefeat: () => void;
}

export const CombatArena: React.FC<CombatArenaProps> = ({ runData, deck, enemy, playerHp, playerMaxHp, onVictory, onDefeat }) => {
  const [gameState, setGameState] = useState<GameState | null>(null);
  const [activeSynergies, setActiveSynergies] = useState<string[]>([]);
  const [isGameOver, setIsGameOver] = useState(false);
  const [isVictory, setIsVictory] = useState(false);

  useEffect(() => {
    const state = initializeCombat(deck, enemy);
    state.playerHp = playerHp;
    state.playerMaxHp = playerMaxHp;
    setGameState(state);
  }, [deck, enemy, playerHp, playerMaxHp]);

  if (!gameState || !gameState.currentEnemy) {
    return <div className="text-white">Loading combat...</div>;
  }

  const handlePlayCard = (card: Card) => {
    if (card.cost > gameState.energy || isGameOver || isVictory) return;
    let newState = resolveCard(card, gameState);

    // Check synergies
    const triggered = checkSynergies(newState, runData.synergies);
    if (triggered.length > 0) {
      setActiveSynergies(triggered.map(s => s.name || s.tag));
      setTimeout(() => setActiveSynergies([]), 2000);

      // Apply synergy effects
      triggered.forEach(synergy => {
        if (synergy.effect === 'Damage' && newState.currentEnemy) {
          newState.currentEnemy.currentHp = Math.max(0, newState.currentEnemy.currentHp - synergy.value);
        } else if (synergy.effect === 'Block') {
          newState.statusEffects['Block'] = (newState.statusEffects['Block'] || 0) + synergy.value;
        } else if (synergy.effect === 'Energy') {
          newState.energy += synergy.value;
        }
      });
    }

    // Check enemy death
    if (newState.currentEnemy && newState.currentEnemy.currentHp <= 0) {
      setIsVictory(true);
      setGameState(newState);
    } else {
      setGameState(newState);
    }
  };

  const handleEndTurn = () => {
    if (isGameOver || isVictory) return;
    const newState = endTurn(gameState);
    if (newState.playerHp <= 0) {
      setIsGameOver(true);
    }
    setGameState(newState);
  };

  const currentEnemyState = gameState.currentEnemy;
  const intent = getNextIntent(currentEnemyState, gameState.turn);

  return (
    <div className="flex flex-col h-screen bg-[#0a0f1c] text-white overflow-hidden p-8 relative font-sans z-0">
      {/* Dynamic Background */}
      <div className="absolute inset-0 z-[-1]">
        <GameImage
          prompt={`A scenic, atmospheric background for a fantasy battle, ${runData.theme} theme, inside a room, 2D digital art`}
          type="background"
          className="w-full h-full object-cover opacity-60 absolute inset-0"
          alt="Combat Background"
        />
        <div className="absolute inset-0 bg-gradient-to-b from-[#0a0f1c]/40 via-transparent to-[#0a0f1c]/90" />
      </div>

      {/* Game Over Overlay */}
      <AnimatePresence>
        {isGameOver && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="absolute inset-0 bg-black/80 z-[100] flex flex-col items-center justify-center"
          >
            <h1 className="text-6xl font-bold text-red-500 mb-4">DEFEAT</h1>
            <p className="text-xl text-slate-300 mb-8">You have been defeated by {enemy.name}.</p>
            <button
              onClick={onDefeat}
              className="px-8 py-4 bg-red-600 hover:bg-red-500 text-white font-bold rounded-xl shadow-lg transition-colors"
            >
              End Run
            </button>
          </motion.div>
        )}
        {isVictory && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="absolute inset-0 bg-black/80 z-[100] flex flex-col items-center justify-center"
          >
            <h1 className="text-6xl font-bold text-yellow-400 mb-4">VICTORY!</h1>
            <p className="text-xl text-slate-300 mb-8">You defeated {enemy.name}!</p>
            <button
              onClick={() => onVictory(gameState.playerHp)}
              className="px-8 py-4 bg-yellow-600 hover:bg-yellow-500 text-white font-bold rounded-xl shadow-lg transition-colors"
            >
              Continue
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Top Left Player HUD */}
      <div className="absolute top-6 left-6 z-50 flex items-center gap-4">
        <div className="w-64 h-8 bg-slate-900 rounded border-2 border-slate-700 overflow-hidden relative flex items-center shadow-lg">
          <div
            className="h-full bg-green-500 transition-all duration-300 absolute left-0 top-0"
            style={{ width: `${(gameState.playerHp / gameState.playerMaxHp) * 100}%` }}
          />
          <div className="relative w-full text-center text-white font-bold tracking-widest text-sm z-10 drop-shadow-md">
            {gameState.playerHp}/{gameState.playerMaxHp}
          </div>
        </div>
        {gameState.statusEffects['Block'] > 0 && (
          <div className="flex items-center gap-1 text-blue-400 text-xl font-bold bg-slate-800/80 px-3 py-1 rounded-lg border border-slate-700 shadow-lg">
            🛡️ {gameState.statusEffects['Block']}
          </div>
        )}
        {gameState.statusEffects['Vulnerable'] > 0 && (
          <div className="flex items-center gap-1 text-purple-400 text-xl font-bold bg-slate-800/80 px-3 py-1 rounded-lg border border-slate-700 shadow-lg">
            💔 {gameState.statusEffects['Vulnerable']}
          </div>
        )}
      </div>

      {/* Top Right Settings / Info */}
      <div className="absolute top-6 right-6 z-50 flex items-center gap-4">
        <div className="text-xl font-bold text-blue-400">Turn {gameState.turn}</div>
      </div>

      {/* Synergies Notification */}
      <div className="absolute top-24 left-1/2 transform -translate-x-1/2 z-50">
        <AnimatePresence>
          {activeSynergies.map((synergy, index) => (
            <motion.div
              key={synergy + index}
              initial={{ opacity: 0, y: -20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className="bg-yellow-500 text-black px-6 py-2 rounded-full font-bold shadow-lg mb-2"
            >
              Synergy Triggered: {synergy}!
            </motion.div>
          ))}
        </AnimatePresence>
      </div>

      {/* Arena Center */}
      <div className="flex-1 flex justify-between items-end px-16 lg:px-48 pb-12 pt-16">
        {/* Player Sprite */}
        <div className="flex flex-col items-center justify-end h-[28rem] z-10 relative">
          <motion.div
            key={`player-${gameState.playerHp}`}
            className="w-56 h-80 flex items-center justify-center relative z-10"
            animate={{
              y: [0, -5, 0],
              x: gameState.playerHp < (gameState.playerMaxHp) ? [0, -5, 5, -5, 5, 0] : 0
            }}
            transition={{
              y: { repeat: Infinity, duration: 3, ease: "easeInOut" },
              x: { duration: 0.4 }
            }}
          >
            <GameImage prompt={`A character sprite of a heroic protagonist, standing on an empty background, rogue-like main character, 2D vector art, ${runData.theme} theme`} className="w-[120%] h-[120%] object-contain drop-shadow-2xl" alt="Player" type="character" />
          </motion.div>
        </div>

        {/* Enemy Sprite */}
        <div className="flex flex-col items-center justify-end h-[32rem] z-10 w-64 relative">
          <div className="mb-4 flex flex-col items-center z-20">
            {/* Intent & Enemy HP floating above */}
            <div className="bg-slate-900/90 px-4 py-2 rounded-lg border border-slate-700 shadow-lg flex items-center gap-2 mb-3">
              <div className="text-xl">
                {intent.type === 'Attack' ? `⚔️ ${intent.value}` : intent.type === 'Defend' ? `🛡️ ${intent.value}` : `✨`}
              </div>
              {intent.description && <div className="text-xs text-slate-300 ml-1">{intent.description}</div>}
            </div>

            <div className="w-48 h-6 bg-slate-900 rounded border border-slate-700 overflow-hidden relative flex items-center shadow-lg">
              <div
                className="h-full bg-red-500 transition-all duration-300 absolute left-0 top-0"
                style={{ width: `${(gameState.currentEnemy.currentHp / gameState.currentEnemy.maxHp) * 100}%` }}
              />
              <div className="relative w-full text-center text-white font-bold tracking-wider text-xs z-10 drop-shadow-md">
                {gameState.currentEnemy.currentHp}/{gameState.currentEnemy.maxHp}
              </div>
            </div>
            <div className="text-lg font-bold text-white mt-2 drop-shadow-md">
              {gameState.currentEnemy.name}
              {(enemy as Boss).enrageThreshold && (gameState.currentEnemy.currentHp / gameState.currentEnemy.maxHp) * 100 <= (enemy as Boss).enrageThreshold && (
                <span className="ml-2 text-red-500 text-xs uppercase animate-pulse">Enraged!</span>
              )}
            </div>
            <div className="flex gap-2 mt-1">
              {gameState.currentEnemy.statusEffects?.['Block'] > 0 && (
                <div className="text-blue-400 text-sm font-bold bg-slate-800/80 px-2 py-0.5 rounded border border-slate-700">🛡️ {gameState.currentEnemy.statusEffects['Block']}</div>
              )}
              {gameState.currentEnemy.statusEffects?.['Vulnerable'] > 0 && (
                <div className="text-purple-400 text-sm font-bold bg-slate-800/80 px-2 py-0.5 rounded border border-slate-700">💔 {gameState.currentEnemy.statusEffects['Vulnerable']}</div>
              )}
            </div>
          </div>

          <motion.div
            key={`enemy-${enemy.id}-${gameState.currentEnemy.currentHp}`}
            className="w-72 h-80 flex items-center justify-center relative z-10"
            animate={{
              scale: [1, 1.02, 1],
              x: gameState.currentEnemy.currentHp < gameState.currentEnemy.maxHp ? [0, -5, 5, -5, 5, 0] : 0
            }}
            transition={{
              scale: { repeat: Infinity, duration: 2, ease: "easeInOut" },
              x: { duration: 0.4 }
            }}
          >
            {gameState.currentEnemy.imagePrompt ? (
              <GameImage prompt={`A character sprite of ${gameState.currentEnemy.imagePrompt}, standing on an empty background, enemy character, 2D vector art`} className="w-[120%] h-[120%] object-contain drop-shadow-[0_10px_30px_rgba(239,68,68,0.3)]" alt={gameState.currentEnemy.name} type="character" />
            ) : (
              <span className="text-8xl z-10 drop-shadow-lg">{(enemy as Boss).enrageThreshold ? '👑' : '👹'}</span>
            )}
          </motion.div>
        </div>
      </div>

      {/* Bottom Area: Hand & Controls */}
      <div className="mt-auto relative h-64 z-20">
        <div className="absolute bottom-6 right-8 z-50">
          <button
            onClick={handleEndTurn}
            disabled={isGameOver || isVictory}
            className="px-10 py-5 bg-orange-600 hover:bg-orange-500 disabled:bg-slate-700 disabled:text-slate-500 text-white font-bold rounded-xl shadow-[0_0_15px_rgba(234,88,12,0.5)] border-b-4 border-orange-800 disabled:border-slate-800 active:translate-y-1 active:border-b-0 transition-all text-xl"
          >
            End Turn
          </button>
        </div>

        <div className="absolute bottom-6 left-8 z-50 flex items-end gap-6">
          {/* Energy Orb (Simulation) */}
          <div className="w-24 h-24 rounded-full bg-blue-900 border-4 border-slate-400 shadow-[0_0_20px_rgba(59,130,246,0.6)] flex items-center justify-center relative overflow-hidden">
            <div className="absolute inset-0 bg-blue-500/30 animate-pulse" />
            <div className="text-blue-100 font-bold text-3xl drop-shadow-lg relative z-10">
              {gameState.energy}/{gameState.maxEnergy}
            </div>
          </div>

          <div className="flex gap-4 text-slate-300 font-bold">
            <div className="flex flex-col items-center bg-slate-800/80 p-3 rounded-lg border border-slate-700">
              <span className="text-2xl mb-1">🃏</span>
              <span>{gameState.drawPile.length}</span>
            </div>
            <div className="flex flex-col items-center bg-slate-800/80 p-3 rounded-lg border border-slate-700">
              <span className="text-2xl mb-1">🗑️</span>
              <span>{gameState.discardPile.length}</span>
            </div>
          </div>
        </div>

        <HandDisplay
          hand={gameState.hand}
          energy={gameState.energy}
          onPlayCard={handlePlayCard}
        />
      </div>
    </div>
  );
};

