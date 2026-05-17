// ============================================================
// Tests : contact-masked-detector
// ------------------------------------------------------------
// Couvre les 5 cas demandés :
//   1. email masqué [Masqué]
//   2. nom masqué [Masqué]
//   3. email_is_pro=false
//   4. contact normal → false
//   5. contact null → false
// + cas bord :
//   - email_status='invalid'
//   - contact vide (ni email ni téléphone)
//   - helpers hasOnlyMaskedContacts / hasAnyMaskedContact
// ============================================================

import { describe, it, expect } from 'vitest'
import {
  isMaskedContact,
  hasOnlyMaskedContacts,
  hasAnyMaskedContact,
  type MaskedDetectableContact,
} from '../contact-masked-detector'

describe('isMaskedContact — cas individuels', () => {
  it('détecte un email contenant [Masqué]', () => {
    expect(
      isMaskedContact({
        nom: 'Dupont',
        prenom: 'Jean',
        email: 'jean.dupont+[Masqué]@example.com',
        telephone: '0102030405',
      }),
    ).toBe(true)
  })

  it('détecte un email contenant _masque', () => {
    expect(
      isMaskedContact({
        email: 'contact_masque@acme.fr',
        telephone: '0102030405',
      }),
    ).toBe(true)
  })

  it('détecte un nom égal exactement à [Masqué]', () => {
    expect(
      isMaskedContact({
        nom: '[Masqué]',
        prenom: 'Jean',
        email: 'jean@acme.fr',
        telephone: '0102030405',
        email_is_pro: true,
      }),
    ).toBe(true)
  })

  it('détecte un prénom masqué (variante "Masqué" sans crochets)', () => {
    expect(
      isMaskedContact({
        nom: 'Dupont',
        prenom: 'Masqué',
        email: 'jean@acme.fr',
        telephone: '0102030405',
        email_is_pro: true,
      }),
    ).toBe(true)
  })

  it('détecte un contact avec email_is_pro=false (email perso)', () => {
    expect(
      isMaskedContact({
        nom: 'Dupont',
        prenom: 'Jean',
        email: 'jean.dupont@gmail.com',
        telephone: '0102030405',
        email_is_pro: false,
      }),
    ).toBe(true)
  })

  it('détecte un contact avec email_status=invalid', () => {
    expect(
      isMaskedContact({
        nom: 'Dupont',
        prenom: 'Jean',
        email: 'jean.dupont@acme.fr',
        telephone: '0102030405',
        email_is_pro: true,
        email_status: 'invalid',
      }),
    ).toBe(true)
  })

  it('détecte un contact totalement vide (ni email ni téléphone)', () => {
    expect(
      isMaskedContact({
        nom: 'Dupont',
        prenom: 'Jean',
        email: null,
        telephone: null,
      }),
    ).toBe(true)
  })

  it('retourne false pour un contact normal (email pro + téléphone)', () => {
    expect(
      isMaskedContact({
        nom: 'Dupont',
        prenom: 'Jean',
        email: 'jean.dupont@acme.fr',
        telephone: '0102030405',
        email_is_pro: true,
      }),
    ).toBe(false)
  })

  it('retourne false pour un contact normal sans email mais avec téléphone', () => {
    expect(
      isMaskedContact({
        nom: 'Dupont',
        prenom: 'Jean',
        email: null,
        telephone: '0102030405',
      }),
    ).toBe(false)
  })

  it('retourne false pour null', () => {
    expect(isMaskedContact(null)).toBe(false)
  })

  it('retourne false pour undefined', () => {
    expect(isMaskedContact(undefined)).toBe(false)
  })
})

describe('hasOnlyMaskedContacts', () => {
  it('retourne true quand tous les contacts sont masqués', () => {
    const contacts: MaskedDetectableContact[] = [
      { nom: '[Masqué]', email: '[Masqué]', telephone: null },
      { email: 'x@masque.local', telephone: null },
    ]
    expect(hasOnlyMaskedContacts(contacts)).toBe(true)
  })

  it('retourne false quand au moins un contact est utilisable', () => {
    const contacts: MaskedDetectableContact[] = [
      { nom: '[Masqué]', email: null, telephone: null },
      { nom: 'Dupont', email: 'jean@acme.fr', email_is_pro: true, telephone: '0102030405' },
    ]
    expect(hasOnlyMaskedContacts(contacts)).toBe(false)
  })

  it('retourne false sur liste vide (rien à remplacer)', () => {
    expect(hasOnlyMaskedContacts([])).toBe(false)
  })
})

describe('hasAnyMaskedContact', () => {
  it('retourne true si au moins un contact est masqué', () => {
    const contacts: MaskedDetectableContact[] = [
      { nom: 'Dupont', email: 'jean@acme.fr', email_is_pro: true, telephone: '0102030405' },
      { nom: '[Masqué]', email: null, telephone: null },
    ]
    expect(hasAnyMaskedContact(contacts)).toBe(true)
  })

  it('retourne false si aucun contact n\'est masqué', () => {
    const contacts: MaskedDetectableContact[] = [
      { nom: 'Dupont', email: 'jean@acme.fr', email_is_pro: true, telephone: '0102030405' },
    ]
    expect(hasAnyMaskedContact(contacts)).toBe(false)
  })
})
