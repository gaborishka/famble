import React, { useState, useEffect } from 'react';
import { GameState, Card, Enemy, Boss, RunData } from '../../../shared/types/game';
import { initializeCombat, endTurn } from '../../engine/combatEngine';
import { resolveCard } from '../../engine/cardResolver';
import { checkSynergies } from '../../engine/synergyEngine';
import { HandDisplay } from './HandDisplay';
import { getNextIntent } from '../../engine/enemyAI';
import { motion, AnimatePresence } from 'motion/react';
import { GameImage } from '../GameImage';

const playerVariants = {
  idle: { x: 0, scale: 1, filter: 'brightness(1)' },
  attack: { x: [0, 60, -10, 0], scale: [1, 1.1, 1, 1], filter: 'brightness(1.2)', transition: { duration: 0.4 } },
  hit: { x: [0, -15, 15, -15, 15, 0], filter: ['brightness(1)', 'brightness(2) drop-shadow(0 0 10px red)', 'brightness(1)'], transition: { duration: 0.4 } },
  buff: { filter: ['brightness(1)', 'brightness(1.5) drop-shadow(0 0 15px #3b82f6)', 'brightness(1)'], scale: [1, 1.05, 1], transition: { duration: 0.5 } }
};

const enemyVariants = {
  idle: { x: 0, scale: 1, filter: 'brightness(1)' },
  attack: { x: [0, -60, 10, 0], scale: [1, 1.1, 1, 1], filter: 'brightness(1.2)', transition: { duration: 0.4 } },
  hit: { x: [0, 15, -15, 15, -15, 0], filter: ['brightness(1)', 'brightness(2) drop-shadow(0 0 10px red)', 'brightness(1)'], transition: { duration: 0.4 } },
  buff: { filter: ['brightness(1)', 'brightness(1.5)', 'brightness(1)'], transition: { duration: 0.5 } }
};

