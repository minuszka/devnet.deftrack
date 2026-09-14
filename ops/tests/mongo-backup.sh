#!/usr/bin/env bash
#
# Regression suite for ops/mongo-backup.sh against a fake mongodump.
#
# A backup that says it succeeded is the dangerous kind of broken: nobody looks
# at it again until the day it is needed. So every case here drives the REAL
# script and asserts on what it left on disk, not on what it printed:
#
#   - a good run leaves one archive, root-only, with a checksum that verifies
#     and a manifest naming every collection and its document count;
#   - the password reaches mongodump through the config file, never argv;
#   - every way a dump can be bad (non-zero exit, not gzip, a gzip stream cut
#     short, not a mongodump archive, a collection started and never finished,
#     no collections at all) keeps nothing, leaves no partial file, and deletes
#     no older archive;
#   - retention keeps the newest N of THIS database's archives and touches
#     nothing else in the directory;
#   - bad settings, an unsafe or missing credentials file and a run already in
#     progress are refused before mongodump is ever started.
#
# Negative controls are run by pointing MONGO_BACKUP_SCRIPT at a copy of the
# script with one guard removed: the suite must then fail on that guard's case.
#
# Needs bash, coreutils, gzip and util-linux (flock); never touches a database.
#
#     ops/tests/mongo-backup.sh
set -euo pipefail
IFS=$'\n\t'

HERE=$(CDPATH='' cd -- "$(dirname -- "$0")/.." && pwd)
SCRIPT=${MONGO_BACKUP_SCRIPT:-$HERE/mongo-backup.sh}
[ -f "$SCRIPT" ] || { printf 'no such script: %s\n' "$SCRIPT" >&2; exit 1; }
for tool in flock gzip od stat sha256sum; do
  command -v "$tool" >/dev/null 2>&1 || { printf '%s is required to run this suite\n' "$tool" >&2; exit 1; }
done

TMP=$(mktemp -d)
cleanup() { rm -rf -- "$TMP"; }
trap cleanup EXIT
BIN="$TMP/bin"
MOCK="$TMP/mock"
DIR="$TMP/backups"
# The script under test always starts here, never in the caller's directory: a
# broken copy that honours a relative path must not write into the repository.
WORK="$TMP/work"
mkdir -p "$BIN" "$WORK"

# ── the fake mongodump ───────────────────────────────────────────────────────
# Records its argv (one argument per line) to $MOCK_DIR/argv, writes the file
# named by --archive= and logs to stderr in mongodump's own format, reading the
# collections to report from $MOCK_DIR/collections ("name count" per line).
# $MOCK_DIR/mode picks the answer:
#   ok            a gzip stream holding the archive magic number (the default)
#   fail          writes a partial archive, then exits 1
#   nogzip        writes bytes that are not a gzip stream
#   truncated     a gzip stream that starts right (magic and all) and is cut short
#   badmagic      a gzip stream without the archive magic number
#   missing-done  the last collection is started and never reported done
#   nocollections a valid archive and no collection at all
cat > "$BIN/mongodump" <<'FAKE'
#!/usr/bin/env bash
set -u
d=${MOCK_DIR:?}
if [ "${1:-}" = "--version" ]; then echo "mongodump version: 100.18.0-fake"; exit 0; fi
printf '%s\n' "$@" > "$d/argv"
archive=""; db=""
for a in "$@"; do
  case "$a" in
    --archive=*) archive=${a#--archive=} ;;
    --db=*) db=${a#--db=} ;;
  esac
done
[ -n "$archive" ] || { echo "fake mongodump: no --archive" >&2; exit 2; }
mode=$(cat "$d/mode" 2>/dev/null || echo ok)
bt='`'
case "$mode" in
  nogzip) printf 'plain bytes, not a gzip stream' > "$archive" ;;
  truncated) { printf '\x6d\xe2\x99\x81'; head -c 200000 /dev/urandom; } | gzip -c | head -c 60000 > "$archive" ;;
  badmagic) printf 'XXXXpayload' | gzip -c > "$archive" ;;
  *) printf '\x6d\xe2\x99\x81payload' | gzip -c > "$archive" ;;
esac
if [ "$mode" != nocollections ]; then
  while read -r name count; do
    printf '2026-09-14T04:41:50.293+0200\twriting %s%s.%s%s to "archive %s%s%s"\n' "$bt" "$db" "$name" "$bt" "$bt" "$archive" "$bt" >&2
  done < "$d/collections"
  total=$(wc -l < "$d/collections"); n=0
  while read -r name count; do
    n=$((n + 1))
    if [ "$mode" = missing-done ] && [ "$n" -eq "$total" ]; then continue; fi
    printf '2026-09-14T04:41:50.302+0200\tdone dumping %s%s.%s%s (%s documents)\n' "$bt" "$db" "$name" "$bt" "$count" >&2
  done < "$d/collections"
