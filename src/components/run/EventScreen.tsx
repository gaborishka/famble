import React, { useMemo, useState } from 'react';
import { Card, EventRoomContent } from '../../../shared/types/game';
import { motion } from 'motion/react';
import { PlayerHUD } from './PlayerHUD';
import { GameImage } from '../GameImage';

// ── Icon Components ──

const FireIcon = () => (
  <svg viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5">
    <path d="M12 23c-4.97 0-9-3.58-9-8 0-3.07 2.26-6.3 4-8l2 2c-1.11 1.48-2 3.24-2 5 0 2.76 2.24 5 5 5s5-2.24 5-5c0-1.76-.89-3.52-2-5l2-2c1.74 1.7 4 4.93 4 8 0 4.42-4.03 8-9 8zm0-13l-1.5 1.5C9.56 12.44 9 13.58 9 15c0 1.66 1.34 3 3 3s3-1.34 3-3c0-1.42-.56-2.56-1.5-3.5L12 10z"/>
  </svg>
);

const ShieldIcon = () => (
  <svg viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5">
    <path d="M12 1L3 5v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V5l-9-4z"/>
  </svg>
);

const GoldIcon = () => (
  <svg viewBox="0 0 24 24" className="w-5 h-5">
    <circle cx="12" cy="12" r="10" fill="currentColor"/>
    <text x="12" y="16.5" textAnchor="middle" fontSize="13" fontWeight="bold" fill="#78350f" fontFamily="sans-serif">$</text>
  </svg>
);

// ── Types ──

export interface EventEffects {
  hpDelta?: number;
  maxHpDelta?: number;
  goldDelta?: number;
  addCard?: Card;
}

type ChoiceIconType = 'fire' | 'shield' | 'gold';
type ChoiceColor = 'red' | 'blue' | 'orange';

interface EventChoice {
  label: string;
  description: string;
  icon: ChoiceIconType;
  color: ChoiceColor;
  apply: () => EventEffects;
}

interface EventContext {
  playerHp: number;
  playerMaxHp: number;
  gold: number;
  availableCards: Card[];
}

interface EventTemplate {
  title: string;
  description: string;
  imagePrompt: string;
  getChoices: (ctx: EventContext) => EventChoice[];
  footerText: string;
}

// ── Event Templates ──

