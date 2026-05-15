// ============================================================
// /onboarding — Accueil Glan pour les nouveaux comptes
//
// MVP : présentation de Glan + checklist des étapes de config +
// bouton "Configurer mon profil" vers /settings.
// ============================================================

import { redirect } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { GlanCharacterLoader } from '@/components/glan/glan-character-loader'
import { BorderBeam } from '@/components/ui/border-beam'

export const metadata = {
  title: 'Bienvenue — Glan',
}

export default async function OnboardingPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) redirect('/login')

  // Si le profil est déjà onboardé, on évite la boucle et on redirige.
  const { data: profile } = await supabase
    .from('profiles')
    .select('onboarded')
    .eq('id', user.id)
    .maybeSingle()

  if (profile?.onboarded) redirect('/dashboard')

  return (
    <div className="mx-auto w-full max-w-xl space-y-8">
      {/* Hero Glan */}
      <div className="flex flex-col items-center gap-5 text-center">
        <div className="relative">
          {/* Halo d'ambiance derrière l'avatar */}
          <div
            className="absolute -inset-6 rounded-full bg-green-500/8 blur-2xl"
            aria-hidden="true"
          />
          <GlanCharacterLoader state="working" size={200} fallbackSize="lg" />
        </div>

        <div className="space-y-2">
          {/* Label tech au-dessus du titre */}
          <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-cyan-400/80">
            {'// Init · Première connexion'}
          </p>
          <h1 className="bg-gradient-to-br from-white to-green-200 bg-clip-text text-3xl font-bold tracking-tight text-transparent">
            Bienvenue. Je suis Glan.
          </h1>
          <p className="text-sm text-gray-400 leading-relaxed max-w-[380px] mx-auto">
            Je scanne chaque nuit Sirene et ADEME pour vous livrer de nouveaux
            prospects BEGES qualifiés. Pour démarrer, j&apos;ai besoin de
            comprendre votre offre et vos cibles.
          </p>
          <p className="font-mono text-[11px] italic text-green-400/70">— Glan</p>
        </div>
      </div>

      {/* Checklist étapes — BentoCell-like glass avec accents rotatifs */}
      <ul className="space-y-3" aria-label="Étapes de configuration">
        <ChecklistStep
          done={false}
          index={1}
          accent="brand"
          title="Configurer votre offre"
          description="Description courte de votre service de conseil bilan carbone."
        />
        <ChecklistStep
          done={false}
          index={2}
          accent="cyan"
          title="Choisir vos secteurs cibles"
          description="Industrie, BTP, transport, distribution… Glan s'en sert pour filtrer Sirene."
        />
        <ChecklistStep
          done={false}
          index={3}
          accent="violet"
          title="Définir votre zone géographique"
          description="Ville ou codes postaux — Glan peut aussi sourcer toute la France."
        />
        <ChecklistStep
          done={false}
          index={4}
          accent="amber"
          title="Calibrer les pondérations de scoring"
          description="3 piliers : taille / BEGES / contact (défaut 30/30/40)."
        />
      </ul>

      {/* CTA gradient + glow + BorderBeam pour signaler l'action attendue. */}
      <div className="flex justify-center">
        <BorderBeam color="brand" thickness={1.5} className="inline-flex">
        <Link
          href="/settings"
          className="group inline-flex items-center gap-2.5 rounded-xl bg-gradient-to-r from-green-500 to-emerald-500 px-7 py-3.5 text-base font-semibold text-white shadow-[0_0_20px_-4px_oklch(70%_0.19_152_/_0.5)] transition-all hover:shadow-[0_0_28px_-2px_oklch(70%_0.19_152_/_0.7)] active:scale-[0.98]"
        >
          Configurer mon profil
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="15"
            height="15"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="transition-transform group-hover:translate-x-0.5"
            aria-hidden="true"
          >
            <line x1="5" y1="12" x2="19" y2="12" />
            <polyline points="12 5 19 12 12 19" />
          </svg>
        </Link>
        </BorderBeam>
      </div>
    </div>
  )
}

// ------------------------------------------------------------------ //
// ChecklistStep — card translucide avec accent rotatif               //
// ------------------------------------------------------------------ //

type AccentColor = 'brand' | 'cyan' | 'violet' | 'amber'

const STEP_ACCENT_BORDER: Record<AccentColor, string> = {
  brand: 'border-green-400/25',
  cyan: 'border-cyan-400/25',
  violet: 'border-violet-400/25',
  amber: 'border-amber-400/25',
}

const STEP_ACCENT_BADGE: Record<AccentColor, string> = {
  brand: 'border-green-400/30 bg-green-400/10 text-green-400',
  cyan: 'border-cyan-400/30 bg-cyan-400/10 text-cyan-400',
  violet: 'border-violet-400/30 bg-violet-400/10 text-violet-400',
  amber: 'border-amber-400/30 bg-amber-400/10 text-amber-400',
}

const STEP_ACCENT_TITLE: Record<AccentColor, string> = {
  brand: 'text-green-300',
  cyan: 'text-cyan-300',
  violet: 'text-violet-300',
  amber: 'text-amber-300',
}

const STEP_ACCENT_DOT: Record<AccentColor, string> = {
  brand: 'bg-green-500',
  cyan: 'bg-cyan-500',
  violet: 'bg-violet-500',
  amber: 'bg-amber-500',
}

function ChecklistStep({
  done,
  index,
  accent,
  title,
  description,
}: {
  done: boolean
  index: number
  accent: AccentColor
  title: string
  description: string
}) {
  return (
    <li
      className={`relative flex items-start gap-4 rounded-xl border bg-white/[0.03] p-4 backdrop-blur-sm transition-all hover:bg-white/[0.06] ${STEP_ACCENT_BORDER[accent]}`}
    >
      {/* Badge numéro / check */}
      <span
        aria-hidden="true"
        className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border font-mono text-[11px] font-bold ${
          done
            ? `${STEP_ACCENT_DOT[accent]} border-transparent text-white`
            : STEP_ACCENT_BADGE[accent]
        }`}
      >
        {done ? (
          <svg className="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
            <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
          </svg>
        ) : (
          String(index).padStart(2, '0')
        )}
      </span>

      <div className="flex-1 min-w-0">
        <p className={`text-sm font-semibold leading-tight ${STEP_ACCENT_TITLE[accent]}`}>
          {title}
        </p>
        <p className="mt-0.5 text-xs text-gray-400 leading-relaxed">
          {description}
        </p>
      </div>

      {/* Indicateur "à faire" */}
      {!done && (
        <span
          aria-label="En attente"
          className="mt-1 font-mono text-[9px] uppercase tracking-[0.14em] text-gray-600 shrink-0 dark:text-gray-400"
        >
          À faire
        </span>
      )}
    </li>
  )
}
