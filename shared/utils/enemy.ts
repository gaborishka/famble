import type { Enemy } from '../types/game';

export const FLYING_ENEMY_KEYWORDS = /\b(flying|fly|airborne|winged|hover|hovering|levitating|levitation|floating|drone|jetpack|wisp|specter|ghost|bat|harpy|griffin)\b/i;

export function inferEnemyIsFlying(enemy: Partial<Pick<Enemy, 'isFlying' | 'name' | 'description' | 'imagePrompt'>> | undefined): boolean {
  if (!enemy) return false;
  if (typeof enemy.isFlying === 'boolean') return enemy.isFlying;
  const source = `${enemy.name || ''} ${enemy.description || ''} ${enemy.imagePrompt || ''}`;
  return FLYING_ENEMY_KEYWORDS.test(source);
}
