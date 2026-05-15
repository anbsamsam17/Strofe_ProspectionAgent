'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'

interface NavItem {
  href: string
  label: string
  icon: React.ReactNode
}

// Navigation principale : Prospects, Pipeline, Glan, Paramètres.
const navItems: NavItem[] = [
  {
    href: '/prospects',
    label: 'Prospects',
    icon: (
      <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
        <circle cx="9" cy="7" r="4" />
        <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
        <path d="M16 3.13a4 4 0 0 1 0 7.75" />
      </svg>
    ),
  },
  {
    href: '/pipeline',
    label: 'Pipeline',
    icon: (
      <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
      </svg>
    ),
  },
  {
    href: '/glan',
    label: 'Glan',
    icon: (
      <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <circle cx="12" cy="12" r="9" />
        <circle cx="12" cy="12" r="3" />
      </svg>
    ),
  },
  {
    href: '/settings',
    label: 'Paramètres',
    icon: (
      <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <circle cx="12" cy="12" r="3" />
        <path d="M19.07 4.93a10 10 0 0 1 0 14.14M4.93 4.93a10 10 0 0 0 0 14.14" />
        <path d="M12 1v3M12 20v3M4.22 4.22l2.12 2.12M17.66 17.66l2.12 2.12M1 12h3M20 12h3M4.22 19.78l2.12-2.12M17.66 6.34l2.12-2.12" />
      </svg>
    ),
  },
]

// Indices de référence — Prospects + Pipeline + Glan en primary, Paramètres rendu à part.
const PRIMARY_NAV_ITEMS = navItems.slice(0, 3)
const SETTINGS_NAV_ITEM = navItems[3]

