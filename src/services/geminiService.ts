import { GoogleGenAI, Type } from '@google/genai';
import {
  Boss,
  Card,
  Enemy,
  GeneratedObjectManifestEntry,
  ImageObjectType,
  Intent,
  GenerationSettings,
  isRunDataV2,
  MapNode,
  MusicModeType,
  AudioSourceType,
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
import { inferEnemyIsFlying } from '../../shared/utils/enemy';
import { removeBackground } from '@imgly/background-removal';
import { generateFallbackNodeMap } from '../engine/mapGenerator';

const ai = process.env.GEMINI_API_KEY
  ? new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY })
  : (null as unknown as GoogleGenAI);
const TEXT_MODELS = ['mistral-large-latest', 'mistral-small-latest'] as const;
const RUN_DATA_MAX_ATTEMPTS = 3;

let currentRunId = '';

const GLOBAL_ROOM_ID = 'global';
const ORIENTATION_DESCRIPTOR_PATTERNS = [
  /\b(facing|looking)\s+(?:toward(?:s)?\s+)?(?:the\s+)?(?:left|right)\b/gi,
  /\b(?:left|right)[-\s](?:facing|looking)\b/gi,
  /\b(?:front|frontal|back|rear)\s+view\b/gi,
  /\b(?:three[-\s]?quarter|3\/4)\s+view\b/gi,
  /\b(?:left|right|side)\s+profile\b/gi,
];
const BATTLE_STAGE_FLOOR_PROMPT_RULE = 'Include one continuous, straight, horizontal battle platform at a fixed height across the full image width, around the lower third. This platform is the ground line where both player and ground enemies stand. Keep this ground level consistent across all rooms. Do not tilt, curve, split, or break the platform near the combat area. The region below the platform must stay visually readable with floor continuation, texture, reflections, or environment detail. Never render the lower area as a pure black strip, empty void, or heavy blackout gradient.';
const CARD_IMAGE_PROMPT_RULE = 'Describe only the inner artwork scene for a card. No full card layout, no border or frame, no title ribbon, no badges, no mana gem, no UI, no letters, no numbers, no logo, and no watermark.';
const ASSET_IMAGE_PROMPT_VERSION = 'card_art_v2';

function normalizeCardAssetPrompt(prompt: string): string {
  const base = (prompt || '').trim();
  if (!base) return CARD_IMAGE_PROMPT_RULE;
  const lower = base.toLowerCase();
  if (lower.includes('inner artwork scene') || lower.includes('no full card layout')) {
    return base;
  }
  return `${base}. ${CARD_IMAGE_PROMPT_RULE}`;
}

export function getCurrentRunId(): string {
  return currentRunId;
}

export function setCurrentRunId(id: string) {
  currentRunId = id;
  syncImageCacheScope();
}

function toFileSafeKey(input: string): string {
  return input.replace(/[^a-z0-9]/gi, '_').toLowerCase().substring(0, 80);
}

function nowTs(): number {
  return Date.now();
}

function buildObjectId(roomId: string, kind: 'image' | 'audio', slot: string): string {
  return `${roomId}:${kind}:${toFileSafeKey(slot)}`;
}

function buildObjectFileKey(objectId: string): string {
  return toFileSafeKey(objectId).substring(0, 80);
}

function normalizeSpriteSubjectPrompt(subjectPrompt: string): string {
  let normalized = (subjectPrompt || '').trim();
  for (const pattern of ORIENTATION_DESCRIPTOR_PATTERNS) {
    normalized = normalized.replace(pattern, ' ');
  }
  return normalized
    .replace(/\s+/g, ' ')
    .replace(/\s+,/g, ',')
    .replace(/,\s*,+/g, ', ')
    .replace(/^[,\s]+|[,\s]+$/g, '');
}

export function buildPlayerPortraitPrompt(theme: string): string {
  return `A character portrait of the main protagonist in a ${theme} setting, close up, expressive face or mask, clean silhouette, 2D vector art, matching the same world style as enemies and battle background`;
}

export function buildPlayerSpritePrompt(theme: string): string {
  return `A character sprite of the run protagonist in a ${theme} setting, matching the same world style as enemies and battle background, facing right, looking right, side profile, feet touching the very bottom edge of the frame, full body from head to toe, standing on a solid green background (#00FF00), 2D vector art. Avoid unrelated genre costumes or props unless the ${theme} setting explicitly requires them.`;
}

export function buildEnemySpritePrompt(enemyPrompt: string): string {
  const normalizedEnemyPrompt = normalizeSpriteSubjectPrompt(enemyPrompt);
  return `A character sprite of ${normalizedEnemyPrompt || 'a hostile combatant'}, STRICT ORIENTATION: face left only, looking left only, left-facing side profile only. Ignore any conflicting orientation words in the source description. Feet touching the very bottom edge of the frame, full body from head to toe, standing on a solid green background (#00FF00), enemy character, 2D vector art`;
}

export function buildBossSpritePrompt(bossPrompt: string): string {
  const normalizedBossPrompt = normalizeSpriteSubjectPrompt(bossPrompt);
  return `A character sprite of ${normalizedBossPrompt || 'a massive boss enemy'}, STRICT ORIENTATION: face left only, looking left only, left-facing side profile only. Ignore any conflicting orientation words in the source description. Feet or base touching the very bottom edge of the frame, full body from head to toe, standing on a solid green background (#00FF00), massive giant boss enemy character, at least twice as large as a normal character, huge imposing scale, 2D vector art`;
}

function normalizeBattleBackgroundPrompt(prompt: string | undefined, theme: string): string {
  const basePrompt = (prompt || `A scenic, atmospheric background for a fantasy battle, ${theme} theme, 2D digital art`).trim();
  const lower = basePrompt.toLowerCase();
  if (lower.includes('horizontal battle platform at a fixed height')) {
    return basePrompt;
  }
  return `${basePrompt}. ${BATTLE_STAGE_FLOOR_PROMPT_RULE}`;
}

function createManifestEntry(params: {
  id: string;
  roomId?: string;
  kind: 'image' | 'audio';
  prompt: string;
  fileKey?: string;
  imageType?: ImageObjectType;
  audioSource?: AudioSourceType;
  musicMode?: MusicModeType;
}): GeneratedObjectManifestEntry {
  const ts = nowTs();
  return {
    id: params.id,
    roomId: params.roomId,
    kind: params.kind,
    prompt: params.prompt,
    status: 'pending',
    fileKey: params.fileKey || buildObjectFileKey(params.id),
    imageType: params.imageType,
    audioSource: params.audioSource,
    musicMode: params.musicMode,
    createdAt: ts,
    updatedAt: ts,
  };
}

function ensureManifestEntry(
  manifest: Record<string, GeneratedObjectManifestEntry>,
  params: Parameters<typeof createManifestEntry>[0]
): GeneratedObjectManifestEntry {
  const existing = manifest[params.id];
  if (existing) {
    return existing;
  }
  const created = createManifestEntry(params);
  manifest[params.id] = created;
  return created;
}

function markManifestReady(runData: RunData | RunDataV2, objectId: string | undefined, url: string | undefined) {
  if (!objectId || !url || !isRunDataV2(runData)) return;
  const existing = runData.objectManifest[objectId];
  if (!existing) return;
  runData.objectManifest[objectId] = {
    ...existing,
    status: 'ready',
    url,
    error: undefined,
    updatedAt: nowTs(),
  };
}

function markManifestFailed(runData: RunData | RunDataV2, objectId: string | undefined, error: unknown) {
  if (!objectId || !isRunDataV2(runData)) return;
  const existing = runData.objectManifest[objectId];
  if (!existing) return;
  runData.objectManifest[objectId] = {
    ...existing,
    status: 'failed',
    error: errorToMessage(error),
    updatedAt: nowTs(),
  };
}

export function resolveManifestObjectUrl(runData: RunData | RunDataV2 | null | undefined, objectId?: string): string | undefined {
  if (!runData || !objectId || !isRunDataV2(runData)) return undefined;
  const entry = runData.objectManifest[objectId];
  if (!entry || entry.status !== 'ready' || !entry.url) return undefined;
  return entry.url;
}

export async function saveRunSnapshot(runData: RunData): Promise<void> {
  if (!currentRunId || process.env.VITE_DEMO_MODE) return;
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

type JsonSchemaLike = {
  type?: string | string[];
  properties?: Record<string, JsonSchemaLike>;
  items?: JsonSchemaLike;
  required?: string[];
  minItems?: number;
  maxItems?: number;
  additionalProperties?: boolean | JsonSchemaLike;
  description?: string;
  enum?: unknown[];
  oneOf?: JsonSchemaLike[];
  anyOf?: JsonSchemaLike[];
  allOf?: JsonSchemaLike[];
  [key: string]: unknown;
};

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function getSchemaRequiredKeys(schema: JsonSchemaLike | undefined): string[] {
  if (!schema || !Array.isArray(schema.required)) return [];
  return schema.required.filter((key): key is string => typeof key === 'string');
}

function normalizeSchemaType(type: unknown): string {
  return typeof type === 'string' ? type.toUpperCase() : '';
}

function normalizeSchemaTypeForMistral(type: unknown): string | undefined {
  if (typeof type !== 'string') return undefined;
  const normalized = type.toLowerCase();
  switch (normalized) {
    case 'object':
    case 'array':
    case 'string':
    case 'integer':
    case 'number':
    case 'boolean':
    case 'null':
      return normalized;
    default:
      return undefined;
  }
}

function toMistralJsonSchema(schema: JsonSchemaLike | undefined): Record<string, unknown> | null {
  if (!isPlainObject(schema)) return null;

  const converted: Record<string, unknown> = {};
  const normalizedType = normalizeSchemaTypeForMistral(schema.type);
  if (normalizedType) {
    converted.type = normalizedType;
  } else if (Array.isArray(schema.type)) {
    const typeList = schema.type
      .map(entry => normalizeSchemaTypeForMistral(entry))
      .filter((entry): entry is string => Boolean(entry));
    if (typeList.length > 0) {
      converted.type = typeList;
    }
  }

  if (isPlainObject(schema.properties)) {
    const props: Record<string, Record<string, unknown>> = {};
    Object.entries(schema.properties).forEach(([key, childSchema]) => {
      const convertedChild = toMistralJsonSchema(childSchema);
      if (convertedChild) props[key] = convertedChild;
    });
    converted.properties = props;
  }

  if (schema.items !== undefined) {
    const convertedItems = toMistralJsonSchema(schema.items);
    if (convertedItems) converted.items = convertedItems;
  }

  if (Array.isArray(schema.required)) {
    converted.required = schema.required.filter((key): key is string => typeof key === 'string');
  }
  if (typeof schema.minItems === 'number') converted.minItems = schema.minItems;
  if (typeof schema.maxItems === 'number') converted.maxItems = schema.maxItems;

  if (typeof schema.additionalProperties === 'boolean') {
    converted.additionalProperties = schema.additionalProperties;
  } else if (isPlainObject(schema.additionalProperties)) {
    const convertedAdditional = toMistralJsonSchema(schema.additionalProperties);
    if (convertedAdditional) converted.additionalProperties = convertedAdditional;
  }

  (['description', 'title', 'default', 'minimum', 'maximum', 'exclusiveMinimum', 'exclusiveMaximum', 'minLength', 'maxLength', 'pattern', 'format', 'const', 'minProperties', 'maxProperties'] as const)
    .forEach((key) => {
      if (schema[key] !== undefined) converted[key] = schema[key];
    });

  if (Array.isArray(schema.enum)) converted.enum = schema.enum;

  (['oneOf', 'anyOf', 'allOf'] as const).forEach((key) => {
    if (!Array.isArray(schema[key])) return;
    const convertedVariants = (schema[key] as JsonSchemaLike[])
      .map(entry => toMistralJsonSchema(entry))
      .filter((entry): entry is Record<string, unknown> => Boolean(entry));
    if (convertedVariants.length > 0) converted[key] = convertedVariants;
  });

  if (!converted.type && converted.properties) {
    converted.type = 'object';
  }
  return converted;
}

function buildMistralResponseFormat(
  label: string,
  schema: JsonSchemaLike | undefined,
): Record<string, unknown> {
  const convertedSchema = toMistralJsonSchema(schema);
  if (!convertedSchema) {
    return { type: 'json_object' };
  }
  const schemaName = toFileSafeKey(`${label}_schema`) || 'structured_output';
  return {
    type: 'json_schema',
    json_schema: {
      name: schemaName,
      strict: true,
      schema: convertedSchema,
    },
  };
}

function countRequiredHits(value: unknown, requiredKeys: string[]): number {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return 0;
  const obj = value as Record<string, unknown>;
  return requiredKeys.reduce((count, key) => count + (Object.prototype.hasOwnProperty.call(obj, key) ? 1 : 0), 0);
}

function normalizeParsedCandidateForSchema(candidate: unknown, schema: JsonSchemaLike | undefined): unknown {
  const requiredKeys = getSchemaRequiredKeys(schema);
  if (requiredKeys.length === 0) return candidate;
  if (typeof candidate !== 'object' || candidate === null || Array.isArray(candidate)) return candidate;

  const root = candidate as Record<string, unknown>;
  const wrapperKeys = ['data', 'result', 'output', 'response', 'payload', 'content', 'json'];
  const candidates: unknown[] = [candidate];

  wrapperKeys.forEach((key) => {
    if (root[key] !== undefined) candidates.push(root[key]);
  });
  Object.values(root).forEach((value) => {
    if (typeof value === 'object' && value !== null) candidates.push(value);
  });

  let best: unknown = candidate;
  let bestScore = countRequiredHits(candidate, requiredKeys);
  candidates.forEach((next) => {
    const score = countRequiredHits(next, requiredKeys);
    if (score > bestScore) {
      best = next;
      bestScore = score;
    }
  });

  return best;
}

function buildSchemaPromptGuidance(schema: JsonSchemaLike | undefined): string {
  if (!schema) return 'Return a valid JSON object only.';
  const keys = Object.keys(schema.properties || {});
  const required = getSchemaRequiredKeys(schema);
  const lines = [
    'Return ONLY one JSON object (no markdown, no explanation).',
    'Do not wrap the object inside data/result/output/response/payload keys.',
  ];
  if (keys.length > 0) {
    lines.push(`Top-level keys: ${keys.join(', ')}.`);
  }
  if (required.length > 0) {
    lines.push(`Required top-level keys: ${required.join(', ')}.`);
  }
  return lines.join(' ');
}

function validateAgainstSchema(
  value: unknown,
  schema: JsonSchemaLike | undefined,
  path: string,
  errors: string[],
): void {
  if (!schema || errors.length >= 8) return;
  const type = normalizeSchemaType(schema.type);
  if (!type) return;

  if (type === 'OBJECT') {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      errors.push(`${path} must be an object`);
      return;
    }
    const obj = value as Record<string, unknown>;
    const required = Array.isArray(schema.required) ? schema.required : [];
    required.forEach((key) => {
      if (!(key in obj)) {
        errors.push(`${path}.${key} is required`);
      }
    });

    const props = schema.properties || {};
    Object.entries(props).forEach(([key, childSchema]) => {
      if (obj[key] !== undefined) {
        validateAgainstSchema(obj[key], childSchema, `${path}.${key}`, errors);
      }
    });

    if (schema.additionalProperties === false) {
      Object.keys(obj).forEach((key) => {
        if (!(key in props)) {
          errors.push(`${path}.${key} is not allowed`);
        }
      });
    }
    return;
  }

  if (type === 'ARRAY') {
    if (!Array.isArray(value)) {
      errors.push(`${path} must be an array`);
      return;
    }
    if (typeof schema.minItems === 'number' && value.length < schema.minItems) {
      errors.push(`${path} must have at least ${schema.minItems} items`);
    }
    if (typeof schema.maxItems === 'number' && value.length > schema.maxItems) {
      errors.push(`${path} must have at most ${schema.maxItems} items`);
    }
    value.forEach((entry, idx) => {
      validateAgainstSchema(entry, schema.items, `${path}[${idx}]`, errors);
    });
    return;
  }

  if (type === 'STRING') {
    if (typeof value !== 'string') errors.push(`${path} must be a string`);
    return;
  }
  if (type === 'INTEGER') {
    if (!Number.isInteger(value)) errors.push(`${path} must be an integer`);
    return;
  }
  if (type === 'NUMBER') {
    if (typeof value !== 'number' || !Number.isFinite(value)) errors.push(`${path} must be a number`);
    return;
  }
  if (type === 'BOOLEAN') {
    if (typeof value !== 'boolean') errors.push(`${path} must be a boolean`);
    return;
  }
  if (type === 'NULL') {
    if (value !== null) errors.push(`${path} must be null`);
  }
}

