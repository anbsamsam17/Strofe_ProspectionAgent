import type { NextConfig } from 'next'
import { withSentryConfig } from '@sentry/nextjs'

// En développement, unsafe-eval est nécessaire pour les source maps et Fast Refresh.
// En production, on le supprime pour réduire la surface d'attaque XSS.
const isDev = process.env.NODE_ENV === 'development'
const scriptSrc = isDev
  ? "script-src 'self' 'unsafe-eval' 'unsafe-inline'"
  : "script-src 'self' 'unsafe-inline'"

const cspValue = [
  "default-src 'self'",
  scriptSrc,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' blob: data: https:",
  // data: requis pour les fonts inline de FullCalendar (.fc-icon TTF data-URI).
  "font-src 'self' data:",
  "connect-src 'self' https://*.supabase.co https://api.openai.com https://api.insee.fr https://*.sentry.io",
  "frame-ancestors 'none'",
  "object-src 'none'",
  "base-uri 'self'",
].join('; ')

const nextConfig: NextConfig = {
  images: {
    formats: ['image/avif', 'image/webp'],
  },
  async headers() {
    return [
      {
        // Appliquer les security headers sur toutes les routes
        source: '/(.*)',
        headers: [
          { key: 'X-DNS-Prefetch-Control', value: 'on' },
          {
            key: 'Strict-Transport-Security',
            value: 'max-age=63072000; includeSubDomains; preload',
          },
          // DENY (et non SAMEORIGIN) pour rester cohérent avec la CSP
          // `frame-ancestors 'none'` et le middleware (X-Frame-Options: DENY).
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          {
            key: 'Referrer-Policy',
            value: 'strict-origin-when-cross-origin',
          },
          {
            key: 'Permissions-Policy',
            value: 'camera=(), microphone=(), geolocation=()',
          },
          {
            key: 'Content-Security-Policy',
            value: cspValue,
          },
        ],
      },
    ]
  },
}

export default withSentryConfig(nextConfig, {
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  authToken: process.env.SENTRY_AUTH_TOKEN,
  silent: true,
  // Source maps desactivees a dessein : elles ne sont ni emises ni uploadees
  // vers Sentry, ce qui evite d'exposer le code source d'origine et reduit la
  // duree du build. Contrepartie : les stack traces Sentry ne sont pas
  // demappees (lignes/fichiers minifies). Pour retrouver des traces lisibles
  // sans exposer les maps publiquement, passer a des "hidden source maps" :
  //   sourcemaps: { disable: false } + productionBrowserSourceMaps: false,
  // Sentry genere alors les maps, les uploade puis les supprime du bundle
  // (elles ne sont pas servies aux clients). Volontairement inchange ici.
  sourcemaps: { disable: true },
  disableLogger: true,
})
