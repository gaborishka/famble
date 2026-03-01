# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Famble is a Slay the Spire-style roguelike deckbuilder that generates unique game content from user input (URLs or PDFs). Built with React 19, TypeScript, Vite, and powered by Mistral for text generation/OCR, Google Gemini for image generation, and ElevenLabs for audio synthesis.

## Commands

- `npm run dev` — Start dev server on port 3000
- `npm run build` — Production build
- `npm run lint` — TypeScript type-check only (`tsc --noEmit`), no ESLint
- `npm run clean` — Remove dist/

There is no test framework configured.

## Environment Variables

Set in `.env.local`:
- `MISTRAL_API_KEY` — Required for Mistral text generation and OCR
- `GEMINI_API_KEY` (or `GOOGLE_API_KEY`) — Required for Gemini image generation
- `ELEVENLABS_API_KEY` — Optional, enables audio/music/TTS generation

These are injected via `vite.config.ts` `define` and accessed as `process.env.MISTRAL_API_KEY` / `process.env.GEMINI_API_KEY` / `process.env.ELEVENLABS_API_KEY` in client code.

## Architecture

### Data Flow

```
Generator (input) → Mistral generates RunData → App → RunManager (orchestration)
RunManager → NodeMap (navigation) → CombatArena (gameplay) → CardReward (post-combat)
```

Text game content is generated via Mistral calls and returned as `RunData`; images are generated with Gemini and audio with ElevenLabs. The app is a single-page client-side React app with no router.

### Key Directories

- `shared/types/game.ts` — All game type definitions (Card, Enemy, Boss, GameState, Synergy, RunData). This is the source of truth for game data structures.
- `src/engine/` — Pure logic for combat resolution: `combatEngine.ts` (turn flow), `cardResolver.ts` (card effects), `synergyEngine.ts` (tag threshold triggers), `deckManager.ts` (draw/shuffle), `enemyAI.ts` (intent selection)
- `src/services/geminiService.ts` — Orchestration service: uses Mistral for structured JSON/text generation and `gemini-2.5-flash-image` for image generation. Handles background removal for character sprites via `@imgly/background-removal`.
- `src/services/audioService.ts` — ElevenLabs API integration with request queue (max 3 concurrent). Generates SFX, music, and boss TTS.
- `src/components/combat/CombatArena.tsx` — Main combat screen. Largest component; manages game state, animations, audio, and UI.
- `src/components/run/RunManager.tsx` — Run state orchestration (map → combat → reward → victory/defeat). Tracks player HP, deck, gold.
- `src/components/generator/Generator.tsx` — Input UI for URL/text/file upload. Triggers text generation orchestration and preloads assets before starting.

### Combat System

Turn-based with energy system. Player plays cards (costing energy), which deal damage, add block, or trigger effects. Synergies fire when a tag threshold is reached in a single turn. Enemy intents rotate through a predefined list. Boss has a phase 2 triggered at an HP threshold (`enrageThreshold`).

### Asset Pipeline

Generated images and audio are cached in-memory (Maps) and persisted to `public/runs/{runId}/` via a custom Vite middleware plugin (`saveFilePlugin` in `vite.config.ts`) that serves a `/api/save-file` POST endpoint during dev.

## Tech Stack & Conventions

- **Styling:** Tailwind CSS 4 via `@tailwindcss/vite`. Dark theme with slate palette. No CSS modules or styled-components.
- **Animation:** `motion` library (formerly Framer Motion). Spring physics for card interactions, variant-based animations for combat sprites.
- **State:** React hooks only (`useState`, `useEffect`, `useRef`). No state management library.
- **Path alias:** `@` maps to the project root (configured in both `vite.config.ts` and `tsconfig.json`)
- **Components:** Functional components with named exports for utilities, default exports for page-level components.
