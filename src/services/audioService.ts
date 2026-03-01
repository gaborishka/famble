import { Boss, RoomContentPayload, RunData, RunDataV2, isRunDataV2 } from '../../shared/types/game';
import { getCurrentRunId } from './geminiService';
import { GoogleGenAI, MusicGenerationMode } from '@google/genai';

const audioCache = new Map<string, string>();
const pendingRequests = new Map<string, Promise<string>>();

class RequestQueue {
    private queue: (() => Promise<void>)[] = [];
    private activeCount = 0;
    private readonly maxConcurrent = 3;

    async enqueue<T>(task: () => Promise<T>): Promise<T> {
        return new Promise<T>((resolve, reject) => {
            this.queue.push(async () => {
                try {
                    const result = await task();
                    resolve(result);
                } catch (e) {
                    reject(e);
                } finally {
                    this.activeCount--;
                    this.dequeue();
                }
            });
            this.dequeue();
        });
    }

    private dequeue() {
        if (this.activeCount < this.maxConcurrent && this.queue.length > 0) {
            const task = this.queue.shift();
            if (task) {
                this.activeCount++;
                task();
            }
        }
    }
}

const apiQueue = new RequestQueue();

const DEFAULT_BOSS_VOICE_ID = 'zYcjlYFOd3taleS0gkk3';
const DEFAULT_TTS_MODEL_ID = 'eleven_multilingual_v2';
const MODELS_CACHE_TTL_MS = 10 * 60 * 1000;
const VOICES_CACHE_TTL_MS = 10 * 60 * 1000;
const ELEVEN_SOUND_PROMPT_MAX_CHARS = 450;
const MIN_SFX_PROMPT_WORDS = 6;
const MAX_SFX_PROMPT_WORDS = 12;
const MUSIC_PROMPT_PROFILE = 'gemini_lyria_v1';
const GEMINI_MUSIC_MODEL = 'models/lyria-realtime-exp';
const GEMINI_MUSIC_API_VERSION = 'v1alpha';
const GEMINI_PCM_SAMPLE_RATE_HZ = 48000;
const GEMINI_PCM_CHANNELS = 2;
const GEMINI_PCM_BITS_PER_SAMPLE = 16;
const GEMINI_MUSIC_SETUP_TIMEOUT_MS = 10000;
const GEMINI_MUSIC_STREAM_TIMEOUT_MS = 30000;

type SoundSource = 'card' | 'enemy' | 'boss' | 'generic';

type MusicMode = 'room' | 'boss';

interface SoundEffectOptions {
    durationSeconds?: number;
    theme?: string;
    source?: SoundSource;
    cardType?: string;
    cacheTag?: string;
    fileTag?: string;
}

const SFX_VOLUMES: Record<SoundSource, number> = {
    card: 0.45,
    enemy: 0.5,
    boss: 0.55,
    generic: 0.45,
};

export function playSfx(url: string, source: SoundSource = 'generic', muted?: boolean): void {
    if (!url || muted) return;
    const audio = new Audio(url);
    audio.volume = SFX_VOLUMES[source] ?? 0.45;
    audio.play().catch(e => console.log('SFX autoplay prevented', e));
}

interface MusicOptions {
    theme?: string;
    mode?: MusicMode;
    cacheTag?: string;
    fileTag?: string;
}

interface BossTTSOptions {
    theme?: string;
    voiceStyle?: string;
    voiceGender?: Boss['narratorVoiceGender'];
    voiceAccent?: string;
    cacheTag?: string;
    fileTag?: string;
}

interface ElevenModel {
    model_id?: string;
    modelId?: string;
    name?: string;
    can_do_text_to_speech?: boolean;
    canDoTextToSpeech?: boolean;
}

interface ElevenVoice {
    voice_id?: string;
    voiceId?: string;
    name?: string;
    category?: string;
    description?: string;
    labels?: Record<string, string>;
}

let modelCatalogCache: { data: ElevenModel[]; expiresAt: number } | null = null;
let voiceCatalogCache: { data: ElevenVoice[]; expiresAt: number } | null = null;
let modelCatalogRequest: Promise<ElevenModel[]> | null = null;
let voiceCatalogRequest: Promise<ElevenVoice[]> | null = null;
let geminiMusicClient: GoogleGenAI | null = null;
let geminiMusicClientApiKey: string | null = null;

const SFX_GENERIC_OR_TECHNICAL_TOKENS = new Set([
    'audio',
    'sound',
    'sounds',
    'effect',
    'effects',
    'sfx',
    'music',
    'track',
    'loop',
    'looping',
    'stereo',
    'mono',
    'mix',
    'mixing',
    'master',
    'mastered',
    'sample',
    'quality',
    'hq',
    'epic',
    'cinematic',
    'dramatic',
    'game',
    'gameplay',
    'roguelike',
    'battle',
    'background',
    'ambient',
    'bpm',
    'db',
    'eq',
    'reverb',
    'compressor',
    'limiter',
    'wav',
    'mp3',
]);

function normalizeWhitespace(input: string): string {
    return input.replace(/\s+/g, ' ').trim();
}

function clampSoundPromptText(input: string): { text: string; wasTruncated: boolean; originalLength: number } {
    const normalized = normalizeWhitespace(input || '');
    if (normalized.length <= ELEVEN_SOUND_PROMPT_MAX_CHARS) {
        return {
            text: normalized,
            wasTruncated: false,
            originalLength: normalized.length,
        };
    }

    // Prefer to cut at a word boundary to keep the prompt semantically coherent.
    const hardLimit = normalized.slice(0, ELEVEN_SOUND_PROMPT_MAX_CHARS);
    const trimmedToWordBoundary = hardLimit.replace(/\s+\S*$/, '').trim();

    return {
        text: trimmedToWordBoundary || hardLimit.trim(),
        wasTruncated: true,
        originalLength: normalized.length,
    };
}

function normalizeAudioFragment(input: string, fallback: string, maxWords: number): string {
    const cleaned = normalizeWhitespace(input || '');
    if (!cleaned) return fallback;
    const words = cleaned.split(' ');
    if (words.length <= maxWords) return cleaned;
    return words.slice(0, maxWords).join(' ');
}

function normalizeSfxToken(rawToken: string): string {
    return rawToken
        .toLowerCase()
        .replace(/^[^a-z0-9]+|[^a-z0-9]+$/g, '');
}

function fallbackSfxSemanticPrompt(source: SoundSource): string {
    if (source === 'card') return 'tempered steel slash through worn leather guard';
    if (source === 'enemy') return 'rusted blade swipe across chained armor plate';
    if (source === 'boss') return 'colossal iron hammer impact on cracked stone';
    return 'heavy metal impact through layered cloth wrap';
}

