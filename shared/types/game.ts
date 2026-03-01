export interface Card {
  id: string;
  name: string;
  cost: number;
  type: 'Attack' | 'Skill' | 'Power';
  description: string;
  damage?: number;
  block?: number;
  magicNumber?: number;
  tags: string[];
  audioPrompt?: string;
  imagePrompt?: string;
  imageObjectId?: string;
  audioObjectId?: string;
  imageUrl?: string;
  audioUrl?: string;
  upgraded?: boolean;
}

export interface Relic {
  id: string;
  name: string;
  description: string;
  effect: 'MaxHP' | 'StartEnergy' | 'StartDraw' | 'StartStrength' | 'CombatHeal';
  value: number;
}

export interface Intent {
  type: 'Attack' | 'Defend' | 'Buff' | 'Debuff' | 'AttackDefend' | 'AttackDebuff' | 'AttackBuff' | 'Unknown';
  value: number;
  secondaryValue?: number;
  description: string;
}

export interface Enemy {
  id: string;
  name: string;
  maxHp: number;
  currentHp: number;
  intents: Intent[];
  description: string;
  isFlying?: boolean;
  audioPrompt?: string;
  imagePrompt?: string;
  imageObjectId?: string;
  audioObjectId?: string;
  imageUrl?: string;
  audioUrl?: string;
  statusEffects?: Record<string, number>;
}

export interface Boss extends Enemy {
  enrageThreshold: number;
  phase2Intents: Intent[];
  narratorText?: string;
  narratorVoiceStyle?: string;
  narratorVoiceGender?: 'male' | 'female' | 'neutral';
  narratorVoiceAccent?: string;
  narratorAudioObjectId?: string;
  narratorAudioUrl?: string;
}

export interface Synergy {
  name?: string;
  tag: string;
  threshold: number;
  effect: 'Damage' | 'Block' | 'Draw' | 'Energy';
  value: number;
  description: string;
}

export interface GameState {
  playerHp: number;
  playerMaxHp: number;
  energy: number;
  maxEnergy: number;
  deck: Card[];
  hand: Card[];
  discardPile: Card[];
  drawPile: Card[];
  exhaustPile: Card[];
  enemies: (Enemy | Boss)[];
  turn: number;
  tagsPlayedThisTurn: Record<string, number>;
  statusEffects: Record<string, number>;
}

export interface CombatDefeatSummary {
  damageDealt: number;
  turns: number;
  enemiesDefeated: number;
  cardsPlayed: number;
  killerName: string;
  finalDeckCount: number;
}

export interface MapNode {
  id: string;
  type: 'Combat' | 'Event' | 'Shop' | 'Treasure' | 'Boss' | 'Elite' | 'Campfire';
  x: number;
  y: number;
  row?: number; // Row index for tree layout (0 = start, max = boss)
  nextNodes: string[];
  completed: boolean;
  data?: any; // e.g. Enemy ID
}

export interface RunState {
  currentNodeId: string | null;
  visitedNodes: string[];
  deck: Card[];
  playerHp: number;
  playerMaxHp: number;
  gold: number;
  relics: Relic[];
}

export interface RunDataLegacy {
  theme: string;
  cards: Card[];
  enemies: Enemy[];
  boss: Boss;
  synergies: Synergy[];
  node_map?: MapNode[];
  roomMusicPrompt?: string;
  bossMusicPrompt?: string;
  gold?: number;
}

export type GenerationMode = 'fast_start' | 'test_on_demand';

export interface GenerationSettings {
  mode: GenerationMode;
  prefetchDepth?: number;
}

export type RoomGenerationStatus = 'queued' | 'generating' | 'ready' | 'failed';

export type GeneratedObjectKind = 'image' | 'audio';
export type GeneratedObjectStatus = 'pending' | 'generating' | 'ready' | 'failed';
export type ImageObjectType = 'asset' | 'background' | 'character';
export type AudioSourceType = 'card' | 'enemy' | 'boss' | 'generic';
export type MusicModeType = 'room' | 'boss';

export interface GeneratedObjectManifestEntry {
  id: string;
  roomId?: string;
  kind: GeneratedObjectKind;
  prompt: string;
  status: GeneratedObjectStatus;
  url?: string;
  error?: string;
  fileKey: string;
  imageType?: ImageObjectType;
  audioSource?: AudioSourceType;
  musicMode?: MusicModeType;
  createdAt: number;
  updatedAt: number;
}

