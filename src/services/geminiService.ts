import { GoogleGenAI, Type, GenerateContentResponse } from '@google/genai';
import { RunData } from '../../shared/types/game';
import { removeBackground } from '@imgly/background-removal';

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

export async function generateRunData(prompt: string, fileData?: { mimeType: string; data: string }): Promise<RunData> {
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
Create 5 cards (mix of Attack, Skill, Power), 2 normal enemies, 1 boss, and 1 synergy rule.
Cards should cost between 0 and 3 energy.
Player starts with 50 HP and 3 Energy.
If a card applies 'Vulnerable', use the 'magicNumber' field to specify how many stacks.
Return the data strictly matching the provided JSON schema.`,
      responseMimeType: 'application/json',
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          theme: { type: Type.STRING, description: 'The overall theme of the run' },
          cards: {
            type: Type.ARRAY,
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
                imagePrompt: { type: Type.STRING, description: 'A visual description of the card for image generation' }
              },
              required: ['id', 'name', 'cost', 'type', 'description', 'tags', 'imagePrompt']
            }
          },
          enemies: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                id: { type: Type.STRING },
                name: { type: Type.STRING },
                maxHp: { type: Type.INTEGER },
                currentHp: { type: Type.INTEGER },
                description: { type: Type.STRING },
                imagePrompt: { type: Type.STRING, description: 'A visual description of the enemy for image generation' },
                intents: {
                  type: Type.ARRAY,
                  items: {
                    type: Type.OBJECT,
                    properties: {
                      type: { type: Type.STRING, description: 'Attack, Defend, Buff, or Debuff' },
                      value: { type: Type.INTEGER },
                      description: { type: Type.STRING }
                    },
                    required: ['type', 'value', 'description']
                  }
                }
              },
              required: ['id', 'name', 'maxHp', 'currentHp', 'description', 'intents', 'imagePrompt']
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
              imagePrompt: { type: Type.STRING, description: 'A visual description of the boss for image generation' },
              enrageThreshold: { type: Type.INTEGER, description: 'Percentage HP (0-100) when phase 2 starts' },
              intents: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    type: { type: Type.STRING },
                    value: { type: Type.INTEGER },
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
                    type: { type: Type.STRING },
                    value: { type: Type.INTEGER },
                    description: { type: Type.STRING }
                  },
                  required: ['type', 'value', 'description']
                }
              }
            },
            required: ['id', 'name', 'maxHp', 'currentHp', 'description', 'enrageThreshold', 'intents', 'phase2Intents', 'imagePrompt']
          },
          synergies: {
            type: Type.ARRAY,
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
          }
        },
        required: ['theme', 'cards', 'enemies', 'boss', 'synergies']
      }
    }
  });

  const text = response.text;
  if (!text) {
    throw new Error('No response from Gemini');
  }

  return JSON.parse(text) as RunData;
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

  let prefix = "A 2D vector art style game asset, clean lines, flat colors, highly detailed, fantasy game UI element. ";
  if (type === 'background') {
    prefix = "A 2D video game combat stage background, side-scrolling perspective, must include a distinct flat floor or ground area at the bottom for characters to stand on, clean lines, flat colors, highly detailed. ";
  } else if (type === 'character') {
    prefix = "A 2D video game character sprite, clean lines, flat colors, solid white background, highly detailed, isolated. ";
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