function normalizeSfxSemanticPrompt(input: string, source: SoundSource): string {
    const cleaned = normalizeWhitespace(input || '');
    if (!cleaned) return fallbackSfxSemanticPrompt(source);

    const filteredWords = cleaned
        .split(' ')
        .map(normalizeSfxToken)
        .filter(token => token && !SFX_GENERIC_OR_TECHNICAL_TOKENS.has(token));

    const dedupedWords: string[] = [];
    for (const token of filteredWords) {
        if (dedupedWords[dedupedWords.length - 1] !== token) dedupedWords.push(token);
    }

    const trimmedWords = dedupedWords.slice(0, MAX_SFX_PROMPT_WORDS);
    if (trimmedWords.length < MIN_SFX_PROMPT_WORDS) {
        return fallbackSfxSemanticPrompt(source);
    }

    return trimmedWords.join(' ');
}

function normalizeTheme(theme?: string): string {
    return normalizeAudioFragment(theme || '', 'dark fantasy roguelike', 10);
}

function sourceFlavor(source: SoundSource): string {
    if (source === 'card') return 'player card action';
    if (source === 'enemy') return 'enemy attack action';
    if (source === 'boss') return 'boss attack action';
    return 'gameplay action';
}

function composeSoundEffectPrompt(fragment: string, options: SoundEffectOptions): string {
    const unique = normalizeAudioFragment(fragment, 'arcane impact with cloth rustle', 18);
    const theme = normalizeTheme(options.theme);
    const flavor = sourceFlavor(options.source || 'generic');

    return normalizeWhitespace(
        `Game sound effect: ${flavor} in a roguelike battle. ` +
        `Theme: ${theme}. ` +
        `Sound: ${unique}. ` +
        `Warm body, punchy mid-range, smooth tail, no harsh high frequencies, ` +
        `no speech, no vocals, no background music bed.`
    );
}

function composeMusicPrompt(fragment: string, options: MusicOptions): string {
    const unique = normalizeAudioFragment(fragment, 'hushed bowed strings with distant low drone', 22);
    const theme = normalizeTheme(options.theme);
    const mode = options.mode || 'room';
    const arc = mode === 'boss'
        ? 'menacing pressure with cinematic gravity and controlled intensity'
        : 'brooding low-intensity tension with immersive atmosphere for repeated combats';

    return normalizeWhitespace(
        `Atmospheric instrumental combat loop for a roguelike game. ` +
        `Theme context: ${theme}. ` +
        `Musical motif: ${unique}. ` +
        `Emotional arc: ${arc}. ` +
        `Tonal mix: warm low-mid focus, soft attack, diffuse reverb tail, distant felted percussion, and gentle high-frequency roll-off. ` +
        `Avoid sharp plucks, brittle highs, aggressive cymbals, hard transients, or piercing lead textures. ` +
        `No vocals, no spoken words, low-to-moderate dynamics, restrained peaks, smooth loop continuity, leave space for sound effects.`
    );
}

function normalizeNarratorText(text: string): string {
    return normalizeAudioFragment(text, 'Your journey ends here.', 24);
}

function getGeminiMusicClient(apiKey: string): GoogleGenAI {
    if (!geminiMusicClient || geminiMusicClientApiKey !== apiKey) {
        geminiMusicClient = new GoogleGenAI({
            apiKey,
            apiVersion: GEMINI_MUSIC_API_VERSION,
        });
        geminiMusicClientApiKey = apiKey;
    }
    return geminiMusicClient;
}

function decodeBase64ToBytes(base64: string): Uint8Array {
    const normalized = base64.replace(/-/g, '+').replace(/_/g, '/').replace(/\s/g, '');
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
    const binary = atob(padded);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
}

