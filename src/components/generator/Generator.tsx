import React, { useState, useRef } from 'react';
import { RunData } from '../../../shared/types/game';
import { generateRunData, preloadFirstCombatImages, preloadBackgroundImages, setCurrentRunId } from '../../services/geminiService';
import { preloadRunAudio } from '../../services/audioService';
import { motion, AnimatePresence } from 'motion/react';
import { FileUp, Globe, ArrowRight, Loader2, Sparkles, FileText, Check } from 'lucide-react';

interface GeneratorProps {
  onGenerated: (data: RunData) => void;
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
  'Generating Run...': {
    title: 'Generating Run Data...',
    subtitle: 'Summoning your custom adventure...',
    progress: 28,
    stepLabel: 'Preparing your run...',
    step: 1,
    totalSteps: 6,
    caption: "Your document holds secrets. Let's deal them out.",
    finePrint: 'This usually takes 30-60 seconds'
  },
  'Generating Run Data...': {
    title: 'Shuffling your adventure...',
    subtitle: 'Building a unique run from your document',
    progress: 45,
    stepLabel: 'Creating cards and enemies...',
    step: 2,
    totalSteps: 6,
    caption: "Your document holds secrets. Let's deal them out.",
    finePrint: 'This usually takes 30-60 seconds'
  },
  'Preloading Room 1 Graphics...': {
    title: 'Painting your battlefield...',
    subtitle: 'Infusing room one with generated visuals',
    progress: 72,
    stepLabel: 'Preloading room graphics...',
    step: 4,
    totalSteps: 6,
    caption: "Your document holds secrets. Let's deal them out.",
    finePrint: 'This usually takes 30-60 seconds'
  },
  'Synthesizing Audio Magic...': {
    title: 'Tuning your soundscape...',
    subtitle: 'Forging SFX and music for your run',
    progress: 90,
    stepLabel: 'Synthesizing battle audio...',
    step: 5,
    totalSteps: 6,
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

const swirlingDeckCards = Array.from({ length: 10 }, (_, index) => ({
  id: `deck-${index}`,
  baseAngle: index * 36
}));

const orbitingCards = [
  { id: 'left', x: '20%', y: '58%', border: '#ec5f53', glow: 'rgba(236,95,83,0.55)', rotate: -24, delay: 0 },
  { id: 'right', x: '80%', y: '56%', border: '#4fb0f2', glow: 'rgba(79,176,242,0.45)', rotate: 16, delay: 0.2 },
  { id: 'bottom', x: '70%', y: '86%', border: '#a16bff', glow: 'rgba(161,107,255,0.45)', rotate: -14, delay: 0.4 }
];

export const Generator: React.FC<GeneratorProps> = ({ onGenerated }) => {
  const [prompt, setPrompt] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [loadingMessage, setLoadingMessage] = useState('Generating Run...');
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [pastRuns, setPastRuns] = useState<{ runId: string, theme: string, timestamp: number }[]>([]);
  const [uploadedFileName, setUploadedFileName] = useState<string | null>(null);

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

  const handleGenerateText = async () => {
    if (!prompt) {
      setError('Please provide a URL or prompt.');
      return;
    }
    await doGenerate(prompt);
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
      await doGenerate('Generate a run based on this document.', {
        mimeType: file.type,
        data: base64Data
      });
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
      const runData = await res.json() as RunData;

      setLoadingMessage('Restoring Room 1 Graphics...');
      await preloadFirstCombatImages(runData);

      setLoadingMessage('Restoring Audio Magic...');
      await preloadRunAudio(runData);

      preloadBackgroundImages(runData);

      onGenerated(runData);
    } catch (err: any) {
      console.error(err);
      setError(err.message || 'Failed to load past run.');
      setIsGenerating(false);
    }
  };

  const doGenerate = async (finalPrompt: string, fileData?: { mimeType: string; data: string }) => {
    setIsGenerating(true);
    setLoadingMessage('Generating Run Data...');
    setError(null);
    if (!fileData) {
      setUploadedFileName(null);
    }

    try {
      const runData = await generateRunData(finalPrompt, fileData);

      setLoadingMessage('Preloading Room 1 Graphics...');
      await preloadFirstCombatImages(runData);

      setLoadingMessage('Synthesizing Audio Magic...');
      await preloadRunAudio(runData);

      preloadBackgroundImages(runData);

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
      <header className="w-full px-12 py-8 flex justify-between items-center z-10 relative">
        <div className="text-2xl font-bold tracking-widest uppercase">Famble</div>
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
            Upload a PDF or paste a URL — get a unique deckbuilder with custom cards, enemies, and music.
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
            <div className="absolute top-3 left-3 sm:top-4 sm:left-4 bg-black text-white rounded-full px-3 sm:px-4 py-1.5 text-[10px] font-bold tracking-wider">PDF</div>

            <div className="flex-1 flex flex-col items-center justify-center pt-8 sm:pt-10 px-4 sm:px-6 text-center">
              <FileUp className="w-10 h-10 sm:w-14 sm:h-14 text-white mb-3 sm:mb-5" />
              <h2 className="text-2xl sm:text-3xl font-serif text-white mb-1.5 sm:mb-2">Drop PDF Here</h2>
              <p className="text-slate-400 text-xs sm:text-sm italic">or click to browse</p>
            </div>

            <div className="bg-[#f97316] w-full py-1.5 sm:py-2 text-center text-black text-[10px] sm:text-[11px] font-bold tracking-widest uppercase">
              Max 50 pages
            </div>

            <div className="bg-slate-900/60 py-3.5 sm:py-5 px-4 text-center">
              <p className="text-[10px] sm:text-[11px] text-slate-300 opacity-60 font-mono tracking-wide">
                Every document hides<br />monsters inside.
              </p>
            </div>
            <input type="file" ref={fileInputRef} onChange={handleFileChange} accept="application/pdf,image/*" className="hidden" />
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
        {isGenerating && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center overflow-hidden bg-[#040a25]/90 backdrop-blur-sm text-white"
          >
            <div className="pointer-events-none absolute inset-0">
              <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,rgba(255,120,60,0.08)_0%,rgba(31,56,103,0.24)_36%,rgba(4,10,37,0.96)_84%)]" />
              <div className="absolute left-1/2 top-1/2 h-[720px] w-[720px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-[radial-gradient(circle,rgba(255,128,69,0.22)_0%,rgba(18,44,96,0.12)_46%,rgba(4,10,37,0)_72%)] blur-2xl" />
            </div>

            <div className="relative z-10 w-full max-w-[760px] px-6 sm:px-8">
              <div className="mx-auto max-w-[560px] text-center pb-5">
                {uploadedFileName && (
                  <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-[#4e6f97] bg-[#1b3256]/80 px-5 py-2.5 text-sm text-slate-100 shadow-[0_0_22px_rgba(42,77,123,0.5)]">
                    <FileText className="h-4 w-4 text-slate-200" />
                    <span className="max-w-[290px] truncate">{uploadedFileName}</span>
                    <Check className="h-4 w-4 text-emerald-300" />
                  </div>
                )}

                <div className="relative mx-auto mb-9 h-[280px] w-full max-w-[560px] sm:h-[320px]">
                  <motion.div
                    animate={{ rotate: 360 }}
                    transition={{ duration: 16, repeat: Infinity, ease: 'linear' }}
                    className="absolute left-1/2 top-1/2 h-[250px] w-[390px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-[radial-gradient(ellipse_at_center,rgba(255,128,65,0.42)_0%,rgba(247,101,54,0.18)_38%,rgba(247,101,54,0.04)_68%,rgba(0,0,0,0)_100%)] blur-[1.5px]"
                  />

                  <motion.div
                    animate={{ rotate: [0, 360] }}
                    transition={{ duration: 19, repeat: Infinity, ease: 'linear' }}
                    className="absolute inset-0"
                  >
                    {orbitingCards.map((card) => (
                      <motion.div
                        key={card.id}
                        style={{ left: card.x, top: card.y }}
                        animate={{
                          rotate: [card.rotate, card.rotate + 9, card.rotate - 4, card.rotate],
                          y: [0, -7, 0]
                        }}
                        transition={{
                          duration: 2.9,
                          repeat: Infinity,
                          ease: 'easeInOut',
                          delay: card.delay
                        }}
                        className="absolute h-24 w-16 rounded-md border-2 bg-[#1c2f4e] shadow-[0_8px_24px_rgba(0,0,0,0.4)]"
                      >
                        <div
                          className="absolute inset-0 rounded-md"
                          style={{ boxShadow: `0 0 18px ${card.glow}` }}
                        />
                        <div className="absolute inset-[7px] rounded-[3px] border border-[#6f8db0]/45">
                          <div className="absolute left-1/2 top-1/2 h-6 w-6 -translate-x-1/2 -translate-y-1/2 rotate-45 border border-[#6f8db0]/40" />
                        </div>
                        <div
                          className="absolute left-0 top-0 h-[4px] w-full rounded-t-md"
                          style={{ backgroundColor: card.border }}
                        />
                      </motion.div>
                    ))}
                  </motion.div>

                  <motion.div
                    animate={{ rotate: [0, -360] }}
                    transition={{ duration: 11, repeat: Infinity, ease: 'linear' }}
                    className="absolute left-1/2 top-1/2 h-[260px] w-[260px] -translate-x-1/2 -translate-y-1/2"
                  >
                    {swirlingDeckCards.map((card, index) => (
                      <motion.div
                        key={card.id}
                        animate={{
                          rotate: [card.baseAngle - 7, card.baseAngle + 9, card.baseAngle - 7],
                          y: [0, -4, 0],
                          scale: [1, 1.03, 1]
                        }}
                        transition={{
                          duration: 2.2,
                          repeat: Infinity,
                          ease: 'easeInOut',
                          delay: index * 0.08
                        }}
                        style={{ transformOrigin: '50% 86%', zIndex: 20 - index }}
                        className="absolute left-1/2 top-1/2 h-36 w-[95px] -translate-x-1/2 -translate-y-1/2 rounded-md border border-[#607895] bg-[#132640] shadow-[0_8px_20px_rgba(0,0,0,0.35)]"
                      >
                        <div className="absolute inset-[7px] rounded-[4px] border border-[#5f7794]/45">
                          <div className="absolute left-1/2 top-1/2 h-8 w-8 -translate-x-1/2 -translate-y-1/2 rotate-45 border border-[#5f7794]/38" />
                        </div>
                      </motion.div>
                    ))}
                  </motion.div>

                  <div className="absolute left-1/2 top-1/2 h-8 w-8 -translate-x-1/2 -translate-y-1/2 rounded-full bg-[#ff7f4f] shadow-[0_0_36px_rgba(255,127,79,0.85)]" />
                  <div className="absolute left-1/2 top-1/2 h-[300px] w-[300px] -translate-x-1/2 -translate-y-1/2 rounded-full border border-[#f48051]/20" />
                </div>

                <h2 className="text-4xl sm:text-6xl font-serif font-semibold tracking-tight text-slate-100 mb-2">
                  {loadingView.title}
                </h2>
                <p className="text-base sm:text-[38px] text-slate-400 mb-7">
                  {loadingView.subtitle}
                </p>

                <div className="mx-auto w-full">
                  <div className="relative h-7 rounded-full border border-[#2f5a86]/80 bg-[#1a3356]/60 px-1 py-1 shadow-[inset_0_2px_12px_rgba(0,0,0,0.45)]">
                    <motion.div
                      initial={{ width: '0%' }}
                      animate={{ width: `${loadingView.progress}%` }}
                      transition={{ duration: 0.8, ease: 'easeOut' }}
                      className="h-full rounded-full bg-gradient-to-r from-[#ff603b] via-[#ff7447] to-[#ff9d5f] shadow-[0_0_20px_rgba(255,115,67,0.45)]"
                    />
                  </div>
                  <div className="mt-1 text-right text-xl sm:text-[20px] font-medium text-slate-300/90">
                    {loadingView.progress}%
                  </div>
                </div>

                <div className="mt-5">
                  <div className="flex items-center justify-center gap-3 text-[#ff8252] text-2xl sm:text-[28px] leading-tight">
                    <Loader2 className="w-6 h-6 animate-spin" />
                    <span>{loadingView.stepLabel}</span>
                  </div>
                  <div className="mt-1 text-base sm:text-[20px] leading-tight text-slate-300/80">
                    {loadingView.step} of {loadingView.totalSteps} steps complete
                  </div>
                </div>

                <div className="mt-7 text-slate-300/80 text-2xl sm:text-[54px] leading-tight italic">
                  {loadingView.caption}
                </div>
                <div className="mt-3 text-slate-400/80 text-sm sm:text-[24px]">
                  {loadingView.finePrint}
                </div>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};
