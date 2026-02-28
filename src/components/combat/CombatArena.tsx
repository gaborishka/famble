import React, { useState, useEffect, useRef } from 'react';
import { GameState, Card, Enemy, Boss, RunData, Intent, RoomContentPayload } from '../../../shared/types/game';
import { initializeCombat, endTurn } from '../../engine/combatEngine';
import { resolveCard } from '../../engine/cardResolver';
import { checkSynergies } from '../../engine/synergyEngine';
import { HandDisplay } from './HandDisplay';
import { getNextIntent } from '../../engine/enemyAI';
import { generateSoundEffect, generateMusic, generateBossTTS } from '../../services/audioService';
import { Volume2, VolumeX } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { GameImage } from '../GameImage';
import {
  buildBossSpritePrompt,
  buildDefaultBattleBackgroundPrompt,
  buildEnemySpritePrompt,
  buildPlayerSpritePrompt,
  PLAYER_PORTRAIT_PROMPT,
  resolveManifestObjectUrl,
} from '../../services/geminiService';

const ATTACK_INTENT_TYPES = new Set(['Attack', 'AttackDefend', 'AttackDebuff', 'AttackBuff']);
type EnemyAnimState = 'idle' | 'attack' | 'hit' | 'buff' | 'defend' | 'debuff' | 'unknown' | 'death';
const PRIMARY_ENEMY_ANIM_MS = 320;
const SECONDARY_ENEMY_ANIM_MS = 260;
const HEAVY_HIT_THRESHOLD = 15;
const ENEMY_TURN_STAGGER_MS = 400;

interface Particle {
  id: number;
  x: number;
  y: number;
  type: 'hit' | 'block';
  target: 'player' | 'enemy';
  enemyIndex?: number;
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
  enemyIndex?: number;
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
  enemies: (Enemy | Boss)[];
  roomContent?: RoomContentPayload | null;
  playerHp: number;
  playerMaxHp: number;
  onVictory: (summary: CombatVictorySummary) => void;
  onDefeat: () => void;
}

