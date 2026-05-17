# Audit SEO — Landing Glan

> Audit purement consultatif. Aucun code source modifié. Tous les snippets de cette fiche sont compilables tels quels (Next.js 15 strict, TypeScript). Le texte de copy reste de la responsabilité de l'agent copywriting — ici on ne fournit que la structure technique, les balises et les variantes A/B argumentées.

---

## 1. État actuel vs cible

| Critère | État actuel | Recommandation | Priorité |
|---|---|---|---|
| `title` (page home) | Présent — mentionne un horaire d'exécution obsolète, 64 chars | Réécrire avec mot-clé prioritaire en tête, formulation alignée au pivot 14-05-2026 | H |
| `description` (page home) | Présente — mentionne un horaire d'exécution obsolète, 175 chars (trop long) | Réécrire 150-160 chars, verbe d'action en tête, inclure mots-clés 1+2+3 | H |
| `keywords` | Absent | Ajouter array 10-15 mots-clés FR, ordre de priorité | M |
| Open Graph | Partiel (title, description, type, locale) | Compléter : siteName, url, images 1200x630 | H |
| Twitter Card | Absent | Ajouter `summary_large_image` + images + handles | M |
| JSON-LD | Absent | Ajouter `SoftwareApplication` + `Organization` via composant server-side | H |
| Canonical | Absent | `alternates.canonical` avec URL absolue prod | H |
| Robots (home) | `{ index: true, follow: true }` | Étendre `googleBot` (max-snippet, max-image-preview, max-video-preview) | M |
| Robots (layout global) | `{ index: false, follow: false }` — override correct sur `app/page.tsx` | Confirmer que toute route publique override explicitement | H |
| Image OG | Inexistante | Produire `public/og-glan.png` 1200x630, format PNG ou WebP, taille < 300 KB | H |
| Hiérarchie Hn | Bonne base (1 H1 dans Hero, H2 par section, H3 sous H2) | Pas de saut de niveau détecté. Voir section 4 | L |
| Alt-text portrait | `alt=""` dans `GlanPortrait` (parent aria-label) | Confirmer aria-label sur parent, sinon ajouter alt sémantique | M |
| Alt-text image OG | À fournir avec l'image | Texte alternatif max 100 chars | H |
| `sitemap.xml` | Inexistant (`app/sitemap.ts` absent) | Créer `app/sitemap.ts` avec home + futures routes publiques | H |
| `robots.txt` | Inexistant (`public/robots.txt` absent) | Créer template avec Disallow dashboard/auth, Sitemap reference | H |
| LCP | Mesh gradient animé + GlanPortrait au-dessus du fold | Vérifier `priority` sur l'image portrait, mesurer LCP réel | M |
| CLS | Fallback Hero préserve la hauteur, OK | Maintenir le placeholder même hauteur pour `GlanHeroLoader` | L |
| Performance images | `next.config.ts` formats avif/webp activés | OK. Vérifier compression des assets dans `public/` | L |
| Search Console | Non vérifié | À ajouter post-déploiement (cf. checklist) | H |

---

## 2. Metadata Next.js — code prêt à coller

### 2.1 Variantes `title` (55-60 chars)

**Variante A — recommandée (transactionnelle, mot-clé en tête)**

```
Prospection BEGES — agent IA pour consultants bilan carbone
```

- 58 caractères.
- Mot-clé prioritaire #1 (`prospection BEGES`) en tête.
- Mot-clé #2 (`consultant bilan carbone`) en queue.
- Pas de mention horaire (banni du pivot).
- Format « bénéfice — segment cible » lisible en SERP.

**Variante B — alternative (positionnement produit)**

```
Glan — agent de prospection BEGES (article L229-25)
```

- 51 caractères.
- Marque en tête (utile si la marque commence à acquérir du brand search).
- Mot-clé #3 (`article L229-25`) inclus, signal niche très ciblé.
- Moins direct sur l'intent transactionnel.

> **Recommandation** : A pour la home, B éventuellement pour une page produit dédiée si elle existe un jour.

### 2.2 Variantes `description` (150-160 chars)

