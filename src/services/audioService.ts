import { Boss, RunData } from '../../shared/types/game';
import { getCurrentRunId } from './geminiService';

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

const DEFAULT_BOSS_VOICE_ID = 'CwhRBWXzGAHq8TQ4Fs17';
const DEFAULT_TTS_MODEL_ID = 'eleven_multilingual_v2';
const MODELS_CACHE_TTL_MS = 10 * 60 * 1000;
const VOICES_CACHE_TTL_MS = 10 * 60 * 1000;

type SoundSource = 'card' | 'enemy' | 'boss' | 'generic';

type MusicMode = 'room' | 'boss';

interface SoundEffectOptions {
    durationSeconds?: number;
    theme?: string;
    source?: SoundSource;
}

interface MusicOptions {
    theme?: string;
    mode?: MusicMode;
}

interface BossTTSOptions {
    theme?: string;
    voiceStyle?: string;
    voiceGender?: Boss['narratorVoiceGender'];
    voiceAccent?: string;
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

function normalizeWhitespace(input: string): string {
    return input.replace(/\s+/g, ' ').trim();
}

function normalizeAudioFragment(input: string, fallback: string, maxWords: number): string {
    const cleaned = normalizeWhitespace(input || '');
    if (!cleaned) return fallback;
    const words = cleaned.split(' ');
    if (words.length <= maxWords) return cleaned;
    return words.slice(0, maxWords).join(' ');
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
        `Cinematic one-shot ${flavor} for a roguelike battle. ` +
        `Theme context: ${theme}. ` +
        `Core event: ${unique}. ` +
        `Close foreground detail, sharp transient, short decay, no speech, no vocals, no background music bed.`
    );
}

function composeMusicPrompt(fragment: string, options: MusicOptions): string {
    const unique = normalizeAudioFragment(fragment, 'tense strings and low percussion heartbeat', 22);
    const theme = normalizeTheme(options.theme);
    const mode = options.mode || 'room';
    const arc = mode === 'boss'
        ? 'high-stakes escalation with menace and dramatic weight'
        : 'steady low-intensity tension suitable for repeated combats';

    return normalizeWhitespace(
        `Instrumental seamless combat loop for a roguelike game. ` +
        `Theme context: ${theme}. ` +
        `Musical motif: ${unique}. ` +
        `Emotional arc: ${arc}. ` +
        `No vocals, no spoken words, moderate dynamics, leave space for sound effects.`
    );
}

function normalizeNarratorText(text: string): string {
    return normalizeAudioFragment(text, 'Your journey ends here.', 24);
}

function getVoiceSettings(theme?: string): { stability: number; similarity_boost: number } {
    const normalizedTheme = (theme || '').toLowerCase();

    if (normalizedTheme.includes('science')) {
        return { stability: 0.45, similarity_boost: 0.72 };
    }
    if (normalizedTheme.includes('legal') || normalizedTheme.includes('court')) {
        return { stability: 0.42, similarity_boost: 0.78 };
    }
    if (normalizedTheme.includes('horror')) {
        return { stability: 0.32, similarity_boost: 0.82 };
    }

    return { stability: 0.35, similarity_boost: 0.8 };
}

function toFileSafeKey(input: string): string {
    return input.replace(/[^a-z0-9]/gi, '_').toLowerCase().substring(0, 50);
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
        return ['clinical', 'calm', 'cold', 'precise', 'neutral', 'measured'];
    }
    if (normalizedTheme.includes('legal') || normalizedTheme.includes('court')) {
        return ['authoritative', 'formal', 'deep', 'commanding', 'neutral'];
    }
    if (normalizedTheme.includes('cooking') || normalizedTheme.includes('kitchen')) {
        return ['warm', 'confident', 'charismatic', 'playful'];
    }
    if (normalizedTheme.includes('horror')) {
        return ['dark', 'ominous', 'gravelly', 'haunting'];
    }

    return ['dramatic', 'cinematic', 'commanding'];
}

function normalizeVoiceBlob(voice: ElevenVoice): string {
    const labels = voice.labels
        ? Object.entries(voice.labels).map(([k, v]) => `${k}:${v}`).join(' ')
        : '';

    return `${voice.name || ''} ${voice.description || ''} ${voice.category || ''} ${labels}`.toLowerCase();
}

function pickVoiceId(
    voices: ElevenVoice[],
    hints: { theme?: string; style?: string; gender?: string; accent?: string; line?: string }
): string {
    if (voices.length === 0) return DEFAULT_BOSS_VOICE_ID;

    const keywords = [
        ...themeVoiceKeywords(hints.theme),
        ...tokenizeHints(hints.style || ''),
        ...tokenizeHints(hints.accent || ''),
        ...tokenizeHints(hints.line || ''),
    ];

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

        if ((voice.name || '').toLowerCase().includes('narrator')) score += 2;

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

async function persistRunFile(fileName: string, blob: Blob): Promise<void> {
    const currentRunId = getCurrentRunId();
    if (!currentRunId) return;

    try {
        const base64Data = await new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.onloadend = () => resolve(reader.result as string);
            reader.onerror = reject;
            reader.readAsDataURL(blob);
        });

        await fetch('/api/save-file', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                runId: currentRunId,
                fileName,
                base64Data
            })
        });
    } catch (err) {
        console.error(`Failed to auto-save audio file (${fileName}) locally:`, err);
    }
}