function parseMimeNumericParam(mimeType: string | undefined, paramName: string): number | undefined {
    if (!mimeType) return undefined;
    const match = mimeType.match(new RegExp(`${paramName}=([0-9]+)`, 'i'));
    if (!match?.[1]) return undefined;
    const parsed = Number.parseInt(match[1], 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

function parseSampleRateFromMimeType(mimeType: string | undefined): number {
    return (
        parseMimeNumericParam(mimeType, 'rate') ??
        parseMimeNumericParam(mimeType, 'sample_rate') ??
        parseMimeNumericParam(mimeType, 'samplerate') ??
        GEMINI_PCM_SAMPLE_RATE_HZ
    );
}

function parseChannelsFromMimeType(mimeType: string | undefined): number {
    return (
        parseMimeNumericParam(mimeType, 'channels') ??
        GEMINI_PCM_CHANNELS
    );
}

function estimatePcmTargetBytes(durationSeconds: number, sampleRate: number, channels: number): number {
    const bytesPerSample = GEMINI_PCM_BITS_PER_SAMPLE / 8;
    return Math.max(1, Math.floor(durationSeconds * sampleRate * channels * bytesPerSample));
}

function concatUint8Arrays(chunks: Uint8Array[]): Uint8Array {
    const totalLength = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
    const merged = new Uint8Array(totalLength);
    let offset = 0;
    for (const chunk of chunks) {
        merged.set(chunk, offset);
        offset += chunk.byteLength;
    }
    return merged;
}

function writeAscii(view: DataView, offset: number, value: string) {
    for (let i = 0; i < value.length; i++) {
        view.setUint8(offset + i, value.charCodeAt(i));
    }
}

function pcm16ToWavBlob(pcmData: Uint8Array, sampleRate: number, channels: number): Blob {
    const bytesPerSample = GEMINI_PCM_BITS_PER_SAMPLE / 8;
    const blockAlign = channels * bytesPerSample;
    const byteRate = sampleRate * blockAlign;

    const header = new ArrayBuffer(44);
    const view = new DataView(header);
    writeAscii(view, 0, 'RIFF');
    view.setUint32(4, 36 + pcmData.byteLength, true);
    writeAscii(view, 8, 'WAVE');
    writeAscii(view, 12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, channels, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, byteRate, true);
    view.setUint16(32, blockAlign, true);
    view.setUint16(34, GEMINI_PCM_BITS_PER_SAMPLE, true);
    writeAscii(view, 36, 'data');
    view.setUint32(40, pcmData.byteLength, true);

    return new Blob([header, pcmData], { type: 'audio/wav' });
}

function buildGeminiMusicConfig(mode: MusicMode) {
    if (mode === 'boss') {
        return {
            musicGenerationMode: MusicGenerationMode.QUALITY,
            guidance: 4.1,
            temperature: 0.95,
            density: 0.72,
            brightness: 0.34,
            bpm: 120,
        };
    }

    return {
        musicGenerationMode: MusicGenerationMode.QUALITY,
        guidance: 3.3,
        temperature: 0.85,
        density: 0.5,
        brightness: 0.28,
        bpm: 96,
    };
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, timeoutErrorMessage: string): Promise<T> {
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const timeoutPromise = new Promise<T>((_, reject) => {
        timeout = setTimeout(() => reject(new Error(timeoutErrorMessage)), timeoutMs);
    });

    return Promise.race([promise, timeoutPromise]).finally(() => {
        if (timeout) clearTimeout(timeout);
    }) as Promise<T>;
}

function getVoiceSettings(theme?: string): { stability: number; similarity_boost: number } {
    const normalizedTheme = (theme || '').toLowerCase();

    if (normalizedTheme.includes('science')) {
        return { stability: 0.38, similarity_boost: 0.86 };
    }
    if (normalizedTheme.includes('legal') || normalizedTheme.includes('court')) {
        return { stability: 0.4, similarity_boost: 0.86 };
    }
    if (normalizedTheme.includes('horror')) {
        return { stability: 0.34, similarity_boost: 0.88 };
    }

    return { stability: 0.4, similarity_boost: 0.86 };
}

function selectDuration(source: SoundSource, cardType?: string): number {
    if (source === 'boss') return 2.5;
    if (source === 'enemy') return 2;
    if (source === 'card') {
        if (cardType === 'Power') return 2;
        return 1.5;
    }
    return 2;
}

function toFileSafeKey(input: string): string {
    return input.replace(/[^a-z0-9]/gi, '_').toLowerCase().substring(0, 50);
}

function nowTs(): number {
    return Date.now();
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
        error: error instanceof Error ? error.message : String(error),
        updatedAt: nowTs(),
    };
}

function getModelId(model: ElevenModel): string {
    return model.model_id || model.modelId || '';
}

function getModelName(model: ElevenModel): string {
    return model.name || getModelId(model);
}

function modelSupportsTTS(model: ElevenModel): boolean {
    if (typeof model.can_do_text_to_speech === 'boolean') return model.can_do_text_to_speech;
    if (typeof model.canDoTextToSpeech === 'boolean') return model.canDoTextToSpeech;

    const descriptor = `${getModelName(model)} ${getModelId(model)}`.toLowerCase();
    return descriptor.includes('multilingual') || descriptor.includes('turbo') || descriptor.includes('v3');
}

function rankTTSModel(model: ElevenModel): number {
    if (!modelSupportsTTS(model)) return -1;

    const descriptor = `${getModelName(model)} ${getModelId(model)}`.toLowerCase();

    if (descriptor.includes('eleven_v3') || descriptor.includes('v3')) return 400;
    if (descriptor.includes('multilingual_v2')) return 300;
    if (descriptor.includes('turbo_v2_5')) return 250;
    if (descriptor.includes('turbo_v2')) return 220;
    if (descriptor.includes('multilingual')) return 200;
    return 100;
}

function pickBestTTSModelId(models: ElevenModel[]): string {
    if (models.length === 0) return DEFAULT_TTS_MODEL_ID;

    const scored = models
        .map(model => ({ model, score: rankTTSModel(model) }))
        .filter(item => item.score >= 0)
        .sort((a, b) => b.score - a.score);

    if (scored.length === 0) return DEFAULT_TTS_MODEL_ID;

    const preferredId = getModelId(scored[0].model);
    return preferredId || DEFAULT_TTS_MODEL_ID;
}

function parseModelPayload(payload: any): ElevenModel[] {
    if (Array.isArray(payload)) return payload as ElevenModel[];
    if (Array.isArray(payload?.models)) return payload.models as ElevenModel[];
    return [];
}

function parseVoicesPayload(payload: any): ElevenVoice[] {
    if (Array.isArray(payload)) return payload as ElevenVoice[];
    if (Array.isArray(payload?.voices)) return payload.voices as ElevenVoice[];
    return [];
}

function tokenizeHints(input: string): string[] {
    return normalizeWhitespace(input.toLowerCase())
        .split(/[^a-z0-9]+/)
        .filter(token => token.length >= 3);
}

function themeVoiceKeywords(theme?: string): string[] {
    const normalizedTheme = (theme || '').toLowerCase();

    if (normalizedTheme.includes('science')) {
        return ['measured', 'precise', 'clear', 'grounded', 'authoritative'];
    }
    if (normalizedTheme.includes('legal') || normalizedTheme.includes('court')) {
        return ['authoritative', 'formal', 'deep', 'commanding', 'grounded'];
    }
    if (normalizedTheme.includes('cooking') || normalizedTheme.includes('kitchen')) {
        return ['warm', 'confident', 'charismatic', 'playful'];
    }
    if (normalizedTheme.includes('horror')) {
        return ['dark', 'ominous', 'cinematic', 'gravelly'];
    }

    return ['dramatic', 'cinematic', 'commanding', 'grounded'];
}

function styleRequestsSynthetic(style?: string): boolean {
    const normalized = normalizeWhitespace((style || '').toLowerCase());
    if (!normalized) return false;
    return [
        'robot',
        'robotic',
        'synthetic',
        'electronic',
        'distorted',
        'mechanical',
        'inhuman',
        'android',
        'cyborg',
        'vocoder',
    ].some(token => normalized.includes(token));
}

function normalizeVoiceBlob(voice: ElevenVoice): string {
    const labels = voice.labels
        ? Object.entries(voice.labels).map(([k, v]) => `${k}:${v}`).join(' ')
        : '';

    return `${voice.name || ''} ${voice.description || ''} ${voice.category || ''} ${labels}`.toLowerCase();
}

function pickVoiceId(
    voices: ElevenVoice[],
    hints: { theme?: string; style?: string; gender?: string; accent?: string }
): string {
    if (voices.length === 0) return DEFAULT_BOSS_VOICE_ID;

    const keywords = [
        ...themeVoiceKeywords(hints.theme),
        ...tokenizeHints(hints.style || ''),
        ...tokenizeHints(hints.accent || ''),
    ];
    const wantsSynthetic = styleRequestsSynthetic(hints.style);
    const naturalKeywords = ['natural', 'narrator', 'storyteller', 'clear', 'warm', 'cinematic', 'conversational', 'grounded'];
    const syntheticKeywords = ['robot', 'robotic', 'synthetic', 'electronic', 'vocoder', 'inhuman', 'mechanical', 'distorted', 'cyborg', 'android'];

    const desiredGender = (hints.gender || '').toLowerCase();
    const desiredAccent = (hints.accent || '').toLowerCase();

    const scored = voices.map(voice => {
        const blob = normalizeVoiceBlob(voice);
        const labels = voice.labels || {};
        const genderLabel = (labels.gender || labels.sex || '').toLowerCase();
        const accentLabel = (labels.accent || '').toLowerCase();

        let score = 0;

        for (const keyword of keywords) {
            if (keyword && blob.includes(keyword)) score += 2;
        }
        for (const keyword of naturalKeywords) {
            if (blob.includes(keyword)) score += 1;
        }
        for (const keyword of syntheticKeywords) {
            if (!blob.includes(keyword)) continue;
            score += wantsSynthetic ? 2 : -6;
        }

        if ((voice.category || '').toLowerCase() === 'premade') score += 4;
        if ((voice.category || '').toLowerCase() === 'generated') score += 2;

        if (desiredGender) {
            if (genderLabel.includes(desiredGender)) score += 6;
            else if (genderLabel) score -= 2;
        }

        if (desiredAccent) {
            if (accentLabel.includes(desiredAccent)) score += 5;
            else if (accentLabel) score -= 1;
            if (blob.includes(desiredAccent)) score += 2;
        }

        if ((voice.name || '').toLowerCase().includes('narrator')) score += 3;

        return { voice, score };
    }).sort((a, b) => b.score - a.score);

    const selected = scored[0]?.voice;
    return selected?.voice_id || selected?.voiceId || DEFAULT_BOSS_VOICE_ID;
}

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs = 20000): Promise<Response> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
        return await fetch(url, { ...init, signal: controller.signal });
    } finally {
        clearTimeout(timeout);
    }
}

