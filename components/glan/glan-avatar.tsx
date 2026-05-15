'use client'

// ============================================================
// GlanAvatar — Avatar personnage SVG animé de Glan (artisan-glaneur)
//
// Personnage anime moderne (pas une boule) : tête ronde + cheveux + yeux
// expressifs + accent doré. 4 états sémantiques :
//   - dormant : yeux fermés, respiration lente
//   - working : yeux ouverts, scan-line cyan, pulse halo
//   - done    : sourire + sparkles dorés, glow gold pulse
//   - error   : sourcils froncés + glow rouge atténué
//
// SVG inline + animations CSS (keyframes dans app/globals.css).
// Respect strict prefers-reduced-motion (animations stoppées globalement).
//
// Asset Rive vrai personnage à venir → swap dans <MascotAvatar> à l'arrivée
// (cf components/glan/mascot-avatar.tsx + memory/project_pivot_glan.md LOT 5).
// ============================================================

import { m } from 'motion/react'

export type GlanState = 'dormant' | 'working' | 'done' | 'error'
export type GlanSize = 'sm' | 'md' | 'lg'

interface GlanAvatarProps {
  state?: GlanState
  size?: GlanSize
  label?: string
  className?: string
}

const SIZE_PX: Record<GlanSize, number> = {
  sm: 32,
  md: 64,
  lg: 128,
}

const STATE_DEFAULT_LABEL: Record<GlanState, string> = {
  dormant: 'Glan au repos',
  working: 'Glan travaille',
  done: 'Glan a terminé',
  error: 'Glan a rencontré une erreur',
}

const STATE_PALETTE: Record<
  GlanState,
  { skin: string; hair: string; bg: string; glow: string; accent: string; eye: string }
> = {
  dormant: {
    skin: '#e8d4b8',
    hair: '#5b6478',
    bg: 'oklch(28% 0.04 240)',
    glow: 'oklch(70% 0.10 240 / 0.3)',
    accent: '#86efac',
    eye: '#1a2030',
  },
  working: {
    skin: '#f0d8b8',
    hair: '#22c55e',
    bg: 'oklch(28% 0.10 152 / 0.4)',
    glow: 'oklch(70% 0.19 152 / 0.5)',
    accent: '#06b6d4',
    eye: '#0f172a',
  },
  done: {
    skin: '#f0d8b8',
    hair: '#eab308',
    bg: 'oklch(35% 0.13 88 / 0.4)',
    glow: 'oklch(82% 0.13 88 / 0.6)',
    accent: '#22c55e',
    eye: '#0f172a',
  },
  error: {
    skin: '#e8c8c0',
    hair: '#ef4444',
    bg: 'oklch(28% 0.12 27 / 0.4)',
    glow: 'oklch(65% 0.20 27 / 0.5)',
    accent: '#fca5a5',
    eye: '#1a0606',
  },
}

const STATE_ANIMATION: Record<GlanState, string> = {
  dormant: 'animate-glan-breathe',
  working: 'animate-glan-pulse',
  done: 'animate-glan-done-flash',
  error: 'animate-glan-breathe',
}

