'use client'

// ============================================================
// MascotAvatar — wrapper Rive state machine pour Glan
//
// LOT 5 du pivot 2026-05-14. Composant qui pilote la mascotte animée Rive
// via `useRive` + `useStateMachineInput`. La state machine côté .riv expose :
//   - input boolean `dormant`
//   - input boolean `sourcing`
//   - input boolean `scoring`
//   - input boolean `contacts`
//   - input boolean `done`
//   - input boolean `error`
//
// L'asset `.riv` doit être placé en `public/glan-mascot.riv` (sera commandé
// auprès d'un illustrateur Rive — cf memory/project_pivot_glan.md LOT 5).
//
// Comportement de fallback : si l'asset n'est pas chargé (asset absent en dev,
// chargement lent, erreur), on render `<GlanAvatar>` (orbe CSS+Motion) avec
// la même API publique → swap sans douleur quand le .riv arrive.
// ============================================================

import { useEffect, useState } from 'react'
import { useRive, useStateMachineInput, Layout, Fit, Alignment } from '@rive-app/react-canvas'

import { GlanAvatar, type GlanState, type GlanSize } from './glan-avatar'

interface MascotAvatarProps {
  state?: GlanState
  size?: GlanSize
  /** Forcer le fallback CSS (utile en test). Défaut : auto si Rive échoue. */
  forceFallback?: boolean
  /** Chemin vers l'asset .riv. Défaut : '/glan-mascot.riv'. */
  src?: string
  className?: string
}

const SIZE_PX: Record<GlanSize, number> = {
  sm: 32,
  md: 64,
  lg: 128,
}

const STATE_MACHINE_NAME = 'glan'

export function MascotAvatar({
  state = 'dormant',
  size = 'md',
  forceFallback = false,
  src = '/glan-mascot.riv',
  className = '',
}: MascotAvatarProps) {
  const [assetLoaded, setAssetLoaded] = useState(false)
  const [assetFailed, setAssetFailed] = useState(false)

  const { rive, RiveComponent } = useRive({
    src,
    stateMachines: STATE_MACHINE_NAME,
    autoplay: true,
    layout: new Layout({ fit: Fit.Contain, alignment: Alignment.Center }),
    onLoad: () => setAssetLoaded(true),
    onLoadError: () => setAssetFailed(true),
  })

  // Inputs Rive — un par état. Activé selon `state` prop.
  const inputDormant = useStateMachineInput(rive, STATE_MACHINE_NAME, 'dormant')
  const inputSourcing = useStateMachineInput(rive, STATE_MACHINE_NAME, 'sourcing')
  const inputScoring = useStateMachineInput(rive, STATE_MACHINE_NAME, 'scoring')
  const inputContacts = useStateMachineInput(rive, STATE_MACHINE_NAME, 'contacts')
  const inputDone = useStateMachineInput(rive, STATE_MACHINE_NAME, 'done')
  const inputError = useStateMachineInput(rive, STATE_MACHINE_NAME, 'error')

  useEffect(() => {
    if (!assetLoaded) return
    // Reset puis activer l'input correspondant à l'état courant.
    // Mapping état → inputs Rive :
    const mapping: Record<GlanState, typeof inputDormant> = {
      dormant: inputDormant,
      working: inputSourcing, // working agrège sourcing en première phase
      done: inputDone,
      error: inputError,
    }
    ;[inputDormant, inputSourcing, inputScoring, inputContacts, inputDone, inputError].forEach(
      (i) => {
        if (i) i.value = false
      },
    )
    const target = mapping[state]
    if (target) target.value = true
  }, [
    state,
    assetLoaded,
    inputDormant,
    inputSourcing,
    inputScoring,
    inputContacts,
    inputDone,
    inputError,
  ])

  const px = SIZE_PX[size]
  const useFallback = forceFallback || assetFailed || !assetLoaded

  if (useFallback) {
    return <GlanAvatar state={state} size={size} className={className} />
  }

  return (
    <div
      className={`relative inline-block ${className}`}
      style={{ width: px, height: px }}
      role="img"
      aria-label={`Glan en état ${state}`}
    >
      <RiveComponent />
    </div>
  )
}
