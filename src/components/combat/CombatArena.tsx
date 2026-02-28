import React, { useState, useEffect, useRef } from 'react';
import { GameState, Card, Enemy, Boss, RunData, Intent } from '../../../shared/types/game';
import { initializeCombat, endTurn } from '../../engine/combatEngine';
import { resolveCard } from '../../engine/cardResolver';
import { checkSynergies } from '../../engine/synergyEngine';
import { HandDisplay } from './HandDisplay';
import { getNextIntent } from '../../engine/enemyAI';
import { generateSoundEffect, generateMusic, generateBossTTS } from '../../services/audioService';
import { Volume2, VolumeX } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { GameImage } from '../GameImage';

const ATTACK_INTENT_TYPES = new Set(['Attack', 'AttackDefend', 'AttackDebuff', 'AttackBuff']);
type EnemyAnimState = 'idle' | 'attack' | 'hit' | 'buff' | 'defend' | 'debuff' | 'unknown' | 'death';
const PRIMARY_ENEMY_ANIM_MS = 320;
const SECONDARY_ENEMY_ANIM_MS = 260;
const HEAVY_HIT_THRESHOLD = 15;

interface Particle {
  id: number;
  x: number;
  y: number;
  type: 'hit' | 'block';
  target: 'player' | 'enemy';
}

// Particle burst component for hit sparks and block shields
const ParticleBurst: React.FC<{ particles: Particle[] }> = ({ particles }) => (
  <AnimatePresence>
    {particles.map(p => (
      <motion.div
        key={p.id}
        initial={{ opacity: 1, scale: 0.3, x: p.x, y: p.y }}
        animate={{
          opacity: 0,
          scale: p.type === 'hit' ? 1.5 : 1.2,
          x: p.x + (Math.random() - 0.5) * 120,
          y: p.y + (Math.random() - 0.5) * 120,
        }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.6, ease: 'easeOut' }}
        className="absolute pointer-events-none z-50"
      >
        {p.type === 'hit' ? (
          <div className="w-3 h-3 bg-orange-400 rounded-full shadow-[0_0_8px_rgba(251,146,60,0.8)]" />
        ) : (
          <div className="w-4 h-4 bg-blue-400/80 rounded-sm rotate-45 shadow-[0_0_8px_rgba(96,165,250,0.8)]" />
        )}
      </motion.div>
    ))}
  </AnimatePresence>
);

const breathingTransition = {
  y: { duration: 2.5, ease: 'easeInOut', repeat: Infinity, repeatType: 'reverse' as const },
  scaleY: { duration: 2.5, ease: 'easeInOut', repeat: Infinity, repeatType: 'reverse' as const },
  scaleX: { duration: 2.5, ease: 'easeInOut', repeat: Infinity, repeatType: 'reverse' as const },
};

const playerVariants = {
  idle: {
    x: 0,
    y: [0, -4],
    scaleY: [1, 1.012],
    scaleX: [1, 0.994],
    filter: 'brightness(1)',
    transition: breathingTransition,
  },
  attack: { x: [0, 60, -10, 0], scale: [1, 1.1, 1, 1], filter: 'brightness(1.2)', transition: { duration: 0.4 } },
  hit: { x: [0, -15, 15, -15, 15, 0], filter: ['brightness(1)', 'brightness(2) drop-shadow(0 0 10px red)', 'brightness(1)'], transition: { duration: 0.4 } },
  buff: { filter: ['brightness(1)', 'brightness(1.5) drop-shadow(0 0 15px #3b82f6)', 'brightness(1)'], scale: [1, 1.05, 1], transition: { duration: 0.5 } }
};

const enemyBreathingTransition = {
  y: { duration: 3, ease: 'easeInOut', repeat: Infinity, repeatType: 'reverse' as const },
  scaleY: { duration: 3, ease: 'easeInOut', repeat: Infinity, repeatType: 'reverse' as const },
  scaleX: { duration: 3, ease: 'easeInOut', repeat: Infinity, repeatType: 'reverse' as const },
};

