// sentry.edge.config.ts — Configuration Sentry pour le runtime Edge de Next.js 15
//
// Le runtime Edge (utilisé par le Middleware) a un environnement restreint :
// pas d'accès aux APIs Node.js, pas de profiling CPU natif.
// La config doit rester légère et compatible avec les contraintes Edge.

import * as Sentry from '@sentry/nextjs'
import { scrubSentryEvent } from '@/lib/observability/sentry-helpers'

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,

  tracesSampleRate: 0.1,

  debug: false,

  // Pas de profilesSampleRate sur Edge : le profiling CPU n'est pas supporté
  // dans les environnements sans accès aux APIs Node.js natives.

  // Scrub PII (emails + téléphones) avant envoi — cf. .claude/rules/security.md.
  beforeSend(event) {
    return scrubSentryEvent(event)
  },
})
