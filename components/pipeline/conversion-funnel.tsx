'use client'

// ============================================================
// ConversionFunnel — entonnoir glass dark full-width
//
// Refonte 2026-05-17 :
//   - Full-width (plus de max-w-md). Le SVG occupe toute la largeur dispo.
//   - Style tech glass dark cohérent avec KpiCards / AgentStats.
//   - Trapèzes SVG avec gradient par étage (var --funnel-N) + glow.
//   - Animation d'entrée stagger via motion/react (m.polygon, mode strict).
//   - Coins arrondis via `<path>` (quart-de-cercle aux 4 angles).
//   - Labels intégrés dans le trapèze si largeur > MIN_LABEL_INSIDE_WIDTH,
//     sinon callout à droite avec ligne de raccord SVG.
//   - Tooltip pur Tailwind (group-hover, pas de lib).
//   - Légende mobile en grid sous le SVG (< sm).
//   - prefers-reduced-motion respecté (animations annulées).
//
// Le contrat `FunnelStage` (lib/pipeline/analytics.ts) est figé : on consomme
// step / label / count / stepConversionPct / cumulativePct sans le toucher.
// ============================================================

import { m, useReducedMotion } from 'motion/react'
import type { ProspectStatus } from '@/lib/types'
import { buildFunnel, type FunnelStage } from '@/lib/pipeline/analytics'

// ── Constantes de dessin ─────────────────────────────────────────────────────
// ViewBox élargi pour donner plus de place aux callouts à droite.
const VIEWBOX_WIDTH = 800
const STAGE_HEIGHT = 72
const STAGE_GAP = 6
const CORNER_RADIUS = 8
const MIN_TRAPEZOID_WIDTH = 40
// Largeur réservée au funnel lui-même (le reste = espace callouts droite/gauche).
const FUNNEL_AREA_WIDTH = 520
const FUNNEL_AREA_X_OFFSET = (VIEWBOX_WIDTH - FUNNEL_AREA_WIDTH) / 2
// Seuil largeur trapèze (en unités viewBox) pour afficher le label à l'intérieur.
const MIN_LABEL_INSIDE_WIDTH = 180
const CALLOUT_GAP_X = 16

interface ConversionFunnelProps {
  countsByStatus: Record<ProspectStatus, number>
}

/**
 * Entonnoir de conversion full-width en SVG trapézoïdal stylé glass dark.
 */
export function ConversionFunnel({ countsByStatus }: ConversionFunnelProps) {
  const stages = buildFunnel(countsByStatus)
  const total = stages[0]?.count ?? 0
  const converted = stages[stages.length - 1]?.count ?? 0
  const noConversion = total > 0 && converted === 0

  return (
    <section
      aria-label="Entonnoir de conversion du pipeline"
      className="relative flex h-full w-full min-h-[360px] flex-col overflow-hidden rounded-2xl border border-white/[0.08] bg-white/[0.03] p-6 backdrop-blur-md"
    >
      {/* Accent border-top gradient brand */}
      <span
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-4 top-0 h-px bg-gradient-to-r from-transparent via-green-400/60 to-transparent"
      />

      <header className="mb-5 flex flex-shrink-0 flex-wrap items-baseline justify-between gap-3">
        <h2 className="font-mono text-[10px] uppercase tracking-[0.18em] text-cyan-400/85">
          {'// Entonnoir de conversion'}
        </h2>
        <p className="font-mono text-[10px] text-gray-400">
          du sourcing à la conversion
        </p>
      </header>

      {total === 0 ? (
        <EmptyFunnel />
      ) : (
        <div className="flex min-h-0 flex-1 flex-col">
          <FunnelSvg stages={stages} />
          <MobileLegend stages={stages} />
          {noConversion && <NoConversionBadge />}
        </div>
      )}
    </section>
  )
}

/**
 * Construit les largeurs (top, bottom) pour chaque étage, normalisées sur la
 * largeur de la zone funnel (FUNNEL_AREA_WIDTH). Exporté pour les tests.
 */