const enemyVariants = {
  idle: {
    x: 0,
    y: [0, -5],
    scaleY: [1, 1.015],
    scaleX: [1, 0.992],
    rotate: [0, -0.5, 0, 0.5, 0],
    filter: 'brightness(1)',
    transition: {
      ...enemyBreathingTransition,
      rotate: { duration: 4, ease: 'easeInOut', repeat: Infinity, repeatType: 'reverse' as const },
    },
  },
  attack: { x: [0, -60, 10, 0], scale: [1, 1.1, 1, 1], filter: 'brightness(1.2)', transition: { duration: 0.4 } },
  hit: { x: [0, 15, -15, 15, -15, 0], filter: ['brightness(1)', 'brightness(2) drop-shadow(0 0 10px red)', 'brightness(1)'], transition: { duration: 0.4 } },
  buff: { filter: ['brightness(1)', 'brightness(1.5)', 'brightness(1)'], scale: [1, 1.06, 1], transition: { duration: 0.45 } },
  defend: { y: [0, -12, 0], scale: [1, 1.08, 1], filter: ['brightness(1)', 'brightness(1.3) drop-shadow(0 0 14px #60a5fa)', 'brightness(1)'], transition: { duration: 0.45 } },
  debuff: { x: [0, -10, 10, -6, 6, 0], rotate: [0, -2, 2, -1, 1, 0], filter: ['brightness(1)', 'brightness(1.25) drop-shadow(0 0 14px #a855f7)', 'brightness(1)'], transition: { duration: 0.5 } },
  unknown: { x: [0, -8, 8, -4, 4, 0], y: [0, -5, 0, -3, 0], rotate: [0, 3, -3, 2, -2, 0], filter: ['brightness(1)', 'brightness(1.2)', 'brightness(1)'], transition: { duration: 0.55 } },
  death: { y: [0, -20, 40], scale: [1, 1.1, 0], opacity: [1, 1, 0], rotate: [0, -5, 15], filter: ['brightness(1)', 'brightness(2)', 'brightness(0.3)'], transition: { duration: 0.8, ease: 'easeIn' } },
};

interface FloatingText {
  id: number;
  text: string;
  type: 'damage' | 'block' | 'buff' | 'synergy';
  target: 'player' | 'enemy';
  xOffset: number;
  yOffset: number;
}

export interface CombatVictorySummary {
  hp: number;
  maxHp: number;
  turns: number;
  damageDealt: number;
}

interface CombatArenaProps {
  runData: RunData;
  deck: Card[];
  enemy: Enemy | Boss;
  playerHp: number;
  playerMaxHp: number;
  onVictory: (summary: CombatVictorySummary) => void;
  onDefeat: () => void;
}

