import React, { useState, useRef } from 'react';
import { RunData } from '../../../shared/types/game';
import { generateRunData, preloadFirstCombatImages, preloadBackgroundImages } from '../../services/geminiService';
import { motion, AnimatePresence } from 'motion/react';
import { FileUp, Globe, ArrowRight, Loader2, Sparkles } from 'lucide-react';

interface GeneratorProps {
  onGenerated: (data: RunData) => void;
}

export const Generator: React.FC<GeneratorProps> = ({ onGenerated }) => {
  const [prompt, setPrompt] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [loadingMessage, setLoadingMessage] = useState('Generating Run...');
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

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

  const doGenerate = async (finalPrompt: string, fileData?: { mimeType: string; data: string }) => {
    setIsGenerating(true);
    setLoadingMessage('Generating Run Data...');
    setError(null);

    try {
      const runData = await generateRunData(finalPrompt, fileData);

      setLoadingMessage('Preloading Room 1 Graphics...');
      await preloadFirstCombatImages(runData);

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
        <div className="relative w-full max-w-md h-[450px] mx-auto mt-4 perspective-[1000px]">

          {/* PDF Card (Back) */}
          <motion.div
            initial={{ rotate: 5, x: 15, y: 15 }}
            whileHover={{ scale: 1.05, rotate: 10, x: 40, y: 20, zIndex: 30 }}
            className="absolute top-1/2 left-1/2 -ml-36 -mt-[190px] z-10 bg-[#2d3748] border-2 border-[#ef4444] rounded-2xl w-72 h-[380px] flex flex-col shadow-2xl shadow-black/50 overflow-hidden cursor-pointer"
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              if (e.dataTransfer.files && e.dataTransfer.files[0]) {
                processFile(e.dataTransfer.files[0]);
              }
            }}
            onClick={() => fileInputRef.current?.click()}
          >
            <div className="absolute top-4 left-4 bg-black text-white rounded-full px-4 py-1.5 text-[10px] font-bold tracking-wider">PDF</div>

            <div className="flex-1 flex flex-col items-center justify-center pt-10 px-6 text-center">
              <FileUp className="w-14 h-14 text-white mb-5" />
              <h2 className="text-3xl font-serif text-white mb-2">Drop PDF Here</h2>
              <p className="text-slate-400 text-sm italic">or click to browse</p>
            </div>

            <div className="bg-[#f97316] w-full py-2 text-center text-black text-[11px] font-bold tracking-widest uppercase">
              Max 50 pages
            </div>

            <div className="bg-slate-900/60 py-5 px-4 text-center">
              <p className="text-[11px] text-slate-300 opacity-60 font-mono tracking-wide">
                Every document hides<br />monsters inside.
              </p>
            </div>
            <input type="file" ref={fileInputRef} onChange={handleFileChange} accept="application/pdf,image/*" className="hidden" />
          </motion.div>

          {/* URL Card (Front) */}
          <motion.div
            initial={{ rotate: -3, x: -10, y: -10 }}
            whileHover={{ scale: 1.05, rotate: -6, x: -40, y: -20, zIndex: 30 }}
            className="absolute top-1/2 left-1/2 -ml-36 -mt-[190px] z-20 bg-[#2d3748] border-2 border-[#a855f7] rounded-2xl w-72 h-[380px] flex flex-col shadow-2xl shadow-black/50 overflow-hidden"
          >
            <div className="absolute top-4 left-4 bg-black text-white rounded-full px-4 py-1.5 text-[10px] font-bold tracking-wider">URL</div>

            <div className="flex-1 flex flex-col items-center justify-center pt-12 px-6 text-center">
              <Globe className="w-14 h-14 text-white mb-5" />
              <h2 className="text-3xl font-serif text-white mb-5">Paste Any Link</h2>

              <div className="w-full relative flex items-center mb-4">
                <input
                  type="text"
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleGenerateText()}
                  placeholder="https://"
                  className="w-full bg-[#1e293b] border-none rounded-lg py-3 pl-4 pr-12 text-sm text-white placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-purple-500"
                />
                <button
                  onClick={handleGenerateText}
                  disabled={isGenerating}
                  className="absolute right-1.5 top-1/2 -translate-y-1/2 bg-[#f97316] hover:bg-[#ea580c] text-black rounded px-2 py-1 transition-colors"
                >
                  <ArrowRight className="w-5 h-5" />
                </button>
              </div>
              <p className="text-[11px] text-slate-400 font-medium">Articles, blogs, Wikipedia, docs</p>
            </div>

            <div className="relative pt-4 pb-5 px-4 text-center">
              <div className="absolute top-0 left-0 w-full flex items-center justify-center">
                <div className="w-full h-[1px] bg-purple-500/30"></div>
                <div className="absolute bg-[#2d3748] px-3 text-purple-400 opacity-60">
                  <Globe className="w-4 h-4" />
                </div>
              </div>
              <p className="mt-4 text-[11px] text-slate-300 opacity-60 font-mono tracking-wide">
                The web is full of<br />monsters.
              </p>
            </div>
          </motion.div>

        </div>
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
            className="fixed inset-0 bg-slate-950/80 backdrop-blur-md z-50 flex flex-col items-center justify-center text-white"
          >
            <Loader2 className="w-16 h-16 animate-spin text-purple-500 mb-6" />
            <h2 className="text-3xl font-bold mb-3">{loadingMessage}</h2>
            <p className="text-slate-400">Summoning your custom adventure...</p>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};
