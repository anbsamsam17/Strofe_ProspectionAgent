'use client'

// ============================================================
// CalendarView — vue calendrier FullCalendar pour relances/rappels
//
// Sprint 3 retour client items #14, #15, #17.
//
// - Bibliothèque : @fullcalendar/react avec plugins dayGrid, timeGrid,
//   interaction (drag&drop natif). Locale fr.
// - Toggle entre vue mois (`dayGridMonth`) et vue semaine (`timeGridWeek`).
// - Drag & drop d'un événement → PATCH callback_date sur l'échange.
//   Rollback (info.revert()) si le PATCH échoue.
// - Click sur un événement → ouvre une modale d'édition du rappel
//   (date, type, notes). PATCH au submit puis router.refresh.
//
// Hydration Next.js 15 :
//   FullCalendar manipule le DOM côté client. On guarde un état `mounted`
//   pour éviter un mismatch SSR/CSR (le composant CC est rendu SSR par
//   défaut sinon — bug d'hydration "ref is null" sur la grille).
// ============================================================

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useRouter, useSearchParams } from 'next/navigation'
import FullCalendar from '@fullcalendar/react'
import dayGridPlugin from '@fullcalendar/daygrid'
import timeGridPlugin from '@fullcalendar/timegrid'
import interactionPlugin from '@fullcalendar/interaction'
import frLocale from '@fullcalendar/core/locales/fr'
import type {
  EventClickArg,
  EventDropArg,
  EventInput,
} from '@fullcalendar/core'

import { useToast } from '@/components/ui/toast'

// ── Types exposés ─────────────────────────────────────────────────────────────

export interface ExchangeEvent {
  /** id de la ligne `prospect_exchanges`. */
  id: string
  prospect_id: string
  prospect_raison_sociale: string
  prospect_siren: string | null
  /** Type d'échange ; libre côté DB mais on connaît les 5 attendus. */
  type: string
  /** ISO datetime. */
  callback_date: string
  notes: string | null
}

// ── Constantes UI ─────────────────────────────────────────────────────────────

// Couleurs par type — cohérentes avec exchanges-panel.tsx (badges).
// On utilise des hex pour FullCalendar (les classes Tailwind ne sont pas
// applicables sur les events de FC sans CSS custom).
const TYPE_COLORS: Record<string, { bg: string; border: string }> = {
  appel: { bg: '#0891b2', border: '#0e7490' }, // cyan-600
  email: { bg: '#7c3aed', border: '#6d28d9' }, // violet-600
  linkedin: { bg: '#2563eb', border: '#1d4ed8' }, // blue-600
  rdv: { bg: '#16a34a', border: '#15803d' }, // green-600
  autre: { bg: '#64748b', border: '#475569' }, // slate-500
}

function colorsForType(type: string): { bg: string; border: string } {
  return TYPE_COLORS[type] ?? TYPE_COLORS.autre
}

const TYPE_LABELS: Record<string, string> = {
  appel: 'Appel',
  email: 'Email',
  linkedin: 'LinkedIn',
  rdv: 'RDV',
  autre: 'Autre',
}

// ── Composant ─────────────────────────────────────────────────────────────────

interface CalendarViewProps {
  events: ExchangeEvent[]
}

