import type { Metadata } from 'next'
import Link from 'next/link'
import { GlanHeroLoader } from '@/components/marketing/glan-hero-loader'

// GlanHero contient un canvas React Three Fiber. Next.js 15 interdit
// `ssr: false` dans un Server Component → le dynamic import est encapsulé
// dans <GlanHeroLoader> (Client Component dédié).

// Page publique marketing — opt-in à l'indexation (override du noindex global
// défini dans app/layout.tsx, qui s'applique aux routes dashboard/auth).
export const metadata: Metadata = {
  title: 'Glan — Vos prospects bilan carbone, qualifiés pendant la nuit',
  description:
    "Pendant que vous dormez, Glan scanne Sirene et ADEME pour identifier les entreprises soumises à l'obligation BEGES. Votre liste s'enrichit chaque nuit, vous gérez le pipeline commercial.",
  robots: { index: true, follow: true },
  openGraph: {
    title: 'Glan — Vos prospects bilan carbone, qualifiés pendant la nuit',
    description:
      'Sourcing nocturne Sirene + ADEME. Scoring transparent 3 piliers. Pipeline Kanban 8 statuts, multi-contacts, échanges horodatés.',
    type: 'website',
    locale: 'fr_FR',
  },
}

// ------------------------------------------------------------------ //
// Icones SVG inline                                                    //
// ------------------------------------------------------------------ //

function IconDatabase() {
  return (
    <svg
      className="h-6 w-6"
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={1.5}
      aria-hidden="true"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M20.25 6.375c0 2.278-3.694 4.125-8.25 4.125S3.75 8.653 3.75 6.375m16.5 0c0-2.278-3.694-4.125-8.25-4.125S3.75 4.097 3.75 6.375m16.5 0v11.25c0 2.278-3.694 4.125-8.25 4.125s-8.25-1.847-8.25-4.125V6.375m16.5 5.625c0 2.278-3.694 4.125-8.25 4.125s-8.25-1.847-8.25-4.125"
      />
    </svg>
  )
}

function IconSparkles() {
  return (
    <svg
      className="h-6 w-6"
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={1.5}
      aria-hidden="true"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M9.813 15.904 9 18.75l-.813-2.846a4.5 4.5 0 0 0-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 0 0 3.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 0 0 3.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 0 0-3.09 3.09ZM18.259 8.715 18 9.75l-.259-1.035a3.375 3.375 0 0 0-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 0 0 2.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 0 0 2.456 2.456L21.75 6l-1.035.259a3.375 3.375 0 0 0-2.456 2.456Z"
      />
    </svg>
  )
}

function IconPhone() {
  return (
    <svg
      className="h-6 w-6"
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={1.5}
      aria-hidden="true"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M2.25 6.75c0 8.284 6.716 15 15 15h2.25a2.25 2.25 0 0 0 2.25-2.25v-1.372c0-.516-.351-.966-.852-1.091l-4.423-1.106c-.44-.11-.902.055-1.173.417l-.97 1.293c-.282.376-.769.542-1.21.38a12.035 12.035 0 0 1-7.143-7.143c-.162-.441.004-.928.38-1.21l1.293-.97c.363-.271.527-.734.417-1.173L6.963 3.102a1.125 1.125 0 0 0-1.091-.852H4.5A2.25 2.25 0 0 0 2.25 4.5v2.25Z"
      />
    </svg>
  )
}

function IconSearch() {
  return (
    <svg
      className="h-5 w-5"
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={1.5}
      aria-hidden="true"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z"
      />
    </svg>
  )
}

function IconChart() {
  return (
    <svg
      className="h-5 w-5"
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={1.5}
      aria-hidden="true"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 0 1 3 19.875v-6.75ZM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 0 1-1.125-1.125V8.625ZM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 0 1-1.125-1.125V4.125Z"
      />
    </svg>
  )
}

function IconDocument() {
  return (
    <svg
      className="h-5 w-5"
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={1.5}
      aria-hidden="true"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z"
      />
    </svg>
  )
}

