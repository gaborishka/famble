import { Card, GameState, Enemy, Boss } from '../../shared/types/game';
import { drawCards } from './deckManager';

export function resolveCard(card: Card, index: number, state: GameState, targetIndex?: number): GameState {
  const newState = { ...state, enemies: state.enemies.map(e => ({ ...e })) };

  if (card.cost > newState.energy) {
    return state; // Cannot play
  }

  newState.energy -= card.cost;

  // Track tags
  for (const tag of card.tags) {
    newState.tagsPlayedThisTurn[tag] = (newState.tagsPlayedThisTurn[tag] || 0) + 1;
  }

  if (card.block) {
    newState.statusEffects['Block'] = (newState.statusEffects['Block'] || 0) + card.block;
  }

  // Resolve target: use provided index, or auto-target first living enemy
  const resolvedTarget = targetIndex ?? newState.enemies.findIndex(e => e.currentHp > 0);
  const targetEnemy = resolvedTarget >= 0 ? newState.enemies[resolvedTarget] : null;

  if (card.damage && targetEnemy && targetEnemy.currentHp > 0) {
    let dmg = card.damage;
    if (targetEnemy.statusEffects && targetEnemy.statusEffects['Vulnerable']) {
      dmg = Math.floor(dmg * 1.5);
    }

    // Simple damage to enemy
    let enemyBlock = targetEnemy.statusEffects?.['Block'] || 0;
    if (enemyBlock >= dmg) {
      enemyBlock -= dmg;
      dmg = 0;
    } else {
      dmg -= enemyBlock;
      enemyBlock = 0;
    }

    newState.enemies[resolvedTarget] = {
      ...targetEnemy,
      currentHp: Math.max(0, targetEnemy.currentHp - dmg),
      statusEffects: {
        ...(targetEnemy.statusEffects || {}),
        'Block': enemyBlock
      }
    };
  }

  if (card.magicNumber && card.description.includes('Vulnerable')) {
    if (targetEnemy && resolvedTarget >= 0 && targetEnemy.currentHp > 0) {
      newState.enemies[resolvedTarget] = {
        ...newState.enemies[resolvedTarget],
        statusEffects: {
          ...(newState.enemies[resolvedTarget].statusEffects || {}),
          'Vulnerable': (newState.enemies[resolvedTarget].statusEffects?.['Vulnerable'] || 0) + card.magicNumber
        }
      };
    }
  }

  // Handle drawing cards
  const drawMatch = card.description.match(/Draw (\d+) card/i);
  if (drawMatch) {
    const amount = parseInt(drawMatch[1], 10);
    const { drawn, newDrawPile, newDiscardPile } = drawCards(newState.drawPile, newState.discardPile, amount);
    newState.hand = [...newState.hand, ...drawn];
    newState.drawPile = newDrawPile;
    newState.discardPile = newDiscardPile;
  }

  // Move card from hand to discard pile (or exhaust)
  const playedCard = newState.hand[index];
  newState.hand = [
    ...newState.hand.slice(0, index),
    ...newState.hand.slice(index + 1)
  ];
  if (card.description.includes('Exhaust')) {
    newState.exhaustPile = [...newState.exhaustPile, card];
  } else {
    newState.discardPile = [...newState.discardPile, card];
  }

  return newState;
}
