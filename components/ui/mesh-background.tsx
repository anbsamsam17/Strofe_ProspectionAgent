// ============================================================
// MeshBackground — fond décoratif avec radial-gradients flous superposés
//
// Server Component sans état. Plusieurs blobs de couleurs blur-3xl
// positionnés en absolute, opacité faible pour rester sobre.
//
// Idéal pour : hero landing, layout auth, fond de section
// "à propos de Glan".
//
// Variantes :
//   - brand : vert + emerald (palette ProspectionAgent)
//   - twilight : indigo + amber (transition jour/nuit)
//   - sunrise : amber + gold (état "done", liste prête)
// ============================================================

type Variant = 'brand' | 'twilight' | 'sunrise'

interface MeshBackgroundProps {
  variant?: Variant
  className?: string
}

const VARIANTS: Record<Variant, { blob1: string; blob2: string; blob3: string }> = {
  brand: {
    blob1: 'bg-green-400/30 dark:bg-green-500/20',
    blob2: 'bg-emerald-400/25 dark:bg-emerald-500/15',
    blob3: 'bg-teal-300/20 dark:bg-teal-500/10',
  },
  twilight: {
    blob1: 'bg-indigo-400/25 dark:bg-indigo-500/15',
    blob2: 'bg-amber-300/20 dark:bg-amber-400/10',
    blob3: 'bg-violet-400/20 dark:bg-violet-500/10',
  },
  sunrise: {
    blob1: 'bg-amber-400/30 dark:bg-amber-400/20',
    blob2: 'bg-yellow-300/25 dark:bg-yellow-500/15',
    blob3: 'bg-orange-300/20 dark:bg-orange-500/10',
  },
}

export function MeshBackground({
  variant = 'brand',
  className = '',
}: MeshBackgroundProps) {
  const colors = VARIANTS[variant]
  return (
    <div
      aria-hidden="true"
      className={`pointer-events-none absolute inset-0 overflow-hidden ${className}`}
    >
      <div
        className={`absolute -top-32 -left-32 h-96 w-96 rounded-full blur-3xl ${colors.blob1}`}
      />
      <div
        className={`absolute -bottom-32 -right-32 h-96 w-96 rounded-full blur-3xl ${colors.blob2}`}
      />
      <div
        className={`absolute top-1/2 left-1/2 h-72 w-72 -translate-x-1/2 -translate-y-1/2 rounded-full blur-3xl ${colors.blob3}`}
      />
    </div>
  )
}
