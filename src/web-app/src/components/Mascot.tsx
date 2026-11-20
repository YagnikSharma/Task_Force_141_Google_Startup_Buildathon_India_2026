import React, { useId } from 'react';

/** Jugnu, the NSIN mascot: a small firefly that lights the way home.
 *  One name constant so a rename is a one-line change. Pure SVG + CSS (no images, no extra requests). */
export const MASCOT_NAME = 'Jugnu';
export const MASCOT_TAGLINE = "Your neighbourhood's little light";

export type MascotMood = 'idle' | 'thinking' | 'happy' | 'alert';

const STYLE = `
@keyframes jg-bob { 0%,100% { transform: translateY(0) } 50% { transform: translateY(-4px) } }
@keyframes jg-glow { 0%,100% { opacity: .55; transform: scale(.92) } 50% { opacity: 1; transform: scale(1.08) } }
@keyframes jg-wing-l { 0%,100% { transform: rotate(-28deg) } 50% { transform: rotate(-12deg) } }
@keyframes jg-wing-r { 0%,100% { transform: rotate(28deg) } 50% { transform: rotate(12deg) } }
@keyframes jg-blink { 0%,92%,100% { transform: scaleY(1) } 95% { transform: scaleY(.1) } }
@keyframes jg-ping { 0% { opacity: .9; transform: scale(.6) } 100% { opacity: 0; transform: scale(1.6) } }
.jg-root { animation: jg-bob 3.2s ease-in-out infinite; transform-box: fill-box; }
.jg-glow { animation: jg-glow 2.4s ease-in-out infinite; transform-origin: 60px 88px; }
.jg-thinking .jg-glow { animation-duration: .9s; }
.jg-wing-l { animation: jg-wing-l .5s ease-in-out infinite; transform-origin: 50px 44px; }
.jg-wing-r { animation: jg-wing-r .5s ease-in-out infinite; transform-origin: 70px 44px; }
.jg-eyes { animation: jg-blink 4.5s infinite; transform-origin: 60px 54px; }
.jg-ping { animation: jg-ping 1.2s ease-out infinite; transform-origin: 60px 88px; }
@media (prefers-reduced-motion: reduce) {
  .jg-root, .jg-glow, .jg-wing-l, .jg-wing-r, .jg-eyes, .jg-ping { animation: none !important; }
}`;

export function Mascot({ mood = 'idle', className = 'w-12 h-12', title }: { mood?: MascotMood; className?: string; title?: string }) {
  const id = useId().replace(/:/g, '');
  const lookUp = mood === 'thinking' ? -2.5 : 0;
  const mouth = {
    idle: <path d="M53 66 Q60 71.5 67 66" fill="none" stroke="#202124" strokeWidth="2.4" strokeLinecap="round" />,
    happy: <path d="M51.5 64.5 Q60 75 68.5 64.5 Z" fill="#202124" />,
    thinking: <path d="M55 67.5 Q60 66 65 67.5" fill="none" stroke="#202124" strokeWidth="2.4" strokeLinecap="round" />,
    alert: <ellipse cx="60" cy="67" rx="3.2" ry="3.8" fill="#202124" />,
  }[mood];
  const glow = mood === 'alert' ? '#ea4335' : '#fbbc04';

  return (
    <svg viewBox="0 0 120 120" className={`${className} jg-${mood}`} role={title ? 'img' : undefined}
      aria-hidden={title ? undefined : true} aria-label={title}>
      <style>{STYLE}</style>
      <defs>
        <radialGradient id={`h${id}`}>
          <stop offset="0" stopColor={glow} stopOpacity=".75" />
          <stop offset="1" stopColor={glow} stopOpacity="0" />
        </radialGradient>
        <linearGradient id={`t${id}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#fff3b0" />
          <stop offset="1" stopColor={glow} />
        </linearGradient>
        <linearGradient id={`b${id}`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#5e97f6" />
          <stop offset="1" stopColor="#1a73e8" />
        </linearGradient>
      </defs>
      <g className="jg-root">
        <circle className="jg-glow" cx="60" cy="88" r="32" fill={`url(#h${id})`} />
        {mood === 'alert' && <circle className="jg-ping" cx="60" cy="88" r="26" fill="none" stroke="#ea4335" strokeWidth="2" />}
        <ellipse className="jg-wing-l" cx="36" cy="38" rx="15" ry="22" fill="#d2e3fc" fillOpacity=".85" stroke="#a8c7fa" strokeWidth="1.5" />
        <ellipse className="jg-wing-r" cx="84" cy="38" rx="15" ry="22" fill="#d2e3fc" fillOpacity=".85" stroke="#a8c7fa" strokeWidth="1.5" />
        <ellipse cx="60" cy="87" rx="19" ry="17" fill={`url(#t${id})`} />
        <path d="M44 84 Q60 90 76 84" fill="none" stroke="#e8a600" strokeOpacity=".45" strokeWidth="2" strokeLinecap="round" />
        <path d="M53 33 Q49 22 43 17" fill="none" stroke="#174ea6" strokeWidth="2.6" strokeLinecap="round" />
        <path d="M67 33 Q71 22 77 17" fill="none" stroke="#174ea6" strokeWidth="2.6" strokeLinecap="round" />
        <circle cx="42.5" cy="16" r="4.6" fill="#ea4335" />
        <circle cx="77.5" cy="16" r="4.6" fill="#34a853" />
        <circle cx="60" cy="56" r="26" fill={`url(#b${id})`} />
        <ellipse cx="60" cy="61" rx="18" ry="14" fill="#e8f0fe" />
        <g className="jg-eyes">
          <ellipse cx="51" cy="54" rx="6.4" ry="7.4" fill="#fff" />
          <ellipse cx="69" cy="54" rx="6.4" ry="7.4" fill="#fff" />
          <circle cx="51.5" cy={55 + lookUp} r="3.9" fill="#202124" />
          <circle cx="69.5" cy={55 + lookUp} r="3.9" fill="#202124" />
          <circle cx="52.8" cy={53.4 + lookUp} r="1.4" fill="#fff" />
          <circle cx="70.8" cy={53.4 + lookUp} r="1.4" fill="#fff" />
        </g>
        <circle cx="44" cy="64" r="3.6" fill="#ea4335" fillOpacity=".3" />
        <circle cx="76" cy="64" r="3.6" fill="#ea4335" fillOpacity=".3" />
        {mouth}
      </g>
    </svg>
  );
}

export default Mascot;

/** A speech bubble from Jugnu, for empty states and page guides. */
export function MascotTip({ children, mood = 'idle', className = '' }: { children: React.ReactNode; mood?: MascotMood; className?: string }) {
  return (
    <div className={`flex items-start gap-3 ${className}`}>
      <Mascot mood={mood} className="h-14 w-14 shrink-0" />
      <div className="relative rounded-2xl rounded-tl-sm border border-blue-100 bg-blue-50 px-3.5 py-2.5 text-sm text-slate-700">
        <p className="mb-0.5 text-xs font-bold text-blue-700">{MASCOT_NAME}</p>
        {children}
      </div>
    </div>
  );
}
