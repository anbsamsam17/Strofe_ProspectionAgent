# memory.ps1 — Chargeur de contexte pour Agent IA - Prospection Bilan Carbone
# =====================================================
# Concatène tous les fichiers mémoire et les copie dans le presse-papiers
# ou les affiche dans stdout pour injection dans Claude CLI.
#
# Usage :
#   .\scripts\memory.ps1                  → copie dans le presse-papiers
#   .\scripts\memory.ps1 -Print           → affiche dans stdout
#   .\scripts\memory.ps1 -File            → écrit dans %TEMP%\context.txt
#   claude "$(.\scripts\memory.ps1 -Print) Mon prompt ici"

param(
    [switch]$Print,
    [switch]$File
)

$ProjectRoot = Split-Path -Parent $PSScriptRoot

$Files = @(
    "$ProjectRoot\memory\project-context.md",
    "$ProjectRoot\memory\primer.md",
    "$ProjectRoot\memory\session-context.md",
    "$ProjectRoot\memory\hindsight.md"
)

$Separator = "`n---`n"

# ── assemble context ──────────────────────────────
$Parts = @()
foreach ($f in $Files) {
    if (Test-Path $f) {
        $Parts += Get-Content $f -Raw -Encoding UTF8
    }
}
$Context = $Parts -join $Separator

# ── output mode ──────────────────────────────────
if ($Print) {
    Write-Output $Context
}
elseif ($File) {
    $OutPath = "$env:TEMP\agent-ia---prospection-bilan-carbone-context.txt"
    $Context | Set-Content -Path $OutPath -Encoding UTF8
    Write-Host "Contexte ecrit dans : $OutPath" -ForegroundColor Green
}
else {
    $Context | Set-Clipboard
    $CharCount = $Context.Length
    Write-Host "Contexte copie dans le presse-papiers ($CharCount caracteres)" -ForegroundColor Green
    Write-Host ""
    Write-Host "Fichiers charges :" -ForegroundColor Cyan
    foreach ($f in $Files) {
        if (Test-Path $f) {
            Write-Host "  + $(Split-Path -Leaf $f)" -ForegroundColor Gray
        }
    }
}
