import * as Sentry from '@sentry/nextjs'

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,

  tracesSampleRate: 0.1,

  debug: false,

  // Requis par @sentry/nextjs pour s'intégrer avec le système d'instrumentation de Next.js 15.
  // Doit aussi être activé dans instrumentation.ts via Sentry.init() côté server.
  instrumentationHook: true,

  // Active le profiling serveur (CPU profiling) — taux réduit pour limiter l'overhead.
  // Nécessite @sentry/profiling-node si on veut le profiling natif Node.js.
  // Avec @sentry/nextjs >= 8, le profiling JS est disponible sans dépendance supplémentaire.
  profilesSampleRate: 0.05,

  // Évite les conflits avec l'instrumentation OpenTelemetry de Next.js 15.
  // Next.js gère déjà son propre setup OTEL ; Sentry doit s'y greffer sans le remplacer.
  skipOpenTelemetrySetup: true,
})