function IconLightning() {
  return (
    <svg
      className="h-5 w-5"
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={1.5}
      aria-hidden="true"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="m3.75 13.5 10.5-11.25L12 10.5h8.25L9.75 21.75 12 13.5H3.75Z"
      />
    </svg>
  )
}

// ------------------------------------------------------------------ //
// Section : Statistiques (style BentoCell glass)                     //
// ------------------------------------------------------------------ //

const STATS = [
  {
    value: 'L. 229-25',
    label: 'Article BEGES',
    sublabel: "L'obligation sur laquelle je travaille",
    valueGradient: 'from-white to-cyan-200',
    labelColor: 'text-cyan-400/80',
    accentTop:
      'before:bg-gradient-to-r before:from-transparent before:via-cyan-400/60 before:to-transparent',
    accentGlow:
      'hover:shadow-[0_0_0_1px_oklch(70%_0.16_188_/_0.35),0_8px_32px_-8px_oklch(70%_0.16_188_/_0.25)]',
  },
  {
    value: '3',
    label: 'Piliers de scoring',
    sublabel: 'Taille / BEGES / Contact — paramétrables',
    valueGradient: 'from-white to-green-200',
    labelColor: 'text-green-400/80',
    accentTop:
      'before:bg-gradient-to-r before:from-transparent before:via-green-400/60 before:to-transparent',
    accentGlow:
      'hover:shadow-[0_0_0_1px_oklch(70%_0.18_152_/_0.35),0_8px_32px_-8px_oklch(70%_0.18_152_/_0.25)]',
  },
  {
    value: '8',
    label: 'Statuts du pipeline',
    sublabel: 'Sourcé → Qualifié → … → Converti',
    valueGradient: 'from-white to-violet-200',
    labelColor: 'text-violet-400/80',
    accentTop:
      'before:bg-gradient-to-r before:from-transparent before:via-violet-400/60 before:to-transparent',
    accentGlow:
      'hover:shadow-[0_0_0_1px_oklch(70%_0.18_285_/_0.35),0_8px_32px_-8px_oklch(70%_0.18_285_/_0.25)]',
  },
] as const

