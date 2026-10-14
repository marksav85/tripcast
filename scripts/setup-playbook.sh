#!/usr/bin/env bash
set -euo pipefail
project_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
# Use the project's recorded Gitlink; never --remote or an upstream branch tip.
git -C "$project_root" submodule sync -- playbook
git -C "$project_root" submodule update --init --recursive -- playbook
git -C "$project_root/playbook" sparse-checkout init --cone
git -C "$project_root/playbook" sparse-checkout set \
  docs/templates/0-ai \
  docs/templates/0-project-management \
  docs/templates/1-pre-development \
  docs/templates/2-development \
  docs/templates/3-post-development
git -C "$project_root/playbook" rev-parse HEAD