const EVENT_TEMPLATES: EventTemplate[] = [
  {
    title: 'The Ancient Shrine',
    description: 'You stumble upon a weathered shrine deep in the shadows. Ancient runes pulse with an ethereal glow. The air hums with power — both healing and dangerous.',
    imagePrompt: 'ancient glowing stone shrine with magical runes in a dark mysterious cave, fantasy game art, moody atmospheric lighting, digital painting',
    footerText: 'Choose wisely. There is no going back.',
    getChoices: (ctx) => [
      {
        label: 'Drink from the shrine',
        description: 'Gain 15 HP or lose 10 HP — the gods are fickle',
        icon: 'fire',
        color: 'red',
        apply: () => ({ hpDelta: Math.random() > 0.4 ? 15 : -10 }),
      },
      {
        label: 'Study the ancient runes',
        description: 'Add a random card to your deck',
        icon: 'shield',
        color: 'blue',
        apply: () => {
          const pool = ctx.availableCards.length > 0 ? ctx.availableCards : [];
          const card = pool[Math.floor(Math.random() * pool.length)];
          return card ? { addCard: { ...card, id: `event-${Date.now()}` } } : {};
        },
      },
      {
        label: 'Pillage the offerings',
        description: 'Gain 30 gold',
        icon: 'gold',
        color: 'orange',
        apply: () => ({ goldDelta: 30 }),
      },
    ],
  },
  {
    title: 'The Wandering Merchant',
    description: 'A cloaked figure steps from the shadows, their cart laden with strange wares. They offer you a deal — but every deal has its price.',
    imagePrompt: 'mysterious hooded merchant with magical glowing cart of wares in dark forest path, fantasy game art, warm lantern lighting, digital painting',
    footerText: 'Every deal has its price.',
    getChoices: (ctx) => [
      {
        label: 'Trade your vitality',
        description: 'Lose 8 HP, gain 50 gold',
        icon: 'fire',
        color: 'red',
        apply: () => ({ hpDelta: -8, goldDelta: 50 }),
      },
      {
        label: 'Accept a mysterious gift',
        description: 'Add a random card to your deck',
        icon: 'shield',
        color: 'blue',
        apply: () => {
          const pool = ctx.availableCards.length > 0 ? ctx.availableCards : [];
          const card = pool[Math.floor(Math.random() * pool.length)];
          return card ? { addCard: { ...card, id: `event-${Date.now()}` } } : {};
        },
      },
      {
        label: 'Barter for gold',
        description: 'Gain 20 gold',
        icon: 'gold',
        color: 'orange',
        apply: () => ({ goldDelta: 20 }),
      },
    ],
  },
  {
    title: 'The Forgotten Tomb',
    description: 'An ancient tomb lies open before you. Inside, you sense treasures untouched for centuries — but also an ominous curse lingering in the stale air.',
    imagePrompt: 'ancient open tomb with golden treasure and glowing green curse in dark dungeon, fantasy game art, eerie lighting, digital painting',
    footerText: 'The dead do not rest easily.',
    getChoices: (ctx) => [
      {
        label: 'Brave the curse',
        description: 'Gain 5 Max HP or lose 5 Max HP permanently',
        icon: 'fire',
        color: 'red',
        apply: () => {
          const lucky = Math.random() > 0.5;
          return { maxHpDelta: lucky ? 5 : -5 };
        },
      },
      {
        label: 'Take only what is safe',
        description: 'Add a random card to your deck',
        icon: 'shield',
        color: 'blue',
        apply: () => {
          const pool = ctx.availableCards.length > 0 ? ctx.availableCards : [];
          const card = pool[Math.floor(Math.random() * pool.length)];
          return card ? { addCard: { ...card, id: `event-${Date.now()}` } } : {};
        },
      },
      {
        label: 'Loot the gold and flee',
        description: 'Gain 40 gold',
        icon: 'gold',
        color: 'orange',
        apply: () => ({ goldDelta: 40 }),
      },
    ],
  },
  {
    title: 'The Healing Spring',
    description: 'Crystal-clear water flows from an ancient spring, its surface shimmering with magical energy. The water calls to your weary bones.',
    imagePrompt: 'magical healing spring with glowing crystal clear water in enchanted forest clearing, fantasy game art, soft blue and green lighting, digital painting',
    footerText: 'Rest well, adventurer.',
    getChoices: (ctx) => [
      {
        label: 'Drink deeply',
        description: `Heal to full HP`,
        icon: 'fire',
        color: 'red',
        apply: () => ({ hpDelta: ctx.playerMaxHp - ctx.playerHp }),
      },
      {
        label: 'Bathe in the waters',
        description: 'Gain 3 Max HP permanently',
        icon: 'shield',
        color: 'blue',
        apply: () => ({ maxHpDelta: 3, hpDelta: 3 }),
      },
      {
        label: 'Fill bottles and sell',
        description: 'Gain 25 gold',
        icon: 'gold',
        color: 'orange',
        apply: () => ({ goldDelta: 25 }),
      },
    ],
  },
  {
    title: 'The Whispering Statue',
    description: 'A towering stone statue stands at a crossroads, its lips moving silently. As you approach, you hear whispers promising power — at a cost.',
    imagePrompt: 'tall ancient stone statue at crossroads whispering with glowing purple energy, dark fantasy game art, mystical atmosphere, digital painting',
    footerText: 'Power always comes at a cost.',
    getChoices: (ctx) => [
      {
        label: 'Listen to the whispers',
        description: 'Gain 20 HP or lose 15 HP — the statue tests your will',
        icon: 'fire',
        color: 'red',
        apply: () => ({ hpDelta: Math.random() > 0.5 ? 20 : -15 }),
      },
      {
        label: 'Leave an offering',
        description: 'Spend 15 gold, add a random card to your deck',
        icon: 'shield',
        color: 'blue',
        apply: () => {
          if (ctx.gold < 15) return {};
          const pool = ctx.availableCards.length > 0 ? ctx.availableCards : [];
          const card = pool[Math.floor(Math.random() * pool.length)];
          return card ? { goldDelta: -15, addCard: { ...card, id: `event-${Date.now()}` } } : { goldDelta: -15 };
        },
      },
      {
        label: 'Take the statue\'s gold teeth',
        description: 'Gain 35 gold',
        icon: 'gold',
        color: 'orange',
        apply: () => ({ goldDelta: 35 }),
      },
    ],
  },
];

// ── Style Maps ──

const ICON_BG: Record<ChoiceIconType, string> = {
  fire: 'bg-red-500',
  shield: 'bg-blue-500',
  gold: 'bg-amber-500',
};

const BORDER_LEFT: Record<ChoiceColor, string> = {
  red: 'border-l-red-500',
  blue: 'border-l-blue-500',
  orange: 'border-l-amber-500',
};

const ICON_MAP: Record<ChoiceIconType, React.ReactNode> = {
  fire: <FireIcon />,
  shield: <ShieldIcon />,
  gold: <GoldIcon />,
};

// ── Component ──

interface EventScreenProps {
  playerHp: number;
  playerMaxHp: number;
  gold: number;
  currentFloor: number;
  totalFloors: number;
  availableCards: Card[];
  roomEvent?: EventRoomContent | null;
  onComplete: (effects: EventEffects) => void;
}

