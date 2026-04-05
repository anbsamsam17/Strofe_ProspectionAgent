// instrumentation.ts — Requis par @sentry/nextjs pour Next.js 15
//
// Next.js 15 appelle register() au démarrage du serveur (une seule fois).
// C'est ici que Sentry doit être initialisé côté serveur pour capturer les erreurs
// qui surviennent avant que les Request Handlers ne soient actifs (ex: middlewares, imports).
//
// Ref: https://nextjs.org/docs/app/building-your-application/optimizing/instrumentation
// Ref: https://docs.sentry.io/platforms/javascript/guides/nextjs/manual-setup/

import * as Sentry from '@sentry/nextjs'

export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    // Initialisation Sentry pour le runtime Node.js (API routes, Server Components, Route Handlers)
    await import('./sentry.server.config')
  }

  if (process.env.NEXT_RUNTIME === 'edge') {
    // Initialisation Sentry pour le runtime Edge (Middleware, Edge API Routes)
    // Edge runtime n'a pas accès aux APIs Node.js — la config doit rester légère
    await import('./sentry.edge.config')
  }
}

// Hook d'instrumentation pour capturer les erreurs des React Server Components.
// Cette fonction est appelée automatiquement par Next.js 15 lorsqu'une erreur
// non gérée survient dans un Server Component ou un Server Action.
//
// Sans ce hook, Sentry ne voit pas les erreurs RSC car elles ne passent pas
// par les error boundaries React classiques.
export const onRequestError = Sentry.captureRequestError
