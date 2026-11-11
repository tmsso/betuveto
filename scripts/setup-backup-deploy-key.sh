#!/usr/bin/env bash
# One-time (and key-rotation) setup for .github/workflows/backup.yml — run by the project
# owner, by hand:  bash scripts/setup-backup-deploy-key.sh
#
# What it does, and nothing else:
#   1. generates a fresh SSH key pair in a temporary directory;
#   2. adds the PUBLIC half to the private repository tmsso/betuveto-backups as a deploy key
#      with write access (a deploy key works for that one repository only);
#   3. stores the PRIVATE half as the Actions secret BACKUP_REPO_DEPLOY_KEY on
#      tmsso/betuveto, so the weekly backup workflow can push there;
#   4. deletes both halves from this machine. The private key is never printed.
#
# Re-running it rotates the key: remove the old deploy key afterwards under
# tmsso/betuveto-backups > Settings > Deploy keys.
set -euo pipefail

BACKUPS_REPO="tmsso/betuveto-backups"
APP_REPO="tmsso/betuveto"

gh repo view "$BACKUPS_REPO" --json isPrivate --jq .isPrivate | grep -qx true \
  || { echo "Refusing: $BACKUPS_REPO does not exist or is not private." >&2; exit 1; }

tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT

ssh-keygen -q -t ed25519 -N "" -C "betuveto backup workflow $(date -u +%F)" -f "$tmp/id"
gh repo deploy-key add "$tmp/id.pub" --allow-write \
  --title "betuveto backup workflow $(date -u +%F)" -R "$BACKUPS_REPO"
gh secret set BACKUP_REPO_DEPLOY_KEY -R "$APP_REPO" < "$tmp/id"

echo "Done. Test it:  gh workflow run backup.yml -R $APP_REPO"
