import type { Prospect } from '@/lib/types'
import { AddContactDialog } from './add-contact-dialog'
import { ContactEmailStatusBadge } from './contact-email-status-badge'
import { ContactSourceBadge, type ContactSource } from './contact-source-badge'
import { EmailProBadge } from './email-pro-badge'
import { EnrichContactButton } from './enrich-contact-button'
import { VerifyEmailButton } from './verify-email-button'

// ── Types locaux ──────────────────────────────────────────────────────────────

/**
 * Contact attaché à un prospect (table prospect_contacts, migration 011 + 015).
 * Champs `email_is_pro` et `email_verified_at` sont ajoutés par la migration
 * 015 (enrichment v2) — optionnels pour rester compatibles avec les lignes
 * pré-migration et les fixtures de tests.
 *
 * TODO(coord-A): déplacer dans lib/types.ts une fois Agent A à jour.
 */
export interface ProspectContact {
  id: string
  user_id: string
  prospect_id: string
  nom: string | null
  prenom: string | null
  poste: string | null
  telephone: string | null
  email: string | null
  linkedin: string | null
  source: string | null
  is_primary: boolean
  /** Migration 015 — `false` = email perso (gmail, etc.), `true` = pro envoyable. */
  email_is_pro?: boolean | null
  /** Migration 015 — timestamp de la dernière vérif SMTP/Hunter. */
  email_verified_at?: string | null
  /**
   * Migration 015 + 025 — statut Hunter Email Verifier persisté.
   * Valeurs : 'valid' | 'invalid' | 'accept_all' | 'catchall' | 'webmail'
   * | 'disposable' | 'unknown' | 'unverified' | 'pattern_unverified'.
   * `null` = jamais vérifié.
   */
  email_status?: string | null
  /**
   * Migration 015 — score Hunter 0-100 (alias DB `email_confidence`).
   * Exposé en façade comme `email_score` côté UI (cohérent avec l'API verify).
   */
  email_confidence?: number | null
  created_at: string
  updated_at: string
}

/**
 * Mappe un `contact.source` brut (string libre côté DB) vers la valeur
 * canonique attendue par `<ContactSourceBadge>`. Inconnu / null → 'manual'.
 *
 * Tolère les alias historiques (`enrichment` = legacy fallback, `recherche_entreprises`
 * = ancienne valeur orchestrator, etc.) pour ne pas casser les lignes existantes.
 */
function normalizeContactSource(raw: string | null | undefined): ContactSource {
  if (!raw) return 'manual'
  const s = raw.toLowerCase().trim()
  if (s === 're' || s === 'recherche_entreprises' || s === 'recherche-entreprises') return 're'
  if (s === 'inpi') return 'inpi'
  if (s === 'bodacc') return 'bodacc'
  if (s === 'pappers') return 'pappers'
  if (s === 'hunter' || s === 'hunter-pattern') return 'hunter-pattern'
  if (s === 'pattern' || s === 'pattern-dns') return 'pattern'
  if (s === 'ademe' || s === 'enrichment') return 'ademe'
  return 'manual'
}

// ── Props ─────────────────────────────────────────────────────────────────────

interface ContactsListProps {
  prospect: Prospect
  contacts: ProspectContact[]
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Si la table prospect_contacts est vide, on synthétise un contact "primaire"
 * à partir des colonnes legacy prospect.contact_* — pour ne pas casser l'UX
 * tant que la migration de données n'est pas faite.
 */
function fallbackFromProspect(prospect: Prospect): ProspectContact | null {
  const hasAny =
    prospect.contact_nom ||
    prospect.contact_prenom ||
    prospect.contact_poste ||
    prospect.contact_telephone ||
    prospect.contact_email ||
    prospect.contact_linkedin
  if (!hasAny) return null
  return {
    id: `fallback-${prospect.id}`,
    user_id: prospect.user_id,
    prospect_id: prospect.id,
    nom: prospect.contact_nom ?? null,
    prenom: prospect.contact_prenom ?? null,
    poste: prospect.contact_poste ?? null,
    telephone: prospect.contact_telephone ?? null,
    email: prospect.contact_email ?? null,
    linkedin: prospect.contact_linkedin ?? null,
    // Source 'manual' pour le fallback legacy : on n'a pas de traçabilité
    // d'enrichissement pour ces lignes pré-migration 011, et `isPro=null`
    // côté email → l'EmailProBadge ne rend rien (pas de bruit visuel).
    source: 'manual',
    is_primary: true,
    email_is_pro: null,
    email_verified_at: null,
    email_status: null,
    email_confidence: null,
    created_at: prospect.created_at,
    updated_at: prospect.updated_at,
  }
}

/**
 * Détecte les contacts "synthétiques" (placeholder legacy ou fallback non
 * persisté) à partir de l'ID — ces contacts n'existent pas en table
 * `prospect_contacts`, donc on ne peut pas lancer la vérif Hunter dessus.
 */
function isPersistedContactId(id: string): boolean {
  // UUID v4 standard ; les fallbacks utilisent des préfixes (`fallback-`, `legacy-`).
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)
}

// ── Composant ─────────────────────────────────────────────────────────────────

