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
// dépendance externe — 30 lignes maison.
// ============================================================

interface ClientErrorBoundaryProps {
  /** Le sous-arbre à protéger. */
  children: ReactNode
  /**
   * UI de repli rendue quand un child throw. Reçoit l'erreur pour
   * pouvoir afficher un diagnostic (message uniquement, pas de stack).
   */
  fallback: (error: Error) => ReactNode
  /** Contexte court pour le log (ex. "PipelineClient"). Pas de PII. */
  context: string
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
      return this.props.fallback(this.state.error)
    }
    return this.props.children
  }
}