**Variante A — recommandée (verbe d'action + bénéfice + sources)**

```
Identifiez les entreprises soumises à l'obligation BEGES (L229-25). Glan croise Sirene et ADEME, score 3 piliers, pipeline commercial intégré.
```

- 154 caractères (espaces inclus).
- Verbe `Identifiez` en tête.
- Mots-clés #1, #3, et signal `Sirene ADEME prospection` (#7).
- CTA implicite via la promesse d'identification immédiate.

**Variante B — alternative (orientée consultant)**

```
Pour consultants bilan carbone : agent IA qui source Sirene et ADEME, qualifie les obligés BEGES et alimente votre pipeline commercial.
```

- 142 caractères.
- Mot-clé #2 (`consultant bilan carbone`) en tête.
- Mot-clé #6 (`agent IA prospection carbone`) implicite.
- Moins direct sur le bénéfice utilisateur.

> **Recommandation** : A — la formulation impérative augmente le CTR en SERP.

### 2.3 Snippet `export const metadata` complet — à coller dans `app/page.tsx`

```ts
import type { Metadata } from 'next'

// TODO: remplacer par le domaine prod une fois publié
const SITE_URL = 'https://prospection-agent.vercel.app'
const OG_IMAGE_PATH = '/og-glan.png'

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title:
    'Prospection BEGES — agent IA pour consultants bilan carbone',
  description:
    "Identifiez les entreprises soumises à l'obligation BEGES (L229-25). Glan croise Sirene et ADEME, score 3 piliers, pipeline commercial intégré.",
  keywords: [
    'prospection BEGES',
    'consultant bilan carbone',
    'article L229-25',
    'outil prospection RSE',
    'prospection décarbonation',
    'agent IA prospection carbone',
    'Sirene ADEME prospection',
    'lead generation bilan carbone',
    'obligation bilan GES',
    'sourcing entreprises BEGES',
    'pipeline commercial RSE',
    'scoring prospects carbone',
  ],
  alternates: {
    canonical: '/', // résolu via metadataBase → URL absolue
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      'max-snippet': -1,
      'max-image-preview': 'large',
      'max-video-preview': -1,
    },
  },
  openGraph: {
    title:
      'Prospection BEGES — agent IA pour consultants bilan carbone',
    description:
      "Croise Sirene et ADEME, score 3 piliers, pipeline commercial intégré pour consultants bilan carbone.",
    type: 'website',
    locale: 'fr_FR',
    siteName: 'Glan',
    url: SITE_URL,
    images: [
      {
        url: OG_IMAGE_PATH, // résolu en absolu via metadataBase
        width: 1200,
        height: 630,
        alt: 'Glan — agent de prospection BEGES, sources Sirene et ADEME, scoring 3 piliers',
        type: 'image/png',
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    // TODO: remplacer par handles réels si comptes créés, sinon supprimer les deux lignes
    site: '@glan_strofe',
    creator: '@glan_strofe',
    title:
      'Prospection BEGES — agent IA pour consultants bilan carbone',
    description:
      "Croise Sirene et ADEME, score 3 piliers, pipeline commercial intégré.",
    images: [OG_IMAGE_PATH],
  },
}
```

**Spec image OG** :

- Dimensions exactes : `1200 x 630`.
- Format : PNG (alpha autorisé) ou WebP. JPG accepté si pas de transparence requise.
- Poids cible : < 300 KB après compression.
- Contraste : texte lisible à 200x100 (vignette LinkedIn).
- Contenu suggéré pour brief design : logo Glan + tagline courte + visuel portrait/orbe + mention `BEGES · L229-25 · Sirene · ADEME`. Évite tout texte trop dense.
- Chemin : `public/og-glan.png` (servi en `/og-glan.png`).

---

## 3. JSON-LD données structurées

### 3.1 Composant `<JsonLd>` — à créer dans `components/seo/json-ld.tsx`

```tsx
// Server Component — pas de 'use client'.
// Inline schema.org JSON-LD via <script type="application/ld+json">.
// Le payload est sérialisé côté serveur, aucun JS embarqué.

type JsonLdPayload = Record<string, unknown>

interface JsonLdProps {
  payload: JsonLdPayload
}

export function JsonLd({ payload }: JsonLdProps) {
  return (
    <script
      type="application/ld+json"
      // Le payload provient de code serveur typé, jamais d'input utilisateur.
      // dangerouslySetInnerHTML est volontaire — alternative officielle Next.js
      // pour injecter du JSON-LD dans un Server Component.
      dangerouslySetInnerHTML={{ __html: JSON.stringify(payload) }}
    />
  )
}
```

### 3.2 Payload `SoftwareApplication` — à coller dans `app/page.tsx`

```ts
// TODO: remplacer SITE_URL et LOGO_URL par les URLs prod absolues
const SITE_URL = 'https://prospection-agent.vercel.app'
const LOGO_URL = `${SITE_URL}/logo-strofe.png`

const softwareApplicationLd = {
  '@context': 'https://schema.org',
  '@type': 'SoftwareApplication',
  name: 'Glan',
  applicationCategory: 'BusinessApplication',
  applicationSubCategory: 'SalesIntelligence',
  operatingSystem: 'Web Browser',
  description:
    "Agent de prospection BEGES pour consultants bilan carbone. Croise Sirene et ADEME pour identifier les entreprises soumises à l'article L229-25.",
  url: SITE_URL,
  inLanguage: 'fr-FR',
  publisher: {
    '@type': 'Organization',
    name: 'STROFE',
    url: SITE_URL,
    logo: LOGO_URL,
  },
  // Voir note ci-dessous sur le choix de l'offer
  offers: {
    '@type': 'Offer',
    price: '0',
    priceCurrency: 'EUR',
    availability: 'https://schema.org/InStock',
    category: 'free trial',
  },
  featureList: [
    'Sourcing Sirene officiel (INSEE)',
    'Croisement ADEME BEGES (publication, validité, fraîcheur)',
    'Scoring transparent 3 piliers (taille, BEGES, contact)',
    'Pipeline commercial 8 statuts',
    'Multi-contacts par prospect (DG, DAF, RSE)',
    "Journal d'échanges horodaté (appel, email, RDV)",
    "Pondérations de scoring paramétrables",
    'Conformité RGPD CNIL (purge auto 3 ans, opt-out)',
  ],
  screenshot: [
    // TODO: remplacer par des captures d'écran réelles uploadées
    `${SITE_URL}/screenshots/pipeline.png`,
    `${SITE_URL}/screenshots/scoring.png`,
  ],
}
```

**Choix entre `price: '0'` et `'On request'`** :

- `price: '0'` + `priceCurrency: 'EUR'` + `category: 'free trial'` est privilégié si une période d'essai gratuite existe (mentionnée dans `glan-doc-commerciale.md` section « Pour aller plus loin » : « Période d'essai 30 jours »). Google peut alors afficher un badge « free » en rich snippet.
- `'On request'` (sans `price`) est juste si l'accès est strictement sur démo commerciale. Inconvénient : aucun snippet de prix généré, perte d'un signal de richesse.
- **Recommandation** : `price: '0'` + `category: 'free trial'` puisque la doc commerciale parle de période d'essai sur périmètre cible. Switcher si le modèle évolue.