function validateSchemaOrError(candidate: unknown, schema: JsonSchemaLike | undefined): string | null {
  if (!schema) return null;
  const errors: string[] = [];
  validateAgainstSchema(candidate, schema, '$', errors);
  if (errors.length === 0) return null;
  return errors.slice(0, 3).join('; ');
}

function partsToPrompt(parts: any[]): string {
  return parts
    .map((part) => {
      if (typeof part?.text === 'string') return part.text;
      if (part?.inlineData) {
        const mime = part.inlineData.mimeType || 'application/octet-stream';
        return `[Attached inline file was provided (${mime}), but text generation expects extracted text context.]`;
      }
      return '';
    })
    .filter(Boolean)
    .join('\n\n');
}

function extractMistralMessageText(payload: any): string {
  const parsed = payload?.choices?.[0]?.message?.parsed;
  if (parsed && typeof parsed === 'object') {
    return JSON.stringify(parsed);
  }

  const content = payload?.choices?.[0]?.message?.content;
  if (typeof content === 'string') return content;
  if (content && typeof content === 'object' && !Array.isArray(content)) {
    return JSON.stringify(content);
  }
  if (Array.isArray(content)) {
    return content
      .map((entry: any) => {
        if (typeof entry === 'string') return entry;
        if (typeof entry?.text === 'string') return entry.text;
        return '';
      })
      .filter(Boolean)
      .join('\n')
      .trim();
  }
  return '';
}

async function requestMistralText(
  label: string,
  model: string,
  config: Record<string, any>,
  parts: any[],
  retryHint?: string,
): Promise<string> {
  const prompt = partsToPrompt(parts);
  const schemaGuidance = buildSchemaPromptGuidance(config.responseSchema as JsonSchemaLike | undefined);
  const baseUserContent = `${prompt}\n\nOutput format requirements: ${schemaGuidance}`;
  const userContent = retryHint ? `${baseUserContent}\n\n${retryHint}` : baseUserContent;
  const responseFormat = buildMistralResponseFormat(
    label,
    config.responseSchema as JsonSchemaLike | undefined,
  );
  const messages = [
    ...(config.systemInstruction
      ? [{ role: 'system', content: String(config.systemInstruction) }]
      : []),
    { role: 'user', content: userContent },
  ];

  const res = await fetch('/api/mistral-chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      messages,
      response_format: responseFormat,
      temperature: 0.2,
    }),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => 'Unknown error');
    throw new Error(`${label}: Mistral chat failed (${res.status}): ${errText}`);
  }

  const payload = await res.json();
  const text = extractMistralMessageText(payload);
  if (!text) {
    throw new Error(`${label}: empty response from Mistral`);
  }
  return text;
}

export async function generateRunData(prompt: string, fileData?: { mimeType: string; data: string }, options?: { skipFileData?: boolean }): Promise<RunDataLegacy> {
  setCurrentRunId(Date.now().toString());
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
For enemies, set 'isFlying' to true only for airborne units (flying, hovering, levitating, winged). Otherwise set it to false.
If a card applies 'Vulnerable', use the 'magicNumber' field to specify how many stacks.
Card imagePrompt rule: ${CARD_IMAGE_PROMPT_RULE}
For audio fields, output ONLY the unique semantic fragment, not full production instructions.
  Audio fragment rules:
  - Keep fragments concrete and cinematic (specific source/action/material/emotion), avoid generic words like "epic sound effect".
  - Avoid technical directives like "loop", "high quality", "SFX", "music track", "audio", "stereo", "mix".
  - For card/enemy/boss audioPrompt: 4-14 words, one event-focused phrase describing physical action and material. Prefer warm, weighty, satisfying impacts — avoid shrill, piercing, or harsh sounds (no screech, shriek, piercing whistle).
  - For roomMusicPrompt/bossMusicPrompt: 6-18 words, describing motif/instrumentation/mood only. Prefer atmospheric, moody textures with soft transients and warm low-mids; avoid aggressive drums, bright leads, harsh cymbals, or brittle highs.
- Do not include spoken dialogue inside non-TTS prompts.
Boss must include a 'narratorText' opening line (6-20 words), plus narrator voice hints:
- narratorVoiceStyle: 2-8 words (example: "cold judicial authority")
- narratorVoiceGender: one of male/female/neutral
- narratorVoiceAccent: short accent hint if useful
- Prefer natural human narration by default (grounded, cinematic, authoritative). Use robotic/synthetic cues only if the theme explicitly requires it.
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
                imagePrompt: { type: Type.STRING, description: `A visual description of the card illustration for image generation. ${CARD_IMAGE_PROMPT_RULE}` },
                audioPrompt: { type: Type.STRING, description: 'Unique semantic fragment for card SFX only. Example: "tempered steel slash through wet parchment". Favoring warm weighty sounds over shrill or harsh ones. Do not include technical audio instructions.' }
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
                isFlying: { type: Type.BOOLEAN, description: 'True only if this enemy fights in the air (flying/hovering/levitating). False for ground enemies.' },
                imagePrompt: { type: Type.STRING, description: 'A visual description of the enemy for image generation. IMPORTANT: orientation must always be left-facing side profile only. Include "facing left, looking left, side profile" and never include facing right.' },
                audioPrompt: { type: Type.STRING, description: 'Unique semantic fragment for enemy attack SFX only. Example: "rusted halberd whoosh with chain rattle". Favoring warm weighty sounds over shrill or harsh ones. Do not include technical audio instructions.' },
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
              imagePrompt: { type: Type.STRING, description: 'A visual description of a giant boss for image generation, emphasize it is massive and at least twice as large as the player. IMPORTANT: orientation must always be left-facing side profile only. Include "facing left, looking left, side profile" and never include facing right.' },
              audioPrompt: { type: Type.STRING, description: 'Unique semantic fragment for boss attack SFX only. Example: "colossal gavel impact cracking marble". Favoring warm weighty sounds over shrill or harsh ones. Do not include technical audio instructions.' },
              narratorText: { type: Type.STRING, description: 'A dramatic boss opening dialogue line for TTS, 6-20 words.' },
              narratorVoiceStyle: { type: Type.STRING, description: 'Short voice style hint for TTS selection, 2-8 words. Example: "cold judicial authority". Prefer natural human delivery unless explicitly synthetic.' },
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

  const runData = await requestStructuredJson<RunDataLegacy>('generateRunData', runDataConfig, parts);

  void saveRunSnapshot(runData);

  return runData;
}

const imageCache = new Map<string, string>();
const pendingRequests = new Map<string, Promise<string>>();
let imageCacheScope = '__no_run__';

function syncImageCacheScope(): void {
  const targetScope = currentRunId || '__no_run__';
  if (imageCacheScope === targetScope) return;
  imageCache.clear();
  pendingRequests.clear();
  imageCacheScope = targetScope;
}

function buildImageCacheKey(
  prompt: string | undefined,
  type: 'asset' | 'background' | 'character',
  fileKey?: string
): string | null {
  if (!prompt && !fileKey) return null;
  const normalizedPrompt = type === 'asset'
    ? normalizeCardAssetPrompt(prompt || '')
    : (prompt || '').trim();
  const normalizedFileKey = fileKey
    ? (type === 'asset' ? `${ASSET_IMAGE_PROMPT_VERSION}:${fileKey}` : fileKey)
    : '';
  const cacheIdentity = normalizedFileKey && normalizedPrompt
    ? `${normalizedFileKey}|${normalizedPrompt}`
    : (normalizedFileKey || normalizedPrompt);
  return `${type}:${cacheIdentity}`;
}

/** Synchronous cache lookup — returns the cached URL if available, else null. */
export function getCachedImageUrl(
  prompt?: string,
  type: 'asset' | 'background' | 'character' = 'asset',
  fileKey?: string
): string | null {
  syncImageCacheScope();
  const cacheKey = buildImageCacheKey(prompt, type, fileKey);
  if (!cacheKey) return null;
  return imageCache.get(cacheKey) ?? null;
}

function buildImageFileName(type: 'asset' | 'background' | 'character', prompt: string, fileKey?: string): string {
  if (fileKey) {
    const effectiveFileKey = type === 'asset' ? `${ASSET_IMAGE_PROMPT_VERSION}_${fileKey}` : fileKey;
    return `${type}_${toFileSafeKey(effectiveFileKey)}.png`;
  }
  const effectivePrompt = type === 'asset' ? `${ASSET_IMAGE_PROMPT_VERSION}_${prompt}` : prompt;
  const sanitizedPrompt = toFileSafeKey(effectivePrompt);
  return `${type}_${sanitizedPrompt}.png`;
}

function extractInlineImagePart(response: any): { mimeType?: string; data: string } | null {
  const candidates = Array.isArray(response?.candidates) ? response.candidates : [];
  for (const candidate of candidates) {
    const parts = Array.isArray(candidate?.content?.parts) ? candidate.content.parts : [];
    for (const part of parts) {
      const inlineData = part?.inlineData;
      if (inlineData?.data) {
        return { mimeType: inlineData.mimeType, data: inlineData.data };
      }
    }
  }
  return null;
}

function summarizeNoImageResponse(response: any): string {
  const candidates = Array.isArray(response?.candidates) ? response.candidates : [];
  if (candidates.length === 0) return 'no candidates in response';

  const reasons = candidates
    .map((candidate: any) => candidate?.finishReason)
    .filter((reason: unknown): reason is string => typeof reason === 'string' && reason.length > 0);
  if (reasons.length > 0) {
    return `finish reasons: ${Array.from(new Set(reasons)).join(', ')}`;
  }

  const textSnippet = candidates
    .flatMap((candidate: any) => (Array.isArray(candidate?.content?.parts) ? candidate.content.parts : []))
    .map((part: any) => (typeof part?.text === 'string' ? part.text.trim() : ''))
    .find((text: string) => text.length > 0);
  if (textSnippet) {
    return `text-only response: ${textSnippet.slice(0, 120)}`;
  }

  return 'model returned candidates without image parts';
}

export async function generateGameImage(
  prompt: string,
  type: 'asset' | 'background' | 'character' = 'asset',
  fileKey?: string
): Promise<string> {
  syncImageCacheScope();
  const effectivePrompt = type === 'asset' ? normalizeCardAssetPrompt(prompt) : prompt;
  const cacheKey = buildImageCacheKey(effectivePrompt, type, fileKey);
  if (!cacheKey) {
    throw new Error('Cannot generate image without prompt or fileKey');
  }
  if (imageCache.has(cacheKey)) {
    return imageCache.get(cacheKey)!;
  }

  if (pendingRequests.has(cacheKey)) {
    return pendingRequests.get(cacheKey)!;
  }

  if (currentRunId) {
    const fileName = buildImageFileName(type, effectivePrompt, fileKey);

    // Demo mode: resolve from static files only, never call APIs
    if (process.env.VITE_DEMO_MODE) {
      const staticUrl = `/runs/${currentRunId}/${fileName}`;
      imageCache.set(cacheKey, staticUrl);
      return staticUrl;
    }

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

  let prefix = "A 2D fantasy card illustration for an inner art panel, clean lines, flat colors, highly detailed, full-bleed composition. No frame, no border, no text, no UI elements. ";
  if (type === 'background') {
    prefix = `A 2D video game combat stage background, side-scrolling perspective, clean lines, flat colors, highly detailed. ${BATTLE_STAGE_FLOOR_PROMPT_RULE} `;
  } else if (type === 'character') {
    prefix = "A 2D video game character sprite, clean lines, flat colors, solid green screen background (#00FF00), highly detailed, isolated. The character's feet or base must touch the very bottom edge of the image. Full body visible from head to toe. ";
  }

  const request = ai.models.generateContent({
    model: 'gemini-2.5-flash-image',
    contents: {
      parts: [
        {
          text: `${prefix}${effectivePrompt}`,
        },
      ],
    },
    config: {
      responseModalities: ['IMAGE'],
      imageConfig: {
        aspectRatio: type === 'background' ? '16:9' : undefined,
      },
    },
  }).then(async response => {
    const imagePart = extractInlineImagePart(response);
    if (!imagePart) {
      throw new Error(`No image generated (${summarizeNoImageResponse(response)})`);
    }

    let url = `data:${imagePart.mimeType || 'image/png'};base64,${imagePart.data}`;

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
      const fileName = buildImageFileName(type, effectivePrompt, fileKey);

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
  }).catch(err => {
    pendingRequests.delete(cacheKey);
    throw err;
  });

  pendingRequests.set(cacheKey, request);
  return request;
}

export async function preloadFirstCombatImages(runData: RunData): Promise<void> {
  const promises: Promise<string>[] = [];
  const playerPortraitPrompt = buildPlayerPortraitPrompt(runData.theme);

  // Background
  promises.push(generateGameImage(buildDefaultBattleBackgroundPrompt(runData.theme), 'background').catch(e => { console.error('Failed to preload background', e); return ''; }));

  // Player portrait and sprite
  promises.push(generateGameImage(playerPortraitPrompt, 'character').catch(e => { console.error('Failed to preload player portrait', e); return ''; }));
  promises.push(generateGameImage(buildPlayerSpritePrompt(runData.theme), 'character').catch(e => { console.error('Failed to preload player sprite', e); return ''; }));

  // First enemy sprite
  if (runData.enemies.length > 0 && runData.enemies[0].imagePrompt) {
    promises.push(generateGameImage(buildEnemySpritePrompt(runData.enemies[0].imagePrompt), 'character').then(url => {
      runData.enemies[0].imageUrl = url;
      return url;
    }).catch(e => { console.error('Failed to preload enemy sprite', e); return ''; }));
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
      promises.push(generateGameImage(buildEnemySpritePrompt(enemy.imagePrompt), 'character').then(url => {
        enemy.imageUrl = url;
        return url;
      }).catch(e => { console.error('Failed to background load enemy sprite', e); return ''; }));
    }
  }

  // Boss
  if (runData.boss && runData.boss.imagePrompt) {
    promises.push(generateGameImage(buildBossSpritePrompt(runData.boss.imagePrompt), 'character').then(url => {
      runData.boss.imageUrl = url;
      return url;
    }).catch(e => { console.error('Failed to background load boss sprite', e); return ''; }));
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

const partialIntentSchema = {
  type: Type.OBJECT,
  properties: {
    type: { type: Type.STRING },
    value: { type: Type.INTEGER },
    secondaryValue: { type: Type.INTEGER },
    description: { type: Type.STRING },
  },
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
    imagePrompt: { type: Type.STRING, description: CARD_IMAGE_PROMPT_RULE },
    audioPrompt: { type: Type.STRING },
  },
  required: ['id', 'name', 'cost', 'type', 'description', 'tags', 'imagePrompt', 'audioPrompt'],
};

const partialCardSchema = {
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
    imagePrompt: { type: Type.STRING, description: CARD_IMAGE_PROMPT_RULE },
    audioPrompt: { type: Type.STRING },
  },
};

