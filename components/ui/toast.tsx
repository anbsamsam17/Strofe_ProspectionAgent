'use client'

// ============================================================
// Toast — système global de notifications éphémères
//
// API :
//   const { toast } = useToast()
//   toast({ title: 'Sauvegardé', tone: 'success' })
//
// Wrapper à monter en haut de l'app (dashboard layout) :
//   <ToastProvider>{children}</ToastProvider>
//
// 4 tones : success / error / warning / info
// Auto-dismiss 4s — pause si onglet caché.
// ============================================================

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'

type Tone = 'success' | 'error' | 'warning' | 'info'

interface ToastInput {
  title: string
  description?: string
  tone?: Tone
  /** Durée en ms avant auto-dismiss. Défaut 4000. */
  duration?: number
}

interface ToastEntry extends ToastInput {
  id: string
}

interface ToastContextValue {
  toast: (input: ToastInput) => void
  dismiss: (id: string) => void
}

const ToastContext = createContext<ToastContextValue | null>(null)

const TONE_CLASSES: Record<Tone, { bg: string; border: string; text: string; dot: string }> = {
  success: {
    bg: 'bg-green-50 dark:bg-green-950/60',
    border: 'border-green-200 dark:border-green-900',
    text: 'text-green-900 dark:text-green-100',
    dot: 'bg-green-500',
  },
  error: {
    bg: 'bg-red-50 dark:bg-red-950/60',
    border: 'border-red-200 dark:border-red-900',
    text: 'text-red-900 dark:text-red-100',
    dot: 'bg-red-500',
  },
  warning: {
    bg: 'bg-amber-50 dark:bg-amber-950/60',
    border: 'border-amber-200 dark:border-amber-900',
    text: 'text-amber-900 dark:text-amber-100',
    dot: 'bg-amber-500',
  },
  info: {
    bg: 'bg-blue-50 dark:bg-blue-950/60',
    border: 'border-blue-200 dark:border-blue-900',
    text: 'text-blue-900 dark:text-blue-100',
    dot: 'bg-blue-500',
  },
}

const DEFAULT_DURATION = 4000

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastEntry[]>([])

  const dismiss = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id))
  }, [])

  const toast = useCallback(
    (input: ToastInput) => {
      const id = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
      const entry: ToastEntry = { ...input, id, tone: input.tone ?? 'info' }
      setToasts((prev) => [...prev, entry])

      const duration = input.duration ?? DEFAULT_DURATION
      setTimeout(() => dismiss(id), duration)
    },
    [dismiss],
  )

  const value = useMemo<ToastContextValue>(() => ({ toast, dismiss }), [toast, dismiss])

  return (
    <ToastContext.Provider value={value}>
      {children}
      <ToastViewport toasts={toasts} onDismiss={dismiss} />
    </ToastContext.Provider>
  )
}

function ToastViewport({
  toasts,
  onDismiss,
}: {
  toasts: ToastEntry[]
  onDismiss: (id: string) => void
}) {
  return (
    <div
      aria-live="polite"
      aria-atomic="true"
      className="pointer-events-none fixed bottom-4 right-4 z-50 flex w-full max-w-sm flex-col gap-2"
    >
      {toasts.map((t) => {
        const tone = t.tone ?? 'info'
        const classes = TONE_CLASSES[tone]
        return (
          <div
            key={t.id}
            role="status"
            className={`pointer-events-auto flex animate-fade-in-up items-start gap-3 rounded-xl border ${classes.bg} ${classes.border} px-4 py-3 shadow-lg`}
          >
            <span
              aria-hidden="true"
              className={`mt-1 inline-block h-2 w-2 flex-shrink-0 rounded-full ${classes.dot}`}
            />
            <div className={`flex-1 ${classes.text}`}>
              <p className="text-sm font-semibold leading-tight">{t.title}</p>
              {t.description && (
                <p className="mt-0.5 text-xs opacity-80">{t.description}</p>
              )}
            </div>
            <button
              type="button"
              onClick={() => onDismiss(t.id)}
              aria-label="Fermer la notification"
              className={`flex-shrink-0 rounded-md p-1 transition-colors hover:bg-black/5 dark:hover:bg-white/[0.06]/10 ${classes.text}`}
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
              >
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>
        )
      })}
    </div>
  )
}

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext)
  if (!ctx) {
    throw new Error('useToast doit être utilisé à l\'intérieur d\'un <ToastProvider>')
  }
  return ctx
}
