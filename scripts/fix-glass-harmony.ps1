# Fix all bg-white/bg-gray-{50,100,200} standalone → glass translucent
# Stratégie : remplacer les patterns "containers" et "hovers" courants
# qui apparaissent en lumineux blanc sur dark navy.

$replacements = [System.Collections.Specialized.OrderedDictionary]::new()

# Containers de carte : bg-white + border/shadow/rounded
$replacements.Add(' bg-white border-', ' bg-white/[0.03] backdrop-blur-md border-')
$replacements.Add(' bg-white shadow-', ' bg-white/[0.03] backdrop-blur-md shadow-')
$replacements.Add(' bg-white rounded-', ' bg-white/[0.03] backdrop-blur-md rounded-')
$replacements.Add(' bg-white p-', ' bg-white/[0.03] backdrop-blur-md p-')
$replacements.Add('"bg-white border-', '"bg-white/[0.03] backdrop-blur-md border-')
$replacements.Add('"bg-white shadow-', '"bg-white/[0.03] backdrop-blur-md shadow-')
$replacements.Add('"bg-white rounded-', '"bg-white/[0.03] backdrop-blur-md rounded-')

# bg-gray-50 (très light) → glass tres subtil
$replacements.Add(' bg-gray-50 ', ' bg-white/[0.02] ')
$replacements.Add(' bg-gray-50"', ' bg-white/[0.02]"')
$replacements.Add('"bg-gray-50 ', '"bg-white/[0.02] ')
$replacements.Add('"bg-gray-50"', '"bg-white/[0.02]"')

# bg-gray-100 → glass moyen
$replacements.Add(' bg-gray-100 ', ' bg-white/[0.05] ')
$replacements.Add(' bg-gray-100"', ' bg-white/[0.05]"')
$replacements.Add('"bg-gray-100 ', '"bg-white/[0.05] ')
$replacements.Add('"bg-gray-100"', '"bg-white/[0.05]"')

# bg-gray-200 → glass appuye
$replacements.Add(' bg-gray-200 ', ' bg-white/[0.08] ')
$replacements.Add(' bg-gray-200"', ' bg-white/[0.08]"')
$replacements.Add('"bg-gray-200 ', '"bg-white/[0.08] ')
$replacements.Add('"bg-gray-200"', '"bg-white/[0.08]"')

# Hovers
$replacements.Add('hover:bg-gray-50', 'hover:bg-white/[0.04]')
$replacements.Add('hover:bg-gray-100', 'hover:bg-white/[0.06]')
$replacements.Add('hover:bg-white', 'hover:bg-white/[0.06]')

# Borders gray-100/200 standalone
$replacements.Add(' border-gray-100 ', ' border-white/[0.06] ')
$replacements.Add(' border-gray-200 ', ' border-white/[0.08] ')
$replacements.Add(' border-gray-100"', ' border-white/[0.06]"')
$replacements.Add(' border-gray-200"', ' border-white/[0.08]"')

# Divides (table row dividers)
$replacements.Add('divide-gray-100', 'divide-white/[0.06]')
$replacements.Add('divide-gray-200', 'divide-white/[0.08]')

# Files cibles
$files = Get-ChildItem -Path 'components','app' -Recurse -Include '*.tsx','*.ts' -ErrorAction SilentlyContinue |
  Where-Object { $_.FullName -notmatch '\.test\.|\.next|\.claude\\worktrees' }

$updatedFiles = 0
foreach ($file in $files) {
  $content = [System.IO.File]::ReadAllText($file.FullName)
  $original = $content
  foreach ($key in $replacements.Keys) {
    $content = $content.Replace($key, $replacements[$key])
  }
  if ($content -ne $original) {
    [System.IO.File]::WriteAllText($file.FullName, $content)
    $rel = $file.FullName.Replace($pwd.Path + '\', '')
    Write-Host "UPDATED $rel"
    $updatedFiles++
  }
}
Write-Host ""
Write-Host "Total: $updatedFiles files updated"