async function loadModelCatalog(apiKey: string): Promise<ElevenModel[]> {
    if (modelCatalogCache && modelCatalogCache.expiresAt > Date.now()) {
        return modelCatalogCache.data;
    }

    if (modelCatalogRequest) {
        return modelCatalogRequest;
    }

    modelCatalogRequest = apiQueue.enqueue(async () => {
        const response = await fetchWithTimeout('https://api.elevenlabs.io/v1/models', {
            method: 'GET',
            headers: {
                'Content-Type': 'application/json',
                'xi-api-key': apiKey,
            },
        }, 10000);

        if (!response.ok) {
            const errText = await response.text();
            throw new Error(`Failed to load models (${response.status}): ${errText}`);
        }

        const payload = await response.json();
        const models = parseModelPayload(payload);
        modelCatalogCache = { data: models, expiresAt: Date.now() + MODELS_CACHE_TTL_MS };
        return models;
    }).catch(err => {
        console.warn('Failed to fetch ElevenLabs model catalog, using fallback model.', err);
        return [];
    }).finally(() => {
        modelCatalogRequest = null;
    });

    return modelCatalogRequest;
}

async function loadVoiceCatalog(apiKey: string): Promise<ElevenVoice[]> {
    if (voiceCatalogCache && voiceCatalogCache.expiresAt > Date.now()) {
        return voiceCatalogCache.data;
    }

    if (voiceCatalogRequest) {
        return voiceCatalogRequest;
    }

    voiceCatalogRequest = apiQueue.enqueue(async () => {
        const response = await fetchWithTimeout('https://api.elevenlabs.io/v1/voices', {
            method: 'GET',
            headers: {
                'Content-Type': 'application/json',
                'xi-api-key': apiKey,
            },
        }, 10000);

        if (!response.ok) {
            const errText = await response.text();
            throw new Error(`Failed to load voices (${response.status}): ${errText}`);
        }

        const payload = await response.json();
        const voices = parseVoicesPayload(payload);
        voiceCatalogCache = { data: voices, expiresAt: Date.now() + VOICES_CACHE_TTL_MS };
        return voices;
    }).catch(err => {
        console.warn('Failed to fetch ElevenLabs voice catalog, using fallback voice.', err);
        return [];
    }).finally(() => {
        voiceCatalogRequest = null;
    });

    return voiceCatalogRequest;
}

function maybeWarmUpElevenLabsCatalogs(apiKey: string) {
    void Promise.allSettled([loadModelCatalog(apiKey), loadVoiceCatalog(apiKey)]);
}

async function tryLoadFromRunFile(cacheKey: string, fileNames: string | string[]): Promise<string | null> {
    const currentRunId = getCurrentRunId();
    if (!currentRunId) return null;

    const candidates = Array.isArray(fileNames) ? fileNames : [fileNames];

    for (const fileName of candidates) {
        try {
            const res = await fetch(`/api/check-file?runId=${currentRunId}&fileName=${fileName}`);
            if (res.ok) {
                const { exists, url } = await res.json();
                if (exists && url) {
                    audioCache.set(cacheKey, url);
                    return url;
                }
            }
        } catch (e) {
            console.error(`Failed to check for existing file (${fileName}):`, e);
        }
    }

    return null;
}

async function persistRunFile(fileName: string, blob: Blob): Promise<string | undefined> {
    const currentRunId = getCurrentRunId();
    if (!currentRunId) return undefined;

    try {
        const base64Data = await new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.onloadend = () => resolve(reader.result as string);
            reader.onerror = reject;
            reader.readAsDataURL(blob);
        });

        const response = await fetch('/api/save-file', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                runId: currentRunId,
                fileName,
                base64Data
            })
        });
        if (!response.ok) {
            throw new Error(`save-file failed with status ${response.status}`);
        }

        try {
            const payload = await response.json();
            if (payload?.path && typeof payload.path === 'string') {
                return payload.path;
            }
        } catch {
            // Fallback below.
        }

        return `/runs/${currentRunId}/${fileName}`;
    } catch (err) {
        console.error(`Failed to auto-save audio file (${fileName}) locally:`, err);
        return undefined;
    }
}

async function requestSoundGeneration(
    apiKey: string,
    promptText: string,
    durationSeconds: number,
    promptInfluence: number
): Promise<Blob> {
    const normalizedPrompt = clampSoundPromptText(promptText);
    if (normalizedPrompt.wasTruncated) {
        console.warn(
            `Sound-generation prompt exceeded ${ELEVEN_SOUND_PROMPT_MAX_CHARS} characters ` +
            `(${normalizedPrompt.originalLength}). Truncating before ElevenLabs request.`
        );
    }

    const response = await apiQueue.enqueue(() => fetchWithTimeout('https://api.elevenlabs.io/v1/sound-generation', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'xi-api-key': apiKey,
        },
        body: JSON.stringify({
            text: normalizedPrompt.text,
            duration_seconds: durationSeconds,
            prompt_influence: promptInfluence,
        }),
    }));

    if (!response.ok) {
        const errText = await response.text();
        throw new Error(`ElevenLabs API error (${response.status}): ${errText}`);
    }

    return response.blob();
}

