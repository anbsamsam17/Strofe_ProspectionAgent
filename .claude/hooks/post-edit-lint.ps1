#requires -Version 5.1
# PostToolUse hook: ESLint on edited TS/JS files under app/, lib/, components/.
# Non-blocking: surfaces issues as additionalContext only.

try {
    [Console]::OutputEncoding = [System.Text.Encoding]::UTF8

    $raw = [Console]::In.ReadToEnd()
    if ([string]::IsNullOrWhiteSpace($raw)) { exit 0 }

    $payload = $raw | ConvertFrom-Json -ErrorAction Stop

    $filePath = $null
    if ($payload.PSObject.Properties.Name -contains 'tool_input' -and $payload.tool_input) {
        if ($payload.tool_input.PSObject.Properties.Name -contains 'file_path') {
            $filePath = [string]$payload.tool_input.file_path
        }
    }
    if ([string]::IsNullOrWhiteSpace($filePath)) { exit 0 }

    $norm  = $filePath -replace '\\','/'
    $lower = $norm.ToLowerInvariant()

    # Only TS/JS variants
    if (-not ($lower -match '\.(ts|tsx|js|jsx|mjs|cjs)$')) { exit 0 }
    # Only inside app/, lib/, components/
    if (-not ($lower -match '/(app|lib|components)/')) { exit 0 }
    # Skip noise
    if ($lower -match '/(\.next|node_modules|dist|coverage)/') { exit 0 }

    $projectDir = $env:CLAUDE_PROJECT_DIR
    if ([string]::IsNullOrWhiteSpace($projectDir)) {
        $projectDir = (Get-Location).Path
    }

    if (-not (Test-Path -LiteralPath $filePath)) { exit 0 }

    $psi = New-Object System.Diagnostics.ProcessStartInfo
    $psi.FileName = "cmd.exe"
    $psi.Arguments = "/c npx --no-install eslint --max-warnings=0 `"$filePath`""
    $psi.WorkingDirectory = $projectDir
    $psi.RedirectStandardOutput = $true
    $psi.RedirectStandardError = $true
    $psi.UseShellExecute = $false
    $psi.CreateNoWindow = $true

    $proc = New-Object System.Diagnostics.Process
    $proc.StartInfo = $psi
    $null = $proc.Start()

    $stdoutTask = $proc.StandardOutput.ReadToEndAsync()
    $stderrTask = $proc.StandardError.ReadToEndAsync()

    if (-not $proc.WaitForExit(20000)) {
        try { $proc.Kill() } catch {}
        [Console]::Error.WriteLine("post-edit-lint: eslint exceeded 20s, skipped")
        exit 0
    }

    $stdout = $stdoutTask.Result
    $stderr = $stderrTask.Result
    $exitCode = $proc.ExitCode

    if ($exitCode -ne 0) {
        $combined = ($stdout + "`n" + $stderr).Trim()
        if ([string]::IsNullOrWhiteSpace($combined)) { exit 0 }
        if ($combined.Length -gt 3000) { $combined = $combined.Substring(0, 3000) + "`n... (truncated)" }
        $result = @{
            hookSpecificOutput = @{
                hookEventName     = "PostToolUse"
                additionalContext = "ESLint issues in ${filePath}:`n$combined"
            }
        }
        ($result | ConvertTo-Json -Depth 6 -Compress)
        exit 0
    }

    exit 0
}
catch {
    [Console]::Error.WriteLine("post-edit-lint hook error: $($_.Exception.Message)")
    exit 0
}
