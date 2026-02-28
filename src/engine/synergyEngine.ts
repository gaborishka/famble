import { Synergy, GameState } from '../../shared/types/game';

export function checkSynergies(state: GameState, synergies: Synergy[]): Synergy[] {
  const triggered: Synergy[] = [];
  for (const synergy of synergies) {
    const count = state.tagsPlayedThisTurn[synergy.tag] || 0;
    // Only trigger exactly when the threshold is reached
    if (count === synergy.threshold) {
      triggered.push(synergy);
    }
  }
  return triggered;
}