async function requestGeminiMusicGeneration(
    apiKey: string,
    promptText: string,
    mode: MusicMode
): Promise<Blob> {
    const targetDurationSeconds = mode === 'boss' ? 24 : 22;
    const ai = getGeminiMusicClient(apiKey);
    const audioChunks: Uint8Array[] = [];

    let sampleRate = GEMINI_PCM_SAMPLE_RATE_HZ;
    let channels = GEMINI_PCM_CHANNELS;
    let totalBytes = 0;
    let setupComplete = false;
    let finished = false;
    let sessionClosed = false;
    let session: { setWeightedPrompts: (params: any) => Promise<void>; setMusicGenerationConfig: (params: any) => Promise<void>; play: () => void; close: () => void } | null = null;

    let resolveSetup!: () => void;
    let rejectSetup!: (reason?: unknown) => void;
    const setupPromise = new Promise<void>((resolve, reject) => {
        resolveSetup = resolve;
        rejectSetup = reject;
    });

    let resolveFinished!: () => void;
    let rejectFinished!: (reason?: unknown) => void;
    const finishedPromise = new Promise<void>((resolve, reject) => {
        resolveFinished = resolve;
        rejectFinished = reject;
    });

    const closeSession = () => {
        if (sessionClosed) return;
        sessionClosed = true;
        try {
            session?.close();
        } catch (err) {
            console.warn('Failed to close Gemini music session cleanly:', err);
        }
    };

    const finishSuccessfully = () => {
        if (finished) return;
        finished = true;
        closeSession();
        resolveFinished();
    };

    const failGeneration = (reason: unknown) => {
        if (finished) return;
        finished = true;
        closeSession();
        if (!setupComplete) {
            rejectSetup(reason);
        }
        rejectFinished(reason);
    };

    try {
        session = await ai.live.music.connect({
            model: GEMINI_MUSIC_MODEL,
            callbacks: {
                onmessage: (message) => {
                    if (message.setupComplete && !setupComplete) {
                        setupComplete = true;
                        resolveSetup();
                    }

                    if (message.filteredPrompt?.filteredReason) {
                        failGeneration(new Error(`Gemini music prompt filtered: ${message.filteredPrompt.filteredReason}`));
                        return;
                    }

                    const chunks = message.serverContent?.audioChunks || (message.audioChunk ? [message.audioChunk] : []);
                    if (!chunks.length) return;

                    for (const chunk of chunks) {
                        if (!chunk?.data) continue;

                        sampleRate = parseSampleRateFromMimeType(chunk.mimeType);
                        channels = parseChannelsFromMimeType(chunk.mimeType);

                        try {
                            const decoded = decodeBase64ToBytes(chunk.data);
                            if (!decoded.byteLength) continue;
                            audioChunks.push(decoded);
                            totalBytes += decoded.byteLength;
                        } catch (decodeErr) {
                            failGeneration(new Error(`Failed to decode Gemini music chunk: ${decodeErr instanceof Error ? decodeErr.message : String(decodeErr)}`));
                            return;
                        }
                    }

                    const targetBytes = estimatePcmTargetBytes(targetDurationSeconds, sampleRate, channels);
                    if (totalBytes >= targetBytes) {
                        finishSuccessfully();
                    }
                },
                onerror: (event) => {
                    failGeneration(event?.error || new Error('Gemini music websocket error'));
                },
                onclose: () => {
                    if (!setupComplete) {
                        failGeneration(new Error('Gemini music session closed before setup completed.'));
                        return;
                    }
                    finishSuccessfully();
                },
            },
        });

        await withTimeout(
            setupPromise,
            GEMINI_MUSIC_SETUP_TIMEOUT_MS,
            `Timed out waiting for Gemini music setup after ${GEMINI_MUSIC_SETUP_TIMEOUT_MS}ms.`
        );

        await session.setWeightedPrompts({
            weightedPrompts: [{ text: promptText, weight: 1.0 }],
        });
        await session.setMusicGenerationConfig({
            musicGenerationConfig: buildGeminiMusicConfig(mode),
        });
        session.play();

        await withTimeout(
            finishedPromise,
            GEMINI_MUSIC_STREAM_TIMEOUT_MS,
            `Timed out waiting for Gemini music audio stream after ${GEMINI_MUSIC_STREAM_TIMEOUT_MS}ms.`
        );

        const pcmData = concatUint8Arrays(audioChunks);
        if (!pcmData.byteLength) {
            throw new Error('Gemini music returned no audio data.');
        }
        return pcm16ToWavBlob(pcmData, sampleRate, channels);
    } catch (err) {
        closeSession();
        throw err;
    }
}

async function finalizeAudioRequest(cacheKey: string, fileName: string, blob: Blob): Promise<string> {
    const blobUrl = URL.createObjectURL(blob);
    const persistedUrl = await persistRunFile(fileName, blob);
    const resolvedUrl = persistedUrl || blobUrl;
    audioCache.set(cacheKey, resolvedUrl);
    if (persistedUrl) {
        URL.revokeObjectURL(blobUrl);
    }
    return resolvedUrl;
}

function normalizeBossOptions(optionsOrTheme?: BossTTSOptions | string): BossTTSOptions {
    if (typeof optionsOrTheme === 'string') {
        return { theme: optionsOrTheme };
    }
    return optionsOrTheme || {};
}

export async function generateSoundEffect(prompt: string, options: SoundEffectOptions = {}): Promise<string> {
    const source = options.source || 'generic';
    const normalizedPrompt = normalizeSfxSemanticPrompt(prompt, source);
    const theme = normalizeTheme(options.theme);
    const cacheTag = options.cacheTag ? `:${toFileSafeKey(options.cacheTag)}` : '';
    const cacheKey = `sfx:${source}:${theme}:${normalizedPrompt}${cacheTag}`;

    if (audioCache.has(cacheKey)) {
        return audioCache.get(cacheKey)!;
    }

    if (pendingRequests.has(cacheKey)) {
        return pendingRequests.get(cacheKey)!;
    }

    const tagged = options.fileTag ? `_${toFileSafeKey(options.fileTag)}` : '';
    const fileName = `sfx_${source}${tagged}_${toFileSafeKey(normalizedPrompt)}.mp3`;
    const legacyFileName = `sfx_${toFileSafeKey(normalizedPrompt)}.mp3`;
    const existing = await tryLoadFromRunFile(cacheKey, [fileName, legacyFileName]);
    if (existing) {
        return existing;
    }

    const apiKey = process.env.ELEVENLABS_API_KEY;
    if (!apiKey) {
        console.warn('ELEVENLABS_API_KEY is not set. Sound generation skipped.');
        return '';
    }

    const durationSeconds = options.durationSeconds ?? selectDuration(source, options.cardType);
    const templatedPrompt = composeSoundEffectPrompt(normalizedPrompt, { ...options, source, theme });

    const request = (async () => {
        try {
            let blob: Blob;
            try {
                blob = await requestSoundGeneration(apiKey, templatedPrompt, durationSeconds, 0.6);
            } catch (templatedErr) {
                console.warn('Templated SFX prompt failed, retrying with raw semantic prompt.', templatedErr);
                blob = await requestSoundGeneration(apiKey, normalizedPrompt, durationSeconds, 0.5);
            }

            return await finalizeAudioRequest(cacheKey, fileName, blob);
        } catch (err) {
            console.error('Failed to generate sound effect:', err);
            return '';
        } finally {
            pendingRequests.delete(cacheKey);
        }
    })();

    pendingRequests.set(cacheKey, request);
    return request;
}