interface FloatingText {
  id: number;
  text: string;
  type: 'damage' | 'block' | 'buff' | 'synergy';
  target: 'player' | 'enemy';
  xOffset: number;
  yOffset: number;
}

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
  const [playerAnim, setPlayerAnim] = useState<string>('idle');
  const [enemyAnim, setEnemyAnim] = useState<string>('idle');
  const [floatingTexts, setFloatingTexts] = useState<FloatingText[]>([]);

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

    // Trigger animation based on card type
    if (card.type === 'Attack') {
      setPlayerAnim('attack');
      setTimeout(() => setPlayerAnim('idle'), 400);

      setTimeout(() => {
        setEnemyAnim('hit');
        setTimeout(() => setEnemyAnim('idle'), 400);
      }, 200);
    } else {
      setPlayerAnim('buff');
      setTimeout(() => setPlayerAnim('idle'), 500);
    }

    // Floating text
    const newTexts: FloatingText[] = [];
    if (card.damage) {
      newTexts.push({ id: Date.now(), text: `-${card.damage}`, type: 'damage', target: 'enemy', xOffset: Math.random() * 40 - 20, yOffset: Math.random() * 40 - 20 });
    }
    if (card.block) {
      newTexts.push({ id: Date.now() + 1, text: `+${card.block}`, type: 'block', target: 'player', xOffset: Math.random() * 40 - 20, yOffset: Math.random() * 40 - 20 });
    }

    let newState = resolveCard(card, gameState);

    // Check synergies
    const triggered = checkSynergies(newState, runData.synergies);
    if (triggered.length > 0) {
      setActiveSynergies(triggered.map(s => s.name || s.tag));
      setTimeout(() => setActiveSynergies([]), 2000);

      // Apply synergy effects
      triggered.forEach((synergy, index) => {
        let text = '';
        if (synergy.effect === 'Damage' && newState.currentEnemy) {
          newState.currentEnemy.currentHp = Math.max(0, newState.currentEnemy.currentHp - synergy.value);
          text = `-${synergy.value} (Synergy)`;
          newTexts.push({ id: Date.now() + 10 + index, text, type: 'damage', target: 'enemy', xOffset: Math.random() * 40 - 20, yOffset: Math.random() * 40 - 20 });
        } else if (synergy.effect === 'Block') {
          newState.statusEffects['Block'] = (newState.statusEffects['Block'] || 0) + synergy.value;
          text = `+${synergy.value} Block (Synergy)`;
          newTexts.push({ id: Date.now() + 10 + index, text, type: 'block', target: 'player', xOffset: Math.random() * 40 - 20, yOffset: Math.random() * 40 - 20 });
        } else if (synergy.effect === 'Energy') {
          newState.energy += synergy.value;
          text = `+${synergy.value} Energy (Synergy)`;
          newTexts.push({ id: Date.now() + 10 + index, text, type: 'buff', target: 'player', xOffset: Math.random() * 40 - 20, yOffset: Math.random() * 40 - 20 });
        }
      });

      // Flash player for synergy
      setPlayerAnim('buff');
      setTimeout(() => setPlayerAnim('idle'), 500);
    }

    if (newTexts.length > 0) {
      setFloatingTexts(prev => [...prev, ...newTexts]);
      setTimeout(() => {
        setFloatingTexts(prev => prev.filter(t => !newTexts.find(n => n.id === t.id)));
      }, 1500);
    }

    // Check enemy death
    if (newState.currentEnemy && newState.currentEnemy.currentHp <= 0) {
      setTimeout(() => setIsVictory(true), 500);
      setGameState(newState);
    } else {
      setGameState(newState);
    }
  };

  const handleEndTurn = () => {
    if (isGameOver || isVictory) return;

    const intent = getNextIntent(gameState.currentEnemy!, gameState.turn);
    if (intent && intent.type === 'Attack') {
      setEnemyAnim('attack');
      setTimeout(() => setEnemyAnim('idle'), 400);

      setTimeout(() => {
        setPlayerAnim('hit');
        setTimeout(() => setPlayerAnim('idle'), 400);

        // Show floating text
        let dmg = intent.value;
        if (gameState.statusEffects['Vulnerable']) dmg = Math.floor(dmg * 1.5);

        let actualDmg = dmg;
        let pBlock = gameState.statusEffects['Block'] || 0;
        if (pBlock >= dmg) {
          actualDmg = 0;
        } else {
          actualDmg -= pBlock;
        }

        if (dmg > 0) {
          const newText: FloatingText = { id: Date.now(), text: actualDmg > 0 ? `-${actualDmg}` : 'Blocked!', type: actualDmg > 0 ? 'damage' : 'block', target: 'player', xOffset: Math.random() * 40 - 20, yOffset: Math.random() * 40 - 20 };
          setFloatingTexts(prev => [...prev, newText]);
          setTimeout(() => setFloatingTexts(prev => prev.filter(t => t.id !== newText.id)), 1500);
        }
      }, 200);

      setTimeout(() => {
        const newState = endTurn(gameState);
        if (newState.playerHp <= 0) setIsGameOver(true);
        setGameState(newState);
      }, 400);
    } else {
      setEnemyAnim('buff');
      setTimeout(() => setEnemyAnim('idle'), 400);
      setTimeout(() => {
        const newState = endTurn(gameState);
        if (newState.playerHp <= 0) setIsGameOver(true);
        setGameState(newState);
      }, 400);
    }
  };

  const currentEnemyState = gameState.currentEnemy;
  const intent = getNextIntent(currentEnemyState, gameState.turn);

  return (
    <div className="flex flex-col h-screen bg-[#0a0f1c] text-white overflow-hidden p-8 relative font-sans z-0">
      {/* Dynamic Background */}
      <div className="absolute inset-0 z-[-1]">
        <GameImage
          prompt={`A scenic, atmospheric background for a fantasy battle, ${runData.theme} theme, featuring a very wide and prominent flat floor covering the bottom third of the image, 2D digital art`}
          type="background"
          className="w-full h-full object-cover object-bottom opacity-60 absolute inset-0"
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

      {/* Top HUD */}
      <div className="absolute top-6 left-6 z-50 flex items-center">
        {/* Avatar */}
        <div className="w-14 h-14 rounded-full border-[3px] border-[#334155] bg-slate-800 flex items-center justify-center overflow-hidden z-20 shadow-lg relative">
          <GameImage prompt={`A character portrait of a rogue-like main character, dark hood mask, 2D vector art, close up`} className="w-[120%] h-[120%] object-cover absolute" alt="Player" type="character" />
        </div>

        {/* HP Bar */}
        <div className="w-56 h-7 bg-[#1a2035] rounded-r-md border-y border-r border-[#334155] overflow-hidden relative flex items-center shadow-lg -ml-4 pl-6">
          <div
            className="h-full bg-[#4ade80] transition-all duration-300 absolute left-0 top-0 shadow-[inset_0_-3px_5px_rgba(0,0,0,0.3)]"
            style={{ width: `${(gameState.playerHp / gameState.playerMaxHp) * 100}%` }}
          />
          <div className="relative w-full flex justify-between px-2 text-white font-bold text-sm z-10 drop-shadow-[0_1px_2px_rgba(0,0,0,0.8)]">
            <span>HP</span>
            <span>{gameState.playerHp}/{gameState.playerMaxHp}</span>
          </div>
        </div>

        {/* Block Badge */}
        {gameState.statusEffects['Block'] > 0 || true ? (
          <div className="ml-4 flex items-center justify-center relative w-8 h-10 transform hover:scale-110 transition-transform">
            <div className="absolute inset-0 bg-[#3b82f6] shadow-lg" style={{ clipPath: 'polygon(50% 100%, 0% 80%, 0% 0%, 100% 0%, 100% 80%)' }} />
            <div className="absolute inset-[2px] bg-[#1e40af]" style={{ clipPath: 'polygon(50% 100%, 0% 80%, 0% 0%, 100% 0%, 100% 80%)' }} />
            <span className="relative z-10 text-white font-bold drop-shadow-md text-sm">{gameState.statusEffects['Block'] || 5}</span>
          </div>
        ) : null}
      </div>

      {/* Top Center: BOSS FIGHT */}
      <div className="absolute top-6 left-1/2 -translate-x-1/2 z-50">
        <h2 className="text-[#ea580c] font-bold tracking-[0.2em] drop-shadow-md text-base uppercase">BOSS FIGHT</h2>
      </div>

      {/* Top Right: Gold and Settings */}
      <div className="absolute top-6 right-6 z-50 flex items-center gap-4 text-yellow-400 font-bold drop-shadow-md text-lg">
        <div className="w-6 h-6 bg-gradient-to-br from-yellow-300 to-yellow-600 rounded-full flex items-center justify-center text-yellow-900 text-sm shadow-md">
          $
        </div>
        <span>{runData.gold || 72}</span>
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
      <div className="flex-1 flex justify-between items-end px-16 lg:px-48 pb-4 lg:pb-8 pt-16 relative z-10">
        {/* Player Sprite */}
        <div className="flex flex-col items-center justify-end h-[28rem] z-20 relative w-64">
          {/* Ground Shadow */}
          <div className="absolute -bottom-2 left-1/2 -translate-x-1/2 w-32 h-6 bg-black/60 rounded-[100%] blur-[6px] pointer-events-none z-0" />
          <motion.div
            variants={playerVariants}
            initial="idle"
            animate={playerAnim}
            className="w-full h-80 flex items-center justify-center relative z-10"
          >
            <GameImage prompt={`A character sprite of a heroic protagonist, facing right, looking right, side profile, standing on a solid green background (#00FF00), rogue-like main character, 2D vector art, ${runData.theme} theme`} className="w-full h-full object-contain scale-[1.35] origin-bottom drop-shadow-[0_10px_30px_rgba(0,0,0,0.5)] pointer-events-none" alt="Player" type="character" />

            {/* Player Floating Texts */}
            <AnimatePresence>
              {floatingTexts.filter(t => t.target === 'player').map(text => (
                <motion.div
                  key={text.id}
                  initial={{ opacity: 0, y: 0, x: text.xOffset, scale: 0.5 }}
                  animate={{ opacity: 1, y: -100 - text.yOffset, scale: 1.2 }}
                  exit={{ opacity: 0, scale: 0.8 }}
                  transition={{ duration: 1.5, ease: "easeOut" }}
                  className={`absolute top-1/2 left-1/2 -translate-x-1/2 font-bold text-4xl drop-shadow-[0_4px_4px_rgba(0,0,0,0.8)] z-50 pointer-events-none ${text.type === 'damage' ? 'text-red-500' : text.type === 'block' ? 'text-blue-400' : 'text-green-400'
                    }`}
                >
                  {text.text}
                </motion.div>
              ))}
            </AnimatePresence>
          </motion.div>
        </div>

        {/* Enemy Sprite */}
        <div className="flex flex-col items-center justify-end h-[32rem] z-10 w-64 relative">
          <div className="mb-4 flex flex-col items-center z-20 w-80 relative">
            {/* Intent floating near boss's weapon */}
            <div className="absolute top-8 -left-12 bg-transparent text-white drop-shadow-md flex items-center gap-1 z-30">
              <span className="text-red-500 text-2xl transform rotate-45">🗡️</span>
              <span className="font-bold text-2xl">{intent.value || 18}</span>
            </div>

            <div className="text-3xl font-serif font-bold text-white drop-shadow-[0_2px_4px_rgba(0,0,0,0.8)] mb-2 tracking-wide">
              {gameState.currentEnemy.name}
            </div>

            <div className="w-full h-5 bg-[#1a2035] rounded-sm border-2 border-[#334155] mx-auto overflow-hidden relative shadow-lg">
              <div
                className="h-full bg-[#ef4444] transition-all duration-300 absolute left-0 top-0 shadow-[inset_0_-4px_6px_rgba(0,0,0,0.3)]"
                style={{ width: `${(gameState.currentEnemy.currentHp / gameState.currentEnemy.maxHp) * 100}%` }}
              />
              <div className="relative w-full text-center text-white font-bold text-xs z-10 drop-shadow-[0_1px_2px_rgba(0,0,0,0.8)] leading-5">
                {gameState.currentEnemy.currentHp}/{gameState.currentEnemy.maxHp}
              </div>
            </div>

            {(enemy as Boss).enrageThreshold && (
              <div className="mt-2 flex items-center gap-1 text-sm text-[#f97316] drop-shadow-md font-semibold font-serif">
                <span>🔥</span> Enrage at {(enemy as Boss).enrageThreshold}% HP
              </div>
            )}

            <div className="flex gap-2 mt-2">
              {gameState.currentEnemy.statusEffects?.['Block'] > 0 && (
                <div className="text-blue-400 text-sm font-bold bg-slate-800/80 px-2 py-0.5 rounded shadow-sm">🛡️ {gameState.currentEnemy.statusEffects['Block']}</div>
              )}
              {gameState.currentEnemy.statusEffects?.['Vulnerable'] > 0 && (
                <div className="text-purple-400 text-sm font-bold bg-slate-800/80 px-2 py-0.5 rounded shadow-sm">💔 {gameState.currentEnemy.statusEffects['Vulnerable']}</div>
              )}
            </div>
          </div>

          {/* Ground Shadow */}
          <div className="absolute -bottom-2 left-1/2 -translate-x-1/2 w-40 h-8 bg-black/60 rounded-[100%] blur-[6px] pointer-events-none z-0" />
          <motion.div
            variants={enemyVariants}
            initial="idle"
            animate={enemyAnim}
            className="w-72 h-80 flex items-center justify-center relative z-10"
          >
            {gameState.currentEnemy.imagePrompt ? (
              <GameImage prompt={`A character sprite of ${gameState.currentEnemy.imagePrompt}, facing left, looking left, side profile, standing on a solid green background (#00FF00), enemy character, 2D vector art`} className="w-[120%] h-[120%] object-contain drop-shadow-[0_10px_30px_rgba(239,68,68,0.3)]" alt={gameState.currentEnemy.name} type="character" />
            ) : (
              <span className="text-8xl z-10 drop-shadow-lg">{(enemy as Boss).enrageThreshold ? '👑' : '👹'}</span>
            )}

            {/* Enemy Floating Texts */}
            <AnimatePresence>
              {floatingTexts.filter(t => t.target === 'enemy').map(text => (
                <motion.div
                  key={text.id}
                  initial={{ opacity: 0, y: 0, x: text.xOffset, scale: 0.5 }}
                  animate={{ opacity: 1, y: -100 - text.yOffset, scale: 1.2 }}
                  exit={{ opacity: 0, scale: 0.8 }}
                  transition={{ duration: 1.5, ease: "easeOut" }}
                  className={`absolute top-1/2 left-1/2 -translate-x-1/2 font-bold text-4xl drop-shadow-[0_4px_4px_rgba(0,0,0,0.8)] z-50 pointer-events-none ${text.type === 'damage' ? 'text-red-500' : text.type === 'block' ? 'text-blue-400' : 'text-green-400'
                    }`}
                >
                  {text.text}
                </motion.div>
              ))}
            </AnimatePresence>
          </motion.div>
        </div>
      </div>

      {/* Bottom Area: Hand & Controls */}
      <div className="mt-auto relative h-64 z-20">
        <div className="absolute bottom-6 right-8 z-50 flex items-end gap-6">
          <div className="flex gap-4 mb-2">
            <div className="relative group cursor-pointer hover:-translate-y-1 transition-transform">
              <div className="w-14 h-14 rounded-full bg-[#1e293b] border border-[#334155] shadow-[0_4px_10px_rgba(0,0,0,0.5)] flex items-center justify-center relative overflow-hidden">
                <div className="absolute inset-0 bg-gradient-to-br from-white/5 to-transparent pointer-events-none" />
                <span className="text-2xl text-slate-400 drop-shadow-sm">🎴</span>
              </div>
              <div className="absolute -bottom-1 -right-1 w-6 h-6 rounded-full bg-[#334155] border-2 border-[#0f172a] shadow-lg flex items-center justify-center text-xs font-bold text-white z-10">
                {gameState.drawPile.length || 4}
              </div>
            </div>

            <div className="relative group cursor-pointer hover:-translate-y-1 transition-transform">
              <div className="w-14 h-14 rounded-full bg-[#1e293b] border border-[#334155] shadow-[0_4px_10px_rgba(0,0,0,0.5)] flex items-center justify-center relative overflow-hidden">
                <div className="absolute inset-0 bg-gradient-to-br from-white/5 to-transparent pointer-events-none" />
                <span className="text-2xl text-slate-400 drop-shadow-sm">👑</span>
              </div>
              <div className="absolute -bottom-1 -right-1 w-6 h-6 rounded-full bg-[#334155] border-2 border-[#0f172a] shadow-lg flex items-center justify-center text-xs font-bold text-white z-10">
                {gameState.discardPile.length || 6}
              </div>
            </div>
          </div>

          <button
            onClick={handleEndTurn}
            disabled={isGameOver || isVictory}
            className="px-10 py-4 mb-2 bg-gradient-to-b from-[#f97316] to-[#c2410c] hover:from-[#fb923c] hover:to-[#ea580c] disabled:from-slate-700 disabled:to-slate-800 disabled:text-slate-500 text-white font-bold rounded-lg shadow-[0_5px_15px_rgba(234,88,12,0.4)] border border-[#fdba74]/30 active:translate-y-1 transition-all text-base tracking-widest uppercase overflow-hidden relative"
          >
            <div className="absolute inset-x-0 top-0 h-1/2 bg-white/10 pointer-events-none" />
            End Turn
          </button>
        </div>

        <div className="absolute bottom-6 left-8 z-50 flex flex-col items-start gap-4">
          <div className="flex items-center relative h-28 w-36">
            {/* Background small orb */}
            <div className="absolute left-0 bottom-4 w-16 h-16 rounded-full bg-gradient-to-br from-[#1e40af] to-[#1e3a8a] border-2 border-[#3b82f6]/50 shadow-[inset_0_0_15px_rgba(0,0,0,0.8),0_0_15px_rgba(59,130,246,0.3)] opacity-90" />

            {/* Foreground large orb */}
            <div className="absolute left-8 bottom-0 w-[5.5rem] h-[5.5rem] rounded-full bg-gradient-to-br from-[#60a5fa] via-[#2563eb] to-[#1e3a8a] border-2 border-[#93c5fd] shadow-[0_0_20px_rgba(59,130,246,0.6),inset_0_-8px_20px_rgba(0,0,0,0.6),inset_0_4px_10px_rgba(255,255,255,0.4)] flex flex-col items-center justify-center transform hover:scale-105 transition-transform cursor-pointer">
              <div className="text-white font-bold text-3xl drop-shadow-[0_2px_4px_rgba(0,0,0,0.8)] z-10 font-sans tracking-wider leading-none">
                {gameState.energy}/{gameState.maxEnergy}
              </div>
              {/* 3 dots indicator */}
              <div className="flex gap-2 mt-1 z-10">
                {Array.from({ length: gameState.maxEnergy }).map((_, i) => (
                  <div key={i} className={`w-2 h-2 rounded-full ${i < gameState.energy ? 'bg-white shadow-[0_0_6px_white]' : 'bg-[#0f172a]/80 shadow-[inset_0_1px_2px_rgba(0,0,0,0.8)]'}`} />
                ))}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2 font-bold text-yellow-500 drop-shadow-md text-lg pl-2">
            <div className="w-6 h-6 bg-gradient-to-br from-yellow-300 to-yellow-600 rounded-full flex items-center justify-center text-yellow-900 text-sm shadow-md">
              $
            </div>
            <span>{runData.gold || 72}</span>
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

