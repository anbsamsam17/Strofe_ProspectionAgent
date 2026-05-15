'use client'

// ============================================================
// GlanHeroLoader — wrapper Client pour <GlanHero>
//
// Refonte 2026-05-15 : R3F retiré (Hero utilise désormais un PNG portrait).
// Ce loader reste pour conserver le point d'entrée stable côté app/page.tsx
// (Server Component). Toutes les animations Framer Motion vivent dans
// <GlanHero>, qui est 'use client'.
// ============================================================

import { GlanHero } from './glan-hero'

export function GlanHeroLoader() {
  return <GlanHero />
}
