#!/usr/bin/env bash
# Optional advisory PostToolUse hook for the technical-language skill.
# Lints the prose file that was just written/edited and, if the slop score is high,
# feeds a short advisory back to the model. It NEVER blocks: always exits 0.
#
# Wire it up (optional) in ~/.claude/settings.json — see README.md.
#
# Tune the threshold: per-100-word slop score above which to warn.
THRESHOLD="${TECHLANG_MAX_PER100W:-8}"

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
lint="$here/../techlang-lint.py"

# PostToolUse passes a JSON payload on stdin; pull the edited file path out of it.
payload="$(cat)"
file="$(printf '%s' "$payload" | jq -r '.tool_input.file_path // empty' 2>/dev/null)"

# Only look at prose files, and only when the lint script and file exist.
case "$file" in
  *.md|*.markdown|*.txt) ;;
  *) exit 0 ;;
esac
[ -f "$file" ] && [ -f "$lint" ] || exit 0

if ! python3 "$lint" --max "$THRESHOLD" "$file" >/dev/null 2>&1; then
  score="$(python3 "$lint" < "$file" 2>/dev/null | jq -r '.total_per100w // "?"')"
  msg="technical-language: $file has a high slop score (per100w=$score, limit=$THRESHOLD). Consider a self-lint pass (see the technical-language skill)."
  # Advisory only — feed context back to the model, do not block.
  printf '{"hookSpecificOutput":{"hookEventName":"PostToolUse","additionalContext":%s}}\n' \
    "$(printf '%s' "$msg" | jq -R -s .)"
fi
exit 0
