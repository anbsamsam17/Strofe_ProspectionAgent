#requires -Version 5.1
# PreToolUse hook on Write|Edit: prevent any modification of .env* files.
# Defense-in-depth backup for the deny permission rules.

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

    $norm     = ($filePath -replace '\\','/').ToLowerInvariant()
    $basename = [System.IO.Path]::GetFileName($norm)

    # Match exactly .env, .env.local, .env.production, .env.development, .env.* in general
    if ($basename -match '^\.env(\.[a-z0-9_\-]+)?$') {
        $result = @{
            hookSpecificOutput = @{
                hookEventName            = "PreToolUse"
                permissionDecision       = "deny"
                permissionDecisionReason = "Refusing to write/edit $filePath. Environment files contain secrets and must be edited manually outside Claude."
            }
        }
        ($result | ConvertTo-Json -Depth 6 -Compress)
        exit 0
    }

    exit 0
}
catch {
    [Console]::Error.WriteLine("pre-write-protect-env hook error: $($_.Exception.Message)")
    exit 0
}
