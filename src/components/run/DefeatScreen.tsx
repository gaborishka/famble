import React from 'react';

export interface DefeatStats {
  floorsCleared: number;
  cardsPlayed: number;
  enemiesDefeated: number;
  turnsSurvived: number;
  damageDealt: number;
  finalDeckCount: number;
  killerName: string;
}

interface DefeatScreenProps {
  stats: DefeatStats;
  onRetry: () => void;
  onNewRun: () => void;
}

export const DefeatScreen: React.FC<DefeatScreenProps> = ({ stats, onRetry, onNewRun }) => {
  return (
    <div className="w-full min-h-screen bg-[#0b101a] flex flex-col items-center justify-center font-serif text-white relative overflow-hidden z-[200]">
      {/* Background vignette / gradient */}
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,transparent_0%,#050811_100%)] pointer-events-none z-0" />

      {/* Title */}
      <div className="z-10 text-center mb-8 relative px-12">
        <h1 className="text-6xl md:text-[5rem] font-bold tracking-wider text-[#d33a3a] drop-shadow-[-2px_4px_10px_rgba(0,0,0,0.8)] mb-2 mt-4" style={{ WebkitTextStroke: '2px #4a1d1d' }}>
          DEFEATED
        </h1>
        <div className="w-full h-[1px] bg-slate-500/60 mx-auto" />
      </div>

      {/* Broken Cards Graphic Placeholder */}
      <div className="relative w-[500px] h-[180px] mb-6 flex justify-center items-center z-10 perspective-[1000px]">
        {/* We can construct a pile of css cards */}
        <div className="absolute w-28 h-40 bg-[#1e293b] border-2 border-slate-600 rounded-lg transform -translate-x-44 rotate-[-25deg] shadow-xl flex flex-col pointer-events-none opacity-80 z-0">
          {/* Card Back */}
          <div className="absolute inset-[4px] border border-slate-700/50 rounded flex items-center justify-center">
            <div className="w-16 h-24 border-2 border-slate-700/50 rotate-45 flex items-center justify-center">
              <div className="w-8 h-12 border border-slate-600/50" />
            </div>
          </div>
        </div>

        <div className="absolute w-28 h-40 bg-[#1a4c6a] border border-slate-500 rounded-lg transform -translate-x-[110px] rotate-[-15deg] shadow-xl flex flex-col pointer-events-none opacity-90 z-10">
          <div className="h-6 bg-slate-200/90 text-center text-[10px] font-bold text-slate-900 border-b-2 border-[#153a51] rounded-t-lg flex items-center justify-center -rotate-1 skew-x-[10deg] w-[90%] mx-auto mt-1 shadow-sm">Defense</div>
          <div className="flex-1 border-4 border-[#153a51]/30 m-1 rounded bg-[#1e587a]" />
        </div>

        <div className="absolute w-28 h-40 bg-[#6a1a1a] border border-slate-500 rounded-lg transform -translate-x-12 rotate-[-5deg] shadow-xl flex flex-col pointer-events-none z-20">
          <div className="h-6 bg-slate-200/90 text-center text-[10px] font-bold text-slate-900 border-b-2 border-[#511515] rounded-t-lg flex items-center justify-center rotate-1 skew-x-[-5deg] w-[90%] mx-auto mt-1 shadow-sm">Attack</div>
          <div className="flex-1 border-4 border-[#511515]/30 m-1 rounded bg-[#7a1e1e]" />
        </div>

        {/* Center broken card */}
        <div className="absolute w-[115px] h-44 bg-[#3d4554] border-2 border-slate-400 rounded-lg transform z-30 shadow-2xl flex flex-col pointer-events-none scale-105">
          <div className="absolute inset-0 overflow-hidden rounded-lg pointer-events-none z-50">
            {/* Crack lines */}
            <div className="absolute top-[30%] left-0 w-full h-[2px] bg-black/60 rotate-[-15deg]" />
            <div className="absolute top-[35%] left-[20%] w-1/2 h-[2px] bg-black/60 rotate-[45deg]" />
            <div className="absolute top-[60%] left-[40%] w-full h-[2px] bg-black/60 rotate-[-45deg]" />
            <div className="absolute top-[65%] left-0 w-1/2 h-[2px] bg-black/60 rotate-[15deg]" />
            <div className="absolute top-[40%] left-[50%] w-[2px] h-1/2 bg-black/60 rotate-[10deg]" />
          </div>
          <div className="h-[2px] bg-black/40 rotate-[-15deg] absolute top-[30%] left-0 right-0 z-40" />
          <div className="h-6 bg-slate-200 text-center text-[11px] font-bold text-slate-800 border-b-2 border-slate-500 rounded-t-lg flex items-center justify-center rotate-[-2deg] skew-x-[5deg] w-[85%] mx-auto mt-1 drop-shadow opacity-60">Attack</div>
          <div className="flex-1 border-4 border-slate-600/50 m-1 rounded bg-[#4b5563] relative flex items-center justify-center opacity-80" />
        </div>

        <div className="absolute w-28 h-40 bg-[#1a4c6a] border border-slate-500 rounded-lg transform translate-x-16 rotate-[8deg] shadow-xl flex flex-col pointer-events-none z-20 opacity-95">
          <div className="h-6 bg-slate-200/90 text-center text-[10px] font-bold text-slate-900 border-b-2 border-[#153a51] rounded-t-lg flex items-center justify-center -rotate-2 skew-x-[8deg] w-[90%] mx-auto mt-1 shadow-sm">Skill</div>
          <div className="flex-1 border-4 border-[#153a51]/30 m-1 rounded bg-[#1e587a]" />
        </div>

        <div className="absolute w-28 h-40 bg-[#4e226e] border border-slate-500 rounded-lg transform translate-x-[105px] rotate-[20deg] shadow-xl flex flex-col pointer-events-none z-10 opacity-90">
          <div className="h-6 bg-slate-200/90 text-center text-[10px] font-bold text-slate-900 border-b-2 border-[#37184e] rounded-t-lg flex items-center justify-center rotate-2 skew-x-[-10deg] w-[90%] mx-auto mt-1 shadow-sm">Skill</div>
          <div className="flex-1 border-4 border-[#37184e]/30 m-1 rounded bg-[#5d288a]" />
        </div>

        <div className="absolute w-28 h-40 bg-[#1e293b] border-2 border-slate-600 rounded-lg transform translate-x-44 rotate-[30deg] shadow-xl flex flex-col pointer-events-none opacity-80 z-0">
          {/* Card Back */}
          <div className="absolute inset-[4px] border border-slate-700/50 rounded flex items-center justify-center">
            <div className="w-16 h-24 border-2 border-slate-700/50 rotate-45 flex items-center justify-center">
              <div className="w-8 h-12 border border-slate-600/50" />
            </div>
          </div>
        </div>
      </div>

      {/* Subtitles */}
      <div className="z-10 text-center mb-6">
        <h2 className="text-3xl font-bold text-slate-100 mb-1 tracking-wide" style={{ textShadow: '0 2px 4px rgba(0,0,0,0.8)' }}>
          Fallen on Floor {stats.floorsCleared + 1}
        </h2>
        <p className="text-base text-slate-400 font-sans tracking-wide">
          Slain by {stats.killerName}
        </p>
      </div>

      {/* Stats Box */}
      <div className="z-10 w-full max-w-[460px] bg-[#1a233a]/80 backdrop-blur-sm border border-slate-500/40 rounded-xl p-6 mb-8 shadow-[0_8px_30px_rgba(0,0,0,0.5)] flex font-sans">
        <div className="w-1/2 pr-5 border-r border-slate-600/50 space-y-4">
          <div className="flex justify-between items-center text-[13px] md:text-sm">
            <span className="text-slate-400">Floors Cleared <span className="text-slate-500 ml-1">—</span></span>
            <span className="font-bold text-white">{stats.floorsCleared}</span>
          </div>
          <div className="flex justify-between items-center text-[13px] md:text-sm">
            <span className="text-slate-400">Enemies Defeated <span className="text-slate-500 ml-1">—</span></span>
            <span className="font-bold text-white">{stats.enemiesDefeated}</span>
          </div>
          <div className="flex justify-between items-center text-[13px] md:text-sm">
            <span className="text-slate-400">Damage Dealt <span className="text-slate-500 ml-1">—</span></span>
            <span className="font-bold text-[#f87171]">{stats.damageDealt}</span>
          </div>
        </div>
        <div className="w-1/2 pl-5 space-y-4">
          <div className="flex justify-between items-center text-[13px] md:text-sm">
            <span className="text-slate-400">Cards Played <span className="text-slate-500 ml-1">—</span></span>
            <span className="font-bold text-white">{stats.cardsPlayed}</span>
          </div>
          <div className="flex justify-between items-center text-[13px] md:text-sm">
            <span className="text-slate-400">Turns Survived <span className="text-slate-500 ml-1">—</span></span>
            <span className="font-bold text-white">{stats.turnsSurvived}</span>
          </div>
          <div className="flex justify-between items-center text-[13px] md:text-sm">
            <span className="text-slate-400">Final Deck <span className="text-slate-500 ml-1">—</span></span>
            <span className="font-bold text-white">{stats.finalDeckCount} <span className="text-slate-400 font-normal ml-0.5">cards</span></span>
          </div>
        </div>
      </div>

      {/* Flavor text */}
      <div className="z-10 mb-8 italic text-slate-400/80 font-serif tracking-wide">
        Every defeat seasons the next victory.
      </div>

      {/* Action Buttons */}
      <div className="z-10 flex gap-4 font-sans font-bold text-sm tracking-wide">
        <button
          onClick={onRetry}
          className="flex items-center gap-2 px-6 py-3 bg-[#f3683a] hover:bg-[#e45b30] text-[rgba(255,255,255,0.95)] rounded-lg shadow-lg border border-[#ff8b65]/20 transition-all hover:-translate-y-0.5"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} className="w-5 h-5">
            <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" strokeLinecap="round" strokeLinejoin="round" />
            <path d="M3 3v5h5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          Try Again
        </button>

        <button
          onClick={onNewRun}
          className="flex items-center gap-2 px-6 py-3 bg-[#111827] hover:bg-[#1f2937] text-white rounded-lg shadow-lg border border-slate-600/50 transition-all hover:-translate-y-0.5"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} className="w-5 h-5">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" strokeLinecap="round" strokeLinejoin="round" />
            <path d="M17 8l-5-5-5 5" strokeLinecap="round" strokeLinejoin="round" />
            <path d="M12 3v12" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          New PDF
        </button>
      </div>
    </div>
  );
};
