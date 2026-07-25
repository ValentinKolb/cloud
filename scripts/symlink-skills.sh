#!/usr/bin/env bash
# Symlink this repo's skills into the agent skill directories.
#
# Symlinks rather than copies on purpose: edits under skills/ are visible to
# every agent immediately, with no reinstall step. Note that `bunx skills add`
# installs a *copy* and would shadow these links with a frozen snapshot.
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SOURCE_DIR="$ROOT_DIR/skills"

# Codex and other agents read ~/.agents/skills; Claude reads ~/.claude/skills.
TARGET_DIRS=(
  "${AGENTS_HOME:-$HOME/.agents}/skills"
  "${CLAUDE_HOME:-$HOME/.claude}/skills"
)

for target_dir in "${TARGET_DIRS[@]}"; do
  mkdir -p "$target_dir"

  for skill_dir in "$SOURCE_DIR"/*; do
    [ -d "$skill_dir" ] || continue

    skill_name="$(basename "$skill_dir")"
    target_path="$target_dir/$skill_name"
    action="linked"

    if [ -L "$target_path" ]; then
      rm -f "$target_path"
      action="relinked"
    elif [ -e "$target_path" ]; then
      # A real directory here is an installed copy; the symlink supersedes it.
      rm -rf "$target_path"
      action="replaced copy"
    fi

    ln -s "$skill_dir" "$target_path"
    echo "  $action  $target_path"
  done
done

echo "done — ${#TARGET_DIRS[@]} directories"