export function ContactsList({ prospect, contacts }: ContactsListProps) {
  // Si la nouvelle table est vide, on tente le fallback legacy.
  const displayed =
    contacts.length > 0
      ? contacts
      : ([fallbackFromProspect(prospect)].filter(Boolean) as ProspectContact[])

  return (
    <div className="overflow-hidden rounded-2xl border border-white/[0.08] bg-white/[0.03] backdrop-blur-md shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-white/[0.06] px-6 py-4">
        <h2 className="font-mono text-[11px] uppercase tracking-[0.18em] text-cyan-400/80">
          Contacts identifiés{displayed.length > 0 ? ` (${displayed.length})` : ''}
        </h2>
        <div className="flex flex-wrap items-start gap-3">
          {/* On passe la liste affichée (= contacts effectifs OU fallback legacy)
              pour que le bouton détecte les placeholders masqués et active
              forceReplace=true côté API. */}
          <EnrichContactButton prospectId={prospect.id} contacts={displayed} />
          <AddContactDialog prospectId={prospect.id} />
        </div>
      </div>
      <div className="px-6 py-5">
        {displayed.length > 0 ? (
          <ul className="space-y-3" aria-label="Liste des contacts identifiés">
            {displayed.map((contact) => (
              <li key={contact.id}>
                <ContactCard contact={contact} />
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-gray-400">
            Aucun contact identifié pour cette entreprise.
          </p>
        )}
      </div>
    </div>
  )
}

// ── ContactCard ───────────────────────────────────────────────────────────────

function ContactCard({ contact }: { contact: ProspectContact }) {
  const fullName = [contact.prenom, contact.nom].filter(Boolean).join(' ').trim()
  const hasIdentity = fullName.length > 0 || Boolean(contact.poste)

  // Initiales pour avatar (max 2 lettres) — fallback sur icône user si vide.
  const initials = (
    (contact.prenom?.[0] ?? '') + (contact.nom?.[0] ?? '')
  )
    .trim()
    .toUpperCase()
    .slice(0, 2)

  const normalizedSource = normalizeContactSource(contact.source)
  // Pour la rétrocompat fallback legacy (source='enrichment'), on n'a pas
  // l'info pro vs perso. On laisse `isPro=null` → le badge ne rend rien.
  const emailIsPro = contact.email_is_pro ?? null
  const emailVerified = Boolean(contact.email_verified_at)

  return (
    <div className="flex gap-3 rounded-xl border border-white/[0.06] bg-white/[0.04] backdrop-blur-md px-5 py-4">
      {/* Avatar — initiales ou icône user générique. flex-shrink-0 pour ne pas
          se faire écraser par le contenu sur mobile. */}
      <div
        className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-green-500/15 text-xs font-semibold text-green-200 ring-1 ring-green-500/25"
        aria-hidden="true"
      >
        {initials || (
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
            <circle cx="12" cy="7" r="4" />
          </svg>
        )}
      </div>

      <div className="min-w-0 flex-1">
        {hasIdentity && (
          <div className="flex flex-wrap items-center gap-2">
            {fullName && (
              <p className="text-sm font-semibold text-white">{fullName}</p>
            )}
            {contact.is_primary && (
              <span className="inline-flex items-center rounded-full bg-green-500/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-green-300 ring-1 ring-green-500/25">
                Primaire
              </span>
            )}
            {/* Badge source — toujours rendu (au minimum "manual"). Permet de
                comprendre d'où vient un contact en un coup d'œil. */}
            <ContactSourceBadge source={normalizedSource} />
            {/* Badge email pro vs perso — rendu uniquement si l'info est
                disponible côté DB (migration 015). `null` → composant ne rend
                rien (fallback legacy non bruyant). */}
            {contact.email && (
              <EmailProBadge isPro={emailIsPro} verified={emailVerified} />
            )}
          </div>
        )}
        {contact.poste && (
          <p className="mt-0.5 text-sm text-gray-300">{contact.poste}</p>
        )}

        <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-2">
          {contact.telephone && (
            <a
              href={`tel:${contact.telephone.replace(/\s/g, '')}`}
              className="inline-flex items-center gap-2 rounded-md text-sm font-medium text-green-400 transition-colors hover:text-green-300 focus:outline-none focus-visible:ring-2 focus-visible:ring-green-500/40"
              aria-label={`Appeler le ${contact.telephone}`}
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.69 12a19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 3.5 1h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L8.09 8.91a16 16 0 0 0 5.27 5.27l1.17-1.17a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 21.28 15l.64 1.92z" />
              </svg>
              {contact.telephone}
            </a>
          )}

          {contact.email && (
            <span className="inline-flex max-w-full flex-wrap items-center gap-x-2 gap-y-1">
              <a
                href={`mailto:${contact.email}`}
                className="inline-flex max-w-full items-center gap-1.5 break-all text-sm font-medium text-green-400 transition-colors hover:text-green-300"
                aria-label={`Envoyer un email à ${contact.email}`}
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                  className="flex-shrink-0"
                >
                  <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" />
                  <polyline points="22,6 12,13 2,6" />
                </svg>
                {contact.email}
              </a>
              {/* GLN-062 — Badge statut Hunter + bouton "Vérifier". On n'affiche
                  le bouton que sur des contacts persistés (présents en
                  prospect_contacts) — les fallbacks legacy n'ont pas d'ID stable. */}
              <ContactEmailStatusBadge
                status={contact.email_status}
                score={contact.email_confidence}
              />
              {isPersistedContactId(contact.id) && (
                <VerifyEmailButton
                  contactId={contact.id}
                  emailVerifiedAt={contact.email_verified_at}
                />
              )}
            </span>
          )}

          {contact.linkedin && (
            <a
              href={contact.linkedin}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 text-sm font-medium text-blue-400 transition-colors hover:text-blue-300"
              aria-label={`Voir le profil LinkedIn (ouvre dans un nouvel onglet)`}
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="currentColor"
                aria-hidden="true"
              >
                <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 0 1-2.063-2.065 2.064 2.064 0 1 1 2.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z" />
              </svg>
              LinkedIn
            </a>
          )}
        </div>
      </div>
    </div>
  )
}
