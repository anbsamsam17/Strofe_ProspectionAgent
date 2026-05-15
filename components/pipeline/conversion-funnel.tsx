import type { ProspectStatus } from '@/lib/types'
import { buildFunnel, type FunnelStage } from '@/lib/pipeline/analytics'

// ── Constantes de dessin ────────────────────────────────────────────────────
// Tout est en SVG inline ; pas de lib externe.

const VIEWBOX_WIDTH = 400
const STAGE_HEIGHT = 64
const STAGE_GAP = 4
const MIN_TRAPEZOID_WIDTH = 24

interface ConversionFunnelProps {
  countsByStatus: Record<ProspectStatus, number>
}

/**
 * Entonnoir de conversion en trapèzes empilés (SVG inline).
 *
 * Largeur top du trapèze[i] = largeur proportionnelle à count[i].
 * Largeur bottom = largeur proportionnelle à count[i+1] (ou identique pour le dernier).
 * Le rendu reste lisible même avec un funnel "0 conversion" : largeur min `MIN_TRAPEZOID_WIDTH`.
 */
export function ConversionFunnel({ countsByStatus }: ConversionFunnelProps) {
  const stages = buildFunnel(countsByStatus)

  return (
    <section
      aria-label="Entonnoir de conversion du pipeline"
      className="relative overflow-hidden rounded-2xl border border-white/[0.08] bg-white/[0.03] p-5 backdrop-blur-md"
    >
      {/* Accent border top */}
      <span
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-4 top-0 h-px bg-gradient-to-r from-transparent via-green-400/60 to-transparent"
      />
      <header className="mb-4 flex items-baseline justify-between gap-3">
        <h2 className="font-mono text-[10px] uppercase tracking-[0.18em] text-green-400/80">
          {'// Entonnoir de conversion'}
        </h2>
        <p className="font-mono text-[10px] text-gray-500">
          du sourcing à la conversion
        </p>
      </header>

      <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
        <FunnelSvg stages={stages} />
        <FunnelLegend stages={stages} />
      </div>
    </section>
  )
}

/**
 * Construit les largeurs (top, bottom) pour chaque étage, en fonction du count
 * relatif au max. Exporté pour faciliter les tests unitaires.
 */
export function computeFunnelGeometry(
  stages: FunnelStage[],
  viewBoxWidth: number = VIEWBOX_WIDTH,
  minWidth: number = MIN_TRAPEZOID_WIDTH,
): { top: number; bottom: number }[] {
  if (stages.length === 0) return []
  const max = Math.max(...stages.map((s) => s.count), 1)
  const widths = stages.map((s) => {
    const ratio = max > 0 ? s.count / max : 0
    return Math.max(minWidth, ratio * viewBoxWidth)
  })
  return stages.map((_, idx) => ({
    top: widths[idx],
    bottom: widths[idx + 1] ?? widths[idx],
  }))
}

function FunnelSvg({ stages }: { stages: FunnelStage[] }) {
  const geometry = computeFunnelGeometry(stages)
  const totalHeight = stages.length * STAGE_HEIGHT + (stages.length - 1) * STAGE_GAP
  const centerX = VIEWBOX_WIDTH / 2

  return (
    <svg
      viewBox={`0 0 ${VIEWBOX_WIDTH} ${totalHeight}`}
      role="img"
      aria-label="Graphique entonnoir : largeur de chaque étage proportionnelle au nombre de prospects"
      className="h-auto w-full max-w-md flex-1"
    >
      {stages.map((stage, idx) => {
        const y = idx * (STAGE_HEIGHT + STAGE_GAP)
        const { top, bottom } = geometry[idx]
        const x1 = centerX - top / 2
        const x2 = centerX + top / 2
        const x3 = centerX + bottom / 2
        const x4 = centerX - bottom / 2
        const fillVar = `var(--funnel-${idx + 1})`
        return (
          <g key={stage.step}>
            <polygon
              points={`${x1},${y} ${x2},${y} ${x3},${y + STAGE_HEIGHT} ${x4},${y + STAGE_HEIGHT}`}
              fill={fillVar}
              data-step={stage.step}
            />
            <text
              x={centerX}
              y={y + STAGE_HEIGHT / 2}
              textAnchor="middle"
              dominantBaseline="central"
              className="fill-white text-sm font-bold"
              style={{ paintOrder: 'stroke', stroke: 'rgba(0,0,0,0.15)', strokeWidth: 0.5 }}
            >
              {stage.count}
            </text>
          </g>
        )
      })}
    </svg>
  )
}

function FunnelLegend({ stages }: { stages: FunnelStage[] }) {
  return (
    <ol
      className="flex w-full flex-col gap-1 text-sm sm:w-56"
      aria-label="Légende détaillée de l'entonnoir"
    >
      {stages.map((stage, idx) => (
        <li
          key={stage.step}
          className="flex items-center gap-3 rounded-lg px-2 py-1.5 transition-colors hover:bg-white/[0.04]"
        >
          <span
            className="h-3 w-3 flex-shrink-0 rounded-sm shadow-[0_0_8px_var(--funnel-color)]"
            style={{ backgroundColor: `var(--funnel-${idx + 1})`, ['--funnel-color' as never]: `var(--funnel-${idx + 1})` }}
            aria-hidden="true"
          />
          <div className="min-w-0 flex-1">
            <p className="flex items-baseline justify-between gap-2">
              <span className="font-medium text-white">{stage.label}</span>
              <span className="tabular-nums text-gray-200">{stage.count}</span>
            </p>
            <p className="flex items-baseline justify-between gap-2 font-mono text-[10px] text-gray-500">
              {idx === 0 ? (
                <span>100 % du sourcing</span>
              ) : (
                <>
                  <span className="tabular-nums">
                    {formatPct(stage.stepConversionPct)} vs préc.
                  </span>
                  <span className="tabular-nums">
                    {formatPct(stage.cumulativePct)} cumul.
                  </span>
                </>
              )}
            </p>
          </div>
        </li>
      ))}
    </ol>
  )
}

function formatPct(value: number): string {
  if (!Number.isFinite(value)) return '—'
  if (value >= 10) return `${Math.round(value)} %`
  return `${(Math.round(value * 10) / 10).toString().replace('.', ',')} %`
}
