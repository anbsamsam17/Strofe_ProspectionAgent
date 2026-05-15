'use client'

// ============================================================
// GlanLogStream — flux de logs Alpha en mono avec effet typewriter
//
// Affiche les logs `AgentLog[]` de l'agent_run courant. À utiliser dans :
//   - SourcingModal (état `running`) pour montrer ce qu'Alpha fait
//   - Page /alpha pour le replay des runs passés
//
// Comportement :
//   - Nouveaux logs animés en `fade-in-up` (cf. globals.css)
//   - Niveaux : info=vert / warn=ambre / error=rouge
//   - Auto-scroll vers le bas si l'utilisateur est déjà en bas
//   - Pause l'auto-scroll si l'utilisateur a remonté manuellement
// ============================================================

import { useEffect, useRef } from 'react'
import type { AgentLog } from '@/lib/types'

interface GlanLogStreamProps {
  logs: AgentLog[]
  /**
   * Hauteur max du conteneur (CSS, ex. "240px", "16rem"). Défaut : 14rem.
   */
  maxHeight?: string
  className?: string
}

const LEVEL_COLOR: Record<AgentLog['level'], string> = {
  info: 'text-green-400',
  warn: 'text-amber-400',
  error: 'text-red-400',
}

const LEVEL_SYMBOL: Record<AgentLog['level'], string> = {
  info: '·',
  warn: '!',
  error: '×',
}

function formatTime(ts: string): string {
  const d = new Date(ts)
  if (Number.isNaN(d.getTime())) return '--:--:--'
  return new Intl.DateTimeFormat('fr-FR', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).format(d)
}

export function GlanLogStream({
  logs,
  maxHeight = '14rem',
  className = '',
}: GlanLogStreamProps) {
  const scrollRef = useRef<HTMLOListElement | null>(null)
  // Mémorise la décision de l'utilisateur : a-t-il remonté manuellement ?
  // Si oui, on cesse l'auto-scroll pour ne pas lui voler le focus.
  const stickToBottomRef = useRef(true)

  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    if (!stickToBottomRef.current) return
    el.scrollTop = el.scrollHeight
  }, [logs])

  function handleScroll() {
    const el = scrollRef.current
    if (!el) return
    const isAtBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 24
    stickToBottomRef.current = isAtBottom
  }

  if (logs.length === 0) {
    return (
      <div
        className={`rounded-xl border border-white/[0.08] bg-white/[0.02] px-4 py-6 text-center text-sm text-gray-400 ${className}`}
        role="status"
      >
        <p className="font-mono text-xs">En attente du premier log…</p>
      </div>
    )
  }

  return (
    <ol
      ref={scrollRef}
      onScroll={handleScroll}
      style={{ maxHeight }}
      className={`overflow-y-auto rounded-xl border border-white/[0.08] bg-white/[0.02] px-3 py-2 font-mono text-xs leading-relaxed ${className}`}
      role="log"
      aria-live="polite"
      aria-relevant="additions"
      aria-label="Logs de Glan"
    >
      {logs.map((log, idx) => (
        <li
          key={`${log.timestamp}-${idx}`}
          className="flex gap-2 py-0.5 animate-fade-in-up"
        >
          <span className="flex-shrink-0 select-none text-gray-500 tabular-nums">
            {formatTime(log.timestamp)}
          </span>
          <span
            className={`flex-shrink-0 select-none ${LEVEL_COLOR[log.level]}`}
            aria-hidden="true"
          >
            {LEVEL_SYMBOL[log.level]}
          </span>
          <span className="flex-shrink-0 select-none text-cyan-400/70">
            [{log.phase}]
          </span>
          <span className="break-words text-gray-200">
            {log.message}
          </span>
        </li>
      ))}
    </ol>
  )
}
