'use client'

// ============================================================
// GlanHeroLoader — pont Client pour GlanHero (qui contient R3F)
//
// Next.js 15 interdit `ssr: false` dans un Server Component (cf. erreur build).
// Ce wrapper Client permet à app/page.tsx (Server Component) d'utiliser
// GlanHero sans payer le SSR du canvas R3F.
//
// Le fallback CSS est rendu pendant le chargement du bundle R3F (~180kB lazy).
// ============================================================

import dynamic from 'next/dynamic'
import { GlanHeroFallback } from './glan-hero'

const GlanHeroDynamic = dynamic(
  () => import('./glan-hero').then((m) => m.GlanHero),
  { ssr: false, loading: () => <GlanHeroFallback /> },
)

export function GlanHeroLoader() {
  return <GlanHeroDynamic />
}