export async function generateMusic(prompt: string, options: MusicOptions = {}): Promise<string> {
    const normalizedPrompt = normalizeAudioFragment(prompt, 'hushed strings over distant low drone', 22);
    const mode = options.mode || 'room';
    const theme = normalizeTheme(options.theme);
    const cacheTag = options.cacheTag ? `:${toFileSafeKey(options.cacheTag)}` : '';
    const cacheKey = `music:${mode}:${theme}:${MUSIC_PROMPT_PROFILE}:${normalizedPrompt}${cacheTag}`;

    if (audioCache.has(cacheKey)) {
        return audioCache.get(cacheKey)!;
    }

    if (pendingRequests.has(cacheKey)) {
        return pendingRequests.get(cacheKey)!;
    }

    const tagged = options.fileTag ? `_${toFileSafeKey(options.fileTag)}` : '';
    const fileName = `bgm_${mode}_${MUSIC_PROMPT_PROFILE}${tagged}_${toFileSafeKey(normalizedPrompt)}.wav`;
    const legacyFileName = `bgm_${toFileSafeKey(normalizedPrompt)}.mp3`;
    const existing = await tryLoadFromRunFile(cacheKey, [fileName, legacyFileName]);
    if (existing) {
        return existing;
    }

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
        console.warn('GEMINI_API_KEY is not set. Music generation skipped.');
        return '';
    }

    const templatedPrompt = composeMusicPrompt(normalizedPrompt, { ...options, mode, theme });

    const request = (async () => {
        try {
            let blob: Blob;
            try {
                blob = await apiQueue.enqueue(() => requestGeminiMusicGeneration(apiKey, templatedPrompt, mode));
            } catch (templatedErr) {
                console.warn('Templated Gemini BGM prompt failed, retrying with raw semantic prompt.', templatedErr);
                blob = await apiQueue.enqueue(() => requestGeminiMusicGeneration(apiKey, normalizedPrompt, mode));
            }

            return await finalizeAudioRequest(cacheKey, fileName, blob);
        } catch (err) {
            console.error('Failed to generate music:', err);
            return '';
        } finally {
            pendingRequests.delete(cacheKey);
        }
    })();

    pendingRequests.set(cacheKey, request);
    return request;
}

export async function generateBossTTS(text: string, optionsOrTheme?: BossTTSOptions | string): Promise<string> {
    const options = normalizeBossOptions(optionsOrTheme);
    const normalizedText = normalizeNarratorText(text);
    const theme = normalizeTheme(options.theme);
    const cacheTag = options.cacheTag ? `:${toFileSafeKey(options.cacheTag)}` : '';
    const cacheKey = `tts:${theme}:${DEFAULT_BOSS_VOICE_ID}:${normalizedText}:${options.voiceStyle || ''}:${options.voiceGender || ''}:${options.voiceAccent || ''}${cacheTag}`;

    if (audioCache.has(cacheKey)) {
        return audioCache.get(cacheKey)!;
    }

    if (pendingRequests.has(cacheKey)) {
        return pendingRequests.get(cacheKey)!;
    }

    const tagged = options.fileTag ? `_${toFileSafeKey(options.fileTag)}` : '';
    const fileName = `tts_boss_${toFileSafeKey(DEFAULT_BOSS_VOICE_ID)}${tagged}_${toFileSafeKey(normalizedText)}.mp3`;
    const existing = await tryLoadFromRunFile(cacheKey, fileName);
    if (existing) {
        return existing;
    }

    const apiKey = process.env.ELEVENLABS_API_KEY;
    if (!apiKey) {
        console.warn('ELEVENLABS_API_KEY is not set. TTS generation skipped.');
        return '';
    }

    const request = (async () => {
        try {
            const models = await loadModelCatalog(apiKey);

            const modelId = pickBestTTSModelId(models);
            const voiceId = DEFAULT_BOSS_VOICE_ID;

            const response = await apiQueue.enqueue(() => fetchWithTimeout(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'xi-api-key': apiKey,
                },
                body: JSON.stringify({
                    text: normalizedText,
                    model_id: modelId || DEFAULT_TTS_MODEL_ID,
                    voice_settings: getVoiceSettings(theme),
                }),
            }));

            if (!response.ok) {
                const errText = await response.text();
                throw new Error(`ElevenLabs API error (${response.status}): ${errText}`);
            }

            const blob = await response.blob();
            return await finalizeAudioRequest(cacheKey, fileName, blob);
        } catch (err) {
            console.error('Failed to generate TTS:', err);

            try {
                const fallbackResponse = await apiQueue.enqueue(() => fetchWithTimeout(`https://api.elevenlabs.io/v1/text-to-speech/${DEFAULT_BOSS_VOICE_ID}`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'xi-api-key': apiKey,
                    },
                    body: JSON.stringify({
                        text: normalizedText,
                        model_id: DEFAULT_TTS_MODEL_ID,
                        voice_settings: getVoiceSettings(theme),
                    }),
                }));

                if (!fallbackResponse.ok) {
                    const errText = await fallbackResponse.text();
                    throw new Error(`ElevenLabs fallback TTS error (${fallbackResponse.status}): ${errText}`);
                }

                const fallbackBlob = await fallbackResponse.blob();
                return await finalizeAudioRequest(cacheKey, fileName, fallbackBlob);
            } catch (fallbackErr) {
                console.error('Failed to generate fallback TTS:', fallbackErr);
                return '';
            }
        } finally {
            pendingRequests.delete(cacheKey);
        }
    })();

    pendingRequests.set(cacheKey, request);
    return request;
}