export function GlanAvatar({
  state = 'dormant',
  size = 'md',
  label,
  className = '',
}: GlanAvatarProps) {
  const px = SIZE_PX[size]
  const a11yLabel = label ?? STATE_DEFAULT_LABEL[state]
  const palette = STATE_PALETTE[state]
  const animationClass = STATE_ANIMATION[state]
  const eyesOpen = state === 'working' || state === 'done'

  return (
    <span
      className={`relative inline-flex items-center justify-center ${className}`}
      role="img"
      aria-label={a11yLabel}
    >
      {/* Halo glow externe */}
      <span
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 rounded-full blur-xl"
        style={{
          width: px,
          height: px,
          background: `radial-gradient(circle at center, ${palette.glow} 0%, transparent 70%)`,
        }}
      />

      <m.span
        aria-hidden="true"
        className={`relative block overflow-hidden rounded-full ${animationClass}`}
        style={{
          width: px,
          height: px,
          boxShadow: `0 0 ${px * 0.4}px ${palette.glow}, inset 0 0 ${px * 0.15}px rgba(0,0,0,0.4)`,
        }}
        initial={{ scale: 0.85, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ duration: 0.4, ease: [0.34, 1.56, 0.64, 1] }}
      >
        <svg
          viewBox="0 0 64 64"
          width={px}
          height={px}
          xmlns="http://www.w3.org/2000/svg"
          style={{ display: 'block' }}
        >
          <defs>
            <radialGradient id={`glan-bg-${state}`} cx="50%" cy="40%" r="60%">
              <stop offset="0%" stopColor={palette.bg} stopOpacity="0.9" />
              <stop offset="100%" stopColor="oklch(15% 0.02 240)" stopOpacity="0.6" />
            </radialGradient>
            <linearGradient id={`glan-hair-${state}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={palette.hair} />
              <stop offset="100%" stopColor={palette.hair} stopOpacity="0.7" />
            </linearGradient>
            <linearGradient id={`glan-skin-${state}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={palette.skin} />
              <stop offset="100%" stopColor={palette.skin} stopOpacity="0.85" />
            </linearGradient>
          </defs>

          {/* Background atmospheric */}
          <circle cx="32" cy="32" r="32" fill={`url(#glan-bg-${state})`} />

          {/* Cheveux arrière (volume) */}
          <ellipse cx="32" cy="22" rx="18" ry="14" fill={`url(#glan-hair-${state})`} />

          {/* Visage */}
          <path
            d="M 16 30 Q 16 46, 32 50 Q 48 46, 48 30 Q 48 18, 32 18 Q 16 18, 16 30 Z"
            fill={`url(#glan-skin-${state})`}
          />

          {/* Frange anime (couvre front) */}
          <path
            d="M 16 26 Q 18 16, 32 16 Q 46 16, 48 26 Q 44 22, 36 22 Q 30 24, 24 22 Q 20 22, 16 26 Z"
            fill={`url(#glan-hair-${state})`}
          />

          {/* Mèche latérale gauche */}
          <path
            d="M 16 28 Q 14 36, 18 42 Q 20 38, 19 32 Z"
            fill={palette.hair}
            opacity="0.85"
          />

          {/* Yeux selon état */}
          {eyesOpen ? (
            <>
              <ellipse cx="25" cy="32" rx="2.5" ry="3" fill="white" />
              <ellipse cx="39" cy="32" rx="2.5" ry="3" fill="white" />
              <circle cx="25" cy="32.5" r="1.5" fill={palette.eye} />
              <circle cx="39" cy="32.5" r="1.5" fill={palette.eye} />
              <circle cx="25.5" cy="31.8" r="0.6" fill="white" />
              <circle cx="39.5" cy="31.8" r="0.6" fill="white" />
            </>
          ) : state === 'error' ? (
            <>
              <line x1="22" y1="30" x2="28" y2="33" stroke={palette.eye} strokeWidth="2" strokeLinecap="round" />
              <line x1="36" y1="33" x2="42" y2="30" stroke={palette.eye} strokeWidth="2" strokeLinecap="round" />
              <line x1="21" y1="26" x2="27" y2="28" stroke={palette.eye} strokeWidth="1.5" strokeLinecap="round" opacity="0.7" />
              <line x1="37" y1="28" x2="43" y2="26" stroke={palette.eye} strokeWidth="1.5" strokeLinecap="round" opacity="0.7" />
            </>
          ) : (
            <>
              <path d="M 22 32 Q 25 30, 28 32" stroke={palette.eye} strokeWidth="1.5" fill="none" strokeLinecap="round" />
              <path d="M 36 32 Q 39 30, 42 32" stroke={palette.eye} strokeWidth="1.5" fill="none" strokeLinecap="round" />
              {size !== 'sm' && (
                <text x="46" y="20" fontSize="6" fill={palette.accent} fontFamily="monospace" opacity="0.7">z</text>
              )}
            </>
          )}

          {/* Bouche selon état */}
          {state === 'done' && (
            <path d="M 27 42 Q 32 46, 37 42" stroke={palette.eye} strokeWidth="1.8" fill="none" strokeLinecap="round" />
          )}
          {state === 'working' && (
            <path d="M 28 42 Q 32 43, 36 42" stroke={palette.eye} strokeWidth="1.5" fill="none" strokeLinecap="round" />
          )}
          {state === 'dormant' && (
            <path d="M 28 43 Q 32 42, 36 43" stroke={palette.eye} strokeWidth="1.2" fill="none" strokeLinecap="round" opacity="0.6" />
          )}
          {state === 'error' && (
            <path d="M 28 44 Q 32 41, 36 44" stroke={palette.eye} strokeWidth="1.5" fill="none" strokeLinecap="round" />
          )}

          {/* Joues rosées en done */}
          {state === 'done' && (
            <>
              <ellipse cx="22" cy="39" rx="2.5" ry="1.5" fill="#f4a8a8" opacity="0.4" />
              <ellipse cx="42" cy="39" rx="2.5" ry="1.5" fill="#f4a8a8" opacity="0.4" />
            </>
          )}

          {/* Scan-line cyan animée (working uniquement) */}
          {state === 'working' && size !== 'sm' && (
            <line
              x1="14"
              y1="32"
              x2="50"
              y2="32"
              stroke={palette.accent}
              strokeWidth="0.5"
              opacity="0.6"
              strokeDasharray="2 3"
            >
              <animate attributeName="y1" values="24;42;24" dur="2.5s" repeatCount="indefinite" />
              <animate attributeName="y2" values="24;42;24" dur="2.5s" repeatCount="indefinite" />
            </line>
          )}

          {/* Sparkles dorés (done uniquement, taille ≥ md) */}
          {state === 'done' && size !== 'sm' && (
            <g opacity="0.9">
              <circle cx="50" cy="18" r="1.5" fill={palette.accent}>
                <animate attributeName="opacity" values="0.3;1;0.3" dur="1.5s" repeatCount="indefinite" />
              </circle>
              <circle cx="14" cy="20" r="1" fill={palette.accent}>
                <animate attributeName="opacity" values="1;0.3;1" dur="1.5s" repeatCount="indefinite" />
              </circle>
            </g>
          )}
        </svg>
      </m.span>
    </span>
  )
}
