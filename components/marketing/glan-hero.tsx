'use client'

// ============================================================
// GlanHero — bloc hero du landing
//
// Refonte 2026-05-15 : abandon de l'orbe R3F au profit du
// <GlanPortrait /> (avatar Pixar PNG). Animations Framer Motion :
//   - Révélation mot-par-mot du H1 (stagger 0.08s, par mot avec delay calc)
//   - Description fade-in delayed
//   - CTAs : whileHover scale + magnetic mouse-follow sur primaire
//   - Parallax au scroll sur le portrait (useScroll + useTransform)
//   - Badge "Agent IA" en glass avec dot pulsant
//
// FIX 2026-05-15 (post-screenshot) : le H1 ligne 1 utilisait un gradient
// `from-white via-gray-100 to-gray-300` qui rendait le texte quasi invisible
// sur navy. Repassage en `text-white` solide pour la ligne 1 ; ligne 2 garde
// le gradient vert/emerald/cyan vif. Animation simplifiée (delays calculés
// inline, plus de variants imbriqués qui pouvaient bloquer en opacity:0).
// ============================================================

import Link from 'next/link'
import { useRef } from 'react'
import {
  m,
  useReducedMotion,
  useScroll,
  useTransform,
  useMotionValue,
  useSpring,
  type Variants,
} from 'motion/react'
import { GlanPortrait } from '@/components/glan/glan-portrait'
import { BorderBeam } from '@/components/ui/border-beam'

// ── Stagger config ────────────────────────────────────────────────── //

const HEADLINE_PART_1 = 'Vos prospects bilan carbone,'
const HEADLINE_PART_2 = 'qualifiés à la demande.'

const fadeUpVariants: Variants = {
  hidden: { opacity: 0, y: 16 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.55, ease: [0.22, 1, 0.36, 1] },
  },
}

const containerVariants: Variants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: { staggerChildren: 0.08, delayChildren: 0.1 },
  },
}

// ── Magnetic CTA — suit le curseur ±6px ─────────────────────────────── //

function MagneticPrimaryCTA({ disabled }: { disabled: boolean }) {
  const ref = useRef<HTMLDivElement | null>(null)
  const mx = useMotionValue(0)
  const my = useMotionValue(0)
  const sx = useSpring(mx, { stiffness: 220, damping: 18, mass: 0.4 })
  const sy = useSpring(my, { stiffness: 220, damping: 18, mass: 0.4 })

  function handlePointerMove(e: React.PointerEvent<HTMLDivElement>) {
    if (disabled || !ref.current) return
    const rect = ref.current.getBoundingClientRect()
    const cx = rect.left + rect.width / 2
    const cy = rect.top + rect.height / 2
    const dx = (e.clientX - cx) / rect.width
    const dy = (e.clientY - cy) / rect.height
    mx.set(dx * 12)
    my.set(dy * 12)
  }
  function handlePointerLeave() {
    mx.set(0)
    my.set(0)
  }

  return (
    <m.div
      ref={ref}
      onPointerMove={handlePointerMove}
      onPointerLeave={handlePointerLeave}
      style={disabled ? undefined : { x: sx, y: sy }}
      className="inline-flex"
    >
      <BorderBeam color="brand" thickness={1.5} className="inline-flex">
        <m.div
          whileHover={disabled ? undefined : { scale: 1.03 }}
          whileTap={disabled ? undefined : { scale: 0.97 }}
          transition={{ type: 'spring', stiffness: 360, damping: 22 }}
        >
          <Link
            href="/signup"
            className="inline-flex items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-green-500 to-emerald-500 px-7 py-3.5 font-bold text-white shadow-[0_0_24px_-4px_oklch(70%_0.19_152_/_0.55)] transition-shadow duration-200 hover:shadow-[0_0_36px_-2px_oklch(70%_0.19_152_/_0.70)]"
          >
            Lancer Glan
            <svg
              className="h-4 w-4"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2.5}
              aria-hidden="true"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M5 12h14m-7-7 7 7-7 7"
              />
            </svg>
          </Link>
        </m.div>
      </BorderBeam>
    </m.div>
  )
}

// ── Hero ────────────────────────────────────────────────────────────── //

