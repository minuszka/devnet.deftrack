# MongoDB backup — runbook

What it solves: until 2026-09-14 **no backup of any kind** was taken of the devnet explorer's database
(`deftrack_devnet`) — measured on the VPS: no dump, no timer, no cron. The database is not a cache of the
chain. Part of it cannot be read back from any node:

- DKG rounds that did not form and have already left the `quorum listextended` window;
- the raw ZMQ observations;
- operator attributions declared through the admin API;
- the Experiments run records, which tie a binary rollout to the chain;
- the simulator's runs.

The files:

| File | What |
|---|---|
| [`ops/mongo-backup.sh`](../ops/mongo-backup.sh) | one backup: dump, verify, retain, prune (the header comment is the full contract) |
| [`ops/systemd/deftrack-mongo-backup.service`](../ops/systemd/deftrack-mongo-backup.service) | oneshot, sandboxed, may write only to the backup directory |
| [`ops/systemd/deftrack-mongo-backup.timer`](../ops/systemd/deftrack-mongo-backup.timer) | daily at 03:30 UTC, with up to 15 minutes of random delay |
| [`ops/tests/mongo-backup.sh`](../ops/tests/mongo-backup.sh) | the script's test, against a fake `mongodump`; CI runs it |

## Know this before touching anything

- **The archive is sensitive.** It holds non-public host addresses (operator attribution) and admin session
  records. The backup directory is `0700`, every file `0600`, owned by root. **No copy of it may ever enter
  the repository**, and a copy off the machine may only live somewhere private.
- **It runs as the read-only user** (`devnet_ro`, role `read` on `deftrack_devnet`). The password reaches
  `mongodump --config` from a root-readable YAML file, never the command line — there every local user could
  see it (`ps`).
- **It is not a snapshot.** A standalone mongod (no replica set) has no oplog to pin a point in time with,
  and the indexer keeps writing. Each collection is consistent in itself; collections may differ from each
  other by seconds, and the indexer reconciles that on its next tick.
- **A failed run retains nothing and deletes nothing.** Pruning runs only after a verified new archive, so
  the latest good backup is never replaced by a bad one.
- **"Success" is checked literally:** `mongodump`'s exit code, gzip stream integrity (`gzip -t`), the
  mongodump archive magic number, at least one collection, and a "done dumping" line for every collection
  started. Exit 0 alone proves nothing: with a mistyped database name `mongodump` dumps 0 collections and
  exits 0 (measured with 100.18.0).

## Installation

On the VPS, as root, from the merged `main` (`/opt/devnet-deftrack/app`, after `ops/deploy.sh`).

```bash
cd /opt/devnet-deftrack/app

# 1. The script as a root-owned copy. It does not run from the checkout: deploys update that, and a root
#    service executing a file a less privileged account can rewrite is a way to become root.
install -m 0755 -o root -g root ops/mongo-backup.sh /usr/local/sbin/deftrack-mongo-backup
cmp ops/mongo-backup.sh /usr/local/sbin/deftrack-mongo-backup && echo "installed copy matches the checkout"

# 2. The password file — without printing the password. From the RO_PW= line of /root/.devnet-mongo-creds,
#    in YAML single quotes (an embedded ' doubled).
install -d -m 0700 -o root -g root /etc/deftrack-backup
( umask 077
  pw=$(sed -n 's/^RO_PW=//p' /root/.devnet-mongo-creds)
  [ -n "$pw" ] || { echo "RO_PW not found"; exit 1; }
  printf "password: '%s'\n" "$(printf '%s' "$pw" | sed "s/'/''/g")" > /etc/deftrack-backup/mongodump.yaml )
stat -c '%a %U' /etc/deftrack-backup/mongodump.yaml          # 600 root

# 3. The backup directory. The unit's sandbox allows writes only here, and it must exist before the first start.
install -d -m 0700 -o root -g root /var/backups/deftrack-mongo

# 4. The units.
install -m 0644 ops/systemd/deftrack-mongo-backup.service ops/systemd/deftrack-mongo-backup.timer /etc/systemd/system/
systemctl daemon-reload
systemd-analyze verify /etc/systemd/system/deftrack-mongo-backup.service /etc/systemd/system/deftrack-mongo-backup.timer
```

If the `RO_PW` value in the file is itself quoted, step 2 writes the quotes into the password too. The first
run catches that (authentication failure, unit `failed`, nothing retained); check the file's format then, not
the script.

## First run and verification

```bash
systemctl start deftrack-mongo-backup.service                 # waits until the run ends
systemctl status deftrack-mongo-backup.service --no-pager      # Result=success
journalctl -u deftrack-mongo-backup.service -n 5 -o cat        # the summary line: size, collections, documents

cd /var/backups/deftrack-mongo
ls -l                                                          # every file -rw------- root
newest=$(ls deftrack_devnet-*.archive.gz | sort | tail -1)
sha256sum -c "${newest%.archive.gz}.sha256"
cat "${newest%.archive.gz}.manifest"                           # document count per collection
```

Only when that is in order, enable the timer:

```bash
systemctl enable --now deftrack-mongo-backup.timer
systemctl list-timers deftrack-mongo-backup.timer --no-pager
```

## Routine check

```bash
systemctl list-timers deftrack-mongo-backup.timer --no-pager   # last run, next run
systemctl --failed --no-legend                                 # a failed backup shows here
ls -lt /var/backups/deftrack-mongo | head                      # date of the newest archive
```

By default the latest **14** archives are kept (`DEFTRACK_BACKUP_KEEP`, overridable with `Environment=` in
the unit).

## Restore check — never against the live database

A backup nobody has restored is not a proven backup. The check runs on a throwaway instance (locally the
no-auth mongod in WSL on port 27018), **into a renamed namespace**:

```bash
# on the workstation; keep the copy outside the repository
scp devnet:/var/backups/deftrack-mongo/<archive>.archive.gz devnet:/var/backups/deftrack-mongo/<archive>.manifest <local dir>/

mongorestore --host 127.0.0.1 --port 27018 --archive=<archive>.archive.gz --gzip \
  --nsFrom='deftrack_devnet.*' --nsTo='restorecheck.*'
# per-collection document counts must match the manifest; then:
mongosh --quiet mongodb://127.0.0.1:27018/restorecheck --eval 'db.dropDatabase()'
```

The rename is not optional: `deftrack_devnet` is never a test database name, and this way the check cannot
collide with any local database.

## Real restore — only after an owner decision

It overwrites the live database, and data newer than the backup that the chain cannot supply is lost. Steps:

1. `systemctl stop deftrack-devnet` — the indexer must not write meanwhile.
2. First a check into a renamed namespace (previous section), compared against the manifest.
3. `mongorestore` as `devnet_app` (`readWrite` on `deftrack_devnet`), with `--drop` and
   `--nsInclude='deftrack_devnet.*'`, the password again from a `--config` file, not the command line.
4. `systemctl start deftrack-devnet`, then the health endpoint: the indexer backfills chain data from the node.

## Off-machine copy — open decision

A backup kept on the VPS is lost with the machine or its disk. Where a copy goes needs a decision, and it may
only be a private place. Until then, the copy pulled for the restore check is the only off-machine instance.

## Removal

```bash
systemctl disable --now deftrack-mongo-backup.timer
rm -f /etc/systemd/system/deftrack-mongo-backup.service /etc/systemd/system/deftrack-mongo-backup.timer
systemctl daemon-reload
rm -f /usr/local/sbin/deftrack-mongo-backup
# deleting the password file and existing archives is a separate decision:
#   /etc/deftrack-backup/   /var/backups/deftrack-mongo/
```
