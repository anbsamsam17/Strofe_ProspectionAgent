'use client'

// ============================================================
// Motion provider — wrapper LazyMotion (motion.dev v12)
//
// Charge uniquement la feature set "domAnimation" (~15kB, vs ~34kB
// pour le bundle complet). Mode `strict` : seules les balises `<m.div>`
// fonctionnent (pas `<motion.div>`) — empêche d'importer accidentellement
// le bundle complet via `motion.div`.
//
// Voir https://motion.dev/docs/react-reduce-bundle-size pour la justification.
// ============================================================

import { LazyMotion, domAnimation } from 'motion/react'

interface MotionProviderProps {
  children: React.ReactNode
}

export function MotionProvider({ children }: MotionProviderProps) {
  return (
    <LazyMotion features={domAnimation} strict>
      {children}
    </LazyMotion>
  )
}
