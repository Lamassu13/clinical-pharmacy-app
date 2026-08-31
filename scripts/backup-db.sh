#!/usr/bin/env bash
# Take a compressed logical backup of the production database.
#
#   npm run db:backup
#
# The dump lands OUTSIDE the repository on purpose: it contains every user's name,
# phone, email and bcrypt password hash, plus patient names. This repo is public, and
# a dump has been committed to it by accident once before.
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if [ -z "${DATABASE_URL:-}" ] && [ -f "$repo_root/.env" ]; then
  set -a
  # shellcheck disable=SC1091
  . "$repo_root/.env"
  set +a
fi

if [ -z "${DATABASE_URL:-}" ]; then
  echo "DATABASE_URL is not set, and no .env file provided one." >&2
  echo "Copy the connection string from the Render dashboard, then run:" >&2
  echo "  DATABASE_URL='postgresql://...' npm run db:backup" >&2
  exit 1
fi

backup_dir="${CPA_BACKUP_DIR:-$HOME/cpa-backups}"
mkdir -p "$backup_dir"
target="$backup_dir/cpa-$(date +%Y%m%d-%H%M%S).dump"

pg_dump_bin="${PG_DUMP:-pg_dump}"
if ! command -v "$pg_dump_bin" >/dev/null 2>&1; then
  echo "pg_dump not found: $pg_dump_bin" >&2
  echo "Install it (brew install postgresql@18) or point PG_DUMP at the binary." >&2
  exit 1
fi

echo "Dumping to $target"
# pg_dump refuses to read a server newer than itself. The Homebrew default on this
# machine is older than the production server, so name the newer binary explicitly.
if ! "$pg_dump_bin" -Fc --no-owner --no-privileges "$DATABASE_URL" -f "$target"; then
  rm -f "$target"
  echo >&2
  echo "Backup failed. If the error mentions a server version mismatch, run:" >&2
  echo "  PG_DUMP=/opt/homebrew/opt/postgresql@18/bin/pg_dump npm run db:backup" >&2
  exit 1
fi

size="$(du -h "$target" | cut -f1)"
echo "Backup complete: $target ($size)"
echo
echo "This file holds patient names and password hashes. Keep it off the repo, off"
echo "shared drives, and out of chat. Restore with:"
echo "  pg_restore --clean --if-exists --no-owner -d \"\$DATABASE_URL\" '$target'"