export const EventScreen: React.FC<EventScreenProps> = ({
  playerHp,
  playerMaxHp,
  gold,
  currentFloor,
  totalFloors,
  availableCards,
  roomEvent,
  onComplete,
}) => {
  // Pick a random event once per mount
  const fallbackEvent = useMemo(() => {
    return EVENT_TEMPLATES[Math.floor(Math.random() * EVENT_TEMPLATES.length)];
  }, []);

  const choices = useMemo(() => {
    if (roomEvent) {
      return roomEvent.choices.map(choice => ({
        label: choice.label,
        description: choice.description,
        icon: choice.icon || 'shield',
        color: choice.color || 'blue',
        apply: () => {
          const effects = { ...(choice.effects || {}) };
          if (effects.addCard) {
            effects.addCard = { ...effects.addCard, id: `event-${choice.id}-${Date.now()}` };
          }
          return effects;
        },
      }));
    }
    return fallbackEvent.getChoices({ playerHp, playerMaxHp, gold, availableCards });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomEvent, fallbackEvent]);

  const eventTitle = roomEvent?.title || fallbackEvent.title;
  const eventDescription = roomEvent?.description || fallbackEvent.description;
  const eventImagePrompt = roomEvent?.imagePrompt || fallbackEvent.imagePrompt;
  const eventImageUrl = roomEvent?.imageUrl || roomEvent?.objectUrls?.eventImageUrl;
  const eventImageFileKey = roomEvent?.objectRefs?.eventImageId;
  const eventFooterText = roomEvent?.footerText || fallbackEvent.footerText;

  const [chosen, setChosen] = useState(false);

  const handleChoice = (choice: EventChoice) => {
    if (chosen) return;
    setChosen(true);
    const effects = choice.apply();
    // Small delay for feel
    setTimeout(() => onComplete(effects), 300);
  };

  return (
    <div className="w-full h-full bg-[#0b1021] flex flex-col overflow-y-auto">
      <PlayerHUD
        playerHp={playerHp}
        playerMaxHp={playerMaxHp}
        gold={gold}
        currentFloor={currentFloor}
        totalFloors={totalFloors}
      />

      <div className="flex-1 flex flex-col items-center px-4 sm:px-6 pb-8 pt-2">
        {/* Event Illustration */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
          className="w-full max-w-md h-44 sm:h-52 rounded-lg border-2 border-slate-600/50 overflow-hidden mb-8 bg-slate-800 shadow-2xl shadow-black/40"
        >
          <GameImage
            src={eventImageUrl}
            prompt={eventImagePrompt}
            fileKey={eventImageFileKey}
            className="w-full h-full"
            alt={eventTitle}
            type="background"
          />
        </motion.div>

        {/* Title + Divider + Description */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
          className="text-center mb-8 max-w-lg"
        >
          <h2 className="text-3xl sm:text-4xl font-bold text-white mb-3 tracking-tight">{eventTitle}</h2>
          <div className="w-48 h-px mx-auto bg-gradient-to-r from-transparent via-slate-500 to-transparent mb-5" />
          <p className="text-slate-400 text-base leading-relaxed px-2">{eventDescription}</p>
        </motion.div>

        {/* Choices */}
        <div className="w-full max-w-lg space-y-3 mb-8">
          {choices.map((choice, index) => (
            <motion.button
              key={index}
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: 0.4 + index * 0.1, type: 'spring', stiffness: 300, damping: 25 }}
              onClick={() => handleChoice(choice)}
              disabled={chosen}
              className={`w-full flex items-center gap-4 px-4 py-4 rounded-lg border-l-4 ${BORDER_LEFT[choice.color]} bg-slate-800/60 hover:bg-slate-700/80 disabled:opacity-50 disabled:pointer-events-none transition-all cursor-pointer text-left group`}
            >
              {/* Icon Circle */}
              <div className={`w-10 h-10 rounded-full ${ICON_BG[choice.icon]} flex items-center justify-center shrink-0 text-white shadow-lg`}>
                {ICON_MAP[choice.icon]}
              </div>

              {/* Label + Description */}
              <div className="flex-1 min-w-0">
                <div className="font-bold text-white text-base leading-snug">{choice.label}</div>
                <div className="text-sm text-slate-400 leading-snug mt-0.5">{choice.description}</div>
              </div>

              {/* Chevron */}
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} className="w-5 h-5 text-slate-500 group-hover:text-white transition-colors shrink-0">
                <path d="M9 18l6-6-6-6" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </motion.button>
          ))}
        </div>

        {/* Footer */}
        <motion.p
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.8 }}
          className="text-slate-500 italic text-sm tracking-wide"
        >
          {eventFooterText}
        </motion.p>
      </div>
    </div>
  );
};
