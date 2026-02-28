import { RunData } from '../../shared/types/game';
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

export async function generateSoundEffect(prompt: string, durationSeconds?: number): Promise<string> {
    const cacheKey = `sfx:${prompt}`;

    if (audioCache.has(cacheKey)) {
        return audioCache.get(cacheKey)!;
    }

    if (pendingRequests.has(cacheKey)) {
        return pendingRequests.get(cacheKey)!;
    }

    const currentRunId = getCurrentRunId();
    if (currentRunId) {
        const sanitizedPrompt = prompt.replace(/[^a-z0-9]/gi, '_').toLowerCase().substring(0, 50);
        const fileName = `sfx_${sanitizedPrompt}.mp3`;
        try {
            const res = await fetch(`/api/check-file?runId=${currentRunId}&fileName=${fileName}`);
            if (res.ok) {
                const { exists, url } = await res.json();
                if (exists) {
                    audioCache.set(cacheKey, url);
                    return url;
                }
            }
        } catch (e) {
            console.error('Failed to check for existing sfx file:', e);
        }
    }

    const apiKey = process.env.ELEVENLABS_API_KEY;
    if (!apiKey) {
        console.warn("ELEVENLABS_API_KEY is not set. Sound generation skipped.");
        return "";
    }

    const request = apiQueue.enqueue(() => fetch('https://api.elevenlabs.io/v1/sound-generation', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'xi-api-key': apiKey,
        },
        body: JSON.stringify({
            text: prompt,
            duration_seconds: durationSeconds,
            prompt_influence: 0.3,
        }),
    })).then(async response => {
        if (!response.ok) {
            const errText = await response.text();
            console.error("ElevenLabs API error:", response.status, errText);
            throw new Error(`ElevenLabs API error: ${response.status}`);
        }

        // ElevenLabs returns an audio stream (audio/mpeg)
        const blob = await response.blob();
        const url = URL.createObjectURL(blob);

        const currentRunId = getCurrentRunId();
        if (currentRunId) {
            try {
                const base64Data = await new Promise<string>((resolve, reject) => {
                    const reader = new FileReader();
                    reader.onloadend = () => resolve(reader.result as string);
                    reader.onerror = reject;
                    reader.readAsDataURL(blob);
                });

                const sanitizedPrompt = prompt.replace(/[^a-z0-9]/gi, '_').toLowerCase().substring(0, 50);
                const fileName = `sfx_${sanitizedPrompt}.mp3`;

                fetch('/api/save-file', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        runId: currentRunId,
                        fileName,
                        base64Data
                    })
                }).catch(err => console.error('Failed to auto-save audio locally:', err));
            } catch (err) {
                console.error("Failed to convert audio to base64 for saving:", err);
            }
        }

        audioCache.set(cacheKey, url);
        pendingRequests.delete(cacheKey);
        return url;
    }).catch(err => {
        pendingRequests.delete(cacheKey);
        console.error("Failed to generate sound effect:", err);
        return "";
    });

    pendingRequests.set(cacheKey, request);
    return request;
}

export async function generateMusic(prompt: string): Promise<string> {
    const cacheKey = `music:${prompt}`;

    if (audioCache.has(cacheKey)) {
        return audioCache.get(cacheKey)!;
    }

    if (pendingRequests.has(cacheKey)) {
        return pendingRequests.get(cacheKey)!;
    }

    const currentRunId = getCurrentRunId();
    if (currentRunId) {
        const sanitizedPrompt = prompt.replace(/[^a-z0-9]/gi, '_').toLowerCase().substring(0, 50);
        const fileName = `bgm_${sanitizedPrompt}.mp3`;
        try {
            const res = await fetch(`/api/check-file?runId=${currentRunId}&fileName=${fileName}`);
            if (res.ok) {
                const { exists, url } = await res.json();
                if (exists) {
                    audioCache.set(cacheKey, url);
                    return url;
                }
            }
        } catch (e) {
            console.error('Failed to check for existing music file:', e);
        }
    }

    const apiKey = process.env.ELEVENLABS_API_KEY;
    if (!apiKey) {
        console.warn("ELEVENLABS_API_KEY is not set. Music generation skipped.");
        return "";
    }

    const request = apiQueue.enqueue(() => fetch('https://api.elevenlabs.io/v1/sound-generation', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'xi-api-key': apiKey,
        },
        body: JSON.stringify({
            text: `Ambient, atmospheric, very subtle and low volume background game music loop, ${prompt}`,
            duration_seconds: 15, // Max duration for background music loop using sound-generation
        }),
    })).then(async response => {
        if (!response.ok) {
            const errText = await response.text();
            console.error("ElevenLabs API error (Music):", response.status, errText);
            throw new Error(`ElevenLabs API error: ${response.status}`);
        }

        const blob = await response.blob();
        const url = URL.createObjectURL(blob);

        const currentRunId = getCurrentRunId();
        if (currentRunId) {
            try {
                const base64Data = await new Promise<string>((resolve, reject) => {
                    const reader = new FileReader();
                    reader.onloadend = () => resolve(reader.result as string);
                    reader.onerror = reject;
                    reader.readAsDataURL(blob);
                });

                const sanitizedPrompt = prompt.replace(/[^a-z0-9]/gi, '_').toLowerCase().substring(0, 50);
                const fileName = `bgm_${sanitizedPrompt}.mp3`;

                fetch('/api/save-file', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        runId: currentRunId,
                        fileName,
                        base64Data
                    })
                }).catch(err => console.error('Failed to auto-save music locally:', err));
            } catch (err) {
                console.error("Failed to convert music to base64 for saving:", err);
            }
        }

        audioCache.set(cacheKey, url);
        pendingRequests.delete(cacheKey);
        return url;
    }).catch(err => {
        pendingRequests.delete(cacheKey);
        console.error("Failed to generate music:", err);
        return "";
    });

    pendingRequests.set(cacheKey, request);
    return request;
}

