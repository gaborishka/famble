import { Enemy, Intent, Boss } from '../../shared/types/game';

export function getNextIntent(enemy: Enemy | Boss, turn: number): Intent {
  if ('enrageThreshold' in enemy) {
    const boss = enemy as Boss;
    const isEnraged = (boss.currentHp / boss.maxHp) * 100 <= boss.enrageThreshold;
    if (isEnraged && boss.phase2Intents && boss.phase2Intents.length > 0) {
      return boss.phase2Intents[turn % boss.phase2Intents.length];
    }
  }
  return enemy.intents[turn % enemy.intents.length];
}
