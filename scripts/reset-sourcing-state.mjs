// Reset profiles.sourcing_state pour un user (ou pour tous) après
// le bug "Univers de recherche épuisé" causé par INSEE 4xx silencieux.
//
// Lancer avec :
//   node --env-file=.env.local scripts/reset-sourcing-state.mjs
//   node --env-file=.env.local scripts/reset-sourcing-state.mjs samir.anbri@gmail.com
//
// Ne lit, log, ni commit aucun secret — les env sont chargées par Node via --env-file.

import { createClient } from '@supabase/supabase-js'

const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const serviceRole = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!url || !serviceRole) {
  console.error('Missing env: NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY')
  console.error('Run with:  node --env-file=.env.local scripts/reset-sourcing-state.mjs')
  process.exit(1)
}

const targetEmail = process.argv[2] ?? null

const supabase = createClient(url, serviceRole, {
  auth: { persistSession: false, autoRefreshToken: false },
})

async function findUserIdByEmail(email) {
  // Itère sur les pages users via admin.listUsers (pas de filtre côté API).
  for (let page = 1; page <= 10; page++) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 100 })
    if (error) throw error
    const found = data.users.find((u) => u.email?.toLowerCase() === email.toLowerCase())
    if (found) return found.id
    if (data.users.length < 100) return null
  }
  return null
}

let query = supabase
  .from('profiles')
  .update({ sourcing_state: {} })
  .select('id')

if (targetEmail) {
  const userId = await findUserIdByEmail(targetEmail)
  if (!userId) {
    console.error(`User introuvable pour email=${targetEmail}`)
    process.exit(1)
  }
  console.log(`Cible : user_id=${userId} (email=${targetEmail})`)
  query = query.eq('id', userId)
} else {
  console.log('Cible : TOUS les profils')
}

const { data, error } = await query

if (error) {
  console.error('Erreur UPDATE:', error.message)
  process.exit(1)
}

console.log(`OK — ${data?.length ?? 0} profil(s) reset (sourcing_state = {})`)
