# Cleanup batch glass replacement bug : `bg-white/[0.0X]/[0.0Y]` → `bg-white/[0.0Y]`
# (le pattern hover:bg-white a matché des classes déjà transformées)

$cleanups = [System.Collections.Specialized.OrderedDictionary]::new()
# Doubles glass → garder le second (le plus récent)
$cleanups.Add('bg-white/[0.025]/[0.04]', 'bg-white/[0.04]')
$cleanups.Add('bg-white/[0.025]/[0.06]', 'bg-white/[0.06]')
$cleanups.Add('bg-white/[0.025]/[0.08]', 'bg-white/[0.08]')
$cleanups.Add('bg-white/[0.025]/[0.1]', 'bg-white/[0.1]')
$cleanups.Add('bg-white/[0.03]/[0.04]', 'bg-white/[0.04]')
$cleanups.Add('bg-white/[0.03]/[0.06]', 'bg-white/[0.06]')
$cleanups.Add('bg-white/[0.03]/[0.08]', 'bg-white/[0.08]')
$cleanups.Add('bg-white/[0.04]/[0.04]', 'bg-white/[0.04]')
$cleanups.Add('bg-white/[0.04]/[0.06]', 'bg-white/[0.06]')
$cleanups.Add('bg-white/[0.04]/[0.08]', 'bg-white/[0.08]')
$cleanups.Add('bg-white/[0.05]/[0.04]', 'bg-white/[0.05]')
$cleanups.Add('bg-white/[0.05]/[0.06]', 'bg-white/[0.06]')
$cleanups.Add('bg-white/[0.05]/[0.08]', 'bg-white/[0.08]')
$cleanups.Add('bg-white/[0.06]/[0.04]', 'bg-white/[0.06]')
$cleanups.Add('bg-white/[0.06]/[0.06]', 'bg-white/[0.06]')
$cleanups.Add('bg-white/[0.06]/[0.08]', 'bg-white/[0.08]')
$cleanups.Add('bg-white/[0.08]/[0.04]', 'bg-white/[0.06]')
$cleanups.Add('bg-white/[0.08]/[0.06]', 'bg-white/[0.08]')
$cleanups.Add('bg-white/[0.08]/[0.08]', 'bg-white/[0.08]')
$cleanups.Add('bg-white/[0.1]/[0.04]', 'bg-white/[0.1]')
$cleanups.Add('bg-white/[0.1]/[0.06]', 'bg-white/[0.1]')
$cleanups.Add('bg-white/[0.1]/[0.08]', 'bg-white/[0.1]')

$files = Get-ChildItem -Path 'components','app' -Recurse -Include '*.tsx','*.ts' -ErrorAction SilentlyContinue |
  Where-Object { $_.FullName -notmatch '\.test\.|\.next|\.claude\\worktrees' }

$updatedFiles = 0
foreach ($file in $files) {
  $content = [System.IO.File]::ReadAllText($file.FullName)
  $original = $content
  foreach ($key in $cleanups.Keys) {
    $content = $content.Replace($key, $cleanups[$key])
  }
  if ($content -ne $original) {
    [System.IO.File]::WriteAllText($file.FullName, $content)
    $rel = $file.FullName.Replace($pwd.Path + '\', '')
    Write-Host "CLEANED $rel"
    $updatedFiles++
  }
}
Write-Host ""
Write-Host "Total: $updatedFiles files cleaned"
