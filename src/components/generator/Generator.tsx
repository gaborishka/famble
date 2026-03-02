import React, { useState, useRef } from 'react';
import { GenerationMode, RunData, isRunDataV2 } from '../../../shared/types/game';
import {
  generateRunBootstrap,
  preloadEssentialImages,
  preloadFirstCombatImages,
  preloadBackgroundImages,
  repairRunDataCardMediaRefs,
  setCurrentRunId,
} from '../../services/geminiService';
import { preloadEssentialAudio, preloadRunAudio } from '../../services/audioService';
import { processDocumentOCR, buildEnhancedPrompt, isUrlInput, MistralDocumentInput } from '../../services/mistralService';
import { motion, AnimatePresence } from 'motion/react';
import { FileUp, Globe, ArrowRight, Sparkles, FileText, Check } from 'lucide-react';
import { Logo } from '../common/Logo';

interface GeneratorProps {
  onGenerated: (data: RunData) => void;
  forceLoadingPreview?: boolean;
}

interface LoadingView {
  title: string;
  subtitle: string;
  progress: number;
  stepLabel: string;
  step: number;
  totalSteps: number;
  caption: string;
  finePrint: string;
}

const prepareRunForReplay = (runData: RunData): RunData => {
  if (isRunDataV2(runData)) {
    return {
      ...runData,
      node_map: runData.node_map.map(node => ({ ...node, completed: false })),
    };
  }

  if (!runData.node_map) {
    return runData;
  }

  return {
    ...runData,
    node_map: runData.node_map.map(node => ({ ...node, completed: false })),
  };
};

const defaultLoadingView: LoadingView = {
  title: 'Generating Run Data...',
  subtitle: 'Summoning your custom adventure...',
  progress: 28,
  stepLabel: 'Preparing your run...',
  step: 1,
  totalSteps: 6,
  caption: "Your document holds secrets. Let's deal them out.",
  finePrint: 'This usually takes 30-60 seconds'
};

const loadingViewsByMessage: Record<string, LoadingView> = {
  'Analyzing Document...': {
    title: 'Reading your document...',
    subtitle: 'Extracting content with Mistral Document AI',
    progress: 12,
    stepLabel: 'Analyzing document structure...',
    step: 1,
    totalSteps: 7,
    caption: "Your document holds secrets. Let's deal them out.",
    finePrint: 'This usually takes 10-20 seconds'
  },
  'Generating Run...': {
    title: 'Generating Run Data...',
    subtitle: 'Summoning your custom adventure...',
    progress: 28,
    stepLabel: 'Preparing your run...',
    step: 2,
    totalSteps: 7,
    caption: "Your document holds secrets. Let's deal them out.",
    finePrint: 'This usually takes 30-60 seconds'
  },
  'Generating Run Data...': {
    title: 'Shuffling your adventure...',
    subtitle: 'Building a unique run from your document',
    progress: 45,
    stepLabel: 'Creating cards and enemies...',
    step: 3,
    totalSteps: 7,
    caption: "Your document holds secrets. Let's deal them out.",
    finePrint: 'This usually takes 30-60 seconds'
  },
  'Preloading Room 1 Graphics...': {
    title: 'Painting your battlefield...',
    subtitle: 'Infusing room one with generated visuals',
    progress: 72,
    stepLabel: 'Preloading room graphics...',
    step: 5,
    totalSteps: 7,
    caption: "Your document holds secrets. Let's deal them out.",
    finePrint: 'This usually takes 30-60 seconds'
  },
  'Synthesizing Audio Magic...': {
    title: 'Tuning your soundscape...',
    subtitle: 'Forging SFX and music for your run',
    progress: 90,
    stepLabel: 'Synthesizing battle audio...',
    step: 6,
    totalSteps: 7,
    caption: "Your document holds secrets. Let's deal them out.",
    finePrint: 'This usually takes 30-60 seconds'
  },
  'Loading Past Run...': {
    title: 'Reopening your adventure...',
    subtitle: 'Recovering your saved run data',
    progress: 38,
    stepLabel: 'Loading run snapshot...',
    step: 2,
    totalSteps: 6,
    caption: 'Your run remembers every card you played.',
    finePrint: 'This usually takes a few seconds'
  },
  'Restoring Room 1 Graphics...': {
    title: 'Rebuilding your battlefield...',
    subtitle: 'Restoring generated room visuals',
    progress: 70,
    stepLabel: 'Restoring room graphics...',
    step: 4,
    totalSteps: 6,
    caption: 'Your run remembers every card you played.',
    finePrint: 'This usually takes a few seconds'
  },
  'Restoring Audio Magic...': {
    title: 'Retuning your soundscape...',
    subtitle: 'Bringing back the run soundtrack',
    progress: 90,
    stepLabel: 'Restoring battle audio...',
    step: 5,
    totalSteps: 6,
    caption: 'Your run remembers every card you played.',
    finePrint: 'This usually takes a few seconds'
  }
};

