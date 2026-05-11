#requires -Version 5.1
# PostToolUse hook: typecheck after Edit/Write on .ts/.tsx files.
# Blocks the tool call if `npm run type-check` fails.

try {
    [Console]::OutputEncoding = [System.Text.Encoding]::UTF8

    $raw = [Console]::In.ReadToEnd()
    if ([string]::IsNullOrWhiteSpace($raw)) { exit 0 }

    $payload = $raw | ConvertFrom-Json -ErrorAction Stop

    # Resolve target file from tool_input
    $filePath = $null
    if ($payload.PSObject.Properties.Name -contains 'tool_input' -and $payload.tool_input) {
        if ($payload.tool_input.PSObject.Properties.Name -contains 'file_path') {
            $filePath = [string]$payload.tool_input.file_path
        }
    }
    if ([string]::IsNullOrWhiteSpace($filePath)) { exit 0 }

    # Filter: only .ts / .tsx, and skip generated/dep folders
    $lower = $filePath.ToLowerInvariant() -replace '\\','/'
    if (-not ($lower -match '\.tsx?$')) { exit 0 }
    if ($lower -match '/(\.next|node_modules|dist|coverage)/') { exit 0 }

    # Resolve project dir
    $projectDir = $env:CLAUDE_PROJECT_DIR
    if ([string]::IsNullOrWhiteSpace($projectDir)) {
        $projectDir = (Get-Location).Path
    }

    # Launch type-check with a 30s timeout
    $psi = New-Object System.Diagnostics.ProcessStartInfo
    $psi.FileName = "cmd.exe"
    $psi.Arguments = "/c npm run type-check"
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

    if (-not $proc.WaitForExit(30000)) {
        try { $proc.Kill() } catch {}
        [Console]::Error.WriteLine("post-edit-typecheck: tsc exceeded 30s, skipped")
        exit 0
    }

    $stdout = $stdoutTask.Result
    $stderr = $stderrTask.Result
    $exitCode = $proc.ExitCode

    if ($exitCode -ne 0) {
        $combined = ($stdout + "`n" + $stderr).Trim()
        if ($combined.Length -gt 4000) { $combined = $combined.Substring(0, 4000) + "`n... (truncated)" }
        $result = @{
            decision = "block"
            reason   = "TypeScript check failed for changes touching $filePath. Fix the errors before continuing.`n$combined"
        }
        ($result | ConvertTo-Json -Depth 5 -Compress)
        exit 0
    }

    exit 0
}
catch {
    [Console]::Error.WriteLine("post-edit-typecheck hook error: $($_.Exception.Message)")
    exit 0
}