export async function preloadRunAudio(runData: RunData): Promise<void> {
    const apiKey = process.env.ELEVENLABS_API_KEY;
    if (apiKey) {
        maybeWarmUpElevenLabsCatalogs(apiKey);
    }

    const promises: Promise<string>[] = [];

    if (runData.roomMusicPrompt) {
        promises.push(generateMusic(runData.roomMusicPrompt, { theme: runData.theme, mode: 'room' }).catch(e => {
            console.error('Failed to preload room music', e);
            return '';
        }));
    }
    if (runData.bossMusicPrompt) {
        promises.push(generateMusic(runData.bossMusicPrompt, { theme: runData.theme, mode: 'boss' }).catch(e => {
            console.error('Failed to preload boss music', e);
            return '';
        }));
    }

    // Preload starting deck sounds
    for (const card of runData.cards) {
        if (card.audioPrompt) {
            promises.push(generateSoundEffect(card.audioPrompt, { theme: runData.theme, source: 'card' }).catch(e => {
                console.error('Failed to preload card sound', e);
                return '';
            }));
        }
    }

    // Preload first enemy audio
    if (runData.enemies && runData.enemies.length > 0 && runData.enemies[0].audioPrompt) {
        promises.push(generateSoundEffect(runData.enemies[0].audioPrompt, { theme: runData.theme, source: 'enemy' }).catch(e => {
            console.error('Failed to preload enemy sound', e);
            return '';
        }));
    }

    // Await essential audio so first combat starts with sound ready.
    await Promise.all(promises);

    // Preload the rest in background.
    const backgroundPromises: Promise<string>[] = [];
    for (let i = 1; i < runData.enemies.length; i++) {
        if (runData.enemies[i].audioPrompt) {
            backgroundPromises.push(generateSoundEffect(runData.enemies[i].audioPrompt, { theme: runData.theme, source: 'enemy' }));
        }
    }
    if (runData.boss?.audioPrompt) {
        backgroundPromises.push(generateSoundEffect(runData.boss.audioPrompt, { theme: runData.theme, source: 'boss' }));
    }
    if (runData.boss?.narratorText) {
        backgroundPromises.push(generateBossTTS(runData.boss.narratorText, {
            theme: runData.theme,
            voiceStyle: runData.boss.narratorVoiceStyle,
            voiceGender: runData.boss.narratorVoiceGender,
            voiceAccent: runData.boss.narratorVoiceAccent,
        }));
    }
    Promise.all(backgroundPromises).catch(e => console.error('Error in background audio preload', e));
}

export async function preloadEssentialAudio(runData: RunData | RunDataV2): Promise<void> {
    const apiKey = process.env.ELEVENLABS_API_KEY;
    if (apiKey) {
        maybeWarmUpElevenLabsCatalogs(apiKey);
    }

    const cards = isRunDataV2(runData)
        ? (runData.bootstrap?.starterCards || runData.cards.slice(0, 3))
        : runData.cards.slice(0, 3);
    const firstEnemy = runData.enemies[0];
    const firstNode = isRunDataV2(runData)
        ? runData.node_map.find(node => node.row === 0 && node.type === 'Combat') || runData.node_map.find(node => node.type === 'Combat')
        : undefined;
    const firstPayload = (isRunDataV2(runData) && firstNode)
        ? runData.rooms[firstNode.id]?.payload
        : undefined;
    const refs = firstPayload?.objectRefs;
    const promises: Promise<void>[] = [];

    const preloadMusicWithState = async (
        prompt: string | undefined,
        objectId: string | undefined,
        mode: 'room' | 'boss',
        onReady?: (url: string) => void,
    ) => {
        if (!prompt) return;
        try {
            const url = await generateMusic(prompt, {
                theme: runData.theme,
                mode,
                cacheTag: objectId,
                fileTag: objectId,
            });
            if (url) {
                markManifestReady(runData, objectId, url);
                if (onReady) onReady(url);
            }
        } catch (err) {
            markManifestFailed(runData, objectId, err);
        }
    };

    const preloadSfxWithState = async (
        prompt: string | undefined,
        objectId: string | undefined,
        source: 'card' | 'enemy' | 'boss',
        onReady?: (url: string) => void,
    ) => {
        if (!prompt) return;
        try {
            const url = await generateSoundEffect(prompt, {
                theme: runData.theme,
                source,
                cacheTag: objectId,
                fileTag: objectId,
            });
            if (url) {
                markManifestReady(runData, objectId, url);
                if (onReady) onReady(url);
            }
        } catch (err) {
            markManifestFailed(runData, objectId, err);
        }
    };

    const roomMusicPrompt = (
        firstPayload && (firstPayload.nodeType === 'Combat' || firstPayload.nodeType === 'Elite')
            ? firstPayload.roomMusicPrompt
            : runData.roomMusicPrompt
    ) || runData.roomMusicPrompt;

    if (roomMusicPrompt) {
        promises.push(preloadMusicWithState(roomMusicPrompt, refs?.roomMusicId, 'room', (url) => {
            if (firstPayload && (firstPayload.nodeType === 'Combat' || firstPayload.nodeType === 'Elite')) {
                firstPayload.roomMusicUrl = url;
                firstPayload.objectUrls = { ...(firstPayload.objectUrls || {}), roomMusicUrl: url };
            }
        }));
    }

    cards.forEach((card, idx) => {
        promises.push(preloadSfxWithState(
            card.audioPrompt,
            card.audioObjectId || refs?.cardSfxIds?.[idx],
            'card',
            (url) => {
                card.audioUrl = url;
                if (firstPayload) {
                    const cardSfxUrls = [...(firstPayload.objectUrls?.cardSfxUrls || [])];
                    cardSfxUrls[idx] = url;
                    firstPayload.objectUrls = { ...(firstPayload.objectUrls || {}), cardSfxUrls };
                }
            }
        ));
    });

    if (firstPayload && (firstPayload.nodeType === 'Combat' || firstPayload.nodeType === 'Elite')) {
        firstPayload.enemies.forEach((enemy, idx) => {
            promises.push(preloadSfxWithState(
                enemy.audioPrompt,
                enemy.audioObjectId || refs?.enemySfxIds?.[idx] || refs?.enemySfxId,
                firstPayload.nodeType === 'Elite' ? 'boss' : 'enemy',
                (url) => {
                    enemy.audioUrl = url;
                    const enemySfxUrls = [...(firstPayload.objectUrls?.enemySfxUrls || [])];
                    enemySfxUrls[idx] = url;
                    firstPayload.objectUrls = {
                        ...(firstPayload.objectUrls || {}),
                        enemySfxUrl: idx === 0 ? url : firstPayload.objectUrls?.enemySfxUrl,
                        enemySfxUrls,
                    };
                }
            ));
        });

        (firstPayload.rewardCards || []).forEach((card, idx) => {
            promises.push(preloadSfxWithState(
                card.audioPrompt,
                card.audioObjectId || firstPayload.objectRefs?.cardSfxIds?.[idx],
                'card',
                (url) => {
                    card.audioUrl = url;
                    const cardSfxUrls = [...(firstPayload.objectUrls?.cardSfxUrls || [])];
                    const offset = cards.length + idx;
                    cardSfxUrls[offset] = url;
                    firstPayload.objectUrls = { ...(firstPayload.objectUrls || {}), cardSfxUrls };
                }
            ));
        });
    } else if (firstPayload && firstPayload.nodeType === 'Boss') {
        promises.push(preloadSfxWithState(
            firstPayload.boss.audioPrompt,
            firstPayload.boss.audioObjectId || refs?.bossSfxId,
            'boss',
            (url) => {
                firstPayload.boss.audioUrl = url;
                firstPayload.objectUrls = { ...(firstPayload.objectUrls || {}), bossSfxUrl: url };
            }
        ));
    } else {
        promises.push(preloadSfxWithState(
            firstEnemy?.audioPrompt,
            firstEnemy?.audioObjectId || refs?.enemySfxIds?.[0] || refs?.enemySfxId,
            'enemy',
            (url) => {
                if (firstEnemy) firstEnemy.audioUrl = url;
            }
        ));
    }

    await Promise.all(promises);
}

