import {
  NAF_SOUSCLASSES,
  NAF_DIVISION_TO_CATEGORIE,
  sectionFromNaf,
  sectionLabel,
} from '@/lib/agent/naf-labels'

interface NafHierarchyViewProps {
  rawNaf: string | null | undefined
}

/**
 * Affichage hiérarchique Section / Division / Sous-classe INSEE NAF rev. 2.
 *
 * Exemples de normalisation :
 *   '8610Z'  → '86.10Z'  (Sirene live sans point)
 *   '86.10Z' → '86.10Z'  (Sirene bulk avec point — pass-through)
 *   '86'     → '86'      (division seule — 2 niveaux affichés)
 *   null     → message vide
 *
 * Server Component — les données NAF sont statiques, aucun état client requis.
 */
export function NafHierarchyView({ rawNaf }: NafHierarchyViewProps) {
  if (!rawNaf || rawNaf.trim() === '') {
    return (
      <p className="text-sm text-gray-400 italic">Code NAF non renseigné</p>
    )
  }

  // Normalisation : '8610Z' → '86.10Z'
  const cleaned = rawNaf.trim().toUpperCase()
  const normalized =
    cleaned.includes('.')
      ? cleaned
      : cleaned.length >= 5
        ? `${cleaned.slice(0, 2)}.${cleaned.slice(2)}`
        : cleaned

  const section = sectionFromNaf(normalized)
  const secLib = sectionLabel(section)

  // La division est toujours les 2 premiers caractères (chiffres)
  const div = normalized.replace('.', '').slice(0, 2)
  const divMeta = /^\d{2}$/.test(div) ? NAF_DIVISION_TO_CATEGORIE[div] : undefined

  // Sous-classe uniquement si code complet (ex. '86.10Z')
  const subclassLib = NAF_SOUSCLASSES[normalized as keyof typeof NAF_SOUSCLASSES]

  return (
    <div className="space-y-2">
      <p className="font-mono text-xs uppercase tracking-wider text-cyan-400/80">
        NAF — {normalized}
      </p>
      <dl className="space-y-1.5 text-sm">
        {section && secLib && (
          <div className="flex items-baseline gap-2">
            <dt className="w-24 shrink-0 font-mono text-[10px] uppercase tracking-wider text-gray-500">
              Section {section}
            </dt>
            <dd className="text-white">{secLib}</dd>
          </div>
        )}
        {divMeta && (
          <div className="flex items-baseline gap-2">
            <dt className="w-24 shrink-0 font-mono text-[10px] uppercase tracking-wider text-gray-500">
              Division {div}
            </dt>
            <dd className="text-white">{divMeta.libelle}</dd>
          </div>
        )}
        {subclassLib && (
          <div className="flex items-baseline gap-2">
            <dt className="w-24 shrink-0 font-mono text-[10px] uppercase tracking-wider text-gray-500">
              Sous-classe
            </dt>
            <dd className="text-white">{subclassLib}</dd>
          </div>
        )}
        {/* Garde-fou : NAF hors nomenclature — on affiche au moins le code brut */}
        {!section && !divMeta && !subclassLib && (
          <div className="flex items-baseline gap-2">
            <dt className="w-24 shrink-0 font-mono text-[10px] uppercase tracking-wider text-gray-500">
              Code NAF
            </dt>
            <dd className="text-white">{normalized}</dd>
          </div>
        )}
      </dl>
    </div>
  )
}
