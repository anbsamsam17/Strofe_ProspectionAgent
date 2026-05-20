// ============================================================
// RENDER / INTERPOLATION — variables {{xxx}} dans templates email
//
// Utilisé côté UI (preview) ET côté serveur (rendu final avant
// envoi Resend). Variables non remplies → chaîne vide (pas d'erreur).
// ============================================================

export interface TemplateVariables {
  prenom?: string | null
  nom?: string | null
  raison_sociale?: string | null
  secteur_libelle?: string | null
  beges_expire_le?: string | null
  beges_annee_reporting?: string | null
  calendly_url?: string | null
  opt_out_link?: string | null
}

/**
 * Interpole les variables `{{key}}` dans une chaîne de template.
 * Variables manquantes (undefined/null) → chaîne vide.
 *
 * NB : remplacement non récursif — un placeholder dans une valeur
 * d'interpolation n'est pas réinterprété.
 */
export function interpolateTemplate(
  template: string,
  variables: TemplateVariables,
): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_match, key: string) => {
    const value = (variables as Record<string, string | null | undefined>)[key]
    if (value === undefined || value === null) return ''
    return String(value)
  })
}

/**
 * Calcule la date d'expiration BEGES en fonction de la dernière publication
 * et du flag entité publique.
 *
 * Référentiel (Art. L229-25 + Décret 2022-982) :
 *   - Personne morale de droit public  : 3 ans
 *   - Personne morale de droit privé   : 4 ans
 *
 * Si aucune publication précédente, on remonte 1 an dans le futur depuis
 * aujourd'hui (placeholder pour pousser à l'action sans bluffer le prospect).
 */
export function computeBegesExpireLe(input: {
  beges_derniere_publication?: string | null
  entite_publique?: boolean | null
}): string {
  const ENTITE_PUBLIQUE_VALID_YEARS = 3
  const ENTITE_PRIVEE_VALID_YEARS = 4
  const FALLBACK_HORIZON_YEARS = 1

  const validity = input.entite_publique
    ? ENTITE_PUBLIQUE_VALID_YEARS
    : ENTITE_PRIVEE_VALID_YEARS

  let base: Date
  if (input.beges_derniere_publication) {
    const parsed = new Date(input.beges_derniere_publication)
    if (!Number.isNaN(parsed.getTime())) {
      base = parsed
      base.setFullYear(base.getFullYear() + validity)
    } else {
      base = new Date()
      base.setFullYear(base.getFullYear() + FALLBACK_HORIZON_YEARS)
    }
  } else {
    base = new Date()
    base.setFullYear(base.getFullYear() + FALLBACK_HORIZON_YEARS)
  }

  // Format français long, ex. "12 mars 2027"
  return new Intl.DateTimeFormat('fr-FR', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(base)
}

/**
 * Extrait l'année de reporting du BEGES (année calendaire du bilan publié).
 *
 * Le registre ADEME publie un BEGES avec `beges_derniere_publication` qui
 * correspond à la date de **dépôt** du bilan. Par convention, l'année de
 * reporting est l'année qui précède le dépôt (publication courant N+1 pour
 * un bilan portant sur N). Heuristique : on retire 1 an à la date de
 * publication. Si la date n'est pas exploitable, retourne chaîne vide.
 */
export function computeBegesAnneeReporting(
  beges_derniere_publication: string | null | undefined,
): string {
  if (!beges_derniere_publication) return ''
  const parsed = new Date(beges_derniere_publication)
  if (Number.isNaN(parsed.getTime())) return ''
  return String(parsed.getFullYear() - 1)
}
