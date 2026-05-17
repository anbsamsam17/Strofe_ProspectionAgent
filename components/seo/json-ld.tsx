// Server Component — pas de 'use client'.
// Inline schema.org JSON-LD via <script type="application/ld+json">.
// Le payload est sérialisé côté serveur, aucun JS embarqué.
// dangerouslySetInnerHTML est volontaire — alternative officielle Next.js
// pour injecter du JSON-LD dans un Server Component.
// Le payload provient de code serveur typé, jamais d'input utilisateur.

type JsonLdPayload = Record<string, unknown>

interface JsonLdProps {
  payload: JsonLdPayload
}

// Escape défensif des chevrons : empêche un éventuel "</script>" présent dans
// une valeur du payload de fermer prématurément la balise script (XSS classique
// du JSON-LD). React n'échappe pas automatiquement le contenu de
// dangerouslySetInnerHTML, donc on remplace `<` par sa séquence Unicode JSON.
function safeJsonLdString(payload: JsonLdPayload): string {
  return JSON.stringify(payload).replace(/</g, '\\u003c')
}

export function JsonLd({ payload }: JsonLdProps) {
  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: safeJsonLdString(payload) }}
    />
  )
}
