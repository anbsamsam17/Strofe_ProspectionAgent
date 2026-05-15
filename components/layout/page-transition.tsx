'use client'

// ============================================================
// PageTransition — fondu vertical court à chaque changement de route
//
// Wrapper Client utilisé dans le layout dashboard pour animer le contenu
// de chaque page sur navigation. Clé sur `pathname` pour re-jouer
// l'animation au changement. LazyMotion (cf. providers/motion-provider)
// nous limite à `<m.div>` (mode strict).
// ============================================================

import { m } from 'motion/react'
import { usePathname } from 'next/navigation'
import type { ReactNode } from 'react'

interface PageTransitionProps {
  children: ReactNode
}

export function PageTransition({ children }: PageTransitionProps) {
  const pathname = usePathname()
  return (
    <m.div
      key={pathname}
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25, ease: [0.4, 0, 0.2, 1] }}
    >
      {children}
    </m.div>
  )
}
