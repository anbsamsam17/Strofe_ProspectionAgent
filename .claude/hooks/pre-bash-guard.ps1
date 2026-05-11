#requires -Version 5.1
# PreToolUse hook on Bash: blocks commands that leak hardcoded secrets
# or attempt to write into .env* files.

try {
    [Console]::OutputEncoding = [System.Text.Encoding]::UTF8

    $raw = [Console]::In.ReadToEnd()
    if ([string]::IsNullOrWhiteSpace($raw)) { exit 0 }

    $payload = $raw | ConvertFrom-Json -ErrorAction Stop

    $command = $null
    if ($payload.PSObject.Properties.Name -contains 'tool_input' -and $payload.tool_input) {
        if ($payload.tool_input.PSObject.Properties.Name -contains 'command') {
            $command = [string]$payload.tool_input.command
        }
    }
    if ([string]::IsNullOrWhiteSpace($command)) { exit 0 }

    # Secret literal patterns
    $secretPatterns = @(
        'sk-proj-[A-Za-z0-9_\-]{10,}',           # OpenAI project keys
        'sk-ant-[A-Za-z0-9_\-]{10,}',            # Anthropic keys
        'sk-[A-Za-z0-9]{20,}',                   # generic OpenAI-style
        're_[A-Za-z0-9_\-]{10,}',                # Resend
        'sntrys_[A-Za-z0-9_\-=]{10,}',           # Sentry user auth tokens
        'sntryu_[A-Za-z0-9]{10,}',               # Sentry alt
        'eyJhbG[A-Za-z0-9_\-\.]{20,}',           # JWT (Supabase service role, etc.)
        'service_role[\s]*[:=][\s]*[''"][^''"]{20,}',
        'SUPABASE_SERVICE_ROLE_KEY[\s]*=[\s]*[A-Za-z0-9]'
    )

    foreach ($pattern in $secretPatterns) {
        if ($command -match $pattern) {
            $result = @{
                hookSpecificOutput = @{
                    hookEventName            = "PreToolUse"
                    permissionDecision       = "deny"
                    permissionDecisionReason = "Secret literal detected in command (pattern: $pattern). Use env vars from .env.local instead of inlining secrets."
                }
            }
            ($result | ConvertTo-Json -Depth 6 -Compress)
            exit 0
        }
    }

    # Block writes into .env* via shell redirection / cp / mv / Set-Content / Out-File / tee
    $envWritePatterns = @(
        '>\s*\.?[\\/]?\.env(\.[A-Za-z0-9_\-]+)?(\s|$)',
        '>>\s*\.?[\\/]?\.env(\.[A-Za-z0-9_\-]+)?(\s|$)',
        '(Set-Content|Out-File|Add-Content|tee)\s+[^\|]*\.env(\.[A-Za-z0-9_\-]+)?(\s|$|[''"])',
        '\b(cp|copy|mv|move|rename)\b[^\|]*\.env(\.[A-Za-z0-9_\-]+)?(\s|$|[''"])',
        '\becho\b.+>\s*\.?[\\/]?\.env'
    )

    foreach ($pattern in $envWritePatterns) {
        if ($command -match $pattern) {
            $result = @{
                hookSpecificOutput = @{
                    hookEventName            = "PreToolUse"
                    permissionDecision       = "deny"
                    permissionDecisionReason = "Refusing to write to a .env* file via Bash. Edit .env.local manually outside Claude."
                }
            }
            ($result | ConvertTo-Json -Depth 6 -Compress)
            exit 0
        }
    }

    exit 0
}
catch {
    [Console]::Error.WriteLine("pre-bash-guard hook error: $($_.Exception.Message)")
    exit 0
}