export function GlanHero() {
  const prefersReducedMotion = useReducedMotion() ?? false
  const sectionRef = useRef<HTMLElement | null>(null)

  // Parallax scroll : le portrait monte légèrement quand on scrolle.
  const { scrollYProgress } = useScroll({
    target: sectionRef,
    offset: ['start start', 'end start'],
  })
  const portraitY = useTransform(scrollYProgress, [0, 1], [0, -60])
  const portraitOpacity = useTransform(scrollYProgress, [0, 0.8], [1, 0.3])

  // Découpage du titre en mots pour le stagger.
  const part1Words = HEADLINE_PART_1.split(' ')
  const part2Words = HEADLINE_PART_2.split(' ')
  const WORD_STAGGER_S = 0.08
  const INIT_DELAY_S = 0.1

  return (
    <section
      ref={sectionRef}
      className="relative isolate overflow-hidden px-6 pt-16 pb-24 sm:pt-24 sm:pb-32 lg:px-8"
    >
      {/* Mesh gradient local — aurore animée lente (pause si reduced-motion) */}
      <m.div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 -z-10"
        animate={
          prefersReducedMotion
            ? undefined
            : {
                background: [
                  'radial-gradient(ellipse 50% 45% at 20% 30%, oklch(35% 0.15 152 / 0.30) 0%, transparent 60%), radial-gradient(ellipse 45% 40% at 80% 60%, oklch(32% 0.14 188 / 0.28) 0%, transparent 60%)',
                  'radial-gradient(ellipse 50% 45% at 80% 30%, oklch(35% 0.15 152 / 0.30) 0%, transparent 60%), radial-gradient(ellipse 45% 40% at 20% 60%, oklch(32% 0.14 188 / 0.28) 0%, transparent 60%)',
                  'radial-gradient(ellipse 50% 45% at 20% 30%, oklch(35% 0.15 152 / 0.30) 0%, transparent 60%), radial-gradient(ellipse 45% 40% at 80% 60%, oklch(32% 0.14 188 / 0.28) 0%, transparent 60%)',
                ],
              }
        }
        transition={{ duration: 16, repeat: Infinity, ease: 'easeInOut' }}
        style={{
          background:
            'radial-gradient(ellipse 50% 45% at 20% 30%, oklch(35% 0.15 152 / 0.30) 0%, transparent 60%), radial-gradient(ellipse 45% 40% at 80% 60%, oklch(32% 0.14 188 / 0.28) 0%, transparent 60%)',
        }}
      />

      <m.div
        initial="hidden"
        animate="visible"
        variants={containerVariants}
        className="relative mx-auto grid max-w-6xl items-center gap-12 lg:grid-cols-[1.2fr_1fr]"
      >
        {/* ───────── Colonne gauche : copy ───────── */}
        <div className="text-center lg:text-left">
          {/* Badge "Agent IA" */}
          <m.div variants={fadeUpVariants}>
            <span className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-3.5 py-1.5 text-sm font-medium text-green-300 backdrop-blur-md">
              <span className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-green-400 opacity-75" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-green-400" />
              </span>
              Agent de sourcing — Prospection BEGES
            </span>
          </m.div>

          {/* H1 — solide blanc + gradient vert vif sur ligne 2.
              Animations inline (m.span par mot) avec delays calculés —
              aucun variants imbriqué qui pourrait laisser opacity à 0. */}
          <h1 className="mt-6 text-5xl font-extrabold leading-[1.05] tracking-tight text-white sm:text-6xl xl:text-7xl">
            <span className="block text-white">
              {part1Words.map((word, i) => (
                <m.span
                  key={`p1-${i}`}
                  initial={prefersReducedMotion ? false : { opacity: 0, y: 18 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{
                    duration: 0.55,
                    delay: INIT_DELAY_S + i * WORD_STAGGER_S,
                    ease: [0.34, 1.56, 0.64, 1],
                  }}
                  className="inline-block"
                >
                  {word}
                  {i < part1Words.length - 1 && ' '}
                </m.span>
              ))}
            </span>
            <span
              className="mt-2 block bg-gradient-to-r from-green-400 via-emerald-300 to-cyan-300 bg-clip-text text-transparent"
              style={{
                WebkitTextFillColor: 'transparent',
                backgroundSize: '200% 200%',
                animation: prefersReducedMotion
                  ? undefined
                  : 'gradient-shift 6s ease infinite',
              }}
            >
              {part2Words.map((word, i) => (
                <m.span
                  key={`p2-${i}`}
                  initial={prefersReducedMotion ? false : { opacity: 0, y: 18 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{
                    duration: 0.55,
                    delay:
                      INIT_DELAY_S + (part1Words.length + i) * WORD_STAGGER_S,
                    ease: [0.34, 1.56, 0.64, 1],
                  }}
                  className="inline-block"
                >
                  {word}
                  {i < part2Words.length - 1 && ' '}
                </m.span>
              ))}
            </span>
          </h1>

          {/* Description */}
          <m.p
            variants={fadeUpVariants}
            className="mx-auto mt-6 max-w-xl text-lg leading-relaxed text-gray-300 sm:text-xl lg:mx-0"
          >
            Quand vous me lancez, je parcours Sirene et l&apos;ADEME pour identifier
            les entreprises soumises à l&apos;article L. 229-25. Je vous livre une
            liste priorisée, scorée sur trois piliers transparents. Je prépare
            le terrain, vous appelez. Sources publiques uniquement, conformité
            RGPD.
          </m.p>

          {/* CTAs */}
          <m.div
            variants={fadeUpVariants}
            className="mt-8 flex flex-wrap justify-center gap-3 lg:justify-start"
          >
            <MagneticPrimaryCTA disabled={prefersReducedMotion ?? false} />

            <m.div
              whileHover={prefersReducedMotion ? undefined : { scale: 1.03 }}
              whileTap={prefersReducedMotion ? undefined : { scale: 0.97 }}
              transition={{ type: 'spring', stiffness: 360, damping: 22 }}
              className="inline-flex"
            >
              <Link
                href="/login"
                className="inline-flex items-center gap-2 rounded-xl border border-white/10 bg-white/[0.04] px-6 py-3.5 text-base font-semibold text-gray-100 backdrop-blur-md transition-colors duration-200 hover:border-white/20 hover:bg-white/[0.08]"
              >
                Se connecter
              </Link>
            </m.div>
          </m.div>

          {/* Signature */}
          <m.p
            variants={fadeUpVariants}
            className="mt-7 font-mono text-[10px] uppercase tracking-[0.18em] text-cyan-400/80"
          >
            — Glan, votre agent de sourcing BEGES
          </m.p>
        </div>

        {/* ───────── Colonne droite : portrait Glan ───────── */}
        <m.div
          variants={fadeUpVariants}
          style={
            prefersReducedMotion
              ? undefined
              : { y: portraitY, opacity: portraitOpacity }
          }
          className="relative mx-auto flex items-center justify-center"
        >
          {/* Halo derrière le portrait */}
          <span
            aria-hidden="true"
            className="pointer-events-none absolute h-[420px] w-[420px] rounded-full bg-gradient-to-br from-green-500/20 via-emerald-400/10 to-cyan-500/15 blur-3xl"
          />
          <GlanPortrait state="working" size={380} interactive />
        </m.div>
      </m.div>
    </section>
  )
}

// Fallback statique rendu pendant le chargement du bundle Client.
// Préserve la hauteur exacte pour éviter le layout shift.
export function GlanHeroFallback() {
  return (
    <section className="relative isolate overflow-hidden px-6 pt-16 pb-24 sm:pt-24 sm:pb-32 lg:px-8">
      <div className="relative mx-auto grid max-w-6xl items-center gap-12 lg:grid-cols-[1.2fr_1fr]">
        <div className="text-center lg:text-left">
          <span className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-3.5 py-1.5 text-sm font-medium text-green-300 backdrop-blur-md">
            <span className="h-2 w-2 rounded-full bg-green-400" />
            Agent de sourcing — Prospection BEGES
          </span>
          <h1 className="mt-6 text-5xl font-extrabold leading-[1.05] tracking-tight text-white sm:text-6xl xl:text-7xl">
            <span className="block text-white">Vos prospects bilan carbone,</span>
            <span
              className="mt-2 block bg-gradient-to-r from-green-400 via-emerald-300 to-cyan-300 bg-clip-text text-transparent"
              style={{ WebkitTextFillColor: 'transparent' }}
            >
              qualifiés à la demande.
            </span>
          </h1>
          <p className="mx-auto mt-6 max-w-xl text-lg leading-relaxed text-gray-300 sm:text-xl lg:mx-0">
            Quand vous me lancez, je parcours Sirene et l&apos;ADEME pour vos
            prospects soumis à l&apos;article L. 229-25.
          </p>
        </div>
        {/* Placeholder portrait pendant le chargement */}
        <div className="relative mx-auto flex h-[380px] w-[380px] items-center justify-center">
          <div className="h-60 w-60 animate-pulse rounded-full bg-gradient-to-br from-green-400/30 to-emerald-700/30 blur-2xl" />
          <div className="absolute h-48 w-48 animate-pulse rounded-full bg-gradient-to-br from-green-500/60 to-emerald-700/60" />
        </div>
      </div>
    </section>
  )
}
