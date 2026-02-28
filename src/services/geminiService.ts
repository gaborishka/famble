import { GoogleGenAI, Type, GenerateContentResponse } from '@google/genai';
import {
  Boss,
  Card,
  Enemy,
  GenerationSettings,
  isRunDataV2,
  MapNode,
  RoomContentPayload,
  RunData,
  RunDataLegacy,
  RunDataV2,
  Synergy,
  EventChoicePayload,
  EventRoomContent,
  ShopRoomContent,
  CombatRoomContent,
} from '../../shared/types/game';
import { removeBackground } from '@imgly/background-removal';
import { generateFallbackNodeMap } from '../engine/mapGenerator';

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
const RUN_DATA_MODELS = ['gemini-3-flash-preview', 'gemini-2.5-flash'] as const;
const RUN_DATA_MAX_ATTEMPTS = 3;

let currentRunId = '';

export function getCurrentRunId(): string {
  return currentRunId;
}

export function setCurrentRunId(id: string) {
  currentRunId = id;
}

function toFileSafeKey(input: string): string {
  return input.replace(/[^a-z0-9]/gi, '_').toLowerCase().substring(0, 80);
}

function nowTs(): number {
  return Date.now();
}

export async function saveRunSnapshot(runData: RunData): Promise<void> {
  if (!currentRunId) return;
  try {
    await fetch('/api/save-run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ runId: currentRunId, runData })
    });
  } catch (err) {
    console.error('Failed to save run snapshot locally:', err);
  }
}

function collectJsonCandidates(rawText: string): string[] {
  const candidates: string[] = [];
  const trimmed = rawText.trim();

  if (trimmed) {
    candidates.push(trimmed);
  }

  const fencedMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fencedMatch?.[1]) {
    candidates.push(fencedMatch[1].trim());
  }

  const firstBrace = trimmed.indexOf('{');
  const lastBrace = trimmed.lastIndexOf('}');
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    candidates.push(trimmed.slice(firstBrace, lastBrace + 1));
  }

  return [...new Set(candidates.filter(Boolean))];
}

function errorToMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

