'use client'

// ============================================================
// GlanHero — bloc hero du landing avec orbe 3D R3F
//
// Composant Client autonome. R3F est rendu côté navigateur uniquement —
// le consommateur (app/page.tsx) doit l'importer via :
//   const GlanHero = dynamic(() => import('@/components/marketing/glan-hero')
//     .then(m => m.GlanHero), { ssr: false, loading: () => <GlanHeroFallback /> })
//
// Le hero combine :
//   - GlanAvatar3D (Perlin sphere) en background offset à droite
//   - Texte Hero centré-gauche
//   - MeshBackground brand en couche de fond
//   - Badge "Glan actif" pulsant
// ============================================================

import Link from 'next/link'
import { GlanAvatar3D } from '@/components/glan/glan-avatar-3d'
import { MeshBackground } from '@/components/ui/mesh-background'
import { GradientText } from '@/components/ui/gradient-text'

export function GlanHero() {
  return (
    <section className="relative isolate overflow-hidden px-6 pt-12 pb-20 sm:pt-20 sm:pb-28 lg:px-8">
      <MeshBackground variant="brand" />

      <div className="relative mx-auto grid max-w-6xl items-center gap-10 lg:grid-cols-[1.2fr_1fr]">
        {/* Colonne gauche : copy */}
        <div className="text-center lg:text-left">
          <div className="mb-6 inline-flex animate-fade-in-up items-center gap-2 rounded-full border border-green-200 bg-green-50/80 px-3.5 py-1.5 text-sm font-medium text-green-700 backdrop-blur opacity-0 animation-delay-100 dark:border-green-800 dark:bg-green-950/40 dark:text-green-400">
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-green-500 opacity-75" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-green-500" />
            </span>
            Agent IA — Prospection BEGES
          </div>

          <h1 className="animate-fade-in-up text-5xl font-extrabold leading-[1.05] tracking-tight text-gray-900 opacity-0 animation-delay-200 sm:text-6xl lg:text-7xl dark:text-white">
            Vos prospects bilan carbone,
            <br className="hidden sm:block" />
            <GradientText animate>qualifiés pendant la nuit.</GradientText>
          </h1>

          <p className="mx-auto mt-6 max-w-xl animate-fade-in-up text-lg leading-relaxed text-gray-600 opacity-0 animation-delay-300 sm:text-xl lg:mx-0 dark:text-gray-400">
            Pendant que vous dormez, je scanne Sirene et ADEME pour identifier
            les entreprises soumises à l&apos;obligation BEGES (Article L. 229-25).
            Chaque matin, votre liste s&apos;enrichit de prospects scorés et priorisés.
          </p>

          <div className="mt-8 flex animate-fade-in-up flex-wrap justify-center gap-3 opacity-0 animation-delay-400 lg:justify-start">
            <Link
              href="/signup"
              className="inline-flex items-center gap-2 rounded-xl bg-green-600 px-6 py-3 text-base font-semibold text-white shadow-md shadow-green-600/25 transition-all hover:bg-green-700 hover:shadow-lg hover:shadow-green-600/40 active:scale-95"
            >
              Activer l&apos;agent
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <line x1="5" y1="12" x2="19" y2="12" />
                <polyline points="12 5 19 12 12 19" />
              </svg>
            </Link>
            <Link
              href="/login"
              className="inline-flex items-center gap-2 rounded-xl border border-white/[0.08] bg-white/[0.04] backdrop-blur-md px-6 py-3 text-base font-semibold text-gray-700 transition-colors hover:bg-white/[0.06] dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200 dark:hover:bg-gray-800"
            >
              Se connecter
            </Link>
          </div>

          <p className="mt-6 animate-fade-in-up text-xs text-gray-400 opacity-0 animation-delay-500 dark:text-gray-400">
            — Glan, votre agent de sourcing
          </p>
        </div>

        {/* Colonne droite : orbe 3D R3F */}
        <div className="relative mx-auto flex animate-fade-in-up items-center justify-center opacity-0 animation-delay-300">
          <GlanAvatar3D state="working" size={360} />
        </div>
      </div>
    </section>
  )
}

// Fallback statique rendu pendant le chargement du bundle R3F (~180kB lazy).
// Préserve la hauteur exacte pour éviter le layout shift.
export function GlanHeroFallback() {
  return (
    <section className="relative isolate overflow-hidden px-6 pt-12 pb-20 sm:pt-20 sm:pb-28 lg:px-8">
      <MeshBackground variant="brand" />
      <div className="relative mx-auto grid max-w-6xl items-center gap-10 lg:grid-cols-[1.2fr_1fr]">
        <div className="text-center lg:text-left">
          <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-green-200 bg-green-50/80 px-3.5 py-1.5 text-sm font-medium text-green-700 dark:border-green-800 dark:bg-green-950/40 dark:text-green-400">
            <span className="h-2 w-2 rounded-full bg-green-500" />
            Agent IA — Prospection BEGES
          </div>
          <h1 className="text-5xl font-extrabold leading-[1.05] tracking-tight text-gray-900 sm:text-6xl lg:text-7xl dark:text-white">
            Vos prospects bilan carbone,
            <br className="hidden sm:block" />
            <span className="bg-gradient-to-r from-green-400 via-emerald-300 to-green-500 bg-clip-text text-transparent">
              qualifiés pendant la nuit.
            </span>
          </h1>
          <p className="mx-auto mt-6 max-w-xl text-lg leading-relaxed text-gray-600 sm:text-xl lg:mx-0 dark:text-gray-400">
            Pendant que vous dormez, je scanne Sirene et ADEME pour vos
            prospects soumis à l&apos;obligation BEGES.
          </p>
        </div>
        {/* Placeholder orbe pendant chargement R3F */}
        <div className="relative mx-auto flex h-[360px] w-[360px] items-center justify-center">
          <div className="h-44 w-44 animate-pulse rounded-full bg-gradient-to-br from-green-400/40 to-green-700/40 blur-2xl" />
          <div className="absolute h-32 w-32 animate-pulse rounded-full bg-gradient-to-br from-green-400 to-green-700 opacity-80" />
        </div>
      </div>
    </section>
  )
}