fi
if [ "$mode" = fail ]; then echo "fake mongodump: Failed: connection refused" >&2; exit 1; fi
exit 0
FAKE
chmod +x "$BIN/mongodump"

# ── harness ──────────────────────────────────────────────────────────────────
failures=0
fail() { printf '  FAIL: %s\n' "$*"; failures=$((failures + 1)); }
# ok <message> <command...>: the command runs as it is written, no eval.
ok() {
  local message=$1
  shift
  if "$@"; then :; else fail "$message"; fi
}
not() { ! "$@"; }
matches() { [[ $1 =~ $2 ]]; }
absent() { [ ! -e "$1" ]; }

reset() {
  rm -rf -- "$DIR" "$MOCK" "$WORK"
  mkdir -p "$MOCK" "$WORK"
  printf 'blocks 500\nrounds 2\nempty_one 0\n' > "$MOCK/collections"
  echo ok > "$MOCK/mode"
}

# run [VAR=value ...] -- a clean environment each time, so nothing from the
# caller's shell can make a case pass. Later assignments override earlier ones.
run() {
  set +e
  (
    cd "$WORK" &&
      env -i PATH="$BIN:/usr/bin:/bin" HOME="$TMP" MOCK_DIR="$MOCK" MONGODUMP="$BIN/mongodump" \
        DEFTRACK_BACKUP_DIR="$DIR" DEFTRACK_BACKUP_USER="" "$@" bash "$SCRIPT" > "$TMP/out" 2> "$TMP/err"
  )
  rc=$?
  set -e
}

archives() { find "$DIR" -maxdepth 1 -type f -name 'deftrack_devnet-*.archive.gz' 2>/dev/null | wc -l; }
partials() { find "$DIR" -maxdepth 1 -name '.partial-*' 2>/dev/null | wc -l; }
called() { [ -e "$MOCK/argv" ]; }
mode_of() { stat -c %a -- "$1" 2>/dev/null || echo missing; }
sums_verify() ( cd "$DIR" && sha256sum -c --quiet "$1.sha256" >/dev/null 2>&1 )
manifest_has() { grep -qxF -- "$(printf '%s\t' "${@:2}" | sed 's/\t$//')" "$DIR/$1.manifest"; }
argv_has() { grep -qxF -- "$1" "$MOCK/argv"; }
err_says() { grep -qF -- "$1" "$TMP/err"; }

seed() { # seed <count>: older archives of this database, each with its side files
  mkdir -p "$DIR"
  local i stamp side
  for i in $(seq 1 "$1"); do
    stamp=$(printf '202608%02dT000000Z' "$i")
    printf 'old' > "$DIR/deftrack_devnet-$stamp.archive.gz"
    for side in sha256 manifest log; do printf 'side' > "$DIR/deftrack_devnet-$stamp.$side"; done
  done
}

case_() { printf '%s\n' "$1"; }

# ── cases ────────────────────────────────────────────────────────────────────
case_ 'a good run keeps one root-only archive with a checksum and a manifest'
reset; run
ok "exit status $rc, stderr: $(cat "$TMP/err")" [ "$rc" -eq 0 ]
ok "expected 1 archive, found $(archives)" [ "$(archives)" -eq 1 ]
ok "partial files left behind" [ "$(partials)" -eq 0 ]
a=$(find "$DIR" -maxdepth 1 -name 'deftrack_devnet-*.archive.gz' -printf '%f\n' 2>/dev/null | head -1 || true)
base=${a%.archive.gz}
ok "archive name '$a'" matches "$a" '^deftrack_devnet-[0-9]{8}T[0-9]{6}Z\.archive\.gz$'
ok "archive mode $(mode_of "$DIR/$a")" [ "$(mode_of "$DIR/$a")" = 600 ]
ok "directory mode $(mode_of "$DIR")" [ "$(mode_of "$DIR")" = 700 ]
ok "checksum does not verify" sums_verify "$base"
ok "manifest lacks blocks 500" manifest_has "$base" collection deftrack_devnet.blocks 500
ok "manifest lacks the empty collection" manifest_has "$base" collection deftrack_devnet.empty_one 0
ok "manifest collection count" manifest_has "$base" collections 3
ok "manifest document count" manifest_has "$base" documents 502
ok "authenticated although DEFTRACK_BACKUP_USER is empty" not grep -q -- --username "$MOCK/argv"

case_ 'the password reaches mongodump through the config file, never argv'
reset; mkdir -p "$TMP/etc"; printf 'password: sentinel-PW-42\n' > "$TMP/etc/dump.yaml"; chmod 600 "$TMP/etc/dump.yaml"
run DEFTRACK_BACKUP_USER=devnet_ro DEFTRACK_BACKUP_CONFIG="$TMP/etc/dump.yaml"
ok "exit status $rc, stderr: $(cat "$TMP/err")" [ "$rc" -eq 0 ]
ok "no --config argument" argv_has "--config=$TMP/etc/dump.yaml"
ok "no --username argument" argv_has --username=devnet_ro
ok "no --authenticationDatabase argument" argv_has --authenticationDatabase=deftrack_devnet
ok "the password appeared on the command line" not grep -q sentinel-PW-42 "$MOCK/argv"