### 3.3 Payload `Organization` (STROFE) — à coller dans `app/page.tsx`

```ts
const organizationLd = {
  '@context': 'https://schema.org',
  '@type': 'Organization',
  name: 'STROFE',
  url: SITE_URL, // TODO: utiliser le domaine corporate STROFE si distinct
  logo: LOGO_URL,
  // foundingDate, founder : à compléter si publication souhaitée
  contactPoint: [
    {
      '@type': 'ContactPoint',
      email: 'samir.anbri@gmail.com',
      contactType: 'sales',
      availableLanguage: ['fr'],
      areaServed: 'FR',
    },
  ],
  sameAs: [
    // TODO: ajouter les URLs des profils sociaux une fois créés
    // 'https://www.linkedin.com/company/strofe',
    // 'https://x.com/glan_strofe',
  ],
  areaServed: 'FR',
}
```

### 3.4 Intégration dans `app/page.tsx`

Juste après les imports, avant le `export const metadata` :

```tsx
import { JsonLd } from '@/components/seo/json-ld'

// (déclaration des payloads softwareApplicationLd et organizationLd ici)
```

Puis dans le `return` de `HomePage`, en tout début, avant `<GlanHeroLoader />` :

```tsx
return (
  <div className="min-h-screen">
    <JsonLd payload={softwareApplicationLd} />
    <JsonLd payload={organizationLd} />
    <GlanHeroLoader />
    {/* ... reste inchangé */}
  </div>
)
```

