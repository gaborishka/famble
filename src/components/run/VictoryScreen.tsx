import React from 'react';

export interface VictoryStats {
    floorsCleared: number;
    enemiesDefeated: number;
    bossDefeatedName: string;
    totalDamageDealt: number;
    cardsPlayed: number;
    turnsTaken: number;
    finalHp: number;
    maxHp: number;
    goldEarned: number;
    finalDeckCount: number;
    bossImageUrl: string;
    runTitle: string;
    runSubtitle: string;
}

interface VictoryScreenProps {
    stats: VictoryStats;
    onShare: () => void;
    onPlayAgain: () => void;
}

export const VictoryScreen: React.FC<VictoryScreenProps> = ({ stats, onShare, onPlayAgain }) => {
    return (
        <div className="w-full min-h-screen bg-[#0f172a] flex flex-col items-center justify-center font-serif text-white relative overflow-hidden z-[200]">
            {/* Background vignette / gradient */}
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,transparent_0%,#050811_100%)] pointer-events-none z-0" />

            {/* Atmospheric Particles Placeholder (Optional: Add real particles later) */}
            <div className="absolute inset-0 pointer-events-none z-0 overflow-hidden">
                {[...Array(30)].map((_, i) => (
                    <div
                        key={i}
                        className="absolute bg-amber-500/30 rounded-full"
                        style={{
                            width: Math.random() * 4 + 2 + 'px',
                            height: Math.random() * 4 + 2 + 'px',
                            top: Math.random() * 100 + '%',
                            left: Math.random() * 100 + '%',
                            animation: `float ${Math.random() * 5 + 5}s linear infinite`,
                            opacity: Math.random() * 0.5 + 0.1,
                        }}
                    />
                ))}
                <style dangerouslySetInnerHTML={{
                    __html: `
          @keyframes float {
            0% { transform: translateY(0) translateX(0); opacity: 0; }
            50% { opacity: 1; }
            100% { transform: translateY(-100vh) translateX(20px); opacity: 0; }
          }
        `}} />
            </div>

            <div className="z-10 text-center mb-6 relative px-12 top-[-2rem]">
                {/* Title */}
                <h1 className="text-5xl md:text-[4.5rem] font-bold tracking-widest text-amber-500 drop-shadow-[0_2px_10px_rgba(245,158,11,0.5)] mb-6 mt-4 font-serif">
                    VICTORY
                </h1>
                <div className="w-[80%] max-w-[500px] h-[1px] bg-slate-600/60 mx-auto mb-6" />

                {/* Run Details */}
                <h2 className="text-3xl font-bold text-slate-100 mb-2 tracking-wide font-sans">
                    {stats.runTitle}
                </h2>
                <p className="text-sm text-slate-400 font-sans tracking-wide">
                    Based on: {stats.runSubtitle}
                </p>
            </div>

            {/* Boss Portrait Background (with crack effect) */}
            <div className="absolute top-[30%] left-1/2 -translate-x-1/2 -translate-y-[20%] w-[400px] h-[400px] z-0 opacity-40 mix-blend-screen pointer-events-none flex justify-center items-center">
                <img src={stats.bossImageUrl} alt="Defeated Boss" className="max-w-full max-h-full object-contain filter grayscale-[30%] brightness-110 contrast-125" />
                {/* Simple CSS Crack overlay (optional styling) */}
                <div className="absolute inset-0 z-10" style={{
                    background: 'url("data:image/svg+xml,%3Csvg width=\'100%25\' height=\'100%25\' xmlns=\'http://www.w3.org/2000/svg\'%3E%3Cpath d=\'M10 50 L50 40 L80 90 L120 70 L200 150 M300 10 L250 80 L280 140 M150 200 L180 250 L120 300\' stroke=\'rgba(0,0,0,0.8)\' stroke-width=\'2\' fill=\'none\'/%3E%3C/svg%3E")'
                }} />
            </div>

            {/* Strikethrough Boss Name */}
            <div className="z-10 relative mb-8 text-center mt-[-1rem]">
                <span className="text-2xl md:text-3xl font-serif text-slate-400 relative inline-block">
                    {stats.bossDefeatedName}
                    <div className="absolute top-1/2 left-[-10%] right-[-10%] h-[2px] bg-red-500/80 -translate-y-1/2 rotate-[-1deg]" />
                </span>
            </div>

            {/* Stats Box */}
            <div className="z-10 w-full max-w-[500px] bg-slate-800/40 backdrop-blur-md border border-slate-600/50 rounded-xl p-6 mb-6 shadow-[0_8px_30px_rgba(0,0,0,0.4)] flex flex-col font-sans relative overflow-hidden">
                {/* Subtle inner highlight */}
                <div className="absolute inset-0 border border-white/5 rounded-xl pointer-events-none" />

                <h3 className="text-sm font-bold text-center text-slate-200 mb-4 tracking-wider uppercase">Run Statistics</h3>

                <div className="flex w-full">
                    <div className="w-1/2 pr-6 border-r border-slate-600/50 space-y-3">
                        <div className="flex justify-between items-center text-[13px] md:text-sm">
                            <span className="text-slate-400">Floors Cleared</span>
                            <span className="font-bold text-white">{stats.floorsCleared}</span>
                        </div>
                        <div className="flex justify-between items-center text-[13px] md:text-sm">
                            <span className="text-slate-400">Enemies Defeated</span>
                            <span className="font-bold text-white">{stats.enemiesDefeated}</span>
                        </div>
                        <div className="flex justify-between items-center text-[13px] md:text-sm">
                            <span className="text-slate-400">Boss Defeated</span>
                            <span className="font-bold text-[#f3683a] truncate max-w-[100px]" title={stats.bossDefeatedName}>{stats.bossDefeatedName}</span>
                        </div>
                        <div className="flex justify-between items-center text-[13px] md:text-sm">
                            <span className="text-slate-400">Total Damage Dealt</span>
                            <span className="font-bold text-red-400">{stats.totalDamageDealt}</span>
                        </div>
                    </div>
                    <div className="w-1/2 pl-6 space-y-3">
                        <div className="flex justify-between items-center text-[13px] md:text-sm">
                            <span className="text-slate-400">Cards Played</span>
                            <span className="font-bold text-white">{stats.cardsPlayed}</span>
                        </div>
                        <div className="flex justify-between items-center text-[13px] md:text-sm">
                            <span className="text-slate-400">Turns Taken</span>
                            <span className="font-bold text-white">{stats.turnsTaken}</span>
                        </div>
                        <div className="flex justify-between items-center text-[13px] md:text-sm">
                            <span className="text-slate-400">Final HP</span>
                            <span className="font-bold text-emerald-400">{stats.finalHp}<span className="text-slate-500 font-normal">/{stats.maxHp}</span></span>
                        </div>
                        <div className="flex justify-between items-center text-[13px] md:text-sm">
                            <span className="text-slate-400">Gold Earned</span>
                            <span className="font-bold text-amber-400">{stats.goldEarned}</span>
                        </div>
                    </div>
                </div>
            </div>

            {/* Final Deck Visualization */}
            <div className="z-10 flex flex-col items-center mb-8 gap-2">
                <div className="flex -space-x-3 mb-1">
                    {/* Decorative mini cards displaying deck composition roughly */}
                    <div className="w-8 h-12 bg-red-900/80 border border-red-500/50 rounded shadow-sm rotate-[-10deg] transform translate-y-1" />
                    <div className="w-8 h-12 bg-blue-900/80 border border-blue-500/50 rounded shadow-md z-10" />
                    <div className="w-8 h-12 bg-purple-900/80 border border-purple-500/50 rounded shadow-sm rotate-[10deg] transform translate-y-1" />
                </div>
                <span className="text-sm text-slate-400 font-sans tracking-wide">Final Deck: {stats.finalDeckCount} cards</span>
            </div>

            {/* Action Buttons */}
            <div className="z-10 flex gap-4 font-sans font-medium text-sm">
                <button
                    onClick={onShare}
                    className="flex items-center justify-center gap-2 px-6 py-2.5 min-w-[160px] bg-transparent border-2 border-orange-500/70 text-orange-400 rounded-lg hover:bg-orange-500/10 hover:border-orange-400 hover:text-orange-300 transition-all shadow-[0_0_15px_rgba(249,115,22,0.1)]"
                >
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-4 h-4">
                        <path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8" strokeLinecap="round" strokeLinejoin="round" />
                        <polyline points="16 6 12 2 8 6" strokeLinecap="round" strokeLinejoin="round" />
                        <line x1="12" y1="2" x2="12" y2="15" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                    Share This Run
                </button>

                <button
                    onClick={onPlayAgain}
                    className="flex items-center justify-center gap-2 px-8 py-2.5 min-w-[160px] bg-blue-500 hover:bg-blue-400 text-white rounded-lg shadow-[0_0_20px_rgba(59,130,246,0.3)] transition-all transform hover:-translate-y-0.5"
                >
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} className="w-4 h-4">
                        <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" strokeLinecap="round" strokeLinejoin="round" />
                        <path d="M3 3v5h5" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                    Play Again
                </button>
            </div>
        </div>
    );
};