export async function generateBossTTS(text: string, theme: string): Promise<string> {
    const cacheKey = `tts:${text}`;

    if (audioCache.has(cacheKey)) {
        return audioCache.get(cacheKey)!;
    }

    if (pendingRequests.has(cacheKey)) {
        return pendingRequests.get(cacheKey)!;
    }

    const currentRunId = getCurrentRunId();
    if (currentRunId) {
        const sanitizedPrompt = text.replace(/[^a-z0-9]/gi, '_').toLowerCase().substring(0, 50);
        const fileName = `tts_boss_${sanitizedPrompt}.mp3`;
        try {
            const res = await fetch(`/api/check-file?runId=${currentRunId}&fileName=${fileName}`);
            if (res.ok) {
                const { exists, url } = await res.json();
                if (exists) {
                    audioCache.set(cacheKey, url);
                    return url;
                }
            }
        } catch (e) {
            console.error('Failed to check for existing tts file:', e);
        }
    }

    const apiKey = process.env.ELEVENLABS_API_KEY;
    if (!apiKey) {
        console.warn("ELEVENLABS_API_KEY is not set. TTS generation skipped.");
        return "";
    }

    // Use a validated voice ID from the API
    let voiceId = 'CwhRBWXzGAHq8TQ4Fs17'; // Known valid default ID

    if (theme.toLowerCase().includes('science')) {
        voiceId = 'CwhRBWXzGAHq8TQ4Fs17';
    }

    const request = apiQueue.enqueue(() => fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'xi-api-key': apiKey,
        },
        body: JSON.stringify({
            text: text,
            model_id: "eleven_multilingual_v2",
            voice_settings: {
                stability: 0.3,
                similarity_boost: 0.8
            }
        }),
    })).then(async response => {
        if (!response.ok) {
            const errText = await response.text();
            console.error("ElevenLabs API error (TTS):", response.status, errText);
            throw new Error(`ElevenLabs API error: ${response.status}`);
        }

        const blob = await response.blob();
        const url = URL.createObjectURL(blob);

        const currentRunId = getCurrentRunId();
        if (currentRunId) {
            try {
                const base64Data = await new Promise<string>((resolve, reject) => {
                    const reader = new FileReader();
                    reader.onloadend = () => resolve(reader.result as string);
                    reader.onerror = reject;
                    reader.readAsDataURL(blob);
                });

                const sanitizedPrompt = text.replace(/[^a-z0-9]/gi, '_').toLowerCase().substring(0, 50);
                const fileName = `tts_boss_${sanitizedPrompt}.mp3`;

                fetch('/api/save-file', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        runId: currentRunId,
                        fileName,
                        base64Data
                    })
                }).catch(err => console.error('Failed to auto-save tts locally:', err));
            } catch (err) {
                console.error("Failed to convert tts to base64 for saving:", err);
            }
        }

        audioCache.set(cacheKey, url);
        pendingRequests.delete(cacheKey);
        return url;
    }).catch(err => {
        pendingRequests.delete(cacheKey);
        console.error("Failed to generate TTS:", err);
        return "";
    });

    pendingRequests.set(cacheKey, request);
    return request;
}

export async function preloadRunAudio(runData: RunData): Promise<void> {
    const promises: Promise<string>[] = [];

    if (runData.roomMusicPrompt) {
        promises.push(generateMusic(runData.roomMusicPrompt).catch(e => { console.error('Failed to preload room music', e); return ''; }));
    }
    if (runData.bossMusicPrompt) {
        promises.push(generateMusic(runData.bossMusicPrompt).catch(e => { console.error('Failed to preload boss music', e); return ''; }));
    }

    // Preload starting deck sounds
    for (const card of runData.cards) {
        if (card.audioPrompt) {
            promises.push(generateSoundEffect(card.audioPrompt).catch(e => { console.error('Failed to preload card sound', e); return ''; }));
        }
    }

    // Preload first enemy audio
    if (runData.enemies && runData.enemies.length > 0 && runData.enemies[0].audioPrompt) {
        promises.push(generateSoundEffect(runData.enemies[0].audioPrompt).catch(e => { console.error('Failed to preload enemy sound', e); return ''; }));
    }

    // Await the essential audio correctly so they are ready for the first combat
    await Promise.all(promises);

    // Preload the rest asynchronously without awaiting
    const backgroundPromises: Promise<string>[] = [];
    for (let i = 1; i < runData.enemies.length; i++) {
        if (runData.enemies[i].audioPrompt) {
            backgroundPromises.push(generateSoundEffect(runData.enemies[i].audioPrompt));
        }
    }
    if (runData.boss?.audioPrompt) {
        backgroundPromises.push(generateSoundEffect(runData.boss.audioPrompt));
    }
    if (runData.boss?.narratorText) {
        backgroundPromises.push(generateBossTTS(runData.boss.narratorText, runData.theme));
    }
    Promise.all(backgroundPromises).catch(e => console.error("Error in background audio preload", e));
}
