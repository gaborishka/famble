import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import {
  isRunDataV2,
} from '../../../shared/types/game';
import type {
  RunData,
  RunDataV2,
  MapNode,
  Card,
  Enemy,
  Boss,
  Relic,
  RoomContentPayload,
  EventRoomContent,
  ShopRoomContent,
  CombatDefeatSummary,
} from '../../../shared/types/game';
import { NodeMap } from '../map/NodeMap';
import { CombatArena, CombatVictorySummary } from '../combat/CombatArena';
import { CardReward } from '../rewards/CardReward';
import { generateFallbackNodeMap } from '../../engine/mapGenerator';
import { EventScreen, EventEffects } from './EventScreen';
import { ShopScreen } from './ShopScreen';
import { CardUpgradeScreen } from './CardUpgradeScreen';
import { PlayerHUD } from './PlayerHUD';
import { GameImage } from '../GameImage';
import { saveRunSnapshot, resolveManifestObjectUrl } from '../../services/geminiService';
import { RoomGenerationOrchestrator } from '../../services/roomGenerationOrchestrator';
import { generateMusic } from '../../services/audioService';
import { DefeatScreen } from './DefeatScreen';
import type { DefeatStats } from './DefeatScreen';
import { VictoryScreen } from './VictoryScreen';
import type { VictoryStats } from './VictoryScreen';

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

type RunView = 'map' | 'combat' | 'reward' | 'event' | 'shop' | 'treasure' | 'campfire' | 'defeat' | 'victory';

