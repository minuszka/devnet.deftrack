# nginx security headers — installation runbook

What it solves: the HTML response carried no CSP and no HSTS. helmet already sends both on the API, but that
is **not the same thing**: neither reaches the document nginx serves, and a reader who never calls `/api/`
never receives them.

The files: [`ops/nginx/`](../ops/nginx/). The **full production vhost is not in the repository** and will not
be — it lives on the server, and this runbook describes how the snippet fits into it, not how to overwrite it.

## Know this before touching anything

nginx `add_header` directives **do not accumulate**. If a `location` declares even a single `add_header` of
its own, it **drops every inherited** `add_header` from the `server` block — silently, without a warning, and
`nginx -t` still succeeds.

The production vhost used to handle that by repeating the same four headers in **three places**. That is
correct — and it is exactly the structure in which a fifth header lands in two of them and not the third.

Hence the snippet: **one file is the whole set**, and every location with any header of its own **includes**
it and then adds its own.

Every header is `always`: without it nginx does not attach it to error responses (4xx/5xx). A 404 on this site
is a page like any other.

## Installation

```bash
# 1. The snippets into place. Start with report-only.
scp ops/nginx/security-headers.conf  devnet:/etc/nginx/snippets/deftrack-security-headers.conf
scp ops/nginx/csp-report-only.conf   devnet:/etc/nginx/snippets/deftrack-csp.conf

# 2. A dated backup of the live vhost.
ssh devnet 'cp /etc/nginx/sites-available/devnet.deftrack \
               /etc/nginx/sites-available/devnet.deftrack.bak-$(date +%F-%H%M)'
```

Then, in the vhost, **the four existing `add_header` lines are replaced** by two `include`s, in the `server`
block **and** in every location that has headers of its own (`= /index.html`, `/assets/`):

```nginx
    include /etc/nginx/snippets/deftrack-security-headers.conf;
    include /etc/nginx/snippets/deftrack-csp.conf;
```

The location-specific `add_header Cache-Control ...` lines **stay**, after the `include`.

```bash
# 3. Syntax, then reload. -t is not optional.
ssh devnet 'nginx -t && systemctl reload nginx'
```

## Verification

**An isolated test that touches nothing live** (own prefix, 127.0.0.1:8099, no systemctl):

```bash
npm run build
ops/nginx/verify-headers.sh client/dist
```

It measures `/`, `/rounds`, `/admin`, a content-hashed asset and a **404**, and fails at the first missing
header. It is the only thing that catches the `add_header` inheritance trap — `nginx -t` does not.

**CSP survivability on the real build:**

```bash
npm run test:csp -w client
```

It puts the policy **read from** `ops/nginx/csp-enforce.conf` on the document in a real browser and collects
`securitypolicyviolation` events. It uses the **enforce** variant, not report-only: under report-only "no
violation" and "the policy has no effect" look the same. It also has a control that injects an inline script
and requires the browser to refuse it.

**Live check after installation:**

```bash
for p in / /rounds /admin /assets/index-*.js /no-such-page; do
  curl -sS -D - -o /dev/null "https://devnet.deftrack.xyz$p" \
    | grep -iE 'HTTP/|content-security-policy|strict-transport|x-frame|x-content-type|x-robots|referrer-policy|cache-control'
done
```

## Report-only → enforce

Only when the report-only round was clean **on the build that is deployed**:

```bash
scp ops/nginx/csp-enforce.conf devnet:/etc/nginx/snippets/deftrack-csp.conf
ssh devnet 'nginx -t && systemctl reload nginx'
```

The two policies are **identical to the character**, so promotion is a single file swap. `verify-headers.sh`
checks separately that they have not drifted apart — if someone edits only one, it fails.

## Rollback

```bash
ssh devnet 'cp /etc/nginx/sites-available/devnet.deftrack.bak-<date> \
               /etc/nginx/sites-available/devnet.deftrack && \
            nginx -t && systemctl reload nginx'
```

`reload` does not drop existing connections; the old worker finishes what it started. If only the CSP is the
problem, putting the snippet back to report-only and reloading is enough — the vhost need not be touched.

## Deliberately left out

- **No HSTS `preload`.** Preload is a practically one-way enrolment into a list built into browsers, and it
  covers the **whole** registrable domain — and `deftrack.xyz` serves more than this devnet. It is not within
  this work's remit, and not something to acquire as a side effect.
- **No CSP `report-uri` / `report-to`.** There is no collector on this deployment, and a report address
  pointing at a non-existent host produces console noise that looks like an error. Report-only shows every
  violation in the console and in the `securitypolicyviolation` event without a collector — the verification
  works from that.
- **`style-src 'unsafe-inline'` is in, and a measurement says why.** See the comment in
  `csp-report-only.conf`: it is needed for the 31 counted `style=` attributes, not for Lit. The narrower
  `style-src-attr` form would suffice **here**, but fails silently on older browsers; the real tightening
  belongs in the client, not the header.
