'use client'

// ============================================================
// GlanAvatar — Orbe de la personnification Alpha
//
// Style : Siri Orb adapté à l'identité ProspectionAgent
// (palette navy + vert brand + or "done" — voir memory/project-design-tokens).
//
// 4 états (alignés sur memory/feedback-glan-persona) :
//   - dormant : orbe gris, respiration lente (jour 00h-22h)
//   - working : orbe vert pulsant + halo (22h-23h45 pendant un run)
//   - done    : orbe doré immobile, glow gold (liste prête)
//   - error   : orbe rouge, pulsation atténuée (échec récupérable)
//
// 3 tailles :
//   - sm : 32px (sidebar compact, header)
//   - md : 64px (carte alpha-status-bar, modale running)
//   - lg : 128px (alpha-greeting hero dashboard)
//
// Pas d'usage de R3F ici — cf. GlanAvatar3D pour le hero landing.
// Compatible LazyMotion strict (m.div uniquement).
// Respect strict de prefers-reduced-motion (animations stoppées globalement
// via app/globals.css media query).
// ============================================================

import { m } from 'motion/react'

export type GlanState = 'dormant' | 'working' | 'done' | 'error'
export type GlanSize = 'sm' | 'md' | 'lg'

interface GlanAvatarProps {
  state?: GlanState
  size?: GlanSize
  /**
   * Libellé accessible (sr-only). Défaut : généré à partir de `state`.
   * Surcharger si le contexte rend le statut explicite (ex. déjà annoncé par
   * un voisin aria-live).
   */
  label?: string
  className?: string
}

// ── Tokens visuels par état ─────────────────────────────────────────────────

const SIZE_PX: Record<GlanSize, number> = {
  sm: 32,
  md: 64,
  lg: 128,
}

const STATE_GRADIENT: Record<GlanState, string> = {
  // dormant : neutre, légère teinte navy/brand pour rester "alive but resting"
  dormant:
    'radial-gradient(circle at 30% 30%, oklch(72% 0.05 240) 0%, oklch(28% 0.02 240) 70%)',
  // working : vert brand, halo prononcé
  working:
    'radial-gradient(circle at 30% 30%, oklch(85% 0.18 152) 0%, oklch(50% 0.19 152) 70%)',
  // done : or chaud (signal "travail accompli")
  done:
    'radial-gradient(circle at 30% 30%, oklch(92% 0.10 88) 0%, oklch(70% 0.13 88) 75%)',
  // error : rouge atténué (ni alarme, ni cassé — juste "j'ai besoin d'aide")
  error:
    'radial-gradient(circle at 30% 30%, oklch(80% 0.12 27) 0%, oklch(45% 0.18 27) 70%)',
}

const STATE_GLOW: Record<GlanState, string> = {
  dormant: 'none',
  working: '0 0 24px 4px oklch(69% 0.19 152 / 0.45)',
  done: '0 0 32px 6px oklch(82% 0.13 88 / 0.55)',
  error: '0 0 20px 3px oklch(62% 0.22 27 / 0.4)',
}

// Animation associée à chaque état — référence les @keyframes définies dans globals.css
const STATE_ANIMATION_CLASS: Record<GlanState, string> = {
  dormant: 'animate-glan-breathe',
  working: 'animate-glan-pulse',
  done: 'animate-glan-done-flash',
  error: 'animate-glan-breathe', // respiration mais plus lente côté visuel
}

const STATE_DEFAULT_LABEL: Record<GlanState, string> = {
  dormant: 'Glan au repos',
  working: 'Glan travaille',
  done: 'Glan a terminé',
  error: 'Glan a rencontré une erreur',
}

// ── Composant ────────────────────────────────────────────────────────────────

export function GlanAvatar({
  state = 'dormant',
  size = 'md',
  label,
  className = '',
}: GlanAvatarProps) {
  const px = SIZE_PX[size]
  const a11yLabel = label ?? STATE_DEFAULT_LABEL[state]
  const animationClass = STATE_ANIMATION_CLASS[state]

  return (
    <span
      className={`relative inline-flex items-center justify-center ${className}`}
      role="img"
      aria-label={a11yLabel}
    >
      {/* Halo extérieur — uniquement working/done/error */}
      {state !== 'dormant' && (
        <span
          aria-hidden="true"
          className="absolute inset-0 rounded-full blur-md"
          style={{
            width: px,
            height: px,
            boxShadow: STATE_GLOW[state],
          }}
        />
      )}

      {/* Orbe principale */}
      <m.span
        aria-hidden="true"
        className={`relative block rounded-full ${animationClass}`}
        style={{
          width: px,
          height: px,
          background: STATE_GRADIENT[state],
          boxShadow: state === 'working' || state === 'done' ? STATE_GLOW[state] : undefined,
        }}
        initial={{ scale: 0.9, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ duration: 0.4, ease: [0.34, 1.56, 0.64, 1] }}
      >
        {/* Reflet spéculaire — point lumineux en haut à gauche pour donner
            l'illusion d'une sphère 3D sans WebGL. */}
        <span
          aria-hidden="true"
          className="absolute rounded-full bg-white/40 blur-[2px]"
          style={{
            top: '15%',
            left: '20%',
            width: px * 0.22,
            height: px * 0.22,
          }}
        />

        {/* Rotation interne du gradient pour l'état `working` — donne l'impression
            d'une activité en cours. Géré via classe CSS pour ne pas re-render. */}
        {state === 'working' && (
          <span
            aria-hidden="true"
            className="absolute inset-0 rounded-full animate-glan-spin opacity-60"
            style={{
              background:
                'conic-gradient(from 0deg, transparent 0%, oklch(92% 0.10 152 / 0.6) 30%, transparent 60%)',
              mixBlendMode: 'screen',
            }}
          />
        )}
      </m.span>
    </span>
  )
}
