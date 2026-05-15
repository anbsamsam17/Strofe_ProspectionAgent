'use client'

// ============================================================
// GlanGreeting — hero d'accueil du dashboard
//
// Présence Glan en grande taille + phrase de salutation + countdown
// jusqu'à la prochaine exécution nocturne (22h locale).
//
// Persona Glan : sobre, 1ʳᵉ pers, vouvoie, sans emoji, chiffres devant
// (voir memory/feedback-glan-persona).
//
// Pivot 2026-05-14 : copy refondue post-suppression du modèle "15 appels/7h30/pitch".
// Le nouveau message parle de "X prospects ajoutés cette nuit" + "pipeline commercial".
// ============================================================

import { useEffect, useState, type ReactNode } from 'react'
import { GlanCharacterLoader } from './glan-character-loader'
import { useGlanStatus } from '@/lib/hooks/use-glan-status'
import { AnimatedCounter } from '@/components/ui/animated-counter'

interface GlanGreetingProps {
  userName: string
  /** Nombre de prospects ajoutés au dernier run (pour message `done`). */
  newProspectsCount?: number
  /** Nombre de prospects en haute priorité (score ≥75) parmi les nouveaux. */
  highPriorityCount?: number
  className?: string
}

const RUN_HOUR_LOCAL = 22

function nextRunDate(): Date {
  const now = new Date()
  const next = new Date(now)
  next.setHours(RUN_HOUR_LOCAL, 0, 0, 0)
  if (next.getTime() <= now.getTime()) {
    next.setDate(next.getDate() + 1)
  }
  return next
}

function formatCountdown(ms: number): string {
  if (ms <= 0) return 'imminent'
  const totalSeconds = Math.floor(ms / 1000)
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  if (hours >= 1) return `${hours}h ${minutes.toString().padStart(2, '0')}m`
  const seconds = totalSeconds % 60
  return `${minutes}m ${seconds.toString().padStart(2, '0')}s`
}

function useCountdownTo(target: Date): string {
  const [text, setText] = useState(() => formatCountdown(target.getTime() - Date.now()))
  useEffect(() => {
    const tick = () => setText(formatCountdown(target.getTime() - Date.now()))
    tick()
    const id = setInterval(tick, 1000)
    return () => clearInterval(id)
  }, [target])
  return text
}

function getFirstName(userName: string): string {
  return userName.split(' ')[0] ?? userName
}

export function GlanGreeting({
  userName,
  newProspectsCount,
  highPriorityCount,
  className = '',
}: GlanGreetingProps) {
  const { glanState } = useGlanStatus()
  const [target] = useState(() => nextRunDate())
  const countdown = useCountdownTo(target)
  const firstName = getFirstName(userName)

  // Phrase contextuelle selon l'état + le nombre de prospects ajoutés cette nuit.
  // `primary` peut contenir un <AnimatedCounter /> pour les variantes numériques.
  let primary: ReactNode
  let secondary: string

  if (glanState === 'working') {
    primary = `Je scanne en ce moment, ${firstName}.`
    secondary = "Je parcours Sirene et l'ADEME pour trouver de nouveaux prospects BEGES."
  } else if (glanState === 'done' && newProspectsCount !== undefined && newProspectsCount > 0) {
    if (newProspectsCount === 1) {
      primary = `J'ai ajouté 1 prospect à votre liste cette nuit, ${firstName}.`
    } else {
      // key={newProspectsCount} re-déclenche l'animation 0 → N au changement.
      primary = (
        <>
          J&apos;ai ajouté{' '}
          <AnimatedCounter key={newProspectsCount} value={newProspectsCount} />{' '}
          prospects à votre liste cette nuit, {firstName}.
        </>
      )
    }
    secondary = highPriorityCount && highPriorityCount > 0
      ? `${highPriorityCount} en haute priorité (score ≥ 75).`
      : 'Tous scorés sur 3 piliers et prêts pour le pipeline.'
  } else if (glanState === 'done') {
    primary = `Cette nuit, aucune nouvelle entreprise ne correspondait à vos critères, ${firstName}.`
    secondary = "J'élargirai au prochain run si vos secteurs cibles le permettent."
  } else if (glanState === 'error') {
    primary = `Le scan a échoué cette nuit, ${firstName}.`
    secondary = "Je retente automatiquement. Consultez la page Glan pour le détail."
  } else {
    // dormant
    primary = `Bonsoir ${firstName}.`
    secondary = `Prochain scan dans ${countdown}.`
  }

  return (
    <section
      className={`relative overflow-hidden rounded-2xl border border-white/[0.08] bg-gradient-to-br from-white/[0.05] via-white/[0.02] to-transparent p-8 shadow-[0_8px_32px_-12px_rgba(0,0,0,0.4)] backdrop-blur-md ${className}`}
      aria-label="Salutation de Glan"
    >
      {/* Accent border top — gradient brand */}
      <span
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-6 top-0 h-px bg-gradient-to-r from-transparent via-green-400/60 to-transparent"
      />
      {/* Glow ambient en bas à droite */}
      <span
        aria-hidden="true"
        className="pointer-events-none absolute -bottom-32 -right-32 h-72 w-72 rounded-full bg-green-500/15 blur-3xl"
      />

      <div className="relative flex flex-col items-center gap-5 sm:flex-row sm:items-center sm:gap-8 sm:text-left">
        <GlanCharacterLoader
          state={glanState}
          size={180}
          fallbackSize="lg"
          className="flex-shrink-0"
        />

        <div className="flex flex-col gap-1.5 text-center sm:text-left">
          <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-green-400/80">
            {'// Glan · '}{glanState}
          </span>
          <h2 className="bg-gradient-to-br from-white via-green-50 to-green-200 bg-clip-text text-2xl font-bold tracking-tight text-transparent sm:text-3xl">
            {primary}
          </h2>
          <p className="text-sm text-gray-300">{secondary}</p>
          <p className="mt-1 font-mono text-[11px] italic text-green-400/70">— Glan</p>
        </div>
      </div>
    </section>
  )
}