const enemySchema = {
  type: Type.OBJECT,
  properties: {
    id: { type: Type.STRING },
    name: { type: Type.STRING },
    maxHp: { type: Type.INTEGER },
    currentHp: { type: Type.INTEGER },
    description: { type: Type.STRING },
    isFlying: { type: Type.BOOLEAN },
    imagePrompt: { type: Type.STRING },
    audioPrompt: { type: Type.STRING },
    intents: {
      type: Type.ARRAY,
      items: intentSchema,
    },
  },
  required: ['id', 'name', 'maxHp', 'currentHp', 'description', 'intents', 'imagePrompt', 'audioPrompt'],
};

const partialEnemySchema = {
  type: Type.OBJECT,
  properties: {
    id: { type: Type.STRING },
    name: { type: Type.STRING },
    maxHp: { type: Type.INTEGER },
    currentHp: { type: Type.INTEGER },
    description: { type: Type.STRING },
    isFlying: { type: Type.BOOLEAN },
    imagePrompt: { type: Type.STRING },
    audioPrompt: { type: Type.STRING },
    intents: {
      type: Type.ARRAY,
      items: partialIntentSchema,
    },
  },
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

const partialBossSchema = {
  type: Type.OBJECT,
  properties: {
    ...partialEnemySchema.properties,
    enrageThreshold: { type: Type.INTEGER },
    phase2Intents: {
      type: Type.ARRAY,
      items: partialIntentSchema,
    },
    narratorText: { type: Type.STRING },
    narratorVoiceStyle: { type: Type.STRING },
    narratorVoiceGender: { type: Type.STRING },
    narratorVoiceAccent: { type: Type.STRING },
  },
};

type FileData = { mimeType: string; data: string };

function pickEventIcon(value: unknown, fallback: NonNullable<EventChoicePayload['icon']>): NonNullable<EventChoicePayload['icon']> {
  return value === 'fire' || value === 'shield' || value === 'gold' ? value : fallback;
}

function pickEventColor(value: unknown, fallback: NonNullable<EventChoicePayload['color']>): NonNullable<EventChoicePayload['color']> {
  return value === 'red' || value === 'blue' || value === 'orange' ? value : fallback;
}

function toOptionalNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

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
    const model = TEXT_MODELS[Math.min(attempt, TEXT_MODELS.length - 1)];
    const retryHint = attempt > 0
      ? 'Retry because previous output was invalid JSON. Return only strict JSON, no markdown fences, and no extra commentary.'
      : undefined;
    let text = '';
    try {
      text = await requestMistralText(label, model, config, parts, retryHint);
    } catch (err) {
      lastError = err;
      console.warn(`${label}: attempt ${attempt + 1} failed before JSON parse; retrying...`, err);
      continue;
    }

    const candidates = collectJsonCandidates(text);
    for (const candidate of candidates) {
      try {
        const rawParsed = JSON.parse(candidate);
        const candidateParsed = normalizeParsedCandidateForSchema(
          rawParsed,
          config.responseSchema as JsonSchemaLike | undefined
        ) as T;
        const schemaError = validateSchemaOrError(
          candidateParsed,
          config.responseSchema as JsonSchemaLike | undefined
        );
        if (schemaError) {
          lastError = new Error(`${label}: schema validation failed: ${schemaError}`);
          continue;
        }
        parsed = candidateParsed;
        break;
      } catch (err) {
        lastError = err;
      }
    }

    if (parsed) break;
    console.warn(`${label}: attempt ${attempt + 1} returned malformed JSON; retrying...`, lastError);
  }

  if (!parsed) {
    throw new Error(`${label}: failed to parse Mistral JSON after ${RUN_DATA_MAX_ATTEMPTS} attempts: ${errorToMessage(lastError)}`);
  }

  return parsed;
}

export function buildDefaultBattleBackgroundPrompt(theme: string): string {
  return normalizeBattleBackgroundPrompt(
    `A scenic, atmospheric background for a fantasy battle, ${theme} theme, featuring a very wide and prominent flat floor covering the bottom third of the image, 2D digital art`,
    theme
  );
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
    imagePrompt: `A sharp basic sword slash on parchment, ${theme} fantasy illustration`,
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
    imagePrompt: `A basic reinforced shield absorbing impact, ${theme} fantasy illustration`,
    audioPrompt: 'solid shield impact with muffled iron ring',
  };
}