export const CombatArena: React.FC<CombatArenaProps> = ({ runData, deck, enemies: initialEnemies, roomContent, playerHp, playerMaxHp, onVictory, onDefeat }) => {
  const [gameState, setGameState] = useState<GameState | null>(null);
  const [activeSynergies, setActiveSynergies] = useState<string[]>([]);
  const [isGameOver, setIsGameOver] = useState(false);
  const [isVictory, setIsVictory] = useState(false);
  const [playerAnim, setPlayerAnim] = useState<string>('idle');
  const [enemyAnims, setEnemyAnims] = useState<EnemyAnimState[]>(() => initialEnemies.map(() => 'idle'));
  const [floatingTexts, setFloatingTexts] = useState<FloatingText[]>([]);
  const [screenShake, setScreenShake] = useState(false);
  const [particles, setParticles] = useState<Particle[]>([]);
  const [impactFlash, setImpactFlash] = useState<'player' | number | null>(null); // number = enemy index
  const [enemyHpShakes, setEnemyHpShakes] = useState<boolean[]>(() => initialEnemies.map(() => false));
  const [playerHpShake, setPlayerHpShake] = useState(false);
  const [isEnraged, setIsEnraged] = useState(false);
  const [enrageFlash, setEnrageFlash] = useState(false);
  const [totalDamageDealt, setTotalDamageDealt] = useState(0);
  const [pendingCard, setPendingCard] = useState<{ card: Card; index: number } | null>(null);
  const prevEnemyHpRefs = useRef<(number | null)[]>(initialEnemies.map(() => null));
  const prevPlayerHpRef = useRef<number | null>(null);
  const [isMusicPlaying, setIsMusicPlaying] = useState(() => {
    const saved = localStorage.getItem('famble_music_playing');
    return saved !== null ? JSON.parse(saved) : true;
  });
  const isMusicPlayingRef = useRef(isMusicPlaying);
  const bgmRef = useRef<HTMLAudioElement | null>(null);

  const isBossEncounter = initialEnemies.length === 1 && Boolean((initialEnemies[0] as Boss).enrageThreshold);
  const livingEnemyCount = gameState?.enemies.filter(e => e.currentHp > 0).length ?? 0;
  const firstLivingEnemyIndex = gameState?.enemies.findIndex(e => e.currentHp > 0) ?? 0;

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
    const state = initializeCombat(deck, initialEnemies);
    state.playerHp = playerHp;
    state.playerMaxHp = playerMaxHp;
    setGameState(state);
    setTotalDamageDealt(0);
    setEnemyAnims(initialEnemies.map(() => 'idle'));
    setEnemyHpShakes(initialEnemies.map(() => false));
    prevEnemyHpRefs.current = initialEnemies.map(() => null);
    setPendingCard(null);
  }, [deck, initialEnemies, playerHp, playerMaxHp]);

  useEffect(() => {
    let isCancelled = false;

    if (bgmRef.current) {
      bgmRef.current.pause();
      bgmRef.current.src = '';
      bgmRef.current = null;
    }

    const roomPrompt = roomContent && (roomContent.nodeType === 'Combat' || roomContent.nodeType === 'Elite')
      ? roomContent.roomMusicPrompt
      : undefined;
    const bossPrompt = roomContent && roomContent.nodeType === 'Boss'
      ? roomContent.bossMusicPrompt
      : undefined;
    const roomMusicObjectId = isBossEncounter ? roomContent?.objectRefs?.bossMusicId : roomContent?.objectRefs?.roomMusicId;
    const preloadedMusicUrl = isBossEncounter
      ? (roomContent?.objectUrls?.bossMusicUrl || resolveManifestObjectUrl(runData, roomMusicObjectId))
      : (roomContent?.objectUrls?.roomMusicUrl || resolveManifestObjectUrl(runData, roomMusicObjectId));
    const prompt = isBossEncounter ? (bossPrompt || runData.bossMusicPrompt) : (roomPrompt || runData.roomMusicPrompt);

    const startMusic = (url: string) => {
      if (isCancelled || !url) return;
      const audio = new Audio(url);
      audio.loop = true;
      audio.volume = 0.2;
      bgmRef.current = audio;
      if (isMusicPlayingRef.current) {
        audio.play().catch(e => console.log('Audio autoplay prevented', e));
      }
    };

    if (preloadedMusicUrl) {
      startMusic(preloadedMusicUrl);
    } else if (prompt) {
      generateMusic(prompt, {
        theme: runData.theme,
        mode: isBossEncounter ? 'boss' : 'room',
        cacheTag: roomMusicObjectId,
        fileTag: roomMusicObjectId,
      }).then(startMusic);
    }

    return () => {
      isCancelled = true;
      if (bgmRef.current) {
        bgmRef.current.pause();
        bgmRef.current.src = '';
      }
    };
  }, [initialEnemies, runData, roomContent]);

  // Boss TTS Effect
  useEffect(() => {
    if (!isBossEncounter) return;
    const boss = initialEnemies[0] as Boss;
    if (boss.narratorText) {
      const narratorObjectId = boss.narratorAudioObjectId || roomContent?.objectRefs?.bossTtsId;
      const preloadedNarratorUrl = boss.narratorAudioUrl || roomContent?.objectUrls?.bossTtsUrl || resolveManifestObjectUrl(runData, narratorObjectId);
      const playNarrator = (url: string) => {
        if (!url) return;
        const audio = new Audio(url);
        audio.volume = 0.8;
        if (isMusicPlayingRef.current) {
          audio.play().catch(e => console.log('Boss TTS autoplay prevented', e));
        }
      };

      if (preloadedNarratorUrl) {
        playNarrator(preloadedNarratorUrl);
      } else {
        generateBossTTS(boss.narratorText, {
          theme: runData.theme,
          voiceStyle: boss.narratorVoiceStyle,
          voiceGender: boss.narratorVoiceGender,
          voiceAccent: boss.narratorVoiceAccent,
          cacheTag: narratorObjectId,
          fileTag: narratorObjectId,
        }).then(playNarrator);
      }
    }
  }, [initialEnemies, roomContent, runData]);

  const triggerScreenShake = () => {
    setScreenShake(true);
    setTimeout(() => setScreenShake(false), 400);
  };

  const triggerHpShake = (target: 'player' | number) => {
    if (typeof target === 'number') {
      setEnemyHpShakes(prev => {
        const next = [...prev];
        next[target] = true;
        return next;
      });
      setTimeout(() => setEnemyHpShakes(prev => {
        const next = [...prev];
        next[target] = false;
        return next;
      }), 400);
    } else {
      setPlayerHpShake(true);
      setTimeout(() => setPlayerHpShake(false), 400);
    }
  };

  // Enrage detection (boss only, always index 0)
  useEffect(() => {
    if (!gameState || !isBossEncounter) return;
    const bossState = gameState.enemies[0];
    if (!bossState) return;
    const boss = initialEnemies[0] as Boss;
    const hpPercent = (bossState.currentHp / bossState.maxHp) * 100;
    if (hpPercent <= boss.enrageThreshold && !isEnraged) {
      setIsEnraged(true);
      setEnrageFlash(true);
      triggerScreenShake();
      setTimeout(() => setEnrageFlash(false), 800);
    }
  }, [gameState?.enemies[0]?.currentHp]);

  // Track HP changes for HP bar shake
  useEffect(() => {
    if (!gameState) return;
    gameState.enemies.forEach((enemy, idx) => {
      if (prevEnemyHpRefs.current[idx] !== null && enemy.currentHp < prevEnemyHpRefs.current[idx]!) {
        triggerHpShake(idx);
      }
      prevEnemyHpRefs.current[idx] = enemy.currentHp;
    });
    if (prevPlayerHpRef.current !== null && gameState.playerHp < prevPlayerHpRef.current) {
      triggerHpShake('player');
    }
    prevPlayerHpRef.current = gameState.playerHp;
  }, [gameState?.enemies.map(e => e.currentHp).join(','), gameState?.playerHp]);

  if (!gameState || gameState.enemies.length === 0) {
    return <div className="text-white">Loading combat...</div>;
  }

  const setEnemyAnim = (idx: number, anim: EnemyAnimState) => {
    setEnemyAnims(prev => {
      const next = [...prev];
      next[idx] = anim;
      return next;
    });
  };

  const spawnParticles = (target: 'player' | 'enemy', type: 'hit' | 'block', count = 6, enemyIndex = 0) => {
    const newParticles: Particle[] = Array.from({ length: count }, (_, i) => ({
      id: Date.now() + i + Math.random() * 1000,
      x: (Math.random() - 0.5) * 60,
      y: (Math.random() - 0.5) * 60 - 40,
      type,
      target,
      enemyIndex,
    }));
    setParticles(prev => [...prev, ...newParticles]);
    setTimeout(() => setParticles(prev => prev.filter(p => !newParticles.find(n => n.id === p.id))), 700);
  };

  const triggerImpactFlash = (target: 'player' | number) => {
    setImpactFlash(target);
    setTimeout(() => setImpactFlash(null), 150);
  };

  const createFloatingText = (text: string, type: FloatingText['type'], target: FloatingText['target'], enemyIndex = 0) => {
    const id = Date.now() + Math.floor(Math.random() * 1000);
    const newText: FloatingText = {
      id,
      text,
      type,
      target,
      enemyIndex,
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

  const showIntentEffectText = (intent: Intent, enemyIdx: number, useSecondaryValue = false) => {
    const effectValue = useSecondaryValue ? (intent.secondaryValue || 0) : intent.value;
    if (effectValue <= 0 && intent.type !== 'Unknown') return;

    switch (intent.type) {
      case 'Defend':
      case 'AttackDefend':
        createFloatingText(`+${effectValue} Block`, 'block', 'enemy', enemyIdx);
        break;
      case 'Buff':
      case 'AttackBuff':
        createFloatingText(`+${effectValue} Strength`, 'buff', 'enemy', enemyIdx);
        break;
      case 'Debuff':
      case 'AttackDebuff':
        createFloatingText(`+${effectValue} Vulnerable`, 'buff', 'player');
        break;
      case 'Unknown':
        createFloatingText('???', 'synergy', 'enemy', enemyIdx);
        break;
      default:
        break;
    }
  };

  const executeCard = (card: Card, index: number, targetIdx: number) => {
    if (card.cost > gameState.energy || isGameOver) return;

    const preloadedCardAudio = card.audioUrl || resolveManifestObjectUrl(runData, card.audioObjectId);
    if (preloadedCardAudio) {
      new Audio(preloadedCardAudio).play().catch(e => console.log('Audio autoplay prevented', e));
    } else if (card.audioPrompt) {
      generateSoundEffect(card.audioPrompt, {
        theme: runData.theme,
        source: 'card',
        cacheTag: card.audioObjectId,
        fileTag: card.audioObjectId,
      }).then(url => {
        if (url) new Audio(url).play().catch(e => console.log('Audio autoplay prevented', e));
      });
    }

    if (card.type === 'Attack') {
      setPlayerAnim('attack');
      setTimeout(() => setPlayerAnim('idle'), 400);

      setTimeout(() => {
        setEnemyAnim(targetIdx, 'hit');
        triggerImpactFlash(targetIdx);
        spawnParticles('enemy', 'hit', 6, targetIdx);
        if ((card.damage || 0) >= HEAVY_HIT_THRESHOLD) triggerScreenShake();
        setTimeout(() => setEnemyAnim(targetIdx, 'idle'), 400);
      }, 200);
    } else {
      setPlayerAnim('buff');
      setTimeout(() => setPlayerAnim('idle'), 500);
      if (card.block) spawnParticles('player', 'block', 4);
    }

    const newTexts: FloatingText[] = [];
    if (card.damage) {
      newTexts.push({ id: Date.now(), text: `-${card.damage}`, type: 'damage', target: 'enemy', enemyIndex: targetIdx, xOffset: Math.random() * 40 - 20, yOffset: Math.random() * 40 - 20 });
    }
    if (card.block) {
      newTexts.push({ id: Date.now() + 1, text: `+${card.block}`, type: 'block', target: 'player', xOffset: Math.random() * 40 - 20, yOffset: Math.random() * 40 - 20 });
    }

    const enemyHpBefore = gameState.enemies.reduce((sum, e) => sum + e.currentHp, 0);
    let newState = resolveCard(card, index, gameState, targetIdx);

    // Check synergies
    const triggered = checkSynergies(newState, runData.synergies);
    if (triggered.length > 0) {
      setActiveSynergies(triggered.map(s => s.name || s.tag));
      setTimeout(() => setActiveSynergies([]), 2000);

      triggered.forEach((synergy, sIdx) => {
        if (synergy.effect === 'Damage') {
          const synergyTarget = targetIdx;
          if (newState.enemies[synergyTarget] && newState.enemies[synergyTarget].currentHp > 0) {
            newState.enemies[synergyTarget] = {
              ...newState.enemies[synergyTarget],
              currentHp: Math.max(0, newState.enemies[synergyTarget].currentHp - synergy.value),
            };
          }
          newTexts.push({ id: Date.now() + 10 + sIdx, text: `-${synergy.value} (Synergy)`, type: 'damage', target: 'enemy', enemyIndex: synergyTarget, xOffset: Math.random() * 40 - 20, yOffset: Math.random() * 40 - 20 });
        } else if (synergy.effect === 'Block') {
          newState.statusEffects['Block'] = (newState.statusEffects['Block'] || 0) + synergy.value;
          newTexts.push({ id: Date.now() + 10 + sIdx, text: `+${synergy.value} Block (Synergy)`, type: 'block', target: 'player', xOffset: Math.random() * 40 - 20, yOffset: Math.random() * 40 - 20 });
        } else if (synergy.effect === 'Energy') {
          newState.energy += synergy.value;
          newTexts.push({ id: Date.now() + 10 + sIdx, text: `+${synergy.value} Energy (Synergy)`, type: 'buff', target: 'player', xOffset: Math.random() * 40 - 20, yOffset: Math.random() * 40 - 20 });
        }
      });

      setPlayerAnim('buff');
      setTimeout(() => setPlayerAnim('idle'), 500);
    }

    if (newTexts.length > 0) {
      setFloatingTexts(prev => [...prev, ...newTexts]);
      setTimeout(() => {
        setFloatingTexts(prev => prev.filter(t => !newTexts.find(n => n.id === t.id)));
      }, 1500);
    }

    const enemyHpAfter = newState.enemies.reduce((sum, e) => sum + e.currentHp, 0);
    const damageDealtThisCard = Math.max(0, enemyHpBefore - enemyHpAfter);
    const nextTotalDamageDealt = totalDamageDealt + damageDealtThisCard;
    if (damageDealtThisCard > 0) {
      setTotalDamageDealt(nextTotalDamageDealt);
    }

    // Check if all enemies are dead
    const allDead = newState.enemies.every(e => e.currentHp <= 0);
    if (allDead) {
      newState.enemies.forEach((e, idx) => {
        if (e.currentHp <= 0) setEnemyAnim(idx, 'death');
      });
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
      // Animate any newly dead enemies
      newState.enemies.forEach((e, idx) => {
        if (e.currentHp <= 0 && gameState.enemies[idx]?.currentHp > 0) {
          setEnemyAnim(idx, 'death');
        }
      });
      setGameState(newState);
    }
  };

  const handlePlayCard = (card: Card, index: number) => {
    if (card.cost > gameState.energy || isGameOver) return;

    // Attack cards with >1 living enemy: wait for target selection
    if (card.type === 'Attack' && livingEnemyCount > 1) {
      setPendingCard({ card, index });
      return;
    }

    // Auto-target for attacks (1 enemy) or play immediately for skills/powers
    const target = card.type === 'Attack' ? firstLivingEnemyIndex : firstLivingEnemyIndex;
    executeCard(card, index, target);
  };

  const handleEnemyClick = (enemyIdx: number) => {
    if (!pendingCard) return;
    if (gameState.enemies[enemyIdx].currentHp <= 0) return;
    executeCard(pendingCard.card, pendingCard.index, enemyIdx);
    setPendingCard(null);
  };

  const cancelPendingCard = () => {
    setPendingCard(null);
  };

  const handleEndTurn = () => {
    if (isGameOver) return;
    setPendingCard(null);

    // Staggered enemy animations
    const livingEnemies = gameState.enemies
      .map((enemy, idx) => ({ enemy, idx }))
      .filter(({ enemy }) => enemy.currentHp > 0);

    livingEnemies.forEach(({ enemy, idx: enemyIdx }, seqIdx) => {
      const intent = getNextIntent(enemy, gameState.turn);
      const isAttackIntent = ATTACK_INTENT_TYPES.has(intent?.type || '');
      const primaryAnim = getEnemyPrimaryAnimation(intent.type);
      const secondaryAnim = getEnemySecondaryAnimation(intent.type);
      const delay = seqIdx * ENEMY_TURN_STAGGER_MS;

      setTimeout(() => {
        if (isAttackIntent) {
          const preloadedEnemyAudio = enemy.audioUrl || resolveManifestObjectUrl(runData, enemy.audioObjectId);
          if (preloadedEnemyAudio) {
            new Audio(preloadedEnemyAudio).play().catch(e => console.log('Audio autoplay prevented', e));
          } else if (enemy.audioPrompt) {
            generateSoundEffect(enemy.audioPrompt, {
              theme: runData.theme,
              source: (enemy as Boss).enrageThreshold ? 'boss' : 'enemy',
              cacheTag: enemy.audioObjectId,
              fileTag: enemy.audioObjectId,
            }).then(url => {
              if (url) new Audio(url).play().catch(e => console.log('Audio autoplay prevented', e));
            });
          }

          setEnemyAnim(enemyIdx, primaryAnim);
          if (secondaryAnim) {
            setTimeout(() => setEnemyAnim(enemyIdx, secondaryAnim), PRIMARY_ENEMY_ANIM_MS);
            setTimeout(() => setEnemyAnim(enemyIdx, 'idle'), PRIMARY_ENEMY_ANIM_MS + SECONDARY_ENEMY_ANIM_MS);
          } else {
            setTimeout(() => setEnemyAnim(enemyIdx, 'idle'), PRIMARY_ENEMY_ANIM_MS);
          }

          setTimeout(() => {
            setPlayerAnim('hit');
            triggerImpactFlash('player');
            setTimeout(() => setPlayerAnim('idle'), 400);

            let dmg = intent.value;
            if (enemy.statusEffects?.['Strength']) dmg += enemy.statusEffects['Strength'];
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
            setTimeout(() => showIntentEffectText(intent, enemyIdx, true), PRIMARY_ENEMY_ANIM_MS + 20);
          }
        } else {
          setEnemyAnim(enemyIdx, primaryAnim);
          if (secondaryAnim) {
            setTimeout(() => setEnemyAnim(enemyIdx, secondaryAnim), PRIMARY_ENEMY_ANIM_MS);
            setTimeout(() => setEnemyAnim(enemyIdx, 'idle'), PRIMARY_ENEMY_ANIM_MS + SECONDARY_ENEMY_ANIM_MS);
          } else {
            setTimeout(() => setEnemyAnim(enemyIdx, 'idle'), PRIMARY_ENEMY_ANIM_MS);
          }
          setTimeout(() => showIntentEffectText(intent, enemyIdx), 120);
        }
      }, delay);
    });

    // Resolve actual state after all animations
    const totalAnimTime = livingEnemies.length * ENEMY_TURN_STAGGER_MS + PRIMARY_ENEMY_ANIM_MS + SECONDARY_ENEMY_ANIM_MS;
    setTimeout(() => {
      const newState = endTurn(gameState);
      if (newState.playerHp <= 0) setIsGameOver(true);
      setGameState(newState);
    }, totalAnimTime);
  };

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

  const getIntentPrimaryDisplayValue = (enemyState: Enemy | Boss, type: string, value: number): string => {
    if (type === 'Unknown') return '?';
    if (ATTACK_INTENT_TYPES.has(type)) {
      return String(value + (enemyState.statusEffects?.['Strength'] || 0));
    }
    return String(value);
  };

  const roomRefs = roomContent?.objectRefs;
  const roomUrls = roomContent?.objectUrls;
  const roomHasBackground = roomContent && (roomContent.nodeType === 'Combat' || roomContent.nodeType === 'Elite' || roomContent.nodeType === 'Boss');
  const backgroundPrompt = roomHasBackground && roomContent.backgroundPrompt
    ? roomContent.backgroundPrompt
    : buildDefaultBattleBackgroundPrompt(runData.theme);
  const backgroundObjectId = roomRefs?.backgroundImageId;
  const backgroundSrc = (roomHasBackground ? roomContent.backgroundImageUrl : undefined)
    || roomUrls?.backgroundImageUrl
    || resolveManifestObjectUrl(runData, backgroundObjectId);

  const playerPortraitObjectId = roomRefs?.playerPortraitImageId;
  const playerPortraitSrc = roomUrls?.playerPortraitImageUrl || resolveManifestObjectUrl(runData, playerPortraitObjectId);
  const playerSpriteObjectId = roomRefs?.playerSpriteImageId;
  const playerSpritePrompt = buildPlayerSpritePrompt(runData.theme);
  const playerSpriteSrc = roomUrls?.playerSpriteImageUrl || resolveManifestObjectUrl(runData, playerSpriteObjectId);

  return (
    <div className={`flex flex-col h-screen bg-[#0a0f1c] text-white overflow-hidden p-8 relative font-sans z-0 ${screenShake ? 'animate-screen-shake' : ''}`}>
      {/* Dynamic Background */}
      <div className="absolute inset-0 z-[-1]">
        <GameImage
          src={backgroundSrc}
          prompt={backgroundPrompt}
          fileKey={backgroundObjectId}
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
            <p className="text-xl text-slate-300 mb-8">You have been defeated.</p>
            <button
              onClick={onDefeat}
              className="px-8 py-4 bg-red-600 hover:bg-red-500 text-white font-bold rounded-xl shadow-lg transition-colors"
            >
              End Run
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Pending card targeting overlay */}
      {pendingCard && (
        <div className="absolute inset-0 z-[80] pointer-events-none">
          <div className="absolute top-24 left-1/2 -translate-x-1/2 bg-orange-600/90 text-white px-6 py-2 rounded-full font-bold shadow-lg pointer-events-auto cursor-pointer" onClick={cancelPendingCard}>
            Click an enemy to target — or click here to cancel
          </div>
        </div>
      )}

      {/* Top HUD */}
      <div className="absolute top-6 left-6 z-50 flex items-center">
        <div className="w-14 h-14 rounded-full border-[3px] border-[#334155] bg-slate-800 flex items-center justify-center overflow-hidden z-20 shadow-lg relative">
          <GameImage
            src={playerPortraitSrc}
            prompt={PLAYER_PORTRAIT_PROMPT}
            fileKey={playerPortraitObjectId}
            className="w-[120%] h-[120%] object-cover absolute"
            alt="Player"
            type="character"
          />
        </div>
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
        {gameState.statusEffects['Block'] > 0 || true ? (
          <div className="ml-4 flex items-center justify-center relative w-8 h-10 transform hover:scale-110 transition-transform">
            <div className="absolute inset-0 bg-[#3b82f6] shadow-lg" style={{ clipPath: 'polygon(50% 100%, 0% 80%, 0% 0%, 100% 0%, 100% 80%)' }} />
            <div className="absolute inset-[2px] bg-[#1e40af]" style={{ clipPath: 'polygon(50% 100%, 0% 80%, 0% 0%, 100% 0%, 100% 80%)' }} />
            <span className="relative z-10 text-white font-bold drop-shadow-md text-sm">{gameState.statusEffects['Block'] || 5}</span>
          </div>
        ) : null}
      </div>

      {/* Top Center: BOSS FIGHT */}
      {isBossEncounter && (
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
          {gameState.playerHp / gameState.playerMaxHp < 0.25 && (
            <div className="absolute inset-0 rounded-full bg-red-600 blur-[40px] pointer-events-none z-0 animate-low-hp-pulse" />
          )}
          {activeSynergies.length > 0 && (
            <div className="absolute inset-0 rounded-full bg-yellow-400 blur-[50px] pointer-events-none z-0 animate-synergy-aura" />
          )}
          <div className={`absolute -bottom-2 left-1/2 -translate-x-1/2 w-32 h-6 bg-black/60 rounded-[100%] blur-[6px] pointer-events-none z-0 ${playerAnim === 'attack' ? 'animate-shadow-attack-player' : 'animate-shadow-breathe-player'}`} />
          <motion.div
            variants={playerVariants}
            initial="idle"
            animate={playerAnim}
            className="w-full h-80 flex items-center justify-center relative z-10"
          >
            <GameImage
              src={playerSpriteSrc}
              prompt={playerSpritePrompt}
              fileKey={playerSpriteObjectId}
              className="w-full h-full object-contain scale-[1.35] origin-bottom drop-shadow-[0_10px_30px_rgba(0,0,0,0.5)] pointer-events-none"
              alt="Player"
              type="character"
            />
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
            <ParticleBurst particles={particles.filter(p => p.target === 'player')} />
            <AnimatePresence>
              {floatingTexts.filter(t => t.target === 'player').map(text => (
                <motion.div
                  key={text.id}
                  initial={{ opacity: 0, y: 0, x: text.xOffset, scale: 0.5 }}
                  animate={{ opacity: 1, y: -100 - text.yOffset, scale: 1.2 }}
                  exit={{ opacity: 0, scale: 0.8 }}
                  transition={{ duration: 1.5, ease: "easeOut" }}
                  className={`absolute top-1/2 left-1/2 -translate-x-1/2 font-bold text-4xl drop-shadow-[0_4px_4px_rgba(0,0,0,0.8)] z-50 pointer-events-none ${text.type === 'damage' ? 'text-red-500' : text.type === 'block' ? 'text-blue-400' : 'text-green-400'}`}
                >
                  {text.text}
                </motion.div>
              ))}
            </AnimatePresence>
          </motion.div>
        </div>

        {/* Enemy Sprites */}
        <div className={`flex ${isBossEncounter ? 'flex-col items-center' : 'flex-col gap-4 items-center'} justify-end z-10`}>
          {gameState.enemies.map((enemyState, idx) => {
            const isBoss = isBossEncounter && idx === 0;
            const isDead = enemyState.currentHp <= 0;
            const intent = getNextIntent(enemyState, gameState.turn);
            const isTargetable = !!pendingCard && !isDead;
            const enemyImageObjectId = isBoss
              ? (enemyState.imageObjectId || roomRefs?.bossSpriteImageId)
              : (enemyState.imageObjectId || roomRefs?.enemySpriteImageIds?.[idx] || roomRefs?.enemySpriteImageId);
            const enemyImageSrc = enemyState.imageUrl
              || (isBoss
                ? roomUrls?.bossSpriteImageUrl
                : (roomUrls?.enemySpriteImageUrls?.[idx] || roomUrls?.enemySpriteImageUrl))
              || resolveManifestObjectUrl(runData, enemyImageObjectId);
            const enemyImagePrompt = enemyState.imagePrompt
              ? (isBoss ? buildBossSpritePrompt(enemyState.imagePrompt) : buildEnemySpritePrompt(enemyState.imagePrompt))
              : undefined;

            return (
              <div
                key={enemyState.id}
                id={`combat-enemy-${idx}`}
                className={`flex flex-col items-center justify-end relative transition-all duration-300
                  ${isBoss ? 'h-[52rem] w-[28rem]' : 'h-[28rem] w-56'}
                  ${isDead ? 'opacity-0 pointer-events-none' : ''}
                  ${isTargetable ? 'cursor-pointer' : ''}
                `}
                onClick={() => isTargetable && handleEnemyClick(idx)}
              >
                {/* Targetable glow */}
                {isTargetable && (
                  <div className="absolute inset-0 rounded-2xl ring-2 ring-orange-500 animate-pulse pointer-events-none z-40" />
                )}

                {/* Enrage Aura (boss only) */}
                {isBoss && isEnraged && (
                  <div className="absolute inset-0 rounded-full bg-orange-600 blur-[60px] pointer-events-none z-0 animate-enrage-aura" />
                )}

                <div className={`flex flex-col items-center z-50 relative ${isBoss ? 'w-96 mb-[14rem]' : 'w-52 mb-4'}`}>
                  {/* Intent badge */}
                  {!isDead && (
                    <div className="absolute top-8 left-0 bg-slate-800/90 text-white drop-shadow-md flex items-center gap-2 z-30 px-3 py-1.5 rounded-xl border border-slate-600 shadow-lg">
                      {getIntentIcon(intent.type)}
                      <div className="flex flex-col ml-1 items-start justify-center">
                        <span className="font-bold text-xl leading-none">{getIntentPrimaryDisplayValue(enemyState, intent.type, intent.value)}</span>
                        {intent.secondaryValue ? <span className="text-[10px] text-slate-300 font-bold leading-none mt-1">+{intent.secondaryValue}</span> : null}
                      </div>
                    </div>
                  )}

                  <div className={`font-serif font-bold text-white drop-shadow-[0_2px_4px_rgba(0,0,0,0.8)] mb-2 tracking-wide ${isBoss ? 'text-3xl' : 'text-xl'}`}>
                    {enemyState.name}
                  </div>

                  {/* HP Bar */}
                  <div className={`w-full h-5 bg-[#1a2035] rounded-sm border-2 border-[#334155] mx-auto overflow-hidden relative shadow-lg ${enemyHpShakes[idx] ? 'animate-hp-shake' : ''}`}>
                    <div
                      className={`h-full transition-all duration-300 absolute left-0 top-0 shadow-[inset_0_-4px_6px_rgba(0,0,0,0.3)] ${isBoss && isEnraged ? 'bg-[#f97316]' : 'bg-[#ef4444]'}`}
                      style={{ width: `${(enemyState.currentHp / enemyState.maxHp) * 100}%` }}
                    />
                    <div className="relative w-full text-center text-white font-bold text-xs z-10 drop-shadow-[0_1px_2px_rgba(0,0,0,0.8)] leading-5">
                      {enemyState.currentHp}/{enemyState.maxHp}
                    </div>
                  </div>

                  {isBoss && (initialEnemies[0] as Boss).enrageThreshold && (
                    <div className={`mt-2 flex items-center gap-1 text-sm drop-shadow-md font-semibold font-serif ${isEnraged ? 'text-red-500' : 'text-[#f97316]'}`}>
                      <span>🔥</span> {isEnraged ? 'ENRAGED!' : `Enrage at ${(initialEnemies[0] as Boss).enrageThreshold}% HP`}
                    </div>
                  )}

                  <div className="flex gap-2 mt-2">
                    {enemyState.statusEffects?.['Block'] > 0 && (
                      <div className="text-blue-400 text-sm font-bold bg-slate-800/80 px-2 py-0.5 rounded shadow-sm">🛡️ {enemyState.statusEffects['Block']}</div>
                    )}
                    {enemyState.statusEffects?.['Vulnerable'] > 0 && (
                      <div className="text-purple-400 text-sm font-bold bg-slate-800/80 px-2 py-0.5 rounded shadow-sm">💔 {enemyState.statusEffects['Vulnerable']}</div>
                    )}
                    {enemyState.statusEffects?.['Strength'] > 0 && (
                      <div className="text-green-400 text-sm font-bold bg-slate-800/80 px-2 py-0.5 rounded shadow-sm">💪 {enemyState.statusEffects['Strength']}</div>
                    )}
                  </div>
                </div>

                {/* Ground Shadow */}
                <div className={`absolute -bottom-2 left-1/2 -translate-x-1/2 bg-black/60 rounded-[100%] blur-[6px] pointer-events-none z-0 ${isBoss ? 'w-64 h-12' : 'w-40 h-8'} ${enemyAnims[idx] === 'attack' ? 'animate-shadow-attack-enemy' : 'animate-shadow-breathe-enemy'}`} />
                <motion.div
                  variants={enemyVariants}
                  initial="idle"
                  animate={enemyAnims[idx] || 'idle'}
                  className={`flex items-center justify-center relative z-10 ${isBoss ? 'w-96 h-[32rem]' : 'w-48 h-56'}`}
                >
                  {(enemyState.imagePrompt || enemyImageSrc) ? (
                    <GameImage
                      src={enemyImageSrc}
                      prompt={enemyImagePrompt}
                      fileKey={enemyImageObjectId}
                      className={`w-full h-full object-contain drop-shadow-[0_10px_30px_rgba(239,68,68,0.3)] origin-bottom ${isBoss ? 'scale-[1.4]' : 'scale-[1.2]'}`}
                      alt={enemyState.name}
                      type="character"
                    />
                  ) : (
                    <span className="text-8xl z-10 drop-shadow-lg">{isBoss ? '👑' : '👹'}</span>
                  )}

                  {/* Impact Flash */}
                  <AnimatePresence>
                    {impactFlash === idx && (
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
                  <ParticleBurst particles={particles.filter(p => p.target === 'enemy' && (p.enemyIndex ?? 0) === idx)} />

                  {/* Floating Texts */}
                  <AnimatePresence>
                    {floatingTexts.filter(t => t.target === 'enemy' && (t.enemyIndex ?? 0) === idx).map(text => (
                      <motion.div
                        key={text.id}
                        initial={{ opacity: 0, y: 0, x: text.xOffset, scale: 0.5 }}
                        animate={{ opacity: 1, y: -100 - text.yOffset, scale: 1.2 }}
                        exit={{ opacity: 0, scale: 0.8 }}
                        transition={{ duration: 1.5, ease: "easeOut" }}
                        className={`absolute top-1/2 left-1/2 -translate-x-1/2 font-bold text-4xl drop-shadow-[0_4px_4px_rgba(0,0,0,0.8)] z-50 pointer-events-none ${text.type === 'damage' ? 'text-red-500' : text.type === 'block' ? 'text-blue-400' : 'text-green-400'}`}
                      >
                        {text.text}
                      </motion.div>
                    ))}
                  </AnimatePresence>
                </motion.div>
              </div>
            );
          })}
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
            <div className="absolute left-0 bottom-4 w-16 h-16 rounded-full bg-gradient-to-br from-[#1e40af] to-[#1e3a8a] border-2 border-[#3b82f6]/50 shadow-[inset_0_0_15px_rgba(0,0,0,0.8),0_0_15px_rgba(59,130,246,0.3)] opacity-90" />
            <div className="absolute left-8 bottom-0 w-[5.5rem] h-[5.5rem] rounded-full bg-gradient-to-br from-[#60a5fa] via-[#2563eb] to-[#1e3a8a] border-2 border-[#93c5fd] shadow-[0_0_20px_rgba(59,130,246,0.6),inset_0_-8px_20px_rgba(0,0,0,0.6),inset_0_4px_10px_rgba(255,255,255,0.4)] flex flex-col items-center justify-center transform hover:scale-105 transition-transform cursor-pointer">
              <div className="text-white font-bold text-3xl drop-shadow-[0_2px_4px_rgba(0,0,0,0.8)] z-10 font-sans tracking-wider leading-none">
                {gameState.energy}/{gameState.maxEnergy}
              </div>
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
          targetEnemyIndex={pendingCard ? undefined : firstLivingEnemyIndex}
          multipleEnemies={livingEnemyCount > 1}
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
