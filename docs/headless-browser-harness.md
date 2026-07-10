# Headless Chromium in a Claude Code remote session — the proxy workaround + harness

How to screenshot / drive real parc.land pages (tier-2 cells, SSR + hydrated
client, three.js and all) from inside a Claude Code remote session, where all
outbound HTTPS passes through the **agent proxy** (a TLS-re-terminating MITM at
`$HTTPS_PROXY`, usually `http://127.0.0.1:37805`).

The harness: **`scripts/cell-shot.mjs`** (playwright is a devDependency; the
browser binary is pre-installed — do not run `playwright install`).

```bash
PARC_TOKEN=tok_… node scripts/cell-shot.mjs https://c15r-home.on.parc.land/ ./shots
# VIEWPORTS=mobile,tablet,desktop to pick; omit PARC_TOKEN for the signed-out view
```

## The failure you will hit, and the actual cause

Every HTTPS navigation fails with `net::ERR_CONNECTION_RESET` — for every host,
while `curl` through the same proxy returns 200. Certificate trust is NOT the
problem (that would be `ERR_CERT_AUTHORITY_INVALID`, and the session pre-seeds
Chromium's NSS store anyway), and `ignoreHTTPSErrors` doesn't help because the
connection dies before any certificate is seen.

Diagnosed with `--log-net-log` (2026-07-10, Chromium 141): the CONNECT tunnel
**succeeds** (`HTTP/1.1 200 Connection Established`), Chromium sends its TLS
ClientHello, and the proxy resets the socket mid-handshake (`SOCKET_READ_ERROR
net_error=-101 os_error=104` inside `SSL_CONNECT`). The hello is ~1.75 KB
because it carries an **X25519MLKEM768 post-quantum key share** (1216 bytes) —
the proxy's TLS terminator chokes on it. curl (OpenSSL, no PQ hybrid) sails
through, which is what makes the failure look browser-specific.

### The fix

Disable ML-KEM at launch. Chromium renamed the feature across versions
(`PostQuantumKyber` — the name most search results give — is dead in 141);
unknown feature names are ignored, so list every alias:

```
--disable-features=UseMLKEM,PostQuantumKeyAgreement,PostQuantumKyber,EncryptedClientHello
```

Belt-and-braces: the enterprise policy killswitch also works —
`/etc/chromium/policies/managed/pq.json` with
`{"PostQuantumKeyAgreementEnabled": false}`.

Everything else stays standard: launch with
`proxy: { server: process.env.HTTPS_PROXY }`, `--no-sandbox`,
`--disable-dev-shm-usage`, and `executablePath: '/opt/pw-browsers/chromium'`
(the pre-installed pinned build — `PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1` is set
so npm installs never fetch a second copy). Never disable TLS verification
globally and never unset `HTTPS_PROXY` (see `/root/.ccr/README.md`).

## Signing the page in

A cell page has **two** credential surfaces; seed both or you get a confusing
half-authed state:

1. **`parc_session` cookie** (host-only, on the cell's own subdomain, e.g.
   `c15r-home.on.parc.land`) — dispatch validates it on a top-level GET and
   passes `x-cell-caller`, which is what makes SSR render the **authed** face.
2. **`localStorage['parc.session.tokens']`** — where the kernel client
   (`@c15r/kernel/app.js`) reads its bearer for `/mcp` calls. Cookie alone ⇒
   authed SSR that immediately downgrades and 401s after hydration; storage
   alone ⇒ anonymous SSR flash. The harness sets the cookie via `addCookies`
   and the storage via `addInitScript`.

Mint a short-lived token for this (`auth.mintToken`, workspace read scope is
enough for screenshots) and **revoke it when done**.

## Diagnosing new browser×proxy failures

1. `curl -sS "$HTTPS_PROXY/__agentproxy/status"` — proxy state + recent relay
   failures (`not_connect` entries are Chromium's plain-HTTP telemetry being
   rejected; harmless noise).
2. Add `--log-net-log=/tmp/netlog.json --net-log-capture-mode=IncludeSensitive`
   to the launch args, reproduce, then read the events around `SSL_CONNECT` /
   `HTTP_TRANSACTION_READ_TUNNEL_RESPONSE_HEADERS`. Whether the failure is
   before the tunnel (proxy policy), at the tunnel (CONNECT rejected), or
   inside it (TLS handshake — this doc's case) localises the bug immediately.
3. Remember the proxy's documented unsupported list (WebSockets, HTTP/2-only,
   client-mTLS, non-443 ports): if the page needs one of those, stop and report
   rather than fighting it.