function normalizeCard(card: Partial<Card> | undefined, fallback: Card): Card {
  if (!isPlainObject(card)) return fallback;
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

function stripCardMediaRefs(card: Card): Card {
  const {
    imageObjectId: _imageObjectId,
    audioObjectId: _audioObjectId,
    imageUrl: _imageUrl,
    audioUrl: _audioUrl,
    ...rest
  } = card;
  return rest;
}

function fillCardChoices(plannedCards: Card[], fallbackPool: Card[], targetCount = 3): Card[] {
  const safeTarget = Math.max(1, targetCount);
  const result = plannedCards.slice(0, safeTarget).map(card => ({ ...card }));
  const source = fallbackPool.length > 0 ? fallbackPool : plannedCards;
  if (source.length === 0) return result;

  let cursor = 0;
  while (result.length < safeTarget) {
    result.push({ ...source[cursor % source.length] });
    cursor += 1;
  }
  return result;
}

function capIntentDamage(intents: Intent[], maxDmg: number): Intent[] {
  return intents.map(intent => {
    const needsCap = ['Attack', 'AttackDefend', 'AttackDebuff', 'AttackBuff'].includes(intent.type);
    return needsCap ? { ...intent, value: Math.min(intent.value, maxDmg) } : intent;
  });
}

function normalizeEnemy(enemy: Partial<Enemy> | undefined, theme: string, isElite = false): Enemy {
  const fallback: Enemy = {
    id: `enemy_first_${toFileSafeKey(theme)}`,
    name: 'Wandering Sentinel',
    maxHp: 28,
    currentHp: 28,
    description: 'A vigilant foe guarding the first path.',
    isFlying: false,
    intents: [
      { type: 'Attack', value: 6, description: 'Deal 6 damage.' },
      { type: 'Defend', value: 5, description: 'Gain 5 block.' },
      { type: 'Attack', value: 7, description: 'Deal 7 damage.' },
    ],
    imagePrompt: `a grim armored scout with chipped metal plates, facing left, looking left, side profile, ${theme} style`,
    audioPrompt: 'rusted blade swipe with chain rattle',
  };

  if (!isPlainObject(enemy)) return fallback;

  const maxHpCap = isElite ? 65 : 45;
  const maxAttackDmg = isElite ? 14 : 10;
  const rawHp = Math.max(1, Number(enemy.maxHp) || fallback.maxHp);
  const cappedHp = Math.min(rawHp, maxHpCap);
  const intents = Array.isArray(enemy.intents) && enemy.intents.length > 0 ? enemy.intents : fallback.intents;
  const isFlying = inferEnemyIsFlying(enemy);

  return {
    ...fallback,
    ...enemy,
    id: enemy.id || fallback.id,
    name: enemy.name || fallback.name,
    maxHp: cappedHp,
    currentHp: cappedHp,
    description: enemy.description || fallback.description,
    isFlying,
    intents: capIntentDamage(intents, maxAttackDmg),
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
    maxHp: 110,
    currentHp: 110,
    description: 'A placeholder boss awaiting full generation.',
    enrageThreshold: 45,
    intents: [
      { type: 'Attack', value: 12, description: 'Deal 12 damage.' },
      { type: 'Defend', value: 10, description: 'Gain 10 block.' },
      { type: 'AttackBuff', value: 10, secondaryValue: 2, description: 'Deal 10 damage and gain 2 Strength.' },
    ],
    phase2Intents: [
      { type: 'Attack', value: 18, description: 'Deal 18 damage.' },
      { type: 'AttackDefend', value: 14, secondaryValue: 10, description: 'Deal 14 damage and gain 10 block.' },
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

function mergeDefinedFields<T extends Record<string, any>>(base: T, incoming: T): T {
  const patch: Partial<T> = {};
  for (const key in incoming) {
    if (Object.prototype.hasOwnProperty.call(incoming, key) && incoming[key] !== undefined) {
      patch[key] = incoming[key];
    }
  }
  return { ...base, ...patch };
}

function mergeUniqueCards(existing: Card[], incoming: Card[]): Card[] {
  const byId = new Map(existing.map(card => [card.id, card]));
  for (const card of incoming) {
    const prev = byId.get(card.id);
    if (!prev) {
      byId.set(card.id, card);
      continue;
    }
    byId.set(card.id, mergeDefinedFields(prev, card));
  }
  return Array.from(byId.values());
}

function mergeUniqueEnemies(existing: Enemy[], incoming: Enemy[]): Enemy[] {
  const byId = new Map(existing.map(enemy => [enemy.id, enemy]));
  for (const enemy of incoming) {
    const prev = byId.get(enemy.id);
    if (!prev) {
      byId.set(enemy.id, enemy);
      continue;
    }
    byId.set(enemy.id, mergeDefinedFields(prev, enemy));
  }
  return Array.from(byId.values());
}

function normalizeCardLookupKey(value: string | undefined): string {
  return (value || '').trim().toLowerCase();
}

function resolveCardFromExistingPool(
  pool: Card[],
  hint: Partial<Card> | string | undefined,
  fallback: Card
): Card {
  if (pool.length === 0) return { ...fallback };

  if (typeof hint === 'string') {
    const byId = pool.find(card => card.id === hint);
    if (byId) return { ...byId };
    const byName = pool.find(card => normalizeCardLookupKey(card.name) === normalizeCardLookupKey(hint));
    if (byName) return { ...byName };
    return { ...fallback };
  }

  if (isPlainObject(hint)) {
    if (typeof hint.id === 'string') {
      const byId = pool.find(card => card.id === hint.id);
      if (byId) return { ...byId };
    }
    if (typeof hint.name === 'string') {
      const byName = pool.find(card => normalizeCardLookupKey(card.name) === normalizeCardLookupKey(hint.name));
      if (byName) return { ...byName };
    }
  }

  return { ...fallback };
}

function canReuseManifestObjectId(
  manifest: Record<string, GeneratedObjectManifestEntry>,
  objectId: string | undefined,
  roomId: string,
  kind: 'image' | 'audio',
  expectedPrompt?: string
): boolean {
  if (typeof objectId !== 'string') return false;
  if (!objectId.startsWith(`${roomId}:${kind}:`)) return false;

  const entry = manifest[objectId];
  if (!entry) return true;
  if (entry.kind !== kind) return false;
  if (!expectedPrompt) return true;
  return entry.prompt === expectedPrompt;
}

function registerCardObjects(
  runData: RunDataV2 | { objectManifest: Record<string, GeneratedObjectManifestEntry> },
  roomId: string,
  card: Card,
  slot: string
): Card {
  const canReuseImageObjectId = canReuseManifestObjectId(
    runData.objectManifest,
    card.imageObjectId,
    roomId,
    'image',
    card.imagePrompt
  );
  const canReuseAudioObjectId = canReuseManifestObjectId(
    runData.objectManifest,
    card.audioObjectId,
    roomId,
    'audio',
    card.audioPrompt
  );
  const imageObjectId = canReuseImageObjectId
    ? card.imageObjectId!
    : buildObjectId(roomId, 'image', `${slot}_card_${card.id}`);
  const audioObjectId = canReuseAudioObjectId
    ? card.audioObjectId!
    : buildObjectId(roomId, 'audio', `${slot}_card_${card.id}_sfx`);
  if (card.imagePrompt) {
    ensureManifestEntry(runData.objectManifest, {
      id: imageObjectId,
      roomId,
      kind: 'image',
      prompt: card.imagePrompt,
      imageType: 'asset',
      fileKey: buildObjectFileKey(imageObjectId),
    });
  }
  if (card.audioPrompt) {
    ensureManifestEntry(runData.objectManifest, {
      id: audioObjectId,
      roomId,
      kind: 'audio',
      prompt: card.audioPrompt,
      audioSource: 'card',
      fileKey: buildObjectFileKey(audioObjectId),
    });
  }
  return {
    ...card,
    imageObjectId,
    audioObjectId,
  };
}

function registerEnemyObjects(
  runData: RunDataV2 | { objectManifest: Record<string, GeneratedObjectManifestEntry> },
  roomId: string,
  enemy: Enemy,
  slot: string
): Enemy {
  const expectedEnemyImagePrompt = enemy.imagePrompt ? buildEnemySpritePrompt(enemy.imagePrompt) : undefined;
  const canReuseImageObjectId = canReuseManifestObjectId(
    runData.objectManifest,
    enemy.imageObjectId,
    roomId,
    'image',
    expectedEnemyImagePrompt
  );
  const canReuseAudioObjectId = canReuseManifestObjectId(
    runData.objectManifest,
    enemy.audioObjectId,
    roomId,
    'audio',
    enemy.audioPrompt
  );
  const imageObjectId = canReuseImageObjectId
    ? enemy.imageObjectId!
    : buildObjectId(roomId, 'image', `${slot}_enemy_${enemy.id}`);
  const audioObjectId = canReuseAudioObjectId
    ? enemy.audioObjectId!
    : buildObjectId(roomId, 'audio', `${slot}_enemy_${enemy.id}_sfx`);
  if (enemy.imagePrompt) {
    ensureManifestEntry(runData.objectManifest, {
      id: imageObjectId,
      roomId,
      kind: 'image',
      prompt: buildEnemySpritePrompt(enemy.imagePrompt),
      imageType: 'character',
      fileKey: buildObjectFileKey(imageObjectId),
    });
  }
  if (enemy.audioPrompt) {
    ensureManifestEntry(runData.objectManifest, {
      id: audioObjectId,
      roomId,
      kind: 'audio',
      prompt: enemy.audioPrompt,
      audioSource: 'enemy',
      fileKey: buildObjectFileKey(audioObjectId),
    });
  }
  return {
    ...enemy,
    imageObjectId,
    audioObjectId,
  };
}

function registerBossObjects(
  runData: RunDataV2 | { objectManifest: Record<string, GeneratedObjectManifestEntry> },
  roomId: string,
  boss: Boss
): Boss {
  const expectedBossImagePrompt = boss.imagePrompt ? buildBossSpritePrompt(boss.imagePrompt) : undefined;
  const canReuseImageObjectId = canReuseManifestObjectId(
    runData.objectManifest,
    boss.imageObjectId,
    roomId,
    'image',
    expectedBossImagePrompt
  );
  const canReuseAudioObjectId = canReuseManifestObjectId(
    runData.objectManifest,
    boss.audioObjectId,
    roomId,
    'audio',
    boss.audioPrompt
  );
  const canReuseNarratorAudioObjectId = canReuseManifestObjectId(
    runData.objectManifest,
    boss.narratorAudioObjectId,
    roomId,
    'audio',
    boss.narratorText
  );
  const imageObjectId = canReuseImageObjectId
    ? boss.imageObjectId!
    : buildObjectId(roomId, 'image', `boss_${boss.id}`);
  const audioObjectId = canReuseAudioObjectId
    ? boss.audioObjectId!
    : buildObjectId(roomId, 'audio', `boss_${boss.id}_sfx`);
  const narratorAudioObjectId = canReuseNarratorAudioObjectId
    ? boss.narratorAudioObjectId!
    : buildObjectId(roomId, 'audio', `boss_${boss.id}_tts`);
  if (boss.imagePrompt) {
    ensureManifestEntry(runData.objectManifest, {
      id: imageObjectId,
      roomId,
      kind: 'image',
      prompt: buildBossSpritePrompt(boss.imagePrompt),
      imageType: 'character',
      fileKey: buildObjectFileKey(imageObjectId),
    });
  }
  if (boss.audioPrompt) {
    ensureManifestEntry(runData.objectManifest, {
      id: audioObjectId,
      roomId,
      kind: 'audio',
      prompt: boss.audioPrompt,
      audioSource: 'boss',
      fileKey: buildObjectFileKey(audioObjectId),
    });
  }
  if (boss.narratorText) {
    ensureManifestEntry(runData.objectManifest, {
      id: narratorAudioObjectId,
      roomId,
      kind: 'audio',
      prompt: boss.narratorText,
      audioSource: 'boss',
      fileKey: buildObjectFileKey(narratorAudioObjectId),
    });
  }
  return {
    ...boss,
    imageObjectId,
    audioObjectId,
    narratorAudioObjectId,
  };
}

function getRoomIdFromObjectId(objectId: string | undefined): string | undefined {
  if (!objectId) return undefined;
  const split = objectId.indexOf(':');
  if (split <= 0) return undefined;
  return objectId.slice(0, split);
}

function allocateRepairedObjectId(
  roomId: string,
  kind: 'image' | 'audio',
  slotSeed: string,
  prompt: string,
  registry: Map<string, string>
): string {
  let attempt = 0;
  while (true) {
    const slot = attempt === 0 ? slotSeed : `${slotSeed}_${attempt}`;
    const candidate = buildObjectId(roomId, kind, slot);
    const existingPrompt = registry.get(candidate);
    if (existingPrompt === undefined || existingPrompt === prompt) {
      registry.set(candidate, prompt);
      return candidate;
    }
    attempt += 1;
  }
}

function cloneManifestEntryForCardRepair(params: {
  manifest: Record<string, GeneratedObjectManifestEntry>;
  oldId?: string;
  newId: string;
  roomId: string;
  kind: 'image' | 'audio';
  prompt: string;
  url?: string;
}): void {
  const oldEntry = params.oldId ? params.manifest[params.oldId] : undefined;
  const ts = nowTs();
  const promptMatchesOld = oldEntry?.prompt === params.prompt;
  const reusedUrl = promptMatchesOld ? oldEntry?.url : undefined;
  const reusedStatus = promptMatchesOld ? oldEntry?.status : undefined;
  const reusedError = promptMatchesOld ? oldEntry?.error : undefined;

  params.manifest[params.newId] = {
    id: params.newId,
    roomId: params.roomId,
    kind: params.kind,
    prompt: params.prompt,
    status: params.url ? 'ready' : (reusedStatus || 'pending'),
    url: params.url || reusedUrl,
    error: params.url ? undefined : reusedError,
    fileKey: buildObjectFileKey(params.newId),
    imageType: oldEntry?.imageType || (params.kind === 'image' ? 'asset' : undefined),
    audioSource: oldEntry?.audioSource || (params.kind === 'audio' ? 'card' : undefined),
    musicMode: oldEntry?.musicMode,
    createdAt: oldEntry?.createdAt || ts,
    updatedAt: ts,
  };
}

function syncPayloadCardRefs(payload: RoomContentPayload): RoomContentPayload {
  const refs = payload.objectRefs || {};
  if (payload.nodeType === 'Combat' || payload.nodeType === 'Elite') {
    const rewardCards = payload.rewardCards || [];
    return {
      ...payload,
      objectRefs: {
        ...refs,
        cardImageIds: rewardCards.map(card => card.imageObjectId).filter(Boolean) as string[],
        cardSfxIds: rewardCards.map(card => card.audioObjectId).filter(Boolean) as string[],
      },
    };
  }
  if (payload.nodeType === 'Shop') {
    return {
      ...payload,
      objectRefs: {
        ...refs,
        cardImageIds: payload.shopCards.map(card => card.imageObjectId).filter(Boolean) as string[],
        cardSfxIds: payload.shopCards.map(card => card.audioObjectId).filter(Boolean) as string[],
      },
    };
  }
  if (payload.nodeType === 'Event') {
    const addCards = payload.choices
      .map(choice => choice.effects?.addCard)
      .filter((card): card is Card => Boolean(card));
    return {
      ...payload,
      objectRefs: {
        ...refs,
        cardImageIds: addCards.map(card => card.imageObjectId).filter(Boolean) as string[],
        cardSfxIds: addCards.map(card => card.audioObjectId).filter(Boolean) as string[],
      },
    };
  }
  return payload;
}

function isTransientBlobUrl(url?: string): boolean {
  return typeof url === 'string' && url.startsWith('blob:');
}

function sanitizePersistedUrl(url?: string): string | undefined {
  return isTransientBlobUrl(url) ? undefined : url;
}

function sanitizeManifestEntryUrl(entry: GeneratedObjectManifestEntry): GeneratedObjectManifestEntry {
  if (!isTransientBlobUrl(entry.url)) return entry;
  return {
    ...entry,
    status: entry.status === 'ready' ? 'pending' : entry.status,
    url: undefined,
    updatedAt: nowTs(),
  };
}

function sanitizeCardRuntimeUrls(card: Card): Card {
  const imageUrl = sanitizePersistedUrl(card.imageUrl);
  const audioUrl = sanitizePersistedUrl(card.audioUrl);
  if (imageUrl === card.imageUrl && audioUrl === card.audioUrl) return card;
  return {
    ...card,
    imageUrl,
    audioUrl,
  };
}

function sanitizeEnemyRuntimeUrls(enemy: Enemy): Enemy {
  const imageUrl = sanitizePersistedUrl(enemy.imageUrl);
  const audioUrl = sanitizePersistedUrl(enemy.audioUrl);
  if (imageUrl === enemy.imageUrl && audioUrl === enemy.audioUrl) return enemy;
  return {
    ...enemy,
    imageUrl,
    audioUrl,
  };
}

function sanitizeBossRuntimeUrls(boss: Boss): Boss {
  const imageUrl = sanitizePersistedUrl(boss.imageUrl);
  const audioUrl = sanitizePersistedUrl(boss.audioUrl);
  const narratorAudioUrl = sanitizePersistedUrl(boss.narratorAudioUrl);
  if (imageUrl === boss.imageUrl && audioUrl === boss.audioUrl && narratorAudioUrl === boss.narratorAudioUrl) return boss;
  return {
    ...boss,
    imageUrl,
    audioUrl,
    narratorAudioUrl,
  };
}

function sanitizeObjectUrls<T extends object | undefined>(urls: T): T {
  if (!urls) return urls;
  let changed = false;
  const next: Record<string, unknown> = { ...(urls as Record<string, unknown>) };

  Object.entries(urls as Record<string, unknown>).forEach(([key, value]) => {
    if (typeof value === 'string') {
      const sanitized = sanitizePersistedUrl(value);
      if (sanitized !== value) {
        changed = true;
        next[key] = sanitized;
      }
      return;
    }

    if (Array.isArray(value)) {
      let arrayChanged = false;
      const sanitizedArray = value.map(item => {
        if (typeof item !== 'string') return item;
        const sanitized = sanitizePersistedUrl(item);
        if (sanitized !== item) {
          arrayChanged = true;
        }
        return sanitized;
      });
      if (arrayChanged) {
        changed = true;
        next[key] = sanitizedArray;
      }
    }
  });

  return (changed ? next : urls) as T;
}

export function repairRunDataCardMediaRefs(runData: RunData): RunData {
  if (!isRunDataV2(runData)) return runData;

  const repairedManifest: Record<string, GeneratedObjectManifestEntry> = Object.fromEntries(
    Object.entries(runData.objectManifest).map(([id, entry]) => [id, sanitizeManifestEntryUrl(entry)])
  );
  const imagePromptByObjectId = new Map<string, string>();
  const audioPromptByObjectId = new Map<string, string>();
  Object.values(repairedManifest).forEach(entry => {
    if (entry.kind === 'image') {
      imagePromptByObjectId.set(entry.id, entry.prompt);
      return;
    }
    audioPromptByObjectId.set(entry.id, entry.prompt);
  });

  const repairCard = (card: Card, roomIdHint?: string): Card => {
    let nextCard = sanitizeCardRuntimeUrls(card);
    const roomId = roomIdHint || getRoomIdFromObjectId(card.imageObjectId) || getRoomIdFromObjectId(card.audioObjectId) || GLOBAL_ROOM_ID;

    if (card.imageObjectId && card.imagePrompt) {
      const priorPrompt = imagePromptByObjectId.get(card.imageObjectId);
      if (priorPrompt === undefined) {
        imagePromptByObjectId.set(card.imageObjectId, card.imagePrompt);
      } else if (priorPrompt !== card.imagePrompt) {
        const newImageObjectId = allocateRepairedObjectId(
          roomId,
          'image',
          `repaired_card_${card.id}_image`,
          card.imagePrompt,
          imagePromptByObjectId
        );
        nextCard = {
          ...nextCard,
          imageObjectId: newImageObjectId,
        };
        cloneManifestEntryForCardRepair({
          manifest: repairedManifest,
          oldId: card.imageObjectId,
          newId: newImageObjectId,
          roomId,
          kind: 'image',
          prompt: card.imagePrompt,
          url: nextCard.imageUrl,
        });
      }
    }

    if (card.audioObjectId && card.audioPrompt) {
      const priorPrompt = audioPromptByObjectId.get(card.audioObjectId);
      if (priorPrompt === undefined) {
        audioPromptByObjectId.set(card.audioObjectId, card.audioPrompt);
      } else if (priorPrompt !== card.audioPrompt) {
        const newAudioObjectId = allocateRepairedObjectId(
          roomId,
          'audio',
          `repaired_card_${card.id}_audio`,
          card.audioPrompt,
          audioPromptByObjectId
        );
        nextCard = {
          ...nextCard,
          audioObjectId: newAudioObjectId,
        };
        cloneManifestEntryForCardRepair({
          manifest: repairedManifest,
          oldId: card.audioObjectId,
          newId: newAudioObjectId,
          roomId,
          kind: 'audio',
          prompt: card.audioPrompt,
          url: nextCard.audioUrl,
        });
      }
    }

    return nextCard;
  };

  const repairedCards = runData.cards.map(card => repairCard(card));
  const repairedStarterCards = runData.bootstrap.starterCards.map(card => repairCard(card)) as [Card, Card, Card];
  const repairedEnemies = runData.enemies.map(enemy => sanitizeEnemyRuntimeUrls(enemy));
  const repairedBoss = runData.boss ? sanitizeBossRuntimeUrls(runData.boss) : undefined;
  const repairedRooms: RunDataV2['rooms'] = Object.fromEntries(
    Object.entries(runData.rooms).map(([roomId, state]) => {
      if (!state.payload) return [roomId, state];
      const payload = state.payload;
      if (payload.nodeType === 'Combat' || payload.nodeType === 'Elite') {
        const enemies = payload.enemies.map(enemy => sanitizeEnemyRuntimeUrls(enemy));
        const rewardCards = (payload.rewardCards || []).map(card => repairCard(card, roomId));
        return [
          roomId,
          {
            ...state,
            payload: syncPayloadCardRefs({
              ...payload,
              enemies,
              rewardCards,
              roomMusicUrl: sanitizePersistedUrl(payload.roomMusicUrl),
              backgroundImageUrl: sanitizePersistedUrl(payload.backgroundImageUrl),
              objectUrls: sanitizeObjectUrls(payload.objectUrls),
            }),
          },
        ];
      }
      if (payload.nodeType === 'Boss') {
        return [
          roomId,
          {
            ...state,
            payload: {
              ...payload,
              boss: sanitizeBossRuntimeUrls(payload.boss),
              bossMusicUrl: sanitizePersistedUrl(payload.bossMusicUrl),
              backgroundImageUrl: sanitizePersistedUrl(payload.backgroundImageUrl),
              objectUrls: sanitizeObjectUrls(payload.objectUrls),
            },
          },
        ];
      }
      if (payload.nodeType === 'Shop') {
        const shopCards = payload.shopCards.map(card => repairCard(card, roomId));
        return [
          roomId,
          {
            ...state,
            payload: syncPayloadCardRefs({
              ...payload,
              shopCards,
              objectUrls: sanitizeObjectUrls(payload.objectUrls),
            }),
          },
        ];
      }
      if (payload.nodeType === 'Event') {
        const choices = payload.choices.map(choice => {
          const addCard = choice.effects?.addCard
            ? repairCard(choice.effects.addCard, roomId)
            : undefined;
          return {
            ...choice,
            effects: {
              ...(choice.effects || {}),
              addCard,
            },
          };
        });
        return [
          roomId,
          {
            ...state,
            payload: syncPayloadCardRefs({
              ...payload,
              imageUrl: sanitizePersistedUrl(payload.imageUrl),
              choices,
              objectUrls: sanitizeObjectUrls(payload.objectUrls),
            }),
          },
        ];
      }
      return [
        roomId,
        {
          ...state,
          payload: {
            ...payload,
            objectUrls: sanitizeObjectUrls(payload.objectUrls),
          },
        },
      ];
    })
  );

  return {
    ...runData,
    cards: repairedCards,
    enemies: repairedEnemies,
    boss: repairedBoss,
    bootstrap: {
      ...runData.bootstrap,
      starterCards: repairedStarterCards,
    },
    objectManifest: repairedManifest,
    rooms: repairedRooms,
  };
}

function ensureSharedPlayerImageRefs(
  objectManifest: Record<string, GeneratedObjectManifestEntry>,
  theme: string,
): { playerPortraitImageId: string; playerSpriteImageId: string } {
  const playerPortraitPrompt = buildPlayerPortraitPrompt(theme);
  const playerSpritePrompt = buildPlayerSpritePrompt(theme);
  const entries = Object.values(objectManifest);

  const playerPortraitImageId =
    entries.find(entry =>
      entry.kind === 'image'
      && entry.imageType === 'character'
      && entry.prompt === playerPortraitPrompt
    )?.id || buildObjectId(GLOBAL_ROOM_ID, 'image', 'player_portrait');

  const playerSpriteImageId =
    entries.find(entry =>
      entry.kind === 'image'
      && entry.imageType === 'character'
      && entry.prompt === playerSpritePrompt
    )?.id || buildObjectId(GLOBAL_ROOM_ID, 'image', 'player_sprite');

  ensureManifestEntry(objectManifest, {
    id: playerPortraitImageId,
    roomId: GLOBAL_ROOM_ID,
    kind: 'image',
    prompt: playerPortraitPrompt,
    imageType: 'character',
    fileKey: buildObjectFileKey(playerPortraitImageId),
  });
  ensureManifestEntry(objectManifest, {
    id: playerSpriteImageId,
    roomId: GLOBAL_ROOM_ID,
    kind: 'image',
    prompt: playerSpritePrompt,
    imageType: 'character',
    fileKey: buildObjectFileKey(playerSpriteImageId),
  });

  return { playerPortraitImageId, playerSpriteImageId };
}

function createFallbackSpecialCard(theme: string, index: number): Card {
  const seeds: Array<Pick<Card, 'name' | 'type' | 'cost' | 'description' | 'damage' | 'block' | 'magicNumber' | 'tags' | 'audioPrompt'>> = [
    {
      name: 'Rising Tempo',
      type: 'Attack',
      cost: 1,
      description: 'Deal 8 damage. Draw 1 card.',
      damage: 8,
      tags: ['Rhythm'],
      audioPrompt: 'surging arcane pulse with crisp impact',
    },
    {
      name: 'Guarded Step',
      type: 'Skill',
      cost: 1,
      description: 'Gain 7 Block. Draw 1 card.',
      block: 7,
      tags: ['Guard'],
      audioPrompt: 'layered shield brace with leather slide',
    },
    {
      name: 'Anchor Hex',
      type: 'Power',
      cost: 1,
      description: 'Whenever you play a Skill, gain 1 Block.',
      magicNumber: 1,
      tags: ['Hex'],
      audioPrompt: 'etched sigil hum with stone resonance',
    },
    {
      name: 'Severing Arc',
      type: 'Attack',
      cost: 2,
      description: 'Deal 12 damage. Apply 2 Vulnerable.',
      damage: 12,
      magicNumber: 2,
      tags: ['Blade'],
      audioPrompt: 'heavy steel cleave with ringing followthrough',
    },
    {
      name: 'Patient Formation',
      type: 'Skill',
      cost: 1,
      description: 'Gain 9 Block.',
      block: 9,
      tags: ['Tactics'],
      audioPrompt: 'tight shield lock with muted thud',
    },
  ];

  const seed = seeds[index % seeds.length];
  return {
    id: `special_${index}_${toFileSafeKey(theme)}`,
    name: seed.name,
    cost: seed.cost,
    type: seed.type,
    description: seed.description,
    damage: seed.damage,
    block: seed.block,
    magicNumber: seed.magicNumber,
    tags: seed.tags,
    imagePrompt: `stylized fantasy illustration for ${seed.name}, ${theme} theme`,
    audioPrompt: seed.audioPrompt,
  };
}

export async function generateRunBootstrap(
  prompt: string,
  fileData?: FileData,
  settings: GenerationSettings = { mode: 'fast_start', prefetchDepth: 2 },
  options?: { skipFileData?: boolean },
): Promise<RunDataV2> {
  setCurrentRunId(Date.now().toString());
  const baseParts = buildRequestParts(prompt, fileData, options);
  const placeholderTheme = 'Dark Fantasy';
  const placeholderCards: Card[] = [
    createStrikeCard(placeholderTheme),
    createDefendCard(placeholderTheme),
    ...Array.from({ length: 5 }, (_, idx) => createFallbackSpecialCard(placeholderTheme, idx)),
  ];
  const placeholderEnemies: Enemy[] = Array.from({ length: 4 }, (_, idx) => ({
    ...normalizeEnemy(undefined, placeholderTheme),
    id: `enemy_placeholder_${idx + 1}`,
    name: `Sentinel ${idx + 1}`,
  }));
  const placeholderBoss = createPlaceholderBoss(placeholderTheme);
  const skeletonSeed: RunDataLegacy = {
    theme: placeholderTheme,
    cards: placeholderCards,
    enemies: placeholderEnemies,
    boss: placeholderBoss,
    synergies: [defaultSynergyFromCard(placeholderCards[2])],
    roomMusicPrompt: 'hushed bowed strings over distant low drone',
    bossMusicPrompt: 'ominous low choir over cavernous drones and muted war drums',
  };
  const node_map = generateFallbackNodeMap(skeletonSeed);
  const nodeSkeleton = node_map.map(node => ({
    roomId: node.id,
    nodeType: node.type,
    row: node.row ?? Math.round(node.y / 20),
    nextNodes: node.nextNodes,
  }));

  const config = {
    systemInstruction: `You are an expert game designer for a Slay the Spire-style roguelike deckbuilder.
Generate a COMPLETE run package in one response.
Return strictly valid JSON matching the schema.
Rules:
- Exactly 7 cards total. Card 1 MUST be Strike (Attack, cost 1, damage 6). Card 2 MUST be Defend (Skill, cost 1, block 5). Remaining 5 are unique specials.
- Exactly 4 unique normal enemies in enemies[].
- Exactly 1 boss in boss.
- Exactly 1 synergy in synergies[].
- For enemies in rooms, refer to enemies[] using enemyIds.
- Every room from provided map skeleton must have one entry in rooms[].
- Combat: 1-2 enemyIds and exactly 3 rewardCards.
- Elite: exactly 1 enemyId and exactly 3 rewardCards.
- Boss: optional boss override + backgroundPrompt + bossMusicPrompt.
- Event: include title, description, imagePrompt, footerText, and exactly 3 choices.
- Shop: include exactly 3 shopCards.
- Treasure and Campfire can use minimal fields.
- For every card.imagePrompt, follow this rule: ${CARD_IMAGE_PROMPT_RULE}
Audio rules:
- audioPrompt fields are 4-14 words, physical action/material only, no technical audio terms.
  - roomMusicPrompt/bossMusicPrompt are 6-18 words, instrumentation/mood only, atmospheric and soft-edged (avoid harsh or brittle textures).
- narratorText is 6-20 words.`,
    responseMimeType: 'application/json',
    responseSchema: {
      type: Type.OBJECT,
      properties: {
        theme: { type: Type.STRING },
        cards: { type: Type.ARRAY, minItems: 7, maxItems: 7 },
        enemies: { type: Type.ARRAY, minItems: 4, maxItems: 4 },
        boss: { type: Type.OBJECT },
        synergies: {
          type: Type.ARRAY,
          minItems: 1,
          maxItems: 1,
        },
        roomMusicPrompt: { type: Type.STRING },
        bossMusicPrompt: { type: Type.STRING },
        rooms: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              roomId: { type: Type.STRING },
              nodeType: { type: Type.STRING },
              enemyIds: { type: Type.ARRAY, items: { type: Type.STRING } },
              rewardCards: { type: Type.ARRAY, maxItems: 3 },
              backgroundPrompt: { type: Type.STRING },
              roomMusicPrompt: { type: Type.STRING },
              boss: partialBossSchema,
              bossMusicPrompt: { type: Type.STRING },
              title: { type: Type.STRING },
              description: { type: Type.STRING },
              imagePrompt: { type: Type.STRING },
              footerText: { type: Type.STRING },
              choices: {
                type: Type.ARRAY,
                maxItems: 3,
                items: {
                  type: Type.OBJECT,
                },
              },
              shopCards: { type: Type.ARRAY, maxItems: 3 },
              treasureGold: { type: Type.INTEGER },
            },
            required: ['roomId', 'nodeType'],
          },
        },
      },
      required: ['cards', 'enemies', 'rooms'],
    },
  };

  type GeneratedRoomPlan = {
    roomId: string;
    nodeType?: MapNode['type'];
    enemyIds?: string[];
    rewardCards?: Array<Partial<Card> | string>;
    backgroundPrompt?: string;
    roomMusicPrompt?: string;
    boss?: Partial<Boss>;
    bossMusicPrompt?: string;
    title?: string;
    description?: string;
    imagePrompt?: string;
    footerText?: string;
    choices?: Array<{
      id?: string;
      label?: string;
      description?: string;
      icon?: unknown;
      color?: unknown;
      effects?: {
        hpDelta?: unknown;
        maxHpDelta?: unknown;
        goldDelta?: unknown;
        addCard?: Partial<Card>;
      };
    }>;
    shopCards?: Array<Partial<Card> | string>;
    treasureGold?: number;
  };

  const parsed = await requestStructuredJson<{
    theme: string;
    cards: Partial<Card>[];
    enemies: Partial<Enemy>[];
    boss: Partial<Boss>;
    synergies?: Synergy[];
    roomMusicPrompt?: string;
    bossMusicPrompt?: string;
    rooms?: GeneratedRoomPlan[];
  }>('generateRunBootstrap', config, [
    ...baseParts,
    { text: `Map skeleton (all roomIds below MUST be covered exactly once in rooms[]):\n${JSON.stringify(nodeSkeleton)}` },
  ]);

  const theme = parsed.theme || 'Dark Fantasy';
  const roomMusicPrompt = parsed.roomMusicPrompt || 'hushed bowed strings over distant low drone';
  const bossMusicPrompt = parsed.bossMusicPrompt || 'ominous low choir over cavernous drones and muted war drums';

  const strike = normalizeCard(parsed.cards?.[0], createStrikeCard(theme));
  strike.id = 'strike';
  strike.name = 'Strike';
  strike.type = 'Attack';
  strike.cost = 1;
  strike.damage = 6;
  strike.block = undefined;
  strike.description = 'Deal 6 damage.';

  const defend = normalizeCard(parsed.cards?.[1], createDefendCard(theme));
  defend.id = 'defend';
  defend.name = 'Defend';
  defend.type = 'Skill';
  defend.cost = 1;
  defend.block = 5;
  defend.damage = undefined;
  defend.description = 'Gain 5 Block.';

  const specialCards = Array.from({ length: 5 }, (_, idx) => {
    const fallback = createFallbackSpecialCard(theme, idx);
    const next = normalizeCard(parsed.cards?.[idx + 2], fallback);
    if (next.name.trim().toLowerCase() === 'strike' || next.name.trim().toLowerCase() === 'defend') {
      next.name = `${next.name} Prime`;
    }
    return next;
  });

  const allCards = [strike, defend, ...specialCards];
  const seenCardIds = new Set<string>();
  const cards = allCards.map((card, idx) => {
    let id = card.id || `card_${idx}`;
    while (seenCardIds.has(id)) {
      id = `${id}_${idx}`;
    }
    seenCardIds.add(id);
    return { ...card, id };
  });

  const normalizedEnemies = Array.from({ length: 4 }, (_, idx) => {
    const fallback = normalizeEnemy(
      {
        id: `enemy_${idx + 1}_${toFileSafeKey(theme)}`,
        name: `Wandering Foe ${idx + 1}`,
      },
      theme,
      false,
    );
    const next = normalizeEnemy(parsed.enemies?.[idx], theme);
    return { ...fallback, ...next };
  });
  const seenEnemyIds = new Set<string>();
  const enemies = normalizedEnemies.map((enemy, idx) => {
    let id = enemy.id || `enemy_${idx + 1}`;
    while (seenEnemyIds.has(id)) {
      id = `${id}_${idx}`;
    }
    seenEnemyIds.add(id);
    return { ...enemy, id };
  });

  const fallbackBoss = createPlaceholderBoss(theme);
  const rawBoss = parsed.boss || {};
  const parsedBossHp = Math.max(80, Math.min(130, Number(rawBoss.maxHp) || fallbackBoss.maxHp));
  const boss: Boss = {
    ...fallbackBoss,
    ...rawBoss,
    id: rawBoss.id || fallbackBoss.id,
    name: rawBoss.name || fallbackBoss.name,
    maxHp: parsedBossHp,
    currentHp: parsedBossHp,
    intents: capIntentDamage(
      Array.isArray(rawBoss.intents) && rawBoss.intents.length > 0 ? rawBoss.intents : fallbackBoss.intents,
      16,
    ),
    phase2Intents: capIntentDamage(
      Array.isArray(rawBoss.phase2Intents) && rawBoss.phase2Intents.length > 0 ? rawBoss.phase2Intents : fallbackBoss.phase2Intents,
      22,
    ),
    narratorText: rawBoss.narratorText || fallbackBoss.narratorText,
  };

  const synergy = (Array.isArray(parsed.synergies) && parsed.synergies[0])
    ? { ...defaultSynergyFromCard(cards[2]), ...parsed.synergies[0] }
    : defaultSynergyFromCard(cards[2]);
  const synergies: Synergy[] = [synergy];

  const objectManifest: Record<string, GeneratedObjectManifestEntry> = {};
  const sharedPlayerRefs = ensureSharedPlayerImageRefs(objectManifest, theme);
  const cardsWithObjects = cards.map((card, idx) => registerCardObjects(
    { objectManifest },
    GLOBAL_ROOM_ID,
    card,
    `run_card_${idx}`,
  ));
  const enemiesWithObjects = enemies.map((enemy, idx) => registerEnemyObjects(
    { objectManifest },
    GLOBAL_ROOM_ID,
    enemy,
    `enemy_${idx}`,
  ));
  const bossWithObjects = registerBossObjects({ objectManifest }, GLOBAL_ROOM_ID, boss);
  const cardsById = new Map(cardsWithObjects.map(card => [card.id, card]));
  const enemiesById = new Map(enemiesWithObjects.map(enemy => [enemy.id, enemy]));
  const nonStarterCards = cardsWithObjects.filter(card => card.id !== 'strike' && card.id !== 'defend');
  const roomsById = new Map<string, GeneratedRoomPlan>();
  const allowedRoomIds = new Set(node_map.map(node => node.id));
  (parsed.rooms || []).forEach(room => {
    if (!room?.roomId || !allowedRoomIds.has(room.roomId) || roomsById.has(room.roomId)) return;
    roomsById.set(room.roomId, room);
  });

  const resolvePlanCard = (
    roomId: string,
    card: Partial<Card> | string | undefined,
    slot: string,
    fallback: Card,
  ): Card => {
    void roomId;
    void slot;
    if (typeof card === 'string' && cardsById.has(card)) {
      return { ...cardsById.get(card)! };
    }
    if (isPlainObject(card) && typeof card.id === 'string' && cardsById.has(card.id)) {
      return { ...cardsById.get(card.id)! };
    }
    if (isPlainObject(card) && typeof card.name === 'string') {
      const byName = cardsWithObjects.find(existing =>
        normalizeCardLookupKey(existing.name) === normalizeCardLookupKey(card.name)
      );
      if (byName) {
        return { ...byName };
      }
    }
    const normalizedInput = isPlainObject(card) ? (card as Partial<Card>) : undefined;
    return normalizedInput
      ? resolveCardFromExistingPool(nonStarterCards, normalizedInput, fallback)
      : { ...fallback };
  };

  let encounterCounter = 0;
  let rewardCursor = 0;
  let shopCursor = 0;
  const rooms: RunDataV2['rooms'] = {};
  const createdAt = nowTs();

  node_map.forEach((node, nodeIndex) => {
    const plan = roomsById.get(node.id);
    let payload: RoomContentPayload;

    if (node.type === 'Combat' || node.type === 'Elite') {
      const desiredEnemyCount = node.type === 'Elite'
        ? 1
        : Math.min(2, Math.max(1, Array.isArray(node.data) ? node.data.length : 1));
      const plannedEnemyIds = (plan?.enemyIds || []).filter(id => enemiesById.has(id));
      const selectedEnemyBases: Enemy[] = [];
      for (let i = 0; i < desiredEnemyCount; i++) {
        const plannedId = plannedEnemyIds[i];
        if (plannedId && enemiesById.has(plannedId)) {
          selectedEnemyBases.push(enemiesById.get(plannedId)!);
        } else {
          selectedEnemyBases.push(enemiesWithObjects[(encounterCounter + i) % enemiesWithObjects.length]);
        }
      }
      if (selectedEnemyBases.length === 0) {
        selectedEnemyBases.push(enemiesWithObjects[encounterCounter % enemiesWithObjects.length]);
      }

      const roomEnemies = selectedEnemyBases.map((base, idx) => {
        const hpScale = node.type === 'Elite'
          ? 1.4
          : (selectedEnemyBases.length > 1 && idx > 0 ? 0.7 : 1);
        const maxHp = Math.max(1, Math.round(base.maxHp * hpScale));
        const name = node.type === 'Elite' ? `Ascended ${base.name}` : base.name;
        return {
          ...base,
          id: `${base.id}_enc_${node.id}_${idx}`,
          name,
          maxHp,
          currentHp: maxHp,
        };
      });
      encounterCounter += 1;

      const rewardFallbackPool = nonStarterCards.length > 0 ? nonStarterCards : cardsWithObjects;
      const rotatedRewardPool = rewardFallbackPool.map((_, idx) => (
        rewardFallbackPool[(rewardCursor + idx) % rewardFallbackPool.length]
      ));
      const plannedRewardCards = (plan?.rewardCards || []).slice(0, 3).map((card, idx) => {
        const fallback = rewardFallbackPool[(rewardCursor + idx) % rewardFallbackPool.length];
        return resolvePlanCard(node.id, card, `reward_${idx}`, fallback);
      });
      const rewardCards = fillCardChoices(plannedRewardCards, rotatedRewardPool, 3);
      rewardCursor += 1;

      const backgroundPrompt = normalizeBattleBackgroundPrompt(plan?.backgroundPrompt, theme);
      const effectiveRoomMusicPrompt = plan?.roomMusicPrompt || roomMusicPrompt;
      const backgroundImageId = buildObjectId(node.id, 'image', 'background');
      const roomMusicId = buildObjectId(node.id, 'audio', 'room_music');
      ensureManifestEntry(objectManifest, {
        id: backgroundImageId,
        roomId: node.id,
        kind: 'image',
        prompt: backgroundPrompt,
        imageType: 'background',
        fileKey: buildObjectFileKey(backgroundImageId),
      });
      if (effectiveRoomMusicPrompt) {
        ensureManifestEntry(objectManifest, {
          id: roomMusicId,
          roomId: node.id,
          kind: 'audio',
          prompt: effectiveRoomMusicPrompt,
          audioSource: node.type === 'Elite' ? 'boss' : 'generic',
          musicMode: 'room',
          fileKey: buildObjectFileKey(roomMusicId),
        });
      }

      payload = {
        roomId: node.id,
        nodeType: node.type === 'Elite' ? 'Elite' : 'Combat',
        enemies: roomEnemies,
        rewardCards,
        backgroundPrompt,
        roomMusicPrompt: effectiveRoomMusicPrompt,
        objectRefs: {
          ...sharedPlayerRefs,
          backgroundImageId,
          enemySpriteImageIds: roomEnemies.map(enemy => enemy.imageObjectId).filter(Boolean) as string[],
          cardImageIds: rewardCards.map(card => card.imageObjectId).filter(Boolean) as string[],
          roomMusicId: effectiveRoomMusicPrompt ? roomMusicId : undefined,
          enemySfxIds: roomEnemies.map(enemy => enemy.audioObjectId).filter(Boolean) as string[],
          cardSfxIds: rewardCards.map(card => card.audioObjectId).filter(Boolean) as string[],
        },
      } satisfies CombatRoomContent;
      node.data = roomEnemies;
    } else if (node.type === 'Boss') {
      const backgroundPrompt = normalizeBattleBackgroundPrompt(plan?.backgroundPrompt, theme);
      const effectiveBossMusicPrompt = plan?.bossMusicPrompt || bossMusicPrompt;
      const backgroundImageId = buildObjectId(node.id, 'image', 'background');
      const bossMusicId = buildObjectId(node.id, 'audio', 'boss_music');
      ensureManifestEntry(objectManifest, {
        id: backgroundImageId,
        roomId: node.id,
        kind: 'image',
        prompt: backgroundPrompt,
        imageType: 'background',
        fileKey: buildObjectFileKey(backgroundImageId),
      });
      ensureManifestEntry(objectManifest, {
        id: bossMusicId,
        roomId: node.id,
        kind: 'audio',
        prompt: effectiveBossMusicPrompt,
        audioSource: 'generic',
        musicMode: 'boss',
        fileKey: buildObjectFileKey(bossMusicId),
      });

      const bossEncounter: Boss = {
        ...bossWithObjects,
        id: `${bossWithObjects.id}_enc_${node.id}`,
        maxHp: bossWithObjects.maxHp,
        currentHp: bossWithObjects.maxHp,
      };

      payload = {
        roomId: node.id,
        nodeType: 'Boss',
        boss: bossEncounter,
        backgroundPrompt,
        bossMusicPrompt: effectiveBossMusicPrompt,
        objectRefs: {
          ...sharedPlayerRefs,
          backgroundImageId,
          bossSpriteImageId: bossEncounter.imageObjectId,
          bossMusicId,
          bossSfxId: bossEncounter.audioObjectId,
          bossTtsId: bossEncounter.narratorAudioObjectId,
        },
      };
      node.data = bossEncounter;
    } else if (node.type === 'Event') {
      const eventImageId = buildObjectId(node.id, 'image', 'event_visual');
      const imagePrompt = plan?.imagePrompt || `mysterious event scene in ${theme} style, fantasy game art`;
      ensureManifestEntry(objectManifest, {
        id: eventImageId,
        roomId: node.id,
        kind: 'image',
        prompt: imagePrompt,
        imageType: 'background',
        fileKey: buildObjectFileKey(eventImageId),
      });
      const fallbackCard = nonStarterCards[0] || cardsWithObjects[0];
      const rawChoices = Array.isArray(plan?.choices) ? plan!.choices : [];
      const choices: EventChoicePayload[] = Array.from({ length: 3 }, (_, idx) => {
        const raw = rawChoices[idx] || {};
        const rawEffects = raw.effects || {};
        const addCard = rawEffects.addCard
          ? resolvePlanCard(node.id, rawEffects.addCard, `event_choice_${idx}`, fallbackCard)
          : undefined;
        const defaultChoice = [
          { id: 'event-heal', label: 'Take a steady breath', description: 'Heal 8 HP.', icon: 'fire', color: 'red', effects: { hpDelta: 8 } },
          { id: 'event-gold', label: 'Search the area', description: 'Gain 20 gold.', icon: 'gold', color: 'orange', effects: { goldDelta: 20 } },
          { id: 'event-card', label: 'Study the omen', description: 'Add a card to your deck.', icon: 'shield', color: 'blue', effects: { addCard: fallbackCard } },
        ][idx];
        return {
          id: typeof raw.id === 'string' && raw.id.trim().length > 0 ? raw.id : defaultChoice.id,
          label: typeof raw.label === 'string' && raw.label.trim().length > 0 ? raw.label : defaultChoice.label,
          description: typeof raw.description === 'string' && raw.description.trim().length > 0 ? raw.description : defaultChoice.description,
          icon: pickEventIcon(raw.icon, defaultChoice.icon as NonNullable<EventChoicePayload['icon']>),
          color: pickEventColor(raw.color, defaultChoice.color as NonNullable<EventChoicePayload['color']>),
          effects: {
            hpDelta: toOptionalNumber(rawEffects.hpDelta) ?? defaultChoice.effects.hpDelta,
            maxHpDelta: toOptionalNumber(rawEffects.maxHpDelta),
            goldDelta: toOptionalNumber(rawEffects.goldDelta) ?? defaultChoice.effects.goldDelta,
            addCard,
          },
        };
      });

      payload = {
        roomId: node.id,
        nodeType: 'Event',
        title: plan?.title || 'A Curious Encounter',
        description: plan?.description || `You encounter an unusual scene shaped by ${theme}.`,
        imagePrompt,
        footerText: plan?.footerText || 'Choose wisely.',
        choices,
        objectRefs: {
          eventImageId,
          cardImageIds: choices.map(choice => choice.effects?.addCard?.imageObjectId).filter(Boolean) as string[],
          cardSfxIds: choices.map(choice => choice.effects?.addCard?.audioObjectId).filter(Boolean) as string[],
        },
      };
    } else if (node.type === 'Shop') {
      const fallbackShopPool = nonStarterCards.length > 0 ? nonStarterCards : cardsWithObjects;
      const plannedShopCards = (plan?.shopCards || []).slice(0, 3).map((card, idx) => {
        const fallback = fallbackShopPool[(shopCursor + idx) % fallbackShopPool.length];
        return resolvePlanCard(node.id, card, `shop_${idx}`, fallback);
      });
      const shopCards = plannedShopCards.length > 0
        ? plannedShopCards
        : Array.from({ length: Math.min(3, fallbackShopPool.length) }, (_, idx) => {
          const fallback = fallbackShopPool[(shopCursor + idx) % fallbackShopPool.length];
          return { ...fallback };
        });
      shopCursor += 1;

      payload = {
        roomId: node.id,
        nodeType: 'Shop',
        shopCards,
        objectRefs: {
          cardImageIds: shopCards.map(card => card.imageObjectId).filter(Boolean) as string[],
          cardSfxIds: shopCards.map(card => card.audioObjectId).filter(Boolean) as string[],
        },
      } satisfies ShopRoomContent;
    } else if (node.type === 'Treasure') {
      payload = {
        roomId: node.id,
        nodeType: 'Treasure',
        treasureGold: Math.max(50, Number(plan?.treasureGold) || 100),
      };
    } else {
      payload = {
        roomId: node.id,
        nodeType: 'Campfire',
      };
    }

    rooms[node.id] = {
      status: 'ready',
      lastUpdatedAt: createdAt + nodeIndex,
      payload: syncPayloadCardRefs(payload),
    };
  });

  const starterCards = cardsWithObjects.slice(0, 3) as [Card, Card, Card];
  const firstEnemy = enemiesWithObjects[0];
  const firstCombatNode = getFirstCombatNode(node_map);
  if (firstCombatNode && firstCombatNode.data == null) {
    firstCombatNode.data = [{
      ...firstEnemy,
      id: `${firstEnemy.id}_enc_${firstCombatNode.id}_0`,
      maxHp: firstEnemy.maxHp,
      currentHp: firstEnemy.maxHp,
    }];
  }

  const bootstrap = {
    theme,
    starterCards,
    firstEnemy,
    roomMusicPrompt,
    essentialSfxPrompts: [
      starterCards[0].audioPrompt || 'tempered steel slash through dry parchment',
      starterCards[1].audioPrompt || 'solid shield impact with muffled iron ring',
      starterCards[2].audioPrompt || 'surging arcane pulse with crisp impact',
      firstEnemy.audioPrompt || 'rusted blade swipe with chain rattle',
    ],
  };

  const runData: RunDataV2 = {
    version: 2,
    generationSettings: {
      mode: settings.mode || 'fast_start',
      prefetchDepth: settings.prefetchDepth ?? 2,
    },
    theme,
    cards: cardsWithObjects,
    enemies: enemiesWithObjects,
    boss: bossWithObjects,
    synergies,
    node_map,
    roomMusicPrompt,
    bossMusicPrompt,
    objectManifest,
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
    systemInstruction: `Generate content for a single roguelike combat room. Return strict JSON.
Card imagePrompt rule: ${CARD_IMAGE_PROMPT_RULE}
Audio rules: audioPrompt fields must be 4-14 word semantic fragments describing the physical sound (action + material). Prefer warm, weighty impacts. No technical audio terms. No spoken dialogue in audioPrompt.`,
    responseMimeType: 'application/json',
    responseSchema: {
      type: Type.OBJECT,
      properties: {
        enemy: partialEnemySchema,
        rewardCards: { type: Type.ARRAY, items: partialCardSchema, minItems: 3, maxItems: 3 },
        backgroundPrompt: { type: Type.STRING, description: `Scene prompt for combat background. ${BATTLE_STAGE_FLOOR_PROMPT_RULE}` },
        roomMusicPrompt: { type: Type.STRING },
      },
      required: ['enemy'],
    },
  };

  const statGuidance = node.type === 'Elite'
    ? ' Elite enemies should have 35-55 HP and 8-12 attack damage.'
    : ' Normal enemies should have 20-35 HP and 5-9 attack damage.';
  const parts = [{
    text: `Room type: ${node.type}. ${getRoomPromptContext(runData)} Generate an enemy and exactly 3 reward cards.${statGuidance} Enemy must include isFlying=true only if airborne, otherwise false. Background prompt must enforce one fixed horizontal ground platform for player and ground enemies.`
  }];
  try {
    const parsed = await requestStructuredJson<{
      enemy: Partial<Enemy>;
      rewardCards: Partial<Card>[];
      backgroundPrompt?: string;
      roomMusicPrompt?: string;
    }>('generateCombatRoomPayload', config, parts);

    const isElite = node.type === 'Elite';
    const manifestScope = { objectManifest: runData.objectManifest };
    let enemy = normalizeEnemy(parsed.enemy, runData.theme, isElite);
    if (isElite) {
      const eliteHp = Math.min(65, Math.round(enemy.maxHp * 1.4));
      enemy = {
        ...enemy,
        id: `elite_${enemy.id}`,
        name: `Ascended ${enemy.name}`,
        maxHp: eliteHp,
        currentHp: eliteHp,
      };
    }

    // For multi-enemy nodes, pick a second enemy from pool with 70% HP
    const nodeData = node.data;
    const isMultiEnemy = Array.isArray(nodeData) && nodeData.length > 1;
    const allEnemies: Enemy[] = [enemy];
    if (!isElite && isMultiEnemy && runData.enemies.length > 1) {
      const secondSource = runData.enemies.find(e => e.id !== enemy.id) || runData.enemies[0];
      const secondHp = Math.max(1, Math.round(secondSource.maxHp * 0.7));
      allEnemies.push({
        ...secondSource,
        id: `${secondSource.id}_dual`,
        maxHp: secondHp,
        currentHp: secondHp,
      });
    }

    const rewardFallbackPool = runData.cards
      .filter(card => {
        const normalizedName = card.name.trim().toLowerCase();
        return normalizedName !== 'strike' && normalizedName !== 'defend';
      });
    const defaultFallbackReward = runData.cards[2] || runData.cards[0] || createFallbackSpecialCard(runData.theme, 0);
    const effectiveRewardPool = rewardFallbackPool.length > 0 ? rewardFallbackPool : [defaultFallbackReward];
    const plannedRewardCards = (parsed.rewardCards || []).slice(0, 3).map((cardHint, idx) => {
      const fallback = effectiveRewardPool[idx % effectiveRewardPool.length];
      return resolveCardFromExistingPool(effectiveRewardPool, cardHint, fallback);
    });
    const effectiveRewardCards = fillCardChoices(plannedRewardCards, effectiveRewardPool, 3).map(card => ({ ...card }));

    const roomMusicPrompt = parsed.roomMusicPrompt || runData.roomMusicPrompt;
    const backgroundPrompt = normalizeBattleBackgroundPrompt(parsed.backgroundPrompt, runData.theme);
    const enemiesWithObjects = allEnemies.map((e, idx) => registerEnemyObjects(manifestScope, node.id, e, `${node.type.toLowerCase()}_${idx}`));
    const backgroundImageId = buildObjectId(node.id, 'image', 'background');
    const roomMusicId = buildObjectId(node.id, 'audio', 'room_music');
    const sharedPlayerImageRefs = ensureSharedPlayerImageRefs(runData.objectManifest, runData.theme);

    ensureManifestEntry(runData.objectManifest, {
      id: backgroundImageId,
      roomId: node.id,
      kind: 'image',
      prompt: backgroundPrompt,
      imageType: 'background',
      fileKey: buildObjectFileKey(backgroundImageId),
    });
    if (roomMusicPrompt) {
      ensureManifestEntry(runData.objectManifest, {
        id: roomMusicId,
        roomId: node.id,
        kind: 'audio',
        prompt: roomMusicPrompt,
        audioSource: node.type === 'Elite' ? 'boss' : 'generic',
        musicMode: 'room',
        fileKey: buildObjectFileKey(roomMusicId),
      });
    }

    return {
      roomId: node.id,
      nodeType: node.type === 'Elite' ? 'Elite' : 'Combat',
      enemies: enemiesWithObjects,
      rewardCards: effectiveRewardCards,
      backgroundPrompt,
      roomMusicPrompt,
      objectRefs: {
        ...sharedPlayerImageRefs,
        backgroundImageId,
        enemySpriteImageIds: enemiesWithObjects.map(e => e.imageObjectId).filter(Boolean) as string[],
        cardImageIds: effectiveRewardCards.map(card => card.imageObjectId).filter(Boolean) as string[],
        roomMusicId: roomMusicPrompt ? roomMusicId : undefined,
        enemySfxIds: enemiesWithObjects.map(e => e.audioObjectId).filter(Boolean) as string[],
        cardSfxIds: effectiveRewardCards.map(card => card.audioObjectId).filter(Boolean) as string[],
      },
    };
  } catch (err) {
    console.error('generateCombatRoomPayload fallback:', err);
    const manifestScope = { objectManifest: runData.objectManifest };
    const fallbackEnemy = runData.enemies[0] || normalizeEnemy(undefined, runData.theme);
    const backgroundPrompt = buildDefaultBattleBackgroundPrompt(runData.theme);
    const fallbackRewardPool = runData.cards
      .filter(card => {
        const normalizedName = card.name.trim().toLowerCase();
        return normalizedName !== 'strike' && normalizedName !== 'defend';
      });
    const fallbackRewardSource = fallbackRewardPool.length > 0
      ? fallbackRewardPool
      : [runData.cards[2] || runData.cards[0] || createFallbackSpecialCard(runData.theme, 0)];
    const rewardCards = fillCardChoices([], fallbackRewardSource, 3).map(card => ({ ...card }));
    let resolvedEnemy = fallbackEnemy;
    if (node.type === 'Elite') {
      const eliteHp = Math.min(65, Math.round(fallbackEnemy.maxHp * 1.4));
      resolvedEnemy = {
        ...fallbackEnemy,
        id: `elite_${fallbackEnemy.id}`,
        name: `Ascended ${fallbackEnemy.name}`,
        maxHp: eliteHp,
        currentHp: eliteHp,
      };
    }
    const enemyWithObjects = registerEnemyObjects(
      manifestScope,
      node.id,
      resolvedEnemy,
      node.type.toLowerCase()
    );
    const backgroundImageId = buildObjectId(node.id, 'image', 'background');
    const roomMusicId = buildObjectId(node.id, 'audio', 'room_music');
    const sharedPlayerImageRefs = ensureSharedPlayerImageRefs(runData.objectManifest, runData.theme);
    ensureManifestEntry(runData.objectManifest, {
      id: backgroundImageId,
      roomId: node.id,
      kind: 'image',
      prompt: backgroundPrompt,
      imageType: 'background',
      fileKey: buildObjectFileKey(backgroundImageId),
    });
    if (runData.roomMusicPrompt) {
      ensureManifestEntry(runData.objectManifest, {
        id: roomMusicId,
        roomId: node.id,
        kind: 'audio',
        prompt: runData.roomMusicPrompt,
        audioSource: node.type === 'Elite' ? 'boss' : 'generic',
        musicMode: 'room',
        fileKey: buildObjectFileKey(roomMusicId),
      });
    }
    return {
      roomId: node.id,
      nodeType: node.type === 'Elite' ? 'Elite' : 'Combat',
      enemies: [enemyWithObjects],
      rewardCards,
      backgroundPrompt,
      roomMusicPrompt: runData.roomMusicPrompt,
      objectRefs: {
        ...sharedPlayerImageRefs,
        backgroundImageId,
        enemySpriteImageIds: [enemyWithObjects.imageObjectId].filter(Boolean) as string[],
        cardImageIds: rewardCards.map(card => card.imageObjectId).filter(Boolean) as string[],
        roomMusicId: runData.roomMusicPrompt ? roomMusicId : undefined,
        enemySfxIds: [enemyWithObjects.audioObjectId].filter(Boolean) as string[],
        cardSfxIds: rewardCards.map(card => card.audioObjectId).filter(Boolean) as string[],
      },
    };
  }
}

async function generateBossRoomPayload(runData: RunDataV2, node: MapNode): Promise<RoomContentPayload> {
  const config = {
    systemInstruction: `Generate content for a single roguelike boss room. Return strict JSON.
Audio rules: audioPrompt fields must be 4-14 word semantic fragments describing the physical sound (action + material). Prefer warm, weighty impacts. No technical audio terms. No spoken dialogue in audioPrompt.
Narrator voice hints should default to natural human delivery unless synthetic tone is explicitly required by theme.`,
    responseMimeType: 'application/json',
    responseSchema: {
      type: Type.OBJECT,
      properties: {
        boss: partialBossSchema,
        backgroundPrompt: { type: Type.STRING, description: `Scene prompt for boss combat background. ${BATTLE_STAGE_FLOOR_PROMPT_RULE}` },
        bossMusicPrompt: { type: Type.STRING },
      },
      required: ['boss'],
    },
  };

  const parts = [{
    text: `Room type: Boss. ${getRoomPromptContext(runData)} Create a dramatic boss encounter. Background prompt must enforce one fixed horizontal ground platform where player and boss stand.`
  }];
  try {
    const parsed = await requestStructuredJson<{ boss: Partial<Boss>; backgroundPrompt?: string; bossMusicPrompt?: string }>(
      'generateBossRoomPayload',
      config,
      parts
    );
    const fallback = runData.boss || createPlaceholderBoss(runData.theme);
    const manifestScope = { objectManifest: runData.objectManifest };
    const rawHp = Number(parsed.boss?.maxHp) || fallback.maxHp;
    const bossHp = Math.min(120, Math.max(80, rawHp));
    const bossRaw: Boss = {
      ...fallback,
      ...parsed.boss,
      maxHp: bossHp,
      currentHp: bossHp,
      intents: capIntentDamage(
        parsed.boss?.intents && parsed.boss.intents.length > 0 ? parsed.boss.intents : fallback.intents,
        15
      ),
      phase2Intents: capIntentDamage(
        parsed.boss?.phase2Intents && parsed.boss.phase2Intents.length > 0 ? parsed.boss.phase2Intents : fallback.phase2Intents,
        20
      ),
    };
    const boss = registerBossObjects(manifestScope, node.id, bossRaw);
    const backgroundPrompt = normalizeBattleBackgroundPrompt(parsed.backgroundPrompt, runData.theme);
    const bossMusicPrompt = parsed.bossMusicPrompt || runData.bossMusicPrompt || 'ominous low choir over cavernous drones and muted war drums';
    const backgroundImageId = buildObjectId(node.id, 'image', 'background');
    const bossMusicId = buildObjectId(node.id, 'audio', 'boss_music');
    const sharedPlayerImageRefs = ensureSharedPlayerImageRefs(runData.objectManifest, runData.theme);
    ensureManifestEntry(runData.objectManifest, {
      id: backgroundImageId,
      roomId: node.id,
      kind: 'image',
      prompt: backgroundPrompt,
      imageType: 'background',
      fileKey: buildObjectFileKey(backgroundImageId),
    });
    ensureManifestEntry(runData.objectManifest, {
      id: bossMusicId,
      roomId: node.id,
      kind: 'audio',
      prompt: bossMusicPrompt,
      audioSource: 'generic',
      musicMode: 'boss',
      fileKey: buildObjectFileKey(bossMusicId),
    });
    return {
      roomId: node.id,
      nodeType: 'Boss',
      boss,
      backgroundPrompt,
      bossMusicPrompt,
      objectRefs: {
        ...sharedPlayerImageRefs,
        backgroundImageId,
        bossSpriteImageId: boss.imageObjectId,
        bossMusicId,
        bossSfxId: boss.audioObjectId,
        bossTtsId: boss.narratorAudioObjectId,
      },
    };
  } catch (err) {
    console.error('generateBossRoomPayload fallback:', err);
    const manifestScope = { objectManifest: runData.objectManifest };
    const boss = registerBossObjects(manifestScope, node.id, runData.boss || createPlaceholderBoss(runData.theme));
    const backgroundPrompt = buildDefaultBattleBackgroundPrompt(runData.theme);
    const bossMusicPrompt = runData.bossMusicPrompt || 'ominous low choir over cavernous drones and muted war drums';
    const backgroundImageId = buildObjectId(node.id, 'image', 'background');
    const bossMusicId = buildObjectId(node.id, 'audio', 'boss_music');
    const sharedPlayerImageRefs = ensureSharedPlayerImageRefs(runData.objectManifest, runData.theme);
    ensureManifestEntry(runData.objectManifest, {
      id: backgroundImageId,
      roomId: node.id,
      kind: 'image',
      prompt: backgroundPrompt,
      imageType: 'background',
      fileKey: buildObjectFileKey(backgroundImageId),
    });
    ensureManifestEntry(runData.objectManifest, {
      id: bossMusicId,
      roomId: node.id,
      kind: 'audio',
      prompt: bossMusicPrompt,
      audioSource: 'generic',
      musicMode: 'boss',
      fileKey: buildObjectFileKey(bossMusicId),
    });
    return {
      roomId: node.id,
      nodeType: 'Boss',
      boss,
      backgroundPrompt,
      bossMusicPrompt,
      objectRefs: {
        ...sharedPlayerImageRefs,
        backgroundImageId,
        bossSpriteImageId: boss.imageObjectId,
        bossMusicId,
        bossSfxId: boss.audioObjectId,
        bossTtsId: boss.narratorAudioObjectId,
      },
    };
  }
}

async function generateEventRoomPayload(runData: RunDataV2, node: MapNode): Promise<EventRoomContent> {
  const config = {
    systemInstruction: `Generate content for a single roguelike event room. Return strict JSON with exactly 3 choices.
Card imagePrompt rule: ${CARD_IMAGE_PROMPT_RULE}
Audio rules: audioPrompt fields must be 4-14 word semantic fragments describing the physical sound (action + material). Prefer warm, weighty impacts. No technical audio terms. No spoken dialogue in audioPrompt.`,
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
                  addCard: partialCardSchema,
                },
              }
            }
          },
        },
      },
    },
  };

  const parts = [{ text: `Room type: Event. ${getRoomPromptContext(runData)} Build a thematic narrative event with exactly 3 meaningful choices.` }];
  try {
    const parsed = await requestStructuredJson<{
      title?: string;
      description?: string;
      imagePrompt?: string;
      footerText?: string;
      choices?: Array<{
        id?: string;
        label?: string;
        description?: string;
        icon?: unknown;
        color?: unknown;
        effects?: {
          hpDelta?: unknown;
          maxHpDelta?: unknown;
          goldDelta?: unknown;
          addCard?: Partial<Card>;
        };
      }>;
    }>('generateEventRoomPayload', config, parts);
    const eventImageId = buildObjectId(node.id, 'image', 'event_visual');
    ensureManifestEntry(runData.objectManifest, {
      id: eventImageId,
      roomId: node.id,
      kind: 'image',
      prompt: parsed.imagePrompt,
      imageType: 'background',
      fileKey: buildObjectFileKey(eventImageId),
    });
    const fallbackCard = runData.cards[2] || runData.cards[0] || createStrikeCard(runData.theme);
    const nonStarterPool = runData.cards.filter(card => {
      const name = card.name.trim().toLowerCase();
      return name !== 'strike' && name !== 'defend';
    });
    const fallbackChoices: EventChoicePayload[] = [
      {
        id: 'event-heal',
        label: 'Take a steady breath',
        description: 'Heal 8 HP.',
        icon: 'fire',
        color: 'red',
        effects: { hpDelta: 8 },
      },
      {
        id: 'event-gold',
        label: 'Search the area',
        description: 'Gain 20 gold.',
        icon: 'gold',
        color: 'orange',
        effects: { goldDelta: 20 },
      },
      {
        id: 'event-card',
        label: 'Study the omen',
        description: 'Add a card to your deck.',
        icon: 'shield',
        color: 'blue',
        effects: { addCard: fallbackCard },
      },
    ];

    const rawChoices = Array.isArray(parsed.choices) ? parsed.choices : [];
    const normalizedChoices = [0, 1, 2].map((idx) => {
      const raw = (rawChoices[idx] && typeof rawChoices[idx] === 'object')
        ? rawChoices[idx] as Record<string, unknown>
        : {};
      const fallback = fallbackChoices[idx];
      const rawEffects = (raw.effects && typeof raw.effects === 'object') ? raw.effects as Record<string, unknown> : {};

      const addCardRaw = rawEffects.addCard && typeof rawEffects.addCard === 'object'
        ? rawEffects.addCard as Partial<Card>
        : undefined;
      const fallbackAddCard = fallback.effects.addCard || fallbackCard;
      const addCard = addCardRaw
        ? resolveCardFromExistingPool(nonStarterPool, addCardRaw, fallbackAddCard)
        : (fallbackAddCard ? { ...fallbackAddCard } : undefined);

      return {
        id: typeof raw.id === 'string' && raw.id.trim().length > 0 ? raw.id : fallback.id,
        label: typeof raw.label === 'string' && raw.label.trim().length > 0 ? raw.label : fallback.label,
        description: typeof raw.description === 'string' && raw.description.trim().length > 0 ? raw.description : fallback.description,
        icon: pickEventIcon(raw.icon, fallback.icon || 'shield'),
        color: pickEventColor(raw.color, fallback.color || 'blue'),
        effects: {
          hpDelta: toOptionalNumber(rawEffects.hpDelta) ?? fallback.effects.hpDelta,
          maxHpDelta: toOptionalNumber(rawEffects.maxHpDelta) ?? fallback.effects.maxHpDelta,
          goldDelta: toOptionalNumber(rawEffects.goldDelta) ?? fallback.effects.goldDelta,
          addCard,
        },
      } satisfies EventChoicePayload;
    });

    return {
      roomId: node.id,
      nodeType: 'Event',
      title: parsed.title || 'A Curious Encounter',
      description: parsed.description || `You encounter an unusual scene shaped by ${runData.theme}.`,
      imagePrompt: parsed.imagePrompt || `mysterious event scene in ${runData.theme} style, fantasy game art`,
      footerText: parsed.footerText || 'Choose wisely.',
      choices: normalizedChoices,
      objectRefs: {
        eventImageId,
        cardImageIds: normalizedChoices
          .map(choice => choice.effects?.addCard?.imageObjectId)
          .filter(Boolean) as string[],
        cardSfxIds: normalizedChoices
          .map(choice => choice.effects?.addCard?.audioObjectId)
          .filter(Boolean) as string[],
      },
    };
  } catch (err) {
    console.error('generateEventRoomPayload fallback:', err);
    const fallbackImagePrompt = `ancient glowing altar in a ruined hall, ${runData.theme} style`;
    const eventImageId = buildObjectId(node.id, 'image', 'event_visual');
    ensureManifestEntry(runData.objectManifest, {
      id: eventImageId,
      roomId: node.id,
      kind: 'image',
      prompt: fallbackImagePrompt,
      imageType: 'background',
      fileKey: buildObjectFileKey(eventImageId),
    });
    const fallbackCard = runData.cards[2] || runData.cards[0];
    const fallbackEventCard = fallbackCard ? { ...fallbackCard } : undefined;
    return {
      roomId: node.id,
      nodeType: 'Event',
      title: 'The Silent Altar',
      description: 'A weathered altar glows faintly as you approach.',
      imagePrompt: fallbackImagePrompt,
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
          effects: { addCard: fallbackEventCard },
        },
      ],
      objectRefs: {
        eventImageId,
        cardImageIds: fallbackEventCard?.imageObjectId ? [fallbackEventCard.imageObjectId] : [],
        cardSfxIds: fallbackEventCard?.audioObjectId ? [fallbackEventCard.audioObjectId] : [],
      },
    };
  }
}