case_ 'a credentials file others can read is refused before mongodump starts'
reset; chmod 644 "$TMP/etc/dump.yaml"
run DEFTRACK_BACKUP_USER=devnet_ro DEFTRACK_BACKUP_CONFIG="$TMP/etc/dump.yaml"
ok "exit status 0 with a world-readable credentials file" [ "$rc" -ne 0 ]
ok "mongodump was started" not called
ok "the refusal does not name the mode: $(cat "$TMP/err")" err_says "mode 644"

case_ 'a missing credentials file is refused before mongodump starts'
reset; run DEFTRACK_BACKUP_USER=devnet_ro DEFTRACK_BACKUP_CONFIG="$TMP/etc/absent.yaml"
ok "exit status 0 without a credentials file" [ "$rc" -ne 0 ]
ok "mongodump was started" not called
ok "the refusal does not say the file is missing: $(cat "$TMP/err")" err_says "credentials file not found"

case_ 'a failed dump keeps nothing, leaves no partial file and prunes nothing'
reset; seed 3; echo fail > "$MOCK/mode"; run DEFTRACK_BACKUP_KEEP=1
ok "exit status 0 after mongodump failed" [ "$rc" -ne 0 ]
ok "older archives were deleted: $(archives) left of 3" [ "$(archives)" -eq 3 ]
ok "partial files left behind" [ "$(partials)" -eq 0 ]
ok "mongodump's own error is not shown" err_says "connection refused"

for bad in nogzip truncated badmagic missing-done nocollections; do
  case_ "a dump that is $bad is not kept, and nothing older is pruned"
  reset; seed 2; echo "$bad" > "$MOCK/mode"; run DEFTRACK_BACKUP_KEEP=1
  ok "$bad: exit status 0" [ "$rc" -ne 0 ]
  ok "$bad: archive count $(archives), expected the 2 seeded" [ "$(archives)" -eq 2 ]
  ok "$bad: partial files left behind" [ "$(partials)" -eq 0 ]
done

case_ 'retention keeps the newest N of this database and touches nothing else'
reset; seed 16
printf 'other' > "$DIR/other_db-20260801T000000Z.archive.gz"
printf 'notes' > "$DIR/notes.txt"
# A hand-made copy under this database's prefix but not its naming scheme: it
# is not a retention candidate, and it must not push a real archive out.
printf 'manual' > "$DIR/deftrack_devnet-manual.archive.gz"
run DEFTRACK_BACKUP_KEEP=14
ok "exit status $rc, stderr: $(cat "$TMP/err")" [ "$rc" -eq 0 ]
ok "expected 14 archives and the manual copy, found $(archives)" [ "$(archives)" -eq 15 ]
ok "the hand-made copy was deleted" [ -e "$DIR/deftrack_devnet-manual.archive.gz" ]
for gone in 01 02 03; do
  for ext in archive.gz sha256 manifest log; do
    ok "the oldest archive's $ext survived (08-$gone)" absent "$DIR/deftrack_devnet-202608${gone}T000000Z.$ext"
  done
done
ok "the fourth oldest archive was deleted" [ -e "$DIR/deftrack_devnet-20260804T000000Z.archive.gz" ]
ok "another database's archive was deleted" [ -e "$DIR/other_db-20260801T000000Z.archive.gz" ]
ok "an unrelated file was deleted" [ -e "$DIR/notes.txt" ]

case_ 'a run while another holds the lock is refused before mongodump starts'
reset; mkdir -p "$DIR"
exec 8>"$DIR/.lock"
flock -n 8
run
exec 8>&-
ok "exit status 0 while the lock was held" [ "$rc" -ne 0 ]
ok "mongodump was started" not called

for keep in 0 abc -3; do
  case_ "DEFTRACK_BACKUP_KEEP=$keep is refused before mongodump starts"
  reset; run DEFTRACK_BACKUP_KEEP="$keep"
  ok "keep=$keep: exit status 0" [ "$rc" -ne 0 ]
  ok "keep=$keep: mongodump was started" not called
done

case_ 'a relative backup directory is refused before anything is created'
reset; run DEFTRACK_BACKUP_DIR=relative/backups
ok "exit status 0 with a relative directory" [ "$rc" -ne 0 ]
ok "mongodump was started" not called
ok "a relative directory was created" absent "$WORK/relative"

if [ "$failures" -ne 0 ]; then
  printf '%d check(s) failed\n' "$failures"
  exit 1
fi
printf 'all checks passed\n'
