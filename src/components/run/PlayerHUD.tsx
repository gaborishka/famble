import React from 'react';

interface PlayerHUDProps {
  playerHp: number;
  playerMaxHp: number;
  gold: number;
  currentFloor: number;
  totalFloors: number;
}

export const PlayerHUD: React.FC<PlayerHUDProps> = ({
  playerHp,
  playerMaxHp,
  gold,
  currentFloor,
  totalFloors,
}) => {
  const hpPercent = Math.round((playerHp / playerMaxHp) * 100);

  return (
    <div className="w-full flex items-center justify-between px-4 sm:px-8 py-3 shrink-0">
      {/* Left: Avatar + HP */}
      <div className="flex items-center gap-3">
        {/* Avatar */}
        <div className="w-10 h-10 rounded-full bg-slate-800 border-2 border-slate-600 flex items-center justify-center overflow-hidden shrink-0">
          <svg viewBox="0 0 24 24" fill="currentColor" className="w-7 h-7 text-slate-400">
            <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 3c1.66 0 3 1.34 3 3s-1.34 3-3 3-3-1.34-3-3 1.34-3 3-3zm0 14.2c-2.5 0-4.71-1.28-6-3.22.03-1.99 4-3.08 6-3.08 1.99 0 5.97 1.09 6 3.08-1.29 1.94-3.5 3.22-6 3.22z"/>
          </svg>
        </div>
        {/* HP Bar */}
        <div className="flex items-center gap-2">
          <div className="bg-emerald-800/60 rounded-md px-2.5 py-0.5 border border-emerald-600/40">
            <span className="text-xs font-bold text-emerald-300">HP</span>
          </div>
          <span className="text-sm font-bold text-white tabular-nums">{playerHp}/{playerMaxHp}</span>
          <div className="w-32 h-3 bg-slate-800 rounded-full overflow-hidden border border-slate-700/50">
            <div
              className="h-full bg-gradient-to-r from-emerald-600 to-emerald-400 rounded-full transition-all duration-500"
              style={{ width: `${hpPercent}%` }}
            />
          </div>
        </div>
      </div>

      {/* Center: Floor */}
      <span className="text-lg font-bold text-slate-300 tracking-wide">
        Floor {currentFloor}/{totalFloors}
      </span>

      {/* Right: Gold */}
      <div className="flex items-center gap-1.5">
        <div className="w-7 h-7 rounded-full bg-gradient-to-br from-amber-300 to-amber-500 flex items-center justify-center border-2 border-amber-600 shadow-lg shadow-amber-500/20">
          <span className="text-[11px] font-black text-amber-900">C</span>
        </div>
        <span className="text-lg font-bold text-white tabular-nums">{gold}</span>
      </div>
    </div>
  );
};