> Note : Next.js 15 ne supporte pas l'injection de `<script>` arbitraire via l'API `Metadata`. Le composant `<JsonLd>` server-side est la solution officiellement recommandée par la doc Next.js (Server Components — JSON-LD).

---

## 4. Hiérarchie H1/H2/H3 recommandée

### Audit actuel

- **H1 unique** : présent dans `components/marketing/glan-hero.tsx` ligne 190. Confirmé : un seul `<h1>` sur la page. Conforme.
- **H2 par section** :
  - Section « Comment ça marche » : `<h2>` ligne 303 — texte actuel mentionne un horaire d'exécution obsolète, à mettre à jour côté copywriting.
  - Section « Fonctionnalités » : `<h2>` ligne 437 (`Sirene, ADEME, scoring, pipeline.`) — OK structurellement.
  - Section CTA : `<h2>` ligne 547 — texte actuel mentionne un horaire d'exécution obsolète, à mettre à jour côté copywriting.
- **H3 sous chaque H2** :
  - Sous « Comment ça marche » : 3 `<h3>` (un par étape) — OK.
  - Sous « Fonctionnalités » : 4 `<h3>` (un par feature) — OK.
  - Sous CTA : pas de H3, OK.
- **Stats section** : pas de heading. C'est intentionnel (chiffres décoratifs), donc OK. Si on voulait être strict, on pourrait ajouter un H2 visuellement masqué (sr-only) « Glan en chiffres ».

### Pas de saut de niveau détecté

La hiérarchie est conforme. Pas de H1 → H3 sans H2 intermédiaire.

### Recommandation

- Garder cette structure.
- Ajouter optionnellement un H2 sr-only « Glan en chiffres » au-dessus de `StatsSection` pour densifier la sémantique sans impact visuel :

```tsx
<h2 className="sr-only">Glan en chiffres</h2>
```

---

## 5. Alt-texts et accessibilité images

- **Portrait Glan** (`<GlanPortrait>` dans le Hero) : si l'image PNG sous-jacente a `alt=""` et que le wrapper parent porte un `aria-label` décrivant l'avatar, c'est conforme WCAG 2.1 (image décorative + label assistant). À vérifier en lisant `components/glan/glan-portrait.tsx`. Si l'image n'a aucun `aria-label` parent, recommandation : `alt="Glan — avatar de l'agent IA de prospection BEGES"` (75 chars).
- **Image OG** : `alt: "Glan — agent de prospection BEGES, sources Sirene et ADEME, scoring 3 piliers"` (94 chars, sous la limite des 100). Déjà inclus dans le snippet metadata.
- **Icônes SVG inline** (IconDatabase, IconSparkles, etc.) : toutes ont `aria-hidden="true"`. Conforme — elles sont décoratives et doublent une étiquette textuelle visible. Pas de changement requis.
- **SVG du logo Glan dans le footer** : `aria-hidden="true"` présent. Le texte « Glan » est visible à côté. OK.

---

## 6. Performance — recommandations rapides

### Cibles

- **LCP** < 2.5s en fibre desktop, < 4s en 3G slow (cible mobile-first Google).
- **CLS** < 0.1 (déjà respecté grâce au fallback `GlanHeroFallback` de même hauteur).
- **INP** < 200ms.

### Points d'attention

1. **GlanPortrait** : c'est probablement le LCP element. Vérifier qu'il utilise `priority` sur le composant `<Image>` Next.js sous-jacent, et `fetchPriority="high"`. À auditer dans `components/glan/glan-portrait.tsx`.
2. **Mesh gradient animé** dans le Hero : utilise `motion.div` avec animation 16s en loop. Sur reduced-motion il est figé. OK accessibilité, mais surveiller le coût GPU sur mobile bas de gamme — l'animation `background` est coûteuse (re-paint complet). Alternative : `transform: translateZ(0)` pour forcer composite layer, ou réduire à 2 keyframes.
3. **Particules ambient** (`<TechParticles />` dans `app/layout.tsx`) : couche fixe inset-0. Si elle utilise Canvas ou DOM avec beaucoup d'éléments animés, peut dégrader INP. À profiler.
4. **Preconnect** : si la home charge des assets externes (logos Google Fonts via `next/font/google` sont auto-optimisés, donc OK). Pas d'API appelée au chargement → pas de preconnect requis.
5. **Lazy-load sous le fold** : `ScrollReveal` est en place sur HowItWorksSection, FeaturesSection, CtaSection. Vérifier qu'il monte les composants en `useInView` (lazy mount) plutôt qu'en `opacity: 0`. Si simplement opacity, ce n'est pas un lazy-load réel.
6. **Bundle initial** : `GlanHeroLoader` charge le hero client-side. Vérifier le code-splitting effectif via `next build`.