export async function generateRunData(prompt: string, fileData?: { mimeType: string; data: string }, options?: { skipFileData?: boolean }): Promise<RunDataLegacy> {
  currentRunId = Date.now().toString();
  const parts: any[] = [{ text: prompt }];

  if (fileData && !options?.skipFileData) {
    parts.unshift({
      inlineData: {
        mimeType: fileData.mimeType,
        data: fileData.data,
      }
    });
  }

  const runDataConfig = {
    systemInstruction: `You are an expert game designer for a Slay the Spire-style roguelike deckbuilder.
Based on the user's input (theme, text, or image), generate a complete set of game data.
The game should be balanced, thematic, and fun.
Create exactly 7 cards in total. The first card MUST be named 'Strike' (type Attack, 1 cost, 6 damage, no special effects). The second card MUST be named 'Defend' (type Skill, 1 cost, 5 block, no special effects). The remaining 5 cards should be unique special cards (mix of Attack, Skill, Power).
Also create exactly 4 unique normal enemies (ranging from simple to elite difficulty), 1 boss, and 1 synergy rule.
Enemies do not use a deck of cards. Instead, their actions are dictated by a fixed sequence of 'intents' that loops. Simple enemies should have a sequence of 2-3 intents, medium 3-4, elite 3-5, and the boss 4-7 intents.
Intents can be simple (Attack, Defend, Buff, Debuff, Unknown) or combined (AttackDefend, AttackDebuff, AttackBuff). Use 'value' for the primary amount (e.g. damage), and 'secondaryValue' for the secondary effect (e.g. block amount or debuff stacks).
If a card applies 'Vulnerable', use the 'magicNumber' field to specify how many stacks.
For audio fields, output ONLY the unique semantic fragment, not full production instructions.
Audio fragment rules:
- Keep fragments concrete and cinematic (specific source/action/material/emotion), avoid generic words like "epic sound effect".
- Avoid technical directives like "loop", "high quality", "SFX", "music track", "audio", "stereo", "mix".
- For card/enemy/boss audioPrompt: 4-14 words, one event-focused phrase.
- For roomMusicPrompt/bossMusicPrompt: 6-18 words, describing motif/instrumentation/mood only.
- Do not include spoken dialogue inside non-TTS prompts.
Boss must include a 'narratorText' opening line (6-20 words), plus narrator voice hints:
- narratorVoiceStyle: 2-8 words (example: "cold judicial authority")
- narratorVoiceGender: one of male/female/neutral
- narratorVoiceAccent: short accent hint if useful
All returned string values must avoid raw double quote characters. Use apostrophes instead.
Return the data strictly matching the provided JSON schema.`,
    responseMimeType: 'application/json',
    responseSchema: {
      type: Type.OBJECT,
      properties: {
          theme: { type: Type.STRING, description: 'The overall theme of the run' },
          cards: {
            type: Type.ARRAY,
            minItems: 7,
            maxItems: 7,
            items: {
              type: Type.OBJECT,
              properties: {
                id: { type: Type.STRING },
                name: { type: Type.STRING },
                cost: { type: Type.INTEGER },
                type: { type: Type.STRING, description: 'Attack, Skill, or Power' },
                description: { type: Type.STRING },
                damage: { type: Type.INTEGER },
                block: { type: Type.INTEGER },
                magicNumber: { type: Type.INTEGER },
                tags: { type: Type.ARRAY, items: { type: Type.STRING } },
                imagePrompt: { type: Type.STRING, description: 'A visual description of the card for image generation' },
                audioPrompt: { type: Type.STRING, description: 'Unique semantic fragment for card SFX only. Example: "tempered steel slash through wet parchment". Do not include technical audio instructions.' }
              },
              required: ['id', 'name', 'cost', 'type', 'description', 'tags', 'imagePrompt', 'audioPrompt']
            }
          },
          enemies: {
            type: Type.ARRAY,
            minItems: 4,
            maxItems: 4,
            items: {
              type: Type.OBJECT,
              properties: {
                id: { type: Type.STRING },
                name: { type: Type.STRING },
                maxHp: { type: Type.INTEGER },
                currentHp: { type: Type.INTEGER },
                description: { type: Type.STRING },
                imagePrompt: { type: Type.STRING, description: 'A visual description of the enemy for image generation. IMPORTANT: always include "facing left, looking left, side profile" in the prompt. Never include facing right.' },
                audioPrompt: { type: Type.STRING, description: 'Unique semantic fragment for enemy attack SFX only. Example: "rusted halberd whoosh with chain rattle". Do not include technical audio instructions.' },
                intents: {
                  type: Type.ARRAY,
                  items: {
                    type: Type.OBJECT,
                    properties: {
                      type: { type: Type.STRING, description: 'Attack, Defend, Buff, Debuff, AttackDefend, AttackBuff, AttackDebuff, or Unknown' },
                      value: { type: Type.INTEGER, description: 'Primary value based on type (e.g. damage amount or block amount)' },
                      secondaryValue: { type: Type.INTEGER, description: 'Optional secondary value for combined intents (e.g. block or debuff amount)' },
                      description: { type: Type.STRING }
                    },
                    required: ['type', 'value', 'description']
                  }
                }
              },
              required: ['id', 'name', 'maxHp', 'currentHp', 'description', 'intents', 'imagePrompt', 'audioPrompt']
            }
          },
          boss: {
            type: Type.OBJECT,
            properties: {
              id: { type: Type.STRING },
              name: { type: Type.STRING },
              maxHp: { type: Type.INTEGER },
              currentHp: { type: Type.INTEGER },
              description: { type: Type.STRING },
              imagePrompt: { type: Type.STRING, description: 'A visual description of a giant boss for image generation, emphasize it is massive and at least twice as large as the player. IMPORTANT: always include "facing left, looking left, side profile" in the prompt. Never include facing right.' },
              audioPrompt: { type: Type.STRING, description: 'Unique semantic fragment for boss attack SFX only. Example: "colossal gavel impact cracking marble". Do not include technical audio instructions.' },
              narratorText: { type: Type.STRING, description: 'A dramatic boss opening dialogue line for TTS, 6-20 words.' },
              narratorVoiceStyle: { type: Type.STRING, description: 'Short voice style hint for TTS selection, 2-8 words. Example: "cold judicial authority".' },
              narratorVoiceGender: { type: Type.STRING, description: 'Preferred narrator gender hint: male, female, or neutral.' },
              narratorVoiceAccent: { type: Type.STRING, description: 'Optional accent hint for narrator voice selection.' },
              enrageThreshold: { type: Type.INTEGER, description: 'Percentage HP (0-100) when phase 2 starts' },
              intents: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    type: { type: Type.STRING, description: 'Attack, Defend, Buff, Debuff, AttackDefend, AttackBuff, AttackDebuff, or Unknown' },
                    value: { type: Type.INTEGER, description: 'Primary value based on type' },
                    secondaryValue: { type: Type.INTEGER, description: 'Optional secondary value' },
                    description: { type: Type.STRING }
                  },
                  required: ['type', 'value', 'description']
                }
              },
              phase2Intents: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    type: { type: Type.STRING, description: 'Attack, Defend, Buff, Debuff, AttackDefend, AttackBuff, AttackDebuff, or Unknown' },
                    value: { type: Type.INTEGER, description: 'Primary value based on type' },
                    secondaryValue: { type: Type.INTEGER, description: 'Optional secondary value' },
                    description: { type: Type.STRING }
                  },
                  required: ['type', 'value', 'description']
                }
              }
            },
            required: ['id', 'name', 'maxHp', 'currentHp', 'description', 'enrageThreshold', 'intents', 'phase2Intents', 'imagePrompt', 'audioPrompt', 'narratorText']
          },
          synergies: {
            type: Type.ARRAY,
            minItems: 1,
            maxItems: 1,
            items: {
              type: Type.OBJECT,
              properties: {
                name: { type: Type.STRING },
                tag: { type: Type.STRING },
                threshold: { type: Type.INTEGER },
                effect: { type: Type.STRING, description: 'Damage, Block, Draw, or Energy' },
                value: { type: Type.INTEGER },
                description: { type: Type.STRING }
              },
              required: ['name', 'tag', 'threshold', 'effect', 'value', 'description']
            }
          },
          roomMusicPrompt: { type: Type.STRING, description: 'Unique semantic fragment for room combat music motif. Example: "nervous pizzicato strings over dusty percussion".' },
          bossMusicPrompt: { type: Type.STRING, description: 'Unique semantic fragment for boss music motif. Example: "massive choir swells over threatening taiko pulse".' }
        },
      required: ['theme', 'cards', 'enemies', 'boss', 'synergies', 'roomMusicPrompt', 'bossMusicPrompt']
    }
  };

  let runData: RunDataLegacy | null = null;
  let lastError: unknown = null;

  for (let attempt = 0; attempt < RUN_DATA_MAX_ATTEMPTS; attempt++) {
    const model = RUN_DATA_MODELS[Math.min(attempt, RUN_DATA_MODELS.length - 1)];
    const retryHintPart = attempt > 0
      ? [{
        text: 'Retry because previous output was invalid JSON. Return only strict JSON, no markdown fences, no extra commentary, and ensure all string values are valid JSON strings.'
      }]
      : [];

    const response = await ai.models.generateContent({
      model,
      contents: { parts: [...parts, ...retryHintPart] },
      config: runDataConfig,
    });

    const text = response.text;
    if (!text) {
      lastError = new Error('No response from Gemini');
      continue;
    }

    const candidates = collectJsonCandidates(text);
    for (const candidate of candidates) {
      try {
        runData = JSON.parse(candidate) as RunDataLegacy;
        break;
      } catch (err) {
        lastError = err;
      }
    }

    if (runData) {
      break;
    }

    console.warn(`generateRunData: attempt ${attempt + 1} returned malformed JSON; retrying...`, lastError);
  }

  if (!runData) {
    throw new Error(`Failed to parse Gemini JSON after ${RUN_DATA_MAX_ATTEMPTS} attempts: ${errorToMessage(lastError)}`);
  }

  void saveRunSnapshot(runData);

  return runData;
}

const imageCache = new Map<string, string>();
const pendingRequests = new Map<string, Promise<string>>();

function buildImageFileName(type: 'asset' | 'background' | 'character', prompt: string, fileKey?: string): string {
  if (fileKey) return `${type}_${toFileSafeKey(fileKey)}.png`;
  const sanitizedPrompt = toFileSafeKey(prompt);
  return `${type}_${sanitizedPrompt}.png`;
}

