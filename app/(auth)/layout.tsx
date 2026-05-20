import type { Metadata } from "next"
import Link from "next/link"
import { GlanPortrait } from "@/components/glan/glan-portrait"

export const metadata: Metadata = {
  robots: { index: false, follow: false },
}

// ------------------------------------------------------------------ //
// Logo Glan                                                            //
// ------------------------------------------------------------------ //
function GlanLogo() {
  return (
    <div className="flex items-center gap-3">
      <div className="relative flex h-9 w-9 items-center justify-center">
        <div
          className="absolute inset-0 rounded-xl bg-gradient-to-br from-green-500/20 to-emerald-500/10 blur-sm"
          aria-hidden="true"
        />
        <div className="relative flex h-9 w-9 items-center justify-center rounded-xl border border-white/10 bg-white/[0.06]">
          <svg
            className="h-4 w-4 text-green-400"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={1.5}
            aria-hidden="true"
          >
            <circle cx="12" cy="12" r="9" />
            <path strokeLinecap="round" d="M12 3c-2.5 3-4 5.8-4 9s1.5 6 4 9" />
            <path strokeLinecap="round" d="M12 3c2.5 3 4 5.8 4 9s-1.5 6-4 9" />
            <path strokeLinecap="round" d="M3.5 9h17M3.5 15h17" />
          </svg>
        </div>
      </div>
      <div className="flex flex-col leading-tight">
        <span className="bg-gradient-to-br from-white to-green-200 bg-clip-text text-base font-bold tracking-tight text-transparent">
          Glan
        </span>
        <span className="font-mono text-[9px] uppercase tracking-[0.2em] text-cyan-400/70">
          Prospection BEGES — by STROFE
        </span>
      </div>
    </div>
  )
}

// ------------------------------------------------------------------ //
// Panneau gauche décoratif — Desktop only                             //
// ------------------------------------------------------------------ //

type AccentKey = "cyan" | "brand" | "violet" | "amber"

const PROOF_POINTS: Array<{
  accent: AccentKey
  title: string
  text: string
}> = [
  {
    accent: "cyan",
    title: "Sourcing à la demande",
    text: "Vous lancez Glan, il glane Sirene INSEE + le registre ADEME et vous livre les prospects qualifiés.",
  },
  {
    accent: "brand",
    title: "Scoring composite transparent",
    text: "3 piliers : taille entreprise, statut BEGES, contact identifié. Score 0-100 sur chaque prospect.",
  },
  {
    accent: "violet",
    title: "Données officielles certifiées",
    text: "Sources Sirene INSEE et registre ADEME BEGES — les seules références légales en France.",
  },
  {
    accent: "amber",
    title: "Obligation légale Art. L229-25",
    text: "Vos cibles sont soumises à l'obligation BEGES. Vous arrivez avec un mandat légal, pas une option.",
  },
]

const ACCENT_DOT: Record<AccentKey, string> = {
  brand: "bg-green-400",
  cyan: "bg-cyan-400",
  violet: "bg-violet-400",
  amber: "bg-amber-400",
}

const ACCENT_BORDER: Record<AccentKey, string> = {
  brand: "border-green-400/20",
  cyan: "border-cyan-400/20",
  violet: "border-violet-400/20",
  amber: "border-amber-400/20",
}

const ACCENT_TITLE: Record<AccentKey, string> = {
  brand: "text-green-300",
  cyan: "text-cyan-300",
  violet: "text-violet-300",
  amber: "text-amber-300",
}