function StatsSection() {
  return (
    <section className="py-14 px-6 lg:px-8">
      <div className="mx-auto max-w-5xl">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          {STATS.map((stat) => (
            <div
              key={stat.label}
              className={`relative rounded-2xl border border-white/[0.08] bg-white/[0.025] p-6 text-center backdrop-blur-md transition-all duration-300 hover:-translate-y-0.5 hover:border-white/15 ${stat.accentGlow} before:absolute before:inset-x-4 before:top-0 before:h-px ${stat.accentTop}`}
            >
              <div
                className={`bg-gradient-to-br ${stat.valueGradient} bg-clip-text text-5xl font-bold tabular-nums tracking-tight text-transparent`}
              >
                {stat.value}
              </div>
              <div
                className={`mt-2 font-mono text-[10px] uppercase tracking-[0.18em] ${stat.labelColor}`}
              >
                {stat.label}
              </div>
              <div className="mt-1 text-xs leading-relaxed text-gray-400">
                {stat.sublabel}
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}

// ------------------------------------------------------------------ //
// Section : Comment ça marche (3 étapes)                             //
// ------------------------------------------------------------------ //

const HOW_STEPS = [
  {
    step: '01',
    stepGradient: 'from-white to-cyan-200',
    dotColor: 'bg-cyan-400',
    icon: <IconDatabase />,
    iconAccent: 'bg-cyan-500/10 ring-1 ring-cyan-500/20 text-cyan-300',
    accentTop:
      'before:bg-gradient-to-r before:from-transparent before:via-cyan-400/60 before:to-transparent',
    accentGlow:
      'hover:shadow-[0_0_0_1px_oklch(70%_0.16_188_/_0.35),0_8px_32px_-8px_oklch(70%_0.16_188_/_0.25)]',
    title: 'Je scanne Sirene et ADEME',
    description:
      "Chaque nuit, je parcours Sirene (INSEE) et l'ADEME. J'identifie les entreprises soumises à l'obligation Article L. 229-25 dans vos secteurs cibles.",
    tag: 'Sourcing nocturne',
    tagClass: 'bg-cyan-500/10 text-cyan-300 ring-1 ring-cyan-500/20',
  },
  {
    step: '02',
    stepGradient: 'from-white to-violet-200',
    dotColor: 'bg-violet-400',
    icon: <IconSparkles />,
    iconAccent: 'bg-violet-500/10 ring-1 ring-violet-500/20 text-violet-300',
    accentTop:
      'before:bg-gradient-to-r before:from-transparent before:via-violet-400/60 before:to-transparent',
    accentGlow:
      'hover:shadow-[0_0_0_1px_oklch(70%_0.18_285_/_0.35),0_8px_32px_-8px_oklch(70%_0.18_285_/_0.25)]',
    title: 'Je score sur 3 piliers',
    description:
      'Chaque prospect reçoit un score 0-100 sur trois axes : taille, BEGES (publié, valide, échu), qualité du contact. Pondérations modifiables.',
    tag: 'Scoring transparent',
    tagClass: 'bg-violet-500/10 text-violet-300 ring-1 ring-violet-500/20',
  },
  {
    step: '03',
    stepGradient: 'from-white to-green-200',
    dotColor: 'bg-green-400',
    icon: <IconPhone />,
    iconAccent: 'bg-green-500/10 ring-1 ring-green-500/20 text-green-300',
    accentTop:
      'before:bg-gradient-to-r before:from-transparent before:via-green-400/60 before:to-transparent',
    accentGlow:
      'hover:shadow-[0_0_0_1px_oklch(70%_0.18_152_/_0.35),0_8px_32px_-8px_oklch(70%_0.18_152_/_0.25)]',
    title: 'Vous pilotez la relation',
    description:
      "Les prospects prioritaires sont enrichis (dirigeants, emails). Vous gérez le pipeline en 8 statuts, multi-contacts par prospect et journal d'échanges horodaté.",
    tag: 'Pipeline commercial',
    tagClass: 'bg-green-500/10 text-green-300 ring-1 ring-green-500/20',
  },
] as const

function HowItWorksSection() {
  return (
    <section className="py-24 px-6 lg:px-8">
      <div className="mx-auto max-w-5xl">
        <div className="mb-16 text-center">
          <p className="mb-3 font-mono text-[10px] uppercase tracking-[0.18em] text-cyan-400/80">
            Comment ça marche
          </p>
          <h2 className="bg-gradient-to-br from-white to-gray-300 bg-clip-text text-3xl font-bold tracking-tight text-transparent sm:text-4xl">
            Trois étapes, exécutées chaque nuit
          </h2>
          <p className="mx-auto mt-4 max-w-xl text-sm leading-relaxed text-gray-400">
            Trois étapes, exécutées chaque nuit, transparentes du début à la
            fin.
          </p>
        </div>

        <div className="relative">
          {/* Ligne de connexion desktop */}
          <div
            className="absolute top-16 right-0 left-0 hidden h-px bg-gradient-to-r from-transparent via-cyan-400/30 to-transparent lg:block"
            aria-hidden="true"
          />

          <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
            {HOW_STEPS.map((item) => (
              <div
                key={item.step}
                className={`group relative flex flex-col items-center rounded-2xl border border-white/[0.08] bg-white/[0.025] p-8 text-center backdrop-blur-md transition-all duration-300 hover:-translate-y-1 hover:border-white/15 ${item.accentGlow} before:absolute before:inset-x-4 before:top-0 before:h-px ${item.accentTop}`}
              >
                {/* Numéro d'étape */}
                <div className="absolute -top-4 left-1/2 flex h-8 w-8 -translate-x-1/2 items-center justify-center rounded-full border border-white/[0.12] bg-white/[0.05] backdrop-blur-sm">
                  <span
                    className={`absolute h-2 w-2 rounded-full ${item.dotColor} opacity-80`}
                    aria-hidden="true"
                  />
                  <span
                    className={`bg-gradient-to-br ${item.stepGradient} bg-clip-text font-mono text-[10px] font-bold tracking-wider text-transparent`}
                  >
                    {item.step}
                  </span>
                </div>

                {/* Icone */}
                <div
                  className={`mt-4 flex h-14 w-14 items-center justify-center rounded-2xl ${item.iconAccent} transition-all duration-300 group-hover:ring-2`}
                >
                  {item.icon}
                </div>

                <h3 className="mt-5 text-lg font-bold text-white">
                  {item.title}
                </h3>
                <p className="mt-3 text-sm leading-relaxed text-gray-300">
                  {item.description}
                </p>

                {/* Tag */}
                <span
                  className={`mt-5 inline-flex items-center rounded-full px-3 py-1 font-mono text-[10px] uppercase tracking-[0.12em] ${item.tagClass}`}
                >
                  {item.tag}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  )
}

// ------------------------------------------------------------------ //
// Section : Fonctionnalités (grille 4 cartes)                        //
// ------------------------------------------------------------------ //

const FEATURES = [
  {
    icon: <IconSearch />,
    title: 'Source Sirene officielle',
    description:
      "J'interroge directement la base Sirene de l'INSEE. Filtrage par tranche d'effectif, code NAF, zone géographique. Données à jour à 24 heures près.",
    iconAccent: 'bg-cyan-500/10 ring-1 ring-cyan-500/20 text-cyan-300',
    accentTop:
      'before:bg-gradient-to-r before:from-transparent before:via-cyan-400/60 before:to-transparent',
    accentGlow:
      'hover:shadow-[0_0_0_1px_oklch(70%_0.16_188_/_0.35),0_8px_32px_-8px_oklch(70%_0.16_188_/_0.25)]',
    label: '[01] Sourcing',
    labelColor: 'text-cyan-400/80',
  },
  {
    icon: <IconChart />,
    title: 'Scoring transparent 3 piliers',
    description:
      'Aucune boîte noire. Taille (effectif), BEGES (publié, valide, échu), contact (dirigeant identifié, email vérifié). Vous voyez le détail pilier par pilier.',
    iconAccent: 'bg-violet-500/10 ring-1 ring-violet-500/20 text-violet-300',
    accentTop:
      'before:bg-gradient-to-r before:from-transparent before:via-violet-400/60 before:to-transparent',
    accentGlow:
      'hover:shadow-[0_0_0_1px_oklch(70%_0.18_285_/_0.35),0_8px_32px_-8px_oklch(70%_0.18_285_/_0.25)]',
    label: '[02] Scoring',
    labelColor: 'text-violet-400/80',
  },
  {
    icon: <IconDocument />,
    title: 'Croisement ADEME BEGES',
    description:
      "Pour chaque entreprise sourcée, je vérifie auprès de l'ADEME : un BEGES a-t-il été publié, à quelle date, pour quelle année. Signal direct des entreprises en retard d'obligation.",
    iconAccent: 'bg-amber-500/10 ring-1 ring-amber-500/20 text-amber-300',
    accentTop:
      'before:bg-gradient-to-r before:from-transparent before:via-amber-400/60 before:to-transparent',
    accentGlow:
      'hover:shadow-[0_0_0_1px_oklch(78%_0.15_75_/_0.35),0_8px_32px_-8px_oklch(78%_0.15_75_/_0.25)]',
    label: '[03] ADEME',
    labelColor: 'text-amber-400/80',
  },
  {
    icon: <IconLightning />,
    title: 'Pipeline 8 statuts',
    description:
      'Sourcé → Qualifié → Contacté → Intéressé → Offre envoyée → Converti. Multi-contacts par prospect (DG, DAF, RSE). Échanges horodatés et typés (appel, email, RDV).',
    iconAccent: 'bg-green-500/10 ring-1 ring-green-500/20 text-green-300',
    accentTop:
      'before:bg-gradient-to-r before:from-transparent before:via-green-400/60 before:to-transparent',
    accentGlow:
      'hover:shadow-[0_0_0_1px_oklch(70%_0.18_152_/_0.35),0_8px_32px_-8px_oklch(70%_0.18_152_/_0.25)]',
    label: '[04] Pipeline',
    labelColor: 'text-green-400/80',
  },
] as const

function FeaturesSection() {
  return (
    <section className="py-24 px-6 lg:px-8">
      <div className="mx-auto max-w-5xl">
        <div className="mb-16 text-center">
          <p className="mb-3 font-mono text-[10px] uppercase tracking-[0.18em] text-green-400/80">
            Ce que je fais, concrètement
          </p>
          <h2 className="bg-gradient-to-br from-white to-gray-300 bg-clip-text text-3xl font-bold tracking-tight text-transparent sm:text-4xl">
            Sirene, ADEME, scoring, pipeline.
          </h2>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {FEATURES.map((feature) => (
            <div
              key={feature.title}
              className={`group relative cursor-default rounded-2xl border border-white/[0.08] bg-white/[0.025] p-7 backdrop-blur-md transition-all duration-300 hover:-translate-y-0.5 hover:border-white/15 ${feature.accentGlow} before:absolute before:inset-x-4 before:top-0 before:h-px ${feature.accentTop}`}
            >
              {/* Label mono */}
              <span
                className={`font-mono text-[10px] uppercase tracking-[0.18em] ${feature.labelColor}`}
              >
                {feature.label}
              </span>

              {/* Icone */}
              <div
                className={`mt-3 inline-flex h-11 w-11 items-center justify-center rounded-xl ${feature.iconAccent} transition-all duration-300 group-hover:ring-2`}
              >
                {feature.icon}
              </div>

              <h3 className="mt-4 text-base font-bold text-white">
                {feature.title}
              </h3>
              <p className="mt-2 text-sm leading-relaxed text-gray-300">
                {feature.description}
              </p>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}

// ------------------------------------------------------------------ //
// Section : CTA final                                                 //
// ------------------------------------------------------------------ //
function CtaSection() {
  return (
    <section className="py-24 px-6 lg:px-8">
      <div className="mx-auto max-w-3xl">
        {/* Panneau glass — border accent + radial mesh interne */}
        <div className="relative overflow-hidden rounded-3xl border border-white/[0.10] bg-white/[0.03] p-12 text-center shadow-[0_0_0_1px_oklch(70%_0.18_152_/_0.20),0_24px_64px_-12px_oklch(70%_0.18_152_/_0.18)] backdrop-blur-md">
          {/* Radial brand glow au centre */}
          <div
            className="pointer-events-none absolute inset-0 rounded-3xl"
            aria-hidden="true"
            style={{
              background:
                'radial-gradient(ellipse 70% 60% at 50% 50%, oklch(32% 0.12 152 / 0.40) 0%, transparent 70%)',
            }}
          />

          {/* Grille tech subtile */}
          <div
            className="pointer-events-none absolute inset-0 rounded-3xl"
            aria-hidden="true"
          >
            <svg
              className="h-full w-full"
              xmlns="http://www.w3.org/2000/svg"
            >
              <defs>
                <pattern
                  id="cta-grid"
                  width="40"
                  height="40"
                  patternUnits="userSpaceOnUse"
                >
                  <path
                    d="M.5 40V.5H40"
                    fill="none"
                    stroke="white"
                    strokeWidth="0.3"
                  />
                </pattern>
              </defs>
              <rect
                width="100%"
                height="100%"
                fill="url(#cta-grid)"
                opacity="0.06"
              />
            </svg>
          </div>

          {/* Accent top */}
          <div
            className="pointer-events-none absolute inset-x-12 top-0 h-px bg-gradient-to-r from-transparent via-green-400/50 to-transparent"
            aria-hidden="true"
          />

          <div className="relative">
            <p className="mb-4 font-mono text-[10px] uppercase tracking-[0.18em] text-green-400/80">
              Démarrer
            </p>

            <h2 className="bg-gradient-to-br from-white to-green-200 bg-clip-text text-3xl font-extrabold tracking-tight text-transparent sm:text-4xl">
              Prêt à laisser un agent travailler la nuit pour vous ?
            </h2>
            <p className="mx-auto mt-4 max-w-xl text-base leading-relaxed text-gray-300">
              Configuration en 5 minutes : votre offre, vos secteurs cibles,
              vos pondérations de scoring. À partir de la nuit suivante, votre
              liste de prospects BEGES s&apos;enrichit toute seule.
            </p>

            <div className="mt-10 flex flex-col justify-center gap-4 sm:flex-row">
              {/* Bouton primary glow */}
              <Link
                href="/signup"
                className="inline-flex items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-green-500 to-emerald-500 px-7 py-3.5 font-bold text-white shadow-[0_0_20px_-4px_oklch(70%_0.19_152_/_0.55)] transition-all duration-200 hover:-translate-y-0.5 hover:shadow-[0_0_28px_-2px_oklch(70%_0.19_152_/_0.70)] active:scale-95"
              >
                Activer l&apos;agent
                <svg
                  className="h-4 w-4"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={2.5}
                  aria-hidden="true"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M5 12h14m-7-7 7 7-7 7"
                  />
                </svg>
              </Link>
              {/* Bouton ghost glass */}
              <Link
                href="/login"
                className="inline-flex items-center justify-center rounded-xl border border-white/10 bg-white/[0.05] px-7 py-3.5 font-semibold text-gray-200 backdrop-blur transition-all duration-200 hover:-translate-y-0.5 hover:border-white/20 hover:bg-white/[0.06]/[0.10]"
              >
                Se connecter
              </Link>
            </div>

            <p className="mt-6 font-mono text-[11px] text-gray-500">— Glan</p>
          </div>
        </div>
      </div>
    </section>
  )
}

// ------------------------------------------------------------------ //
// Footer                                                              //
// ------------------------------------------------------------------ //
function Footer() {
  return (
    <footer className="border-t border-white/[0.06] px-6 py-8">
      <div className="mx-auto flex max-w-5xl flex-col items-center justify-between gap-4 sm:flex-row">
        {/* Logo Glan */}
        <div className="flex items-center gap-2.5">
          <div className="flex h-7 w-7 items-center justify-center rounded-lg border border-green-500/20 bg-green-500/10">
            <svg
              className="h-4 w-4 text-green-400"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={1.8}
              aria-hidden="true"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="m3.75 13.5 10.5-11.25L12 10.5h8.25L9.75 21.75 12 13.5H3.75Z"
              />
            </svg>
          </div>
          <span className="bg-gradient-to-r from-green-400 to-emerald-300 bg-clip-text text-sm font-bold text-transparent">
            Glan
          </span>
          <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-gray-600">
            by STROFE
          </span>
        </div>

        {/* Copyright */}
        <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-gray-600">
          &copy; 2026 STROFE
        </p>

        {/* Nav */}
        <nav className="flex gap-5" aria-label="Liens pied de page">
          <Link
            href="/login"
            className="text-xs text-gray-500 transition-colors duration-150 hover:text-gray-300"
          >
            Connexion
          </Link>
          <Link
            href="/signup"
            className="text-xs text-gray-500 transition-colors duration-150 hover:text-gray-300"
          >
            Inscription
          </Link>
        </nav>
      </div>
    </footer>
  )
}

// ------------------------------------------------------------------ //
// Page principale                                                      //
// ------------------------------------------------------------------ //
export default function HomePage() {
  return (
    <div className="min-h-screen">
      {/* Hero refondu — orbe 3D R3F + copy persona Glan. */}
      <GlanHeroLoader />
      <StatsSection />
      <HowItWorksSection />
      <FeaturesSection />
      <CtaSection />
      <Footer />
    </div>
  )
}
