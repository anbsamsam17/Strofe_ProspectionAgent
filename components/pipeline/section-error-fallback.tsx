// ============================================================
// SectionErrorFallback — panneau d'erreur réutilisable
// ------------------------------------------------------------
// Affiché par les ErrorBoundary autour des sections /pipeline.
// Garantit que la page reste utilisable même quand une sous-
// section (KpiCards, AgentStats, ConversionFunnel, PipelineClient)
// throw au render ou pendant un fetch SSR.
//
// Server Component pur — pas d'état, pas d'effets. Rendu identique
// côté SSR et CSR.
// ============================================================

interface SectionErrorFallbackProps {
  /** Nom de la section, ex. "KPIs", "Activité agent", "Kanban". */
  section: string
  /** Message d'erreur original (affiché en monospace pour debug). */
  message?: string
}

export function SectionErrorFallback({
  section,
  message,
}: SectionErrorFallbackProps) {
  return (
    <section
      role="alert"
      aria-label={`Section ${section} indisponible`}
      className="rounded-2xl border border-amber-200 bg-amber-50 p-5 dark:border-amber-900/40 dark:bg-amber-950/30"
    >
      <h2 className="text-sm font-semibold uppercase tracking-wider text-amber-700 dark:text-amber-400">
        Section {section} indisponible
      </h2>
      <p className="mt-2 text-sm text-amber-700 dark:text-amber-400">
        Cette section a rencontré une erreur. Le reste du pipeline reste
        utilisable.
      </p>
      {message ? (
        <p className="mt-2 break-words font-mono text-xs text-amber-700 dark:text-amber-400">
          {message}
        </p>
      ) : null}
    </section>
  )
}
