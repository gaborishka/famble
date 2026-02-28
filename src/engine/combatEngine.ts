import { GameState, Card, Enemy, Boss, Synergy } from '../../shared/types/game';
import { drawCards, shuffle } from './deckManager';
import { getNextIntent } from './enemyAI';

export function initializeCombat(deck: Card[], enemies: (Enemy | Boss)[]): GameState {
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
    enemies,
    turn: 1,
    tagsPlayedThisTurn: {},
    statusEffects: {}
  };
}

export function endTurn(state: GameState): GameState {
  let newState: GameState = { ...state, enemies: state.enemies.map(e => ({ ...e })) };

  // Each living enemy acts
  for (let i = 0; i < newState.enemies.length; i++) {
    const enemy = newState.enemies[i];
    if (enemy.currentHp <= 0) continue;

    const intent = getNextIntent(enemy, newState.turn);

    // Damage phase
    if (['Attack', 'AttackDefend', 'AttackDebuff', 'AttackBuff'].includes(intent.type)) {
      let dmg = intent.value;

      if (enemy.statusEffects?.['Strength']) {
        dmg += enemy.statusEffects['Strength'];
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
        newState.enemies[i] = {
          ...newState.enemies[i],
          statusEffects: {
            ...(newState.enemies[i].statusEffects || {}),
            'Block': (newState.enemies[i].statusEffects?.['Block'] || 0) + blockAmt
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
        newState.enemies[i] = {
          ...newState.enemies[i],
          statusEffects: {
            ...(newState.enemies[i].statusEffects || {}),
            'Strength': (newState.enemies[i].statusEffects?.['Strength'] || 0) + buffAmt
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

  // Tick down vulnerable on each living enemy
  for (let i = 0; i < newState.enemies.length; i++) {
    if (newState.enemies[i].currentHp <= 0) continue;
    if (newState.enemies[i].statusEffects?.['Vulnerable']) {
      newState.enemies[i] = {
        ...newState.enemies[i],
        statusEffects: {
          ...newState.enemies[i].statusEffects,
          'Vulnerable': (newState.enemies[i].statusEffects?.['Vulnerable'] || 0) - 1,
        },
      };
    }
  }

  return newState;
}
