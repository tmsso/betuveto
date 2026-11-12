#!/usr/bin/env bash
# Check that the newest encrypted backup decrypts with the owner's private key.
#
# The weekly workflow (.github/workflows/backup.yml) already restore-tests every dump
# BEFORE encrypting it, but CI never holds the private key, so it cannot prove the
# encrypted file is readable. This script closes that gap, on the owner's machine:
#   1. downloads the newest backups/betuveto-<date>.dump.gpg from tmsso/betuveto-backups,
#   2. decrypts it in a throwaway GnuPG home (the key is never imported into ~/.gnupg),
#   3. checks the result starts with "PGDMP" (pg_dump's custom-format signature) and
#      reports its size.
# The decrypted database is only streamed through a pipe, never written to disk.
#
# Usage: scripts/check-backup-decrypt.sh [path/to/private-key.asc]
# Default key path: ~/.config/betuveto-backup/betuveto-backup-private-key.asc
# Needs: gh (signed in with access to tmsso/betuveto-backups), gpg.
set -euo pipefail

key="${1:-$HOME/.config/betuveto-backup/betuveto-backup-private-key.asc}"
repo="tmsso/betuveto-backups"

if [ ! -r "$key" ]; then
  echo "Private key not found at: $key" >&2
  echo "Pass its path as the first argument (e.g. exported from your password manager)." >&2
  exit 1
fi

work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
export GNUPGHOME="$work/gnupg"
install -d -m 700 "$GNUPGHOME"

latest=$(gh api "repos/$repo/contents/backups" --jq '[.[].name] | sort | last')
if [ -z "$latest" ] || [ "$latest" = "null" ]; then
  echo "No backups found in $repo." >&2
  exit 1
fi
echo "Newest backup: $latest"
gh api -H "Accept: application/vnd.github.raw" "repos/$repo/contents/backups/$latest" \
  > "$work/backup.dump.gpg"
echo "Encrypted size: $(wc -c < "$work/backup.dump.gpg") bytes"

gpg --batch --quiet --import "$key"
# head closes the pipe after 5 bytes, so gpg may exit with SIGPIPE: ignore its status
# here and judge by the bytes; the full pass below checks gpg's status properly.
signature=$(set +o pipefail; gpg --batch --quiet --decrypt "$work/backup.dump.gpg" 2>/dev/null | head -c 5)
if [ "$signature" != "PGDMP" ]; then
  echo "FAIL: decrypted data does not start with PGDMP (got: '$signature')." >&2
  exit 1
fi
size=$(gpg --batch --quiet --decrypt "$work/backup.dump.gpg" | wc -c)
echo "OK: $latest decrypts with this key; pg_dump archive of $size bytes."