export function computeFunnelGeometry(
  stages: FunnelStage[],
  areaWidth: number = FUNNEL_AREA_WIDTH,
  minWidth: number = MIN_TRAPEZOID_WIDTH,
): { top: number; bottom: number }[] {
  if (stages.length === 0) return []
  const max = Math.max(...stages.map((s) => s.count), 1)
  const widths = stages.map((s) => {
    const ratio = max > 0 ? s.count / max : 0
    return Math.max(minWidth, ratio * areaWidth)
  })
  return stages.map((_, idx) => ({
    top: widths[idx],
    bottom: widths[idx + 1] ?? widths[idx],
  }))
}

/**
 * Génère un path SVG pour un trapèze à coins arrondis.
 * Les 4 angles ont un quart-de-cercle de rayon `r`.
 *
 * `x1,x2` = bord haut (gauche, droite), à y = `yTop`.
 * `x4,x3` = bord bas (gauche, droite), à y = `yBottom`.
 * Important : on clamp `r` si le trapèze est plus étroit que `2r`.
 */
export function trapezoidPath(
  x1: number,
  x2: number,
  x3: number,
  x4: number,
  yTop: number,
  yBottom: number,
  r: number = CORNER_RADIUS,
): string {
  const topWidth = x2 - x1
  const bottomWidth = x3 - x4
  const radius = Math.max(0, Math.min(r, topWidth / 2, bottomWidth / 2, (yBottom - yTop) / 2))

  if (radius === 0) {
    return `M ${x1} ${yTop} L ${x2} ${yTop} L ${x3} ${yBottom} L ${x4} ${yBottom} Z`
  }

  // Ordre : top-left -> top-right -> bottom-right -> bottom-left -> close
  return [
    `M ${x1 + radius} ${yTop}`,
    `L ${x2 - radius} ${yTop}`,
    `A ${radius} ${radius} 0 0 1 ${x2} ${yTop + radius}`,
    `L ${x3} ${yBottom - radius}`,
    `A ${radius} ${radius} 0 0 1 ${x3 - radius} ${yBottom}`,
    `L ${x4 + radius} ${yBottom}`,
    `A ${radius} ${radius} 0 0 1 ${x4} ${yBottom - radius}`,
    `L ${x1} ${yTop + radius}`,
    `A ${radius} ${radius} 0 0 1 ${x1 + radius} ${yTop}`,
    'Z',
  ].join(' ')
}

// ── Sous-composants ──────────────────────────────────────────────────────────

