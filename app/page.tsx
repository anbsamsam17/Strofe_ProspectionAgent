import Link from "next/link"

// ------------------------------------------------------------------ //
// Icones SVG inline                                                    //
// ------------------------------------------------------------------ //

function IconDatabase() {
  return (
    <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5} aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" d="M20.25 6.375c0 2.278-3.694 4.125-8.25 4.125S3.75 8.653 3.75 6.375m16.5 0c0-2.278-3.694-4.125-8.25-4.125S3.75 4.097 3.75 6.375m16.5 0v11.25c0 2.278-3.694 4.125-8.25 4.125s-8.25-1.847-8.25-4.125V6.375m16.5 5.625c0 2.278-3.694 4.125-8.25 4.125s-8.25-1.847-8.25-4.125" />
    </svg>
  )
}

function IconSparkles() {
  return (
    <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5} aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904 9 18.75l-.813-2.846a4.5 4.5 0 0 0-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 0 0 3.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 0 0 3.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 0 0-3.09 3.09ZM18.259 8.715 18 9.75l-.259-1.035a3.375 3.375 0 0 0-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 0 0 2.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 0 0 2.456 2.456L21.75 6l-1.035.259a3.375 3.375 0 0 0-2.456 2.456Z" />
    </svg>
  )
}

function IconPhone() {
  return (
    <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5} aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 6.75c0 8.284 6.716 15 15 15h2.25a2.25 2.25 0 0 0 2.25-2.25v-1.372c0-.516-.351-.966-.852-1.091l-4.423-1.106c-.44-.11-.902.055-1.173.417l-.97 1.293c-.282.376-.769.542-1.21.38a12.035 12.035 0 0 1-7.143-7.143c-.162-.441.004-.928.38-1.21l1.293-.97c.363-.271.527-.734.417-1.173L6.963 3.102a1.125 1.125 0 0 0-1.091-.852H4.5A2.25 2.25 0 0 0 2.25 4.5v2.25Z" />
    </svg>
  )
}

function IconSearch() {
  return (
    <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5} aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z" />
    </svg>
  )
}

function IconChart() {
  return (
    <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5} aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 0 1 3 19.875v-6.75ZM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 0 1-1.125-1.125V8.625ZM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 0 1-1.125-1.125V4.125Z" />
    </svg>
  )
}

function IconDocument() {
  return (
    <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5} aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z" />
    </svg>
  )
}

function IconLightning() {
  return (
    <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5} aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" d="m3.75 13.5 10.5-11.25L12 10.5h8.25L9.75 21.75 12 13.5H3.75Z" />
    </svg>
  )
}

// ------------------------------------------------------------------ //
// Composant : badge de statut actif                                   //
// ------------------------------------------------------------------ //
function ActiveBadge() {
  return (
    <div className="inline-flex items-center gap-2 bg-green-50 dark:bg-green-950/60 border border-green-200 dark:border-green-800 text-green-700 dark:text-green-400 px-3.5 py-1.5 rounded-full text-sm font-medium">
      <span className="relative flex h-2 w-2">
        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-500 opacity-75" />
        <span className="relative inline-flex rounded-full h-2 w-2 bg-green-500" />
      </span>
      Agent IA actif — prochaine liste dans{" "}
      <span className="font-bold tabular-nums">06h 23m</span>
    </div>
  )
}

// ------------------------------------------------------------------ //
// Composant : grille de fond décorative                              //
// ------------------------------------------------------------------ //
function GridBackground() {
  return (
    <div
      className="pointer-events-none absolute inset-0 -z-10 overflow-hidden"
      aria-hidden="true"
    >
      {/* Grille SVG */}
      <svg
        className="absolute inset-0 h-full w-full stroke-gray-200/60 dark:stroke-gray-700/40 [mask-image:radial-gradient(100%_100%_at_top_center,white,transparent)]"
        aria-hidden="true"
      >
        <defs>
          <pattern id="grid" width="60" height="60" patternUnits="userSpaceOnUse">
            <path d="M.5 60V.5H60" fill="none" />
          </pattern>
        </defs>
        <rect width="100%" height="100%" strokeWidth={0} fill="url(#grid)" />
      </svg>
      {/* Tache lumineuse verte */}
      <div className="absolute left-1/2 top-0 -translate-x-1/2 h-[40rem] w-[60rem] rounded-full bg-green-400/10 dark:bg-green-500/5 blur-3xl" />
    </div>
  )
}

