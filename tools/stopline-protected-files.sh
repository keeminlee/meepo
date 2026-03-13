#!/usr/bin/env bash
set -euo pipefail

mode="${1:-staged}"

if [[ "${MEEPO_BREAKGLASS:-}" == "I_UNDERSTAND_PROD_RISK" ]]; then
  echo "WARN: protected-file stopline bypassed via MEEPO_BREAKGLASS"
  exit 0
fi

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd "$script_dir/.." && pwd)"
cd "$repo_root"

patterns_file="$script_dir/protected-paths.txt"
if [[ ! -f "$patterns_file" ]]; then
  echo "Missing protected paths file: $patterns_file" >&2
  exit 1
fi

mapfile -t patterns < <(grep -vE '^\s*(#|$)' "$patterns_file" | sed 's/\r$//')

if [[ "${#patterns[@]}" -eq 0 ]]; then
  echo "PASS: no protected patterns configured"
  exit 0
fi

case "$mode" in
  staged)
    diff_cmd=(git diff --cached --name-only --diff-filter=ACMR)
    ;;
  working)
    diff_cmd=(git diff --name-only --diff-filter=ACMR)
    ;;
  head)
    diff_cmd=(git diff-tree --no-commit-id --name-only -r HEAD)
    ;;
  *)
    echo "Invalid mode: $mode (expected: staged|working|head)" >&2
    exit 2
    ;;
esac

mapfile -t changed_files < <("${diff_cmd[@]}" | sed '/^\s*$/d')

if [[ "${#changed_files[@]}" -eq 0 ]]; then
  echo "PASS: no changed files for mode '$mode'"
  exit 0
fi

violations=()
for file in "${changed_files[@]}"; do
  for pattern in "${patterns[@]}"; do
    if [[ "$file" == $pattern ]]; then
      violations+=("$file (matched $pattern)")
      break
    fi
  done
done

if [[ "${#violations[@]}" -gt 0 ]]; then
  echo "STOPLINE: protected file edits detected:"
  printf '%s\n' "${violations[@]}" | sort -u | sed 's/^/- /'
  echo
  echo "If this is a production break-glass change, rerun with:"
  echo "MEEPO_BREAKGLASS=I_UNDERSTAND_PROD_RISK"
  exit 1
fi

echo "PASS: no protected file edits detected"
