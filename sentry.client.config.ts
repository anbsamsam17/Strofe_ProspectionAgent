import * as Sentry from '@sentry/nextjs'
import { scrubSentryEvent } from '@/lib/observability/sentry-helpers'

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  tracesSampleRate: 0.1,
  debug: false,
  replaysOnErrorSampleRate: 1.0,
  replaysSessionSampleRate: 0.05,
  integrations: [Sentry.replayIntegration()],

  // Scrub PII (emails + téléphones) avant envoi — cf. .claude/rules/security.md.
  // Côté client : les pages de la daily list affichent les contacts prospects,
  // une erreur React qui capture le DOM peut leak ces données.
  beforeSend(event) {
    return scrubSentryEvent(event)
  },
})