// ------------------------------------------------------------------ //
// Section : Hero                                                       //
// ------------------------------------------------------------------ //
function HeroSection() {
  return (
    <section className="relative isolate px-6 pt-16 pb-20 sm:pt-24 sm:pb-28 lg:px-8">
      <GridBackground />

      <div className="mx-auto max-w-3xl text-center">
        <div className="mb-8 flex justify-center animate-fade-in-up opacity-0 animation-delay-100">
          <ActiveBadge />
        </div>

        <h1 className="text-5xl sm:text-6xl lg:text-7xl font-extrabold tracking-tight text-gray-900 dark:text-white leading-[1.1] animate-fade-in-up opacity-0 animation-delay-200">
          15 appels qualifiés.{" "}
          <br className="hidden sm:block" />
          <span
            className="animate-gradient bg-gradient-to-r from-green-500 via-emerald-400 to-green-600 bg-clip-text text-transparent"
          >
            Chaque matin.
          </span>
        </h1>

        <p className="mt-6 text-lg sm:text-xl text-gray-600 dark:text-gray-400 max-w-2xl mx-auto leading-relaxed animate-fade-in-up opacity-0 animation-delay-300">
          L&apos;agent source les entreprises dans Sirene et ADEME, score leur potentiel bilan carbone,
          et génère votre pitch personnalisé — pendant que vous dormez.
          Vous n&apos;avez plus qu&apos;à décrocher le téléphone.
        </p>

        <div className="mt-10 flex flex-col sm:flex-row gap-4 justify-center animate-fade-in-up opacity-0 animation-delay-400">
          <Link
            href="/signup"
            className="group inline-flex items-center justify-center gap-2 px-7 py-3.5 bg-green-600 hover:bg-green-700 text-white font-semibold rounded-xl shadow-lg shadow-green-500/20 hover:shadow-green-500/30 transition-all duration-200 hover:-translate-y-0.5"
          >
            Commencer gratuitement
            <svg className="h-4 w-4 transition-transform group-hover:translate-x-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5} aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5 21 12m0 0-7.5 7.5M21 12H3" />
            </svg>
          </Link>
          <Link
            href="/login"
            className="inline-flex items-center justify-center px-7 py-3.5 border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 font-semibold rounded-xl hover:bg-gray-50 dark:hover:bg-gray-800/60 backdrop-blur transition-all duration-200"
          >
            Se connecter
          </Link>
        </div>

        {/* Indicateur de confiance */}
        <p className="mt-6 text-sm text-gray-400 dark:text-gray-500 animate-fade-in-up opacity-0 animation-delay-500">
          Aucune carte bancaire requise &middot; Gratuit pendant 30 jours
        </p>
      </div>
    </section>
  )
}