export async function preloadRoomAudio(runData: RunDataV2, roomId: string, payload: RoomContentPayload): Promise<void> {
    const apiKey = process.env.ELEVENLABS_API_KEY;
    if (apiKey) {
        maybeWarmUpElevenLabsCatalogs(apiKey);
    }

    const promises: Promise<void>[] = [];

    const preloadMusicWithState = async (
        prompt: string | undefined,
        objectId: string | undefined,
        mode: 'room' | 'boss',
        onReady?: (url: string) => void,
    ) => {
        if (!prompt) return;
        try {
            const url = await generateMusic(prompt, {
                theme: runData.theme,
                mode,
                cacheTag: objectId,
                fileTag: objectId,
            });
            if (url) {
                markManifestReady(runData, objectId, url);
                if (onReady) onReady(url);
            }
        } catch (err) {
            console.error(`Failed to preload room music (${roomId}):`, err);
            markManifestFailed(runData, objectId, err);
        }
    };

    const preloadSfxWithState = async (
        prompt: string | undefined,
        objectId: string | undefined,
        source: 'card' | 'enemy' | 'boss',
        onReady?: (url: string) => void,
    ) => {
        if (!prompt) return;
        try {
            const url = await generateSoundEffect(prompt, {
                theme: runData.theme,
                source,
                cacheTag: objectId,
                fileTag: objectId,
            });
            if (url) {
                markManifestReady(runData, objectId, url);
                if (onReady) onReady(url);
            }
        } catch (err) {
            console.error(`Failed to preload room SFX (${roomId}):`, err);
            markManifestFailed(runData, objectId, err);
        }
    };

    if (payload.nodeType === 'Combat' || payload.nodeType === 'Elite') {
        if (payload.roomMusicPrompt || runData.roomMusicPrompt) {
            promises.push(preloadMusicWithState(
                payload.roomMusicPrompt || runData.roomMusicPrompt || '',
                payload.objectRefs?.roomMusicId,
                'room',
                (url) => {
                    payload.roomMusicUrl = url;
                    payload.objectUrls = { ...(payload.objectUrls || {}), roomMusicUrl: url };
                }
            ));
        }
        payload.enemies.forEach((enemy, idx) => {
            if (enemy.audioPrompt) {
                promises.push(preloadSfxWithState(
                    enemy.audioPrompt,
                    enemy.audioObjectId || payload.objectRefs?.enemySfxIds?.[idx],
                    payload.nodeType === 'Elite' ? 'boss' : 'enemy',
                    (url) => {
                        enemy.audioUrl = url;
                        const enemySfxUrls = [...(payload.objectUrls?.enemySfxUrls || [])];
                        enemySfxUrls[idx] = url;
                        payload.objectUrls = { ...(payload.objectUrls || {}), enemySfxUrls };
                    }
                ));
            }
        });
        (payload.rewardCards || []).forEach((card, idx) => {
            if (card.audioPrompt) {
                promises.push(preloadSfxWithState(
                    card.audioPrompt,
                    card.audioObjectId || payload.objectRefs?.cardSfxIds?.[idx],
                    'card',
                    (url) => {
                        card.audioUrl = url;
                        const cardSfxUrls = [...(payload.objectUrls?.cardSfxUrls || [])];
                        cardSfxUrls[idx] = url;
                        payload.objectUrls = { ...(payload.objectUrls || {}), cardSfxUrls };
                    }
                ));
            }
        });
    }

    if (payload.nodeType === 'Boss') {
        if (payload.bossMusicPrompt || runData.bossMusicPrompt) {
            promises.push(preloadMusicWithState(
                payload.bossMusicPrompt || runData.bossMusicPrompt || '',
                payload.objectRefs?.bossMusicId,
                'boss',
                (url) => {
                    payload.bossMusicUrl = url;
                    payload.objectUrls = { ...(payload.objectUrls || {}), bossMusicUrl: url };
                }
            ));
        }
        if (payload.boss?.audioPrompt) {
            promises.push(preloadSfxWithState(
                payload.boss.audioPrompt,
                payload.boss.audioObjectId || payload.objectRefs?.bossSfxId,
                'boss',
                (url) => {
                    payload.boss.audioUrl = url;
                    payload.objectUrls = { ...(payload.objectUrls || {}), bossSfxUrl: url };
                }
            ));
        }
        if (payload.boss?.narratorText) {
            promises.push((async () => {
                try {
                    const objectId = payload.boss.narratorAudioObjectId || payload.objectRefs?.bossTtsId;
                    const url = await generateBossTTS(payload.boss.narratorText, {
                        theme: runData.theme,
                        voiceStyle: payload.boss.narratorVoiceStyle,
                        voiceGender: payload.boss.narratorVoiceGender,
                        voiceAccent: payload.boss.narratorVoiceAccent,
                        cacheTag: objectId,
                        fileTag: objectId,
                    });
                    if (url) {
                        payload.boss.narratorAudioUrl = url;
                        payload.objectUrls = { ...(payload.objectUrls || {}), bossTtsUrl: url };
                        markManifestReady(runData, objectId, url);
                    }
                } catch (err) {
                    markManifestFailed(runData, payload.boss.narratorAudioObjectId || payload.objectRefs?.bossTtsId, err);
                }
            })());
        }
    }

    if (payload.nodeType === 'Shop') {
        payload.shopCards.forEach((card, idx) => {
            if (card.audioPrompt) {
                promises.push(preloadSfxWithState(
                    card.audioPrompt,
                    card.audioObjectId || payload.objectRefs?.cardSfxIds?.[idx],
                    'card',
                    (url) => {
                        card.audioUrl = url;
                        const cardSfxUrls = [...(payload.objectUrls?.cardSfxUrls || [])];
                        cardSfxUrls[idx] = url;
                        payload.objectUrls = { ...(payload.objectUrls || {}), cardSfxUrls };
                    }
                ));
            }
        });
    }

    if (payload.nodeType === 'Event') {
        payload.choices.forEach((choice, idx) => {
            const card = choice.effects?.addCard;
            if (card?.audioPrompt) {
                promises.push(preloadSfxWithState(
                    card.audioPrompt,
                    card.audioObjectId || payload.objectRefs?.cardSfxIds?.[idx],
                    'card',
                    (url) => {
                        card.audioUrl = url;
                        const cardSfxUrls = [...(payload.objectUrls?.cardSfxUrls || [])];
                        cardSfxUrls[idx] = url;
                        payload.objectUrls = { ...(payload.objectUrls || {}), cardSfxUrls };
                    }
                ));
            }
        });
    }

    if (promises.length === 0) return;
    await Promise.all(promises);
}
