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

    // Damage phase
    if (['Attack', 'AttackDefend', 'AttackDebuff', 'AttackBuff'].includes(intent.type)) {
      let dmg = intent.value;

      if (newState.currentEnemy.statusEffects?.['Strength']) {
        dmg += newState.currentEnemy.statusEffects['Strength'];
      }

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
    }

    // Defend phase
    if (['Defend', 'AttackDefend'].includes(intent.type)) {
      const blockAmt = intent.type === 'AttackDefend' ? (intent.secondaryValue || 0) : intent.value;
      if (blockAmt > 0) {
        newState.currentEnemy = {
          ...newState.currentEnemy,
          statusEffects: {
            ...(newState.currentEnemy.statusEffects || {}),
            'Block': (newState.currentEnemy.statusEffects?.['Block'] || 0) + blockAmt
          }
        };
      }
    }

    // Debuff phase
    if (['Debuff', 'AttackDebuff'].includes(intent.type)) {
      const debuffAmt = intent.type === 'AttackDebuff' ? (intent.secondaryValue || 0) : intent.value;
      if (debuffAmt > 0) {
        newState.statusEffects['Vulnerable'] = (newState.statusEffects['Vulnerable'] || 0) + debuffAmt;
      }
    }

    // Buff phase
    if (['Buff', 'AttackBuff'].includes(intent.type)) {
      const buffAmt = intent.type === 'AttackBuff' ? (intent.secondaryValue || 0) : intent.value;
      if (buffAmt > 0) {
        newState.currentEnemy = {
          ...newState.currentEnemy,
          statusEffects: {
            ...(newState.currentEnemy.statusEffects || {}),
            'Strength': (newState.currentEnemy.statusEffects?.['Strength'] || 0) + buffAmt
          }
        };
      }
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
