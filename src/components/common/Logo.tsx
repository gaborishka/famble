import React from 'react';

export const Logo: React.FC<{ className?: string }> = ({ className = '' }) => {
    return (
        <div className={`flex flex-col items-center justify-center ${className}`}>
            {/* SVG Icon part */}
            <svg
                viewBox="0 0 320 120"
                className="w-full h-auto max-w-[280px] drop-shadow-lg"
                xmlns="http://www.w3.org/2000/svg"
            >
                <defs>
                    <linearGradient id="magicGradient" x1="0%" y1="0%" x2="100%" y2="100%">
                        <stop offset="0%" stopColor="#a46bb5" />
                        <stop offset="100%" stopColor="#818cf8" />
                    </linearGradient>
                    <linearGradient id="streamGradient" x1="0%" y1="0%" x2="100%" y2="0%">
                        <stop offset="0%" stopColor="#5c8fca" stopOpacity="0.2" />
                        <stop offset="100%" stopColor="#5c8fca" />
                    </linearGradient>
                    <filter id="glow" x="-20%" y="-20%" width="140%" height="140%">
                        <feGaussianBlur stdDeviation="3" result="blur" />
                        <feComposite in="SourceGraphic" in2="blur" operator="over" />
                    </filter>
                </defs>

                {/* Data Stream (Left Side) */}
                <g stroke="#5c8fca" strokeWidth="3" strokeLinecap="round" opacity="0.8">
                    {/* Top stream lines */}
                    <line x1="20" y1="35" x2="60" y2="35" />
                    <line x1="75" y1="35" x2="120" y2="35" />
                    <path d="M 120 35 Q 150 35 165 45 T 190 45" fill="none" stroke="url(#streamGradient)" />

                    {/* Middle stream lines */}
                    <line x1="40" y1="55" x2="90" y2="55" />
                    <line x1="105" y1="55" x2="130" y2="55" />
                    <path d="M 130 55 Q 160 55 175 60 T 195 60" fill="none" stroke="url(#streamGradient)" />

                    {/* Bottom stream lines */}
                    <line x1="30" y1="75" x2="50" y2="75" />
                    <line x1="65" y1="75" x2="110" y2="75" />
                    <path d="M 110 75 Q 140 75 160 70 T 185 70" fill="none" stroke="url(#streamGradient)" />
                </g>

                {/* Floating Data Nodes / Files */}
                <g fill="#8fa0c0">
                    <rect x="50" y="20" width="12" height="15" rx="2" />
                    <rect x="90" y="70" width="16" height="20" rx="2" />
                    <rect x="130" y="30" width="14" height="18" rx="2" />
                    <circle cx="80" cy="45" r="3" fill="#d16147" />
                    <circle cx="120" cy="65" r="4" fill="#a46bb5" />
                    <circle cx="150" cy="80" r="3" fill="#5c8fca" />
                </g>

                {/* Cards (Right Side) */}
                <g transform="translate(180, 20)">
                    {/* Card 1: Sword (Left, rotated back) */}
                    <g transform="translate(0, 15) rotate(-15)" filter="url(#glow)">
                        <rect x="0" y="0" width="35" height="50" rx="4" fill="#1e293b" stroke="#d16147" strokeWidth="2.5" />
                        <path d="M 17 10 L 17 35 M 10 30 L 24 30 M 17 10 L 14 15 M 17 10 L 20 15" stroke="#d16147" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" fill="none" />
                    </g>

                    {/* Card 3: Magic (Right, rotated forward) */}
                    <g transform="translate(60, 10) rotate(15)" filter="url(#glow)">
                        <rect x="0" y="0" width="35" height="50" rx="4" fill="#1e293b" stroke="#a46bb5" strokeWidth="2.5" />
                        <path d="M 17 15 L 20 22 L 27 25 L 20 28 L 17 35 L 14 28 L 7 25 L 14 22 Z" fill="#a46bb5" />
                    </g>

                    {/* Card 2: Shield (Center, straight up) */}
                    <g transform="translate(30, 0)" filter="url(#glow)">
                        <rect x="0" y="0" width="40" height="56" rx="4" fill="#1e293b" stroke="#5c8fca" strokeWidth="3" />
                        <path d="M 10 15 L 30 15 L 30 25 C 30 35 20 42 20 42 C 20 42 10 35 10 25 Z" fill="none" stroke="#5c8fca" strokeWidth="2" strokeLinejoin="round" />
                        <circle cx="20" cy="25" r="4" fill="#5c8fca" />
                    </g>
                </g>
            </svg>

            {/* Typography part */}
            <div
                className="text-4xl sm:text-5xl font-bold tracking-[0.08em] uppercase mt-2 sm:mt-1"
                style={{ fontFamily: "'Oswald', sans-serif" }}
            >
                F<span className="text-[#5c8fca]">A</span>MBL<span className="text-[#a46bb5] drop-shadow-[0_0_12px_rgba(164,107,181,0.9)] relative">
                    E
                    {/* Extra magic spark on the E */}
                    <span className="absolute -top-1 -right-2 w-2 h-2 rounded-full bg-white blur-[1px] shadow-[0_0_10px_#a46bb5]"></span>
                </span>
            </div>
        </div>
    );
};
