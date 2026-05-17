import { redirect } from 'next/navigation'
import Link from 'next/link'
import type { SupabaseClient } from '@supabase/supabase-js'

import { createClient } from '@/lib/supabase/server'
import { DismissButton } from '@/components/notifications/dismiss-button'

export const dynamic = 'force-dynamic'

// ── Types locaux ──────────────────────────────────────────────────────────────

type ExchangeType = 'appel' | 'email' | 'linkedin' | 'rdv' | 'autre'

interface ExchangeRow {
  id: string
  prospect_id: string
  occurred_at: string
  type: string
  result: string | null
  notes: string | null
  callback_date: string | null
  callback_done: boolean
}

interface ProspectRow {
  id: string
  raison_sociale: string
  statut: string | null
}

interface ContactRow {
  prospect_id: string
  prenom: string | null
  nom: string | null
  poste: string | null
  is_primary: boolean | null
}

interface EnrichedExchange extends ExchangeRow {
  raison_sociale: string
  statut: string | null
  contact_name: string | null
  contact_poste: string | null
}

// ── Constantes ────────────────────────────────────────────────────────────────

// Résultats "chauds" pour la section "Échanges importants".
const HOT_RESULTS = ['interested', 'callback'] as const

const TYPE_LABELS: Record<ExchangeType, string> = {
  appel: 'Appel',
  email: 'Email',
  linkedin: 'LinkedIn',
  rdv: 'RDV',
  autre: 'Autre',
}

const TYPE_CLASSES: Record<ExchangeType, string> = {
  appel: 'bg-green-500/15 text-green-200 ring-1 ring-green-500/25',
  email: 'bg-blue-500/15 text-blue-200 ring-1 ring-blue-500/25',
  linkedin: 'bg-sky-500/15 text-sky-200 ring-1 ring-sky-500/25',
  rdv: 'bg-purple-500/15 text-purple-200 ring-1 ring-purple-500/25',
  autre: 'bg-white/[0.06] text-gray-200 ring-1 ring-white/[0.08]',
}

const RESULT_MAP: Record<string, { label: string; className: string }> = {
  interested: {
    label: 'Intéressé',
    className: 'bg-green-500/15 text-green-200 ring-1 ring-green-500/25',
  },
  callback: {
    label: 'Rappel demandé',
    className: 'bg-blue-500/15 text-blue-200 ring-1 ring-blue-500/25',
  },
  not_interested: {
    label: 'Pas intéressé',
    className: 'bg-red-500/15 text-red-200 ring-1 ring-red-500/25',
  },
  wrong_contact: {
    label: 'Mauvais contact',
    className: 'bg-orange-500/15 text-orange-200 ring-1 ring-orange-500/25',
  },
  no_answer: {
    label: 'Pas de réponse',
    className: 'bg-white/[0.06] text-gray-300 ring-1 ring-white/[0.08]',
  },
  voicemail: {
    label: 'Répondeur',
    className: 'bg-white/[0.06] text-gray-300 ring-1 ring-white/[0.08]',
  },
  email_sent: {
    label: 'Email envoyé',
    className: 'bg-blue-500/15 text-blue-200 ring-1 ring-blue-500/25',
  },
}

