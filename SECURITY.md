# Politique de sécurité — ProspectionAgent

ProspectionAgent (Glan / Strofe) est un SaaS de prospection commerciale orienté Bilan GES (obligation BEGES). Ce document décrit le périmètre couvert, la procédure de signalement de vulnérabilité et un récapitulatif des mesures de sécurité réellement en place.

---

## Signaler une vulnérabilité

Si vous découvrez une faille de sécurité, **ne l'ouvrez pas en issue publique**.

- Contact : **samir.anbri@gmail.com**
- Merci d'inclure : description de la vulnérabilité, étapes de reproduction, impact estimé, et toute preuve de concept.
- Nous accusons réception sous quelques jours ouvrés et vous tenons informé de la correction.
- Merci de laisser un délai raisonnable de correction avant toute divulgation publique (divulgation coordonnée).

---

## Périmètre

- **Couvert** : l'application web (Next.js), ses routes API, le modèle d'isolation des données (RLS Supabase), la gestion des secrets et des accès, le traitement des données prospect (PII).
- **Hors périmètre** : les services tiers gérés (Supabase, Vercel, Resend, INSEE/ADEME, OpenAI) — à signaler directement aux fournisseurs concernés.
- **Production** : l'application est en production avec des clients réels. Aucun test intrusif sur l'environnement de production sans accord préalable.

---

## Mesures de sécurité en place

Les éléments ci-dessous sont implémentés et vérifiables dans le code source.

### Isolation multi-tenant (RLS)

Row Level Security PostgreSQL activée sur toutes les tables métier, avec 4 policies (`SELECT` / `INSERT` / `UPDATE` / `DELETE`) filtrant par `auth.uid() = user_id`, plus une contrainte `UNIQUE(user_id, siren)`. La clé `service_role` est isolée côté serveur uniquement.
Détails : voir [`docs/SECURITY-RLS.md`](docs/SECURITY-RLS.md).
Références : `supabase/migrations/001_initial.sql`, `lib/supabase/server.ts`.

### Scrub PII dans Sentry (3 runtimes)

Le monitoring d'erreurs Sentry scrub les **emails** et **téléphones** (prospects) avant tout envoi, via un `beforeSend` appliqué récursivement sur l'ensemble du payload. La logique est centralisée dans `scrubSentryEvent` (`lib/observability/sentry-helpers.ts`) et branchée sur les **trois** runtimes :

- `sentry.client.config.ts`
- `sentry.server.config.ts`
- `sentry.edge.config.ts`

Les UUID utilisateur et les SIREN (identifiants publics) ne sont pas considérés comme PII et sont conservés pour le debug.

### CRON_SECRET — comparaison timing-safe

Les routes cron Vercel sont protégées par un secret comparé en **temps constant** via `crypto.timingSafeEqual`, avec padding à longueur fixe (128 octets) pour éviter toute fuite de longueur par timing, plus une vérification de longueur exacte. Jamais de comparaison `===` / `==` / `.includes()`, jamais de log de la valeur.
Référence : `lib/auth/cron.ts` (`isCronRequest`).

### Opt-out HMAC (désinscription 1 clic)

Les liens de désinscription des emails de prospection sont signés en **HMAC-SHA256** (secret `OPT_OUT_HMAC_SECRET`), avec payload signé (user, SIREN/email cible, expiration) et vérification de signature en temps constant (`timingSafeEqual`). Un token invalide, expiré ou falsifié est rejeté.
Référence : `lib/auth/opt-out-token.ts`.

### Conformité RGPD (article 14)

Les données prospect étant collectées indirectement (sources publiques : Sirene INSEE, registre ADEME BEGES, etc.), l'information RGPD **article 14** est délivrée dès le **premier** email de prospection : identité du responsable de traitement, finalité, sources, durée de conservation, droits, et lien d'opt-out HMAC. La date de premier contact est persistée (`prospects.first_contact_at`) à titre de preuve.
Références : `lib/email/rgpd.ts`, migration `022_first_contact_at.sql`.

### Autres garde-fous (cf. `.claude/rules/security.md`)

- **Secrets** : jamais en clair dans le code ; `.env.local` non commité ; liste de variables interdites à logger.
- **Validation** : tout body d'API et toute réponse d'API externe parsés via schémas Zod.
- **SSRF** : whitelist stricte de domaines pour les `fetch()` sortants ; aucune URL contrôlée par l'utilisateur.
- **Logs** : pas de log d'objet `prospect` complet (email + téléphone) ; uniquement `id` et `siren`.

---

## Backlog de durcissement

Un point de durcissement identifié et documenté (non bloquant) : restreindre les GRANT au rôle `anon` sur `search_sirene_cache` et la vue `sirene_cache_size` (données publiques, mais à limiter aux rôles authentifiés). Détails et migration proposée : voir [`docs/SECURITY-RLS.md`](docs/SECURITY-RLS.md) §6.
