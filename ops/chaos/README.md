# DeFCoN chaos wrapper (day 12)

This is a package for a future, approved one-host pilot. It is not installed by
`ops/deploy.sh`, is not part of the explorer VPS deployment, and the explorer
does not receive SSH credentials.

The root-owned `defcon-chaos` wrapper accepts logical target and job IDs only.
It reads the matching systemd unit, interface and P2P port from a root-owned
`targets.conf`; it never sources that file. A command first persists a recovery
record and then calls `systemctl` or `tc`. The 15-second systemd timer clears
expired records even if the caller disappears.

`marker <target> <job-id> <expiry>` only writes such a record; it never calls
`systemctl` or `tc`. It exists for the day-13 pilot to prove the installed
recovery timer retires a real record without interrupting a node.

`tc` is deliberately conservative: a network fault runs only when the observed
root qdisc matches the target's closed baseline declaration (`fq_codel`,
`pfifo_fast`, or `noqueue`), and clear restores that baseline. It refuses an
unknown traffic policy rather than overwriting it.

The separately run `defcon-chaos-ssh` transport needs a private inventory and
uses `BatchMode=yes`, password authentication disabled, strict host-key
checking, a fixed wrapper path and `sudo -n`. It is a jump-host component, not
an explorer API integration.

The installed sudoers entry delegates only to this wrapper with `NOSETENV`; its
argument matcher is necessarily broad enough to carry a target/job ID, but the
wrapper applies the closed lexical and configuration validation above before it
can invoke any privileged program. The repository includes the non-installable
[`defcon-chaos.sudoers.example`](defcon-chaos.sudoers.example) as an audit aid;
`install.sh` writes the same rule for its validated operator name.

## Package commands

```bash
# Static syntax, ShellCheck and fake-systemd regression suite.
bash ops/chaos/verify.sh

# Stage only; this does not contact systemd or a VPS.
bash ops/chaos/install.sh --targets ops/chaos/targets.conf.example \
  --operator chaosops --root /tmp/defcon-chaos-stage
```

Real installation is intentionally deferred to the separately approved day-13
pilot, with a host-specific, private targets file and an agreed test window.
