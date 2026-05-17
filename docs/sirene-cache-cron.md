## SIRENE cache cron (GitHub Actions)

Workflow `.github/workflows/sirene-import.yml` qui rejoue l'ETL `npm run import-sirene` une fois par mois, hors Vercel (timeout 800s incompatible avec un ETL de 15-30 min).

### Activer

1. Repo GitHub > Settings > Secrets and variables > Actions > New repository secret.
2. Ajouter les 4 secrets :
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `SUPABASE_SERVICE_ROLE_KEY` (sensible, upsert massif)
   - `CRON_SECRET` (reuse du secret Vercel)
   - `APP_URL` (ex. `https://decarbonleads.strofe.fr`)

### Trigger

- Auto : 1er du mois a 04:00 UTC (~05h Paris hiver, 06h ete).
- Manuel : `gh workflow run sirene-import.yml -f force=true` (ou onglet Actions > Run workflow).
- Skip auto si l'API `/api/admin/sirene-status` repond `days_since_import < 25`. `force=true` outrepasse.

### Logs

Onglet Actions du repo > workflow `Sirene Cache Monthly Import` > run en cours. Logs JSON ligne par ligne du script ETL, plus le status post-import.

### Cout

Tier gratuit GitHub Actions : 2000 min/mois sur runners Linux. Un run = ~30 min. Cout reel : ~1.5% du quota.

### Echec

`if: failure()` emet un `::error::` dans le summary. Pour brancher Discord/Slack, ajouter un curl webhook dans la derniere step.
