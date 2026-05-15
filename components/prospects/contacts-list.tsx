import type { Prospect } from '@/lib/types'
import { AddContactDialog } from './add-contact-dialog'

// ── Types locaux ──────────────────────────────────────────────────────────────

/**
 * Contact attaché à un prospect (table prospect_contacts, migration 011).
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
  created_at: string
  updated_at: string
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
    source: 'enrichment',
    is_primary: true,
    created_at: prospect.created_at,
    updated_at: prospect.updated_at,
  }
}

// ── Composant ─────────────────────────────────────────────────────────────────

export function ContactsList({ prospect, contacts }: ContactsListProps) {
  // Si la nouvelle table est vide, on tente le fallback legacy.
  const displayed =
    contacts.length > 0
      ? contacts
      : ([fallbackFromProspect(prospect)].filter(Boolean) as ProspectContact[])

  return (
    <div className="overflow-hidden rounded-2xl border border-white/[0.08] bg-white/[0.03] backdrop-blur-md shadow-sm dark:border-gray-800 dark:bg-gray-900">
      <div className="flex items-center justify-between gap-3 border-b border-white/[0.06] px-6 py-4 dark:border-gray-800">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">
          Contacts identifiés{displayed.length > 0 ? ` (${displayed.length})` : ''}
        </h2>
        <AddContactDialog prospectId={prospect.id} />
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
          <p className="text-sm text-gray-400 dark:text-gray-600">
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

  return (
    <div className="rounded-xl border border-white/[0.06] bg-gray-50/50 px-4 py-3 dark:border-gray-800 dark:bg-gray-800/30">
      {hasIdentity && (
        <div className="flex flex-wrap items-center gap-2">
          {fullName && (
            <p className="text-sm font-semibold text-gray-900 dark:text-white">{fullName}</p>
          )}
          {contact.is_primary && (
            <span className="inline-flex items-center rounded-full bg-green-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-green-700 dark:bg-green-950/40 dark:text-green-400">
              Primaire
            </span>
          )}
        </div>
      )}
      {contact.poste && (
        <p className="text-sm text-gray-500 dark:text-gray-400">{contact.poste}</p>
      )}

      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1.5">
        {contact.telephone && (
          <a
            href={`tel:${contact.telephone.replace(/\s/g, '')}`}
            className="inline-flex items-center gap-1.5 text-sm font-medium text-green-600 transition-colors hover:text-green-700 dark:text-green-400 dark:hover:text-green-300"
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
          <a
            href={`mailto:${contact.email}`}
            className="inline-flex items-center gap-1.5 text-sm font-medium text-green-600 transition-colors hover:text-green-700 dark:text-green-400 dark:hover:text-green-300"
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
            >
              <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" />
              <polyline points="22,6 12,13 2,6" />
            </svg>
            {contact.email}
          </a>
        )}

        {contact.linkedin && (
          <a
            href={contact.linkedin}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 text-sm font-medium text-blue-600 transition-colors hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300"
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
  )
}
