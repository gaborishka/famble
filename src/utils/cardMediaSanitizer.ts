import { Card, EventRoomContent, RoomContentPayload, RunData, RunDataV2, isRunDataV2 } from '../../shared/types/game';

interface MediaRegistry {
  imagePromptByObjectId: Map<string, string | undefined>;
  audioPromptByObjectId: Map<string, string | undefined>;
}

function createRegistry(): MediaRegistry {
  return {
    imagePromptByObjectId: new Map<string, string | undefined>(),
    audioPromptByObjectId: new Map<string, string | undefined>(),
  };
}

function sanitizeCardWithRegistry(card: Card, registry: MediaRegistry): Card {
  let nextCard = card;

  if (card.imageObjectId) {
    const priorPrompt = registry.imagePromptByObjectId.get(card.imageObjectId);
    if (priorPrompt === undefined) {
      registry.imagePromptByObjectId.set(card.imageObjectId, card.imagePrompt);
    } else if (priorPrompt !== card.imagePrompt) {
      nextCard = {
        ...nextCard,
        imageObjectId: undefined,
        imageUrl: undefined,
      };
    }
  }

  if (card.audioObjectId) {
    const priorPrompt = registry.audioPromptByObjectId.get(card.audioObjectId);
    if (priorPrompt === undefined) {
      registry.audioPromptByObjectId.set(card.audioObjectId, card.audioPrompt);
    } else if (priorPrompt !== card.audioPrompt) {
      nextCard = {
        ...nextCard,
        audioObjectId: undefined,
        audioUrl: undefined,
      };
    }
  }

  return nextCard;
}

export function sanitizeCardMediaRefs(cards: Card[], registry?: MediaRegistry): Card[] {
  const effectiveRegistry = registry ?? createRegistry();
  return cards.map(card => sanitizeCardWithRegistry(card, effectiveRegistry));
}

function sanitizeRoomPayload(payload: RoomContentPayload, registry: MediaRegistry): RoomContentPayload {
  if (payload.nodeType === 'Combat' || payload.nodeType === 'Elite') {
    return {
      ...payload,
      rewardCards: sanitizeCardMediaRefs(payload.rewardCards || [], registry),
    };
  }

  if (payload.nodeType === 'Shop') {
    return {
      ...payload,
      shopCards: sanitizeCardMediaRefs(payload.shopCards || [], registry),
    };
  }

  if (payload.nodeType === 'Event') {
    const choices = payload.choices.map(choice => {
      const addCard = choice.effects?.addCard
        ? sanitizeCardMediaRefs([choice.effects.addCard], registry)[0]
        : undefined;
      return {
        ...choice,
        effects: {
          ...(choice.effects || {}),
          addCard,
        },
      };
    });

    return {
      ...(payload as EventRoomContent),
      choices,
    };
  }

  return payload;
}

export function sanitizeRunDataCardMedia(runData: RunData): RunData {
  const registry = createRegistry();

  if (!isRunDataV2(runData)) {
    return {
      ...runData,
      cards: sanitizeCardMediaRefs(runData.cards, registry),
    };
  }

  const sanitizedCards = sanitizeCardMediaRefs(runData.cards, registry);
  const sanitizedBootstrapCards = sanitizeCardMediaRefs(runData.bootstrap.starterCards as Card[], registry) as [Card, Card, Card];

  const sanitizedRooms: RunDataV2['rooms'] = Object.fromEntries(
    Object.entries(runData.rooms).map(([roomId, state]) => {
      if (!state.payload) return [roomId, state];
      return [
        roomId,
        {
          ...state,
          payload: sanitizeRoomPayload(state.payload, registry),
        },
      ];
    })
  );

  return {
    ...runData,
    cards: sanitizedCards,
    bootstrap: {
      ...runData.bootstrap,
      starterCards: sanitizedBootstrapCards,
    },
    rooms: sanitizedRooms,
  };
}
