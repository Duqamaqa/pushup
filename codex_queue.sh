#!/usr/bin/env bash
#
# codex_queue.sh — send multi-line prompts to Codex CLI in sequence.
# Split blocks by lines that start with "=== PROMPT".
# Usage: ./codex_queue.sh
# Optional env:
#   PROMPTS_FILE=prompts.txt
#   CODEX_CMD=codex
#   CODEX_ARGS="--model gpt-4.1-mini"   (or any extra flags)
#   DELIM_REGEX="^=== PROMPT"           (change if you use a different marker)

set -euo pipefail

PROMPTS_FILE="${PROMPTS_FILE:-prompts.txt}"
CODEX_CMD="${CODEX_CMD:-codex}"
CODEX_ARGS="${CODEX_ARGS:-}"
DELIM_REGEX="${DELIM_REGEX:-^=== PROMPT}"

if [[ ! -f "$PROMPTS_FILE" ]]; then
  echo "Error: $PROMPTS_FILE not found in $(pwd)." >&2
  exit 1
fi

# Use awk to collect blocks separated by delimiter lines, outputting each block NUL-terminated.
# Delimiter lines themselves are NOT included in the prompt body.
# Any text before the first delimiter is treated as one block.
read_blocks() {
  awk -v delim="$DELIM_REGEX" '
    function flush() {
      if (length(buf) > 0) {
        printf "%s%c", buf, 0   # NUL-terminate each block
        buf = ""
      }
    }
    $0 ~ delim { flush(); next }  # new block starts; do not include delim line
    { buf = buf $0 ORS }          # accumulate lines into current block
    END { flush() }               # emit final block
  ' "$PROMPTS_FILE"
}

i=0
# Read NUL-terminated blocks from awk
while IFS= read -r -d '' block; do
  # Trim whitespace-only blocks (just in case)
  if [[ -z "${block//[$'\t\r\n ']/}" ]]; then
    continue
  fi
  ((i++))
  # Show a short preview (first non-empty line, truncated)
  preview="$(printf '%s' "$block" | sed -e '/^[[:space:]]*$/d' -e '1q' -e 's/[[:space:]]\+$//' | cut -c1-80)"
  echo "[$i] Sending prompt block: ${preview}..."

  if [[ -n "$CODEX_ARGS" ]]; then
    # shellcheck disable=SC2086
    $CODEX_CMD ${CODEX_ARGS} "$block"
  else
    $CODEX_CMD -- "$block"
  fi

  sleep 2
done < <(read_blocks)

echo "Done. Sent $i prompt block(s)."
