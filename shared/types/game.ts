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
  type: 'Attack' | 'Defend' | 'Buff' | 'Debuff';
  value: number;
  description: string;
}

export interface Enemy {
  id: string;
  name: string;
  maxHp: number;
  currentHp: number;
  intents: Intent[];
  description: string;
  audioPrompt?: string;
  imagePrompt?: string;
  statusEffects?: Record<string, number>;
}

export interface Boss extends Enemy {
  enrageThreshold: number;
  phase2Intents: Intent[];
  narratorText?: string;
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
  currentEnemy: Enemy | Boss | null;
  turn: number;
  tagsPlayedThisTurn: Record<string, number>;
  statusEffects: Record<string, number>;
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

export interface RunData {
  theme: string;
  cards: Card[];
  enemies: Enemy[];
  boss: Boss;
  synergies: Synergy[];
  node_map?: MapNode[];
  roomMusicPrompt?: string;
  bossMusicPrompt?: string;
}