// ------------------------------------------------------------------ //
// Section : Statistiques                                              //
// ------------------------------------------------------------------ //
function StatsSection() {
  const stats = [
    { value: "500+", label: "Entreprises sourcées", sublabel: "par nuit, automatiquement" },
    { value: "15", label: "Appels par jour", sublabel: "prêts à 7h30 chaque matin" },
    { value: "0", label: "Effort de recherche", sublabel: "l'agent fait tout en amont" },
  ]

  return (
    <section className="py-12 border-y border-gray-100 dark:border-gray-800 bg-gray-50/50 dark:bg-gray-900/50">
      <div className="mx-auto max-w-5xl px-6 lg:px-8">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-8 sm:divide-x divide-gray-200 dark:divide-gray-700">
          {stats.map((stat) => (
            <div key={stat.label} className="text-center sm:px-8">
              <div className="text-4xl font-extrabold text-gray-900 dark:text-white tabular-nums">
                {stat.value}
              </div>
              <div className="mt-1 text-base font-semibold text-green-600 dark:text-green-400">
                {stat.label}
              </div>
              <div className="mt-0.5 text-sm text-gray-500 dark:text-gray-400">
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
// Section : Comment ca marche (3 étapes)                             //
// ------------------------------------------------------------------ //
function HowItWorksSection() {
  const steps = [
    {
      step: "01",
      icon: <IconDatabase />,
      title: "L\u2019agent source",
      description: "Chaque nuit, l\u2019agent interroge Sirene (INSEE) et les bases ADEME pour identifier les entreprises dont les obligations bilan carbone sont imminentes.",
      tag: "Sirene + ADEME",
      tagColor: "bg-blue-50 text-blue-700 dark:bg-blue-950/50 dark:text-blue-400",
    },
    {
      step: "02",
      icon: <IconSparkles />,
      title: "L\u2019IA qualifie",
      description: "Un algorithme de scoring multi-critères priorise les cibles. Claude Sonnet g\u00e9n\u00e8re ensuite un pitch personnalis\u00e9 avec les objections probables et les angles d\u2019accroche.",
      tag: "Scoring + Claude Sonnet",
      tagColor: "bg-purple-50 text-purple-700 dark:bg-purple-950/50 dark:text-purple-400",
    },
    {
      step: "03",
      icon: <IconPhone />,
      title: "Vous appelez",
      description: "A 7h30, votre liste des 15 meilleurs appels du jour est pr\u00eate. Chaque fiche contient le pitch, les donn\u00e9es BEGES et l\u2019historique des \u00e9changes.",
      tag: "15 appels \u00e0 7h30",
      tagColor: "bg-green-50 text-green-700 dark:bg-green-950/50 dark:text-green-400",
    },
  ]

  return (
    <section className="py-24 px-6 lg:px-8">
      <div className="mx-auto max-w-5xl">
        <div className="text-center mb-16">
          <p className="text-sm font-semibold text-green-600 dark:text-green-400 uppercase tracking-widest mb-3">
            Comment ca marche
          </p>
          <h2 className="text-3xl sm:text-4xl font-bold text-gray-900 dark:text-white tracking-tight">
            Trois etapes, zero friction
          </h2>
          <p className="mt-4 text-gray-500 dark:text-gray-400 max-w-xl mx-auto">
            L&apos;agent travaille pendant la nuit. Vous arrivez le matin avec une liste parfaitement pr\u00e9par\u00e9e.
          </p>
        </div>

        <div className="relative">
          {/* Ligne de connexion desktop */}
          <div className="hidden lg:block absolute top-16 left-0 right-0 h-px bg-gradient-to-r from-transparent via-green-300 dark:via-green-700 to-transparent" aria-hidden="true" />

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-10">
            {steps.map((item) => (
              <div
                key={item.step}
                className="relative group flex flex-col items-center text-center p-8 rounded-2xl bg-white dark:bg-gray-900 border border-gray-100 dark:border-gray-800 shadow-sm hover:shadow-xl hover:shadow-green-500/10 hover:-translate-y-1 transition-all duration-300"
              >
                {/* Numero d'etape */}
                <div className="absolute -top-4 left-1/2 -translate-x-1/2 flex h-8 w-8 items-center justify-center rounded-full bg-white dark:bg-gray-900 border-2 border-green-200 dark:border-green-700 text-xs font-bold text-green-600 dark:text-green-400 shadow-sm">
                  {item.step}
                </div>

                {/* Icone */}
                <div className="mt-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-green-50 dark:bg-green-950/50 text-green-600 dark:text-green-400 group-hover:bg-green-100 dark:group-hover:bg-green-950 transition-colors">
                  {item.icon}
                </div>

                <h3 className="mt-5 text-xl font-bold text-gray-900 dark:text-white">
                  {item.title}
                </h3>
                <p className="mt-3 text-sm text-gray-500 dark:text-gray-400 leading-relaxed">
                  {item.description}
                </p>

                {/* Tag */}
                <span className={`mt-5 inline-flex items-center px-3 py-1 rounded-full text-xs font-medium ${item.tagColor}`}>
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
// Section : Fonctionnalites (grille 4 cartes)                        //
// ------------------------------------------------------------------ //
function FeaturesSection() {
  const features = [
    {
      icon: <IconSearch />,
      title: "Sourcing automatique",
      description: "Extraction nocturne depuis INSEE Sirene et les registres ADEME. Filtrage par taille, secteur et date d'obligation bilan carbone.",
      color: "text-blue-500 bg-blue-50 dark:bg-blue-950/40",
    },
    {
      icon: <IconChart />,
      title: "Scoring intelligent",
      description: "Algorithme multicriteres : urgence reglementaire, taille entreprise, secteur carbone-intensif, signaux d'intention recents.",
      color: "text-purple-500 bg-purple-50 dark:bg-purple-950/40",
    },
    {
      icon: <IconDocument />,
      title: "Pitchs personnalises",
      description: "Claude Sonnet genere un pitch sur-mesure par entreprise — contexte metier, donnees BEGES, objections anticipees.",
      color: "text-orange-500 bg-orange-50 dark:bg-orange-950/40",
    },
    {
      icon: <IconLightning />,
      title: "Dashboard temps reel",
      description: "Suivi des appels, pipeline de conversion, historique prospect et metriques de performance en un seul endroit.",
      color: "text-green-600 bg-green-50 dark:bg-green-950/40",
    },
  ]

  return (
    <section className="py-24 px-6 lg:px-8 bg-gray-50/50 dark:bg-gray-900/30">
      <div className="mx-auto max-w-5xl">
        <div className="text-center mb-16">
          <p className="text-sm font-semibold text-green-600 dark:text-green-400 uppercase tracking-widest mb-3">
            Fonctionnalites
          </p>
          <h2 className="text-3xl sm:text-4xl font-bold text-gray-900 dark:text-white tracking-tight">
            Tout ce dont vous avez besoin
          </h2>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
          {features.map((feature) => (
            <div
              key={feature.title}
              className="group p-7 rounded-2xl bg-white dark:bg-gray-900 border border-gray-100 dark:border-gray-800 shadow-sm hover:shadow-xl hover:shadow-green-500/10 hover:-translate-y-0.5 transition-all duration-300 cursor-default"
            >
              <div className={`inline-flex items-center justify-center h-11 w-11 rounded-xl ${feature.color} mb-5`}>
                {feature.icon}
              </div>
              <h3 className="text-lg font-bold text-gray-900 dark:text-white mb-2">
                {feature.title}
              </h3>
              <p className="text-sm text-gray-500 dark:text-gray-400 leading-relaxed">
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
        <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-green-600 to-emerald-700 p-12 text-center shadow-2xl shadow-green-500/20">
          {/* Motif de fond */}
          <div className="pointer-events-none absolute inset-0 opacity-10" aria-hidden="true">
            <svg className="h-full w-full" xmlns="http://www.w3.org/2000/svg">
              <defs>
                <pattern id="cta-grid" width="40" height="40" patternUnits="userSpaceOnUse">
                  <path d="M.5 40V.5H40" fill="none" stroke="white" strokeWidth="0.5" />
                </pattern>
              </defs>
              <rect width="100%" height="100%" fill="url(#cta-grid)" />
            </svg>
          </div>

          {/* Tache lumineuse */}
          <div className="pointer-events-none absolute -top-24 -right-24 h-64 w-64 rounded-full bg-white/10 blur-3xl" aria-hidden="true" />
          <div className="pointer-events-none absolute -bottom-24 -left-24 h-64 w-64 rounded-full bg-white/10 blur-3xl" aria-hidden="true" />

          <div className="relative">
            <h2 className="text-3xl sm:text-4xl font-extrabold text-white tracking-tight">
              Pret a prospecter intelligemment ?
            </h2>
            <p className="mt-4 text-green-100 text-lg max-w-xl mx-auto">
              Rejoignez les consultants bilan carbone qui ont arrête de chercher leurs prospects manuellement.
            </p>
            <div className="mt-10 flex flex-col sm:flex-row gap-4 justify-center">
              <Link
                href="/signup"
                className="inline-flex items-center justify-center gap-2 px-7 py-3.5 bg-white text-green-700 font-bold rounded-xl shadow-lg hover:bg-green-50 transition-all duration-200 hover:-translate-y-0.5"
              >
                Commencer gratuitement
              </Link>
              <Link
                href="/login"
                className="inline-flex items-center justify-center px-7 py-3.5 border border-white/30 text-white font-semibold rounded-xl hover:bg-white/10 backdrop-blur transition-all duration-200"
              >
                Deja inscrit ? Se connecter
              </Link>
            </div>
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
    <footer className="border-t border-gray-100 dark:border-gray-800 py-8 px-6">
      <div className="mx-auto max-w-5xl flex flex-col sm:flex-row items-center justify-between gap-4">
        <div className="flex items-center gap-2.5">
          <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-green-600">
            <svg className="h-4 w-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" d="M7 21a4 4 0 01-4-4V5a2 2 0 012-2h4a2 2 0 012 2v12a4 4 0 01-4 4zm0 0h12a2 2 0 002-2v-4a2 2 0 00-2-2h-2.343M11 7.343l1.657-1.657a2 2 0 012.828 0l2.829 2.829a2 2 0 010 2.828l-8.486 8.485M7 17h.01" />
            </svg>
          </div>
          <span className="text-sm font-semibold text-gray-900 dark:text-white">DecarbonLeads</span>
          <span className="text-xs text-gray-400 dark:text-gray-500">by STROFE</span>
        </div>
        <p className="text-xs text-gray-400 dark:text-gray-500">
          &copy; 2026 STROFE — Tous droits reserves
        </p>
        <nav className="flex gap-5" aria-label="Liens pied de page">
          <Link href="/login" className="text-xs text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 transition-colors">
            Connexion
          </Link>
          <Link href="/signup" className="text-xs text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 transition-colors">
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
    <div className="min-h-screen bg-white dark:bg-gray-950">
      <HeroSection />
      <StatsSection />
      <HowItWorksSection />
      <FeaturesSection />
      <CtaSection />
      <Footer />
    </div>
  )
}