export interface RoomObjectRefs {
  backgroundImageId?: string;
  playerPortraitImageId?: string;
  playerSpriteImageId?: string;
  enemySpriteImageId?: string;
  enemySpriteImageIds?: string[];
  bossSpriteImageId?: string;
  eventImageId?: string;
  cardImageIds?: string[];
  roomMusicId?: string;
  bossMusicId?: string;
  enemySfxId?: string;
  enemySfxIds?: string[];
  bossSfxId?: string;
  bossTtsId?: string;
  cardSfxIds?: string[];
}

export interface RoomObjectUrls {
  backgroundImageUrl?: string;
  playerPortraitImageUrl?: string;
  playerSpriteImageUrl?: string;
  enemySpriteImageUrl?: string;
  enemySpriteImageUrls?: string[];
  bossSpriteImageUrl?: string;
  eventImageUrl?: string;
  cardImageUrls?: string[];
  roomMusicUrl?: string;
  bossMusicUrl?: string;
  enemySfxUrl?: string;
  enemySfxUrls?: string[];
  bossSfxUrl?: string;
  bossTtsUrl?: string;
  cardSfxUrls?: string[];
}

export interface EventChoicePayload {
  id: string;
  label: string;
  description: string;
  icon?: 'fire' | 'shield' | 'gold';
  color?: 'red' | 'blue' | 'orange';
  effects: {
    hpDelta?: number;
    maxHpDelta?: number;
    goldDelta?: number;
    addCard?: Card;
  };
}

export interface BaseRoomContent {
  roomId: string;
  nodeType: MapNode['type'];
  objectRefs?: RoomObjectRefs;
  objectUrls?: RoomObjectUrls;
}

export interface CombatRoomContent extends BaseRoomContent {
  nodeType: 'Combat' | 'Elite';
  enemies: Enemy[];
  rewardCards?: Card[];
  backgroundPrompt?: string;
  roomMusicPrompt?: string;
  backgroundImageUrl?: string;
  roomMusicUrl?: string;
}

export interface BossRoomContent extends BaseRoomContent {
  nodeType: 'Boss';
  boss: Boss;
  backgroundPrompt?: string;
  bossMusicPrompt?: string;
  backgroundImageUrl?: string;
  bossMusicUrl?: string;
}

export interface EventRoomContent extends BaseRoomContent {
  nodeType: 'Event';
  title: string;
  description: string;
  imagePrompt: string;
  imageUrl?: string;
  footerText?: string;
  choices: EventChoicePayload[];
}

export interface ShopRoomContent extends BaseRoomContent {
  nodeType: 'Shop';
  shopCards: Card[];
}

export interface TreasureRoomContent extends BaseRoomContent {
  nodeType: 'Treasure';
  treasureGold?: number;
}

export interface CampfireRoomContent extends BaseRoomContent {
  nodeType: 'Campfire';
}

export type RoomContentPayload =
  | CombatRoomContent
  | BossRoomContent
  | EventRoomContent
  | ShopRoomContent
  | TreasureRoomContent
  | CampfireRoomContent;

export interface RoomGenerationState {
  status: RoomGenerationStatus;
  lastUpdatedAt: number;
  error?: string;
  payload?: RoomContentPayload;
}

export interface RunBootstrapData {
  theme: string;
  starterCards: [Card, Card, Card];
  firstEnemy: Enemy;
  roomMusicPrompt?: string;
  essentialSfxPrompts?: string[];
}

export interface RunDataV2 {
  version: 2;
  generationSettings: GenerationSettings;
  theme: string;
  cards: Card[];
  enemies: Enemy[];
  boss?: Boss;
  synergies: Synergy[];
  node_map: MapNode[];
  roomMusicPrompt?: string;
  bossMusicPrompt?: string;
  objectManifest: Record<string, GeneratedObjectManifestEntry>;
  rooms: Record<string, RoomGenerationState>;
  bootstrap: RunBootstrapData;
  gold?: number;
}

export type RunData = RunDataLegacy | RunDataV2;

export function isRunDataV2(runData: RunData): runData is RunDataV2 {
  return (runData as RunDataV2).version === 2;
}
