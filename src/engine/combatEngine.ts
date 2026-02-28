import { GameState, Card, Enemy, Boss, Synergy } from '../../shared/types/game';
import { drawCards, shuffle } from './deckManager';
import { getNextIntent } from './enemyAI';

export function initializeCombat(deck: Card[], enemy: Enemy | Boss): GameState {
  const initialDrawPile = shuffle(deck);
  const { drawn, newDrawPile, newDiscardPile } = drawCards(initialDrawPile, [], 5);
  
  return {
    playerHp: 50,
    playerMaxHp: 50,
    energy: 3,
    maxEnergy: 3,
    deck: deck,
    hand: drawn,
    drawPile: newDrawPile,
    discardPile: newDiscardPile,
    exhaustPile: [],
    currentEnemy: enemy,
    turn: 1,
    tagsPlayedThisTurn: {},
    statusEffects: {}
  };
}

export function endTurn(state: GameState): GameState {
  let newState = { ...state };
  
  // Enemy turn
  if (newState.currentEnemy) {
    const intent = getNextIntent(newState.currentEnemy, newState.turn);
    if (intent.type === 'Attack') {
      let dmg = intent.value;
      if (newState.statusEffects['Vulnerable']) {
        dmg = Math.floor(dmg * 1.5);
      }
      
      let playerBlock = newState.statusEffects['Block'] || 0;
      if (playerBlock >= dmg) {
        playerBlock -= dmg;
        dmg = 0;
      } else {
        dmg -= playerBlock;
        playerBlock = 0;
      }
      
      newState.playerHp = Math.max(0, newState.playerHp - dmg);
      newState.statusEffects['Block'] = playerBlock;
    } else if (intent.type === 'Defend') {
      newState.currentEnemy = {
        ...newState.currentEnemy,
        statusEffects: {
          ...(newState.currentEnemy.statusEffects || {}),
          'Block': (newState.currentEnemy.statusEffects?.['Block'] || 0) + intent.value
        }
      };
    } else if (intent.type === 'Debuff') {
      newState.statusEffects['Vulnerable'] = (newState.statusEffects['Vulnerable'] || 0) + intent.value;
    }
  }
  
  // End of turn cleanup
  newState.discardPile = [...newState.discardPile, ...newState.hand];
  newState.hand = [];
  
  // Draw new hand
  const { drawn, newDrawPile, newDiscardPile } = drawCards(newState.drawPile, newState.discardPile, 5);
  newState.hand = drawn;
  newState.drawPile = newDrawPile;
  newState.discardPile = newDiscardPile;
  
  // Reset turn state
  newState.energy = newState.maxEnergy;
  newState.turn += 1;
  newState.tagsPlayedThisTurn = {};
  newState.statusEffects['Block'] = 0; // Block expires
  if (newState.statusEffects['Vulnerable']) {
    newState.statusEffects['Vulnerable'] -= 1;
  }
  if (newState.currentEnemy && newState.currentEnemy.statusEffects?.['Vulnerable']) {
    newState.currentEnemy.statusEffects['Vulnerable'] -= 1;
  }
  
  return newState;
}