export async function generateGameImage(
  prompt: string,
  type: 'asset' | 'background' | 'character' = 'asset',
  fileKey?: string
): Promise<string> {
  const cacheKey = `${type}:${fileKey || prompt}`;
  if (imageCache.has(cacheKey)) {
    return imageCache.get(cacheKey)!;
  }

  if (pendingRequests.has(cacheKey)) {
    return pendingRequests.get(cacheKey)!;
  }

  if (currentRunId) {
    const fileName = buildImageFileName(type, prompt, fileKey);
    try {
      const res = await fetch(`/api/check-file?runId=${currentRunId}&fileName=${fileName}`);
      if (res.ok) {
        const { exists, url } = await res.json();
        if (exists) {
          imageCache.set(cacheKey, url);
          return url;
        }
      }
    } catch (e) {
      console.error('Failed to check for existing image file:', e);
    }
  }

  let prefix = "A 2D vector art style game asset, clean lines, flat colors, highly detailed, fantasy game UI element. ";
  if (type === 'background') {
    prefix = "A 2D video game combat stage background, side-scrolling perspective, must include a distinct flat floor or ground area at the bottom for characters to stand on, clean lines, flat colors, highly detailed. ";
  } else if (type === 'character') {
    prefix = "A 2D video game character sprite, clean lines, flat colors, solid green screen background (#00FF00), highly detailed, isolated. ";
  }

  const request = ai.models.generateContent({
    model: 'gemini-2.5-flash-image',
    contents: {
      parts: [
        {
          text: `${prefix}${prompt}`,
        },
      ],
    },
  }).then(async response => {
    for (const part of response.candidates?.[0]?.content?.parts || []) {
      if (part.inlineData) {
        let url = `data:${part.inlineData.mimeType || 'image/png'};base64,${part.inlineData.data}`;

        // Remove background for characters
        if (type === 'character') {
          try {
            // imgly requires a blob or url, we convert the base64 data to blob
            const blobResponse = await fetch(url);
            const blob = await blobResponse.blob();

            // process an image to remove background
            const transparentBlob = await removeBackground(blob);

            // convert it back to data URL for our frontend components
            url = await new Promise((resolve, reject) => {
              const reader = new FileReader();
              reader.onloadend = () => resolve(reader.result as string);
              reader.onerror = reject;
              reader.readAsDataURL(transparentBlob);
            });
          } catch (err) {
            console.error("Background removal failed, falling back to original image", err);
          }
        }

        // Save image to local filesystem via dev server plugin
        if (currentRunId) {
          const fileName = buildImageFileName(type, prompt, fileKey);

          fetch('/api/save-file', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              runId: currentRunId,
              fileName,
              base64Data: url
            })
          }).catch(err => console.error('Failed to auto-save image locally:', err));
        }

        imageCache.set(cacheKey, url);
        pendingRequests.delete(cacheKey);
        return url;
      }
    }
    pendingRequests.delete(cacheKey);
    throw new Error("No image generated");
  }).catch(err => {
    pendingRequests.delete(cacheKey);
    throw err;
  });

  pendingRequests.set(cacheKey, request);
  return request;
}

function stripDirectionFromPrompt(prompt: string): string {
  return prompt.replace(/facing right|looking right/gi, '').replace(/\s{2,}/g, ' ').trim();
}

export async function preloadFirstCombatImages(runData: RunData): Promise<void> {
  const promises: Promise<string>[] = [];

  // Background
  promises.push(generateGameImage(`A scenic, atmospheric background for a fantasy battle, ${runData.theme} theme, featuring a very wide and prominent flat floor covering the bottom third of the image, 2D digital art`, 'background').catch(e => { console.error('Failed to preload background', e); return ''; }));

  // Player portrait and sprite
  promises.push(generateGameImage(`A character portrait of a rogue-like main character, dark hood mask, 2D vector art, close up`, 'character').catch(e => { console.error('Failed to preload player portrait', e); return ''; }));
  promises.push(generateGameImage(`A character sprite of a heroic protagonist, facing right, looking right, side profile, standing on a solid green background (#00FF00), rogue-like main character, 2D vector art, ${runData.theme} theme`, 'character').catch(e => { console.error('Failed to preload player sprite', e); return ''; }));

  // First enemy sprite
  if (runData.enemies.length > 0 && runData.enemies[0].imagePrompt) {
    promises.push(generateGameImage(`A character sprite of ${stripDirectionFromPrompt(runData.enemies[0].imagePrompt)}, facing left, looking left, side profile, standing on a solid green background (#00FF00), enemy character, 2D vector art`, 'character').catch(e => { console.error('Failed to preload enemy sprite', e); return ''; }));
  }

  // All starting cards
  for (const card of runData.cards) {
    if (card.imagePrompt) {
      promises.push(generateGameImage(card.imagePrompt, 'asset').catch(e => { console.error('Failed to preload card image', e); return ''; }));
    }
  }

  await Promise.all(promises);
}

export async function preloadBackgroundImages(runData: RunData): Promise<void> {
  const promises: Promise<string>[] = [];

  // Remaining enemies (skip first one as it's already preloaded)
  for (let i = 1; i < runData.enemies.length; i++) {
    const enemy = runData.enemies[i];
    if (enemy.imagePrompt) {
      promises.push(generateGameImage(`A character sprite of ${stripDirectionFromPrompt(enemy.imagePrompt)}, facing left, looking left, side profile, standing on a solid green background (#00FF00), enemy character, 2D vector art`, 'character').catch(e => { console.error('Failed to background load enemy sprite', e); return ''; }));
    }
  }

  // Boss
  if (runData.boss && runData.boss.imagePrompt) {
    promises.push(generateGameImage(`A character sprite of ${stripDirectionFromPrompt(runData.boss.imagePrompt)}, facing left, looking left, side profile, standing on a solid green background (#00FF00), massive giant boss enemy character, at least twice as large as the player character, huge scale, 2D vector art`, 'character').catch(e => { console.error('Failed to background load boss sprite', e); return ''; }));
  }

  // We don't await this intentionally so it runs in the background
  Promise.all(promises).catch(e => console.error("Error in background image preload", e));
}

const intentSchema = {
  type: Type.OBJECT,
  properties: {
    type: { type: Type.STRING },
    value: { type: Type.INTEGER },
    secondaryValue: { type: Type.INTEGER },
    description: { type: Type.STRING },
  },
  required: ['type', 'value', 'description'],
};

