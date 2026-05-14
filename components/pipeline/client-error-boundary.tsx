'use client'

import { Component, type ErrorInfo, type ReactNode } from 'react'

// ============================================================
// ClientErrorBoundary — class component pour Client Components
// ------------------------------------------------------------
// Les hooks (`useState`, `useEffect`) ne peuvent pas catcher les
// errors d'un sous-arbre React. Pour la couche Client SSR-rendered
// (ex. <PipelineClient>) on retombe sur le pattern legacy class
// component avec `getDerivedStateFromError` + `componentDidCatch`.
//
// Pas de dépendance `react-error-boundary` (non installé), pas de
// dépendance externe.
//
// ⚠️ IMPORTANT (fix digest 450636695) : on n'accepte PAS de prop
// `fallback` en tant que fonction. Next.js 15 interdit de passer
// une fonction d'un Server Component à un Client Component (la
// fonction n'est pas sérialisable via le wire RSC, crash silencieux
// au render). On hardcode donc le fallback ici, dans le Client.
// La prop `section` (string, sérialisable) suffit pour customiser
// le label affiché.
// ============================================================

interface ClientErrorBoundaryProps {
  /** Le sous-arbre à protéger. */
  children: ReactNode
  /** Contexte court pour le log (ex. "PipelineClient"). Pas de PII. */
  context: string
  /** Label affiché dans le panel de repli (ex. "Kanban"). */
  section: string
}

interface ClientErrorBoundaryState {
  error: Error | null
}

export class ClientErrorBoundary extends Component<
  ClientErrorBoundaryProps,
  ClientErrorBoundaryState
> {
  state: ClientErrorBoundaryState = { error: null }

  static getDerivedStateFromError(error: Error): ClientErrorBoundaryState {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('[ClientErrorBoundary] caught', {
      context: this.props.context,
      message: error.message,
      stack: error.stack,
      componentStack: info.componentStack,
    })
  }

  render(): ReactNode {
    if (this.state.error !== null) {
      // Fallback inline (Client Component → on peut tout faire ici).
      // Pas de Server Component injecté pour éviter tout couplage cross-boundary.
      return (
        <section
          role="alert"
          aria-label={`${this.props.section} — section indisponible`}
          className="rounded-2xl border border-amber-200 bg-amber-50 p-5 dark:border-amber-900/40 dark:bg-amber-950/30"
        >
          <h2 className="text-sm font-semibold uppercase tracking-wider text-amber-700 dark:text-amber-400">
            {this.props.section} — indisponible
          </h2>
          <p className="mt-2 text-sm text-amber-700 dark:text-amber-400">
            Une erreur s&apos;est produite dans cette section. Le reste de la
            page reste utilisable.
          </p>
          <p className="mt-2 break-words font-mono text-xs text-amber-700 dark:text-amber-400">
            {this.state.error.message}
          </p>
        </section>
      )
    }
    return this.props.children
  }
}
