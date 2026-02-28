import { Card, GameState, Enemy, Boss } from '../../shared/types/game';
import { drawCards } from './deckManager';

export function resolveCard(card: Card, index: number, state: GameState): GameState {
  const newState = { ...state };

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

  if (card.damage && newState.currentEnemy) {
    let dmg = card.damage;
    if (newState.currentEnemy.statusEffects && newState.currentEnemy.statusEffects['Vulnerable']) {
      dmg = Math.floor(dmg * 1.5);
    }

    // Simple damage to enemy
    let enemyBlock = newState.currentEnemy.statusEffects?.['Block'] || 0;
    if (enemyBlock >= dmg) {
      enemyBlock -= dmg;
      dmg = 0;
    } else {
      dmg -= enemyBlock;
      enemyBlock = 0;
    }

    newState.currentEnemy = {
      ...newState.currentEnemy,
      currentHp: Math.max(0, newState.currentEnemy.currentHp - dmg),
      statusEffects: {
        ...(newState.currentEnemy.statusEffects || {}),
        'Block': enemyBlock
      }
    };
  }

  if (card.magicNumber && card.description.includes('Vulnerable')) {
    if (newState.currentEnemy) {
      newState.currentEnemy = {
        ...newState.currentEnemy,
        statusEffects: {
          ...(newState.currentEnemy.statusEffects || {}),
          'Vulnerable': (newState.currentEnemy.statusEffects?.['Vulnerable'] || 0) + card.magicNumber
        }
      }
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
