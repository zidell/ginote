#!/usr/bin/env bash

set -euo pipefail

if [[ $# -ne 0 ]]; then
  echo "Usage: ./release.sh" >&2
  exit 1
fi

if ! command -v gh >/dev/null 2>&1; then
  echo "GitHub CLI (gh) is required." >&2
  exit 1
fi

repo_root="$(git rev-parse --show-toplevel)"
cd "$repo_root"

if [[ "$(git branch --show-current)" != "main" ]]; then
  echo "Releases must be created from the main branch." >&2
  exit 1
fi

git fetch origin main
git pull --ff-only origin main

if [[ -n "$(git status --porcelain)" ]]; then
  echo "Commit and push changes before releasing." >&2
  exit 1
fi

if [[ "$(git rev-parse HEAD)" != "$(git rev-parse origin/main)" ]]; then
  echo "Push local commits before releasing." >&2
  exit 1
fi

release_sha="$(git rev-parse HEAD)"
workflow_file="release.yml"

gh workflow run "$workflow_file" --ref main

run_id=""
for ((attempt = 0; attempt < 30; attempt++)); do
  run_id="$(
    gh run list \
      --workflow "$workflow_file" \
      --branch main \
      --event workflow_dispatch \
      --limit 10 \
      --json databaseId,headSha \
      --jq ".[] | select(.headSha == \"$release_sha\") | .databaseId" \
      | head -n 1
  )"
  [[ -n "$run_id" ]] && break
  sleep 2
done

if [[ -z "$run_id" ]]; then
  echo "Unable to find the dispatched release workflow run." >&2
  exit 1
fi

gh run watch "$run_id" --exit-status
git pull --ff-only origin main