function FunnelSvg({ stages }: { stages: FunnelStage[] }) {
  const prefersReducedMotion = useReducedMotion() ?? false
  const geometry = computeFunnelGeometry(stages)
  const totalHeight = stages.length * STAGE_HEIGHT + (stages.length - 1) * STAGE_GAP
  const funnelCenter = FUNNEL_AREA_X_OFFSET + FUNNEL_AREA_WIDTH / 2
  const calloutX = FUNNEL_AREA_X_OFFSET + FUNNEL_AREA_WIDTH + CALLOUT_GAP_X

  return (
    <div className="relative min-h-0 flex-1 w-full">
      <svg
        viewBox={`0 0 ${VIEWBOX_WIDTH} ${totalHeight}`}
        role="img"
        aria-label="Graphique entonnoir : largeur de chaque étage proportionnelle au nombre de prospects"
        className="block h-full w-full"
        preserveAspectRatio="xMidYMid meet"
      >
        <defs>
          {stages.map((_, idx) => {
            const base = `var(--funnel-${idx + 1})`
            return (
              <linearGradient
                key={idx}
                id={`funnel-grad-${idx}`}
                x1="0%"
                y1="0%"
                x2="100%"
                y2="0%"
              >
                <stop offset="0%" stopColor={base} stopOpacity="0.85" />
                <stop offset="50%" stopColor={base} stopOpacity="1" />
                <stop offset="100%" stopColor={base} stopOpacity="0.85" />
              </linearGradient>
            )
          })}
          {/* Filter "glow" partagé — drop-shadow piloté via currentColor de chaque <g>. */}
          <filter id="funnel-glow" x="-20%" y="-20%" width="140%" height="140%">
            <feGaussianBlur stdDeviation="6" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        {stages.map((stage, idx) => {
          const y = idx * (STAGE_HEIGHT + STAGE_GAP)
          const { top, bottom } = geometry[idx]
          const x1 = funnelCenter - top / 2
          const x2 = funnelCenter + top / 2
          const x3 = funnelCenter + bottom / 2
          const x4 = funnelCenter - bottom / 2
          const colorVar = `var(--funnel-${idx + 1})`
          const path = trapezoidPath(x1, x2, x3, x4, y, y + STAGE_HEIGHT)
          const labelInside = top >= MIN_LABEL_INSIDE_WIDTH
          const midY = y + STAGE_HEIGHT / 2
          const labelEdgeX = funnelCenter + top / 2

          // Animation: scale horizontal autour du centre, stagger 0.1s.
          const initial = prefersReducedMotion
            ? { opacity: 1, scaleX: 1 }
            : { opacity: 0, scaleX: 0 }
          const animate = prefersReducedMotion
            ? { opacity: 1, scaleX: 1 }
            : { opacity: 1, scaleX: 1 }
          const transition = {
            delay: prefersReducedMotion ? 0 : idx * 0.1,
            duration: prefersReducedMotion ? 0 : 0.55,
            ease: [0.22, 1, 0.36, 1] as [number, number, number, number],
          }

          return (
            <g key={stage.step} className="group">
              <m.path
                d={path}
                fill={`url(#funnel-grad-${idx})`}
                initial={initial}
                animate={animate}
                transition={transition}
                style={{
                  filter: `drop-shadow(0 0 14px ${colorVar})`,
                  transformBox: 'fill-box',
                  transformOrigin: '50% 50%',
                }}
                data-step={stage.step}
                aria-label={`${stage.label} : ${stage.count} prospects`}
              />

              {/* Label interne (count) si trapèze suffisamment large */}
              {labelInside && (
                <m.g
                  initial={prefersReducedMotion ? { opacity: 1 } : { opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{
                    delay: prefersReducedMotion ? 0 : idx * 0.1 + 0.25,
                    duration: 0.3,
                  }}
                >
                  <text
                    x={funnelCenter}
                    y={midY - 4}
                    textAnchor="middle"
                    dominantBaseline="central"
                    className="fill-white font-sans text-[14px] font-semibold"
                    style={{
                      paintOrder: 'stroke',
                      stroke: 'rgba(0,0,0,0.55)',
                      strokeWidth: 2,
                    }}
                  >
                    {stage.label}
                  </text>
                  <text
                    x={funnelCenter}
                    y={midY + 14}
                    textAnchor="middle"
                    dominantBaseline="central"
                    className="fill-white font-mono text-[12px] tabular-nums"
                    style={{
                      paintOrder: 'stroke',
                      stroke: 'rgba(0,0,0,0.55)',
                      strokeWidth: 2,
                    }}
                  >
                    {stage.count}
                  </text>
                </m.g>
              )}

              {/* Callout droite (ligne + label) si label trop large pour l'intérieur */}
              {!labelInside && (
                <m.g
                  initial={prefersReducedMotion ? { opacity: 1 } : { opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{
                    delay: prefersReducedMotion ? 0 : idx * 0.1 + 0.2,
                    duration: 0.3,
                  }}
                >
                  <line
                    x1={labelEdgeX}
                    y1={midY}
                    x2={calloutX - 6}
                    y2={midY}
                    stroke={colorVar}
                    strokeWidth={1}
                    strokeDasharray="2 3"
                    opacity={0.6}
                  />
                  <circle cx={calloutX - 6} cy={midY} r={2.5} fill={colorVar} />
                  <text
                    x={calloutX}
                    y={midY - 2}
                    dominantBaseline="central"
                    className="fill-white font-sans text-[13px] font-semibold"
                  >
                    {stage.label}
                  </text>
                  <text
                    x={calloutX}
                    y={midY + 14}
                    dominantBaseline="central"
                    className="font-mono text-[11px] tabular-nums"
                    fill={colorVar}
                  >
                    {stage.count} · {formatPct(stage.cumulativePct)}
                  </text>
                </m.g>
              )}

              {/* Hit-area + tooltip HTML overlayé via <foreignObject> (hover SVG natif). */}
              <foreignObject
                x={x4 - 12}
                y={y - 4}
                width={Math.max(top, bottom) + 24}
                height={STAGE_HEIGHT + 8}
                style={{ pointerEvents: 'none', overflow: 'visible' }}
              >
                <div
                  // L'élément doit accepter le hover ; le parent <g.group> propage via group-hover.
                  style={{ width: '100%', height: '100%', pointerEvents: 'none', position: 'relative' }}
                >
                  <span
                    role="tooltip"
                    className="pointer-events-none absolute left-1/2 top-full z-10 -translate-x-1/2 translate-y-1 whitespace-nowrap rounded-md border border-white/10 bg-slate-900/95 px-2.5 py-1.5 font-mono text-[10px] text-gray-100 opacity-0 shadow-lg backdrop-blur-md transition-opacity duration-150 group-hover:opacity-100"
                  >
                    <span className="block font-semibold text-white">
                      {stage.label} · {stage.count}
                    </span>
                    <span className="text-cyan-300">
                      {formatPct(stage.stepConversionPct)} vs préc.
                    </span>
                    <span className="ml-2 text-green-300">
                      {formatPct(stage.cumulativePct)} cumul.
                    </span>
                  </span>
                </div>
              </foreignObject>
            </g>
          )
        })}
      </svg>
    </div>
  )
}

function MobileLegend({ stages }: { stages: FunnelStage[] }) {
  return (
    <ol
      className="mt-4 grid grid-cols-2 gap-2 sm:hidden"
      aria-label="Légende détaillée de l'entonnoir"
    >
      {stages.map((stage, idx) => (
        <li
          key={stage.step}
          className="flex items-center gap-2 rounded-lg border border-white/[0.06] bg-white/[0.02] px-2.5 py-2"
        >
          <span
            className="h-2.5 w-2.5 flex-shrink-0 rounded-sm"
            style={{
              backgroundColor: `var(--funnel-${idx + 1})`,
              boxShadow: `0 0 8px var(--funnel-${idx + 1})`,
            }}
            aria-hidden="true"
          />
          <div className="min-w-0 flex-1">
            <p className="truncate text-xs font-medium text-white">{stage.label}</p>
            <p className="font-mono text-[10px] tabular-nums text-gray-400">
              {stage.count} · {formatPct(stage.cumulativePct)}
            </p>
          </div>
        </li>
      ))}
    </ol>
  )
}

function EmptyFunnel() {
  return (
    <div
      role="status"
      className="flex min-h-[200px] flex-1 flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-white/10 bg-white/[0.02] px-6 py-12 text-center"
    >
      <span
        aria-hidden="true"
        className="flex h-10 w-10 items-center justify-center rounded-full bg-cyan-500/10 text-cyan-300"
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M3 6h18l-7 9v6l-4-2v-4z" />
        </svg>
      </span>
      <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-cyan-300/80">
        Aucun prospect actif
      </p>
      <p className="max-w-xs text-xs text-gray-400">
        Lance un cycle de glanage pour voir l&apos;entonnoir prendre forme.
      </p>
    </div>
  )
}

function NoConversionBadge() {
  return (
    <p
      className="mt-4 inline-flex items-center gap-2 rounded-full border border-amber-500/30 bg-amber-500/10 px-3 py-1 font-mono text-[10px] uppercase tracking-[0.18em] text-amber-300"
      // Pulse subtil — animation existante `tech-glow-pulse` mais sur la border.
      // /* @keyframes pulse-amber — réutilise `animate-pulse` Tailwind, suffisant ici. */
    >
      <span
        aria-hidden="true"
        className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-amber-400"
      />
      0 conversion · le glanage reste à concrétiser
    </p>
  )
}

// ── Utils ───────────────────────────────────────────────────────────────────

function formatPct(value: number): string {
  if (!Number.isFinite(value)) return '—'
  if (value >= 10) return `${Math.round(value)} %`
  return `${(Math.round(value * 10) / 10).toString().replace('.', ',')} %`
}
