# Test direct INSEE_API_KEY contre endpoint Sirene v3.11
# Usage:
#   $env:INSEE_API_KEY = "ta-cle"
#   .\scripts\test-insee-sirene.ps1

param(
  [string]$ApiKey = $env:INSEE_API_KEY
)

if ([string]::IsNullOrEmpty($ApiKey)) {
  Write-Host "ERREUR: INSEE_API_KEY absente." -ForegroundColor Red
  Write-Host "Usage: `$env:INSEE_API_KEY = 'ta-cle' ; .\scripts\test-insee-sirene.ps1"
  exit 1
}

Write-Host "[1/3] Test endpoint Sirene v3.11 avec ta cle..." -ForegroundColor Cyan
Write-Host "Endpoint: https://api.insee.fr/api-sirene/3.11/siret"
Write-Host "Header  : X-INSEE-Api-Key-Integration"
Write-Host ""

# 1 SIRET de test (Renault SAS - SIREN 441639465)
$url = "https://api.insee.fr/api-sirene/3.11/siret?q=siren:441639465&nombre=1"

Write-Host "[2/3] Tentative avec header X-INSEE-Api-Key-Integration..." -ForegroundColor Cyan

$success = $false
try {
  $resp = Invoke-WebRequest -Uri $url -Headers @{
    "X-INSEE-Api-Key-Integration" = $ApiKey
    "Accept" = "application/json"
  } -Method Get -UseBasicParsing -ErrorAction Stop

  Write-Host "OK SUCCES - Code HTTP $($resp.StatusCode)" -ForegroundColor Green
  $body = $resp.Content | ConvertFrom-Json
  $count = $body.header.total
  Write-Host "  Resultat: $count entreprise(s) trouvee(s)"
  Write-Host ""
  Write-Host "TON ENV LOCAL FONCTIONNE." -ForegroundColor Green
  Write-Host ""
  Write-Host "Si Vercel a toujours Sirene KO: la cle nest PAS bien propagee sur Vercel." -ForegroundColor Yellow
  Write-Host "  1. Verifie INSEE_API_KEY sur Vercel Project Settings"
  Write-Host "  2. Verifie quelle est cochee pour Production"
  Write-Host "  3. Sa valeur correspond bien a la nouvelle cle"
  Write-Host "  4. Va sur Deployments puis Redeploy le dernier deploy"
  $success = $true
  exit 0
} catch {
  $statusCode = 0
  $statusDesc = "unknown"
  $respBody = ""

  if ($_.Exception.Response) {
    $statusCode = [int]$_.Exception.Response.StatusCode
    $statusDesc = $_.Exception.Response.StatusCode.ToString()
    try {
      $stream = $_.Exception.Response.GetResponseStream()
      $reader = New-Object System.IO.StreamReader($stream)
      $respBody = $reader.ReadToEnd()
      $reader.Close()
    } catch {}
  } else {
    $statusDesc = $_.Exception.Message
  }

  Write-Host "KO ECHEC - Code HTTP $statusCode $statusDesc" -ForegroundColor Red
  Write-Host ""
  Write-Host "BODY DE LA REPONSE:" -ForegroundColor Yellow
  if ($respBody.Length -gt 0) {
    $maxLen = [Math]::Min(500, $respBody.Length)
    Write-Host $respBody.Substring(0, $maxLen)
  } else {
    Write-Host "(body vide)"
  }
  Write-Host ""

  if ($statusCode -eq 401 -or $statusCode -eq 403) {
    Write-Host "[3/3] Tentative alternative avec header X-INSEE-Api-Key-Production..." -ForegroundColor Cyan
    try {
      $resp2 = Invoke-WebRequest -Uri $url -Headers @{
        "X-INSEE-Api-Key-Production" = $ApiKey
        "Accept" = "application/json"
      } -Method Get -UseBasicParsing -ErrorAction Stop
      Write-Host "OK Header Production: Code HTTP $($resp2.StatusCode) - SUCCES" -ForegroundColor Green
      Write-Host ""
      Write-Host "TA CLE EST 'PRODUCTION', PAS 'INTEGRATION'." -ForegroundColor Yellow
      Write-Host "Le code utilise X-INSEE-Api-Key-Integration (plan gratuit)."
      Write-Host "Option 1: regenere une cle Integration sur portail-api.insee.fr"
      Write-Host "Option 2: adapte le code pour utiliser le header Production"
      exit 2
    } catch {
      Write-Host "KO Header Production aussi rejete." -ForegroundColor Red
      Write-Host ""
      Write-Host "DIAGNOSTIC FINAL:" -ForegroundColor Yellow
      Write-Host "- Cle invalide / expirée / pas encore propagee (attendre 5 min)"
      Write-Host "- OU app INSEE n'a pas l'API Sirene activee"
      Write-Host "  Va sur https://portail-api.insee.fr"
      Write-Host "  Applications, ton app, onglet APIs"
      Write-Host "  Verifie que Sirene v3.11 est dans tes APIs subscribed"
      Write-Host "  Sinon, clique Subscribe sur l'API Sirene"
    }
  } elseif ($statusCode -eq 429) {
    Write-Host "DIAGNOSTIC: Rate limit ou quota depasse." -ForegroundColor Yellow
    Write-Host "Attendre reset (voir dashboard INSEE)."
  } else {
    Write-Host "DIAGNOSTIC: erreur inattendue, voir body ci-dessus." -ForegroundColor Yellow
  }
  exit 1
}
