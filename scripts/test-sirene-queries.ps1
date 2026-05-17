# test-sirene-queries.ps1
# ------------------------------------------------------------------
# Teste plusieurs variantes de query Lucene/Solr contre Sirene v3.11
# pour identifier precisement ce qui marche et ce qui plante.
#
# USAGE:
#   $env:INSEE_API_KEY = "ta-cle-integration"
#   .\scripts\test-sirene-queries.ps1
#
# OU en passant la cle en parametre:
#   .\scripts\test-sirene-queries.ps1 -ApiKey "ta-cle"
#
# ENDPOINT: https://api.insee.fr/api-sirene/3.11/siret
# HEADER  : X-INSEE-Api-Key-Integration
#
# ------------------------------------------------------------------
# GRILLE DE LECTURE DES RESULTATS:
#
# - Test 1 (siren simple)            -> baseline auth/endpoint
# - Test 2 vs 3 (etat A non/quoted)  -> Sirene tolere-t-il les valeurs nues sur enum ?
# - Test 4 (range CP seul)           -> les ranges [a TO b] passent ?
# - Test 5 vs 6 (tranche single)     -> idem pour code numerique simple
# - Test 7 vs 8 (OR tranches)        -> les clauses OR numeriques exigent-elles des quotes ?
# - Test 9 vs 10 (OR NAF)            -> les codes NAF (commencent par chiffre, ex 0121Z)
#                                        cassent-ils sans quotes ?
# - Test 11 (combinee quoted)        -> query "propre" actuelle de l'app
# - Test 12 (combinee non quoted)    -> ancien comportement, pour comparer
# - Test 13 (combinee + NAF quoted)  -> full filtre quoted
# - Test 14 (URL EXACTE prod)        -> reproduit exactement ce qui plante en prod
#
# INTERPRETATION RAPIDE:
# - Si test 7 OK et test 9 KO        -> probleme specifique aux NAF (commencent par 0)
# - Si test 5 OK et test 6 KO        -> Sirene refuse les quotes sur tranche
# - Si test 11 OK et test 14 KO      -> il FAUT quoter pour les clauses OR
# - Si test 1 KO                     -> probleme de cle/header (pas de query)
# ------------------------------------------------------------------

param(
  [string]$ApiKey = $env:INSEE_API_KEY
)

if ([string]::IsNullOrEmpty($ApiKey)) {
  Write-Host "ERREUR: INSEE_API_KEY absente." -ForegroundColor Red
  Write-Host "Usage:"
  Write-Host "  `$env:INSEE_API_KEY = 'ta-cle' ; .\scripts\test-sirene-queries.ps1"
  Write-Host "  ou"
  Write-Host "  .\scripts\test-sirene-queries.ps1 -ApiKey 'ta-cle'"
  exit 1
}

$ENDPOINT = "https://api.insee.fr/api-sirene/3.11/siret"
$HEADERS = @{
  "X-INSEE-Api-Key-Integration" = $ApiKey
  "Accept"                      = "application/json"
}
$SLEEP_MS = 500

