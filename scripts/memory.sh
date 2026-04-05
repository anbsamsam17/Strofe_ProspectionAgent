#!/usr/bin/env bash
# memory.sh — Chargeur de contexte pour Agent IA - Prospection Bilan Carbone
# =====================================================
# Concatène tous les fichiers mémoire et les copie dans le presse-papiers
# ou les affiche dans stdout pour injection dans Claude CLI.
#
# Usage :
#   bash scripts/memory.sh                → copie le contexte dans le presse-papiers
#   bash scripts/memory.sh --print        → affiche dans stdout
#   bash scripts/memory.sh --file         → écrit dans /tmp/context.txt
#   claude "$(bash scripts/memory.sh --print) Mon prompt ici"

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

FILES=(
    "$PROJECT_ROOT/memory/project-context.md"
    "$PROJECT_ROOT/memory/primer.md"
    "$PROJECT_ROOT/memory/session-context.md"
    "$PROJECT_ROOT/memory/hindsight.md"
)

SEPARATOR=\
"\n---\n"

# ── assemble context ──────────────────────────────
CONTEXT=""
for f in "${FILES[@]}"; do
    if [ -f "$f" ]; then
        CONTEXT+="$(cat "$f")"
        CONTEXT+="$SEPARATOR"
    fi
done

# ── output mode ──────────────────────────────────
case "${1:-}" in
    --print)
        echo "$CONTEXT"
        ;;
    --file)
        OUT="/tmp/agent-ia---prospection-bilan-carbone-context.txt"
        echo "$CONTEXT" > "$OUT"
        echo "✅ Contexte écrit dans : $OUT"
        ;;
    *)
        # Copier dans le presse-papiers (Mac: pbcopy, Linux: xclip/xsel)
        if command -v pbcopy &>/dev/null; then
            echo "$CONTEXT" | pbcopy
            echo "✅ Contexte copié dans le presse-papiers ($(echo "$CONTEXT" | wc -c) chars)"
        elif command -v xclip &>/dev/null; then
            echo "$CONTEXT" | xclip -selection clipboard
            echo "✅ Contexte copié (xclip)"
        elif command -v xsel &>/dev/null; then
            echo "$CONTEXT" | xsel --clipboard --input
            echo "✅ Contexte copié (xsel)"
        else
            echo "$CONTEXT"
            echo "⚠️  Pas de presse-papiers détecté — affiché dans stdout"
        fi
        ;;
esac
