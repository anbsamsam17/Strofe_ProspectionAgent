// ============================================================
// BentoGrid + BentoCell — grille modulaire tech-style
//
// Layout CSS grid responsive. BentoCell utilise glassmorphism dark +
// border accent + glow réactif au hover.
//
// Refonte 2026-05-14 : passage à l'esthétique "cockpit IA" (translucide
// + accent vert/cyan + hover lift + inner border subtil).
// ============================================================

import type { HTMLAttributes, ReactNode } from 'react'

interface BentoGridProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode
}

export function BentoGrid({ className = '', children, ...rest }: BentoGridProps) {
  return (
    <div
      className={`grid auto-rows-[minmax(8rem,auto)] grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4 ${className}`}
      {...rest}
    >
      {children}
    </div>
  )
}

interface BentoCellProps extends HTMLAttributes<HTMLDivElement> {
  colSpan?: 1 | 2 | 3 | 4
  rowSpan?: 1 | 2 | 3
  /** Couleur d'accent du border-top et glow au hover. Défaut "brand". */
  accent?: 'brand' | 'cyan' | 'violet' | 'amber' | 'none'
  children: ReactNode
}

const COL_SPAN: Record<NonNullable<BentoCellProps['colSpan']>, string> = {
  1: 'lg:col-span-1',
  2: 'lg:col-span-2 sm:col-span-2',
  3: 'lg:col-span-3 sm:col-span-2',
  4: 'lg:col-span-4 sm:col-span-2',
}

const ROW_SPAN: Record<NonNullable<BentoCellProps['rowSpan']>, string> = {
  1: 'row-span-1',
  2: 'row-span-2',
  3: 'row-span-3',
}

const ACCENT_TOP: Record<NonNullable<BentoCellProps['accent']>, string> = {
  brand:
    'before:bg-gradient-to-r before:from-transparent before:via-green-400/60 before:to-transparent',
  cyan:
    'before:bg-gradient-to-r before:from-transparent before:via-cyan-400/60 before:to-transparent',
  violet:
    'before:bg-gradient-to-r before:from-transparent before:via-violet-400/60 before:to-transparent',
  amber:
    'before:bg-gradient-to-r before:from-transparent before:via-amber-400/60 before:to-transparent',
  none: 'before:hidden',
}

const ACCENT_GLOW: Record<NonNullable<BentoCellProps['accent']>, string> = {
  brand: 'hover:shadow-[0_0_0_1px_oklch(70%_0.18_152_/_0.35),0_8px_32px_-8px_oklch(70%_0.18_152_/_0.25)]',
  cyan: 'hover:shadow-[0_0_0_1px_oklch(70%_0.16_188_/_0.35),0_8px_32px_-8px_oklch(70%_0.16_188_/_0.25)]',
  violet: 'hover:shadow-[0_0_0_1px_oklch(70%_0.18_285_/_0.35),0_8px_32px_-8px_oklch(70%_0.18_285_/_0.25)]',
  amber: 'hover:shadow-[0_0_0_1px_oklch(78%_0.15_75_/_0.35),0_8px_32px_-8px_oklch(78%_0.15_75_/_0.25)]',
  none: '',
}

export function BentoCell({
  colSpan = 1,
  rowSpan = 1,
  accent = 'brand',
  className = '',
  children,
  ...rest
}: BentoCellProps) {
  return (
    <div
      className={`relative ${COL_SPAN[colSpan]} ${ROW_SPAN[rowSpan]} rounded-2xl border border-white/[0.08] bg-white/[0.03] p-5 backdrop-blur-md transition-all duration-300 hover:-translate-y-0.5 hover:border-white/15 ${ACCENT_GLOW[accent]} before:absolute before:inset-x-4 before:top-0 before:h-px ${ACCENT_TOP[accent]} dark:bg-white/[0.025] ${className}`}
      {...rest}
    >
      {children}
    </div>
  )
}