# Definition des tests: liste de hashtables { Num, Label, Query }
$tests = @(
  @{ Num = 1;  Label = "siren unique";                                     Query = "siren:441639465" },
  @{ Num = 2;  Label = "etat A non quote";                                 Query = "etatAdministratifEtablissement:A" },
  @{ Num = 3;  Label = "etat A quote";                                     Query = 'etatAdministratifEtablissement:"A"' },
  @{ Num = 4;  Label = "range code postal seul (non quote)";               Query = "codePostalEtablissement:[33000 TO 33999]" },
  @{ Num = 5;  Label = "tranche effectif single non quote";                Query = "trancheEffectifsEtablissement:41" },
  @{ Num = 6;  Label = "tranche effectif single quote";                    Query = 'trancheEffectifsEtablissement:"41"' },
  @{ Num = 7;  Label = "OR tranches non quote";                            Query = "trancheEffectifsEtablissement:(41 OR 42)" },
  @{ Num = 8;  Label = "OR tranches quote";                                Query = 'trancheEffectifsEtablissement:("41" OR "42")' },
  @{ Num = 9;  Label = "OR NAF non quote";                                 Query = "activitePrincipaleEtablissement:(0121Z OR 0122Z)" },
  @{ Num = 10; Label = "OR NAF quote";                                     Query = 'activitePrincipaleEtablissement:("0121Z" OR "0122Z")' },
  @{ Num = 11; Label = "combinee quoted (query app actuelle)";             Query = 'etatAdministratifEtablissement:"A" AND codePostalEtablissement:[16000 TO 87999] AND trancheEffectifsEtablissement:("41" OR "42")' },
  @{ Num = 12; Label = "combinee SANS quotes (ancien comportement)";       Query = 'etatAdministratifEtablissement:A AND codePostalEtablissement:[16000 TO 87999] AND trancheEffectifsEtablissement:(41 OR 42)' },
  @{ Num = 13; Label = "combinee + NAF quoted (full filtre)";              Query = 'etatAdministratifEtablissement:"A" AND codePostalEtablissement:[16000 TO 87999] AND trancheEffectifsEtablissement:("41" OR "42") AND activitePrincipaleEtablissement:("0121Z" OR "0122Z" OR "3030Z")' },
  @{ Num = 14; Label = "URL exacte prod (NAF + tranches non quotes)";      Query = 'etatAdministratifEtablissement:A AND codePostalEtablissement:[16000 TO 87999] AND trancheEffectifsEtablissement:(41 OR 42) AND activitePrincipaleEtablissement:(0121Z OR 0122Z OR 3030Z OR 5210B OR 5229A OR 1011Z OR 1013A OR 1032Z OR 1051A OR 1071A OR 4617B OR 4941A OR 4941B OR 5221Z OR 2011Z OR 2014Z OR 2015Z OR 2311Z OR 2313Z OR 2410Z)' }
)

Write-Host ""
Write-Host "===============================================================" -ForegroundColor Cyan
Write-Host " Sirene v3.11 - Test de variantes de query Lucene/Solr" -ForegroundColor Cyan
Write-Host "===============================================================" -ForegroundColor Cyan
Write-Host " Endpoint: $ENDPOINT"
Write-Host " Header  : X-INSEE-Api-Key-Integration"
Write-Host " Tests   : $($tests.Count)"
Write-Host ""

# Stocke les resultats pour le tableau recapitulatif final
$results = @()

foreach ($t in $tests) {
  $num   = $t.Num
  $label = $t.Label
  $rawQ  = $t.Query

  # Encodage URL de la query (les espaces, guillemets, crochets etc.)
  $encQ  = [uri]::EscapeDataString($rawQ)
  $url   = "$ENDPOINT" + "?q=" + $encQ + "&nombre=1"

  Write-Host "---------------------------------------------------------------" -ForegroundColor DarkGray
  Write-Host ("[Test {0,2}] {1}" -f $num, $label) -ForegroundColor White
  Write-Host ("  q= {0}" -f $rawQ) -ForegroundColor DarkGray

  $statusCode = 0
  $statusText = ""
  $ok         = $false
  $count      = $null
  $bodySnip   = ""

  try {
    $resp = Invoke-WebRequest -Uri $url -Headers $HEADERS -Method Get -UseBasicParsing -ErrorAction Stop
    $statusCode = [int]$resp.StatusCode
    $statusText = "OK"
    try {
      $json  = $resp.Content | ConvertFrom-Json
      $count = $json.header.total
    } catch {
      $count = "?"
    }
    $ok = $true
    Write-Host ("  -> HTTP {0}  total={1}" -f $statusCode, $count) -ForegroundColor Green
  } catch {
    if ($_.Exception.Response) {
      $statusCode = [int]$_.Exception.Response.StatusCode
      $statusText = $_.Exception.Response.StatusCode.ToString()
      try {
        $stream = $_.Exception.Response.GetResponseStream()
        $reader = New-Object System.IO.StreamReader($stream)
        $bodySnip = $reader.ReadToEnd()
        $reader.Close()
      } catch {
        $bodySnip = ""
      }
    } else {
      $statusText = $_.Exception.Message
    }

    Write-Host ("  -> HTTP {0} {1}" -f $statusCode, $statusText) -ForegroundColor Red
    if ($bodySnip.Length -gt 0) {
      $maxLen = [Math]::Min(300, $bodySnip.Length)
      $extract = $bodySnip.Substring(0, $maxLen) -replace "`r`n", " " -replace "`n", " "
      Write-Host ("  body: {0}" -f $extract) -ForegroundColor Yellow
    } else {
      Write-Host "  body: (vide)" -ForegroundColor Yellow
    }
  }

  $results += [pscustomobject]@{
    Num    = $num
    Label  = $label
    Status = $statusCode
    Result = if ($ok) { "OK" } else { "KO" }
    Count  = if ($null -ne $count) { "$count" } else { "" }
  }

  Start-Sleep -Milliseconds $SLEEP_MS
}