const cardSchema = {
  type: Type.OBJECT,
  properties: {
    id: { type: Type.STRING },
    name: { type: Type.STRING },
    cost: { type: Type.INTEGER },
    type: { type: Type.STRING },
    description: { type: Type.STRING },
    damage: { type: Type.INTEGER },
    block: { type: Type.INTEGER },
    magicNumber: { type: Type.INTEGER },
    tags: { type: Type.ARRAY, items: { type: Type.STRING } },
    imagePrompt: { type: Type.STRING },
    audioPrompt: { type: Type.STRING },
  },
  required: ['id', 'name', 'cost', 'type', 'description', 'tags', 'imagePrompt', 'audioPrompt'],
};

const enemySchema = {
  type: Type.OBJECT,
  properties: {
    id: { type: Type.STRING },
    name: { type: Type.STRING },
    maxHp: { type: Type.INTEGER },
    currentHp: { type: Type.INTEGER },
    description: { type: Type.STRING },
    imagePrompt: { type: Type.STRING },
    audioPrompt: { type: Type.STRING },
    intents: {
      type: Type.ARRAY,
      items: intentSchema,
    },
  },
  required: ['id', 'name', 'maxHp', 'currentHp', 'description', 'intents', 'imagePrompt', 'audioPrompt'],
};

const bossSchema = {
  type: Type.OBJECT,
  properties: {
    ...enemySchema.properties,
    enrageThreshold: { type: Type.INTEGER },
    phase2Intents: {
      type: Type.ARRAY,
      items: intentSchema,
    },
    narratorText: { type: Type.STRING },
    narratorVoiceStyle: { type: Type.STRING },
    narratorVoiceGender: { type: Type.STRING },
    narratorVoiceAccent: { type: Type.STRING },
  },
  required: [
    'id',
    'name',
    'maxHp',
    'currentHp',
    'description',
    'intents',
    'phase2Intents',
    'enrageThreshold',
    'imagePrompt',
    'audioPrompt',
    'narratorText',
  ],
};

type FileData = { mimeType: string; data: string };

function buildRequestParts(prompt: string, fileData?: FileData, options?: { skipFileData?: boolean }): any[] {
  const parts: any[] = [{ text: prompt }];
  if (fileData && !options?.skipFileData) {
    parts.unshift({
      inlineData: {
        mimeType: fileData.mimeType,
        data: fileData.data,
      }
    });
  }
  return parts;
}

async function requestStructuredJson<T>(
  label: string,
  config: Record<string, any>,
  parts: any[],
): Promise<T> {
  let parsed: T | null = null;
  let lastError: unknown = null;

  for (let attempt = 0; attempt < RUN_DATA_MAX_ATTEMPTS; attempt++) {
    const model = RUN_DATA_MODELS[Math.min(attempt, RUN_DATA_MODELS.length - 1)];
    const retryHintPart = attempt > 0
      ? [{
        text: 'Retry because previous output was invalid JSON. Return only strict JSON, no markdown fences, no extra commentary.'
      }]
      : [];

    const response = await ai.models.generateContent({
      model,
      contents: { parts: [...parts, ...retryHintPart] },
      config,
    });

    const text = response.text;
    if (!text) {
      lastError = new Error(`${label}: no response text`);
      continue;
    }

    const candidates = collectJsonCandidates(text);
    for (const candidate of candidates) {
      try {
        parsed = JSON.parse(candidate) as T;
        break;
      } catch (err) {
        lastError = err;
      }
    }

    if (parsed) break;
    console.warn(`${label}: attempt ${attempt + 1} returned malformed JSON; retrying...`, lastError);
  }

  if (!parsed) {
    throw new Error(`${label}: failed to parse Gemini JSON after ${RUN_DATA_MAX_ATTEMPTS} attempts: ${errorToMessage(lastError)}`);
  }

  return parsed;
}

function stripDirectionFromPromptSafe(prompt?: string): string {
  return (prompt || '').replace(/facing right|looking right/gi, '').replace(/\s{2,}/g, ' ').trim();
}

function buildDefaultBattleBackgroundPrompt(theme: string): string {
  return `A scenic, atmospheric background for a fantasy battle, ${theme} theme, featuring a very wide and prominent flat floor covering the bottom third of the image, 2D digital art`;
}

function createStrikeCard(theme: string): Card {
  return {
    id: `strike_${toFileSafeKey(theme) || 'starter'}`,
    name: 'Strike',
    cost: 1,
    type: 'Attack',
    description: 'Deal 6 damage.',
    damage: 6,
    tags: ['Starter'],
    imagePrompt: `A sharp basic sword slash on parchment, ${theme} fantasy card art`,
    audioPrompt: 'tempered steel slash through dry parchment',
  };
}

function createDefendCard(theme: string): Card {
  return {
    id: `defend_${toFileSafeKey(theme) || 'starter'}`,
    name: 'Defend',
    cost: 1,
    type: 'Skill',
    description: 'Gain 5 Block.',
    block: 5,
    tags: ['Starter'],
    imagePrompt: `A basic reinforced shield absorbing impact, ${theme} fantasy card art`,
    audioPrompt: 'solid shield impact with muffled iron ring',
  };
}

function normalizeCard(card: Partial<Card> | undefined, fallback: Card): Card {
  if (!card) return fallback;
  const normalizedType = card.type === 'Attack' || card.type === 'Skill' || card.type === 'Power'
    ? card.type
    : fallback.type;
  const safeTags = Array.isArray(card.tags) && card.tags.length > 0 ? card.tags.filter(Boolean) : fallback.tags;
  return {
    ...fallback,
    ...card,
    id: card.id || `${fallback.id}_${nowTs()}`,
    name: card.name || fallback.name,
    cost: Number.isFinite(card.cost as number) ? Number(card.cost) : fallback.cost,
    type: normalizedType,
    description: card.description || fallback.description,
    tags: safeTags,
    imagePrompt: card.imagePrompt || fallback.imagePrompt,
    audioPrompt: card.audioPrompt || fallback.audioPrompt,
  };
}

