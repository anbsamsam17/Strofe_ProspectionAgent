import type { ReactNode } from 'react'

// ============================================================
// ServerErrorBoundary — try/catch async pour Server Components
// ------------------------------------------------------------
// React 19 Server Components ne supportent pas les class components
// (donc pas de `componentDidCatch`). Pour localiser une erreur SSR
// dans un sous-arbre on doit l'envelopper dans un async wrapper
// qui `await` la résolution du child et catch les rejects.
//
// Usage typique (children = appel d'un async Server Component, qui
// retourne `Promise<JSX>`):
//
//   <ServerErrorBoundary
//     fallback={<SectionErrorFallback section="KPIs" />}
//     context="KpiCards"
//   >
//     {KpiCards({ range })}
//   </ServerErrorBoundary>
//
// L'appel `KpiCards({ range })` retourne une promesse — si elle
// reject, on log + on rend le fallback au lieu de bubble jusqu'à
// `error.tsx`.
//
// ⚠️ Le child est appelé EAGERLY (avant le rendu) ; cela court-
// circuite Suspense. Pour combiner les deux, encapsuler ce
// boundary dans un <Suspense fallback={...}>.
// ============================================================

interface ServerErrorBoundaryProps {
  /**
   * Le contenu à rendre. Accepte un ReactNode synchrone ou une
   * promesse résolvant en ReactNode (cas async Server Component).
   */
  children: ReactNode | Promise<ReactNode>
  /** UI de repli affichée si `children` throw. */
  fallback: ReactNode
  /** Contexte court pour le log (ex. "KpiCards"). Pas de PII. */
  context: string
}

export async function ServerErrorBoundary({
  children,
  fallback,
  context,
}: ServerErrorBoundaryProps) {
  try {
    const resolved = await children
    return <>{resolved}</>
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[ServerErrorBoundary] render error', {
      context,
      message,
      stack: err instanceof Error ? err.stack : undefined,
    })
    return <>{fallback}</>
  }
}
