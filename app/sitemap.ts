import type { MetadataRoute } from 'next'

// TODO: remplacer par le domaine prod
const SITE_URL = 'https://prospection-agent.vercel.app'

export default function sitemap(): MetadataRoute.Sitemap {
  return [
    {
      url: SITE_URL,
      lastModified: new Date(),
      changeFrequency: 'weekly',
      priority: 1,
    },
    // Ajouter ici de futures pages publiques (ex. /pricing, /about) avec
    // priority décroissante. Les routes dashboard et auth restent absentes
    // pour rester cohérentes avec le noindex défini dans app/layout.tsx.
  ]
}
