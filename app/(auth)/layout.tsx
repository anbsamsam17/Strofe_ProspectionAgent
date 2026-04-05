import type { Metadata } from "next"
import Link from "next/link"

export const metadata: Metadata = {
  robots: { index: false, follow: false },
}

// ------------------------------------------------------------------ //
// Logo                                                                 //
// ------------------------------------------------------------------ //
function StrofeLogo() {
  return (
    <div className="flex items-center gap-2.5">
      <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-green-600 shadow-sm">
        <svg
          className="h-5 w-5 text-white"
          xmlns="http://www.w3.org/2000/svg"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          aria-hidden="true"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M7 21a4 4 0 01-4-4V5a2 2 0 012-2h4a2 2 0 012 2v12a4 4 0 01-4 4zm0 0h12a2 2 0 002-2v-4a2 2 0 00-2-2h-2.343M11 7.343l1.657-1.657a2 2 0 012.828 0l2.829 2.829a2 2 0 010 2.828l-8.486 8.485M7 17h.01"
          />
        </svg>
      </div>
      <div className="flex flex-col leading-tight">
        <span className="text-base font-bold text-white tracking-tight">DecarbonLeads</span>
        <span className="text-[10px] font-medium text-green-300 uppercase tracking-widest">by STROFE</span>
      </div>
    </div>
  )
}

// ------------------------------------------------------------------ //
// Panneau gauche decoratif                                            //
// ------------------------------------------------------------------ //

const PROOF_POINTS = [
  {
    icon: (
      <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
        <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75 11.25 15 15 9.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
      </svg>
    ),
    text: "15 appels qualifies prets a 7h30 chaque matin",
  },
  {
    icon: (
      <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
        <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75 11.25 15 15 9.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
      </svg>
    ),
    text: "Pitchs sur-mesure generes par Claude Sonnet",
  },
  {
    icon: (
      <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
        <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75 11.25 15 15 9.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
      </svg>
    ),
    text: "Donnees BEGES et signaux d'intention inclus",
  },
  {
    icon: (
      <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
        <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75 11.25 15 15 9.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
      </svg>
    ),
    text: "Source : Sirene INSEE + registre ADEME officiel",
  },
]

function DecorativePanel() {
  return (
    <div className="hidden lg:flex lg:flex-col relative w-[480px] shrink-0 overflow-hidden bg-gradient-to-br from-green-700 via-emerald-700 to-green-900">
      {/* Motif grille */}
      <div className="pointer-events-none absolute inset-0 opacity-10" aria-hidden="true">
        <svg className="h-full w-full" xmlns="http://www.w3.org/2000/svg">
          <defs>
            <pattern id="auth-grid" width="32" height="32" patternUnits="userSpaceOnUse">
              <path d="M.5 32V.5H32" fill="none" stroke="white" strokeWidth="0.5" />
            </pattern>
          </defs>
          <rect width="100%" height="100%" fill="url(#auth-grid)" />
        </svg>
      </div>

      {/* Taches lumineuses */}
      <div className="pointer-events-none absolute -top-32 -right-32 h-80 w-80 rounded-full bg-white/10 blur-3xl" aria-hidden="true" />
      <div className="pointer-events-none absolute -bottom-32 -left-32 h-80 w-80 rounded-full bg-white/10 blur-3xl" aria-hidden="true" />

      {/* Contenu */}
      <div className="relative flex flex-col h-full p-10">
        {/* Logo */}
        <Link href="/" aria-label="Retour a l'accueil">
          <StrofeLogo />
        </Link>

        {/* Tagline centrale */}
        <div className="flex-1 flex flex-col justify-center">
          <div className="mb-6 inline-flex items-center gap-2 text-green-300 text-sm">
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75" />
              <span className="relative inline-flex rounded-full h-2 w-2 bg-green-400" />
            </span>
            Agent IA actif cette nuit
          </div>

          <h2 className="text-4xl font-extrabold text-white leading-tight tracking-tight">
            Vos prospects bilan carbone,
            <br />
            <span className="text-green-300">prepares pendant la nuit.</span>
          </h2>

          <p className="mt-4 text-green-100/80 leading-relaxed">
            L&apos;agent sourcé, scoré et prepare vos pitchs. Vous n&apos;avez plus qu&apos;a decrocher le telephone.
          </p>

          {/* Points de preuve */}
          <ul className="mt-8 space-y-3">
            {PROOF_POINTS.map((point) => (
              <li key={point.text} className="flex items-start gap-3 text-sm text-green-100">
                <span className="mt-0.5 shrink-0 text-green-300">{point.icon}</span>
                <span>{point.text}</span>
              </li>
            ))}
          </ul>
        </div>

        {/* Stat card en bas */}
        <div className="mt-8 rounded-2xl bg-white/10 backdrop-blur border border-white/20 p-5">
          <div className="flex items-center gap-4">
            <div className="text-center">
              <div className="text-3xl font-extrabold text-white tabular-nums">15</div>
              <div className="text-xs text-green-200 mt-0.5">appels / jour</div>
            </div>
            <div className="h-10 w-px bg-white/20" />
            <div className="text-center">
              <div className="text-3xl font-extrabold text-white tabular-nums">500+</div>
              <div className="text-xs text-green-200 mt-0.5">prospects / nuit</div>
            </div>
            <div className="h-10 w-px bg-white/20" />
            <div className="text-center">
              <div className="text-3xl font-extrabold text-white tabular-nums">0</div>
              <div className="text-xs text-green-200 mt-0.5">effort de recherche</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

// ------------------------------------------------------------------ //
// Layout auth                                                          //
// ------------------------------------------------------------------ //
export default function AuthLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <div className="min-h-screen flex">
      {/* Panneau gauche decoratif — visible uniquement desktop */}
      <DecorativePanel />

      {/* Panneau droit : formulaire */}
      <div className="flex flex-1 flex-col">
        {/* En-tete mobile uniquement */}
        <header className="flex items-center justify-between px-6 py-5 lg:hidden border-b border-gray-100 dark:border-gray-800">
          <Link href="/" aria-label="Retour a l'accueil">
            <div className="flex items-center gap-2.5">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-green-600">
                <svg
                  className="h-4 w-4 text-white"
                  xmlns="http://www.w3.org/2000/svg"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  aria-hidden="true"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M7 21a4 4 0 01-4-4V5a2 2 0 012-2h4a2 2 0 012 2v12a4 4 0 01-4 4zm0 0h12a2 2 0 002-2v-4a2 2 0 00-2-2h-2.343M11 7.343l1.657-1.657a2 2 0 012.828 0l2.829 2.829a2 2 0 010 2.828l-8.486 8.485M7 17h.01"
                  />
                </svg>
              </div>
              <div className="flex flex-col leading-tight">
                <span className="text-sm font-bold text-gray-900 dark:text-white">DecarbonLeads</span>
                <span className="text-[9px] font-medium text-green-600 uppercase tracking-widest">by STROFE</span>
              </div>
            </div>
          </Link>
        </header>

        {/* Zone formulaire */}
        <main className="flex flex-1 items-center justify-center px-6 py-10 bg-gray-50 dark:bg-gray-950">
          <div className="w-full max-w-md">
            {children}
          </div>
        </main>

        {/* Pied de page */}
        <footer className="px-6 py-4 text-center border-t border-gray-100 dark:border-gray-800 bg-gray-50 dark:bg-gray-950">
          <p className="text-xs text-gray-400 dark:text-gray-500">
            &copy; 2026 STROFE &mdash; Tous droits reserves
          </p>
        </footer>
      </div>
    </div>
  )
}
