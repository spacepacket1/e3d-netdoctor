# Prompt: bring netdoctor.e3d.ai live

You're Claude Code running with shell access on the production server behind
`cast.e3d.ai` and `e3d.ai`. Everything you need is below — no other context
from the session that wrote this is available to you.

## Context

`e3d-netdoctor` (github.com/spacepacket1/e3d-netdoctor) is a CLI network
diagnostic tool. Two things were just built and committed, but nothing is
deployed yet:

1. **`e3d-netdoctor` commit `479d6bd`, on `main`** (this repo's real trunk —
   there's no separate `master`) — a `--card` payment flag on `paid-report`
   (pay by Stripe card instead of crypto wallet), plus a static
   marketing/checkout site at `site/index.html` meant to be served at
   `https://netdoctor.e3d.ai`, with matching nginx config at
   `deploy/nginx/netdoctor.e3d.ai.conf`.
2. **`spacepacket` commit `6a3a6c5`, on `master`** (that repo's real trunk —
   `main` there is an unrelated, unused stub, don't confuse the two) —
   enables Stripe for `netdoctor`. This is smaller and lower-risk than it
   might sound: the Stripe-generalization *mechanism* (registry-driven,
   per-product `stripe` block) already shipped to `master` independently, in
   an earlier, unrelated piece of work
   (`docs/stripe-payments-generalization-spec.md`), which deliberately
   deferred adding netdoctor's own packs. This commit is just that deferred
   piece: a new `server/netdoctorStripePacks.js` (three packs) plus a
   `stripe: {...}` block on netdoctor's entry in `server/productRegistry.js`.
   **No changes to `stripePayments.js`, `productPaymentsRoutes.js`, or the
   webhook handler** — the shared checkout/fulfillment code path Cast already
   runs through in production is untouched.

DNS for `e3d.ai` is managed in **Cloudflare**. Keep that in mind for Step 1 —
don't go looking for Route53 or anything else.

The goal: get `https://netdoctor.e3d.ai` live, serving the static site, with
its "buy credits" button working end to end against the (already-updated)
shared payments backend.

## Step 0 — reconnaissance before changing anything

Don't assume the repo's `ops/` and `ecosystem.config.js` files describe what's
actually running. `spacepacket`'s repo has drift: `ops/aws/ecs/taskdef-api-
server.json` describes an ECS Fargate deployment on port **3001**, but
`cast.e3d.ai`'s nginx config proxies to `http://127.0.0.1:**3000**` — a local
process, not a Fargate task. That strongly suggests production today is a
**plain Node process on the same box as nginx** (via PM2, systemd, or a
manual `node spacepacket.js`), and the ECS task def is either aspirational or
for a different environment. Confirm which is actually true before deploying
anything — check `pm2 list` / `systemctl status` / `ps aux | grep
spacepacket.js`, and only trust what you find actually running.

Also confirm, on this box:
- Where `cast.e3d.ai`'s nginx config actually lives (`/etc/nginx/sites-
  available/` + `sites-enabled/` symlink is the most common pattern).
- How that TLS cert was obtained — `certbot certificates`, or check
  `/etc/letsencrypt/renewal/*.conf` — so you mirror the exact same method for
  the new domain (webroot vs. `--nginx` vs. a Cloudflare DNS-01 plugin).
- Whether the `cast.e3d.ai` DNS record in Cloudflare is **proxied** (orange
  cloud) or **DNS-only** (grey cloud), and what SSL/TLS mode the Cloudflare
  zone is set to (Flexible / Full / Full-strict). Check via the Cloudflare
  dashboard or, if a `CLOUDFLARE_API_TOKEN`/`CF_API_TOKEN` is already set
  somewhere on this box (env, a deploy script, `wrangler` config), via the
  API instead. Whatever cast.e3d.ai is set to, netdoctor.e3d.ai needs the
  same settings, or Stripe redirects and the payments API calls from the
  site will break in confusing ways.

Report what you find before proceeding, in case any assumption below is
wrong.

## Step 1 — DNS (Cloudflare)

Add an A record (and AAAA if the target has IPv6) for `netdoctor` in the
`e3d.ai` Cloudflare zone, pointing at the same IP `cast.e3d.ai` resolves to,
with the **same proxy status** (orange/grey) you found for `cast.e3d.ai` in
Step 0. Use the Cloudflare API if a token is available; otherwise the
dashboard. Confirm propagation with `dig netdoctor.e3d.ai` (add `+trace` if
it's not resolving and you need to see where it's stuck) before moving on.

This is a shared, externally-visible change — if you're not fully sure this
is the right IP or the right zone, stop and confirm with a human rather than
guessing.

**If the record ends up proxied (orange cloud):** ACME HTTP-01 challenges
(webroot method) still work through Cloudflare's proxy by default since it
passes through `/.well-known/acme-challenge/` — but if that fails, switch to
DNS-01 via a Cloudflare certbot plugin instead of unproxying the record.

## Step 2 — get the site files onto the box

Get `e3d-netdoctor`'s `site/` directory onto the server at the path
`deploy/nginx/netdoctor.e3d.ai.conf` expects as its nginx `root`
(`/var/www/netdoctor.e3d.ai` by default — feel free to change the conf's
`root` line to wherever it's actually easiest to deploy, matching however
`cast.e3d.ai`'s static assets get onto the box: if Cast deploys via
`git pull` + a build step, do the equivalent here — `git clone`/`git pull`
`e3d-netdoctor`, then point `root` at `<checkout>/site`).

## Step 3 — nginx

1. Copy `e3d-netdoctor/deploy/nginx/netdoctor.e3d.ai.conf` into the same
   location `cast.e3d.ai.conf` lives (mirror the sites-available/enabled
   pattern from Step 0).
2. Get the TLS cert **before** enabling the HTTPS server block — match
   whatever method Step 0 found for `cast.e3d.ai` (`certbot certonly
   --webroot -w /var/www/certbot -d netdoctor.e3d.ai`, matching the
   ACME-challenge path already in the conf, or `certbot --nginx -d
   netdoctor.e3d.ai`, or a Cloudflare DNS-01 plugin if that's what's already
   in use).
3. `nginx -t` — do not reload nginx unless this passes clean.
4. Reload: `systemctl reload nginx` (or the equivalent for how nginx runs on
   this box).

## Step 4 — verify the site alone, before touching payments

Visit `https://netdoctor.e3d.ai`. Confirm TLS is valid and the page renders.
At this point the "buy credits" buttons will still fail (the backend hasn't
been redeployed yet) — that's expected, continue to Step 5.

## Step 5 — deploy the backend change

`spacepacket` commit `6a3a6c5` is on `master` (already the branch that should
get deployed — no merge/rebase needed). It's an additive data change (a new
`netdoctorStripePacks.js` file plus a `stripe` block on netdoctor's registry
entry) — it does not touch `stripePayments.js`, `productPaymentsRoutes.js`,
or the webhook handler, so Cast's checkout/fulfillment code path is
unmodified. Still the same running process Cast's live payments go through,
so:

1. Run the test suite for the touched files first: `node
   server/productRegistry.test.js`, `node server/stripePayments.test.js`,
   `node server/productPaymentsRoutes.test.js` — all should pass (they did in
   dev; re-verify with dependencies as installed on the box).
2. Deploy using whatever mechanism Step 0 confirmed is real (git pull +
   process restart, or an ECS deploy, or something else). Keep the current
   running commit hash written down so you can redeploy it immediately if
   something breaks.
3. Restart the process. Brief interruption to whatever's currently serving
   `cast.e3d.ai` payment traffic, same as any deploy to this process — no
   different from Cast's own routine deploys.
4. Smoke-test Cast is still fine immediately after: `curl -s
   https://cast.e3d.ai/api/payments/stripe/packs` should return the existing
   cast packs unchanged.

**No new Stripe dashboard configuration should be needed.** The webhook
endpoint (`checkout.session.completed` → `/api/payments/stripe/webhook`)
already registered for Cast is product-generic — it reads `product` from the
Checkout session's metadata, which the (already-shipped, product-aware)
checkout-creation code sets correctly. Optional: set
`NETDOCTOR_STRIPE_SUCCESS_URL` / `NETDOCTOR_STRIPE_CANCEL_URL` env vars if
you want to override the built-in default redirect
(`https://netdoctor.e3d.ai/...`) — not required to launch, and deliberately a
*different* env var name than Cast's `STRIPE_SUCCESS_URL`/`STRIPE_CANCEL_URL`
so setting one product's redirect can never leak into the other's.

## Step 6 — end-to-end verification

1. `curl -s https://netdoctor.e3d.ai/api/payments/stripe/packs?product=netdoctor`
   — should list the `single`/`five`/`twenty` packs.
2. On `netdoctor.e3d.ai`, click a pack button (use Stripe test-mode/test card
   first if the account supports it) and confirm: redirect to Stripe →
   payment → redirect back to `netdoctor.e3d.ai?stripe_session_id=...` → page
   polls and displays a credit key.
3. From a dev machine with the credit key: run `e3d-netdoctor report
   ./fixtures/retransmission-handshake.pcap --format markdown` to confirm the
   tool itself still works (unaffected by any of this), then optionally
   `paid-report --card` end to end against prod.
4. Check the Stripe dashboard's webhook delivery log for the event and
   confirm it shows a successful `200` from `/api/payments/stripe/webhook`.

## Known open items (not blocking launch, flag to the human)

- No Terms/Privacy/Refund pages exist for netdoctor (Cast has `/terms.html`,
  `/privacy.html`, `/refund.html` on `cast.e3d.ai`). Stripe may want links to
  these from the checkout flow — decide whether to point at Cast's for now or
  write netdoctor-specific ones, don't fabricate legal text yourself.
- Pack pricing ($5 / $20 / $70 for single/five/twenty reports) is a first
  guess from `server/netdoctorStripePacks.js` — trivial to change, not final.
