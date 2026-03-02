import React, { useState, useEffect } from 'react';
import { RunData, isRunDataV2 } from '../../../shared/types/game';
import {
  repairRunDataCardMediaRefs,
  setCurrentRunId,
} from '../../services/geminiService';
import { motion } from 'motion/react';
import { ArrowRight, Swords, Loader2 } from 'lucide-react';
import { Logo } from '../common/Logo';

interface DemoRunPickerProps {
  onGenerated: (data: RunData) => void;
}

interface DemoRunEntry {
  runId: string;
  theme: string;
  rooms: number;
  timestamp: number;
}

const prepareRunForReplay = (runData: RunData): RunData => {
  if (isRunDataV2(runData)) {
    return {
      ...runData,
      node_map: runData.node_map.map(node => ({ ...node, completed: false })),
    };
  }
  if (!runData.node_map) return runData;
  return {
    ...runData,
    node_map: runData.node_map.map(node => ({ ...node, completed: false })),
  };
};

export function DemoRunPicker({ onGenerated }: DemoRunPickerProps) {
  const [runs, setRuns] = useState<DemoRunEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingRunId, setLoadingRunId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch('/demo-runs.json')
      .then(res => {
        if (!res.ok) throw new Error('Failed to load demo runs manifest');
        return res.json();
      })
      .then((data: { runs: DemoRunEntry[] }) => setRuns(data.runs))
      .catch(err => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  const loadRun = async (runId: string) => {
    setLoadingRunId(runId);
    setError(null);
    try {
      setCurrentRunId(runId);
      const res = await fetch(`/runs/${runId}/run-data-demo.json`);
      if (!res.ok) throw new Error('Failed to load run data');
      const loadedRunData = await res.json() as RunData;
      const runData = repairRunDataCardMediaRefs(prepareRunForReplay(loadedRunData));

      if (isRunDataV2(runData)) {
        runData.generationSettings = runData.generationSettings || { mode: 'fast_start', prefetchDepth: 2 };
        runData.objectManifest = runData.objectManifest || {};
        runData.rooms = runData.rooms || {};
      }

      onGenerated(runData);
    } catch (err: any) {
      console.error(err);
      setError(err.message || 'Failed to load run.');
      setLoadingRunId(null);
    }
  };

  return (
    <div className="min-h-screen bg-[#141b2e] flex flex-col relative overflow-hidden text-white font-sans">
      {/* Background Texture */}
      <div
        className="absolute inset-0 z-0 pointer-events-none opacity-[0.15] mix-blend-overlay"
        style={{
          backgroundImage: 'url("data:image/svg+xml,%3Csvg viewBox=%220 0 200 200%22 xmlns=%22http://www.w3.org/2000/svg%22%3E%3Cfilter id=%22noiseFilter%22%3E%3CfeTurbulence type=%22fractalNoise%22 baseFrequency=%220.85%22 numOctaves=%223%22 stitchTiles=%22stitch%22/%3E%3C/filter%3E%3Crect width=%22100%25%22 height=%22100%25%22 filter=%22url(%23noiseFilter)%22/%3E%3C/svg%3E")'
        }}
      />

      {/* Header */}
      <header className="w-full px-12 py-8 flex justify-between items-start z-10 relative">
        <Logo className="w-48 sm:w-64" />
        <div className="text-sm text-slate-500 tracking-wide">Demo Mode</div>
      </header>

      {/* Main Content */}
      <main className="flex-1 w-full flex flex-col items-center justify-center z-10 -mt-16 px-4">
        <div className="text-center mb-12 space-y-4 max-w-2xl">
          <h1 className="text-4xl md:text-5xl font-bold tracking-tight">Choose Your Adventure</h1>
          <p className="text-slate-400 text-base md:text-lg px-8">
            Each run was generated from a unique source — pick one and play through a full roguelike deckbuilder.
          </p>
        </div>

        {error && (
          <div className="bg-red-500/10 border border-red-500/50 text-red-400 px-6 py-3 rounded-xl mb-8 max-w-md text-center">
            {error}
          </div>
        )}

        {loading ? (
          <Loader2 className="w-8 h-8 text-slate-500 animate-spin" />
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 max-w-4xl w-full">
            {runs.map((run, i) => (
              <motion.button
                key={run.runId}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.1 }}
                onClick={() => loadRun(run.runId)}
                disabled={!!loadingRunId}
                className="bg-[#1e293b] hover:bg-[#2d3748] border border-slate-700 hover:border-purple-500/50 rounded-2xl p-6 text-left transition-all duration-200 group relative overflow-hidden disabled:opacity-60"
              >
                <div className="flex items-center gap-3 mb-3">
                  <Swords className="w-5 h-5 text-purple-400" />
                  <span className="text-xs text-slate-500 font-mono">{run.rooms} rooms</span>
                </div>
                <h3 className="text-lg font-bold text-white mb-4 leading-tight">{run.theme}</h3>
                <div className="flex items-center justify-between">
                  <span className="text-xs text-slate-500">
                    {loadingRunId === run.runId ? 'Loading...' : 'Play run'}
                  </span>
                  {loadingRunId === run.runId ? (
                    <Loader2 className="w-5 h-5 text-purple-400 animate-spin" />
                  ) : (
                    <ArrowRight className="w-5 h-5 text-slate-600 group-hover:text-purple-400 transform group-hover:translate-x-1 transition-all" />
                  )}
                </div>
              </motion.button>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