export const CombatArena: React.FC<CombatArenaProps> = ({ runData, deck, enemy, playerHp, playerMaxHp, onVictory, onDefeat }) => {
  const [gameState, setGameState] = useState<GameState | null>(null);
  const [activeSynergies, setActiveSynergies] = useState<string[]>([]);
  const [isGameOver, setIsGameOver] = useState(false);
  const [isVictory, setIsVictory] = useState(false);
  const [playerAnim, setPlayerAnim] = useState<string>('idle');
  const [enemyAnim, setEnemyAnim] = useState<EnemyAnimState>('idle');
  const [floatingTexts, setFloatingTexts] = useState<FloatingText[]>([]);
  const [screenShake, setScreenShake] = useState(false);
  const [particles, setParticles] = useState<Particle[]>([]);
  const [impactFlash, setImpactFlash] = useState<'player' | 'enemy' | null>(null);
  const [enemyHpShake, setEnemyHpShake] = useState(false);
  const [playerHpShake, setPlayerHpShake] = useState(false);
  const [isEnraged, setIsEnraged] = useState(false);
  const [enrageFlash, setEnrageFlash] = useState(false);
  const [totalDamageDealt, setTotalDamageDealt] = useState(0);
  const prevEnemyHpRef = useRef<number | null>(null);
  const prevPlayerHpRef = useRef<number | null>(null);
  const [isMusicPlaying, setIsMusicPlaying] = useState(() => {
    const saved = localStorage.getItem('famble_music_playing');
    return saved !== null ? JSON.parse(saved) : true;
  });
  const isMusicPlayingRef = useRef(isMusicPlaying);
  const bgmRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    isMusicPlayingRef.current = isMusicPlaying;
    localStorage.setItem('famble_music_playing', JSON.stringify(isMusicPlaying));
    if (bgmRef.current) {
      if (isMusicPlaying) {
        bgmRef.current.play().catch(e => console.log('Audio autoplay prevented', e));
      } else {
        bgmRef.current.pause();
      }
    }
  }, [isMusicPlaying]);

  useEffect(() => {
    const state = initializeCombat(deck, enemy);
    state.playerHp = playerHp;
    state.playerMaxHp = playerMaxHp;
    setGameState(state);
    setTotalDamageDealt(0);
  }, [deck, enemy, playerHp, playerMaxHp]);

  useEffect(() => {
    let isCancelled = false;

    // Clean up previous music before starting new
    if (bgmRef.current) {
      bgmRef.current.pause();
      bgmRef.current.src = '';
      bgmRef.current = null;
    }

    // Start background music
    const isBossEncounter = Boolean((enemy as Boss).enrageThreshold);
    const prmpt = isBossEncounter ? runData.bossMusicPrompt : runData.roomMusicPrompt;
    if (prmpt) {
      generateMusic(prmpt, { theme: runData.theme, mode: isBossEncounter ? 'boss' : 'room' }).then(url => {
        if (isCancelled || !url) return;
        const audio = new Audio(url);
        audio.loop = true;
        audio.volume = 0.2; // Lowered volume to make it more ambient
        bgmRef.current = audio;
        if (isMusicPlayingRef.current) {
          audio.play().catch(e => console.log('Audio autoplay prevented', e));
        }
      });
    }

    return () => {
      isCancelled = true;
      if (bgmRef.current) {
        bgmRef.current.pause();
        bgmRef.current.src = '';
      }
    };
  }, [enemy, runData]);

  // Boss TTS Effect
  useEffect(() => {
    const boss = enemy as Boss;
    if (boss.enrageThreshold && boss.narratorText) {
      generateBossTTS(boss.narratorText, {
        theme: runData.theme,
        voiceStyle: boss.narratorVoiceStyle,
        voiceGender: boss.narratorVoiceGender,
        voiceAccent: boss.narratorVoiceAccent,
      }).then(url => {
        if (!url) return;
        const audio = new Audio(url);
        audio.volume = 0.8;
        if (isMusicPlayingRef.current) {
          audio.play().catch(e => console.log('Boss TTS autoplay prevented', e));
        }
      });
    }
  }, [enemy, runData.theme]);

  // Trigger screen shake for heavy hits
  const triggerScreenShake = () => {
    setScreenShake(true);
    setTimeout(() => setScreenShake(false), 400);
  };

  // HP bar shake
  const triggerHpShake = (target: 'player' | 'enemy') => {
    if (target === 'enemy') {
      setEnemyHpShake(true);
      setTimeout(() => setEnemyHpShake(false), 400);
    } else {
      setPlayerHpShake(true);
      setTimeout(() => setPlayerHpShake(false), 400);
    }
  };

  // Enrage detection
  useEffect(() => {
    if (!gameState?.currentEnemy) return;
    const boss = enemy as Boss;
    if (!boss.enrageThreshold) return;
    const hpPercent = (gameState.currentEnemy.currentHp / gameState.currentEnemy.maxHp) * 100;
    if (hpPercent <= boss.enrageThreshold && !isEnraged) {
      setIsEnraged(true);
      setEnrageFlash(true);
      triggerScreenShake();
      setTimeout(() => setEnrageFlash(false), 800);
    }
  }, [gameState?.currentEnemy?.currentHp]);

  // Track HP changes for HP bar shake
  useEffect(() => {
    if (!gameState) return;
    if (prevEnemyHpRef.current !== null && gameState.currentEnemy && gameState.currentEnemy.currentHp < prevEnemyHpRef.current) {
      triggerHpShake('enemy');
    }
    if (prevPlayerHpRef.current !== null && gameState.playerHp < prevPlayerHpRef.current) {
      triggerHpShake('player');
    }
    prevEnemyHpRef.current = gameState.currentEnemy?.currentHp ?? null;
    prevPlayerHpRef.current = gameState.playerHp;
  }, [gameState?.currentEnemy?.currentHp, gameState?.playerHp]);

  if (!gameState || !gameState.currentEnemy) {
    return <div className="text-white">Loading combat...</div>;
  }

  // Spawn particles at a target
  const spawnParticles = (target: 'player' | 'enemy', type: 'hit' | 'block', count = 6) => {
    const newParticles: Particle[] = Array.from({ length: count }, (_, i) => ({
      id: Date.now() + i + Math.random() * 1000,
      x: (Math.random() - 0.5) * 60,
      y: (Math.random() - 0.5) * 60 - 40,
      type,
      target,
    }));
    setParticles(prev => [...prev, ...newParticles]);
    setTimeout(() => setParticles(prev => prev.filter(p => !newParticles.find(n => n.id === p.id))), 700);
  };

  // Flash overlay on hit
  const triggerImpactFlash = (target: 'player' | 'enemy') => {
    setImpactFlash(target);
    setTimeout(() => setImpactFlash(null), 150);
  };

  const createFloatingText = (text: string, type: FloatingText['type'], target: FloatingText['target']) => {
    const id = Date.now() + Math.floor(Math.random() * 1000);
    const newText: FloatingText = {
      id,
      text,
      type,
      target,
      xOffset: Math.random() * 40 - 20,
      yOffset: Math.random() * 40 - 20,
    };
    setFloatingTexts(prev => [...prev, newText]);
    setTimeout(() => setFloatingTexts(prev => prev.filter(t => t.id !== id)), 1500);
  };

  const getEnemyPrimaryAnimation = (intentType: Intent['type']): EnemyAnimState => {
    if (ATTACK_INTENT_TYPES.has(intentType)) return 'attack';
    if (intentType === 'Defend') return 'defend';
    if (intentType === 'Debuff') return 'debuff';
    if (intentType === 'Unknown') return 'unknown';
    return 'buff';
  };

  const getEnemySecondaryAnimation = (intentType: Intent['type']): EnemyAnimState | null => {
    if (intentType === 'AttackDefend') return 'defend';
    if (intentType === 'AttackDebuff') return 'debuff';
    if (intentType === 'AttackBuff') return 'buff';
    return null;
  };

  const showIntentEffectText = (intent: Intent, useSecondaryValue = false) => {
    const effectValue = useSecondaryValue ? (intent.secondaryValue || 0) : intent.value;
    if (effectValue <= 0 && intent.type !== 'Unknown') return;

    switch (intent.type) {
      case 'Defend':
      case 'AttackDefend':
        createFloatingText(`+${effectValue} Block`, 'block', 'enemy');
        break;
      case 'Buff':
      case 'AttackBuff':
        createFloatingText(`+${effectValue} Strength`, 'buff', 'enemy');
        break;
      case 'Debuff':
      case 'AttackDebuff':
        createFloatingText(`+${effectValue} Vulnerable`, 'buff', 'player');
        break;
      case 'Unknown':
        createFloatingText('???', 'synergy', 'enemy');
        break;
      default:
        break;
    }
  };

  const runEnemyIntentAnimation = (primaryAnim: EnemyAnimState, secondaryAnim: EnemyAnimState | null) => {
    setEnemyAnim(primaryAnim);

    if (secondaryAnim) {
      setTimeout(() => setEnemyAnim(secondaryAnim), PRIMARY_ENEMY_ANIM_MS);
      setTimeout(() => setEnemyAnim('idle'), PRIMARY_ENEMY_ANIM_MS + SECONDARY_ENEMY_ANIM_MS);
      return;
    }

    setTimeout(() => setEnemyAnim('idle'), PRIMARY_ENEMY_ANIM_MS);
  };

  const handlePlayCard = (card: Card, index: number) => {
    if (card.cost > gameState.energy || isGameOver) return;

    if (card.audioPrompt) {
      generateSoundEffect(card.audioPrompt, { theme: runData.theme, source: 'card' }).then(url => {
        if (url) new Audio(url).play().catch(e => console.log('Audio autoplay prevented', e));
      });
    }

    // Trigger animation based on card type
    if (card.type === 'Attack') {
      setPlayerAnim('attack');
      setTimeout(() => setPlayerAnim('idle'), 400);

      setTimeout(() => {
        setEnemyAnim('hit');
        triggerImpactFlash('enemy');
        spawnParticles('enemy', 'hit');
        if ((card.damage || 0) >= HEAVY_HIT_THRESHOLD) triggerScreenShake();
        setTimeout(() => setEnemyAnim('idle'), 400);
      }, 200);
    } else {
      setPlayerAnim('buff');
      setTimeout(() => setPlayerAnim('idle'), 500);
      if (card.block) spawnParticles('player', 'block', 4);
    }

    // Floating text
    const newTexts: FloatingText[] = [];
    if (card.damage) {
      newTexts.push({ id: Date.now(), text: `-${card.damage}`, type: 'damage', target: 'enemy', xOffset: Math.random() * 40 - 20, yOffset: Math.random() * 40 - 20 });
    }
    if (card.block) {
      newTexts.push({ id: Date.now() + 1, text: `+${card.block}`, type: 'block', target: 'player', xOffset: Math.random() * 40 - 20, yOffset: Math.random() * 40 - 20 });
    }

    const enemyHpBefore = gameState.currentEnemy.currentHp;
    let newState = resolveCard(card, index, gameState);

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

    const enemyHpAfter = newState.currentEnemy?.currentHp ?? 0;
    const damageDealtThisCard = Math.max(0, enemyHpBefore - enemyHpAfter);
    const nextTotalDamageDealt = totalDamageDealt + damageDealtThisCard;
    if (damageDealtThisCard > 0) {
      setTotalDamageDealt(nextTotalDamageDealt);
    }

    // Check enemy death
    if (newState.currentEnemy && newState.currentEnemy.currentHp <= 0) {
      setEnemyAnim('death');
      triggerScreenShake();
      setTimeout(
        () =>
          onVictory({
            hp: newState.playerHp,
            maxHp: newState.playerMaxHp,
            turns: Math.max(1, gameState.turn),
            damageDealt: nextTotalDamageDealt,
          }),
        1500
      );
      setGameState(newState);
    } else {
      setGameState(newState);
    }
  };

  const handleEndTurn = () => {
    if (isGameOver) return;

    const intent = getNextIntent(gameState.currentEnemy!, gameState.turn);
    const isAttackIntent = ATTACK_INTENT_TYPES.has(intent?.type || '');
    const primaryAnim = getEnemyPrimaryAnimation(intent.type);
    const secondaryAnim = getEnemySecondaryAnimation(intent.type);

    if (intent && isAttackIntent) {
      if (gameState.currentEnemy!.audioPrompt) {
        generateSoundEffect(gameState.currentEnemy!.audioPrompt, {
          theme: runData.theme,
          source: (gameState.currentEnemy as Boss).enrageThreshold ? 'boss' : 'enemy',
        }).then(url => {
          if (url) new Audio(url).play().catch(e => console.log('Audio autoplay prevented', e));
        });
      }

      runEnemyIntentAnimation(primaryAnim, secondaryAnim);

      setTimeout(() => {
        setPlayerAnim('hit');
        triggerImpactFlash('player');
        setTimeout(() => setPlayerAnim('idle'), 400);

        // Show floating text
        let dmg = intent.value;
        if (gameState.currentEnemy!.statusEffects?.['Strength']) {
          dmg += gameState.currentEnemy!.statusEffects['Strength'];
        }
        if (gameState.statusEffects['Vulnerable']) dmg = Math.floor(dmg * 1.5);

        let actualDmg = dmg;
        let pBlock = gameState.statusEffects['Block'] || 0;
        if (pBlock >= dmg) {
          actualDmg = 0;
        } else {
          actualDmg -= pBlock;
        }

        if (dmg > 0) {
          if (actualDmg > 0) {
            spawnParticles('player', 'hit');
            if (actualDmg >= HEAVY_HIT_THRESHOLD) triggerScreenShake();
          } else {
            spawnParticles('player', 'block', 4);
          }
          createFloatingText(actualDmg > 0 ? `-${actualDmg}` : 'Blocked!', actualDmg > 0 ? 'damage' : 'block', 'player');
        }
      }, 200);

      if (secondaryAnim) {
        setTimeout(() => showIntentEffectText(intent, true), PRIMARY_ENEMY_ANIM_MS + 20);
      }

      setTimeout(() => {
        const newState = endTurn(gameState);
        if (newState.playerHp <= 0) setIsGameOver(true);
        setGameState(newState);
      }, secondaryAnim ? PRIMARY_ENEMY_ANIM_MS + SECONDARY_ENEMY_ANIM_MS : 400);
    } else {
      runEnemyIntentAnimation(primaryAnim, secondaryAnim);
      setTimeout(() => showIntentEffectText(intent), 120);
      setTimeout(() => {
        const newState = endTurn(gameState);
        if (newState.playerHp <= 0) setIsGameOver(true);
        setGameState(newState);
      }, secondaryAnim ? PRIMARY_ENEMY_ANIM_MS + SECONDARY_ENEMY_ANIM_MS : 400);
    }
  };

  // Get current intent and define icon helper
  const currentEnemyState = gameState.currentEnemy;
  const intent = getNextIntent(currentEnemyState, gameState.turn);

  const getIntentIcon = (type: string) => {
    switch (type) {
      case 'Attack': return <span className="text-red-500 text-2xl transform rotate-45 drop-shadow-md">🗡️</span>;
      case 'Defend': return <span className="text-blue-500 text-2xl drop-shadow-md">🛡️</span>;
      case 'Buff': return <span className="text-green-500 text-2xl drop-shadow-md">⬆️</span>;
      case 'Debuff': return <span className="text-purple-500 text-2xl drop-shadow-md">☠️</span>;
      case 'AttackDefend': return <span className="text-2xl drop-shadow-md relative inline-block"><span className="text-red-500 transform rotate-45 inline-block">🗡️</span><span className="text-blue-500 text-[10px] absolute -bottom-1 -right-2 bg-slate-900 rounded-full w-4 h-4 flex items-center justify-center">🛡️</span></span>;
      case 'AttackBuff': return <span className="text-2xl drop-shadow-md relative inline-block"><span className="text-red-500 transform rotate-45 inline-block">🗡️</span><span className="text-green-500 text-[10px] absolute -bottom-1 -right-2 bg-slate-900 rounded-full w-4 h-4 flex items-center justify-center">⬆️</span></span>;
      case 'AttackDebuff': return <span className="text-2xl drop-shadow-md relative inline-block"><span className="text-red-500 transform rotate-45 inline-block">🗡️</span><span className="text-purple-500 text-[10px] absolute -bottom-1 -right-2 bg-slate-900 rounded-full w-4 h-4 flex items-center justify-center">☠️</span></span>;
      case 'Unknown':
      default: return <span className="text-gray-400 text-2xl drop-shadow-md">❓</span>;
    }
  };

  const getIntentPrimaryDisplayValue = (type: string, value: number): string => {
    if (type === 'Unknown') return '?';
    if (ATTACK_INTENT_TYPES.has(type)) {
      return String(value + (currentEnemyState.statusEffects?.['Strength'] || 0));
    }
    return String(value);
  };

  return (
    <div className={`flex flex-col h-screen bg-[#0a0f1c] text-white overflow-hidden p-8 relative font-sans z-0 ${screenShake ? 'animate-screen-shake' : ''}`}>
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
      </AnimatePresence>

      {/* Top HUD */}
      <div className="absolute top-6 left-6 z-50 flex items-center">
        {/* Avatar */}
        <div className="w-14 h-14 rounded-full border-[3px] border-[#334155] bg-slate-800 flex items-center justify-center overflow-hidden z-20 shadow-lg relative">
          <GameImage prompt={`A character portrait of a rogue-like main character, dark hood mask, 2D vector art, close up`} className="w-[120%] h-[120%] object-cover absolute" alt="Player" type="character" />
        </div>

        {/* HP Bar */}
        <div className={`w-56 h-7 bg-[#1a2035] rounded-r-md border-y border-r border-[#334155] overflow-hidden relative flex items-center shadow-lg -ml-4 pl-6 ${playerHpShake ? 'animate-hp-shake' : ''}`}>
          <div
            className={`h-full transition-all duration-300 absolute left-0 top-0 shadow-[inset_0_-3px_5px_rgba(0,0,0,0.3)] ${gameState.playerHp / gameState.playerMaxHp < 0.25 ? 'bg-[#ef4444]' : 'bg-[#4ade80]'}`}
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
      {(enemy as Boss).enrageThreshold && (
        <div className="absolute top-6 left-1/2 -translate-x-1/2 z-50">
          <h2 className="text-[#ea580c] font-bold tracking-[0.2em] drop-shadow-md text-base uppercase">BOSS FIGHT</h2>
        </div>
      )}

      {/* Top Right: Gold and Settings */}
      <div className="absolute top-6 right-6 z-50 flex items-center gap-4 text-yellow-400 font-bold drop-shadow-md text-lg">
        <button
          onClick={() => setIsMusicPlaying(!isMusicPlaying)}
          className="w-10 h-10 bg-[#1a2035] rounded-full border-2 border-[#334155] shadow-lg flex items-center justify-center hover:bg-[#334155] transition-colors text-white mr-2"
        >
          {isMusicPlaying ? <Volume2 className="w-5 h-5" /> : <VolumeX className="w-5 h-5 text-slate-500" />}
        </button>
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
      <div className="flex-1 min-h-0 flex justify-between items-end px-16 lg:px-48 pb-4 lg:pb-8 pt-16 relative z-10">
        {/* Player Sprite */}
        <div id="combat-player" className="flex flex-col items-center justify-end h-[28rem] z-20 relative w-64">
          {/* Low HP Pulsation */}
          {gameState.playerHp / gameState.playerMaxHp < 0.25 && (
            <div className="absolute inset-0 rounded-full bg-red-600 blur-[40px] pointer-events-none z-0 animate-low-hp-pulse" />
          )}

          {/* Synergy Aura - glows when any synergy is active */}
          {activeSynergies.length > 0 && (
            <div className="absolute inset-0 rounded-full bg-yellow-400 blur-[50px] pointer-events-none z-0 animate-synergy-aura" />
          )}

          {/* Ground Shadow */}
          <div className={`absolute -bottom-2 left-1/2 -translate-x-1/2 w-32 h-6 bg-black/60 rounded-[100%] blur-[6px] pointer-events-none z-0 ${playerAnim === 'attack' ? 'animate-shadow-attack-player' : 'animate-shadow-breathe-player'}`} />
          <motion.div
            variants={playerVariants}
            initial="idle"
            animate={playerAnim}
            className="w-full h-80 flex items-center justify-center relative z-10"
          >
            <GameImage prompt={`A character sprite of a heroic protagonist, facing right, looking right, side profile, standing on a solid green background (#00FF00), rogue-like main character, 2D vector art, ${runData.theme} theme`} className="w-full h-full object-contain scale-[1.35] origin-bottom drop-shadow-[0_10px_30px_rgba(0,0,0,0.5)] pointer-events-none" alt="Player" type="character" />

            {/* Impact Flash */}
            <AnimatePresence>
              {impactFlash === 'player' && (
                <motion.div
                  initial={{ opacity: 0.8 }}
                  animate={{ opacity: 0 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.15 }}
                  className="absolute inset-0 bg-white/60 rounded-lg pointer-events-none z-40"
                />
              )}
            </AnimatePresence>

            {/* Particles */}
            <ParticleBurst particles={particles.filter(p => p.target === 'player')} />

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
        <div id="combat-enemy" className={`flex flex-col items-center justify-end z-10 relative ${(enemy as Boss).enrageThreshold ? 'h-[52rem] w-[28rem]' : 'h-[32rem] w-64'}`}>
          {/* Enrage Aura */}
          {isEnraged && (
            <div className="absolute inset-0 rounded-full bg-orange-600 blur-[60px] pointer-events-none z-0 animate-enrage-aura" />
          )}

          <div className={`flex flex-col items-center z-50 relative ${(enemy as Boss).enrageThreshold ? 'w-96 mb-[14rem]' : 'w-80 mb-4'}`}>
            {/* Intent floating near boss's weapon */}
            <div className="absolute top-8 left-0 bg-slate-800/90 text-white drop-shadow-md flex items-center gap-2 z-30 px-3 py-1.5 rounded-xl border border-slate-600 shadow-lg">
              {getIntentIcon(intent.type)}
              <div className="flex flex-col ml-1 items-start justify-center">
                <span className="font-bold text-xl leading-none">{getIntentPrimaryDisplayValue(intent.type, intent.value)}</span>
                {intent.secondaryValue ? <span className="text-[10px] text-slate-300 font-bold leading-none mt-1">+{intent.secondaryValue}</span> : null}
              </div>
            </div>

            <div className="text-3xl font-serif font-bold text-white drop-shadow-[0_2px_4px_rgba(0,0,0,0.8)] mb-2 tracking-wide">
              {gameState.currentEnemy.name}
            </div>

            {/* Enemy HP Bar with shake */}
            <div className={`w-full h-5 bg-[#1a2035] rounded-sm border-2 border-[#334155] mx-auto overflow-hidden relative shadow-lg ${enemyHpShake ? 'animate-hp-shake' : ''}`}>
              <div
                className={`h-full transition-all duration-300 absolute left-0 top-0 shadow-[inset_0_-4px_6px_rgba(0,0,0,0.3)] ${isEnraged ? 'bg-[#f97316]' : 'bg-[#ef4444]'}`}
                style={{ width: `${(gameState.currentEnemy.currentHp / gameState.currentEnemy.maxHp) * 100}%` }}
              />
              <div className="relative w-full text-center text-white font-bold text-xs z-10 drop-shadow-[0_1px_2px_rgba(0,0,0,0.8)] leading-5">
                {gameState.currentEnemy.currentHp}/{gameState.currentEnemy.maxHp}
              </div>
            </div>

            {(enemy as Boss).enrageThreshold && (
              <div className={`mt-2 flex items-center gap-1 text-sm drop-shadow-md font-semibold font-serif ${isEnraged ? 'text-red-500' : 'text-[#f97316]'}`}>
                <span>🔥</span> {isEnraged ? 'ENRAGED!' : `Enrage at ${(enemy as Boss).enrageThreshold}% HP`}
              </div>
            )}

            <div className="flex gap-2 mt-2">
              {gameState.currentEnemy.statusEffects?.['Block'] > 0 && (
                <div className="text-blue-400 text-sm font-bold bg-slate-800/80 px-2 py-0.5 rounded shadow-sm">🛡️ {gameState.currentEnemy.statusEffects['Block']}</div>
              )}
              {gameState.currentEnemy.statusEffects?.['Vulnerable'] > 0 && (
                <div className="text-purple-400 text-sm font-bold bg-slate-800/80 px-2 py-0.5 rounded shadow-sm">💔 {gameState.currentEnemy.statusEffects['Vulnerable']}</div>
              )}
              {gameState.currentEnemy.statusEffects?.['Strength'] > 0 && (
                <div className="text-green-400 text-sm font-bold bg-slate-800/80 px-2 py-0.5 rounded shadow-sm">💪 {gameState.currentEnemy.statusEffects['Strength']}</div>
              )}
            </div>
          </div>

          {/* Ground Shadow with attack pulse */}
          <div className={`absolute -bottom-2 left-1/2 -translate-x-1/2 bg-black/60 rounded-[100%] blur-[6px] pointer-events-none z-0 ${(enemy as Boss).enrageThreshold ? 'w-64 h-12' : 'w-40 h-8'} ${enemyAnim === 'attack' ? 'animate-shadow-attack-enemy' : 'animate-shadow-breathe-enemy'}`} />
          <motion.div
            variants={enemyVariants}
            initial="idle"
            animate={enemyAnim}
            className={`flex items-center justify-center relative z-10 ${(enemy as Boss).enrageThreshold ? 'w-96 h-[32rem]' : 'w-72 h-80'}`}
          >
            {gameState.currentEnemy.imagePrompt ? (
              <GameImage prompt={`A character sprite of ${gameState.currentEnemy.imagePrompt}, facing left, looking left, side profile, standing on a solid green background (#00FF00), enemy character, 2D vector art`} className={`w-full h-full object-contain drop-shadow-[0_10px_30px_rgba(239,68,68,0.3)] origin-bottom ${(enemy as Boss).enrageThreshold ? 'scale-[1.4]' : 'scale-[1.2]'}`} alt={gameState.currentEnemy.name} type="character" />
            ) : (
              <span className="text-8xl z-10 drop-shadow-lg">{(enemy as Boss).enrageThreshold ? '👑' : '👹'}</span>
            )}

            {/* Impact Flash */}
            <AnimatePresence>
              {impactFlash === 'enemy' && (
                <motion.div
                  initial={{ opacity: 0.8 }}
                  animate={{ opacity: 0 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.15 }}
                  className="absolute inset-0 bg-white/60 rounded-lg pointer-events-none z-40"
                />
              )}
            </AnimatePresence>

            {/* Particles */}
            <ParticleBurst particles={particles.filter(p => p.target === 'enemy')} />

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
      <div className="mt-auto relative h-64 shrink-0 z-20">
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
            disabled={isGameOver}
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

      {/* Enrage Flash Overlay */}
      <AnimatePresence>
        {enrageFlash && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: [0, 0.6, 0] }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.8 }}
            className="absolute inset-0 bg-orange-500/30 z-[90] pointer-events-none"
          />
        )}
      </AnimatePresence>
    </div>
  );
};
