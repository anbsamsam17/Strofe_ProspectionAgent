#requires -Version 5.1
# Stop hook: writes a short reminder to stderr (visible to the user, not injected
# into the agent context). Never blocks.

try {
    [Console]::OutputEncoding = [System.Text.Encoding]::UTF8

    # Drain stdin to avoid pipe issues
    $null = [Console]::In.ReadToEnd()

    [Console]::Error.WriteLine("")
    [Console]::Error.WriteLine("[reminder] Commit your changes when ready, and update memory/ or CLAUDE.md if an architectural decision was made.")
    [Console]::Error.WriteLine("")

    exit 0
}
catch {
    [Console]::Error.WriteLine("stop-summary hook error: $($_.Exception.Message)")
    exit 0
}
