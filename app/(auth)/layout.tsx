import type { Metadata } from 'next'
import Link from 'next/link'

export const metadata: Metadata = {
  robots: { index: false, follow: false },
}

// ---------------------------------------------------------------
// Logo STROFE — SVG inline (pas de dépendance image)
// ---------------------------------------------------------------
function StrofeLogo() {
  return (
    <div className="flex items-center gap-2.5">
      {/* Icône feuille / bilan carbone */}
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
        <span className="text-base font-bold text-gray-900 tracking-tight">DecarbonLeads</span>
        <span className="text-[10px] font-medium text-green-600 uppercase tracking-widest">by STROFE</span>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------
// Layout auth — centré, fond doux, sans sidebar
// ---------------------------------------------------------------
export default function AuthLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 via-green-50/30 to-gray-100 flex flex-col">
      {/* En-tête minimal */}
      <header className="flex items-center justify-center py-6 px-4">
        <Link href="/" aria-label="Retour à l'accueil">
          <StrofeLogo />
        </Link>
      </header>

      {/* Contenu centré */}
      <main className="flex flex-1 items-center justify-center px-4 py-8">
        <div className="w-full max-w-md">
          {children}
        </div>
      </main>

      {/* Pied de page minimal */}
      <footer className="py-6 px-4 text-center">
        <p className="text-xs text-gray-400">
          &copy; {new Date().getFullYear()} STROFE — Tous droits réservés
        </p>
      </footer>
    </div>
  )
}
