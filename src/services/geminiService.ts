import { GoogleGenAI, Type, GenerateContentResponse } from '@google/genai';
import { RunData } from '../../shared/types/game';
import { removeBackground } from '@imgly/background-removal';

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

let currentRunId = '';

export function getCurrentRunId(): string {
  return currentRunId;
}

export function setCurrentRunId(id: string) {
  currentRunId = id;
}

export async function generateRunData(prompt: string, fileData?: { mimeType: string; data: string }): Promise<RunData> {
  currentRunId = Date.now().toString();
  const parts: any[] = [{ text: prompt }];

  if (fileData) {
    parts.unshift({
      inlineData: {
        mimeType: fileData.mimeType,
        data: fileData.data,
      }
    });
  }

  const response = await ai.models.generateContent({
    model: 'gemini-3-flash-preview',
    contents: { parts },
    config: {
      systemInstruction: `You are an expert game designer for a Slay the Spire-style roguelike deckbuilder.
Based on the user's input (theme, text, or image), generate a complete set of game data.
The game should be balanced, thematic, and fun.
Create exactly 7 cards in total. The first card MUST be named 'Strike' (type Attack, 1 cost, 6 damage, no special effects). The second card MUST be named 'Defend' (type Skill, 1 cost, 5 block, no special effects). The remaining 5 cards should be unique special cards (mix of Attack, Skill, Power).
Also create exactly 4 unique normal enemies (ranging from simple to elite difficulty), 1 boss, and 1 synergy rule.
Enemies do not use a deck of cards. Instead, their actions are dictated by a fixed sequence of 'intents' that loops. Simple enemies should have a sequence of 2-3 intents, medium 3-4, elite 3-5, and the boss 4-7 intents.
Intents can be simple (Attack, Defend, Buff, Debuff, Unknown) or combined (AttackDefend, AttackDebuff, AttackBuff). Use 'value' for the primary amount (e.g. damage), and 'secondaryValue' for the secondary effect (e.g. block amount or debuff stacks).
If a card applies 'Vulnerable', use the 'magicNumber' field to specify how many stacks.
For audio, follow the thematic instructions provided by the user (or extrapolate based on Cooking, Legal, Science themes).
Boss must include a 'narratorText' which is a dramatic opening line the boss will say when encountered.
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
                audioPrompt: { type: Type.STRING, description: 'A description for elevenlabs sound effect generation (e.g. "Sword clash", "Magic spell")' }
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
                audioPrompt: { type: Type.STRING, description: 'A description for elevenlabs sound effect of the enemy attacking' },
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
              audioPrompt: { type: Type.STRING, description: 'A description for a boss attacking sound effect' },
              narratorText: { type: Type.STRING, description: 'A dramatic opening dialogue line for the boss via text-to-speech module' },
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
          roomMusicPrompt: { type: Type.STRING, description: 'Brief description for the normal combat background music' },
          bossMusicPrompt: { type: Type.STRING, description: 'Brief description for the boss combat background music' }
        },
        required: ['theme', 'cards', 'enemies', 'boss', 'synergies', 'roomMusicPrompt', 'bossMusicPrompt']
      }
    }
  });

  const text = response.text;
  if (!text) {
    throw new Error('No response from Gemini');
  }

  const runData = JSON.parse(text) as RunData;
  fetch('/api/save-run', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ runId: currentRunId, runData })
  }).catch(err => console.error('Failed to auto-save run data locally:', err));

  return runData;
}

const imageCache = new Map<string, string>();
const pendingRequests = new Map<string, Promise<string>>();

export async function generateGameImage(prompt: string, type: 'asset' | 'background' | 'character' = 'asset'): Promise<string> {
  const cacheKey = `${type}:${prompt}`;
  if (imageCache.has(cacheKey)) {
    return imageCache.get(cacheKey)!;
  }

  if (pendingRequests.has(cacheKey)) {
    return pendingRequests.get(cacheKey)!;
  }

  if (currentRunId) {
    const sanitizedPrompt = prompt.replace(/[^a-z0-9]/gi, '_').toLowerCase().substring(0, 50);
    const fileName = `${type}_${sanitizedPrompt}.png`;
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
          const sanitizedPrompt = prompt.replace(/[^a-z0-9]/gi, '_').toLowerCase().substring(0, 50);
          const fileName = `${type}_${sanitizedPrompt}.png`;

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
