#!/usr/bin/env bash
#
# Nightly MongoDB backup of the devnet explorer's database.
#
# WHY. The explorer's database is not a cache of the chain, and part of it can
# never be read back from any node: DKG rounds that did not form and have left
# the window `quorum listextended` still reports, the raw ZMQ observations, the
# operator attributions declared through the admin API, the Experiments run
# records that tie a binary rollout to the chain, and the simulator's runs.
# Until 2026-09-14 nothing copied it anywhere (measured on the VPS: no dump, no
# timer, no cron entry).
#
# WHAT ONE RUN DOES, in this order, and why the order matters:
#   1. refuses bad settings, an unsafe credentials file, and a second run while
#      one is in progress -- before mongodump is started at all;
#   2. dumps one database with `mongodump --archive --gzip` as a read-only user.
#      The password comes from a root-only YAML file through --config, never
#      from the command line, where `ps` shows it to every local user;
#   3. checks what was written: mongodump's exit status, a gzip stream that
#      tests intact, the mongodump archive magic number inside it, at least one
#      collection, and a "done dumping" line for every collection mongodump said
#      it was writing. Exit 0 alone proves nothing -- a wrong database name
#      dumps zero collections and still exits 0;
#   4. only then moves the archive into place beside a .sha256 and a manifest
#      of every collection and its document count;
#   5. only after all of that, prunes to the newest $KEEP archives of this
#      database, and nothing else in the directory.
# A run that fails at any step keeps nothing, leaves no partial file, and
# deletes no older archive: the last good backup is never traded for a bad one.
#
# NOT A POINT-IN-TIME SNAPSHOT. A standalone mongod has no oplog to pin one
# with, and the indexer keeps writing while the dump runs. Each collection is
# consistent as of the moment it was read; a restore can hold a quorum round a
# few seconds newer than the last block beside it. The indexer reconciles that
# on its next tick, and the block index rewinds on its own.
#
# THE ARCHIVE IS SENSITIVE. It carries non-public host addresses (operator
# attribution) and admin session records. It stays root-only (0600 files in a
# 0700 directory), every copy of it -- off-host included -- must be private, and
# it never goes anywhere near this public repository.
#
# Usage (as root, normally from deftrack-mongo-backup.service):
#     deftrack-mongo-backup
#
# Environment, defaults in brackets:
#   DEFTRACK_BACKUP_DIR     [/var/backups/deftrack-mongo]
#   DEFTRACK_BACKUP_KEEP    [14]   archives of this database to keep, at least 1
#   DEFTRACK_BACKUP_DB      [deftrack_devnet]
#   DEFTRACK_BACKUP_HOST    [127.0.0.1]
#   DEFTRACK_BACKUP_PORT    [27017]
#   DEFTRACK_BACKUP_USER    [devnet_ro]  set it empty for an instance without
#                                        authentication (a local test mongod)
#   DEFTRACK_BACKUP_AUTHDB  [deftrack_devnet]
#   DEFTRACK_BACKUP_CONFIG  [/etc/deftrack-backup/mongodump.yaml]
#                           one line, `password: <the read-only user's password>`,
#                           owned by root, mode 0600 or 0400
#   MONGODUMP               [mongodump]
set -euo pipefail
IFS=$'\n\t'
umask 077

DIR=${DEFTRACK_BACKUP_DIR:-/var/backups/deftrack-mongo}
KEEP=${DEFTRACK_BACKUP_KEEP:-14}
DB=${DEFTRACK_BACKUP_DB:-deftrack_devnet}
HOST=${DEFTRACK_BACKUP_HOST:-127.0.0.1}
PORT=${DEFTRACK_BACKUP_PORT:-27017}
# Unset means the default user; set-but-empty means no authentication at all.
USER_NAME=${DEFTRACK_BACKUP_USER-devnet_ro}
AUTHDB=${DEFTRACK_BACKUP_AUTHDB:-deftrack_devnet}
CONFIG=${DEFTRACK_BACKUP_CONFIG:-/etc/deftrack-backup/mongodump.yaml}
MONGODUMP=${MONGODUMP:-mongodump}

# The archive magic number mongodump writes at the start of an archive
# (0x8199e26d, little-endian). Read back from a real 100.18.0 archive before
# this line was written, not taken on trust.
ARCHIVE_MAGIC=6de29981

die() {
  printf 'deftrack-mongo-backup: %s\n' "$*" >&2
  exit 1
}

# ── 1. refuse before touching anything ───────────────────────────────────────
case "$KEEP" in
  '' | *[!0-9]*) die "DEFTRACK_BACKUP_KEEP must be a whole number, got '$KEEP'" ;;