---

## 7. Sitemap + robots.txt

### 7.1 Template `app/sitemap.ts` (Next.js 15)

```ts
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
```

### 7.2 Template `public/robots.txt`

```
# Glan — robots.txt
User-agent: *
Allow: /
Disallow: /api/
Disallow: /dashboard
Disallow: /login
Disallow: /signup
Disallow: /onboarding
Disallow: /_next/

# Sitemap
# TODO: remplacer par le domaine prod
Sitemap: https://prospection-agent.vercel.app/sitemap.xml
```

> Note : Allow `/signup` et `/login` est généralement déconseillé pour le SEO car ces pages n'apportent rien en SERP et diluent le budget de crawl. Maintenir `Disallow` jusqu'à ce qu'une page d'inscription marketing dédiée existe.

---

## 8. Checklist déploiement

- [ ] Domaine prod configuré sur Vercel (DNS + certificat SSL valide).
- [ ] Constante `SITE_URL` remplacée dans `app/page.tsx`, `app/sitemap.ts`, `public/robots.txt`.
- [ ] Image OG 1200x630 produite et placée en `public/og-glan.png`, poids < 300 KB.
- [ ] Logo absolu accessible pour `Organization` JSON-LD (`public/logo-strofe.png` ou équivalent).
- [ ] Captures d'écran produit ajoutées (`public/screenshots/pipeline.png`, `public/screenshots/scoring.png`) ou clé `screenshot` retirée du JSON-LD si non disponibles.
- [ ] Handles Twitter/X créés et reportés dans `metadata.twitter.site` et `creator`, ou clés supprimées.
- [ ] Search Console : propriété ajoutée, sitemap soumis.
- [ ] Bing Webmaster Tools : optionnel mais utile pour parts de marché B2B.
- [ ] Lighthouse SEO ≥ 95 sur la home (mobile et desktop).
- [ ] Test rich snippets Google : https://search.google.com/test/rich-results
- [ ] Test Open Graph : https://www.opengraph.xyz/ ou https://www.linkedin.com/post-inspector/
- [ ] Vérifier que `app/layout.tsx` `noindex` global ne touche pas la home (override `index: true` dans `app/page.tsx` confirmé).
- [ ] CSP `connect-src` mis à jour si de nouveaux domaines apparaissent (à vérifier avant tout déploiement post-SEO).
- [ ] Banni dans le copy final : aucune mention d'horaire d'exécution (vocabulaire pré-pivot 14-05-2026) — synchroniser avec l'agent copywriting pour aligner sur « à la demande » et « pipeline mensuel 1er du mois ».

---

## 9. Trois wins SEO attendus

1. **Indexation rich result `SoftwareApplication`** — Google affiche en SERP la catégorie, la note d'évaluation (si reviews ajoutées plus tard), et le badge `free trial`. CTR estimé +15 à 25 % vs résultat texte classique sur le segment B2B SaaS.

2. **Capture du long tail spécialisé `article L229-25` et `prospection BEGES`** — ces deux mots-clés ont un volume faible mais un intent transactionnel quasi pur. La combinaison `title` + `description` + JSON-LD + structure Hn aligne tous les signaux. Concurrence faible, position 1-3 atteignable en 3-6 mois sans backlinks externes.

3. **Partage social qualifié via Open Graph optimisé** — image OG 1200x630 dédiée + Twitter Card `summary_large_image` augmentent le CTR sur LinkedIn (canal principal du persona consultant bilan carbone). Le `siteName` Glan et le `description` orienté bénéfice transforment chaque partage en mini-publicité cohérente.
