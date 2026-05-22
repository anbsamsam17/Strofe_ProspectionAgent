// ============================================================
// Tests : ContactsList
// ------------------------------------------------------------
// Couvre :
//   - Rendu d'une liste de N contacts.
//   - Fallback : si contacts vide → contact synthétisé depuis prospect.contact_*.
//   - Bouton "Ajouter un contact" rendu (via AddContactDialog mocké).
//   - Badge "Primaire" visible pour contact is_primary.
//   - tel/mailto/linkedin présents avec bons attributs (target, rel).
// ============================================================

import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import type { Prospect } from '@/lib/types'

// Mock AddContactDialog — on ne teste pas le formulaire ici, juste le câblage.
vi.mock('./add-contact-dialog', () => ({
  AddContactDialog: ({ prospectId }: { prospectId: string }) => (
    <button type="button" data-testid={`add-contact-mock-${prospectId}`}>
      Ajouter un contact
    </button>
  ),
}))

// Mock EnrichContactButton — utilise useRouter (next/navigation) qui n'est pas
// monté dans jsdom hors AppRouterContext. On stub par un bouton inerte.
vi.mock('./enrich-contact-button', () => ({
  EnrichContactButton: ({ prospectId }: { prospectId: string }) => (
    <button type="button" data-testid={`enrich-contact-mock-${prospectId}`}>
      Chercher un contact
    </button>
  ),
}))

// Mock VerifyEmailButton (GLN-062) — même raison : useRouter requis pour
// router.refresh() après vérification.
vi.mock('./verify-email-button', () => ({
  VerifyEmailButton: ({ contactId }: { contactId: string }) => (
    <button type="button" data-testid={`verify-email-mock-${contactId}`}>
      Vérifier
    </button>
  ),
}))

import { ContactsList, type ProspectContact } from './contacts-list'

// ── Fixtures ──────────────────────────────────────────────────────────────────

function makeProspect(overrides: Partial<Prospect> = {}): Prospect {
  return {
    id: 'pid-1',
    user_id: 'uid-1',
    siren: '123456789',
    raison_sociale: 'Acme SAS',
    beges_publie: false,
    obligation_beges: true,
    score_priorite: 50,
    score_details: {
      taille: 50,
      beges: 50,
      contact: 50,
      weights: { taille: 30, beges: 30, contact: 40 },
      deja_contacte_penalty: 0,
      rejete_penalty: 0,
    },
    signaux: [],
    statut: 'qualified',
    source: 'sirene',
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    ...overrides,
  }
}

function makeContact(overrides: Partial<ProspectContact> = {}): ProspectContact {
  return {
    id: 'c-1',
    user_id: 'uid-1',
    prospect_id: 'pid-1',
    nom: 'DUPONT',
    prenom: 'Jean',
    poste: 'DAF',
    telephone: '01 23 45 67 89',
    email: 'jean.dupont@acme.example',
    linkedin: 'https://linkedin.com/in/jean-dupont',
    source: 'manual',
    is_primary: false,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    ...overrides,
  }
}

afterEach(() => {
  cleanup()
})

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('ContactsList — liste fournie', () => {
  it('rend N contacts avec leur identité et compteur dans le header', () => {
    const contacts = [
      makeContact({ id: 'c-1', prenom: 'Jean', nom: 'DUPONT', poste: 'DAF' }),
      makeContact({
        id: 'c-2',
        prenom: 'Marie',
        nom: 'MARTIN',
        poste: 'Responsable RSE',
        telephone: null,
        email: 'marie@acme.example',
        linkedin: null,
      }),
    ]
    render(<ContactsList prospect={makeProspect()} contacts={contacts} />)

    expect(screen.getByText(/Contacts identifiés \(2\)/i)).toBeInTheDocument()
    expect(screen.getByText('Jean DUPONT')).toBeInTheDocument()
    expect(screen.getByText('Marie MARTIN')).toBeInTheDocument()
    expect(screen.getByText('DAF')).toBeInTheDocument()
    expect(screen.getByText('Responsable RSE')).toBeInTheDocument()
    expect(screen.getByRole('list', { name: /Liste des contacts identifiés/i })).toBeInTheDocument()
  })

  it('affiche le badge "Primaire" pour un contact is_primary=true', () => {
    const contacts = [
      makeContact({ id: 'c-1', is_primary: true, prenom: 'Alice', nom: 'BERNARD' }),
      makeContact({ id: 'c-2', is_primary: false, prenom: 'Bob', nom: 'CARON' }),
    ]
    render(<ContactsList prospect={makeProspect()} contacts={contacts} />)

    const badges = screen.getAllByText('Primaire')
    expect(badges).toHaveLength(1)
  })

  it('rend tel:, mailto: et LinkedIn avec target+rel corrects', () => {
    const contacts = [makeContact()]
    render(<ContactsList prospect={makeProspect()} contacts={contacts} />)

    const tel = screen.getByRole('link', { name: /Appeler le 01 23 45 67 89/i })
    expect(tel).toHaveAttribute('href', 'tel:0123456789')

    const mail = screen.getByRole('link', { name: /Envoyer un email à jean\.dupont@acme\.example/i })
    expect(mail).toHaveAttribute('href', 'mailto:jean.dupont@acme.example')

    const li = screen.getByRole('link', { name: /LinkedIn/i })
    expect(li).toHaveAttribute('href', 'https://linkedin.com/in/jean-dupont')
    expect(li).toHaveAttribute('target', '_blank')
    expect(li).toHaveAttribute('rel', expect.stringContaining('noopener'))
    expect(li).toHaveAttribute('rel', expect.stringContaining('noreferrer'))
  })
})

describe('ContactsList — fallback legacy', () => {
  it('synthétise un contact depuis prospect.contact_* quand contacts=[]', () => {
    const prospect = makeProspect({
      contact_prenom: 'Sophie',
      contact_nom: 'LEGRAND',
      contact_poste: 'DG',
      contact_email: 'sophie@acme.example',
    })
    render(<ContactsList prospect={prospect} contacts={[]} />)

    expect(screen.getByText('Sophie LEGRAND')).toBeInTheDocument()
    expect(screen.getByText('DG')).toBeInTheDocument()
    expect(screen.getByText(/Contacts identifiés \(1\)/i)).toBeInTheDocument()
    // is_primary=true sur le fallback → badge "Primaire" visible.
    expect(screen.getByText('Primaire')).toBeInTheDocument()
  })

  it('affiche l\'empty state quand aucun contact ni champ legacy', () => {
    render(<ContactsList prospect={makeProspect()} contacts={[]} />)
    expect(
      screen.getByText(/Aucun contact identifié pour cette entreprise/i),
    ).toBeInTheDocument()
  })
})

describe('ContactsList — bouton ajout', () => {
  it('rend le bouton "Ajouter un contact" (AddContactDialog) avec le bon prospectId', () => {
    render(<ContactsList prospect={makeProspect({ id: 'pid-42' })} contacts={[]} />)
    expect(screen.getByTestId('add-contact-mock-pid-42')).toBeInTheDocument()
  })
})
