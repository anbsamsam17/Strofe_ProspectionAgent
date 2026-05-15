// ============================================================
// ScoreRing — anneau SVG du score 0-100
//
// Anneau circulaire avec gradient de couleur selon le score :
//   - ≥75 : vert brand (haute confiance)
//   - 50-74 : ambre (moyen)
//   - <50 : gris (faible)
//
// Server Component — animation au montage gérée par CSS (stroke-dashoffset
// transition + delay configurable). Pas de useState.
// ============================================================

interface ScoreRingProps {
  score: number
  /** Diamètre en pixels. Défaut 80. */
  size?: number
  /** Épaisseur du trait. Défaut 8. */
  thickness?: number
  className?: string
}

function tone(score: number): string {
  if (score >= 75) return 'oklch(69% 0.19 152)'
  if (score >= 50) return 'oklch(78% 0.15 75)'
  return 'oklch(65% 0 0)'
}

export function ScoreRing({
  score,
  size = 80,
  thickness = 8,
  className = '',
}: ScoreRingProps) {
  const clampedScore = Math.max(0, Math.min(100, score))
  const radius = (size - thickness) / 2
  const circumference = 2 * Math.PI * radius
  const offset = circumference * (1 - clampedScore / 100)
  const color = tone(clampedScore)

  return (
    <div
      className={`relative inline-flex items-center justify-center ${className}`}
      style={{ width: size, height: size }}
      role="img"
      aria-label={`Score ${clampedScore} sur 100`}
    >
      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        className="-rotate-90"
        aria-hidden="true"
      >
        {/* Anneau de fond */}
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="oklch(92% 0 0)"
          strokeWidth={thickness}
          className="dark:[stroke:oklch(25%_0.01_240)]"
        />
        {/* Anneau de progression */}
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={color}
          strokeWidth={thickness}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          style={{
            transition: 'stroke-dashoffset 800ms cubic-bezier(0, 0, 0.2, 1)',
          }}
        />
      </svg>
      <span
        className="absolute font-mono text-lg font-bold tabular-nums text-white"
        style={{ fontSize: size * 0.28 }}
      >
        {clampedScore}
      </span>
    </div>
  )
}
