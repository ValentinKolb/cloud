#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SOURCE_DIR="$ROOT_DIR/skills"
TARGET_BASE="${CODEX_HOME:-$HOME/.codex}"
TARGET_DIR="$TARGET_BASE/skills"

mkdir -p "$TARGET_DIR"

for skill_dir in "$SOURCE_DIR"/*; do
  [ -d "$skill_dir" ] || continue

  skill_name="$(basename "$skill_dir")"
  target_path="$TARGET_DIR/$skill_name"

  if [ -L "$target_path" ] || [ -e "$target_path" ]; then
    rm -rf "$target_path"
  fi

  ln -s "$skill_dir" "$target_path"
  echo "linked $skill_name"
done

echo "skills linked to $TARGET_DIR"
