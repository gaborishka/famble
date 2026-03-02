# Famble

**A roguelike deckbuilder that generates entire games from any content you give it.**

Drop in a URL, PDF, or text — Famble reads it, then builds a complete Slay the Spire-style card game around it: unique characters, enemies, cards, bosses, backgrounds, music, and sound effects. Every run is one-of-a-kind.

## Demo
https://famble-six.vercel.app/

## Screenshots

<p align="center">
  <img src="screenshots/1.png" width="49%" />
  <img src="screenshots/2.png" width="49%" />
</p>
<p align="center">
  <img src="screenshots/5.png" width="49%" />
  <img src="screenshots/4.png" width="49%" />
</p>
<p align="center">
  <img src="screenshots/3.png" width="98.5%" />
</p>

## How It Works

1. **You provide content** — a URL, PDF, or raw text
2. **AI reads and interprets it** — extracting themes, characters, and concepts
3. **A full game is generated** — player character, enemies, cards with unique effects, a boss with phases, backgrounds, music, and SFX
4. **You play through it** — navigate a branching map, fight enemies, collect cards, and face the final boss

## Tech Stack

- **Frontend:** React 19 + TypeScript + Vite + Tailwind CSS 4
- **Text Generation & OCR:** Mistral AI
- **Image & Music Generation:** Google Gemini
- **SFX & Boss Voice:** ElevenLabs
- **Animation:** Motion (Framer Motion)

## Run Locally

**Prerequisites:** Node.js

1. Install dependencies:
   ```
   npm install
   ```
2. Set API keys in `.env.local`:
   - `MISTRAL_API_KEY` — Required for text generation and OCR
   - `GEMINI_API_KEY` — Required for image + background music generation
   - `ELEVENLABS_API_KEY` — Optional, enables SFX + boss TTS
3. Start the dev server:
   ```
   npm run dev
   ```
