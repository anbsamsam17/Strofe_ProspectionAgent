#requires -Version 5.1
# UserPromptSubmit hook: injects a tiny project reminder at the top of every prompt.
# Non-blocking, kept minimal to preserve context budget.

try {
    [Console]::OutputEncoding = [System.Text.Encoding]::UTF8

    # Drain stdin (payload not needed but must be consumed)
    $null = [Console]::In.ReadToEnd()

    Write-Output "Project: Agent BEGES (prospection) - Next.js 15 + Supabase + Google Gemini (gemini-2.0-flash)."
    Write-Output "Stack scripts: npm run dev | build | lint | type-check | test (vitest)."
    Write-Output "Always consult CLAUDE.md and .claude/MEMORY.md (if present) before architectural decisions."
    Write-Output "Secrets live in .env.local - never read, log, or commit them."

    exit 0
}
catch {
    [Console]::Error.WriteLine("user-prompt-context hook error: $($_.Exception.Message)")
    exit 0
}
