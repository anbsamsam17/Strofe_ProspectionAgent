'use client'

// ============================================================
// GlanCharacterLoader — orchestrateur de rendu Glan.
//
// Priorité de rendu :
//   1. `GlanPortrait` (PNG fourni par utilisateur + frame holo animée)
//      = chemin par défaut, fidèle au design Pixar/Memoji costume gris.
//   2. `GlanAvatar` SVG en fallback ultime (si Image fail / reduced-motion).
//
// Le R3F procédural (`glan-avatar-3d-character`) reste disponible via
// le flag `prefer3D` pour les usages où on veut volontairement la version
// procédurale (hero alternatif, dev preview).
// ============================================================

import { useEffect, useState } from 'react'
import dynamic from 'next/dynamic'

import { GlanAvatar, type GlanState, type GlanSize } from './glan-avatar'
import { GlanPortrait } from './glan-portrait'

interface GlanCharacterLoaderProps {
  state?: GlanState
  /** Diamètre px. Défaut 320. */
  size?: number
  /** Taille équivalente pour le fallback SVG. Défaut 'lg'. */
  fallbackSize?: GlanSize
  /** Active tilt parallax curseur sur le portrait. Défaut true. */
  interactive?: boolean
  /** Forcer le fallback SVG (utile en test/SSR). */
  forceFallback?: boolean
  /** Préférer la version R3F procédurale (au lieu du portrait PNG). */
  prefer3D?: boolean
  className?: string
}

const GlanAvatar3DCharacter = dynamic(
  () =>
    import('./glan-avatar-3d-character').then((m) => ({
      default: m.GlanAvatar3DCharacter,
    })),
  { ssr: false, loading: () => null },
)

function shouldUseSvgFallback(): boolean {
  if (typeof window === 'undefined') return true
  if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    return true
  }
  return false
}

export function GlanCharacterLoader({
  state = 'dormant',
  size = 320,
  fallbackSize = 'lg',
  interactive = true,
  forceFallback = false,
  prefer3D = false,
  className = '',
}: GlanCharacterLoaderProps) {
  const [useSvgFallback, setUseSvgFallback] = useState(true)
  const [decided, setDecided] = useState(false)

  useEffect(() => {
    setUseSvgFallback(shouldUseSvgFallback())
    setDecided(true)
  }, [])

  // Pendant SSR / hydration : on rend le SVG fallback (zéro flash, zéro layout shift).
  if (forceFallback || !decided) {
    return (
      <div
        className={`inline-flex items-center justify-center ${className}`}
        style={{ width: size, height: size }}
      >
        <GlanAvatar state={state} size={fallbackSize} />
      </div>
    )
  }

  // Reduced-motion → SVG (pas de tilt, pas de particules).
  if (useSvgFallback) {
    return (
      <div
        className={`inline-flex items-center justify-center ${className}`}
        style={{ width: size, height: size }}
      >
        <GlanAvatar state={state} size={fallbackSize} />
      </div>
    )
  }

  // Mode alternatif R3F procédural (sphère shader + satellites).
  if (prefer3D) {
    return (
      <GlanAvatar3DCharacter
        state={state}
        size={size}
        interactive={interactive}
        className={className}
      />
    )
  }

  // Chemin par défaut : portrait PNG + frame holo animée.
  return (
    <GlanPortrait
      state={state}
      size={size}
      interactive={interactive}
      className={className}
    />
  )
}

export default GlanCharacterLoader
