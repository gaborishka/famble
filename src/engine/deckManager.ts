import { Card } from '../../shared/types/game';

export function shuffle(array: Card[]): Card[] {
  const newArray = [...array];
  for (let i = newArray.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [newArray[i], newArray[j]] = [newArray[j], newArray[i]];
  }
  return newArray;
}

export function drawCards(drawPile: Card[], discardPile: Card[], amount: number): { drawn: Card[], newDrawPile: Card[], newDiscardPile: Card[] } {
  let drawn: Card[] = [];
  let currentDrawPile = [...drawPile];
  let currentDiscardPile = [...discardPile];

  for (let i = 0; i < amount; i++) {
    if (currentDrawPile.length === 0) {
      if (currentDiscardPile.length === 0) {
        break; // No more cards to draw
      }
      currentDrawPile = shuffle(currentDiscardPile);
      currentDiscardPile = [];
    }
    drawn.push(currentDrawPile.pop()!);
  }

  return { drawn, newDrawPile: currentDrawPile, newDiscardPile: currentDiscardPile };
}