function normalizeEnemy(enemy: Partial<Enemy> | undefined, theme: string): Enemy {
  const fallback: Enemy = {
    id: `enemy_first_${toFileSafeKey(theme)}`,
    name: 'Wandering Sentinel',
    maxHp: 34,
    currentHp: 34,
    description: 'A vigilant foe guarding the first path.',
    intents: [
      { type: 'Attack', value: 6, description: 'Deal 6 damage.' },
      { type: 'Defend', value: 5, description: 'Gain 5 block.' },
      { type: 'Attack', value: 7, description: 'Deal 7 damage.' },
    ],
    imagePrompt: `a grim armored scout with chipped metal plates, facing left, looking left, side profile, ${theme} style`,
    audioPrompt: 'rusted blade swipe with chain rattle',
  };

  if (!enemy) return fallback;

  return {
    ...fallback,
    ...enemy,
    id: enemy.id || fallback.id,
    name: enemy.name || fallback.name,
    maxHp: Math.max(1, Number(enemy.maxHp) || fallback.maxHp),
    currentHp: Math.max(1, Number(enemy.maxHp) || Number(enemy.currentHp) || fallback.currentHp),
    description: enemy.description || fallback.description,
    intents: Array.isArray(enemy.intents) && enemy.intents.length > 0 ? enemy.intents : fallback.intents,
    imagePrompt: enemy.imagePrompt || fallback.imagePrompt,
    audioPrompt: enemy.audioPrompt || fallback.audioPrompt,
  };
}

function defaultSynergyFromCard(card: Card): Synergy {
  const tag = card.tags?.[0] || 'Starter';
  return {
    name: 'Opening Rhythm',
    tag,
    threshold: 2,
    effect: 'Damage',
    value: 4,
    description: `Play 2 ${tag} cards in one turn to deal 4 bonus damage.`,
  };
}

function createPlaceholderBoss(theme: string): Boss {
  return {
    id: `boss_placeholder_${toFileSafeKey(theme)}`,
    name: 'The Hidden Tyrant',
    maxHp: 220,
    currentHp: 220,
    description: 'A placeholder boss awaiting full generation.',
    enrageThreshold: 45,
    intents: [
      { type: 'Attack', value: 18, description: 'Deal 18 damage.' },
      { type: 'Defend', value: 12, description: 'Gain 12 block.' },
      { type: 'AttackBuff', value: 14, secondaryValue: 2, description: 'Deal 14 damage and gain 2 Strength.' },
    ],
    phase2Intents: [
      { type: 'Attack', value: 24, description: 'Deal 24 damage.' },
      { type: 'AttackDefend', value: 16, secondaryValue: 10, description: 'Deal 16 damage and gain 10 block.' },
    ],
    imagePrompt: `a colossal tyrant in ornate armor, facing left, looking left, side profile, ${theme} style`,
    audioPrompt: 'massive armored stomp with metal resonance',
    narratorText: 'You have reached the gate, but not the throne.',
    narratorVoiceStyle: 'cold imperial authority',
    narratorVoiceGender: 'neutral',
  };
}

function getFirstCombatNode(nodeMap: MapNode[]): MapNode | undefined {
  return nodeMap.find(node => node.row === 0 && node.type === 'Combat') || nodeMap.find(node => node.type === 'Combat');
}

function mergeUniqueCards(existing: Card[], incoming: Card[]): Card[] {
  const byId = new Map(existing.map(card => [card.id, card]));
  for (const card of incoming) {
    if (!byId.has(card.id)) byId.set(card.id, card);
  }
  return Array.from(byId.values());
}

function mergeUniqueEnemies(existing: Enemy[], incoming: Enemy[]): Enemy[] {
  const byId = new Map(existing.map(enemy => [enemy.id, enemy]));
  for (const enemy of incoming) {
    if (!byId.has(enemy.id)) byId.set(enemy.id, enemy);
  }
  return Array.from(byId.values());
}

export async function generateRunBootstrap(
  prompt: string,
  fileData?: FileData,
  settings: GenerationSettings = { mode: 'fast_start', prefetchDepth: 2 },
  options?: { skipFileData?: boolean },
): Promise<RunDataV2> {
  currentRunId = Date.now().toString();
  const parts = buildRequestParts(prompt, fileData, options);

  const config = {
    systemInstruction: `You are an expert game designer for a Slay the Spire-style roguelike deckbuilder.
Generate ONLY the minimal bootstrap package needed to start the first combat quickly.
Return strictly valid JSON matching the schema.
Constraints:
- strike card MUST be Attack cost 1 damage 6 with simple text.
- defend card MUST be Skill cost 1 block 5 with simple text.
- uniqueCard must be a distinct non-starter card.
- firstEnemy must be a basic early enemy suitable for floor 1.
- roomMusicPrompt must be short and thematic.
- essentialSfxPrompts should include 4 concise prompts: strike, defend, unique card, first enemy.`,
    responseMimeType: 'application/json',
    responseSchema: {
      type: Type.OBJECT,
      properties: {
        theme: { type: Type.STRING },
        strike: cardSchema,
        defend: cardSchema,
        uniqueCard: cardSchema,
        firstEnemy: enemySchema,
        roomMusicPrompt: { type: Type.STRING },
        essentialSfxPrompts: { type: Type.ARRAY, items: { type: Type.STRING } },
      },
      required: ['theme', 'strike', 'defend', 'uniqueCard', 'firstEnemy', 'roomMusicPrompt'],
    },
  };

  const parsed = await requestStructuredJson<{
    theme: string;
    strike: Partial<Card>;
    defend: Partial<Card>;
    uniqueCard: Partial<Card>;
    firstEnemy: Partial<Enemy>;
    roomMusicPrompt?: string;
    essentialSfxPrompts?: string[];
  }>('generateRunBootstrap', config, parts);

  const theme = parsed.theme || 'Dark Fantasy';
  const strike = normalizeCard(parsed.strike, createStrikeCard(theme));
  strike.name = 'Strike';
  strike.type = 'Attack';
  strike.cost = 1;
  strike.damage = 6;
  strike.description = 'Deal 6 damage.';

  const defend = normalizeCard(parsed.defend, createDefendCard(theme));
  defend.name = 'Defend';
  defend.type = 'Skill';
  defend.cost = 1;
  defend.block = 5;
  defend.description = 'Gain 5 Block.';

  const uniqueFallback: Card = {
    id: `unique_${toFileSafeKey(theme)}`,
    name: 'Rising Tempo',
    cost: 1,
    type: 'Attack',
    description: 'Deal 8 damage. Draw 1 card.',
    damage: 8,
    tags: ['Rhythm'],
    imagePrompt: `a card depicting a rising arc of energy, ${theme} style`,
    audioPrompt: 'surging arcane pulse with crisp impact',
  };
  const uniqueCard = normalizeCard(parsed.uniqueCard, uniqueFallback);
  if (uniqueCard.name.toLowerCase() === 'strike' || uniqueCard.name.toLowerCase() === 'defend') {
    uniqueCard.name = `${uniqueCard.name} Prime`;
  }

  const firstEnemy = normalizeEnemy(parsed.firstEnemy, theme);
  const roomMusicPrompt = parsed.roomMusicPrompt || 'tense strings over restrained percussion heartbeat';

  const starterCards: [Card, Card, Card] = [strike, defend, uniqueCard];
  const bootstrap = {
    theme,
    starterCards,
    firstEnemy,
    roomMusicPrompt,
    essentialSfxPrompts: parsed.essentialSfxPrompts || [
      strike.audioPrompt || 'tempered steel slash through dry parchment',
      defend.audioPrompt || 'solid shield impact with muffled iron ring',
      uniqueCard.audioPrompt || 'surging arcane pulse with crisp impact',
      firstEnemy.audioPrompt || 'rusted blade swipe with chain rattle',
    ]
  };

  const placeholderBoss = createPlaceholderBoss(theme);
  const legacySeed: RunDataLegacy = {
    theme,
    cards: starterCards,
    enemies: [firstEnemy],
    boss: placeholderBoss,
    synergies: [defaultSynergyFromCard(uniqueCard)],
    roomMusicPrompt,
    bossMusicPrompt: 'ominous low choir with heavy taiko pulse',
  };

  const node_map = generateFallbackNodeMap(legacySeed);
  const firstCombatNode = getFirstCombatNode(node_map);

  if (firstCombatNode) {
    firstCombatNode.data = firstEnemy;
  }

  const rooms: RunDataV2['rooms'] = {};
  const createdAt = nowTs();
  node_map.forEach(node => {
    rooms[node.id] = {
      status: 'queued',
      lastUpdatedAt: createdAt,
    };
  });

  if (firstCombatNode) {
    const firstPayload: CombatRoomContent = {
      roomId: firstCombatNode.id,
      nodeType: firstCombatNode.type === 'Elite' ? 'Elite' : 'Combat',
      enemy: firstEnemy,
      rewardCards: [uniqueCard],
      backgroundPrompt: buildDefaultBattleBackgroundPrompt(theme),
      roomMusicPrompt,
    };
    rooms[firstCombatNode.id] = {
      status: 'ready',
      lastUpdatedAt: createdAt,
      payload: firstPayload,
    };
  }

  const runData: RunDataV2 = {
    version: 2,
    generationSettings: {
      mode: settings.mode || 'fast_start',
      prefetchDepth: settings.prefetchDepth ?? 2,
    },
    theme,
    cards: starterCards,
    enemies: [firstEnemy],
    boss: placeholderBoss,
    synergies: [defaultSynergyFromCard(uniqueCard)],
    node_map,
    roomMusicPrompt,
    bossMusicPrompt: 'ominous low choir with heavy taiko pulse',
    rooms,
    bootstrap,
    gold: 100,
  };

  void saveRunSnapshot(runData);
  return runData;
}