export const RunManager: React.FC<RunManagerProps> = ({ runData, onReset }) => {
  const isBasicStarterCard = (card: Card): boolean => {
    const normalized = card.name.trim().toLowerCase();
    return normalized === 'strike' || normalized === 'defend';
  };

  const [activeRunData, setActiveRunData] = useState<RunData>(runData);
  const [nodes, setNodes] = useState<MapNode[]>([]);
  const [currentNodeId, setCurrentNodeId] = useState<string | null>(null);
  const [view, setView] = useState<RunView>('map');
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
  const [currentEnemies, setCurrentEnemies] = useState<(Enemy | Boss)[]>([]);
  const [campfireAction, setCampfireAction] = useState<'choosing' | 'smithing'>('choosing');
  const [rewardCards, setRewardCards] = useState<Card[]>([]);
  const [rewardStats, setRewardStats] = useState<RewardStats | null>(null);
  const [defeatStats, setDefeatStats] = useState<DefeatStats | null>(null);
  const [victoryStats, setVictoryStats] = useState<VictoryStats | null>(null);
  const [runStats, setRunStats] = useState({
    enemiesDefeated: 0,
    damageDealt: 0,
    cardsPlayed: 0,
    turnsTaken: 0,
  });
  const [activeRoomPayload, setActiveRoomPayload] = useState<RoomContentPayload | null>(null);
  const [roomGate, setRoomGate] = useState<{
    node: MapNode | null;
    status: 'loading' | 'failed';
    message: string;
  } | null>(null);
  const runDataRef = useRef<RunDataV2 | null>(null);
  const orchestratorRef = useRef<RoomGenerationOrchestrator | null>(null);
  const ambientMusicRef = useRef<HTMLAudioElement | null>(null);

  const isV2 = useMemo(() => isRunDataV2(activeRunData), [activeRunData]);

  const updateRunDataV2 = useCallback((updater: (prev: RunDataV2) => RunDataV2) => {
    setActiveRunData(prev => {
      if (!isRunDataV2(prev)) return prev;
      const next = updater(prev);
      runDataRef.current = next;
      return next;
    });
  }, []);

  useEffect(() => {
    setActiveRunData(runData);
    setCurrentNodeId(null);
    setView('map');
    setActiveRoomPayload(null);
    setRoomGate(null);
    if (isRunDataV2(runData)) {
      runDataRef.current = runData;
    } else {
      runDataRef.current = null;
    }
  }, [runData]);

  useEffect(() => {
    if (isRunDataV2(activeRunData)) {
      runDataRef.current = activeRunData;
    }

    if (activeRunData.node_map) {
      setNodes(activeRunData.node_map.map(node => ({
        ...node,
        nextNodes: node.nextNodes ?? [],
        completed: node.completed === true,
      })));
    } else {
      setNodes(generateFallbackNodeMap(activeRunData));
    }
  }, [activeRunData.node_map, activeRunData.theme]);

  useEffect(() => {
    setRewardCards([]);
    setRewardStats(null);
  }, [runData]);

  useEffect(() => {
    if (!isRunDataV2(runData)) {
      orchestratorRef.current?.dispose();
      orchestratorRef.current = null;
      return;
    }

    const orchestrator = new RoomGenerationOrchestrator({
      getRunData: () => runDataRef.current || runData,
      setRunData: (updater) => updateRunDataV2(updater),
      maxConcurrent: 2,
    });
    orchestratorRef.current = orchestrator;
    return () => {
      orchestrator.dispose();
      orchestratorRef.current = null;
    };
  }, [runData, updateRunDataV2]);

  useEffect(() => {
    if (!isRunDataV2(activeRunData)) return;
    void saveRunSnapshot(activeRunData);
  }, [activeRunData]);

  const totalFloors = useMemo(() => {
    if (nodes.length === 0) return 1;
    const highestRow = nodes.reduce((maxRow, node) => {
      const row = getNodeRow(node);
      return Math.max(maxRow, row);
    }, 0);
    return highestRow + 1;
  }, [nodes]);

  const currentFloor = useMemo(() => calculateCurrentFloor(nodes, totalFloors), [nodes, totalFloors]);

  const hydrateCardImage = useCallback((card: Card): Card => {
    if (card.imageUrl) return card;
    const resolved = resolveManifestObjectUrl(activeRunData, card.imageObjectId);
    if (!resolved) return card;
    return { ...card, imageUrl: resolved };
  }, [activeRunData]);

  const getRewardSource = (): Card[] => {
    const cards = activeRunData.cards.map(hydrateCardImage);
    const rewardPool = cards.filter(card => !isBasicStarterCard(card));
    return rewardPool.length > 0 ? rewardPool : cards;
  };

  const getRandomRewardCards = (): Card[] => {
    const source = getRewardSource();
    return [...source]
      .sort(() => Math.random() - 0.5)
      .slice(0, Math.min(3, source.length));
  };

  const ensureThreeRewardCards = (cards: Card[]): Card[] => {
    const hydrated: Card[] = cards.slice(0, 3).map(card => hydrateCardImage(card));
    if (hydrated.length >= 3) return hydrated;

    const source: Card[] = getRewardSource();
    if (source.length === 0) return hydrated;

    const fallback: Card[] = [...source].map(card => hydrateCardImage(card));
    let cursor = 0;
    while (hydrated.length < 3) {
      hydrated.push(fallback[cursor % fallback.length]);
      cursor += 1;
    }
    return hydrated;
  };

  const clearRewardState = () => {
    setRewardCards([]);
    setRewardStats(null);
  };

  const stopAmbientMusic = useCallback(() => {
    const audio = ambientMusicRef.current;
    if (!audio) return;
    audio.pause();
    audio.src = '';
    ambientMusicRef.current = null;
  }, []);

  useEffect(() => {
    return () => {
      stopAmbientMusic();
    };
  }, [stopAmbientMusic]);

  const availableCards = useMemo(() => {
    return activeRunData.cards
      .map(hydrateCardImage)
      .filter(c => !isBasicStarterCard(c));
  }, [activeRunData.cards, hydrateCardImage]);

  // ── Node Selection ──

  const getRoomPayload = useCallback((roomId: string | null): RoomContentPayload | undefined => {
    if (!roomId) return undefined;
    const source = runDataRef.current;
    if (!source) return undefined;
    return source.rooms[roomId]?.payload;
  }, [activeRunData]);

  const resolveNodeEnemies = useCallback((node: MapNode, ensuredPayload?: RoomContentPayload): (Enemy | Boss)[] => {
    const payload = ensuredPayload || getRoomPayload(node.id);
    if (payload && (payload.nodeType === 'Combat' || payload.nodeType === 'Elite')) return payload.enemies;
    if (payload && payload.nodeType === 'Boss') return [payload.boss];
    if (node.data) {
      // node.data is now an array of enemies for combat/elite nodes
      if (Array.isArray(node.data)) return node.data;
      return [node.data];
    }
    if (node.type === 'Elite') {
      return [{
        id: 'elite-1',
        name: 'Corrupted Guardian',
        maxHp: 55,
        currentHp: 55,
        description: 'A powerful elite foe.',
        intents: [{ type: 'Attack', value: 12, description: 'Deals 12 damage.' }, { type: 'Defend', value: 10, description: 'Gains 10 block.' }]
      }];
    }
    return [];
  }, [getRoomPayload]);

  const roomHasPendingAssets = useCallback((payload: RoomContentPayload | null | undefined): boolean => {
    if (!payload || !isRunDataV2(activeRunData)) return false;
    const manifest = activeRunData.objectManifest;
    const ids = new Set<string>();
    const add = (id?: string) => {
      if (id) ids.add(id);
    };
    const addMany = (list?: string[]) => {
      list?.forEach(id => add(id));
    };

    add(payload.objectRefs?.backgroundImageId);
    add(payload.objectRefs?.playerPortraitImageId);
    add(payload.objectRefs?.playerSpriteImageId);
    add(payload.objectRefs?.enemySpriteImageId);
    addMany(payload.objectRefs?.enemySpriteImageIds);
    add(payload.objectRefs?.bossSpriteImageId);
    add(payload.objectRefs?.eventImageId);
    addMany(payload.objectRefs?.cardImageIds);
    add(payload.objectRefs?.roomMusicId);
    add(payload.objectRefs?.bossMusicId);
    add(payload.objectRefs?.enemySfxId);
    addMany(payload.objectRefs?.enemySfxIds);
    add(payload.objectRefs?.bossSfxId);
    add(payload.objectRefs?.bossTtsId);
    addMany(payload.objectRefs?.cardSfxIds);

    if (payload.nodeType === 'Combat' || payload.nodeType === 'Elite') {
      payload.enemies.forEach(enemy => {
        add(enemy.imageObjectId);
        add(enemy.audioObjectId);
      });
      (payload.rewardCards || []).forEach(card => {
        add(card.imageObjectId);
        add(card.audioObjectId);
      });
    }
    if (payload.nodeType === 'Boss') {
      add(payload.boss.imageObjectId);
      add(payload.boss.audioObjectId);
      add(payload.boss.narratorAudioObjectId);
    }
    if (payload.nodeType === 'Event') {
      payload.choices.forEach(choice => {
        add(choice.effects?.addCard?.imageObjectId);
        add(choice.effects?.addCard?.audioObjectId);
      });
    }
    if (payload.nodeType === 'Shop') {
      payload.shopCards.forEach(card => {
        add(card.imageObjectId);
        add(card.audioObjectId);
      });
    }

    for (const id of ids) {
      if (manifest[id]?.status !== 'ready') {
        return true;
      }
    }
    return false;
  }, [activeRunData]);

  const ensureNodeReady = useCallback(async (node: MapNode): Promise<RoomContentPayload | null | false> => {
    if (!isRunDataV2(activeRunData)) return null;

    const orchestrator = orchestratorRef.current;
    if (!orchestrator) return null;

    const existingPayload = getRoomPayload(node.id);
    const needsAssets = existingPayload ? roomHasPendingAssets(existingPayload) : true;
    const strictMode = activeRunData.generationSettings.mode === 'test_on_demand';
    const criticalCombatNode = node.type === 'Combat' || node.type === 'Elite' || node.type === 'Boss';
    const shouldGate = needsAssets && (strictMode || criticalCombatNode);

    if (shouldGate) {
      setRoomGate({ node, status: 'loading', message: 'Preparing room assets...' });
    }

    const payload = await orchestrator.ensureRoomReady(node);
    if (payload) {
      setRoomGate(null);
      return payload;
    }

    if (shouldGate) {
      setRoomGate({ node, status: 'failed', message: 'Failed to prepare room assets. Retry to continue.' });
      return false;
    }

    return null;
  }, [activeRunData, getRoomPayload, roomHasPendingAssets]);

  const handleNodeSelect = async (node: MapNode) => {
    const ensuredPayload = await ensureNodeReady(node);
    if (ensuredPayload === false) return;
    const resolvedPayload = ensuredPayload || getRoomPayload(node.id) || null;

    setActiveRoomPayload(resolvedPayload);
    setCurrentNodeId(node.id);
    switch (node.type) {
      case 'Combat':
      case 'Elite':
      case 'Boss':
        setCurrentEnemies(resolveNodeEnemies(node, resolvedPayload || undefined));
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

  const persistNodeCompletionIfV2 = (nodeId: string, completed: boolean) => {
    if (!isRunDataV2(activeRunData)) return;
    updateRunDataV2(prev => ({
      ...prev,
      node_map: prev.node_map.map(node => node.id === nodeId ? { ...node, completed } : node),
    }));
  };

  const markNodeCompleted = () => {
    if (!currentNodeId) return;
    setNodes(prev => prev.map(n => n.id === currentNodeId ? { ...n, completed: true } : n));
    persistNodeCompletionIfV2(currentNodeId, true);
  };

  const returnToMap = () => {
    markNodeCompleted();
    setActiveRoomPayload(null);
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
    if (currentNodeId) {
      persistNodeCompletionIfV2(currentNodeId, true);
    }

    const nextRunStats = {
      enemiesDefeated: runStats.enemiesDefeated + summary.enemiesDefeated,
      damageDealt: runStats.damageDealt + summary.damageDealt,
      cardsPlayed: runStats.cardsPlayed + summary.cardsPlayed,
      turnsTaken: runStats.turnsTaken + summary.turns,
    };
    setRunStats(nextRunStats);

    const bossRoomActive = Boolean((activeRoomPayload || getRoomPayload(currentNodeId))?.nodeType === 'Boss');
    if (bossRoomActive) {
      const boss = (currentEnemies[0] || (isRunDataV2(activeRunData) ? activeRunData.boss : activeRunData.boss)) as Boss;
      const imageUrl = (isRunDataV2(activeRunData) ? activeRunData.boss?.imageUrl : null)
        || boss?.imageUrl
        || resolveManifestObjectUrl(activeRunData, boss?.imageObjectId);

      setVictoryStats({
        floorsCleared: totalFloors,
        enemiesDefeated: nextRunStats.enemiesDefeated,
        bossDefeatedName: boss?.name || 'The Boss',
        totalDamageDealt: nextRunStats.damageDealt,
        cardsPlayed: nextRunStats.cardsPlayed,
        turnsTaken: nextRunStats.turnsTaken,
        finalHp: summary.hp,
        maxHp: summary.maxHp,
        goldEarned: gold, // Not exactly total earned all run, but what they have at end
        finalDeckCount: deck.length,
        bossImageUrl: imageUrl || '',
        runTitle: activeRunData.title || 'Adventure Complete',
        runSubtitle: activeRunData.pdfName || 'Unknown Origin',
      });
      setView('victory');
    } else {
      const nextGold = gold + 25;
      let nextRewardCards = ensureThreeRewardCards(getRandomRewardCards());
      const payload = activeRoomPayload || getRoomPayload(currentNodeId);
      if (payload && (payload.nodeType === 'Combat' || payload.nodeType === 'Elite') && payload.rewardCards && payload.rewardCards.length > 0) {
        nextRewardCards = ensureThreeRewardCards(payload.rewardCards);
      }
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

  const handleCombatDefeat = (summary: CombatDefeatSummary) => {
    setDefeatStats({
      floorsCleared: currentFloor - 1,
      cardsPlayed: runStats.cardsPlayed + summary.cardsPlayed,
      enemiesDefeated: runStats.enemiesDefeated + summary.enemiesDefeated,
      turnsSurvived: runStats.turnsTaken + summary.turns,
      damageDealt: runStats.damageDealt + summary.damageDealt,
      finalDeckCount: summary.finalDeckCount,
      killerName: summary.killerName,
    });
    setView('defeat');
  };

  // ── Reward ──

  const handleCardSelect = (card: Card) => {
    const rewardCard = {
      ...card,
      id: `${card.id}-reward-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    };
    setDeck(prev => [...prev, rewardCard]);
    clearRewardState();
    setActiveRoomPayload(null);
    setView('map');
  };

  const handleSkipReward = () => {
    clearRewardState();
    setActiveRoomPayload(null);
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

  useEffect(() => {
    if (!isRunDataV2(activeRunData)) return;
    if (view !== 'map') return;
    if (!orchestratorRef.current) return;
    const depth = activeRunData.generationSettings.mode === 'fast_start'
      ? Math.max(2, nodes.length)
      : Math.max(1, activeRunData.generationSettings.prefetchDepth ?? 2);
    orchestratorRef.current.prefetchFrom(currentNodeId, nodes, depth);
  }, [activeRunData, currentNodeId, nodes, view]);

  useEffect(() => {
    if (!currentNodeId) return;
    const latestPayload = getRoomPayload(currentNodeId);
    if (latestPayload) {
      setActiveRoomPayload(latestPayload);
    }
  }, [currentNodeId, activeRunData, getRoomPayload]);

  const currentRoomPayload = activeRoomPayload || getRoomPayload(currentNodeId);

  const runAmbientConfig = useMemo((): { url?: string; prompt?: string; objectId?: string } => {
    let prompt = activeRunData.roomMusicPrompt;
    let objectId: string | undefined;
    let resolvedUrl: string | undefined;

    const absorbCombatPayload = (payload: RoomContentPayload | null | undefined) => {
      if (!payload) return;
      if (payload.nodeType !== 'Combat' && payload.nodeType !== 'Elite') return;

      if (!prompt && payload.roomMusicPrompt) {
        prompt = payload.roomMusicPrompt;
      }
      if (!objectId && payload.objectRefs?.roomMusicId) {
        objectId = payload.objectRefs.roomMusicId;
      }

      const payloadUrl = payload.objectUrls?.roomMusicUrl
        || resolveManifestObjectUrl(activeRunData, payload.objectRefs?.roomMusicId);
      if (payloadUrl && !resolvedUrl) {
        resolvedUrl = payloadUrl;
      }
    };

    absorbCombatPayload(currentRoomPayload);

    if (isRunDataV2(activeRunData)) {
      const firstCombatNode = activeRunData.node_map.find(node =>
        (node.row === 0) && (node.type === 'Combat' || node.type === 'Elite')
      ) || activeRunData.node_map.find(node => node.type === 'Combat' || node.type === 'Elite');
      const firstCombatPayload = firstCombatNode
        ? activeRunData.rooms[firstCombatNode.id]?.payload
        : undefined;
      absorbCombatPayload(firstCombatPayload);

      if (!resolvedUrl) {
        for (const roomState of Object.values(activeRunData.rooms)) {
          absorbCombatPayload(roomState.payload);
          if (resolvedUrl) break;
        }
      }
    }

    return { url: resolvedUrl, prompt, objectId };
  }, [activeRunData, currentRoomPayload]);

  const shouldPlayRunAmbient = view !== 'combat';

  useEffect(() => {
    let cancelled = false;

    if (!shouldPlayRunAmbient) {
      stopAmbientMusic();
      return () => {
        cancelled = true;
      };
    }

    const readMusicEnabled = (): boolean => {
      if (typeof window === 'undefined') return true;
      try {
        const saved = window.localStorage.getItem('famble_music_playing');
        return saved !== null ? JSON.parse(saved) : true;
      } catch {
        return true;
      }
    };

    const normalizeUrl = (value: string): string => {
      if (typeof window === 'undefined') return value;
      try {
        return new URL(value, window.location.origin).toString();
      } catch {
        return value;
      }
    };

    const startAmbient = (url: string) => {
      if (cancelled || !url) return;

      const existing = ambientMusicRef.current;
      if (existing) {
        const existingSrc = normalizeUrl(existing.src);
        const nextSrc = normalizeUrl(url);
        if (existingSrc === nextSrc) {
          if (readMusicEnabled()) {
            existing.play().catch(e => console.log('Ambient autoplay prevented', e));
          } else {
            existing.pause();
          }
          return;
        }
      }

      stopAmbientMusic();

      const audio = new Audio(url);
      audio.loop = true;
      audio.volume = 0.16;
      ambientMusicRef.current = audio;

      if (readMusicEnabled()) {
        audio.play().catch(e => console.log('Ambient autoplay prevented', e));
      }
    };

    if (runAmbientConfig.url) {
      startAmbient(runAmbientConfig.url);
    } else if (runAmbientConfig.prompt) {
      generateMusic(runAmbientConfig.prompt, {
        theme: activeRunData.theme,
        mode: 'room',
        cacheTag: runAmbientConfig.objectId,
        fileTag: runAmbientConfig.objectId,
      })
        .then(startAmbient)
        .catch(err => console.error('Failed to start run ambient music:', err));
    } else {
      stopAmbientMusic();
    }

    return () => {
      cancelled = true;
    };
  }, [activeRunData.theme, runAmbientConfig, shouldPlayRunAmbient, stopAmbientMusic]);

  const currentEventPayload: EventRoomContent | null = useMemo(() => {
    if (!currentRoomPayload || currentRoomPayload.nodeType !== 'Event') return null;
    return {
      ...currentRoomPayload,
      choices: currentRoomPayload.choices.map(choice => ({
        ...choice,
        effects: choice.effects?.addCard
          ? { ...choice.effects, addCard: hydrateCardImage(choice.effects.addCard) }
          : choice.effects,
      })),
    };
  }, [currentRoomPayload, hydrateCardImage]);
  const currentShopPayload: ShopRoomContent | null = useMemo(() => {
    if (!currentRoomPayload || currentRoomPayload.nodeType !== 'Shop') return null;
    return {
      ...currentRoomPayload,
      shopCards: currentRoomPayload.shopCards.map(hydrateCardImage),
    };
  }, [currentRoomPayload, hydrateCardImage]);

  const renderWithRoomGate = (content: React.ReactNode) => (
    <>
      {content}
      {roomGate && (
        <div className="fixed inset-0 z-[120] bg-slate-950/85 backdrop-blur-sm flex items-center justify-center px-4">
          <div className="w-full max-w-lg rounded-2xl border border-slate-700 bg-slate-900/95 p-6 text-white">
            <h3 className="text-2xl font-bold mb-2">Room Assets</h3>
            <p className="text-slate-300 mb-5">{roomGate.message}</p>
            {roomGate.status === 'loading' ? (
              <div className="flex items-center gap-3 text-orange-300">
                <span className="h-5 w-5 rounded-full border-2 border-orange-300 border-b-transparent animate-spin" />
                <span>Loading room visuals and audio...</span>
              </div>
            ) : (
              <div className="flex gap-3">
                <button
                  className="px-4 py-2 rounded-lg bg-orange-500 hover:bg-orange-400 text-slate-950 font-semibold"
                  onClick={() => roomGate.node && void ensureNodeReady(roomGate.node)}
                >
                  Retry
                </button>
                <button
                  className="px-4 py-2 rounded-lg bg-slate-700 hover:bg-slate-600"
                  onClick={() => {
                    setRoomGate(null);
                    setView('map');
                  }}
                >
                  Back to Map
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );

  // ── Render ──

  if (view === 'map') {
    return renderWithRoomGate(
      <NodeMap
        nodes={nodes}
        currentNodeId={currentNodeId}
        onNodeSelect={(node) => { void handleNodeSelect(node); }}
        playerHp={playerHp}
        playerMaxHp={playerMaxHp}
        gold={gold}
        bossName={(isRunDataV2(activeRunData) ? activeRunData.boss?.name : activeRunData.boss.name) || 'Boss'}
        totalFloors={totalFloors}
      />
    );
  }

  if (view === 'combat' && currentEnemies.length > 0) {
    return renderWithRoomGate(
      <CombatArena
        runData={activeRunData}
        deck={deck}
        enemies={currentEnemies}
        roomContent={currentRoomPayload || null}
        playerHp={playerHp}
        playerMaxHp={playerMaxHp}
        onVictory={handleCombatVictory}
        onDefeat={handleCombatDefeat}
      />
    );
  }

  if (view === 'reward') {
    const cardsToShow = ensureThreeRewardCards(rewardCards.length > 0 ? rewardCards : getRewardSource().slice(0, 3));
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

    return renderWithRoomGate(
      <CardReward
        cards={cardsToShow}
        onSelect={handleCardSelect}
        onSkip={handleSkipReward}
        stats={statsToShow}
      />
    );
  }

  if (view === 'event') {
    return renderWithRoomGate(
      <EventScreen
        playerHp={playerHp}
        playerMaxHp={playerMaxHp}
        gold={gold}
        currentFloor={currentFloor}
        totalFloors={totalFloors}
        availableCards={availableCards}
        roomEvent={currentEventPayload}
        onComplete={handleEventComplete}
      />
    );
  }

  if (view === 'shop') {
    return renderWithRoomGate(
      <ShopScreen
        playerHp={playerHp}
        playerMaxHp={playerMaxHp}
        gold={gold}
        currentFloor={currentFloor}
        totalFloors={totalFloors}
        deck={deck}
        availableCards={availableCards}
        roomShop={currentShopPayload}
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
                      <path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z" />
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

  if (view === 'defeat' && defeatStats) {
    return (
      <DefeatScreen
        stats={defeatStats}
        onRetry={onReset}
        onNewRun={onReset}
      />
    );
  }

  if (view === 'victory' && victoryStats) {
    return (
      <VictoryScreen
        stats={victoryStats}
        onShare={() => console.log('Share run clicked')}
        onPlayAgain={onReset}
      />
    );
  }

  return null;
};
