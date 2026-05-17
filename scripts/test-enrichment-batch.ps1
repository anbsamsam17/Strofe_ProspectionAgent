# ============================================================
# test-enrichment-batch.ps1
#
# Teste l'enrichissement v2 sur N prospects sans contact complet.
# Appelle POST /api/prospects/[id]/enrich pour chacun et imprime les
# sources qui ont contribué + un récap final.
#
# Usage :
#   .\scripts\test-enrichment-batch.ps1
#   .\scripts\test-enrichment-batch.ps1 -BaseUrl "https://decarbonleads.strofe.fr" -Limit 10
#
# Auth :
#   Le script requiert ton COOKIE de session Supabase :
#   1. Va sur l'app dans Chrome → F12 → Network → recharge la page
#   2. Sur n'importe quelle requête à decarbonleads.strofe.fr, copie
#      l'en-tête `Cookie:` complet (souvent `sb-XXX-auth-token=...`)
#   3. Lance le script avec :
#        $env:SESSION_COOKIE = "sb-...=..."
#        .\scripts\test-enrichment-batch.ps1
#
# ⚠️ Le cookie EXPIRE — pas grave, regenere une session si besoin.
# ============================================================

param(
  [string]$BaseUrl = "https://decarbonleads.strofe.fr",
  [int]$Limit = 5,
  [string]$Cookie = $env:SESSION_COOKIE
)

$ErrorActionPreference = "Stop"

if ([string]::IsNullOrEmpty($Cookie)) {
  Write-Host "ERREUR : SESSION_COOKIE manquant." -ForegroundColor Red
  Write-Host "Usage :"
  Write-Host '  $env:SESSION_COOKIE = "sb-xxx-auth-token=eyJ..."'
  Write-Host '  .\scripts\test-enrichment-batch.ps1'
  exit 1
}

Write-Host "Récupère $Limit prospects sans email ni telephone..." -ForegroundColor Cyan

$headers = @{ "Cookie" = $Cookie; "Accept" = "application/json" }

# Liste les prospects à tester (limit + filtre côté URL)
$listUrl = "$BaseUrl/api/prospects?page=1&limit=$Limit&contact_type="

try {
  $list = Invoke-RestMethod -Uri $listUrl -Headers $headers -Method Get
} catch {
  Write-Host "ERREUR liste prospects : $_" -ForegroundColor Red
  exit 1
}

$candidates = $list.prospects | Where-Object {
  -not $_.contact_email -or -not $_.contact_telephone
} | Select-Object -First $Limit

if ($candidates.Count -eq 0) {
  Write-Host "Aucun prospect à enrichir (tous complets)." -ForegroundColor Yellow
  exit 0
}

Write-Host "Lancement de $($candidates.Count) tests d'enrichissement..." -ForegroundColor Cyan
Write-Host ""

$results = @()
foreach ($p in $candidates) {
  $url = "$BaseUrl/api/prospects/$($p.id)/enrich"
  Write-Host "→ $($p.raison_sociale) (SIREN $($p.siren))" -ForegroundColor White

  try {
    $start = Get-Date
    $r = Invoke-RestMethod -Uri $url -Headers $headers -Method Post -ContentType "application/json"
    $duration = ((Get-Date) - $start).TotalMilliseconds

    $added = if ($r.data.added) { $r.data.added -join ', ' } else { 'rien' }
    $sources = if ($r.data.sources) { $r.data.sources -join ', ' } else { '-' }

    Write-Host "  ajouté: $added" -ForegroundColor Green
    Write-Host "  sources: $sources" -ForegroundColor Gray
    Write-Host "  durée: $([math]::Round($duration))ms" -ForegroundColor Gray
    Write-Host ""

    $results += [PSCustomObject]@{
      siren = $p.siren
      raison_sociale = $p.raison_sociale
      added = $added
      sources = $sources
      duration_ms = [math]::Round($duration)
    }
  } catch {
    Write-Host "  ERREUR : $_" -ForegroundColor Red
    Write-Host ""
  }

  # Politesse — ne pas spammer les APIs externes
  Start-Sleep -Milliseconds 500
}

Write-Host ""
Write-Host "=== RÉCAPITULATIF ===" -ForegroundColor Cyan
$results | Format-Table -AutoSize

$withEmail = ($results | Where-Object { $_.added -match "email" }).Count
$withPhone = ($results | Where-Object { $_.added -match "telephone" }).Count
$withLinkedin = ($results | Where-Object { $_.added -match "linkedin" }).Count
$total = $results.Count

Write-Host ""
Write-Host "Coverage :" -ForegroundColor Yellow
Write-Host "  Email     : $withEmail/$total"
Write-Host "  Téléphone : $withPhone/$total"
Write-Host "  LinkedIn  : $withLinkedin/$total"

# Sources les plus actives
$allSources = $results | ForEach-Object { $_.sources -split ', ' } | Where-Object { $_ -and $_ -ne '-' }
$bySource = $allSources | Group-Object | Sort-Object Count -Descending
Write-Host ""
Write-Host "Sources actives :" -ForegroundColor Yellow
foreach ($s in $bySource) {
  Write-Host "  $($s.Name) : $($s.Count) fois"
}