function getRoomPromptContext(runData: RunDataV2): string {
  const cards = runData.cards.map(card => `${card.name} (${card.type})`).join(', ');
  return `Theme: ${runData.theme}. Known cards: ${cards}.`;
}

async function generateCombatRoomPayload(runData: RunDataV2, node: MapNode): Promise<CombatRoomContent> {
  const config = {
    systemInstruction: `Generate content for a single roguelike combat room. Return strict JSON.`,
    responseMimeType: 'application/json',
    responseSchema: {
      type: Type.OBJECT,
      properties: {
        enemy: enemySchema,
        rewardCards: { type: Type.ARRAY, items: cardSchema, minItems: 1, maxItems: 3 },
        backgroundPrompt: { type: Type.STRING },
        roomMusicPrompt: { type: Type.STRING },
      },
      required: ['enemy', 'rewardCards', 'backgroundPrompt'],
    },
  };

  const parts = [{ text: `Room type: ${node.type}. ${getRoomPromptContext(runData)} Generate an enemy and up to 3 reward cards.` }];
  try {
    const parsed = await requestStructuredJson<{
      enemy: Partial<Enemy>;
      rewardCards: Partial<Card>[];
      backgroundPrompt?: string;
      roomMusicPrompt?: string;
    }>('generateCombatRoomPayload', config, parts);

    let enemy = normalizeEnemy(parsed.enemy, runData.theme);
    if (node.type === 'Elite') {
      enemy = {
        ...enemy,
        id: `elite_${enemy.id}`,
        name: `Ascended ${enemy.name}`,
        maxHp: Math.round(enemy.maxHp * 1.5),
        currentHp: Math.round(enemy.maxHp * 1.5),
      };
    }

    const fallbackReward = runData.cards[2] || runData.cards[0];
    const rewardCards = (parsed.rewardCards || []).slice(0, 3).map((card, idx) => normalizeCard(card, {
      ...fallbackReward,
      id: `${fallbackReward.id}_reward_${idx}`,
    }));

    return {
      roomId: node.id,
      nodeType: node.type === 'Elite' ? 'Elite' : 'Combat',
      enemy,
      rewardCards: rewardCards.length > 0 ? rewardCards : [fallbackReward],
      backgroundPrompt: parsed.backgroundPrompt || buildDefaultBattleBackgroundPrompt(runData.theme),
      roomMusicPrompt: parsed.roomMusicPrompt || runData.roomMusicPrompt,
    };
  } catch (err) {
    console.error('generateCombatRoomPayload fallback:', err);
    const fallbackEnemy = runData.enemies[0] || normalizeEnemy(undefined, runData.theme);
    return {
      roomId: node.id,
      nodeType: node.type === 'Elite' ? 'Elite' : 'Combat',
      enemy: node.type === 'Elite'
        ? {
          ...fallbackEnemy,
          id: `elite_${fallbackEnemy.id}`,
          name: `Ascended ${fallbackEnemy.name}`,
          maxHp: Math.round(fallbackEnemy.maxHp * 1.5),
          currentHp: Math.round(fallbackEnemy.maxHp * 1.5),
        }
        : fallbackEnemy,
      rewardCards: [runData.cards[2] || runData.cards[0]].filter(Boolean),
      backgroundPrompt: buildDefaultBattleBackgroundPrompt(runData.theme),
      roomMusicPrompt: runData.roomMusicPrompt,
    };
  }
}