// Statuts CRM — labels et couleurs alignés avec prospects-filters.
const STATUT_MAP: Record<string, { label: string; className: string }> = {
  sourced: { label: 'Pas de contact', className: 'bg-white/[0.06] text-gray-300 ring-1 ring-white/[0.08]' },
  qualified: { label: 'Qualifié', className: 'bg-blue-500/15 text-blue-200 ring-1 ring-blue-500/25' },
  contacted: { label: 'Contacté', className: 'bg-yellow-500/15 text-yellow-200 ring-1 ring-yellow-500/25' },
  interested: { label: 'Intéressé', className: 'bg-green-500/15 text-green-200 ring-1 ring-green-500/25' },
  rdv: { label: 'Intéressé', className: 'bg-green-500/15 text-green-200 ring-1 ring-green-500/25' },
  offer_sent: { label: 'Offre envoyée', className: 'bg-indigo-500/15 text-indigo-200 ring-1 ring-indigo-500/25' },
  converted: { label: 'Affaire conclue', className: 'bg-emerald-500/15 text-emerald-200 ring-1 ring-emerald-500/25' },
  rejected: { label: 'Sans suite', className: 'bg-red-500/15 text-red-200 ring-1 ring-red-500/25' },
  on_hold: { label: 'En stand-by', className: 'bg-orange-500/15 text-orange-200 ring-1 ring-orange-500/25' },
  do_not_contact: { label: 'Ne pas contacter', className: 'bg-slate-500/20 text-slate-300 ring-1 ring-slate-500/30' },
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function safeTypeMeta(type: string): { label: string; className: string } {
  const key = type as ExchangeType
  return {
    label: TYPE_LABELS[key] ?? type,
    className: TYPE_CLASSES[key] ?? TYPE_CLASSES.autre,
  }
}

function safeStatutMeta(statut: string | null): { label: string; className: string } | null {
  if (!statut) return null
  return STATUT_MAP[statut] ?? null
}

function safeResultMeta(result: string | null): { label: string; className: string } | null {
  if (!result) return null
  return (
    RESULT_MAP[result] ?? {
      label: result,
      className: 'bg-white/[0.06] text-gray-200 ring-1 ring-white/[0.08]',
    }
  )
}

/**
 * Formate une date de callback en label relatif lisible.
 * Exemples : "En retard de 3 j", "Aujourd'hui", "Demain", "Dans 3 j"
 */
function formatCallbackLabel(dateStr: string, now: Date): string {
  const date = new Date(dateStr)
  // Comparaison sur les dates calendaires (sans heure) pour éviter le bruit
  // des fuseaux horaires côté serveur.
  const todayMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const dateMidnight = new Date(date.getFullYear(), date.getMonth(), date.getDate())
  const diffDays = Math.round(
    (dateMidnight.getTime() - todayMidnight.getTime()) / (1000 * 60 * 60 * 24),
  )

  if (diffDays < 0) return `En retard de ${Math.abs(diffDays)} j`
  if (diffDays === 0) return "Aujourd'hui"
  if (diffDays === 1) return 'Demain'
  return `Dans ${diffDays} j`
}

function formatRelative(dateStr: string, now: Date): string {
  const date = new Date(dateStr)
  const diffMs = now.getTime() - date.getTime()
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24))

  if (diffDays === 0) return "Aujourd'hui"
  if (diffDays === 1) return 'Il y a 1 jour'
  if (diffDays < 7) return `Il y a ${diffDays} jours`
  return new Intl.DateTimeFormat('fr-FR', { dateStyle: 'medium' }).format(date)
}

function truncateNotes(notes: string | null, maxLen = 120): string | null {
  if (!notes) return null
  return notes.length > maxLen ? `${notes.slice(0, maxLen).trimEnd()}…` : notes
}

// ── Icônes type d'échange (réutilisées depuis exchanges-panel, inline) ─────

function TypeIcon({ type }: { type: string }) {
  switch (type) {
    case 'appel':
      return (
        <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.69 12a19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 3.5 1h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L8.09 8.91a16 16 0 0 0 5.27 5.27l1.17-1.17a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 21.28 15l.64 1.92z" />
        </svg>
      )
    case 'email':
      return (
        <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" />
          <polyline points="22,6 12,13 2,6" />
        </svg>
      )
    case 'linkedin':
      return (
        <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 0 1-2.063-2.065 2.064 2.064 0 1 1 2.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z" />
        </svg>
      )
    case 'rdv':
      return (
        <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
          <line x1="16" y1="2" x2="16" y2="6" />
          <line x1="8" y1="2" x2="8" y2="6" />
          <line x1="3" y1="10" x2="21" y2="10" />
        </svg>
      )
    default:
      return (
        <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <circle cx="12" cy="12" r="10" />
          <line x1="12" y1="8" x2="12" y2="12" />
          <line x1="12" y1="16" x2="12.01" y2="16" />
        </svg>
      )
  }
}

