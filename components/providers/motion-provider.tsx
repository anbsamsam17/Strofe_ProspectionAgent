'use client'

// ============================================================
// Motion provider — wrapper LazyMotion (motion.dev v12)
//
// Charge le feature set "domMax" (~25kB) qui inclut `whileInView`
// + IntersectionObserver, requis par StaggerChildren / ScrollReveal
// sur la landing. `domAnimation` (~15kB) NE le contient PAS — utiliser
// domAnimation fait que les sections "Comment ça marche", "Hygiène",
// etc. restent à opacity:0 en permanence (audit 2026-05-20).
// Mode `strict` : seules les balises `<m.div>` fonctionnent.
//
// Voir https://motion.dev/docs/react-reduce-bundle-size pour la justification.
// ============================================================

import { LazyMotion, domMax } from 'motion/react'

interface MotionProviderProps {
  children: React.ReactNode
}

export function MotionProvider({ children }: MotionProviderProps) {
  return (
    <LazyMotion features={domMax} strict>
      {children}
    </LazyMotion>
  )
}