export function CalendarView({ events }: CalendarViewProps) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const { toast } = useToast()
  const [mounted, setMounted] = useState(false)
  const [editTarget, setEditTarget] = useState<ExchangeEvent | null>(null)

  // Index pour retrouver l'event original au click (FullCalendar ne nous
  // redonne pas l'objet brut, juste extendedProps).
  const eventsById = useRef(new Map<string, ExchangeEvent>())
  useEffect(() => {
    eventsById.current = new Map(events.map((e) => [e.id, e]))
  }, [events])

  // Anti-hydration mismatch.
  useEffect(() => {
    setMounted(true)
  }, [])

  // Item #12 : si on arrive avec ?focus=<exchange.id>, on ouvre directement
  // la modale d'edition sur le rappel cible (lien depuis la fiche prospect).
  // On ne le fait qu'une fois apres mount pour eviter une re-ouverture si
  // l'URL ne change pas mais que les events sont refetch.
  const focusedHandled = useRef(false)
  useEffect(() => {
    if (!mounted || focusedHandled.current) return
    const focusId = searchParams.get('focus')
    if (!focusId) return
    const target = events.find((e) => e.id === focusId)
    if (target) {
      setEditTarget(target)
      focusedHandled.current = true
    }
  }, [mounted, events, searchParams])

  // Mapping ExchangeEvent → EventInput FullCalendar.
  const calendarEvents = useMemo<EventInput[]>(
    () =>
      events.map((e) => {
        const colors = colorsForType(e.type)
        const label = TYPE_LABELS[e.type] ?? e.type
        return {
          id: e.id,
          title: `[${label}] ${e.prospect_raison_sociale}`,
          start: e.callback_date,
          allDay: true,
          backgroundColor: colors.bg,
          borderColor: colors.border,
          textColor: '#fff',
          extendedProps: { exchangeEvent: e },
        }
      }),
    [events],
  )

  // ── Drag & drop : PATCH callback_date ──────────────────────────────────────
  const handleEventDrop = useCallback(
    async (info: EventDropArg) => {
      const eventData = eventsById.current.get(info.event.id)
      if (!eventData) {
        info.revert()
        return
      }
      const newStart = info.event.start
      if (!newStart) {
        info.revert()
        return
      }
      const newIso = newStart.toISOString()
      try {
        const res = await fetch(
          `/api/prospects/${eventData.prospect_id}/exchanges/${eventData.id}`,
          {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ callback_date: newIso }),
          },
        )
        if (!res.ok) {
          const data = (await res.json().catch(() => ({}))) as {
            error?: string | { message?: string }
          }
          const msg =
            typeof data.error === 'string'
              ? data.error
              : data.error?.message ?? 'Erreur lors du déplacement du rappel'
          throw new Error(msg)
        }
        toast({
          title: 'Rappel déplacé',
          description: `${eventData.prospect_raison_sociale} → ${newStart.toLocaleDateString('fr-FR', { dateStyle: 'medium' })}`,
          tone: 'success',
        })
        router.refresh()
      } catch (err) {
        info.revert()
        toast({
          title: 'Échec du déplacement',
          description: err instanceof Error ? err.message : 'Erreur inconnue',
          tone: 'error',
        })
      }
    },
    [router, toast],
  )

  // ── Click sur un event : ouvre la modal d'édition ───────────────────────────
  const handleEventClick = useCallback((info: EventClickArg) => {
    info.jsEvent.preventDefault()
    const eventData = eventsById.current.get(info.event.id)
    if (eventData) {
      setEditTarget(eventData)
    }
  }, [])

  if (!mounted) {
    // Skeleton pendant l'hydration — évite "ref is null" + FOUC.
    return (
      <div
        aria-hidden="true"
        className="h-[640px] animate-pulse rounded-2xl border border-white/[0.06] bg-white/[0.025] backdrop-blur-md"
      />
    )
  }

  return (
    <>
      <div className="overflow-hidden rounded-2xl border border-white/[0.08] bg-white/[0.03] backdrop-blur-md p-4 shadow-sm calendar-glass">
        <FullCalendar
          plugins={[dayGridPlugin, timeGridPlugin, interactionPlugin]}
          initialView="dayGridMonth"
          locale={frLocale}
          firstDay={1}
          headerToolbar={{
            left: 'prev,next today',
            center: 'title',
            right: 'dayGridMonth,timeGridWeek',
          }}
          buttonText={{
            today: "Aujourd'hui",
            month: 'Mois',
            week: 'Semaine',
          }}
          events={calendarEvents}
          editable
          eventStartEditable
          eventDurationEditable={false}
          dayMaxEvents={3}
          height="auto"
          eventDrop={handleEventDrop}
          eventClick={handleEventClick}
          noEventsText="Aucun rappel sur cette période"
        />
      </div>

      {editTarget && (
        <CalendarEditRappelDialog
          exchange={editTarget}
          onClose={() => setEditTarget(null)}
          onSaved={() => {
            setEditTarget(null)
            router.refresh()
          }}
        />
      )}

      {/* Styles globaux légers pour adapter FullCalendar au thème glass-dark.
          On évite d'override agressivement — FC reste lisible avec son default. */}
      <style jsx global>{`
        .calendar-glass .fc {
          color: rgb(229 231 235);
        }
        .calendar-glass .fc-toolbar-title {
          font-size: 1.05rem !important;
          font-weight: 600;
          color: #fff;
        }
        .calendar-glass .fc-button {
          background: rgba(255, 255, 255, 0.04) !important;
          border: 1px solid rgba(255, 255, 255, 0.08) !important;
          color: rgb(229 231 235) !important;
          text-transform: none !important;
          font-weight: 500 !important;
          padding: 6px 12px !important;
        }
        .calendar-glass .fc-button:hover {
          background: rgba(255, 255, 255, 0.08) !important;
        }
        .calendar-glass .fc-button-primary:not(:disabled).fc-button-active,
        .calendar-glass .fc-button-primary:not(:disabled):active {
          background: rgb(22 163 74 / 0.2) !important;
          border-color: rgb(34 197 94 / 0.4) !important;
          color: rgb(187 247 208) !important;
          box-shadow: none !important;
        }
        .calendar-glass .fc-daygrid-day,
        .calendar-glass .fc-timegrid-slot,
        .calendar-glass .fc-col-header-cell {
          background: transparent !important;
          border-color: rgba(255, 255, 255, 0.06) !important;
        }
        .calendar-glass .fc-day-today {
          background: rgba(34, 197, 94, 0.06) !important;
        }
        .calendar-glass .fc-daygrid-day-number,
        .calendar-glass .fc-col-header-cell-cushion,
        .calendar-glass .fc-timegrid-axis-cushion,
        .calendar-glass .fc-timegrid-slot-label-cushion {
          color: rgb(209 213 219) !important;
        }
        .calendar-glass .fc-event {
          cursor: pointer;
          border-radius: 6px !important;
          padding: 1px 4px !important;
          font-weight: 500;
          font-size: 11px;
        }
      `}</style>
    </>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Modale d'édition d'un rappel (calendrier)
//
// Réutilise le pattern de edit-exchange-dialog.tsx mais simplifié : on
// n'édite que les champs pertinents au rappel (date, type, notes). Le
// composant edit-exchange-dialog.tsx n'est pas réutilisé tel quel car il
// expose une trigger button et démarre fermé — ici on a déjà l'event source.
// ─────────────────────────────────────────────────────────────────────────────

interface EditRappelDialogProps {
  exchange: ExchangeEvent
  onClose: () => void
  onSaved: () => void
}

function toDateInput(iso: string): string {
  try {
    const d = new Date(iso)
    if (Number.isNaN(d.getTime())) return ''
    const pad = (n: number) => n.toString().padStart(2, '0')
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
  } catch {
    return ''
  }
}

function CalendarEditRappelDialog({
  exchange,
  onClose,
  onSaved,
}: EditRappelDialogProps) {
  const { toast } = useToast()
  const [callbackDate, setCallbackDate] = useState<string>(() =>
    toDateInput(exchange.callback_date),
  )
  const [type, setType] = useState<string>(exchange.type)
  const [notes, setNotes] = useState<string>(exchange.notes ?? '')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    setMounted(true)
  }, [])

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = prev
    }
  }, [onClose])

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError(null)
    if (!callbackDate) {
      setError('La date de rappel est obligatoire.')
      return
    }
    setPending(true)
    try {
      const callbackIso = new Date(callbackDate).toISOString()
      const res = await fetch(
        `/api/prospects/${exchange.prospect_id}/exchanges/${exchange.id}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            callback_date: callbackIso,
            type,
            notes,
          }),
        },
      )
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as {
          error?: string | { message?: string }
        }
        const msg =
          typeof data.error === 'string'
            ? data.error
            : data.error?.message ?? 'Erreur lors de la mise à jour du rappel'
        throw new Error(msg)
      }
      toast({
        title: 'Rappel mis à jour',
        tone: 'success',
      })
      onSaved()
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Erreur inconnue'
      setError(msg)
      toast({ title: 'Échec de la mise à jour', description: msg, tone: 'error' })
    } finally {
      setPending(false)
    }
  }

  if (!mounted) return null

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="calendar-edit-title"
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 px-4 backdrop-blur-sm"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div className="w-[calc(100vw-2rem)] max-w-lg rounded-2xl border border-white/[0.08] bg-[oklch(14%_0.02_240)]/95 backdrop-blur-md p-6 shadow-2xl ring-1 ring-black/30">
        <div className="mb-5 flex items-start justify-between gap-3">
          <div>
            <h3 id="calendar-edit-title" className="text-lg font-semibold text-white">
              Modifier le rappel
            </h3>
            <p className="mt-0.5 text-sm text-gray-400">
              {exchange.prospect_raison_sociale}
              {exchange.prospect_siren ? ` · SIREN ${exchange.prospect_siren}` : ''}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fermer la fenêtre"
            className="rounded-md p-1 text-gray-400 transition-colors hover:bg-white/[0.06] hover:text-gray-200"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <label
              htmlFor="calendar-edit-date"
              className="block font-mono text-[10px] uppercase tracking-[0.18em] text-cyan-400/80"
            >
              Date de rappel
            </label>
            <input
              id="calendar-edit-date"
              type="date"
              required
              value={callbackDate}
              onChange={(e) => setCallbackDate(e.target.value)}
              className="w-full rounded-lg border border-white/[0.08] bg-white/[0.04] backdrop-blur-md px-3 py-2.5 text-sm text-white placeholder:text-gray-400 transition focus:border-green-500 focus:outline-none focus:ring-2 focus:ring-green-500/20 [color-scheme:dark]"
            />
          </div>

          <div className="space-y-1.5">
            <label
              htmlFor="calendar-edit-type"
              className="block font-mono text-[10px] uppercase tracking-[0.18em] text-cyan-400/80"
            >
              Type d’échange
            </label>
            <select
              id="calendar-edit-type"
              value={type}
              onChange={(e) => setType(e.target.value)}
              className="w-full rounded-lg border border-white/[0.08] bg-white/[0.04] backdrop-blur-md px-3 py-2.5 text-sm text-white transition focus:border-green-500 focus:outline-none focus:ring-2 focus:ring-green-500/20 [color-scheme:dark]"
            >
              <option value="appel" className="bg-[oklch(14%_0.02_240)] text-white">
                Appel
              </option>
              <option value="email" className="bg-[oklch(14%_0.02_240)] text-white">
                Email
              </option>
              <option value="linkedin" className="bg-[oklch(14%_0.02_240)] text-white">
                LinkedIn
              </option>
              <option value="rdv" className="bg-[oklch(14%_0.02_240)] text-white">
                Rendez-vous
              </option>
              <option value="autre" className="bg-[oklch(14%_0.02_240)] text-white">
                Autre
              </option>
            </select>
          </div>

          <div className="space-y-1.5">
            <label
              htmlFor="calendar-edit-notes"
              className="block font-mono text-[10px] uppercase tracking-[0.18em] text-cyan-400/80"
            >
              Notes
            </label>
            <textarea
              id="calendar-edit-notes"
              rows={4}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Précisions sur le rappel..."
              className="w-full rounded-lg border border-white/[0.08] bg-white/[0.04] backdrop-blur-md px-3 py-2.5 text-sm leading-relaxed text-white placeholder:text-gray-400 transition focus:border-green-500 focus:outline-none focus:ring-2 focus:ring-green-500/20"
            />
          </div>

          {error && (
            <p
              role="alert"
              className="rounded-lg bg-red-500/15 px-3 py-2.5 text-sm text-red-200 ring-1 ring-red-500/25"
            >
              {error}
            </p>
          )}

          <div className="flex items-center justify-end gap-3 border-t border-white/[0.06] pt-4">
            <button
              type="button"
              onClick={onClose}
              disabled={pending}
              className="rounded-lg border border-white/[0.08] bg-white/[0.04] backdrop-blur-md px-4 py-2.5 text-sm font-medium text-gray-200 transition-colors hover:bg-white/[0.06] focus:outline-none focus:ring-2 focus:ring-white/20 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Annuler
            </button>
            <button
              type="submit"
              disabled={pending}
              className="inline-flex items-center gap-1.5 rounded-lg bg-green-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-green-700 focus:outline-none focus:ring-2 focus:ring-green-500/40 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {pending ? 'Enregistrement…' : 'Enregistrer'}
            </button>
          </div>
        </form>
      </div>
    </div>,
    document.body,
  )
}