const forcedPreviewLoadingView: LoadingView = {
  title: 'Shuffling your adventure...',
  subtitle: 'Building a unique run from your document',
  progress: 45,
  stepLabel: 'Creating cards and enemies...',
  step: 2,
  totalSteps: 6,
  caption: "Your document holds secrets. Let's deal them out.",
  finePrint: 'This usually takes 30-60 seconds'
};

const SHUFFLE_CARD_COUNT = 10;
const SHUFFLE_HALF = SHUFFLE_CARD_COUNT / 2;

const floatingPreviewCards = [
  { id: 'top-left', x: '28%', y: '16%', rotate: -2, border: '#7ec8ff', delay: 0 },
  { id: 'top-right', x: '74%', y: '14%', rotate: 20, border: '#b88dff', delay: 0.4 },
  { id: 'bottom-right', x: '70%', y: '76%', rotate: 40, border: '#f07a66', delay: 0.2 }
];

export const Generator: React.FC<GeneratorProps> = ({ onGenerated, forceLoadingPreview = false }) => {
  const [prompt, setPrompt] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [loadingMessage, setLoadingMessage] = useState('Generating Run...');
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [pastRuns, setPastRuns] = useState<{ runId: string, theme: string, timestamp: number }[]>([]);
  const [uploadedFileName, setUploadedFileName] = useState<string | null>(null);
  const generationMode: GenerationMode = 'fast_start';

  React.useEffect(() => {
    fetch('/api/list-runs')
      .then(res => res.json())
      .then(data => {
        if (data.runs) {
          setPastRuns(data.runs);
        }
      })
      .catch(console.error);
  }, []);

  const loadingView = React.useMemo(
    () => loadingViewsByMessage[loadingMessage] ?? defaultLoadingView,
    [loadingMessage]
  );
  const activeLoadingView = forceLoadingPreview ? forcedPreviewLoadingView : loadingView;
  const overlayVisible = forceLoadingPreview || isGenerating;
  const previewFileName = forceLoadingPreview ? null : uploadedFileName;

  const handleGenerateText = async () => {
    if (!prompt) {
      setError('Please provide a URL or prompt.');
      return;
    }
    if (isUrlInput(prompt)) {
      await doGenerate(prompt, undefined, { type: 'url', url: prompt });
    } else {
      await doGenerate(prompt);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      processFile(e.target.files[0]);
    }
  };

  const processFile = async (file: File) => {
    setUploadedFileName(file.name);
    const reader = new FileReader();
    reader.onloadend = async () => {
      const base64Data = (reader.result as string).split(',')[1];
      const fileData = { mimeType: file.type, data: base64Data };
      const mistralInput: MistralDocumentInput = { type: 'file', mimeType: file.type, base64Data };
      await doGenerate('Generate a run based on this document.', fileData, mistralInput);
    };
    reader.readAsDataURL(file);
  };

  const loadPastRun = async (runId: string) => {
    setIsGenerating(true);
    setLoadingMessage('Loading Past Run...');
    setError(null);

    try {
      setCurrentRunId(runId);
      const res = await fetch(`/runs/${runId}/run-data.json`);
      if (!res.ok) throw new Error('Failed to load run data');
      const loadedRunData = await res.json() as RunData;
      const runData = repairRunDataCardMediaRefs(prepareRunForReplay(loadedRunData));

      if (isRunDataV2(runData)) {
        runData.generationSettings = runData.generationSettings || { mode: 'fast_start', prefetchDepth: 2 };
        runData.objectManifest = runData.objectManifest || {};
        runData.rooms = runData.rooms || {};
      }

      setLoadingMessage('Restoring Room 1 Graphics...');
      if (isRunDataV2(runData)) {
        await preloadEssentialImages(runData);
      } else {
        await preloadFirstCombatImages(runData);
      }

      setLoadingMessage('Restoring Audio Magic...');
      if (isRunDataV2(runData)) {
        await preloadEssentialAudio(runData);
      } else {
        await preloadRunAudio(runData);
        preloadBackgroundImages(runData);
      }

      onGenerated(runData);
    } catch (err: any) {
      console.error(err);
      setError(err.message || 'Failed to load past run.');
      setIsGenerating(false);
    }
  };

  const doGenerate = async (
    finalPrompt: string,
    fileData?: { mimeType: string; data: string },
    mistralInput?: MistralDocumentInput,
  ) => {
    setIsGenerating(true);
    setLoadingMessage('Generating Run Data...');
    setError(null);
    if (!fileData && !mistralInput) {
      setUploadedFileName(null);
    }

    try {
      let effectivePrompt = finalPrompt;
      let skipFileData = false;

      // Mistral Document AI preprocessing (optional — falls through on failure)
      if (mistralInput) {
        setLoadingMessage('Analyzing Document...');
        try {
          const extraction = await processDocumentOCR(mistralInput);
          if (extraction && extraction.markdown.trim().length > 0) {
            console.log(
              `Mistral OCR: extracted ${extraction.pageCount} pages, ` +
              `${extraction.markdown.length} chars, ` +
              `annotations: ${extraction.annotations ? 'yes' : 'no'}`
            );
            effectivePrompt = buildEnhancedPrompt(finalPrompt, extraction);
            skipFileData = true;
          } else {
            console.warn('OCR returned empty content, skipping — will pass raw input to generation.');
          }
        } catch (ocrErr) {
          console.warn('OCR failed, skipping:', ocrErr);
        }
      }

      setLoadingMessage('Generating Run Data...');
      const generatedRunData = await generateRunBootstrap(
        effectivePrompt,
        fileData,
        { mode: generationMode, prefetchDepth: 2 },
        skipFileData ? { skipFileData: true } : undefined,
      );
      const runData = repairRunDataCardMediaRefs(generatedRunData);

      setLoadingMessage('Preloading Room 1 Graphics...');
      await preloadEssentialImages(runData);

      setLoadingMessage('Synthesizing Audio Magic...');
      await preloadEssentialAudio(runData);

      onGenerated(runData);
    } catch (err: any) {
      console.error(err);
      setError(err.message || 'Failed to generate game data. Please try again.');
    } finally {
      setIsGenerating(false);
      setLoadingMessage('Generating Run...');
    }
  };

  return (
    <div className="min-h-screen bg-[#141b2e] flex flex-col relative overflow-hidden text-white font-sans">
      {/* Background Texture Overlay */}
      <div
        className="absolute inset-0 z-0 pointer-events-none opacity-[0.15] mix-blend-overlay"
        style={{
          backgroundImage: 'url("data:image/svg+xml,%3Csvg viewBox=%220 0 200 200%22 xmlns=%22http://www.w3.org/2000/svg%22%3E%3Cfilter id=%22noiseFilter%22%3E%3CfeTurbulence type=%22fractalNoise%22 baseFrequency=%220.85%22 numOctaves=%223%22 stitchTiles=%22stitch%22/%3E%3C/filter%3E%3Crect width=%22100%25%22 height=%22100%25%22 filter=%22url(%23noiseFilter)%22/%3E%3C/svg%3E")'
        }}
      />

      {/* Header */}
      <header className="w-full px-12 py-8 flex justify-between items-start z-10 relative">
        <Logo className="w-48 sm:w-64" />
        <div className="flex gap-8 text-sm text-slate-400">
          <button className="hover:text-white transition-colors tracking-wide">Explore</button>
          <button className="hover:text-white transition-colors tracking-wide">Log in</button>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 w-full flex flex-col items-center justify-center z-10 -mt-16 px-4">
        <div className="text-center mb-16 space-y-4 max-w-2xl">
          <h1 className="text-4xl md:text-5xl font-bold tracking-tight">Any Content → Unique Roguelike</h1>
          <p className="text-slate-400 text-base md:text-lg px-8">
            Upload a document or paste a URL — get a unique deckbuilder with custom cards, enemies, and music.
          </p>
        </div>

        {error && (
          <div className="bg-red-500/10 border border-red-500/50 text-red-400 px-6 py-3 rounded-xl mb-8 max-w-md text-center">
            {error}
          </div>
        )}

        {/* Cards container */}
        <div className="relative w-full max-w-[760px] h-[390px] sm:h-[500px] mx-auto mt-1 sm:mt-2 perspective-[1200px]">

          {/* PDF Card (Back) */}
          <motion.div
            initial={{ rotate: -10, x: -10, y: 8 }}
            whileHover={{ scale: 1.04, rotate: -7, x: -24, y: 0, zIndex: 30 }}
            className="absolute top-[55%] left-1/2 -translate-x-[84%] sm:-translate-x-[105%] -translate-y-1/2 z-10 bg-[#2d3748] border-2 border-[#ef4444] rounded-2xl w-52 sm:w-72 h-[320px] sm:h-[380px] flex flex-col shadow-2xl shadow-black/50 overflow-hidden cursor-pointer"
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              if (e.dataTransfer.files && e.dataTransfer.files[0]) {
                processFile(e.dataTransfer.files[0]);
              }
            }}
            onClick={() => fileInputRef.current?.click()}
          >
            <div className="absolute top-3 left-3 sm:top-4 sm:left-4 bg-black text-white rounded-full px-3 sm:px-4 py-1.5 text-[10px] font-bold tracking-wider">DOCS</div>

            <div className="flex-1 flex flex-col items-center justify-center pt-8 sm:pt-10 px-4 sm:px-6 text-center">
              <FileUp className="w-10 h-10 sm:w-14 sm:h-14 text-white mb-3 sm:mb-5" />
              <h2 className="text-2xl sm:text-3xl font-serif text-white mb-1.5 sm:mb-2">Drop File Here</h2>
              <p className="text-slate-400 text-xs sm:text-sm italic">or click to browse</p>
            </div>

            <div className="bg-[#f97316] w-full py-1.5 sm:py-2 text-center text-black text-[10px] sm:text-[11px] font-bold tracking-widest uppercase">
              PDF, DOCX, PPTX, Images
            </div>

            <div className="bg-slate-900/60 py-3.5 sm:py-5 px-4 text-center">
              <p className="text-[10px] sm:text-[11px] text-slate-300 opacity-60 font-mono tracking-wide">
                Every document hides<br />monsters inside.
              </p>
            </div>
            <input type="file" ref={fileInputRef} onChange={handleFileChange} accept="application/pdf,image/*,.docx,.pptx,.doc,.ppt,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.openxmlformats-officedocument.presentationml.presentation" className="hidden" />
          </motion.div>

          {/* URL Card (Front) */}
          <motion.div
            initial={{ rotate: 7, x: 12, y: -4 }}
            whileHover={{ scale: 1.04, rotate: 5, x: 24, y: -12, zIndex: 30 }}
            className="absolute top-[53%] left-1/2 -translate-x-[14%] sm:translate-x-0 -translate-y-1/2 z-20 bg-[#2d3748] border-2 border-[#a855f7] rounded-2xl w-52 sm:w-72 h-[320px] sm:h-[380px] flex flex-col shadow-2xl shadow-black/50 overflow-hidden"
          >
            <div className="absolute top-3 left-3 sm:top-4 sm:left-4 bg-black text-white rounded-full px-3 sm:px-4 py-1.5 text-[10px] font-bold tracking-wider">URL</div>

            <div className="flex-1 flex flex-col items-center justify-center pt-8 sm:pt-12 px-4 sm:px-6 text-center">
              <Globe className="w-10 h-10 sm:w-14 sm:h-14 text-white mb-3 sm:mb-5" />
              <h2 className="text-2xl sm:text-3xl font-serif text-white mb-3 sm:mb-5">Paste Any Link</h2>

              <div className="w-full relative flex items-center mb-3 sm:mb-4">
                <input
                  type="text"
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleGenerateText()}
                  placeholder="https://"
                  className="w-full bg-[#1e293b] border-none rounded-lg py-2.5 sm:py-3 pl-3 sm:pl-4 pr-10 sm:pr-12 text-xs sm:text-sm text-white placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-purple-500"
                />
                <button
                  onClick={handleGenerateText}
                  disabled={isGenerating}
                  className="absolute right-1.5 top-1/2 -translate-y-1/2 bg-[#f97316] hover:bg-[#ea580c] text-black rounded px-2 py-1 transition-colors"
                >
                  <ArrowRight className="w-4 h-4 sm:w-5 sm:h-5" />
                </button>
              </div>
              <p className="text-[10px] sm:text-[11px] text-slate-400 font-medium">Articles, blogs, Wikipedia, docs</p>
            </div>

            <div className="relative pt-3 sm:pt-4 pb-3.5 sm:pb-5 px-4 text-center">
              <div className="absolute top-0 left-0 w-full flex items-center justify-center">
                <div className="w-full h-[1px] bg-purple-500/30"></div>
                <div className="absolute bg-[#2d3748] px-3 text-purple-400 opacity-60">
                  <Globe className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
                </div>
              </div>
              <p className="mt-3 sm:mt-4 text-[10px] sm:text-[11px] text-slate-300 opacity-60 font-mono tracking-wide">
                The web is full of<br />monsters.
              </p>
            </div>
          </motion.div>

        </div>

        {pastRuns.length > 0 && (
          <div className="w-full max-w-2xl mx-auto mt-20 pt-10 border-t border-slate-800 pb-16">
            <h3 className="text-xl font-bold mb-6 text-slate-300 tracking-wide text-center uppercase">Resurrect Past Runs</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {pastRuns.map(run => (
                <button
                  key={run.runId}
                  onClick={() => loadPastRun(run.runId)}
                  className="bg-[#1e293b] hover:bg-[#2d3748] border border-slate-700 hover:border-purple-500/50 rounded-xl p-4 text-left transition-all duration-200 group flex items-center justify-between"
                >
                  <div>
                    <div className="font-semibold text-white mb-1">{run.theme}</div>
                    <div className="text-xs text-slate-500 font-mono">{new Date(run.timestamp).toLocaleString()}</div>
                  </div>
                  <ArrowRight className="w-5 h-5 text-slate-600 group-hover:text-purple-400 transform group-hover:translate-x-1 transition-all" />
                </button>
              ))}
            </div>
          </div>
        )}

      </main>

      {/* Sparkle decoration bottom right */}
      <div className="absolute bottom-10 right-10 text-slate-400 opacity-30">
        <Sparkles strokeWidth={1} className="w-10 h-10 fill-current" />
      </div>

      <AnimatePresence>
        {overlayVisible && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center overflow-hidden bg-[#040a25]/90 backdrop-blur-sm text-white"
          >
            <div className="pointer-events-none absolute inset-0">
              <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,rgba(255,132,78,0.10)_0%,rgba(27,52,94,0.25)_40%,rgba(4,10,37,0.96)_85%)]" />
              <div className="absolute left-1/2 top-1/2 h-[760px] w-[760px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-[radial-gradient(circle,rgba(255,129,72,0.18)_0%,rgba(22,46,92,0.11)_45%,rgba(4,10,37,0)_72%)] blur-2xl" />
              <div className="absolute -right-2 bottom-10 h-9 w-9 rotate-45 rounded-md bg-slate-100/80 opacity-80 shadow-[0_0_16px_rgba(255,255,255,0.25)]" />
            </div>

            <div className="relative z-10 w-full max-w-[820px] px-5 sm:px-8">
              <div className="mx-auto max-w-[680px] text-center pb-6">
                {previewFileName && (
                  <div className="mb-5 inline-flex items-center gap-2 rounded-full border border-[#4f7199] bg-[#1a3154]/85 px-5 py-2.5 text-sm text-slate-100 shadow-[0_0_22px_rgba(42,77,123,0.45)]">
                    <FileText className="h-4 w-4 text-slate-200" />
                    <span className="max-w-[290px] truncate">{previewFileName}</span>
                    <Check className="h-4 w-4 text-emerald-300" />
                  </div>
                )}

                <div className="relative mx-auto mb-2 h-[330px] w-full max-w-[520px] sm:h-[390px] sm:max-w-[620px]">
                  <motion.div
                    animate={{ rotate: 360 }}
                    transition={{ duration: 20, repeat: Infinity, ease: 'linear' }}
                    className="absolute left-1/2 top-1/2 h-[285px] w-[440px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-[radial-gradient(ellipse_at_center,rgba(255,127,70,0.34)_0%,rgba(247,106,59,0.16)_40%,rgba(0,0,0,0)_75%)] blur-[1.5px]"
                  />
                  <div className="absolute left-1/2 top-1/2 h-[280px] w-[280px] -translate-x-1/2 -translate-y-1/2 rounded-full border border-[#f27a52]/20" />

                  {floatingPreviewCards.map((card) => (
                    <motion.div
                      key={card.id}
                      style={{
                        left: card.x,
                        top: card.y,
                        transform: `translate(-50%, -50%) rotate(${card.rotate}deg)`,
                        borderColor: card.border
                      }}
                      animate={{ y: [0, -6, 0], rotate: [card.rotate, card.rotate + 2, card.rotate] }}
                      transition={{ duration: 2.8, repeat: Infinity, ease: 'easeInOut', delay: card.delay }}
                      className="absolute h-[92px] w-[66px] rounded-md border-2 bg-[#234166] shadow-[0_10px_20px_rgba(0,0,0,0.42)]"
                    >
                      <div className="absolute inset-[7px] rounded-[3px] border border-[#8ca7c6]/50" />
                    </motion.div>
                  ))}

                  {/* Card Shuffle (Riffle) Animation */}
                  {Array.from({ length: SHUFFLE_CARD_COUNT }, (_, i) => {
                    const isLeft = i < SHUFFLE_HALF;
                    const pileIdx = isLeft ? i : i - SHUFFLE_HALF;
                    const riffleOrder = isLeft ? i * 2 : (i - SHUFFLE_HALF) * 2 + 1;

                    const splitX = isLeft ? -105 : 105;
                    const stackY = i * -2;
                    const pileY = pileIdx * -3;

                    const riffleStart = 0.35 + riffleOrder * 0.035;
                    const riffleMid = riffleStart + 0.035;
                    const riffleEnd = riffleMid + 0.035;

                    return (
                      <motion.div
                        key={`shuffle-${i}`}
                        animate={{
                          x: [0, splitX, splitX, splitX * 0.3, 0, 0],
                          y: [stackY, pileY, pileY, pileY - 60, stackY, stackY],
                          rotateZ: [0, isLeft ? -15 : 15, isLeft ? -15 : 15, isLeft ? -5 : 5, 0, 0],
                          scale: [1, 1, 1, 1.08, 1, 1],
                        }}
                        transition={{
                          duration: 4,
                          repeat: Infinity,
                          times: [0, 0.20, riffleStart, riffleMid, riffleEnd, 1],
                          ease: ['easeOut', 'linear', 'easeOut', 'easeIn', 'linear'],
                        }}
                        style={{ zIndex: riffleOrder + 1 }}
                        className="absolute left-1/2 top-1/2 h-[136px] w-[94px] -translate-x-1/2 -translate-y-1/2 rounded-lg border border-[#5a7fa8] bg-gradient-to-br from-[#1a3d64] to-[#142d4d] shadow-[0_4px_16px_rgba(0,0,0,0.45)]"
                      >
                        <div className="absolute inset-[6px] rounded-[5px] border border-[#7a9dbe]/35">
                          <div className="absolute left-1/2 top-1/2 h-5 w-5 -translate-x-1/2 -translate-y-1/2 rotate-45 border border-[#ff8455]/30" />
                        </div>
                      </motion.div>
                    );
                  })}
                </div>

                <h2 className="mx-auto max-w-[560px] text-[clamp(2.2rem,4vw,4.4rem)] font-serif font-semibold leading-[0.95] tracking-tight text-slate-100">
                  {activeLoadingView.title}
                </h2>
                <p className="mx-auto mt-4 max-w-[560px] text-[clamp(1.05rem,1.35vw,1.6rem)] leading-[1.24] text-slate-400">
                  {activeLoadingView.subtitle}
                </p>

                <div className="mx-auto mt-8 w-full max-w-[640px]">
                  <div className="relative h-8 rounded-full border border-[#2f5a86]/80 bg-[#193255]/65 px-1 py-1 shadow-[inset_0_2px_12px_rgba(0,0,0,0.45)]">
                    <motion.div
                      initial={{ width: forceLoadingPreview ? `${activeLoadingView.progress}%` : '0%' }}
                      animate={{ width: `${activeLoadingView.progress}%` }}
                      transition={{ duration: 0.8, ease: 'easeOut' }}
                      className="h-full rounded-full bg-gradient-to-r from-[#ff5f3b] via-[#ff7648] to-[#ff9f60] shadow-[0_0_24px_rgba(255,118,72,0.45)]"
                    />
                  </div>
                  <div className="mt-1 text-right text-[clamp(1.2rem,1.3vw,1.65rem)] font-medium text-slate-300/90">
                    {activeLoadingView.progress}%
                  </div>
                </div>

                <div className="mt-5">
                  <div className="flex items-center justify-center gap-3 text-[clamp(1.25rem,1.45vw,1.7rem)] leading-tight text-[#ff8252]">
                    <motion.span
                      animate={{ rotate: 360 }}
                      transition={{ duration: 1.15, repeat: Infinity, ease: 'linear' }}
                      className="h-6 w-6 rounded-full border-[3px] border-[#ff8252] border-b-transparent"
                    />
                    <span>{activeLoadingView.stepLabel}</span>
                  </div>
                  <div className="mt-1 text-[clamp(0.98rem,1.05vw,1.25rem)] leading-tight text-slate-300/80">
                    {activeLoadingView.step} of {activeLoadingView.totalSteps} steps complete
                  </div>
                </div>

                <div className="mt-3 text-[clamp(0.9rem,0.95vw,1.1rem)] text-slate-400/80">
                  {activeLoadingView.finePrint}
                </div>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};