async function generateBossRoomPayload(runData: RunDataV2, node: MapNode): Promise<RoomContentPayload> {
  const config = {
    systemInstruction: `Generate content for a single roguelike boss room. Return strict JSON.`,
    responseMimeType: 'application/json',
    responseSchema: {
      type: Type.OBJECT,
      properties: {
        boss: bossSchema,
        backgroundPrompt: { type: Type.STRING },
        bossMusicPrompt: { type: Type.STRING },
      },
      required: ['boss', 'backgroundPrompt', 'bossMusicPrompt'],
    },
  };

  const parts = [{ text: `Room type: Boss. ${getRoomPromptContext(runData)} Create a dramatic boss encounter.` }];
  try {
    const parsed = await requestStructuredJson<{ boss: Partial<Boss>; backgroundPrompt?: string; bossMusicPrompt?: string }>(
      'generateBossRoomPayload',
      config,
      parts
    );
    const fallback = runData.boss || createPlaceholderBoss(runData.theme);
    const boss: Boss = {
      ...fallback,
      ...parsed.boss,
      maxHp: Math.max(120, Number(parsed.boss?.maxHp) || fallback.maxHp),
      currentHp: Math.max(120, Number(parsed.boss?.maxHp) || Number(parsed.boss?.currentHp) || fallback.maxHp),
      intents: parsed.boss?.intents && parsed.boss.intents.length > 0 ? parsed.boss.intents : fallback.intents,
      phase2Intents: parsed.boss?.phase2Intents && parsed.boss.phase2Intents.length > 0 ? parsed.boss.phase2Intents : fallback.phase2Intents,
    };
    return {
      roomId: node.id,
      nodeType: 'Boss',
      boss,
      backgroundPrompt: parsed.backgroundPrompt || buildDefaultBattleBackgroundPrompt(runData.theme),
      bossMusicPrompt: parsed.bossMusicPrompt || runData.bossMusicPrompt || 'ominous low choir with heavy taiko pulse',
    };
  } catch (err) {
    console.error('generateBossRoomPayload fallback:', err);
    return {
      roomId: node.id,
      nodeType: 'Boss',
      boss: runData.boss || createPlaceholderBoss(runData.theme),
      backgroundPrompt: buildDefaultBattleBackgroundPrompt(runData.theme),
      bossMusicPrompt: runData.bossMusicPrompt || 'ominous low choir with heavy taiko pulse',
    };
  }
}

async function generateEventRoomPayload(runData: RunDataV2, node: MapNode): Promise<EventRoomContent> {
  const config = {
    systemInstruction: `Generate content for a single roguelike event room. Return strict JSON with exactly 3 choices.`,
    responseMimeType: 'application/json',
    responseSchema: {
      type: Type.OBJECT,
      properties: {
        title: { type: Type.STRING },
        description: { type: Type.STRING },
        imagePrompt: { type: Type.STRING },
        footerText: { type: Type.STRING },
        choices: {
          type: Type.ARRAY,
          minItems: 3,
          maxItems: 3,
          items: {
            type: Type.OBJECT,
            properties: {
              id: { type: Type.STRING },
              label: { type: Type.STRING },
              description: { type: Type.STRING },
              icon: { type: Type.STRING },
              color: { type: Type.STRING },
              effects: {
                type: Type.OBJECT,
                properties: {
                  hpDelta: { type: Type.INTEGER },
                  maxHpDelta: { type: Type.INTEGER },
                  goldDelta: { type: Type.INTEGER },
                  addCard: cardSchema,
                },
              }
            },
            required: ['id', 'label', 'description', 'effects'],
          },
        },
      },
      required: ['title', 'description', 'imagePrompt', 'choices'],
    },
  };

  const parts = [{ text: `Room type: Event. ${getRoomPromptContext(runData)} Build a thematic narrative event with exactly 3 meaningful choices.` }];
  try {
    const parsed = await requestStructuredJson<{
      title: string;
      description: string;
      imagePrompt: string;
      footerText?: string;
      choices: EventChoicePayload[];
    }>('generateEventRoomPayload', config, parts);
    return {
      roomId: node.id,
      nodeType: 'Event',
      title: parsed.title,
      description: parsed.description,
      imagePrompt: parsed.imagePrompt,
      footerText: parsed.footerText || 'Choose wisely.',
      choices: (parsed.choices || []).slice(0, 3),
    };
  } catch (err) {
    console.error('generateEventRoomPayload fallback:', err);
    return {
      roomId: node.id,
      nodeType: 'Event',
      title: 'The Silent Altar',
      description: 'A weathered altar glows faintly as you approach.',
      imagePrompt: `ancient glowing altar in a ruined hall, ${runData.theme} style`,
      footerText: 'Fate listens.',
      choices: [
        {
          id: 'altar-heal',
          label: 'Offer a vow',
          description: 'Heal 10 HP.',
          icon: 'fire',
          color: 'red',
          effects: { hpDelta: 10 },
        },
        {
          id: 'altar-gold',
          label: 'Take hidden coins',
          description: 'Gain 25 gold.',
          icon: 'gold',
          color: 'orange',
          effects: { goldDelta: 25 },
        },
        {
          id: 'altar-card',
          label: 'Study the runes',
          description: 'Add a card to your deck.',
          icon: 'shield',
          color: 'blue',
          effects: { addCard: runData.cards[2] || runData.cards[0] },
        },
      ],
    };
  }
}

async function generateShopRoomPayload(runData: RunDataV2, node: MapNode): Promise<ShopRoomContent> {
  const config = {
    systemInstruction: `Generate content for a single roguelike shop room. Return strict JSON with 3 shop cards.`,
    responseMimeType: 'application/json',
    responseSchema: {
      type: Type.OBJECT,
      properties: {
        shopCards: {
          type: Type.ARRAY,
          minItems: 3,
          maxItems: 3,
          items: cardSchema,
        },
      },
      required: ['shopCards'],
    },
  };

  const parts = [{ text: `Room type: Shop. ${getRoomPromptContext(runData)} Create three purchasable cards.` }];
  try {
    const parsed = await requestStructuredJson<{ shopCards: Partial<Card>[] }>('generateShopRoomPayload', config, parts);
    const fallback = runData.cards[2] || runData.cards[0];
    const cards = (parsed.shopCards || []).slice(0, 3).map((card, idx) => normalizeCard(card, {
      ...fallback,
      id: `${fallback.id}_shop_${idx}`,
    }));
    return {
      roomId: node.id,
      nodeType: 'Shop',
      shopCards: cards.length > 0 ? cards : [fallback],
    };
  } catch (err) {
    console.error('generateShopRoomPayload fallback:', err);
    const fallbackPool = runData.cards.filter(card => {
      const n = card.name.trim().toLowerCase();
      return n !== 'strike' && n !== 'defend';
    });
    return {
      roomId: node.id,
      nodeType: 'Shop',
      shopCards: (fallbackPool.length > 0 ? fallbackPool : runData.cards).slice(0, 3),
    };
  }
}

