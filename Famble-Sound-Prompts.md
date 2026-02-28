# Famble — Sound Effect Prompts for ElevenLabs Testing

Промпти для тестування генерації звуків через ElevenLabs API. Три теми × 10 SFX слотів + TTS наратор + музика.

---

## Cooking Theme (Кулінарна книга)

| Slot | Prompt |
|------|--------|
| `attack` | kitchen knife chopping hard on wooden cutting board, sharp percussive hit |
| `block` | heavy metal pot lid clang, defensive metallic ring |
| `card_play` | flipping a thick recipe book page, soft paper sound |
| `enemy_death` | ceramic plate shattering on tile floor, breaking apart |
| `boss_appear` | deep heavy oven door slamming shut with metallic echo, ominous and dramatic |
| `ambient` | busy restaurant kitchen background, sizzling pans, distant clattering, muffled voices |
| `player_hit` | hot oil splatter and hiss, painful sizzle |
| `gold_pickup` | handful of metal coins dropping onto a metal tray, bright clinking |
| `heal` | gentle pouring liquid into a glass, refreshing water sound |
| `victory` | restaurant kitchen bell ding ding, order up celebration |

---

## Legal Theme (Юридичний документ)

| Slot | Prompt |
|------|--------|
| `attack` | judge gavel striking wooden block, authoritative sharp hit |
| `block` | heavy leather-bound book slamming shut, thick thud |
| `card_play` | rubber stamp pressing firmly onto paper document |
| `enemy_death` | paper being torn apart aggressively, ripping shredding |
| `boss_appear` | deep heavy courtroom double doors opening slowly with dramatic echo in marble hall |
| `ambient` | quiet courtroom atmosphere, soft murmuring crowd, occasional cough, pen scratching |
| `player_hit` | sharp crack of a wooden gavel, punishing strike |
| `gold_pickup` | old cash register opening with mechanical bell ding |
| `heal` | calm turning of thin legal document pages, peaceful rustling |
| `victory` | courtroom crowd gasping then applauding, murmurs of approval |

---

## Science Theme (Наукова стаття)

| Slot | Prompt |
|------|--------|
| `attack` | electric laboratory spark discharge, sharp zapping crackle |
| `block` | thick safety glass panel impact, solid transparent barrier thud |
| `card_play` | mechanical laboratory switch flipping on with click and hum |
| `enemy_death` | glass beaker falling and shattering, liquid spilling, chemical fizz |
| `boss_appear` | deep industrial machine powering up, rising electrical hum growing louder and ominous |
| `ambient` | science laboratory atmosphere, gentle equipment humming, bubbling liquids, quiet beeping monitors |
| `player_hit` | acid hiss and chemical burn sizzle, corrosive splash |
| `gold_pickup` | small glass vials clinking together, delicate laboratory sounds |
| `heal` | gentle bubbling of a clean chemical solution, soothing laboratory synthesis |
| `victory` | successful experiment sound, rising positive tone, equipment powering down peacefully |

---

## TTS Narrator (для боса)

| Theme | Text | Voice Style |
|-------|------|------------|
| Cooking | "The kitchen burns, and so will you." | Deep dramatic male, slow pace, menacing |
| Legal | "No objection can save you now." | Cold authoritative male, measured pace, commanding |
| Science | "Your hypothesis ends here. Permanently." | Distorted electronic voice, calculated, inhuman |

---

## Music Prompts

| Theme | Prompt |
|-------|--------|
| Cooking | Dark intense orchestral music with percussion, like a dangerous cooking competition, fast tempo, tension building, minor key |
| Legal | Suspenseful orchestral music with deep strings and piano, courtroom drama atmosphere, slow building tension, dark and serious |
| Science | Electronic synthwave with dark undertones, laboratory sci-fi atmosphere, pulsing bass, mysterious and tense, cyberpunk influence |

---

## Використання

### SFX API
```
POST https://api.elevenlabs.io/v1/sound-generation
{
  "text": "<prompt з таблиці>",
  "duration_seconds": 1.5,  // 0.5-2s для SFX
  "prompt_influence": 0.5
}
```

### TTS API
```
POST https://api.elevenlabs.io/v1/text-to-speech/{voice_id}
{
  "text": "<narrator text>",
  "model_id": "eleven_multilingual_v2",
  "voice_settings": {
    "stability": 0.3,
    "similarity_boost": 0.8
  }
}
```

### Music API
```
POST https://api.elevenlabs.io/v1/music-generation
{
  "text": "<music prompt>",
  "duration_seconds": 30
}
```