// ── Sub-composants ─────────────────────────────────────────────────────────────

function SectionHeader({ title, count }: { title: string; count: number }) {
  return (
    <div className="flex items-center gap-3">
      <h2 className="font-mono text-[10px] uppercase tracking-[0.18em] text-cyan-400/70">
        {title}
      </h2>
      {count > 0 && (
        <span className="rounded-full bg-white/[0.06] px-2 py-0.5 font-mono text-[10px] text-gray-400 ring-1 ring-white/[0.08]">
          {count}
        </span>
      )}
    </div>
  )
}

function ExchangeCard({
  exchange,
  now,
  showDismiss,
  relativeDate,
}: {
  exchange: EnrichedExchange
  now: Date
  showDismiss: boolean
  relativeDate: string
}) {
  const typeMeta = safeTypeMeta(exchange.type)
  const resultMeta = safeResultMeta(exchange.result)
  const statutMeta = safeStatutMeta(exchange.statut)
  const notes = truncateNotes(exchange.notes)
  const contactLabel = exchange.contact_name
    ? exchange.contact_poste
      ? `${exchange.contact_name} · ${exchange.contact_poste}`
      : exchange.contact_name
    : null

  return (
    <li className="flex gap-3 rounded-xl border border-white/[0.06] bg-white/[0.02] p-4 transition-colors hover:border-white/[0.1] hover:bg-white/[0.04]">
      {/* Avatar type */}
      <div
        className={`flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full ${typeMeta.className}`}
        aria-hidden="true"
      >
        <TypeIcon type={exchange.type} />
      </div>

      <div className="min-w-0 flex-1 space-y-2">
        {/* Ligne 1 : date relative + prospect */}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <span className="font-mono text-xs text-gray-400">{relativeDate}</span>
          <Link
            href={`/prospects/${exchange.prospect_id}`}
            className="truncate text-sm font-semibold text-white transition-colors hover:text-green-300"
          >
            {exchange.raison_sociale}
          </Link>
          {statutMeta && (
            <span
              className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium ${statutMeta.className}`}
              title={`Statut CRM : ${statutMeta.label}`}
            >
              {statutMeta.label}
            </span>
          )}
        </div>

        {/* Ligne 2 : contact principal */}
        {contactLabel && (
          <div className="flex items-center gap-1.5 text-xs text-gray-300">
            <svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="flex-shrink-0 text-gray-500" aria-hidden="true">
              <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
              <circle cx="12" cy="7" r="4" />
            </svg>
            <span className="truncate">{contactLabel}</span>
          </div>
        )}

        {/* Ligne 3 : badges type + résultat + rappel */}
        <div className="flex flex-wrap items-center gap-2">
          <span
            className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ${typeMeta.className}`}
          >
            <TypeIcon type={exchange.type} />
            {typeMeta.label}
          </span>
          {resultMeta && (
            <span
              className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${resultMeta.className}`}
            >
              {resultMeta.label}
            </span>
          )}
          {exchange.callback_date && !exchange.callback_done && (
            <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/15 px-2.5 py-0.5 text-xs font-medium text-amber-200 ring-1 ring-amber-500/25">
              {/* Icône alarme */}
              <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <circle cx="12" cy="12" r="10" />
                <polyline points="12 6 12 12 16 14" />
              </svg>
              Rappel · {formatCallbackLabel(exchange.callback_date, now)}
            </span>
          )}
        </div>

        {/* Notes tronquées */}
        {notes && (
          <p className="text-xs leading-relaxed text-gray-400">{notes}</p>
        )}

        {/* Action */}
        {showDismiss && (
          <div className="pt-1">
            <DismissButton exchangeId={exchange.id} />
          </div>
        )}
      </div>
    </li>
  )
}

// ── Fetch data ─────────────────────────────────────────────────────────────────

async function fetchNotificationsData(userId: string) {
  const supabase = await createClient()
  // Migration 014 ajoute `callback_done` mais `database.types.ts` n'a pas
  // encore ete regenere — on cast localement vers SupabaseClient<any> pour
  // unblocker le type-check. Pattern deja utilise dans le projet pour les
  // vues/colonnes recentes (cf. app/api/admin/sirene-status/route.ts).
  const sb = supabase as unknown as SupabaseClient
  const now = new Date()
  const inSevenDays = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000)
  const fourteenDaysAgo = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000)

  // Relances actives : TOUTES les relances futures non traitées + en retard.
  // Pas de cap supérieur sur callback_date — on veut voir aussi les relances
  // à 1 mois, 3 mois, etc. (sections "Plus tard").
  const callbacksPromise = sb
    .from('prospect_exchanges')
    .select('id, prospect_id, occurred_at, type, result, notes, callback_date, callback_done')
    .eq('callback_done', false)
    .not('callback_date', 'is', null)
    .order('callback_date', { ascending: true })

  // Échanges chauds des 14 derniers jours (interested ou callback).
  const hotExchangesPromise = sb
    .from('prospect_exchanges')
    .select('id, prospect_id, occurred_at, type, result, notes, callback_date, callback_done')
    .in('result', HOT_RESULTS as unknown as string[])
    .gte('occurred_at', fourteenDaysAgo.toISOString())
    .order('occurred_at', { ascending: false })
    .limit(30)

  // Prospects liés (raison_sociale + statut CRM) — RLS filtre automatiquement.
  const prospectsPromise = supabase
    .from('prospects')
    .select('id, raison_sociale, statut')

  // Contacts liés — on prend le contact primaire pour chaque prospect.
  const contactsPromise = supabase
    .from('prospect_contacts')
    .select('prospect_id, prenom, nom, poste, is_primary')

  const [callbacksRes, hotRes, prospectsRes, contactsRes] = await Promise.all([
    callbacksPromise,
    hotExchangesPromise,
    prospectsPromise,
    contactsPromise,
  ])

  // Map prospect_id → { raison_sociale, statut } pour l'enrichissement.
  const prospectMap = new Map<string, { raison_sociale: string; statut: string | null }>(
    ((prospectsRes.data ?? []) as ProspectRow[]).map((p) => [
      p.id,
      { raison_sociale: p.raison_sociale, statut: p.statut },
    ]),
  )

  // Map prospect_id → contact principal (is_primary=true, sinon 1er contact dispo).
  // `full_name` = "prenom nom" joint (les 2 colonnes brutes en DB).
  const contactMap = new Map<string, { full_name: string | null; poste: string | null }>()
  for (const c of (contactsRes.data ?? []) as ContactRow[]) {
    const existing = contactMap.get(c.prospect_id)
    // On garde toujours le primary si trouvé, sinon le 1er rencontré.
    if (!existing || c.is_primary) {
      const fullName = [c.prenom, c.nom]
        .filter((p): p is string => Boolean(p && p.trim()))
        .join(' ')
        .trim() || null
      contactMap.set(c.prospect_id, { full_name: fullName, poste: c.poste })
    }
  }

  function enrich(rows: ExchangeRow[]): EnrichedExchange[] {
    return rows.map((ex) => {
      const prospectInfo = prospectMap.get(ex.prospect_id)
      const contactInfo = contactMap.get(ex.prospect_id)
      return {
        ...ex,
        raison_sociale: prospectInfo?.raison_sociale ?? 'Prospect inconnu',
        statut: prospectInfo?.statut ?? null,
        contact_name: contactInfo?.full_name ?? null,
        contact_poste: contactInfo?.poste ?? null,
      }
    })
  }

  const callbacks = enrich((callbacksRes.data ?? []) as ExchangeRow[])
  const hotExchanges = enrich((hotRes.data ?? []) as ExchangeRow[])

  // Sous-sections relances : en retard / aujourd'hui / cette semaine / plus tard.
  const todayMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const tomorrowMidnight = new Date(todayMidnight.getTime() + 24 * 60 * 60 * 1000)

  const overdue = callbacks.filter((ex) => {
    if (!ex.callback_date) return false
    return new Date(ex.callback_date) < todayMidnight
  })
  const today = callbacks.filter((ex) => {
    if (!ex.callback_date) return false
    const d = new Date(ex.callback_date)
    return d >= todayMidnight && d < tomorrowMidnight
  })
  const thisWeek = callbacks.filter((ex) => {
    if (!ex.callback_date) return false
    const d = new Date(ex.callback_date)
    return d >= tomorrowMidnight && d <= inSevenDays
  })
  const later = callbacks.filter((ex) => {
    if (!ex.callback_date) return false
    return new Date(ex.callback_date) > inSevenDays
  })

  return { overdue, today, thisWeek, later, hotExchanges, now }
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default async function NotificationsPage() {
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { overdue, today, thisWeek, later, hotExchanges, now } =
    await fetchNotificationsData(user.id)

  const totalCallbacks = overdue.length + today.length + thisWeek.length + later.length

  return (
    <div className="mx-auto max-w-3xl space-y-8">
      {/* ── En-tête ───────────────────────────────────────────────────── */}
      <div>
        <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-green-400/70">
          {'// glan · notifications'}
        </p>
        <h1 className="mt-1 bg-gradient-to-br from-white via-green-100 to-green-300 bg-clip-text text-3xl font-bold tracking-tight text-transparent">
          Notifications importantes
        </h1>
        <p className="mt-1 font-mono text-[11px] text-green-400/70">
          {'// relances à faire · échanges chauds récents'}
        </p>
      </div>

      {/* ── Section relances ──────────────────────────────────────────── */}
      <section aria-labelledby="section-callbacks">
        <div
          id="section-callbacks"
          className="mb-4 flex items-center gap-3 border-b border-white/[0.06] pb-3"
        >
          <SectionHeader title="Relances à faire" count={totalCallbacks} />
        </div>

        {totalCallbacks === 0 ? (
          <div className="flex flex-col items-center gap-3 rounded-2xl border border-white/[0.06] bg-white/[0.02] px-6 py-10 text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-white/[0.04] ring-1 ring-white/[0.08]">
              <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-gray-400" aria-hidden="true">
                <polyline points="20 6 9 17 4 12" />
              </svg>
            </div>
            <p className="text-sm font-semibold text-gray-200">Aucune relance prévue</p>
            <p className="text-xs text-gray-400">
              Les relances planifiées lors de vos échanges apparaissent ici.
            </p>
            <Link
              href="/prospects"
              className="mt-2 inline-flex items-center gap-2 rounded-lg border border-white/10 bg-white/[0.05] px-4 py-2 text-xs font-medium text-gray-300 transition-colors hover:border-green-500/30 hover:bg-green-500/10 hover:text-green-300"
            >
              Voir les prospects
            </Link>
          </div>
        ) : (
          <div className="space-y-6">
            {/* En retard */}
            {overdue.length > 0 && (
              <div>
                <p className="mb-3 flex items-center gap-2 font-mono text-[9px] uppercase tracking-[0.2em] text-red-400/70">
                  <span className="h-px flex-1 bg-red-500/20" aria-hidden="true" />
                  En retard ({overdue.length})
                  <span className="h-px flex-1 bg-red-500/20" aria-hidden="true" />
                </p>
                <ul className="space-y-2" aria-label="Relances en retard">
                  {overdue.map((ex) => (
                    <ExchangeCard
                      key={ex.id}
                      exchange={ex}
                      now={now}
                      showDismiss
                      relativeDate={ex.callback_date ? formatCallbackLabel(ex.callback_date, now) : ''}
                    />
                  ))}
                </ul>
              </div>
            )}

            {/* Aujourd'hui */}
            {today.length > 0 && (
              <div>
                <p className="mb-3 flex items-center gap-2 font-mono text-[9px] uppercase tracking-[0.2em] text-amber-400/70">
                  <span className="h-px flex-1 bg-amber-500/20" aria-hidden="true" />
                  {"Aujourd'hui"} ({today.length})
                  <span className="h-px flex-1 bg-amber-500/20" aria-hidden="true" />
                </p>
                <ul className="space-y-2" aria-label="Relances aujourd'hui">
                  {today.map((ex) => (
                    <ExchangeCard
                      key={ex.id}
                      exchange={ex}
                      now={now}
                      showDismiss
                      relativeDate={"Aujourd'hui"}
                    />
                  ))}
                </ul>
              </div>
            )}

            {/* Cette semaine */}
            {thisWeek.length > 0 && (
              <div>
                <p className="mb-3 flex items-center gap-2 font-mono text-[9px] uppercase tracking-[0.2em] text-cyan-400/70">
                  <span className="h-px flex-1 bg-cyan-500/20" aria-hidden="true" />
                  Cette semaine ({thisWeek.length})
                  <span className="h-px flex-1 bg-cyan-500/20" aria-hidden="true" />
                </p>
                <ul className="space-y-2" aria-label="Relances cette semaine">
                  {thisWeek.map((ex: EnrichedExchange) => (
                    <ExchangeCard
                      key={ex.id}
                      exchange={ex}
                      now={now}
                      showDismiss
                      relativeDate={ex.callback_date ? formatCallbackLabel(ex.callback_date, now) : ''}
                    />
                  ))}
                </ul>
              </div>
            )}

            {/* Plus tard (> 7 jours) */}
            {later.length > 0 && (
              <div>
                <p className="mb-3 flex items-center gap-2 font-mono text-[9px] uppercase tracking-[0.2em] text-gray-400/70">
                  <span className="h-px flex-1 bg-white/[0.08]" aria-hidden="true" />
                  Plus tard ({later.length})
                  <span className="h-px flex-1 bg-white/[0.08]" aria-hidden="true" />
                </p>
                <ul className="space-y-2" aria-label="Relances futures">
                  {later.map((ex: EnrichedExchange) => (
                    <ExchangeCard
                      key={ex.id}
                      exchange={ex}
                      now={now}
                      showDismiss
                      relativeDate={ex.callback_date ? formatCallbackLabel(ex.callback_date, now) : ''}
                    />
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </section>

      {/* ── Section échanges chauds ───────────────────────────────────── */}
      <section aria-labelledby="section-hot">
        <div
          id="section-hot"
          className="mb-4 flex items-center gap-3 border-b border-white/[0.06] pb-3"
        >
          <SectionHeader title="Échanges importants récents" count={hotExchanges.length} />
          <span className="font-mono text-[9px] text-gray-400">14 derniers jours</span>
        </div>

        {hotExchanges.length === 0 ? (
          <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] px-6 py-8 text-center">
            <p className="text-sm text-gray-400">
              Aucun échange chaud (intéressé / rappel demandé) ces 14 derniers jours.
            </p>
          </div>
        ) : (
          <ul className="space-y-2" aria-label="Échanges importants récents">
            {hotExchanges.map((ex) => (
              <ExchangeCard
                key={ex.id}
                exchange={ex}
                now={now}
                showDismiss={false}
                relativeDate={formatRelative(ex.occurred_at, now)}
              />
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}
