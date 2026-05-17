// ============================================================
// json-ld.test.tsx — tests unitaires du composant JsonLd
//
// Couvre :
//   - Rendu nominal : balise <script type="application/ld+json"> présente
//   - Contenu : JSON.stringify avec escape défensif des chevrons `<` -> `<`
//     (empêche XSS via </script> dans une valeur du payload)
//   - Sécurité XSS : aucun nœud script parasite, payload toujours encapsulé
// ============================================================

import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import { JsonLd } from '../json-ld'

/** Reproduit l'escape appliqué par <JsonLd> pour comparer en assertion. */
function expectedSerialized(payload: Record<string, unknown>): string {
  return JSON.stringify(payload).replace(/</g, '\\u003c')
}

describe('JsonLd', () => {
  it('rend une balise <script type="application/ld+json">', () => {
    // Arrange
    const payload = {
      '@context': 'https://schema.org',
      '@type': 'SoftwareApplication',
      name: 'Glan',
    }

    // Act
    const { container } = render(<JsonLd payload={payload} />)
    const script = container.querySelector('script[type="application/ld+json"]')

    // Assert
    expect(script).not.toBeNull()
  })

  it('innerHTML est exactement JSON.stringify(payload) avec escape des chevrons', () => {
    // Arrange
    const payload = {
      '@context': 'https://schema.org',
      '@type': 'SoftwareApplication',
      name: 'Glan',
    }

    // Act
    const { container } = render(<JsonLd payload={payload} />)
    const script = container.querySelector('script[type="application/ld+json"]')

    // Assert — pas de `<` dans la sortie, donc identique à JSON.stringify ici
    expect(script?.innerHTML).toBe(expectedSerialized(payload))
  })

  it('sérialise un payload avec propriétés imbriquées', () => {
    // Arrange
    const payload = {
      '@context': 'https://schema.org',
      '@type': 'SoftwareApplication',
      name: 'Glan',
      offers: {
        '@type': 'Offer',
        price: '0',
        priceCurrency: 'EUR',
      },
    }

    // Act
    const { container } = render(<JsonLd payload={payload} />)
    const script = container.querySelector('script[type="application/ld+json"]')

    // Assert
    expect(script?.innerHTML).toBe(expectedSerialized(payload))
  })

  it('XSS : un name contenant du HTML est encodé — chevrons remplacés par \\u003c', () => {
    // Arrange — payload avec chaîne ressemblant à du HTML
    const payload = {
      '@context': 'https://schema.org',
      '@type': 'SoftwareApplication',
      name: '<b>injection</b>',
    }

    // Act
    const { container } = render(<JsonLd payload={payload} />)

    // Assert — un seul nœud <script> dans le DOM (aucun nœud créé par injection HTML)
    const allScripts = container.querySelectorAll('script')
    expect(allScripts).toHaveLength(1)

    // Le innerHTML applique l'escape défensif : tous les `<` -> `<`
    const script = container.querySelector('script[type="application/ld+json"]')
    expect(script?.innerHTML).toBe(expectedSerialized(payload))

    // Vérification directe : plus de chevron ouvrant dans la sortie
    expect(script?.innerHTML).not.toContain('<b>')
    expect(script?.innerHTML).toContain('\\u003cb>injection\\u003c/b>')
  })

  it('XSS </script> : tentative de fermeture prématurée est neutralisée', () => {
    // Arrange — vecteur XSS classique du JSON-LD : injecter </script>
    // dans une valeur pour fermer la balise et exécuter du JS.
    const payload = {
      '@context': 'https://schema.org',
      '@type': 'SoftwareApplication',
      description: 'foo</script><script>alert(1)</script>',
    }

    // Act
    const { container } = render(<JsonLd payload={payload} />)

    // Assert — un seul script dans le DOM (aucune balise parasite n'a été créée)
    expect(container.querySelectorAll('script')).toHaveLength(1)

    // Et la chaîne `</script>` n'apparaît jamais en clair dans le rendu
    const script = container.querySelector('script[type="application/ld+json"]')
    expect(script?.innerHTML).not.toContain('</script>')
    expect(script?.innerHTML).toContain('\\u003c/script>')
  })

  it('payload vide {} — rend un script avec contenu {}', () => {
    // Arrange
    const payload = {}

    // Act
    const { container } = render(<JsonLd payload={payload} />)
    const script = container.querySelector('script[type="application/ld+json"]')

    // Assert
    expect(script?.innerHTML).toBe('{}')
  })
})