function DecorativePanel() {
  return (
    <div
      className="hidden lg:flex lg:flex-col relative w-[480px] shrink-0 overflow-hidden"
      aria-hidden="true"
    >
      {/* Fond translucide — laisse passer le mesh global */}
      <div className="absolute inset-0 bg-white/[0.02] backdrop-blur-[2px]" />

      {/* Accents verticaux gauche / droite */}
      <div className="absolute left-0 inset-y-0 w-px bg-gradient-to-b from-transparent via-cyan-400/40 to-transparent" />
      <div className="absolute right-0 inset-y-0 w-px bg-gradient-to-b from-transparent via-green-400/30 to-transparent" />

      {/* Halos d'ambiance */}
      <div className="pointer-events-none absolute -top-40 left-1/2 -translate-x-1/2 h-80 w-80 rounded-full bg-green-500/5 blur-3xl" />
      <div className="pointer-events-none absolute bottom-0 -left-20 h-60 w-60 rounded-full bg-cyan-500/6 blur-3xl" />

      {/* Grille tech fine */}
      <div className="pointer-events-none absolute inset-0 opacity-[0.04]">
        <svg className="h-full w-full" xmlns="http://www.w3.org/2000/svg">
          <defs>
            <pattern id="auth-grid" width="40" height="40" patternUnits="userSpaceOnUse">
              <path d="M.5 40V.5H40" fill="none" stroke="white" strokeWidth="0.5" />
            </pattern>
          </defs>
          <rect width="100%" height="100%" fill="url(#auth-grid)" />
        </svg>
      </div>

      {/* Contenu */}
      <div className="relative flex flex-col h-full p-10">
        {/* Logo */}
        <Link href="/" aria-label="Retour à l'accueil">
          <GlanLogo />
        </Link>

        {/* Zone centrale */}
        <div className="flex-1 flex flex-col justify-center">
          {/* Indicateur statique — pas de mensonge "live" sur une page non auth */}
          <div className="mb-8 inline-flex items-center gap-2.5">
            <span className="relative flex h-2 w-2 shrink-0">
              <span className="relative inline-flex h-2 w-2 rounded-full bg-cyan-400/80" />
            </span>
            <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-cyan-400/80">
              Sourcing à la demande
            </span>
          </div>

          {/* Mascot + tagline */}
          <div className="mb-8 flex items-center gap-4">
            <GlanPortrait state="dormant" size={160} />
            <div>
              <p className="text-sm font-mono italic text-gray-400/80 leading-relaxed max-w-[260px]">
                &ldquo;Je glane Sirene et ADEME à la demande pour vous livrer
                des prospects BEGES qualifiés et prêts à appeler.&rdquo;
              </p>
              <p className="mt-2 font-mono text-[11px] italic text-green-400/70">— Glan</p>
            </div>
          </div>

          {/* Points de preuve — cards translucides */}
          <ul className="space-y-2.5">
            {PROOF_POINTS.map((point) => (
              <li
                key={point.title}
                className={`flex items-start gap-3 rounded-xl border bg-white/[0.03] p-3.5 backdrop-blur-sm ${ACCENT_BORDER[point.accent]}`}
              >
                <span
                  className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${ACCENT_DOT[point.accent]}`}
                />
                <div className="min-w-0">
                  <p className={`text-xs font-semibold leading-tight ${ACCENT_TITLE[point.accent]}`}>
                    {point.title}
                  </p>
                  <p className="mt-0.5 text-[11px] text-gray-400/80 leading-relaxed">
                    {point.text}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        </div>

        {/* Stat card bas — L229-25 */}
        <div className="mt-6 rounded-2xl border border-white/[0.08] bg-white/[0.04] backdrop-blur-md p-5">
          <div className="flex items-center gap-5">
            <div className="text-center shrink-0">
              <div className="bg-gradient-to-br from-white to-green-200 bg-clip-text text-2xl font-extrabold tabular-nums text-transparent">
                L. 229-25
              </div>
              <div className="font-mono text-[9px] uppercase tracking-[0.18em] text-green-400/70 mt-0.5">
                Code de l&apos;environnement
              </div>
            </div>
            <div className="h-10 w-px bg-white/10 shrink-0" />
            <div>
              <p className="text-xs text-gray-300 leading-relaxed">
                Obligation BEGES pour les entreprises de plus de 500 salariés.
                Vos prospects <span className="text-green-400">doivent</span> vous appeler.
              </p>
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
      {/* Panneau gauche décoratif — desktop uniquement */}
      <DecorativePanel />

      {/* Panneau droit : formulaire */}
      <div className="flex flex-1 flex-col">
        {/* En-tête mobile uniquement */}
        <header className="flex items-center justify-between px-6 py-5 lg:hidden border-b border-white/[0.06]">
          <Link href="/" aria-label="Retour à l'accueil">
            <div className="flex items-center gap-2.5">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg border border-white/10 bg-white/[0.06]">
                <svg
                  className="h-4 w-4 text-green-400"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={1.5}
                  aria-hidden="true"
                >
                  <circle cx="12" cy="12" r="9" />
                  <path strokeLinecap="round" d="M12 3c-2.5 3-4 5.8-4 9s1.5 6 4 9" />
                  <path strokeLinecap="round" d="M12 3c2.5 3 4 5.8 4 9s-1.5 6-4 9" />
                  <path strokeLinecap="round" d="M3.5 9h17M3.5 15h17" />
                </svg>
              </div>
              <div className="flex flex-col leading-tight">
                <span className="bg-gradient-to-br from-white to-green-200 bg-clip-text text-sm font-bold text-transparent">
                  Glan
                </span>
                <span className="font-mono text-[9px] uppercase tracking-widest text-cyan-400/70">
                  by STROFE
                </span>
              </div>
            </div>
          </Link>
        </header>

        {/* Zone formulaire */}
        <main className="flex flex-1 items-center justify-center px-6 py-10">
          <div className="w-full max-w-md">
            {children}
          </div>
        </main>

        {/* Pied de page */}
        <footer className="px-6 py-4 text-center border-t border-white/[0.06]">
          <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-gray-600">
            &copy; 2026 STROFE &mdash; Tous droits réservés
          </p>
        </footer>
      </div>
    </div>
  )
}