# ----- Tableau recapitulatif final ------------------------------------
Write-Host ""
Write-Host "===============================================================" -ForegroundColor Cyan
Write-Host " RECAPITULATIF" -ForegroundColor Cyan
Write-Host "===============================================================" -ForegroundColor Cyan
Write-Host ""

$results | Format-Table -AutoSize @(
  @{ Label = "#";        Expression = { $_.Num };    Width = 3 },
  @{ Label = "Status";   Expression = { $_.Status }; Width = 6 },
  @{ Label = "Result";   Expression = { $_.Result }; Width = 6 },
  @{ Label = "Total";    Expression = { $_.Count };  Width = 8 },
  @{ Label = "Test";     Expression = { $_.Label } }
)

$okCount = ($results | Where-Object { $_.Result -eq "OK" }).Count
$koCount = ($results | Where-Object { $_.Result -eq "KO" }).Count

Write-Host ""
Write-Host ("Bilan: {0} OK / {1} KO sur {2} tests" -f $okCount, $koCount, $results.Count) -ForegroundColor Cyan
Write-Host ""

# Quelques heuristiques de diagnostic automatique
function Get-Result($n) {
  return ($results | Where-Object { $_.Num -eq $n } | Select-Object -First 1)
}

$r1  = Get-Result 1
$r5  = Get-Result 5
$r6  = Get-Result 6
$r7  = Get-Result 7
$r8  = Get-Result 8
$r9  = Get-Result 9
$r10 = Get-Result 10
$r11 = Get-Result 11
$r14 = Get-Result 14

Write-Host "DIAGNOSTIC AUTO:" -ForegroundColor Yellow

if ($r1 -and $r1.Result -eq "KO") {
  Write-Host "  - Test 1 KO: probleme cle/header/endpoint (pas une question de query)." -ForegroundColor Red
}
if ($r9 -and $r10 -and $r9.Result -eq "KO" -and $r10.Result -eq "OK") {
  Write-Host "  - NAF OR sans quotes KO mais avec quotes OK -> il FAUT quoter les codes NAF." -ForegroundColor Yellow
}
if ($r7 -and $r8 -and $r7.Result -eq "KO" -and $r8.Result -eq "OK") {
  Write-Host "  - Tranches OR sans quotes KO mais avec quotes OK -> il FAUT quoter les tranches." -ForegroundColor Yellow
}
if ($r5 -and $r6 -and $r5.Result -eq "OK" -and $r6.Result -eq "KO") {
  Write-Host "  - Tranche single quote KO -> ne PAS quoter les valeurs uniques." -ForegroundColor Yellow
}
if ($r11 -and $r14 -and $r11.Result -eq "OK" -and $r14.Result -eq "KO") {
  Write-Host "  - Query app (quoted) OK mais query prod (non quote) KO -> regression: prod n'envoie pas la version quotee." -ForegroundColor Red
}
if ($r11 -and $r14 -and $r11.Result -eq "OK" -and $r14.Result -eq "OK") {
  Write-Host "  - Les deux versions combinees passent -> ni les quotes ni le NAF ne sont en cause." -ForegroundColor Green
}

Write-Host ""
exit 0
