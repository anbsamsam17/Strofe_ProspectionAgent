# ============================================================
# regen-supabase-types.ps1
#
# Régénère lib/supabase/database.types.ts depuis l'API Management
# Supabase, sans dépendance au CLI `supabase`.
#
# Usage :
#   $env:SUPABASE_ACCESS_TOKEN = "sbp_xxx..."
#   .\scripts\regen-supabase-types.ps1
#
# OU en one-liner (token uniquement en session, pas écrit) :
#   .\scripts\regen-supabase-types.ps1 -Token "sbp_xxx..."
#
# IMPORTANT : le token ne doit JAMAIS être commit. .env.local est
# dans .gitignore.
# ============================================================

param(
  [string]$Token = $env:SUPABASE_ACCESS_TOKEN,
  [string]$ProjectRef = "wzjljmlbrotgqhigsobz"
)

$ErrorActionPreference = "Stop"

if ([string]::IsNullOrEmpty($Token)) {
  Write-Host "ERREUR : token absent." -ForegroundColor Red
  Write-Host ""
  Write-Host "Usage :" -ForegroundColor Yellow
  Write-Host '  Option 1 (recommandée) :'
  Write-Host '    $env:SUPABASE_ACCESS_TOKEN = "sbp_xxx..."'
  Write-Host '    .\scripts\regen-supabase-types.ps1'
  Write-Host ''
  Write-Host '  Option 2 :'
  Write-Host '    .\scripts\regen-supabase-types.ps1 -Token "sbp_xxx..."'
  exit 1
}

$outputPath = Join-Path $PSScriptRoot "..\lib\supabase\database.types.ts"
$outputPath = [System.IO.Path]::GetFullPath($outputPath)

Write-Host "[1/3] Appel API Management Supabase..." -ForegroundColor Cyan
$headers = @{ "Authorization" = "Bearer $Token" }
$url = "https://api.supabase.com/v1/projects/$ProjectRef/types/typescript"

try {
  $response = Invoke-RestMethod -Uri $url -Headers $headers -Method Get
} catch {
  Write-Host "ERREUR API : $_" -ForegroundColor Red
  exit 1
}

if (-not $response.types) {
  Write-Host "ERREUR : réponse API sans champ 'types'." -ForegroundColor Red
  Write-Host "Réponse brute :" -ForegroundColor Yellow
  Write-Host ($response | ConvertTo-Json -Depth 3)
  exit 1
}

Write-Host "[2/3] Écriture UTF-8 sans BOM dans $outputPath..." -ForegroundColor Cyan
$utf8NoBom = New-Object System.Text.UTF8Encoding $false
[System.IO.File]::WriteAllText($outputPath, $response.types, $utf8NoBom)

$sizeKb = [math]::Round((Get-Item $outputPath).Length / 1KB, 1)
Write-Host "      OK ($sizeKb KB écrits)" -ForegroundColor Green

Write-Host "[3/3] Vérification présence nouvelles colonnes/tables..." -ForegroundColor Cyan
$content = Get-Content $outputPath -Raw
$checks = @(
  @{ Pattern = "do_not_contact"; Label = "Statut do_not_contact (migration 017)" }
  @{ Pattern = "api_quotas"; Label = "Table api_quotas (migration 015)" }
  @{ Pattern = "opt_out"; Label = "Table opt_out (migration 015)" }
  @{ Pattern = "contact_completeness"; Label = "Colonne contact_completeness (migration 015)" }
  @{ Pattern = "email_is_pro"; Label = "Colonne email_is_pro (migration 015)" }
  @{ Pattern = "contact_tier"; Label = "Colonne contact_tier hot/cold (migration 015)" }
  @{ Pattern = "beges_valide"; Label = "Colonne beges_valide (migration 004)" }
)

$allOk = $true
foreach ($check in $checks) {
  if ($content -match $check.Pattern) {
    Write-Host "      [OK] $($check.Label)" -ForegroundColor Green
  } else {
    Write-Host "      [KO] $($check.Label) - introuvable" -ForegroundColor Red
    $allOk = $false
  }
}

# Effacer le token de la mémoire
Remove-Variable Token
$env:SUPABASE_ACCESS_TOKEN = $null

if ($allOk) {
  Write-Host ""
  Write-Host "SUCCES : database.types.ts regenere avec toutes les migrations." -ForegroundColor Green
  Write-Host "Prochaine etape : git add lib/supabase/database.types.ts && git commit + push" -ForegroundColor Yellow
  exit 0
} else {
  Write-Host ""
  Write-Host "ATTENTION : certaines migrations ne sont pas dans le schema." -ForegroundColor Yellow
  Write-Host "Verifie sur Supabase Dashboard que les migrations 015 et 017 sont appliquees." -ForegroundColor Yellow
  exit 2
}