async function generateShopRoomPayload(runData: RunDataV2, node: MapNode): Promise<ShopRoomContent> {
  const config = {
    systemInstruction: `Generate content for a single roguelike shop room. Return strict JSON with 3 shop cards.
Card imagePrompt rule: ${CARD_IMAGE_PROMPT_RULE}
Audio rules: audioPrompt fields must be 4-14 word semantic fragments describing the physical sound (action + material). Prefer warm, weighty impacts. No technical audio terms. No spoken dialogue in audioPrompt.`,
    responseMimeType: 'application/json',
    responseSchema: {
      type: Type.OBJECT,
      properties: {
        shopCards: {
          type: Type.ARRAY,
          maxItems: 3,
          items: partialCardSchema,
        },
      },
    },
  };

  const parts = [{ text: `Room type: Shop. ${getRoomPromptContext(runData)} Create three purchasable cards.` }];
  try {
    const parsed = await requestStructuredJson<{ shopCards: Partial<Card>[] }>('generateShopRoomPayload', config, parts);
    const pool = runData.cards.filter(card => {
      const n = card.name.trim().toLowerCase();
      return n !== 'strike' && n !== 'defend';
    });
    const fallback = pool[0] || runData.cards[2] || runData.cards[0];
    const planned = (parsed.shopCards || []).slice(0, 3).map((cardHint, idx) => {
      const localFallback = pool[idx % (pool.length || 1)] || fallback;
      return resolveCardFromExistingPool(pool.length > 0 ? pool : [fallback], cardHint, localFallback);
    });
    const effectiveShopCards = fillCardChoices(planned, pool.length > 0 ? pool : [fallback], 3).map(card => ({ ...card }));
    return {
      roomId: node.id,
      nodeType: 'Shop',
      shopCards: effectiveShopCards,
      objectRefs: {
        cardImageIds: effectiveShopCards.map(card => card.imageObjectId).filter(Boolean) as string[],
        cardSfxIds: effectiveShopCards.map(card => card.audioObjectId).filter(Boolean) as string[],
      },
    };
  } catch (err) {
    console.error('generateShopRoomPayload fallback:', err);
    const fallbackPool = runData.cards.filter(card => {
      const n = card.name.trim().toLowerCase();
      return n !== 'strike' && n !== 'defend';
    });
    const cards = fillCardChoices([], fallbackPool.length > 0 ? fallbackPool : runData.cards, 3)
      .map(card => ({ ...card }));
    return {
      roomId: node.id,
      nodeType: 'Shop',
      shopCards: cards,
      objectRefs: {
        cardImageIds: cards.map(card => card.imageObjectId).filter(Boolean) as string[],
        cardSfxIds: cards.map(card => card.audioObjectId).filter(Boolean) as string[],
      },
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
  const playerPortraitPrompt = buildPlayerPortraitPrompt(theme);
  const firstEnemy = runData.enemies[0];
  const imagePromises: Promise<void>[] = [];

  const preloadImageWithManifest = async (
    prompt: string | undefined,
    type: 'asset' | 'background' | 'character',
    objectId?: string,
    onReady?: (url: string) => void,
  ) => {
    if (!prompt) return;
    try {
      const url = await generateGameImage(prompt, type, objectId ? buildObjectFileKey(objectId) : undefined);
      if (url) {
        markManifestReady(runData, objectId, url);
        if (onReady) onReady(url);
      }
    } catch (e) {
      console.error('Failed to preload essential image:', e);
      markManifestFailed(runData, objectId, e);
    }
  };

  if (isRunDataV2(runData)) {
    const firstNode = getFirstCombatNode(runData.node_map);
    const roomPayload = firstNode ? runData.rooms[firstNode.id]?.payload : undefined;
    const refs = roomPayload?.objectRefs;
    const starterCards = runData.bootstrap?.starterCards || runData.cards.slice(0, 3);

    imagePromises.push(preloadImageWithManifest(
      roomPayload && (roomPayload.nodeType === 'Combat' || roomPayload.nodeType === 'Elite' || roomPayload.nodeType === 'Boss')
        ? roomPayload.backgroundPrompt
        : buildDefaultBattleBackgroundPrompt(theme),
      'background',
      refs?.backgroundImageId,
      (url) => {
        if (roomPayload && (roomPayload.nodeType === 'Combat' || roomPayload.nodeType === 'Elite' || roomPayload.nodeType === 'Boss')) {
          roomPayload.backgroundImageUrl = url;
          roomPayload.objectUrls = { ...(roomPayload.objectUrls || {}), backgroundImageUrl: url };
        }
      }
    ));
    imagePromises.push(preloadImageWithManifest(
      playerPortraitPrompt,
      'character',
      refs?.playerPortraitImageId,
      (url) => {
        if (roomPayload) {
          roomPayload.objectUrls = { ...(roomPayload.objectUrls || {}), playerPortraitImageUrl: url };
        }
      }
    ));
    imagePromises.push(preloadImageWithManifest(
      buildPlayerSpritePrompt(theme),
      'character',
      refs?.playerSpriteImageId,
      (url) => {
        if (roomPayload) {
          roomPayload.objectUrls = { ...(roomPayload.objectUrls || {}), playerSpriteImageUrl: url };
        }
      }
    ));

    if (roomPayload && (roomPayload.nodeType === 'Combat' || roomPayload.nodeType === 'Elite')) {
      roomPayload.enemies.forEach((enemy, index) => {
        imagePromises.push(preloadImageWithManifest(
          enemy.imagePrompt ? buildEnemySpritePrompt(enemy.imagePrompt) : undefined,
          'character',
          enemy.imageObjectId || refs?.enemySpriteImageIds?.[index] || refs?.enemySpriteImageId,
          (url) => {
            enemy.imageUrl = url;
            const enemySpriteImageUrls = [...(roomPayload.objectUrls?.enemySpriteImageUrls || [])];
            enemySpriteImageUrls[index] = url;
            roomPayload.objectUrls = {
              ...(roomPayload.objectUrls || {}),
              enemySpriteImageUrl: index === 0 ? url : roomPayload.objectUrls?.enemySpriteImageUrl,
              enemySpriteImageUrls,
            };
          }
        ));
      });
    } else if (roomPayload && roomPayload.nodeType === 'Boss') {
      imagePromises.push(preloadImageWithManifest(
        roomPayload.boss.imagePrompt ? buildBossSpritePrompt(roomPayload.boss.imagePrompt) : undefined,
        'character',
        roomPayload.boss.imageObjectId || refs?.bossSpriteImageId,
        (url) => {
          roomPayload.boss.imageUrl = url;
          roomPayload.objectUrls = { ...(roomPayload.objectUrls || {}), bossSpriteImageUrl: url };
        }
      ));
    } else if (firstEnemy?.imagePrompt) {
      imagePromises.push(preloadImageWithManifest(
        buildEnemySpritePrompt(firstEnemy.imagePrompt),
        'character',
        firstEnemy.imageObjectId || refs?.enemySpriteImageIds?.[0] || refs?.enemySpriteImageId,
        (url) => {
          firstEnemy.imageUrl = url;
        }
      ));
    }

    starterCards.forEach((card, index) => {
      imagePromises.push(preloadImageWithManifest(
        card.imagePrompt,
        'asset',
        card.imageObjectId,
        (url) => {
          card.imageUrl = url;
          if (roomPayload && index < 3) {
            const cardImageUrls = [...(roomPayload.objectUrls?.cardImageUrls || [])];
            cardImageUrls[index] = url;
            roomPayload.objectUrls = { ...(roomPayload.objectUrls || {}), cardImageUrls };
          }
        }
      ));
    });

    if (roomPayload && (roomPayload.nodeType === 'Combat' || roomPayload.nodeType === 'Elite') && roomPayload.rewardCards) {
      roomPayload.rewardCards.forEach((card, idx) => {
        imagePromises.push(preloadImageWithManifest(
          card.imagePrompt,
          'asset',
          card.imageObjectId || roomPayload.objectRefs?.cardImageIds?.[idx],
          (url) => {
            card.imageUrl = url;
            const cardImageUrls = [...(roomPayload.objectUrls?.cardImageUrls || [])];
            const offset = starterCards.length + idx;
            cardImageUrls[offset] = url;
            roomPayload.objectUrls = { ...(roomPayload.objectUrls || {}), cardImageUrls };
          }
        ));
      });
    }
  } else {
    const cards = runData.cards.slice(0, 3);
    imagePromises.push(preloadImageWithManifest(buildDefaultBattleBackgroundPrompt(theme), 'background'));
    imagePromises.push(preloadImageWithManifest(playerPortraitPrompt, 'character'));
    imagePromises.push(preloadImageWithManifest(buildPlayerSpritePrompt(theme), 'character'));
    if (firstEnemy?.imagePrompt) {
      imagePromises.push(preloadImageWithManifest(buildEnemySpritePrompt(firstEnemy.imagePrompt), 'character', undefined, (url) => {
        firstEnemy.imageUrl = url;
      }));
    }
    cards.forEach(card => {
      imagePromises.push(preloadImageWithManifest(card.imagePrompt, 'asset', undefined, (url) => {
        card.imageUrl = url;
      }));
    });
  }

  await Promise.all(imagePromises);
}

export async function preloadRoomImages(runData: RunDataV2, roomId: string, payload: RoomContentPayload): Promise<void> {
  const preloadImage = async (
    prompt: string | undefined,
    type: 'asset' | 'background' | 'character',
    objectId?: string,
    onReady?: (url: string) => void,
  ) => {
    if (!prompt) return;
    try {
      const url = await generateGameImage(prompt, type, objectId ? buildObjectFileKey(objectId) : undefined);
      if (url) {
        markManifestReady(runData, objectId, url);
        if (onReady) onReady(url);
      }
    } catch (err) {
      console.error(`Failed to preload room image (${roomId}):`, err);
      markManifestFailed(runData, objectId, err);
    }
  };

  const promises: Promise<void>[] = [];

  if (payload.nodeType === 'Combat' || payload.nodeType === 'Elite') {
    const primaryEnemy = payload.enemies[0];
    promises.push(preloadImage(payload.backgroundPrompt, 'background', payload.objectRefs?.backgroundImageId, (url) => {
      payload.backgroundImageUrl = url;
      payload.objectUrls = { ...(payload.objectUrls || {}), backgroundImageUrl: url };
    }));
    payload.enemies.forEach((enemy, idx) => {
      promises.push(preloadImage(
        enemy.imagePrompt ? buildEnemySpritePrompt(enemy.imagePrompt) : undefined,
        'character',
        enemy.imageObjectId || payload.objectRefs?.enemySpriteImageIds?.[idx],
        (url) => {
          enemy.imageUrl = url;
          const enemySpriteImageUrls = [...(payload.objectUrls?.enemySpriteImageUrls || [])];
          enemySpriteImageUrls[idx] = url;
          payload.objectUrls = { ...(payload.objectUrls || {}), enemySpriteImageUrls };
        }
      ));
    });
    (payload.rewardCards || []).forEach((card, idx) => {
      promises.push(preloadImage(card.imagePrompt, 'asset', card.imageObjectId || payload.objectRefs?.cardImageIds?.[idx], (url) => {
        card.imageUrl = url;
        const cardImageUrls = [...(payload.objectUrls?.cardImageUrls || [])];
        cardImageUrls[idx] = url;
        payload.objectUrls = { ...(payload.objectUrls || {}), cardImageUrls };
      }));
    });
  } else if (payload.nodeType === 'Boss') {
    promises.push(preloadImage(payload.backgroundPrompt, 'background', payload.objectRefs?.backgroundImageId, (url) => {
      payload.backgroundImageUrl = url;
      payload.objectUrls = { ...(payload.objectUrls || {}), backgroundImageUrl: url };
    }));
    promises.push(preloadImage(
      payload.boss?.imagePrompt ? buildBossSpritePrompt(payload.boss.imagePrompt) : undefined,
      'character',
      payload.boss.imageObjectId || payload.objectRefs?.bossSpriteImageId,
      (url) => {
        payload.boss.imageUrl = url;
        payload.objectUrls = { ...(payload.objectUrls || {}), bossSpriteImageUrl: url };
      }
    ));
  } else if (payload.nodeType === 'Event') {
    promises.push(preloadImage(payload.imagePrompt, 'background', payload.objectRefs?.eventImageId, (url) => {
      payload.imageUrl = url;
      payload.objectUrls = { ...(payload.objectUrls || {}), eventImageUrl: url };
    }));
    payload.choices.forEach((choice, idx) => {
      if (choice.effects?.addCard) {
        promises.push(preloadImage(
          choice.effects.addCard.imagePrompt,
          'asset',
          choice.effects.addCard.imageObjectId || payload.objectRefs?.cardImageIds?.[idx],
          (url) => {
            choice.effects.addCard!.imageUrl = url;
            const cardImageUrls = [...(payload.objectUrls?.cardImageUrls || [])];
            cardImageUrls[idx] = url;
            payload.objectUrls = { ...(payload.objectUrls || {}), cardImageUrls };
          }
        ));
      }
    });
  } else if (payload.nodeType === 'Shop') {
    payload.shopCards.forEach((card, idx) => {
      promises.push(preloadImage(card.imagePrompt, 'asset', card.imageObjectId || payload.objectRefs?.cardImageIds?.[idx], (url) => {
        card.imageUrl = url;
        const cardImageUrls = [...(payload.objectUrls?.cardImageUrls || [])];
        cardImageUrls[idx] = url;
        payload.objectUrls = { ...(payload.objectUrls || {}), cardImageUrls };
      }));
    });
  }

  if (promises.length === 0) return;
  await Promise.all(promises);
}

export function applyRoomContentToRunData(
  runData: RunDataV2,
  roomId: string,
  payload: RoomContentPayload,
  manifestPatch?: Record<string, GeneratedObjectManifestEntry>
): RunDataV2 {
  const mergeManifestEntry = (
    existing: GeneratedObjectManifestEntry | undefined,
    incoming: GeneratedObjectManifestEntry,
  ): GeneratedObjectManifestEntry => {
    if (!existing) return incoming;

    if (existing.status === 'ready' && incoming.status !== 'ready') {
      return existing;
    }
    if (incoming.status === 'ready' && existing.status !== 'ready') {
      return incoming;
    }

    const existingUpdatedAt = existing.updatedAt ?? existing.createdAt ?? 0;
    const incomingUpdatedAt = incoming.updatedAt ?? incoming.createdAt ?? 0;
    if (incomingUpdatedAt > existingUpdatedAt) {
      return incoming;
    }
    if (existingUpdatedAt > incomingUpdatedAt) {
      return existing;
    }

    return { ...existing, ...incoming };
  };

  const mergedManifest: Record<string, GeneratedObjectManifestEntry> = { ...runData.objectManifest };
  Object.entries(manifestPatch || {}).forEach(([id, entry]) => {
    mergedManifest[id] = mergeManifestEntry(mergedManifest[id], entry);
  });

  const now = nowTs();
  const next = {
    ...runData,
    cards: runData.cards,
    enemies: runData.enemies,
    objectManifest: mergedManifest,
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
    if (payload.enemies.length > 0) {
      next.enemies = mergeUniqueEnemies(next.enemies, payload.enemies);
    }
    next.roomMusicPrompt = payload.roomMusicPrompt || next.roomMusicPrompt;
    const node = next.node_map.find(n => n.id === roomId);
    if (node) node.data = payload.enemies;
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