esac
# Keeping none would delete the archive this very run has just written.
[ "$KEEP" -ge 1 ] || die "DEFTRACK_BACKUP_KEEP must be at least 1, got $KEEP"
case "$DIR" in
  /*) ;;
  *) die "DEFTRACK_BACKUP_DIR must be an absolute path, got '$DIR'" ;;
esac
case "$DB" in
  '' | *[!A-Za-z0-9_-]*) die "DEFTRACK_BACKUP_DB is not a plain database name: '$DB'" ;;
esac
command -v "$MONGODUMP" >/dev/null 2>&1 || die "mongodump not found: $MONGODUMP"

auth=()
if [ -n "$USER_NAME" ]; then
  [ -f "$CONFIG" ] || die "credentials file not found: $CONFIG"
  # A password file anybody else can read has already leaked. Carrying on would
  # make that normal; refusing makes somebody look.
  mode=$(stat -c '%a' -- "$CONFIG")
  case "$mode" in
    600 | 400) ;;
    *) die "credentials file $CONFIG has mode $mode; it must be 0600 or 0400" ;;
  esac
  auth=(--username="$USER_NAME" --authenticationDatabase="$AUTHDB" --config="$CONFIG")
fi

mkdir -p -- "$DIR"
chmod 0700 -- "$DIR"

# One run at a time. A dump that outlives its timer interval must not race a
# second one over the same retention list.
exec 9>"$DIR/.lock"
flock -n 9 || die "another backup is still running (lock held on $DIR/.lock)"

stamp=$(date -u +%Y%m%dT%H%M%SZ)
name="$DB-$stamp"
partial="$DIR/.partial-$name.archive.gz"
partial_log="$DIR/.partial-$name.log"
partial_sum="$DIR/.partial-$name.sha256"
partial_manifest="$DIR/.partial-$name.manifest"
# Whatever happens from here, no half-written file outlives the run. On success
# every one of these has been renamed away and the removal is a no-op.
discard() { rm -f -- "$partial" "$partial_log" "$partial_sum" "$partial_manifest"; }
trap discard EXIT

# ── 2. dump ──────────────────────────────────────────────────────────────────
started=$(date +%s)
if ! "$MONGODUMP" --host="$HOST" --port="$PORT" --db="$DB" "${auth[@]}" \
  --archive="$partial" --gzip 2>"$partial_log"; then
  tail -n 20 -- "$partial_log" >&2 || true
  die "mongodump failed; nothing was kept and nothing was pruned"
fi
seconds=$(($(date +%s) - started))

# ── 3. check what was written ────────────────────────────────────────────────
[ -s "$partial" ] || die "mongodump exited 0 but wrote an empty archive"
gzip -t -- "$partial" 2>/dev/null || die "the archive is not an intact gzip stream"
# pipefail off inside this substitution only: `head` closing the pipe early is
# how it is meant to end, not an error.
magic=$(
  set +o pipefail
  gzip -dc -- "$partial" 2>/dev/null | head -c 4 | od -An -tx1 | tr -d ' \n'
)
[ "$magic" = "$ARCHIVE_MAGIC" ] || die "the gzip stream does not hold a mongodump archive (magic '$magic')"

# mongodump logs `writing \`db.coll\`` when it starts a collection and
# `done dumping \`db.coll\` (N documents)` when it finishes one.
mapfile -t started_ns < <(awk -F'`' '/writing `/ { print $2 }' "$partial_log" | sort -u)
mapfile -t finished < <(awk -F'`' '/done dumping `/ { n = $3; gsub(/[^0-9]/, "", n); print $2 "\t" n }' "$partial_log" | sort -u)
[ "${#started_ns[@]}" -gt 0 ] || die "mongodump reported no collection in '$DB': a wrong database name, or a user that cannot see it"
for ns in "${started_ns[@]}"; do
  found=0
  for line in "${finished[@]}"; do
    [ "${line%%$'\t'*}" = "$ns" ] && found=1 && break
  done
  [ "$found" -eq 1 ] || die "mongodump started $ns and never reported it done"
done

# ── 4. keep ──────────────────────────────────────────────────────────────────
bytes=$(stat -c '%s' -- "$partial")
documents=0
for line in "${finished[@]}"; do
  count=${line##*$'\t'}
  documents=$((documents + ${count:-0}))
done
{
  printf 'database\t%s\n' "$DB"
  printf 'created_utc\t%s\n' "$stamp"
  printf 'mongodump\t%s\n' "$("$MONGODUMP" --version 2>/dev/null | head -n 1)"
  printf 'seconds\t%s\n' "$seconds"
  printf 'bytes\t%s\n' "$bytes"
  printf 'collections\t%s\n' "${#finished[@]}"
  printf 'documents\t%s\n' "$documents"
  for line in "${finished[@]}"; do printf 'collection\t%s\n' "$line"; done
} >"$partial_manifest"
printf '%s  %s\n' "$(sha256sum -- "$partial" | cut -d' ' -f1)" "$name.archive.gz" >"$partial_sum"

# The archive last among the checks' outputs and first into place: from this
# rename on, a complete archive exists under its final name.
mv -- "$partial" "$DIR/$name.archive.gz"
mv -- "$partial_sum" "$DIR/$name.sha256"
mv -- "$partial_manifest" "$DIR/$name.manifest"
mv -- "$partial_log" "$DIR/$name.log"

# ── 5. prune ─────────────────────────────────────────────────────────────────
# Names sort by time because the stamp is ISO-8601 basic UTC. Only files that
# are exactly this database's archives are candidates; anything else in the
# directory is left alone.
mapfile -t kept < <(
  find "$DIR" -maxdepth 1 -type f -name "$DB-*.archive.gz" -printf '%f\n' \
    | grep -E "^${DB}-[0-9]{8}T[0-9]{6}Z[.]archive[.]gz\$" | sort -r
)
pruned=0
for ((i = KEEP; i < ${#kept[@]}; i++)); do
  old=${kept[$i]%.archive.gz}
  rm -f -- "$DIR/$old.archive.gz" "$DIR/$old.sha256" "$DIR/$old.manifest" "$DIR/$old.log"
  pruned=$((pruned + 1))
done

printf 'deftrack-mongo-backup: %s.archive.gz, %s bytes, %s collections, %s documents, %ss; %s kept, %s pruned\n' \
  "$name" "$bytes" "${#finished[@]}" "$documents" "$seconds" "$(( ${#kept[@]} - pruned ))" "$pruned"