export function Sidebar() {
  const pathname = usePathname()
  const router = useRouter()
  const supabase = createClient()

  async function handleLogout() {
    await supabase.auth.signOut()
    router.push('/login')
    router.refresh()
  }

  function isActive(href: string): boolean {
    return pathname === href || pathname.startsWith(`${href}/`)
  }

  return (
    <>
      {/* ── Sidebar desktop (lg+) — tech glass dark ── */}
      <aside
        className="fixed inset-y-0 left-0 z-30 hidden w-64 flex-col border-r border-white/[0.06] bg-white/[0.025] backdrop-blur-xl lg:flex"
        aria-label="Navigation principale"
      >
        {/* Accent vertical lumineux à droite (signature tech) */}
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-y-0 right-0 w-px bg-gradient-to-b from-transparent via-green-400/40 to-transparent"
        />

        {/* Logo Glan */}
        <div className="relative flex h-16 flex-shrink-0 items-center gap-3 border-b border-white/[0.06] px-5">
          <span className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-green-500 to-emerald-600 text-white shadow-[0_0_16px_-4px_oklch(70%_0.19_152_/_0.6)] ring-1 ring-white/15">
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M11 20A7 7 0 0 1 9.8 6.1C15.5 5 17 4.48 19 2c1 2 2 4.18 2 8 0 5.5-4.78 10-10 10z" />
              <path d="M2 21c0-3 1.85-5.36 5.08-6C9.5 14.52 12 13 13 12" />
            </svg>
          </span>
          <div className="flex min-w-0 flex-col leading-none">
            <span className="truncate bg-gradient-to-br from-white to-green-200 bg-clip-text text-base font-bold tracking-tight text-transparent">
              Glan
            </span>
            <span className="mt-1 truncate font-mono text-[10px] uppercase tracking-[0.16em] text-green-400/80">
              Prospection BEGES
            </span>
          </div>
        </div>

        {/* Navigation principale */}
        <nav className="flex-1 space-y-1 overflow-y-auto px-3 py-4">
          <p className="mb-2 px-3 font-mono text-[9px] font-semibold uppercase tracking-[0.2em] text-cyan-400/60">
            {'// Navigation'}
          </p>
          {PRIMARY_NAV_ITEMS.map((item) => {
            const active = isActive(item.href)
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? 'page' : undefined}
                className={`group relative flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-all duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-green-400/60 focus-visible:ring-offset-1 focus-visible:ring-offset-black/40 ${
                  active
                    ? 'bg-gradient-to-r from-green-500/15 via-green-500/5 to-transparent text-green-300 shadow-[inset_0_0_0_1px_oklch(70%_0.18_152_/_0.25)]'
                    : 'text-gray-400 hover:bg-white/[0.06] hover:text-gray-100'
                }`}
              >
                {active && (
                  <span
                    className="pointer-events-none absolute left-0 top-1/2 h-6 w-0.5 -translate-y-1/2 rounded-r-full bg-green-400 shadow-[0_0_12px_oklch(70%_0.19_152_/_0.6)]"
                    aria-hidden="true"
                  />
                )}
                <span className={`flex-shrink-0 transition-colors ${active ? 'text-green-400' : 'text-gray-400 group-hover:text-white'}`}>
                  {item.icon}
                </span>
                <span className="truncate">{item.label}</span>
                {active && (
                  <span aria-hidden="true" className="ml-auto h-1.5 w-1.5 flex-shrink-0 rounded-full bg-green-400 shadow-[0_0_6px_oklch(70%_0.19_152_/_0.8)]" />
                )}
              </Link>
            )
          })}
        </nav>

        {/* Section bas : Paramètres + Déconnexion */}
        <div className="space-y-1 border-t border-white/[0.06] px-3 py-4">
          {(() => {
            const settingsActive = isActive(SETTINGS_NAV_ITEM.href)
            return (
              <Link
                href={SETTINGS_NAV_ITEM.href}
                aria-current={settingsActive ? 'page' : undefined}
                className={`group relative flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-all duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-green-400/60 focus-visible:ring-offset-1 focus-visible:ring-offset-black/40 ${
                  settingsActive
                    ? 'bg-gradient-to-r from-green-500/15 via-green-500/5 to-transparent text-green-300'
                    : 'text-gray-400 hover:bg-white/[0.06] hover:text-gray-100'
                }`}
              >
                {settingsActive && (
                  <span
                    className="pointer-events-none absolute left-0 top-1/2 h-5 w-0.5 -translate-y-1/2 rounded-r-full bg-green-400 shadow-[0_0_12px_oklch(70%_0.19_152_/_0.6)]"
                    aria-hidden="true"
                  />
                )}
                <span className={`flex-shrink-0 transition-colors ${settingsActive ? 'text-green-400' : 'text-gray-400 group-hover:text-white'}`}>
                  {SETTINGS_NAV_ITEM.icon}
                </span>
                <span className="truncate">{SETTINGS_NAV_ITEM.label}</span>
              </Link>
            )
          })()}

          <button
            onClick={handleLogout}
            aria-label="Se déconnecter"
            className="group flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-gray-400 transition-all duration-200 hover:bg-red-500/10 hover:text-red-300 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-400/60 focus-visible:ring-offset-1 focus-visible:ring-offset-black/40"
          >
            <span className="text-gray-400 transition-colors group-hover:text-red-400">
              <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                <polyline points="16 17 21 12 16 7" />
                <line x1="21" y1="12" x2="9" y2="12" />
              </svg>
            </span>
            Déconnexion
          </button>
        </div>
      </aside>

      {/* ── Navigation mobile en bas — 4 entrées (Prospects, Pipeline, Glan, Paramètres) ── */}
      <nav
        className="fixed bottom-0 left-0 right-0 z-40 flex items-stretch border-t border-white/[0.08] bg-black/60 backdrop-blur-xl lg:hidden"
        style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}
        aria-label="Navigation mobile"
      >
        {navItems.map((item) => {
          const active = isActive(item.href)
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? 'page' : undefined}
              aria-label={item.label}
              className={`relative flex min-w-0 flex-1 flex-col items-center justify-center gap-1 py-2.5 text-[10px] font-medium transition-colors focus:outline-none focus-visible:bg-white/[0.04] ${
                active
                  ? 'text-green-400'
                  : 'text-gray-400 hover:text-white'
              }`}
            >
              {active && (
                <span
                  className="pointer-events-none absolute top-0 left-1/2 h-0.5 w-8 -translate-x-1/2 rounded-b-full bg-green-500 shadow-[0_0_8px_oklch(70%_0.19_152_/_0.6)]"
                  aria-hidden="true"
                />
              )}
              <span className="flex-shrink-0">{item.icon}</span>
              <span className="truncate">{item.label}</span>
            </Link>
          )
        })}
      </nav>
    </>
  )
}
