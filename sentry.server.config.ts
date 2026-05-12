import * as Sentry from '@sentry/nextjs'
import { scrubSentryEvent } from '@/lib/observability/sentry-helpers'

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,

  tracesSampleRate: 0.1,

  debug: false,

  // Active le profiling serveur (CPU profiling) — taux réduit pour limiter l'overhead.
  // Nécessite @sentry/profiling-node si on veut le profiling natif Node.js.
  // Avec @sentry/nextjs >= 8, le profiling JS est disponible sans dépendance supplémentaire.
  profilesSampleRate: 0.05,

  // Évite les conflits avec l'instrumentation OpenTelemetry de Next.js 15.
  // Next.js gère déjà son propre setup OTEL ; Sentry doit s'y greffer sans le remplacer.
  skipOpenTelemetrySetup: true,

  // Scrub PII (emails + téléphones) sur tout le payload avant envoi.
  // Règle non négociable cf. .claude/rules/security.md — les prospects contiennent
  // email/téléphone (PII RGPD), interdit d'envoyer ces données vers Sentry.
  //
  // Ne scrub PAS les messages d'erreur des APIs externes (Sirene "Erreur de syntaxe",
  // Pappers HTTP 401, etc.) — ce sont des signaux de debug, jamais des PII.
  beforeSend(event) {
    return scrubSentryEvent(event)
  },
})
