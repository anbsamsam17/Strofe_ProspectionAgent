'use client'

// ============================================================
// GlanGreeting — hero d'accueil du dashboard
//
// Présence Glan en grande taille + phrase de salutation + countdown
// jusqu'à la prochaine exécution nocturne (22h locale).
//
// Refonte 2026-05-15 : intégration <GlanPortrait> + animations Framer Motion
//   - Stagger d'entrée : portrait scale 0.92→1, texte translateY 12→0, signature delayed
//   - Speech bubble subtle qui apparaît à côté du portrait avec le texte primary
//   - Pulse subtil + glow sur le compteur si newProspectsCount > 0
//   - AnimatedCounter sur newProspectsCount (déjà câblé)
//
// Persona Glan : sobre, 1ʳᵉ pers, vouvoie, sans emoji, chiffres devant.
// ============================================================

import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { m, useReducedMotion, type Variants } from 'motion/react'
import { GlanPortrait } from './glan-portrait'
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

// ── Variants Framer Motion ────────────────────────────────────────────── //

const containerVariants: Variants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: { staggerChildren: 0.08, delayChildren: 0.05 },
  },
}

const portraitVariants: Variants = {
  hidden: { opacity: 0, scale: 0.92 },
  visible: {
    opacity: 1,
    scale: 1,
    transition: { type: 'spring', stiffness: 220, damping: 22 },
  },
}

const textVariants: Variants = {
  hidden: { opacity: 0, y: 12 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.45, ease: [0.22, 1, 0.36, 1] },
  },
}

// ── Composant ──────────────────────────────────────────────────────────── //

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
  const prefersReducedMotion = useReducedMotion() ?? false

  // Pour le portrait : on bascule en 'done' uniquement si on a des nouveaux prospects.
  const portraitState = useMemo(() => {
    if (glanState === 'done' && (newProspectsCount ?? 0) === 0) return 'dormant'
    return glanState
  }, [glanState, newProspectsCount])

  // Phrase contextuelle selon l'état + le nombre de prospects ajoutés cette nuit.
  let primary: ReactNode
  let secondary: string
  const highlight = glanState === 'done' && (newProspectsCount ?? 0) > 0

  if (glanState === 'working') {
    primary = `Je scanne en ce moment, ${firstName}.`
    secondary = "Je parcours Sirene et l'ADEME pour trouver de nouveaux prospects BEGES."
  } else if (glanState === 'done' && newProspectsCount !== undefined && newProspectsCount > 0) {
    if (newProspectsCount === 1) {
      primary = `J'ai ajouté 1 prospect à votre liste cette nuit, ${firstName}.`
    } else {
      primary = (
        <>
          J&apos;ai ajouté{' '}
          <m.span
            className="inline-block bg-gradient-to-br from-green-400 to-cyan-400 bg-clip-text font-bold text-transparent"
            animate={
              prefersReducedMotion
                ? undefined
                : {
                    textShadow: [
                      '0 0 0px oklch(70% 0.19 152 / 0)',
                      '0 0 20px oklch(70% 0.19 152 / 0.45)',
                      '0 0 0px oklch(70% 0.19 152 / 0)',
                    ],
                  }
            }
            transition={{ duration: 2.6, repeat: Infinity, ease: 'easeInOut' }}
          >
            <AnimatedCounter key={newProspectsCount} value={newProspectsCount} />
          </m.span>{' '}
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
    primary = `Bonsoir ${firstName}.`
    secondary = `Prochain scan dans ${countdown}.`
  }

  return (
    <m.section
      initial="hidden"
      animate="visible"
      variants={containerVariants}
      className={`relative overflow-hidden rounded-2xl border border-white/[0.08] bg-white/[0.03] p-6 shadow-[0_8px_32px_-12px_rgba(0,0,0,0.4)] backdrop-blur-md sm:p-8 ${className}`}
      aria-label="Salutation de Glan"
    >
      {/* Accent border top — gradient brand */}
      <span
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-6 top-0 h-px bg-gradient-to-r from-transparent via-green-400/60 to-transparent"
      />
      {/* Glow ambient en bas à droite (pulse si highlight) */}
      <m.span
        aria-hidden="true"
        className="pointer-events-none absolute -bottom-32 -right-32 h-72 w-72 rounded-full bg-green-500/15 blur-3xl"
        animate={
          highlight && !prefersReducedMotion
            ? { opacity: [0.6, 1, 0.6], scale: [1, 1.08, 1] }
            : undefined
        }
        transition={{ duration: 3.2, repeat: Infinity, ease: 'easeInOut' }}
      />

      <div className="relative flex flex-col items-center gap-5 sm:flex-row sm:items-center sm:gap-7 sm:text-left">
        <m.div variants={portraitVariants} className="flex-shrink-0">
          <GlanPortrait state={portraitState} size={120} className="" />
        </m.div>

        {/* Bloc texte : aspect speech-bubble subtle */}
        <m.div
          variants={textVariants}
          className="relative flex flex-col gap-1.5 text-center sm:text-left"
        >
          {/* Pointer du speech bubble (visible desktop seulement) */}
          <span
            aria-hidden="true"
            className="pointer-events-none absolute -left-3 top-6 hidden h-3 w-3 rotate-45 border-l border-b border-white/[0.06] bg-white/[0.03] backdrop-blur-md sm:block"
          />

          <m.span
            variants={textVariants}
            className="font-mono text-[10px] uppercase tracking-[0.2em] text-cyan-400/80"
          >
            {'// Glan · '}{glanState}
          </m.span>
          <m.h2
            variants={textVariants}
            className="bg-gradient-to-br from-white via-green-50 to-green-200 bg-clip-text text-2xl font-bold tracking-tight text-transparent sm:text-3xl"
          >
            {primary}
          </m.h2>
          <m.p variants={textVariants} className="text-sm text-gray-300">
            {secondary}
          </m.p>
          <m.p
            variants={textVariants}
            className="mt-1 font-mono text-[11px] italic text-green-400/70"
          >
            — Glan
          </m.p>
        </m.div>
      </div>
    </m.section>
  )
}