async function requestSoundGeneration(
    apiKey: string,
    promptText: string,
    durationSeconds: number,
    promptInfluence: number
): Promise<Blob> {
    const response = await apiQueue.enqueue(() => fetchWithTimeout('https://api.elevenlabs.io/v1/sound-generation', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'xi-api-key': apiKey,
        },
        body: JSON.stringify({
            text: promptText,
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

async function finalizeAudioRequest(cacheKey: string, fileName: string, blob: Blob): Promise<string> {
    const url = URL.createObjectURL(blob);
    audioCache.set(cacheKey, url);
    await persistRunFile(fileName, blob);
    return url;
}

function normalizeBossOptions(optionsOrTheme?: BossTTSOptions | string): BossTTSOptions {
    if (typeof optionsOrTheme === 'string') {
        return { theme: optionsOrTheme };
    }
    return optionsOrTheme || {};
}

export async function generateSoundEffect(prompt: string, options: SoundEffectOptions = {}): Promise<string> {
    const normalizedPrompt = normalizeAudioFragment(prompt, 'arcane strike with metallic tail', 18);
    const source = options.source || 'generic';
    const theme = normalizeTheme(options.theme);
    const cacheKey = `sfx:${source}:${theme}:${normalizedPrompt}`;

    if (audioCache.has(cacheKey)) {
        return audioCache.get(cacheKey)!;
    }

    if (pendingRequests.has(cacheKey)) {
        return pendingRequests.get(cacheKey)!;
    }

    const fileName = `sfx_${source}_${toFileSafeKey(normalizedPrompt)}.mp3`;
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

    const durationSeconds = options.durationSeconds ?? (source === 'boss' ? 3 : source === 'enemy' ? 3 : 2);
    const templatedPrompt = composeSoundEffectPrompt(normalizedPrompt, { ...options, source, theme });

    const request = (async () => {
        try {
            let blob: Blob;
            try {
                blob = await requestSoundGeneration(apiKey, templatedPrompt, durationSeconds, 0.4);
            } catch (templatedErr) {
                console.warn('Templated SFX prompt failed, retrying with raw semantic prompt.', templatedErr);
                blob = await requestSoundGeneration(apiKey, normalizedPrompt, durationSeconds, 0.3);
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
    const normalizedPrompt = normalizeAudioFragment(prompt, 'ominous strings over restrained percussion', 22);
    const mode = options.mode || 'room';
    const theme = normalizeTheme(options.theme);
    const cacheKey = `music:${mode}:${theme}:${normalizedPrompt}`;

    if (audioCache.has(cacheKey)) {
        return audioCache.get(cacheKey)!;
    }

    if (pendingRequests.has(cacheKey)) {
        return pendingRequests.get(cacheKey)!;
    }

    const fileName = `bgm_${mode}_${toFileSafeKey(normalizedPrompt)}.mp3`;
    const legacyFileName = `bgm_${toFileSafeKey(normalizedPrompt)}.mp3`;
    const existing = await tryLoadFromRunFile(cacheKey, [fileName, legacyFileName]);
    if (existing) {
        return existing;
    }

    const apiKey = process.env.ELEVENLABS_API_KEY;
    if (!apiKey) {
        console.warn('ELEVENLABS_API_KEY is not set. Music generation skipped.');
        return '';
    }

    const templatedPrompt = composeMusicPrompt(normalizedPrompt, { ...options, mode, theme });

    const request = (async () => {
        try {
            let blob: Blob;
            try {
                blob = await requestSoundGeneration(apiKey, templatedPrompt, 15, 0.5);
            } catch (templatedErr) {
                console.warn('Templated BGM prompt failed, retrying with raw semantic prompt.', templatedErr);
                blob = await requestSoundGeneration(apiKey, normalizedPrompt, 15, 0.35);
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
    const cacheKey = `tts:${theme}:${normalizedText}:${options.voiceStyle || ''}:${options.voiceGender || ''}:${options.voiceAccent || ''}`;

    if (audioCache.has(cacheKey)) {
        return audioCache.get(cacheKey)!;
    }

    if (pendingRequests.has(cacheKey)) {
        return pendingRequests.get(cacheKey)!;
    }

    const fileName = `tts_boss_${toFileSafeKey(normalizedText)}.mp3`;
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
            const [models, voices] = await Promise.all([
                loadModelCatalog(apiKey),
                loadVoiceCatalog(apiKey),
            ]);

            const modelId = pickBestTTSModelId(models);
            const voiceId = pickVoiceId(voices, {
                theme,
                style: options.voiceStyle,
                gender: options.voiceGender,
                accent: options.voiceAccent,
                line: normalizedText,
            });

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
                        voice_settings: { stability: 0.35, similarity_boost: 0.8 },
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
