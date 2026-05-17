import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { NafHierarchyView } from './naf-hierarchy-view'

describe('NafHierarchyView', () => {
  it('affiche les 3 niveaux hiérarchiques pour un code NAF complet valide', () => {
    render(<NafHierarchyView rawNaf="86.10Z" />)

    // En-tête code NAF normalisé
    expect(screen.getByText(/NAF — 86\.10Z/i)).toBeDefined()

    // Section Q
    expect(screen.getByText(/Section Q/i)).toBeDefined()
    expect(screen.getByText('Santé humaine et action sociale')).toBeDefined()

    // Division 86
    expect(screen.getByText(/Division 86/i)).toBeDefined()
    expect(screen.getByText('Activités pour la santé humaine')).toBeDefined()

    // Sous-classe 86.10Z
    expect(screen.getByText(/Sous-classe/i)).toBeDefined()
    expect(screen.getByText('Activités hospitalières')).toBeDefined()
  })

  it('affiche les 3 niveaux pour un code Sirene live sans point (8610Z)', () => {
    render(<NafHierarchyView rawNaf="8610Z" />)

    // La normalisation doit insérer le point
    expect(screen.getByText(/NAF — 86\.10Z/i)).toBeDefined()
    expect(screen.getByText('Activités hospitalières')).toBeDefined()
  })

  it('affiche "Code NAF non renseigné" quand rawNaf est null', () => {
    render(<NafHierarchyView rawNaf={null} />)

    expect(screen.getByText(/Code NAF non renseigné/i)).toBeDefined()
  })

  it('affiche "Code NAF non renseigné" quand rawNaf est une chaîne vide', () => {
    render(<NafHierarchyView rawNaf="" />)

    expect(screen.getByText(/Code NAF non renseigné/i)).toBeDefined()
  })

  it('affiche section + division seulement pour un code partiel (division seule)', () => {
    render(<NafHierarchyView rawNaf="86" />)

    // En-tête
    expect(screen.getByText(/NAF — 86/i)).toBeDefined()

    // Section et division présentes
    expect(screen.getByText(/Section Q/i)).toBeDefined()
    expect(screen.getByText('Activités pour la santé humaine')).toBeDefined()

    // Aucune sous-classe (code trop court pour matcher NAF_SOUSCLASSES)
    expect(screen.queryByText(/Sous-classe/i)).toBeNull()
  })

  it('affiche section + division sans sous-classe si la sous-classe est inconnue', () => {
    // Division 86 existe, mais '86.99X' n'est pas une sous-classe réelle
    render(<NafHierarchyView rawNaf="86.99X" />)

    expect(screen.getByText(/Section Q/i)).toBeDefined()
    expect(screen.getByText(/Division 86/i)).toBeDefined()
    expect(screen.queryByText(/Sous-classe/i)).toBeNull()
  })

  it('affiche le code brut seul pour un NAF totalement hors nomenclature', () => {
    render(<NafHierarchyView rawNaf="ZZ.99Z" />)

    // Aucune section, division, sous-classe — juste le code brut
    expect(screen.queryByText(/Section/i)).toBeNull()
    expect(screen.queryByText(/Division/i)).toBeNull()
    expect(screen.getByText(/Code NAF/i)).toBeDefined()
    expect(screen.getByText('ZZ.99Z')).toBeDefined()
  })
})