export async function generateRoomContent(runData: RunDataV2, node: MapNode): Promise<RoomContentPayload> {
  if (node.type === 'Combat' || node.type === 'Elite') {
    return generateCombatRoomPayload(runData, node);
  }
  if (node.type === 'Boss') {
    return generateBossRoomPayload(runData, node);
  }
  if (node.type === 'Event') {
    return generateEventRoomPayload(runData, node);
  }
  if (node.type === 'Shop') {
    return generateShopRoomPayload(runData, node);
  }
  if (node.type === 'Treasure') {
    return {
      roomId: node.id,
      nodeType: 'Treasure',
      treasureGold: 100,
    };
  }
  return {
    roomId: node.id,
    nodeType: 'Campfire',
  };
}

export async function preloadEssentialImages(runData: RunData | RunDataV2): Promise<void> {
  const theme = runData.theme;
  const cards = runData.cards.slice(0, 3);
  const firstEnemy = runData.enemies[0];
  const promises: Promise<string>[] = [];

  promises.push(
    generateGameImage(buildDefaultBattleBackgroundPrompt(theme), 'background')
      .catch(e => { console.error('Failed to preload essential background', e); return ''; })
  );
  promises.push(
    generateGameImage('A character portrait of a rogue-like main character, dark hood mask, 2D vector art, close up', 'character')
      .catch(e => { console.error('Failed to preload essential player portrait', e); return ''; })
  );
  promises.push(
    generateGameImage(`A character sprite of a heroic protagonist, facing right, looking right, side profile, standing on a solid green background (#00FF00), rogue-like main character, 2D vector art, ${theme} theme`, 'character')
      .catch(e => { console.error('Failed to preload essential player sprite', e); return ''; })
  );

  if (firstEnemy?.imagePrompt) {
    promises.push(
      generateGameImage(
        `A character sprite of ${firstEnemy.imagePrompt}, facing left, looking left, side profile, standing on a solid green background (#00FF00), enemy character, 2D vector art`,
        'character'
      ).catch(e => { console.error('Failed to preload essential first enemy sprite', e); return ''; })
    );
  }

  cards.forEach((card) => {
    if (card.imagePrompt) {
      promises.push(generateGameImage(card.imagePrompt, 'asset').catch(e => {
        console.error('Failed to preload essential card image', e);
        return '';
      }));
    }
  });

  await Promise.all(promises);
}

export async function preloadRoomImages(runData: RunDataV2, roomId: string, payload: RoomContentPayload): Promise<void> {
  const promises: Promise<string>[] = [];

  if (payload.nodeType === 'Combat' || payload.nodeType === 'Elite') {
    if (payload.backgroundPrompt) {
      promises.push(generateGameImage(payload.backgroundPrompt, 'background').catch(() => ''));
    }
    if (payload.enemy?.imagePrompt) {
      promises.push(generateGameImage(
        `A character sprite of ${payload.enemy.imagePrompt}, facing left, looking left, side profile, standing on a solid green background (#00FF00), enemy character, 2D vector art`,
        'character'
      ).catch(() => ''));
    }
    (payload.rewardCards || []).forEach((card) => {
      if (card.imagePrompt) {
        promises.push(generateGameImage(card.imagePrompt, 'asset').catch(() => ''));
      }
    });
  } else if (payload.nodeType === 'Boss') {
    if (payload.backgroundPrompt) {
      promises.push(generateGameImage(payload.backgroundPrompt, 'background').catch(() => ''));
    }
    if (payload.boss?.imagePrompt) {
      promises.push(generateGameImage(
        `A character sprite of ${payload.boss.imagePrompt}, facing left, looking left, side profile, standing on a solid green background (#00FF00), massive giant boss enemy character, at least twice as large as the player character, huge scale, 2D vector art`,
        'character'
      ).catch(() => ''));
    }
  } else if (payload.nodeType === 'Event') {
    if (payload.imagePrompt) {
      promises.push(generateGameImage(payload.imagePrompt, 'background').catch(() => ''));
    }
  } else if (payload.nodeType === 'Shop') {
    payload.shopCards.forEach((card) => {
      if (card.imagePrompt) {
        promises.push(generateGameImage(card.imagePrompt, 'asset').catch(() => ''));
      }
    });
  }

  if (promises.length === 0) return;
  await Promise.all(promises);
}

export function applyRoomContentToRunData(runData: RunDataV2, roomId: string, payload: RoomContentPayload): RunDataV2 {
  const now = nowTs();
  const next = {
    ...runData,
    cards: runData.cards,
    enemies: runData.enemies,
    rooms: {
      ...runData.rooms,
      [roomId]: {
        status: 'ready' as const,
        lastUpdatedAt: now,
        payload,
      },
    },
    node_map: runData.node_map.map(node => ({ ...node })),
  };

  if (payload.nodeType === 'Combat' || payload.nodeType === 'Elite') {
    next.cards = mergeUniqueCards(next.cards, payload.rewardCards || []);
    next.enemies = mergeUniqueEnemies(next.enemies, [payload.enemy]);
    next.roomMusicPrompt = payload.roomMusicPrompt || next.roomMusicPrompt;
    const node = next.node_map.find(n => n.id === roomId);
    if (node) node.data = payload.enemy;
  }

  if (payload.nodeType === 'Boss') {
    next.boss = payload.boss;
    next.bossMusicPrompt = payload.bossMusicPrompt || next.bossMusicPrompt;
    const node = next.node_map.find(n => n.id === roomId);
    if (node) node.data = payload.boss;
  }

  if (payload.nodeType === 'Event') {
    const addCards = payload.choices
      .map(choice => choice.effects?.addCard)
      .filter((card): card is Card => Boolean(card));
    if (addCards.length > 0) {
      next.cards = mergeUniqueCards(next.cards, addCards);
    }
  }

  if (payload.nodeType === 'Shop') {
    next.cards = mergeUniqueCards(next.cards, payload.shopCards || []);
  }

  return next;
}
