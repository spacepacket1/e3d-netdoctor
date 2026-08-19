---
selected: candidate-1
reason: Highest combined attraction+retention (9), directly amplifies the agent-first positioning already central to the product, and no competing tool in the space has done it.
---

# Candidates

## Dedup Context

## Current Findings

```text
---
head_sha: f8f66d75efb46d83534726aae40ac72d20792a92
---

# Findings

## Local State

Repo head sha: f8f66d75efb46d83534726aae40ac72d20792a92

Research topics: network diagnostics CLI

Analogy domains to consider: game progression and reward loops; social feed and notification mechanics; marketplace liquidity and two-sided matching; developer-tool CLI ergonomics; fintech trust and verification UX

## Git history
range: last 20 commits
```text
f8f66d7 Add --redact and mint: publish reports as NFTs without local network identity
1667aed Make wallet payment method selectable (default E3D on Ethereum); add OpenAI narrative support
a6586ec Clarify README: E3D wallet payment benefits, agent-first positioning
4f3435b Never return an Inconclusive verdict; add an opt-in --speed-test
7e77e59 Update README for the redesigned report command
85cbc39 Redesign report command: JSON default, markdown/html formats, file/email sinks
ff1a292 Fix Claude narrative generation: stale model, bad params, and truncation
0bc61c0 Add wallet-based payment for paid-report: credits and one-off modes
6c84134 Add README
deda4eb Implement e3d-netdoctor v1: capture, verdict scoring, report, delivery, payment gate
```

## Branches
```text
* main                f8f66d7 Add --redact and mint: publish reports as NFTs without local network identity
  remotes/origin/HEAD -> origin/main
  remotes/origin/main f8f66d7 Add --redact and mint: publish reports as NFTs without local network identity
```

## GH issues and PRs
### gh issue list
- none found
### gh pr list
- none found

## Repo docs
### README.md
```text
# e3d-netdoctor

**Point it at your network. Get told why it's slow.**

A one-shot, no-UI CLI that captures live traffic and figures out whether your
slowdown is your ISP, your own device, or one flaky destination — with its
reasoning shown, not a black-box score. It's just as useful run by hand as it
is scripted into automation, and it's built especially well for agents: the
default output is the same structured JSON an agent already reasons over, no
prose to re-parse and no UI to drive.

No dashboard. No account. No continuous monitoring. Run it, get an answer, move on.

```
$ e3d-netdoctor paid-report --interface en0 --duration 30

Only analyze traffic on networks you are authorized to monitor.
Requesting e3d payment before capture/analysis...
{
  "requestId": "netdoctor:...",
  "payment": { "product": "netdoctor", "creditsSpent": 500, "creditsRemaining": 1500 },
  "findings": {
    "verdict": {
      "headline": "Likely upstream/ISP",
      "confidence": "High",
      "rationale": "7 of 8 independent destinations affected, spanning 3 different providers"
    }
  },
  "narrative": { "..." : "..." }
}
```

## Why this exists

Every network engineer and Wireshark user has had this conversation:

> "Is it my wifi, or is it Comcast again?"

That question is answerable from a single packet capture — *if* you know to group
retransmissions and RTT outliers by destination **and** by local device, and weigh
provider diversity instead of raw destination count. Most people don't do that math
by hand. netdoctor does, every time, and shows its work.

## Humans, automation, and agents — but agents especially

- **Humans** get a one-shot answer without learning Wireshark: run `report`, read a
  plain-English verdict with its reasoning, done. `--format markdown`/`html` and
  `--to` make it easy to read in a terminal, a browser, or an inbox.
- **Automation/CI** gets deterministic exit codes, no interactive prompts, and a
  non-interactive payment path (a pre-provisioned e3d credit key) — safe to run
  unattended on a schedule or in a pipeline.
- **Agents get the most out of it**, because the whole tool is shaped like a single
  tool call: one command, one JSON result. The default `report` output is
  `{ findings, narrative }` — the same structured shape an agent already reasons
  over, not prose it has to re-parse. The verdict is deterministic and rule-based
  (not another LLM call an agent has to trust blindly), the rationale is
  machine-readable text an agent can quote directly back to a user, and there's no
  UI, login, or browser interaction required for the core flow — only the optional
  wallet payment path below touches a browser, and only because that step
  inherently requires a human to approve a transaction.

## What it actually does

1. **Captures** a short live packet trace (`tshark`), or takes a `.pcap` you already have.
2. **Extends** the parse with TCP-health signals `e3d-pcap`'s core parser doesn't
   collect on its own: retransmissions, duplicate ACKs, out-of-order, zero-window
   stalls, per-flow RTT (SYN→SYN-ACK), and DNS response timing.
3. **Corroborates** with host-level checks that don't depend on the capture at all —
   real `ping` and `traceroute` to the destinations the capture flagged, and `netstat`
   for local NIC error/collision counters and TCP-stack retransmit stats.
4. **Scores a verdict** — deterministic, rule-based, unit-tested — into one of three
   categories:

   | Verdict | Means |
   |---|---|
   | **Likely Upstream/ISP** | Signal spread across many unrelated destinations and providers — not one device |
   | **Likely Local** | Signal concentrated on one local device (MAC) across many destinations — bad wifi, flaky NIC, bad cabling |
   | **Likely Destination/Path-Specific** | Signal confined to one or two destinations while everything else is clean |

   Confidence is always shown as reasoning ("7 of 8 destinations, 3 providers"),
   never a bare number. netdoctor always commits to one of these three — it never
   answers "inconclusive." With thin data it still picks the closest match and says
   so plainly in the rationale ("only 2 of the required 3 distinct destinations were
   observed"), rather than declining to call it.
5. **Writes the report** — an executive summary and per-section narrative from
   Claude, grounded strictly in the structured findings (never raw packets), with a
   deterministic fallback if no API key is configured.
6. **Delivers it** by email, with an optional PDF attachment.
7. **Gates it** behind an e3d pay-per-report payment — fails closed, no free runs,
   clear message on how to pay if it's missing. Pay with a pre-provisioned credit
   key (for automation), or with an E3D Token (wE3D) wallet directly (for a human
   with no e3d account) — see [Paying for a report](#paying-for-a-report) below.

## Paying for a report

`paid-report` runs the same capture → verdict → report pipeline above, gated
behind one payment of **500 e3d credits (0.5 E3D or wE3D at the current unit
price, depending on payment method)**. Like `report`, it defaults to printing
JSON to stdout — here that's the payment receipt plus `findings`/`narrative` —
with `--format`/`--output`/`--to` working exactly the same way; email is opt-in
via `--to`, not automatic. There are two ways to pay, aimed at two different
users:

- **A pre-provisioned credit key** (`NETDOCTOR_PAYMENT_CREDIT_KEY`) — for
  automation, CI, or anyone who already has an e3d account funded ahead of time.
  Non-interactive: no browser, no prompts, safe to run unattended on a schedule.
- **`--wallet <address>`** — for a human who wants to pay for a report directly
  with E3D Token, with no e3d account or pre-funded credit key at all:

  ```bash
  e3d-netdoctor paid-report --interface en0 --wallet 0xYourAddress
  ```

  netdoctor prints a one-time URL; open it, connect MetaMask, and approve a single
  token transfer. netdoctor polls in the background and picks up automatically
  once the payment is confirmed — nothing to copy/paste back into the terminal.

  The benefit over the credit-key path isn't just convenience: **your wallet's
  private key never touches netdoctor or any e3d server.** The browser talks
  directly to your wallet and only ever reports a transaction hash back — never a
  secret. netdoctor never sees, asks for, or stores a private key, and you never
  manually handle a tx hash or credit key either; the whole exchange happens over
  a short-lived, single-use payment session it polls for you.

  `--payment-method` picks which chain/token to pay with:
  - **`ethereum`** (default) — pay with **E3D** on Ethereum mainnet.
  - **`base`** — pay with **wE3D** on Base; usually lower gas fees.

  ```bash
  e3d-netdoctor paid-report --interface en0 --wallet 0xYourAddress --payment-method base
  ```

  Two spending modes (independent of which chain you pick):
  - **One-off** (`--wallet <address>`, no `--credits`): pay for exactly this one
    report. Nothing is saved locally — the next `paid-report` starts a fresh
    payment.
  - **Batch** (`--wallet <address> --credits n`): buy a reusable batch of `n`
    credits once; the resulting credit key is saved to
    `~/.config/e3d-netdoctor/config.json` (keyed by wallet address) and reused
    automatically by future `paid-report --wallet` runs until it runs low —
    fewer wallet approvals if you run reports regularly.

See [`docs/payment-gate.md`](docs/payment-gate.md) for the credit-key flow's
configuration and failure-mode details.

## Quickstart

```bash
npm install                      # only local dependency: e3d-pcap
e3d-netdoctor preflight           # confirms tshark is installed
e3d-netdoctor smoke ./fixtures/sample-syn.pcap
e3d-netdoctor report ./fixtures/retransmission-handshake.pcap
```

`report` defaults to printing `{ findings, narrative }` as JSON to stdout —
built for agents to consume directly, no parsing of prose required. Ask for
markdown or HTML instead, write to a file, or email it:

```bash
e3d-netdoctor report ./fixtures/retransmission-handshake.pcap                          # JSON to stdout (default)
e3d-netdoctor report ./fixtures/retransmission-handshake.pcap --format markdown        # markdown to stdout
e3d-netdoctor report ./fixtures/retransmission-handshake.pcap --format html            # HTML to stdout
e3d-netdoctor report ./fixtures/retransmission-handshake.pcap --format html --output out.html
e3d-netdoctor report ./fixtures/retransmission-handshake.pcap --to you@example.com --pdf
```

When `--output` and/or `--to` are used, `report` prints a small JSON summary
(verdict, confidence, output path, delivery info) instead of the raw content.

Add `--speed-test` to also run a real download/upload throughput measurement
(against a public Cloudflare speed-test endpoint) and fold the Mbps numbers
into the System Diagnostics section. It's opt-in — off by default — since it
uses real bandwidth and adds several seconds to the run:

```bash
e3d-netdoctor report ./fixtures/retransmission-handshake.pcap --speed-test
```

Add `--redact` before sharing or publishing a report: it replaces your local
IPs/MACs with stable pseudonyms (`local-device-1`, `local-device-2`, ...) and
strips the local capture file path, while leaving external destination IPs and
ISP traceroute hostnames real — that's the verifiable evidence the report
exists to show, only your own network's identity is hidden. This is also the
precondition for `mint` (below) — nothing gets published or tokenized with
your home network's real IPs/MACs in it.

```bash
e3d-netdoctor report ./fixtures/retransmission-handshake.pcap --redact --output report.json
```

## Minting a report as an NFT

`mint` tokenizes an already-`--redact`ed report as an NFT via `E3DNFTManager`
(the same shared contract used across E3D products — no netdoctor-specific
contract). It requires the saved report file to have `redacted: true` (refuses
otherwise) and `--confirm-public`, since minting pins the report to IPFS
**permanently and publicly**:

```bash
e3d-netdoctor mint report.json --wallet 0xYourAddress --confirm-public
```

netdoctor renders an HTML certificate (from the saved findings/narrative) and
a PNG screenshot of it, uploads both plus the structured findings to IPFS via
e3d.ai, then prints a one-time `https://e3d.ai/mint?session=...` URL — open
it, connect MetaMask, and approve the mint (same no-custodial-keys model as
`--wallet` payments: your wallet signs directly, netdoctor and e3d.ai never
see or touch it). Minting always happens on **Ethereum mainnet** regardless of
which `--payment-method` was used to pay for the report itself, and costs
**100 E3D + gas** — a separate cost from the 500 credits spent generating the
report. Once confirmed, netdoctor prints `{tokenId, txHash, etherscanUrl}`.

Full command list:

```
preflight                                  Check whether tshark is installed locally.
smoke <file.pcap>                          Parse a capture, print rows/diagnostics.
capture [iface] [seconds]                  Run a live tshark capture (default 30s).
report <pcap> [--format json|markdown|html] [--output file] [--to email] [--pdf] [--no-system-diagnostics] [--speed-test] [--redact]
                                            Defaults to JSON on stdout; --format selects markdown/html;
                                            --output writes to a file; --to emails it (--pdf attaches a PDF).
deliver <pcap> <to> [--pdf] [--no-system-diagnostics] [--speed-test]
paid-report [--pcap file | --interface iface] [--duration s] [--format json|markdown|html]
            [--output file] [--to email] [--pdf] [--request-id id] [--speed-test] [--redact]
            [--wallet address [--credits n] [--payment-method ethereum|base]]
                                            Same defaults/flags as report, gated behind a 500-credit
                                            payment (credit key or --wallet).
mint <report.json> --wallet address --confirm-public [--name "..."] [--description "..."]
                                            Tokenize a --redact'd report as an NFT (E3DNFTManager,
                                            Ethereum mainnet). 100 E3D + gas, paid from --wallet.
```

Every capture/analysis entrypoint prints a reminder up front:
**only analyze traffic on networks you are authorized to monitor.**

## No external dependencies to install

Everything beyond parsing (which reuses `e3d-pcap`'s tested core) is built on
Node's standard library and the system tools you already have:

- **Email** — a small SMTP client on `node:net`/`node:tls` (STARTTLS + AUTH LOGIN).
  No `nodemailer`.
- **PDF export** — shells out to a locally installed Chrome/Chromium/Edge with
  `--headless --print-to-pdf`, the same way netdoctor already shells out to
  `tshark`. No `puppeteer`, no bundled Chromium download.
- **Payment client** — a small, self-contained e3d payments client, not a runtime
  dependency on another repo.

`npm install` has nothing left to resolve beyond the one intentional local
dependency (`e3d-pcap`), and nothing to silently fail on a machine without
internet access.

## Configuration

| Purpose | Env vars |
|---|---|
| Narrative generation | `ANTHROPIC_API_KEY` (preferred if set) or `OPENAI_API_KEY` (used if Anthropic's isn't set); falls back to a deterministic template if neither is configured. Optional `NETDOCTOR_ANTHROPIC_MODEL`/`NETDOCTOR_OPENAI_MODEL` to override the default model. |
| Email delivery | `NETDOCTOR_SMTP_HOST`, `NETDOCTOR_SMTP_PORT`, `NETDOCTOR_SMTP_SECURE`, `NETDOCTOR_SMTP_USER`, `NETDOCTOR_SMTP_PASSWORD` |
| PDF export | `NETDOCTOR_BROWSER_PATH` (auto-detected otherwise) |
| Payment gate | `NETDOCTOR_PAYMENT_CREDIT_KEY`, `NETDOCTOR_PAYMENT_SERVICE_KEY`, `E3D_BASE_URL` — see [`docs/payment-gate.md`](docs/payment-gate.md) |

## Testing

```bash
node --test
```

Every external boundary — `tshark`, `ping`/`traceroute`/`netstat`, SMTP, PDF
rendering, the payment API — is exercised through dependency injection so the suite
runs offline and fast, plus a real local-socket SMTP conversation and real fixture
`.pcap` parses so the important paths are proven end-to-end, not just mocked.

```

## TODO/FIXME matches
- none found

## External Context

## External Context

- **AI-assisted network diagnostics** is nascent but growing: tools like Kentik, Catchpoint, and ThousandEyes apply ML to fleet-level telemetry, but single-host, one-shot CLI analysis with LLM narrative generation (grounded in deterministic verdicts) has no established OSS precedent.
- **Agent-tool design patterns** are converging on structured JSON output, deterministic exit codes, and no interactive prompts as the baseline contract — e3d-netdoctor's default `{ findings, narrative }` shape aligns with emerging MCP/tool-call conventions where agents consume typed results rather than prose.
- **Pay-per-invocation CLI tools** (vs. SaaS subscriptions) are rare; the closest analogs are AI inference APIs. Embedding on-chain payment directly into a CLI binary — no account, no dashboard — is novel and ahead of mainstream adoption.
- **NFT-as-provenance** for technical reports (vs. art/collectibles) is largely unexplored. Pinning a redacted packet-analysis certificate to IPFS as a verifiable, timestamped artifact has real use in dispute resolution (ISP complaints, SLAs), but no established UX pattern to borrow from yet.
- **tshark/libpcap-based diagnostics** remain the dominant substrate; no newer cross-platform alternative has displaced them for programmatic packet capture at the CLI layer.

---

### Analogous Patterns

**1. Fintech trust and verification UX**
- *Source domain:* Non-custodial crypto wallets and fintech "verify, don't transfer" flows (hardware wallet signing, WalletConnect)
- *Mechanic borrowed:* Splitting the approval surface — the service never touches the secret; only a transaction hash crosses the boundary
- *Application:* The `--wallet` payment and `mint` flows already apply this correctly. The pattern could extend to **report signing**: let the wallet sign a hash of the findings JSON, producing a verifiable attestation that the report came from a specific address — useful for ISP dispute letters or SLA claims without exposing raw capture data.

**2. Game progression and reward loops**
- *Source domain:* Game credit economies with bulk-buy discounts and streak bonuses
- *Mechanic borrowed:* Tiered purchase incentives that shift users from one-off to committed spenders
- *Application:* The current one-off vs. batch-credits binary could become a **credit tier ladder** — buying 10 reports costs less per-report than 1, buying 50 unlocks `--speed-test` for free, etc. — nudging automation users toward pre-funded keys while giving humans a reason to buy in bulk.

**3. Developer-tool CLI ergonomics**
- *Source domain:* Modern dev tools (`gh`, `stripe`, `fly`) that treat machine-readable output and human-readable output as co-equal, first-class modes
- *Mechanic borrowed:* `--json` flags that emit typed, stable schemas with documented field names so downstream scripts never parse prose
- *Application:* Formalizing a **stable JSON schema** (versioned, OpenAPI-described) for the `findings` output would let agents and CI pipelines declare a contract against it — enabling schema-validated pipelines, changelog-tracked field additions, and community-built integrations without netdoctor owning those integrations.


```

## Git Branches
```text
* main                f8f66d7 Add --redact and mint: publish reports as NFTs without local network identity
  remotes/origin/HEAD -> origin/main
  remotes/origin/main f8f66d7 Add --redact and mint: publish reports as NFTs without local network identity
```

## GH PR List (state: all)
- none found

## Prior Runs (candidates.md / spec-final.md)
### 2026-07-27-e3d-netdoctor/candidates.md
```text
---
selected: candidate-1
reason: Highest combined attraction+retention (10) via a genuine network-effect feature with no overlap in existing code, branches, PRs, or prior runs.
---

# Candidates

## Dedup Context

## Current Findings

```text
---
head_sha: f8f66d75efb46d83534726aae40ac72d20792a92
---

# Findings

## Local State

Repo head sha: f8f66d75efb46d83534726aae40ac72d20792a92

Research topics: network diagnostics CLI

Analogy domains to consider: game progression and reward loops; social feed and notification mechanics; marketplace liquidity and two-sided matching; developer-tool CLI ergonomics; fintech trust and verification UX

## Git history
range: last 20 commits
```text
f8f66d7 Add --redact and mint: publish reports as NFTs without local network identity
1667aed Make wallet payment method selectable (default E3D on Ethereum); add OpenAI narrative support
a6586ec Clarify README: E3D wallet payment benefits, agent-first positioning
4f3435b Never return an Inconclusive verdict; add an opt-in --speed-test
7e77e59 Update README for the redesigned report command
85cbc39 Redesign report command: JSON default, markdown/html formats, file/email sinks
ff1a292 Fix Claude narrative generation: stale model, bad params, and truncation
0bc61c0 Add wallet-based payment for paid-report: credits and one-off modes
6c84134 Add README
deda4eb Implement e3d-netdoctor v1: capture, verdict scoring, report, delivery, payment gate
```

## Branches
```text
* main                f8f66d7 Add --redact and mint: publish reports as NFTs without local network identity
  remotes/origin/HEAD -> origin/main
  remotes/origin/main f8f66d7 Add --redact and mint: publish reports as NFTs without local network identity
```

## GH issues and PRs
### gh issue list
- none found
### gh pr list
- none found

## Repo docs
### README.md
```text
# e3d-netdoctor

**Point it at your network. Get told why it's slow.**

A one-shot, no-UI CLI that captures live traffic and figures out whether your
slowdown is your ISP, your own device, or one flaky destination — with its
reasoning shown, not a black-box score. It's just as useful run by hand as it
is scripted into automation, and it's built especially well for agents: the
default output is the same structured JSON an agent already reasons over, no
prose to re-parse and no UI to drive.

No dashboard. No account. No continuous monitoring. Run it, get an answer, move on.

```
$ e3d-netdoctor paid-report --interface en0 --duration 30

Only analyze traffic on networks you are authorized to monitor.
Requesting e3d payment before capture/analysis...
{
  "requestId": "netdoctor:...",
  "payment": { "product": "netdoctor", "creditsSpent": 500, "creditsRemaining": 1500 },
  "findings": {
    "verdict": {
      "headline": "Likely upstream/ISP",
      "confidence": "High",
      "rationale": "7 of 8 independent destinations affected, spanning 3 different providers"
    }
  },
  "narrative": { "..." : "..." }
}
```

## Why this exists

Every network engineer and Wireshark user has had this conversation:

> "Is it my wifi, or is it Comcast again?"

That question is answerable from a single packet capture — *if* you know to group
retransmissions and RTT outliers by destination **and** by local device, and weigh
provider diversity instead of raw destination count. Most people don't do that math
by hand. netdoctor does, every time, and shows its work.

## Humans, automation, and agents — but agents especially

- **Humans** get a one-shot answer without learning Wireshark: run `report`, read a
  plain-English verdict with its reasoning, done. `--format markdown`/`html` and
  `--to` make it easy to read in a terminal, a browser, or an inbox.
- **Automation/CI** gets deterministic exit codes, no interactive prompts, and a
  non-interactive payment path (a pre-provisioned e3d credit key) — safe to run
  unattended on a schedule or in a pipeline.
- **Agents get the most out of it**, because the whole tool is shaped like a single
  tool call: one command, one JSON result. The default `report` output is
  `{ findings, narrative }` — the same structured shape an agent already reasons
  over, not prose it has to re-parse. The verdict is deterministic and rule-based
  (not another LLM call an agent has to trust blindly), the rationale is
  machine-readable text an agent can quote directly back to a user, and there's no
  UI, login, or browser interaction required for the core flow — only the optional
  wallet payment path below touches a browser, and only because that step
  inherently requires a human to approve a transaction.

## What it actually does

1. **Captures** a short live packet trace (`tshark`), or takes a `.pcap` you already have.
2. **Extends** the parse with TCP-health signals `e3d-pcap`'s core parser doesn't
   collect on its own: retransmissions, duplicate ACKs, out-of-order, zero-window
   stalls, per-flow RTT (SYN→SYN-ACK), and DNS response timing.
3. **Corroborates** with host-level checks that don't depend on the capture at all —
   real `ping` and `traceroute` to the destinations the capture flagged, and `netstat`
   for local NIC error/collision counters and TCP-stack retransmit stats.
4. **Scores a verdict** — deterministic, rule-based, unit-tested — into one of three
   categories:

   | Verdict | Means |
   |---|---|
   | **Likely Upstream/ISP** | Signal spread across many unrelated destinations and providers — not one device |
   | **Likely Local** | Signal concentrated on one local device (MAC) across many destinations — bad wifi, flaky NIC, bad cabling |
   | **Likely Destination/Path-Specific** | Signal confined to one or two destinations while everything else is clean |

   Confidence is always shown as reasoning ("7 of 8 destinations, 3 providers"),
   never a bare number. netdoctor always commits to one of these three — it never
   answers "inconclusive." With thin data it still picks the closest match and says
   so plainly in the rationale ("only 2 of the required 3 distinct destinations were
   observed"), rather than declining to call it.
5. **Writes the report** — an executive summary and per-section narrative from
   Claude, grounded strictly in the structured findings (never raw packets), with a
   deterministic fallback if no API key is configured.
6. **Delivers it** by email, with an optional PDF attachment.
7. **Gates it** behind an e3d pay-per-report payment — fails closed, no free runs,
   clear message on how to pay if it's missing. Pay with a pre-provisioned credit
   key (for automation), or with an E3D Token (wE3D) wallet directly (for a human
   with no e3d account) — see [Paying for a report](#paying-for-a-report) below.

## Paying for a report

`paid-report` runs the same capture → verdict → report pipeline above, gated
behind one payment of **500 e3d credits (0.5 E3D or wE3D at the current unit
price, depending on payment method)**. Like `report`, it defaults to printing
JSON to stdout — here that's the payment receipt plus `findings`/`narrative` —
with `--format`/`--output`/`--to` working exactly the same way; email is opt-in
via `--to`, not automatic. There are two ways to pay, aimed at two different
users:

- **A pre-provisioned credit key** (`NETDOCTOR_PAYMENT_CREDIT_KEY`) — for
  automation, CI, or anyone who already has an e3d account funded ahead of time.
  Non-interactive: no browser, no prompts, safe to run unattended on a schedule.
- **`--wallet <address>`** — for a human who wants to pay for a report directly
  with E3D Token, with no e3d account or pre-funded credit key at all:

  ```bash
  e3d-netdoctor paid-report --interface en0 --wallet 0xYourAddress
  ```

  netdoctor prints a one-time URL; open it, connect MetaMask, and approve a single
  token transfer. netdoctor polls in the background and picks up automatically
  once the payment is confirmed — nothing to copy/paste back into the terminal.

  The benefit over the credit-key path isn't just convenience: **your wallet's
  private key never touches netdoctor or any e3d server.** The browser talks
  directly to your wallet and only ever reports a transaction hash back — never a
  secret. netdoctor never sees, asks for, or stores a private key, and you never
  manually handle a tx hash or credit key either; the whole exchange happens over
  a short-lived, single-use payment session it polls for you.

  `--payment-method` picks which chain/token to pay with:
  - **`ethereum`** (default) — pay with **E3D** on Ethereum mainnet.
  - **`base`** — pay with **wE3D** on Base; usually lower gas fees.

  ```bash
  e3d-netdoctor paid-report --interface en0 --wallet 0xYourAddress --payment-method base
  ```

  Two spending modes (independent of which chain you pick):
  - **One-off** (`--wallet <address>`, no `--credits`): pay for exactly this one
    report. Nothing is saved locally — the next `paid-report` starts a fresh
    payment.
  - **Batch** (`--wallet <address> --credits n`): buy a reusable batch of `n`
    credits once; the resulting credit key is saved to
    `~/.config/e3d-netdoctor/config.json` (keyed by wallet address) and reused
    automatically by future `paid-report --wallet` runs until it runs low —
    fewer wallet approvals if you run reports regularly.

See [`docs/payment-gate.md`](docs/payment-gate.md) for the credit-key flow's
configuration and failure-mode details.

## Quickstart

```bash
npm install                      # only local dependency: e3d-pcap
e3d-netdoctor preflight           # confirms tshark is installed
e3d-netdoctor smoke ./fixtures/sample-syn.pcap
e3d-netdoctor report ./fixtures/retransmission-handshake.pcap
```

`report` defaults to printing `{ findings, narrative }` as JSON to stdout —
built for agents to consume directly, no parsing of prose required. Ask for
markdown or HTML instead, write to a file, or email it:

```bash
e3d-netdoctor report ./fixtures/retransmission-handshake.pcap                          # JSON to stdout (default)
e3d-netdoctor report ./fixtures/retransmission-handshake.pcap --format markdown        # markdown to stdout
e3d-netdoctor report ./fixtures/retransmission-handshake.pcap --format html            # HTML to stdout
e3d-netdoctor report ./fixtures/retransmission-handshake.pcap --format html --output out.html
e3d-netdoctor report ./fixtures/retransmission-handshake.pcap --to you@example.com --pdf
```

When `--output` and/or `--to` are used, `report` prints a small JSON summary
(verdict, confidence, output path, delivery info) instead of the raw content.

Add `--speed-test` to also run a real download/upload throughput measurement
(against a public Cloudflare speed-test endpoint) and fold the Mbps numbers
into the System Diagnostics section. It's opt-in — off by default — since it
uses real bandwidth and adds several seconds to the run:

```bash
e3d-netdoctor report ./fixtures/retransmission-handshake.pcap --speed-test
```

Add `--redact` before sharing or publishing a report: it replaces your local
IPs/MACs with stable pseudonyms (`local-device-1`, `local-device-2`, ...) and
strips the local capture file path, while leaving external destination IPs and
ISP traceroute hostnames real — that's the verifiable evidence the report
exists to show, only your own network's identity is hidden. This is also the
precondition for `mint` (below) — nothing gets published or tokenized with
your home network's real IPs/MACs in it.

```bash
e3d-netdoctor report ./fixtures/retransmission-handshake.pcap --redact --output report.json
```

## Minting a report as an NFT

`mint` tokenizes an already-`--redact`ed report as an NFT via `E3DNFTManager`
(the same shared contract used across E3D products — no netdoctor-specific
contract). It requires the saved report file to have `redacted: true` (refuses
otherwise) and `--confirm-public`, since minting pins the report to IPFS
**permanently and publicly**:

```bash
e3d-netdoctor mint report.json --wallet 0xYourAddress --confirm-public
```

netdoctor renders an HTML certificate (from the saved findings/narrative) and
a PNG screenshot of it, uploads both plus the structured findings to IPFS via
e3d.ai, then prints a one-time `https://e3d.ai/mint?session=...` URL — open
it, connect MetaMask, and approve the mint (same no-custodial-keys model as
`--wallet` payments: your wallet signs directly, netdoctor and e3d.ai never
see or touch it). Minting always happens on **Ethereum mainnet** regardless of
which `--payment-method` was used to pay for the report itself, and costs
**100 E3D + gas** — a separate cost from the 500 credits spent generating the
report. Once confirmed, netdoctor prints `{tokenId, txHash, etherscanUrl}`.

Full command list:

```
preflight                                  Check whether tshark is installed locally.
smoke <file.pcap>                          Parse a capture, print rows/diagnostics.
capture [iface] [seconds]                  Run a live tshark capture (default 30s).
report <pcap> [--format json|markdown|html] [--output file] [--to email] [--pdf] [--no-system-diagnostics] [--speed-test] [--redact]
                                            Defaults to JSON on stdout; --format selects markdown/html;
                                            --output writes to a file; --to emails it (--pdf attaches a PDF).
deliver <pcap> <to> [--pdf] [--no-system-diagnostics] [--speed-test]
paid-report [--pcap file | --interface iface] [--duration s] [--format json|markdown|html]
            [--output file] [--to email] [--pdf] [--request-id id] [--speed-test] [--redact]
            [--wallet address [--credits n] [--payment-method ethereum|base]]
                                            Same defaults/flags as report, gated behind a 500-credit
                                            payment (credit key or --wallet).
mint <report.json> --wallet address --confirm-public [--name "..."] [--description "..."]
                                            Tokenize a --redact'd report as an NFT (E3DNFTManager,
                                            Ethereum mainnet). 100 E3D + gas, paid from --wallet.
```

Every capture/analysis entrypoint prints a reminder up front:
**only analyze traffic on networks you are authorized to monitor.**

## No external dependencies to install

Everything beyond parsing (which reuses `e3d-pcap`'s tested core) is built on
Node's standard library and the system tools you already have:

- **Email** — a small SMTP client on `node:net`/`node:tls` (STARTTLS + AUTH LOGIN).
  No `nodemailer`.
- **PDF export** — shells out to a locally installed Chrome/Chromium/Edge with
  `--headless --print-to-pdf`, the same way netdoctor already shells out to
  `tshark`. No `puppeteer`, no bundled Chromium download.
- **Payment client** — a small, self-contained e3d payments client, not a runtime
  dependency on another repo.

`npm install` has nothing left to resolve beyond the one intentional local
dependency (`e3d-pcap`), and nothing to silently fail on a machine without
internet access.

## Configuration

| Purpose | Env vars |
|---|---|
| Narrative generation | `ANTHROPIC_API_KEY` (preferred if set) or `OPENAI_API_KEY` (used if Anthropic's isn't set); falls back to a deterministic template if neither is configured. Optional `NETDOCTOR_ANTHROPIC_MODEL`/`NETDOCTOR_OPENAI_MODEL` to override the default model. |
| Email delivery | `NETDOCTOR_SMTP_HOST`, `NETDOCTOR_SMTP_PORT`, `NETDOCTOR_SMTP_SECURE`, `NETDOCTOR_SMTP_USER`, `NETDOCTOR_SMTP_PASSWORD` |
| PDF export | `NETDOCTOR_BROWSER_PATH` (auto-detected otherwise) |
| Payment gate | `NETDOCTOR_PAYMENT_CREDIT_KEY`, `NETDOCTOR_PAYMENT_SERVICE_KEY`, `E3D_BASE_URL` — see [`docs/payment-gate.md`](docs/payment-gate.md) |

## Testing

```bash
node --test
```

Every external boundary — `tshark`, `ping`/`traceroute`/`netstat`, SMTP, PDF
rendering, the payment API — is exercised through dependency injection so the suite
runs offline and fast, plus a real local-socket SMTP conversation and real fixture
`.pcap` parses so the important paths are proven end-to-end, not just mocked.

```

## TODO/FIXME matches
- none found

## External Context

### External Context

- **Network diagnostics tooling** has converged on two poles: continuous-monitoring dashboards (Smokeping, ThousandEyes, Pingdom) and one-shot capture tools (Wireshark/tshark, `mtr`). netdoctor deliberately sits in the underserved middle — one-shot like `mtr`, but with the multi-signal correlation (retransmits + RTT + provider diversity) that usually only comes from a always-on SaaS dashboard.
- **Deterministic, rule-based verdicts over LLM judgment calls** is the emerging best practice for agent-consumed tools: agents need a stable, auditable decision function they can cite, not another probabilistic model in the loop. netdoctor's refusal to return "Inconclusive" and its rationale-as-text-not-score design mirrors how eval and observability tooling (e.g., structured tracing schemas) is moving away from opaque scalar confidence.
- **Agent-first CLI design** is now a recognized category distinct from "human CLI with a `--json` flag bolted on" — the growing adoption of the Model Context Protocol (MCP) and tool-use schemas has pushed CLI authors toward JSON-as-primary-output, deterministic exit codes, and no interactive prompts in the default path, all of which this repo already follows.
- **Agent-native payments** (x402-style HTTP 402 flows, wallet-signed one-off transactions) are actively being standardized as of 2026 so that autonomous agents can pay per call without holding custodial keys — netdoctor's non-custodial wallet-poll pattern for `paid-report`/`mint` tracks this trend closely.
- **On-chain provenance for reports/certificates** (minting an audit artifact as an NFT with IPFS-pinned evidence) is a small but growing pattern in verifiable-compute and diagnostic-attestation projects, used to create tamper-evident, shareable proof of a finding without exposing the underlying private data — which is exactly what `--redact` + `mint` implements here.

### Analogous Patterns

- **Fintech trust and verification UX** — mechanic: staged disclosure and non-custodial signing (show exactly what's being approved, let the user's own wallet/app do the signing, never touch the secret). netdoctor already does this for payment and minting; the same staged-disclosure UX could extend to the *verdict* itself — e.g., a "verify this diagnosis" mode where the raw per-flow evidence backing a claim (like a bank transaction receipt) is independently reproducible/hashable so a third party can confirm the verdict without re-running the capture.
- **Developer-tool CLI ergonomics** — mechanic: progressive disclosure via subcommands and flags that scale from "just tell me" to "give me everything" (think `git`, `docker`, `kubectl`). netdoctor could adopt a `--explain` or `-v` tier system so the same JSON payload can render as a one-line verdict for scripts, a paragraph for a human skimming a terminal, or a full evidentiary trail for someone debugging the diagnosis itself — reusing the existing narrative layer as the top of that ladder rather than a separate feature.
- **Marketplace liquidity and two-sided matching** — mechanic: matching many small requesters against a pool of resources/providers to keep both sides liquid (Uber/Airbnb-style). Because netdoctor's ISP-vs-local verdict gets stronger with more independent vantage points, the credit-key/payment infrastructure already built for one user could be repurposed as a lightweight two-sided market: other users' netdoctor runs (paid, opt-in, redacted) contribute anonymized "is this provider/destination currently degraded for others too" signal, turning a single-machine tool into a crowd-corroborated one without standing up a monitoring service.


```

## Git Branches
```text
* main                f8f66d7 Add --redact and mint: publish reports as NFTs without local network identity
  remotes/origin/HEAD -> origin/main
  remotes/origin/main f8f66d7 Add --redact and mint: publish reports as NFTs without local network identity
```

## GH PR List (state: all)
- none found

## Prior Runs (candidates.md / spec-final.md)
- none found

## Proposed Candidates

### Candidate 1: Crowd-corroborated destination/ISP health signal
Duplicate: no
Dedup rationale: Checked `main` (only branch, HEAD f8f66d7) and the full README/command list — `report`/`paid-report` only ever reason over a single machine's own capture plus its own `ping`/`traceroute`/`netstat`. No aggregation, opt-in sharing, or cross-user signal exists anywhere in the code, docs, or git history. No open PRs/issues/prior runs to check against either (all empty).
Category: social
Analogy: marketplace liquidity and two-sided matching (Uber/Airbnb-style pooling of many small signals) -- netdoctor's ISP-vs-local verdict gets more confident with more independent vantage points on the same destination/ASN. Opt-in, `--redact`-style anonymized submission of "destination X was flaky for me too, just now" turns every paid/free run into a contribution to a shared liquidity pool, so verdicts about "is it just me or is Comcast/Cloudflare having a bad day" get stronger the more people run the tool — a genuine network effect a single-machine tool can't otherwise have.
Attraction (1-5): 5
Retention (1-5): 5
Effort: high
Revenue (1-5|n/a): 3
Description: Add an opt-in flag (e.g. `--contribute`) that, only after `--redact`, submits a minimal anonymized signal (destination host/ASN, timestamp, verdict category — never local IPs/MACs) to a lightweight e3d-hosted aggregation endpoint. In return, `report`/`paid-report` can add a line like "3 other netdoctor users also saw degraded performance to this destination in the last hour" to the verdict rationale, making the tool's core answer measurably better for everyone without breaking the "no dashboard, no account" positioning (submission and lookup are per-run, not continuous monitoring). This is the single biggest lever for both attraction (a differentiator no competing one-shot tool has) and retention (people re-run it during an outage to see if others are affected too).

### Candidate 2: Referral / credit-sharing growth loop
Duplicate: no
Dedup rationale: Checked README's payment-gate section and `docs/payment-gate.md` references — the existing credit system (`NETDOCTOR_PAYMENT_CREDIT_KEY`, wallet batch credits) has no referral, invite, or bonus-credit mechanic. Only branch is `main`; no PRs/issues/prior candidates exist to overlap with.
Category: marketing
Analogy: consumer-app viral loops (Dropbox/Uber-style "give credits, get credits") layered onto the fintech trust UX netdoctor already has for wallet payments -- since payment is already non-custodial and credit-key based, a referral code that mints bonus credits to both referrer and referee reuses infrastructure that's already built rather than adding a new system.
Attraction (1-5): 4
Retention (1-5): 3
Effort: low
Revenue (1-5|n/a): 3
Description: Let a `paid-report` credit-key holder generate a shareable referral code (via a new `refer` subcommand or flag) that grants both parties bonus credits on the referee's first `paid-report`. Implementation is mostly bookkeeping on top of the existing credit/wallet client — no new payment rails needed. Directly serves the "attract users" goal via word-of-mouth among the sysadmin/dev communities this tool targets, and nudges casual `report` users toward becoming repeat `paid-report` users.

### Candidate 3: CI/GitHub Action packaging with scheduled verdict-diff alerts
Duplicate: no
Dedup rationale: README already documents that `report`/`paid-report` are CI-safe (deterministic exit codes, non-interactive credit-key auth) but there is no packaged GitHub Action, no diffing between runs, and no alerting — confirmed by reading the full command list and repo root (no `.github/actions`, no action.yml). Only `main` branch exists; nothing to duplicate in PRs/issues/prior runs.
Category: workflow
Analogy: developer-tool CLI ergonomics (git/docker/kubectl-style meeting users where they already work) -- packaging what already works as a first-class GitHub Action with a diff-on-verdict-change comment mechanic turns a manually-invoked CLI into something that shows up automatically in a PR or nightly workflow, which is how tools like Lighthouse CI or bundle-size bots got adopted widely.
Attraction (1-5): 3
Retention (1-5): 3
Effort: medium
Revenue (1-5|n/a): 3
Description: Publish a thin GitHub Action wrapping `paid-report`/`report` that runs on a schedule or PR trigger, stores the prior run's JSON as a workflow artifact, and posts a PR comment or Slack message only when the verdict category changes (e.g. "Likely Local -> Likely Upstream/ISP"). No new product logic — just packaging plus a small diff step — but it puts netdoctor in front of teams during their normal CI review flow instead of requiring someone to remember to run it by hand, which is a strong discovery channel (GitHub Marketplace listing) distinct from anything currently built.

### Candidate 4: Free instant "shareable report" link (non-NFT, non-permanent)
Duplicate: no
Dedup rationale: `mint` already publishes a redacted report permanently/publicly as a paid NFT via IPFS — confirmed in README's "Minting a report as an NFT" section. A free, ephemeral, non-blockchain share link is a distinct feature (different cost, different permanence, different audience) and does not exist anywhere in the current code. No branches/PRs/prior runs to conflict with.
Category: social
Analogy: fintech trust/verification UX (staged disclosure of exactly what's shared) combined with social sharing loops (e.g. sharing a Wordle result) -- reuses the same `--redact` guarantee and the same e3d.ai session-hosting mechanism already built for `mint`'s one-time URLs, just pointed at a free, time-limited public view instead of a paid permanent mint.
Attraction (1-5): 4
Retention (1-5): 2
Effort: medium
Revenue (1-5|n/a): 2
Description: Add a `--share` flag to `report` (free tier) that uploads a `--redact`ed report to e3d.ai's existing session-hosting infra (already built for `mint`) and prints a time-limited public URL (e.g. 7-day expiry) instead of requiring a wallet/mint fee. Gives people a zero-friction way to post "here's proof it's my ISP" in a support ticket, subreddit, or Slack thread — each shared link is a free advertisement for the tool to a new audience, funneling some fraction toward `paid-report`/`mint` for permanent evidence.

### Candidate 5: `--explain`/verbosity tiers and independently-reproducible verify mode
Duplicate: no
Dedup rationale: README confirms only one narrative layer exists today (Claude/OpenAI narrative or deterministic template) with no verbosity flag and no independent-verification/hashing mode for the raw evidence. Only `main` branch; no PRs, issues, or prior candidates reference this.
Category: testing
Analogy: developer-tool CLI ergonomics (progressive disclosure via flags, git/docker-style) plus fintech trust/verification UX (a third party can independently confirm a claim without re-doing the underlying work, like verifying a bank receipt) -- applied to netdoctor's verdict evidence rather than just its narrative.
Attraction (1-5): 2
Retention (1-5): 3
Effort: low
Revenue (1-5|n/a): 1
Description: Add a `-v`/`--explain` tier system (quiet verdict -> paragraph -> full per-flow evidentiary trail) reusing the existing narrative layer, plus a `--verify` mode that hashes the structured findings so a third party can confirm a shared/minted report's evidence matches without re-running the capture. Solid quality-of-life and trust improvement, but lower net-new attraction than the other candidates since it refines an existing flow rather than opening a new usage pattern.

---IDEATE-STATUS---
selected: candidate-1
reason: Highest combined attraction+retention (10) via a genuine network-effect feature with no overlap in existing code, branches, PRs, or prior runs.


```
### 2026-07-28-e3d-netdoctor-3/candidates.md
```text
---
selected: candidate-1
reason: Highest combined attraction+retention (10), a genuine network-effect feature still unbuilt in code/branches despite being the prior run's top pick.
---

# Candidates

## Dedup Context

## Current Findings

```text
---
head_sha: f8f66d75efb46d83534726aae40ac72d20792a92
---

# Findings

## Local State

Repo head sha: f8f66d75efb46d83534726aae40ac72d20792a92

Research topics: network diagnostics CLI

Analogy domains to consider: game progression and reward loops; social feed and notification mechanics; marketplace liquidity and two-sided matching; developer-tool CLI ergonomics; fintech trust and verification UX

## Git history
range: last 20 commits
```text
f8f66d7 Add --redact and mint: publish reports as NFTs without local network identity
1667aed Make wallet payment method selectable (default E3D on Ethereum); add OpenAI narrative support
a6586ec Clarify README: E3D wallet payment benefits, agent-first positioning
4f3435b Never return an Inconclusive verdict; add an opt-in --speed-test
7e77e59 Update README for the redesigned report command
85cbc39 Redesign report command: JSON default, markdown/html formats, file/email sinks
ff1a292 Fix Claude narrative generation: stale model, bad params, and truncation
0bc61c0 Add wallet-based payment for paid-report: credits and one-off modes
6c84134 Add README
deda4eb Implement e3d-netdoctor v1: capture, verdict scoring, report, delivery, payment gate
```

## Branches
```text
* main                f8f66d7 Add --redact and mint: publish reports as NFTs without local network identity
  remotes/origin/HEAD -> origin/main
  remotes/origin/main f8f66d7 Add --redact and mint: publish reports as NFTs without local network identity
```

## GH issues and PRs
### gh issue list
- none found
### gh pr list
- none found

## Repo docs
### README.md
```text
# e3d-netdoctor

**Point it at your network. Get told why it's slow.**

A one-shot, no-UI CLI that captures live traffic and figures out whether your
slowdown is your ISP, your own device, or one flaky destination — with its
reasoning shown, not a black-box score. It's just as useful run by hand as it
is scripted into automation, and it's built especially well for agents: the
default output is the same structured JSON an agent already reasons over, no
prose to re-parse and no UI to drive.

No dashboard. No account. No continuous monitoring. Run it, get an answer, move on.

```
$ e3d-netdoctor paid-report --interface en0 --duration 30

Only analyze traffic on networks you are authorized to monitor.
Requesting e3d payment before capture/analysis...
{
  "requestId": "netdoctor:...",
  "payment": { "product": "netdoctor", "creditsSpent": 500, "creditsRemaining": 1500 },
  "findings": {
    "verdict": {
      "headline": "Likely upstream/ISP",
      "confidence": "High",
      "rationale": "7 of 8 independent destinations affected, spanning 3 different providers"
    }
  },
  "narrative": { "..." : "..." }
}
```

## Why this exists

Every network engineer and Wireshark user has had this conversation:

> "Is it my wifi, or is it Comcast again?"

That question is answerable from a single packet capture — *if* you know to group
retransmissions and RTT outliers by destination **and** by local device, and weigh
provider diversity instead of raw destination count. Most people don't do that math
by hand. netdoctor does, every time, and shows its work.

## Humans, automation, and agents — but agents especially

- **Humans** get a one-shot answer without learning Wireshark: run `report`, read a
  plain-English verdict with its reasoning, done. `--format markdown`/`html` and
  `--to` make it easy to read in a terminal, a browser, or an inbox.
- **Automation/CI** gets deterministic exit codes, no interactive prompts, and a
  non-interactive payment path (a pre-provisioned e3d credit key) — safe to run
  unattended on a schedule or in a pipeline.
- **Agents get the most out of it**, because the whole tool is shaped like a single
  tool call: one command, one JSON result. The default `report` output is
  `{ findings, narrative }` — the same structured shape an agent already reasons
  over, not prose it has to re-parse. The verdict is deterministic and rule-based
  (not another LLM call an agent has to trust blindly), the rationale is
  machine-readable text an agent can quote directly back to a user, and there's no
  UI, login, or browser interaction required for the core flow — only the optional
  wallet payment path below touches a browser, and only because that step
  inherently requires a human to approve a transaction.

## What it actually does

1. **Captures** a short live packet trace (`tshark`), or takes a `.pcap` you already have.
2. **Extends** the parse with TCP-health signals `e3d-pcap`'s core parser doesn't
   collect on its own: retransmissions, duplicate ACKs, out-of-order, zero-window
   stalls, per-flow RTT (SYN→SYN-ACK), and DNS response timing.
3. **Corroborates** with host-level checks that don't depend on the capture at all —
   real `ping` and `traceroute` to the destinations the capture flagged, and `netstat`
   for local NIC error/collision counters and TCP-stack retransmit stats.
4. **Scores a verdict** — deterministic, rule-based, unit-tested — into one of three
   categories:

   | Verdict | Means |
   |---|---|
   | **Likely Upstream/ISP** | Signal spread across many unrelated destinations and providers — not one device |
   | **Likely Local** | Signal concentrated on one local device (MAC) across many destinations — bad wifi, flaky NIC, bad cabling |
   | **Likely Destination/Path-Specific** | Signal confined to one or two destinations while everything else is clean |

   Confidence is always shown as reasoning ("7 of 8 destinations, 3 providers"),
   never a bare number. netdoctor always commits to one of these three — it never
   answers "inconclusive." With thin data it still picks the closest match and says
   so plainly in the rationale ("only 2 of the required 3 distinct destinations were
   observed"), rather than declining to call it.
5. **Writes the report** — an executive summary and per-section narrative from
   Claude, grounded strictly in the structured findings (never raw packets), with a
   deterministic fallback if no API key is configured.
6. **Delivers it** by email, with an optional PDF attachment.
7. **Gates it** behind an e3d pay-per-report payment — fails closed, no free runs,
   clear message on how to pay if it's missing. Pay with a pre-provisioned credit
   key (for automation), or with an E3D Token (wE3D) wallet directly (for a human
   with no e3d account) — see [Paying for a report](#paying-for-a-report) below.

## Paying for a report

`paid-report` runs the same capture → verdict → report pipeline above, gated
behind one payment of **500 e3d credits (0.5 E3D or wE3D at the current unit
price, depending on payment method)**. Like `report`, it defaults to printing
JSON to stdout — here that's the payment receipt plus `findings`/`narrative` —
with `--format`/`--output`/`--to` working exactly the same way; email is opt-in
via `--to`, not automatic. There are two ways to pay, aimed at two different
users:

- **A pre-provisioned credit key** (`NETDOCTOR_PAYMENT_CREDIT_KEY`) — for
  automation, CI, or anyone who already has an e3d account funded ahead of time.
  Non-interactive: no browser, no prompts, safe to run unattended on a schedule.
- **`--wallet <address>`** — for a human who wants to pay for a report directly
  with E3D Token, with no e3d account or pre-funded credit key at all:

  ```bash
  e3d-netdoctor paid-report --interface en0 --wallet 0xYourAddress
  ```

  netdoctor prints a one-time URL; open it, connect MetaMask, and approve a single
  token transfer. netdoctor polls in the background and picks up automatically
  once the payment is confirmed — nothing to copy/paste back into the terminal.

  The benefit over the credit-key path isn't just convenience: **your wallet's
  private key never touches netdoctor or any e3d server.** The browser talks
  directly to your wallet and only ever reports a transaction hash back — never a
  secret. netdoctor never sees, asks for, or stores a private key, and you never
  manually handle a tx hash or credit key either; the whole exchange happens over
  a short-lived, single-use payment session it polls for you.

  `--payment-method` picks which chain/token to pay with:
  - **`ethereum`** (default) — pay with **E3D** on Ethereum mainnet.
  - **`base`** — pay with **wE3D** on Base; usually lower gas fees.

  ```bash
  e3d-netdoctor paid-report --interface en0 --wallet 0xYourAddress --payment-method base
  ```

  Two spending modes (independent of which chain you pick):
  - **One-off** (`--wallet <address>`, no `--credits`): pay for exactly this one
    report. Nothing is saved locally — the next `paid-report` starts a fresh
    payment.
  - **Batch** (`--wallet <address> --credits n`): buy a reusable batch of `n`
    credits once; the resulting credit key is saved to
    `~/.config/e3d-netdoctor/config.json` (keyed by wallet address) and reused
    automatically by future `paid-report --wallet` runs until it runs low —
    fewer wallet approvals if you run reports regularly.

See [`docs/payment-gate.md`](docs/payment-gate.md) for the credit-key flow's
configuration and failure-mode details.

## Quickstart

```bash
npm install                      # only local dependency: e3d-pcap
e3d-netdoctor preflight           # confirms tshark is installed
e3d-netdoctor smoke ./fixtures/sample-syn.pcap
e3d-netdoctor report ./fixtures/retransmission-handshake.pcap
```

`report` defaults to printing `{ findings, narrative }` as JSON to stdout —
built for agents to consume directly, no parsing of prose required. Ask for
markdown or HTML instead, write to a file, or email it:

```bash
e3d-netdoctor report ./fixtures/retransmission-handshake.pcap                          # JSON to stdout (default)
e3d-netdoctor report ./fixtures/retransmission-handshake.pcap --format markdown        # markdown to stdout
e3d-netdoctor report ./fixtures/retransmission-handshake.pcap --format html            # HTML to stdout
e3d-netdoctor report ./fixtures/retransmission-handshake.pcap --format html --output out.html
e3d-netdoctor report ./fixtures/retransmission-handshake.pcap --to you@example.com --pdf
```

When `--output` and/or `--to` are used, `report` prints a small JSON summary
(verdict, confidence, output path, delivery info) instead of the raw content.

Add `--speed-test` to also run a real download/upload throughput measurement
(against a public Cloudflare speed-test endpoint) and fold the Mbps numbers
into the System Diagnostics section. It's opt-in — off by default — since it
uses real bandwidth and adds several seconds to the run:

```bash
e3d-netdoctor report ./fixtures/retransmission-handshake.pcap --speed-test
```

Add `--redact` before sharing or publishing a report: it replaces your local
IPs/MACs with stable pseudonyms (`local-device-1`, `local-device-2`, ...) and
strips the local capture file path, while leaving external destination IPs and
ISP traceroute hostnames real — that's the verifiable evidence the report
exists to show, only your own network's identity is hidden. This is also the
precondition for `mint` (below) — nothing gets published or tokenized with
your home network's real IPs/MACs in it.

```bash
e3d-netdoctor report ./fixtures/retransmission-handshake.pcap --redact --output report.json
```

## Minting a report as an NFT

`mint` tokenizes an already-`--redact`ed report as an NFT via `E3DNFTManager`
(the same shared contract used across E3D products — no netdoctor-specific
contract). It requires the saved report file to have `redacted: true` (refuses
otherwise) and `--confirm-public`, since minting pins the report to IPFS
**permanently and publicly**:

```bash
e3d-netdoctor mint report.json --wallet 0xYourAddress --confirm-public
```

netdoctor renders an HTML certificate (from the saved findings/narrative) and
a PNG screenshot of it, uploads both plus the structured findings to IPFS via
e3d.ai, then prints a one-time `https://e3d.ai/mint?session=...` URL — open
it, connect MetaMask, and approve the mint (same no-custodial-keys model as
`--wallet` payments: your wallet signs directly, netdoctor and e3d.ai never
see or touch it). Minting always happens on **Ethereum mainnet** regardless of
which `--payment-method` was used to pay for the report itself, and costs
**100 E3D + gas** — a separate cost from the 500 credits spent generating the
report. Once confirmed, netdoctor prints `{tokenId, txHash, etherscanUrl}`.

Full command list:

```
preflight                                  Check whether tshark is installed locally.
smoke <file.pcap>                          Parse a capture, print rows/diagnostics.
capture [iface] [seconds]                  Run a live tshark capture (default 30s).
report <pcap> [--format json|markdown|html] [--output file] [--to email] [--pdf] [--no-system-diagnostics] [--speed-test] [--redact]
                                            Defaults to JSON on stdout; --format selects markdown/html;
                                            --output writes to a file; --to emails it (--pdf attaches a PDF).
deliver <pcap> <to> [--pdf] [--no-system-diagnostics] [--speed-test]
paid-report [--pcap file | --interface iface] [--duration s] [--format json|markdown|html]
            [--output file] [--to email] [--pdf] [--request-id id] [--speed-test] [--redact]
            [--wallet address [--credits n] [--payment-method ethereum|base]]
                                            Same defaults/flags as report, gated behind a 500-credit
                                            payment (credit key or --wallet).
mint <report.json> --wallet address --confirm-public [--name "..."] [--description "..."]
                                            Tokenize a --redact'd report as an NFT (E3DNFTManager,
                                            Ethereum mainnet). 100 E3D + gas, paid from --wallet.
```

Every capture/analysis entrypoint prints a reminder up front:
**only analyze traffic on networks you are authorized to monitor.**

## No external dependencies to install

Everything beyond parsing (which reuses `e3d-pcap`'s tested core) is built on
Node's standard library and the system tools you already have:

- **Email** — a small SMTP client on `node:net`/`node:tls` (STARTTLS + AUTH LOGIN).
  No `nodemailer`.
- **PDF export** — shells out to a locally installed Chrome/Chromium/Edge with
  `--headless --print-to-pdf`, the same way netdoctor already shells out to
  `tshark`. No `puppeteer`, no bundled Chromium download.
- **Payment client** — a small, self-contained e3d payments client, not a runtime
  dependency on another repo.

`npm install` has nothing left to resolve beyond the one intentional local
dependency (`e3d-pcap`), and nothing to silently fail on a machine without
internet access.

## Configuration

| Purpose | Env vars |
|---|---|
| Narrative generation | `ANTHROPIC_API_KEY` (preferred if set) or `OPENAI_API_KEY` (used if Anthropic's isn't set); falls back to a deterministic template if neither is configured. Optional `NETDOCTOR_ANTHROPIC_MODEL`/`NETDOCTOR_OPENAI_MODEL` to override the default model. |
| Email delivery | `NETDOCTOR_SMTP_HOST`, `NETDOCTOR_SMTP_PORT`, `NETDOCTOR_SMTP_SECURE`, `NETDOCTOR_SMTP_USER`, `NETDOCTOR_SMTP_PASSWORD` |
| PDF export | `NETDOCTOR_BROWSER_PATH` (auto-detected otherwise) |
| Payment gate | `NETDOCTOR_PAYMENT_CREDIT_KEY`, `NETDOCTOR_PAYMENT_SERVICE_KEY`, `E3D_BASE_URL` — see [`docs/payment-gate.md`](docs/payment-gate.md) |

## Testing

```bash
node --test
```

Every external boundary — `tshark`, `ping`/`traceroute`/`netstat`, SMTP, PDF
rendering, the payment API — is exercised through dependency injection so the suite
runs offline and fast, plus a real local-socket SMTP conversation and real fixture
`.pcap` parses so the important paths are proven end-to-end, not just mocked.

```

## TODO/FIXME matches
- none found

## External Context

### External Context

- **Network diagnostics tooling is converging on "explainable, single-shot" output.** Classic tools (`mtr`, `smokeping`, Wireshark/`tshark`) expose raw signal but leave interpretation to a human expert; SaaS successors (ThousandEyes, Catchpoint, Kentik) add always-on correlation and root-cause classification but require an account, agents, and a dashboard. netdoctor's one-shot, rule-based verdict with visible rationale sits in an underserved middle: no infrastructure to run, but a real classification instead of a raw trace dump.
- **Deterministic, non-LLM verdicts are becoming a selling point, not a limitation.** As more diagnostic and monitoring tools bolt on an LLM summarizer, the differentiator is keeping the actual classification rule-based/auditable and using the LLM only for narrative — mirroring how observability vendors (Datadog, Honeycomb) now separate "explanation text" from the underlying anomaly-detection engine so users don't have to trust a black box for the verdict itself.
- **Agent-first CLI design is an active design trend.** The rise of MCP and tool-calling conventions has pushed CLI authors toward JSON-first default output, deterministic exit codes, and no interactive prompts as the norm for anything meant to be composable by an agent — exactly the shape netdoctor has adopted (`{ findings, narrative }` as default stdout).
- **Crypto micropayments for agent-driven API/tool usage are maturing rapidly** (x402-style HTTP payment flows, wallet-native pay-per-call patterns), aimed at exactly netdoctor's problem: letting an autonomous agent or unattended job pay per invocation without a pre-existing account, using a non-custodial signing flow.
- **On-chain provenance/attestation for reports and diagnostics is an emerging pattern** — minting a redacted result as an NFT/attestation is unusual for a network-diagnostics tool specifically, but is consistent with a broader trend of using chain-anchored artifacts as tamper-evident, shareable proof (audit reports, certifications, credential badges) rather than for speculation.

### Analogous Patterns

- **Fintech trust and verification UX → the redact/mint pipeline.** The mechanic banks and fintechs use for statements/attestations is "verifiable but privacy-preserving disclosure" (redacted bank statements, zero-knowledge proof-of-funds) — showing enough evidence to be trusted without exposing the underlying account. netdoctor's `--redact` + `mint` flow is the same shape: it could borrow the fintech pattern of a **verification badge/receipt UX** (e.g., a shareable "verified diagnosis" link with a trust indicator showing what was redacted vs. real) rather than just an NFT tokenId, making the proof legible to a non-crypto-native recipient like an ISP support rep.
- **Marketplace liquidity and two-sided matching → the wallet payment flow.** Two-sided marketplaces solve the "who pays, who fulfills, and how do strangers trust the exchange" problem with escrow and short-lived session-based matching (e.g., a ride-share fare hold). netdoctor's one-time payment-session URL that polls until confirmed is structurally identical to a marketplace escrow session; this suggests generalizing to a **session-based "verdict marketplace"** where a report itself could be an escrowed, resellable artifact (e.g., an ISP or landlord pays to unlock a tenant's already-captured report) instead of only being paid for by the person running the capture.
- **Developer-tool CLI ergonomics → the verdict/report design.** Modern CLI ergonomics (think `gh`, `stripe`, `docker`) converge on "one deterministic command, structured default output, human-readable format as an opt-in flag" — which netdoctor already follows closely. The transferable idea here is less about adding a new feature and more validating the current default-JSON/opt-in-prose shape is the right north star as new subcommands (`mint`, future ones) are added, keeping every new verb consistent with that same one-shot, agent-legible contract.


```

## Git Branches
```text
* main                f8f66d7 Add --redact and mint: publish reports as NFTs without local network identity
  remotes/origin/HEAD -> origin/main
  remotes/origin/main f8f66d7 Add --redact and mint: publish reports as NFTs without local network identity
```

## GH PR List (state: all)
- none found

## Prior Runs (candidates.md / spec-final.md)
### 2026-07-27-e3d-netdoctor/candidates.md
```text
---
selected: candidate-1
reason: Highest combined attraction+retention (10) via a genuine network-effect feature with no overlap in existing code, branches, PRs, or prior runs.
---

# Candidates

## Dedup Context

## Current Findings

```text
---
head_sha: f8f66d75efb46d83534726aae40ac72d20792a92
---

# Findings

## Local State

Repo head sha: f8f66d75efb46d83534726aae40ac72d20792a92

Research topics: network diagnostics CLI

Analogy domains to consider: game progression and reward loops; social feed and notification mechanics; marketplace liquidity and two-sided matching; developer-tool CLI ergonomics; fintech trust and verification UX

## Git history
range: last 20 commits
```text
f8f66d7 Add --redact and mint: publish reports as NFTs without local network identity
1667aed Make wallet payment method selectable (default E3D on Ethereum); add OpenAI narrative support
a6586ec Clarify README: E3D wallet payment benefits, agent-first positioning
4f3435b Never return an Inconclusive verdict; add an opt-in --speed-test
7e77e59 Update README for the redesigned report command
85cbc39 Redesign report command: JSON default, markdown/html formats, file/email sinks
ff1a292 Fix Claude narrative generation: stale model, bad params, and truncation
0bc61c0 Add wallet-based payment for paid-report: credits and one-off modes
6c84134 Add README
deda4eb Implement e3d-netdoctor v1: capture, verdict scoring, report, delivery, payment gate
```

## Branches
```text
* main                f8f66d7 Add --redact and mint: publish reports as NFTs without local network identity
  remotes/origin/HEAD -> origin/main
  remotes/origin/main f8f66d7 Add --redact and mint: publish reports as NFTs without local network identity
```

## GH issues and PRs
### gh issue list
- none found
### gh pr list
- none found

## Repo docs
### README.md
```text
# e3d-netdoctor

**Point it at your network. Get told why it's slow.**

A one-shot, no-UI CLI that captures live traffic and figures out whether your
slowdown is your ISP, your own device, or one flaky destination — with its
reasoning shown, not a black-box score. It's just as useful run by hand as it
is scripted into automation, and it's built especially well for agents: the
default output is the same structured JSON an agent already reasons over, no
prose to re-parse and no UI to drive.

No dashboard. No account. No continuous monitoring. Run it, get an answer, move on.

```
$ e3d-netdoctor paid-report --interface en0 --duration 30

Only analyze traffic on networks you are authorized to monitor.
Requesting e3d payment before capture/analysis...
{
  "requestId": "netdoctor:...",
  "payment": { "product": "netdoctor", "creditsSpent": 500, "creditsRemaining": 1500 },
  "findings": {
    "verdict": {
      "headline": "Likely upstream/ISP",
      "confidence": "High",
      "rationale": "7 of 8 independent destinations affected, spanning 3 different providers"
    }
  },
  "narrative": { "..." : "..." }
}
```

## Why this exists

Every network engineer and Wireshark user has had this conversation:

> "Is it my wifi, or is it Comcast again?"

That question is answerable from a single packet capture — *if* you know to group
retransmissions and RTT outliers by destination **and** by local device, and weigh
provider diversity instead of raw destination count. Most people don't do that math
by hand. netdoctor does, every time, and shows its work.

## Humans, automation, and agents — but agents especially

- **Humans** get a one-shot answer without learning Wireshark: run `report`, read a
  plain-English verdict with its reasoning, done. `--format markdown`/`html` and
  `--to` make it easy to read in a terminal, a browser, or an inbox.
- **Automation/CI** gets deterministic exit codes, no interactive prompts, and a
  non-interactive payment path (a pre-provisioned e3d credit key) — safe to run
  unattended on a schedule or in a pipeline.
- **Agents get the most out of it**, because the whole tool is shaped like a single
  tool call: one command, one JSON result. The default `report` output is
  `{ findings, narrative }` — the same structured shape an agent already reasons
  over, not prose it has to re-parse. The verdict is deterministic and rule-based
  (not another LLM call an agent has to trust blindly), the rationale is
  machine-readable text an agent can quote directly back to a user, and there's no
  UI, login, or browser interaction required for the core flow — only the optional
  wallet payment path below touches a browser, and only because that step
  inherently requires a human to approve a transaction.

## What it actually does

1. **Captures** a short live packet trace (`tshark`), or takes a `.pcap` you already have.
2. **Extends** the parse with TCP-health signals `e3d-pcap`'s core parser doesn't
   collect on its own: retransmissions, duplicate ACKs, out-of-order, zero-window
   stalls, per-flow RTT (SYN→SYN-ACK), and DNS response timing.
3. **Corroborates** with host-level checks that don't depend on the capture at all —
   real `ping` and `traceroute` to the destinations the capture flagged, and `netstat`
   for local NIC error/collision counters and TCP-stack retransmit stats.
4. **Scores a verdict** — deterministic, rule-based, unit-tested — into one of three
   categories:

   | Verdict | Means |
   |---|---|
   | **Likely Upstream/ISP** | Signal spread across many unrelated destinations and providers — not one device |
   | **Likely Local** | Signal concentrated on one local device (MAC) across many destinations — bad wifi, flaky NIC, bad cabling |
   | **Likely Destination/Path-Specific** | Signal confined to one or two destinations while everything else is clean |

   Confidence is always shown as reasoning ("7 of 8 destinations, 3 providers"),
   never a bare number. netdoctor always commits to one of these three — it never
   answers "inconclusive." With thin data it still picks the closest match and says
   so plainly in the rationale ("only 2 of the required 3 distinct destinations were
   observed"), rather than declining to call it.
5. **Writes the report** — an executive summary and per-section narrative from
   Claude, grounded strictly in the structured findings (never raw packets), with a
   deterministic fallback if no API key is configured.
6. **Delivers it** by email, with an optional PDF attachment.
7. **Gates it** behind an e3d pay-per-report payment — fails closed, no free runs,
   clear message on how to pay if it's missing. Pay with a pre-provisioned credit
   key (for automation), or with an E3D Token (wE3D) wallet directly (for a human
   with no e3d account) — see [Paying for a report](#paying-for-a-report) below.

## Paying for a report

`paid-report` runs the same capture → verdict → report pipeline above, gated
behind one payment of **500 e3d credits (0.5 E3D or wE3D at the current unit
price, depending on payment method)**. Like `report`, it defaults to printing
JSON to stdout — here that's the payment receipt plus `findings`/`narrative` —
with `--format`/`--output`/`--to` working exactly the same way; email is opt-in
via `--to`, not automatic. There are two ways to pay, aimed at two different
users:

- **A pre-provisioned credit key** (`NETDOCTOR_PAYMENT_CREDIT_KEY`) — for
  automation, CI, or anyone who already has an e3d account funded ahead of time.
  Non-interactive: no browser, no prompts, safe to run unattended on a schedule.
- **`--wallet <address>`** — for a human who wants to pay for a report directly
  with E3D Token, with no e3d account or pre-funded credit key at all:

  ```bash
  e3d-netdoctor paid-report --interface en0 --wallet 0xYourAddress
  ```

  netdoctor prints a one-time URL; open it, connect MetaMask, and approve a single
  token transfer. netdoctor polls in the background and picks up automatically
  once the payment is confirmed — nothing to copy/paste back into the terminal.

  The benefit over the credit-key path isn't just convenience: **your wallet's
  private key never touches netdoctor or any e3d server.** The browser talks
  directly to your wallet and only ever reports a transaction hash back — never a
  secret. netdoctor never sees, asks for, or stores a private key, and you never
  manually handle a tx hash or credit key either; the whole exchange happens over
  a short-lived, single-use payment session it polls for you.

  `--payment-method` picks which chain/token to pay with:
  - **`ethereum`** (default) — pay with **E3D** on Ethereum mainnet.
  - **`base`** — pay with **wE3D** on Base; usually lower gas fees.

  ```bash
  e3d-netdoctor paid-report --interface en0 --wallet 0xYourAddress --payment-method base
  ```

  Two spending modes (independent of which chain you pick):
  - **One-off** (`--wallet <address>`, no `--credits`): pay for exactly this one
    report. Nothing is saved locally — the next `paid-report` starts a fresh
    payment.
  - **Batch** (`--wallet <address> --credits n`): buy a reusable batch of `n`
    credits once; the resulting credit key is saved to
    `~/.config/e3d-netdoctor/config.json` (keyed by wallet address) and reused
    automatically by future `paid-report --wallet` runs until it runs low —
    fewer wallet approvals if you run reports regularly.

See [`docs/payment-gate.md`](docs/payment-gate.md) for the credit-key flow's
configuration and failure-mode details.

## Quickstart

```bash
npm install                      # only local dependency: e3d-pcap
e3d-netdoctor preflight           # confirms tshark is installed
e3d-netdoctor smoke ./fixtures/sample-syn.pcap
e3d-netdoctor report ./fixtures/retransmission-handshake.pcap
```

`report` defaults to printing `{ findings, narrative }` as JSON to stdout —
built for agents to consume directly, no parsing of prose required. Ask for
markdown or HTML instead, write to a file, or email it:

```bash
e3d-netdoctor report ./fixtures/retransmission-handshake.pcap                          # JSON to stdout (default)
e3d-netdoctor report ./fixtures/retransmission-handshake.pcap --format markdown        # markdown to stdout
e3d-netdoctor report ./fixtures/retransmission-handshake.pcap --format html            # HTML to stdout
e3d-netdoctor report ./fixtures/retransmission-handshake.pcap --format html --output out.html
e3d-netdoctor report ./fixtures/retransmission-handshake.pcap --to you@example.com --pdf
```

When `--output` and/or `--to` are used, `report` prints a small JSON summary
(verdict, confidence, output path, delivery info) instead of the raw content.

Add `--speed-test` to also run a real download/upload throughput measurement
(against a public Cloudflare speed-test endpoint) and fold the Mbps numbers
into the System Diagnostics section. It's opt-in — off by default — since it
uses real bandwidth and adds several seconds to the run:

```bash
e3d-netdoctor report ./fixtures/retransmission-handshake.pcap --speed-test
```

Add `--redact` before sharing or publishing a report: it replaces your local
IPs/MACs with stable pseudonyms (`local-device-1`, `local-device-2`, ...) and
strips the local capture file path, while leaving external destination IPs and
ISP traceroute hostnames real — that's the verifiable evidence the report
exists to show, only your own network's identity is hidden. This is also the
precondition for `mint` (below) — nothing gets published or tokenized with
your home network's real IPs/MACs in it.

```bash
e3d-netdoctor report ./fixtures/retransmission-handshake.pcap --redact --output report.json
```

## Minting a report as an NFT

`mint` tokenizes an already-`--redact`ed report as an NFT via `E3DNFTManager`
(the same shared contract used across E3D products — no netdoctor-specific
contract). It requires the saved report file to have `redacted: true` (refuses
otherwise) and `--confirm-public`, since minting pins the report to IPFS
**permanently and publicly**:

```bash
e3d-netdoctor mint report.json --wallet 0xYourAddress --confirm-public
```

netdoctor renders an HTML certificate (from the saved findings/narrative) and
a PNG screenshot of it, uploads both plus the structured findings to IPFS via
e3d.ai, then prints a one-time `https://e3d.ai/mint?session=...` URL — open
it, connect MetaMask, and approve the mint (same no-custodial-keys model as
`--wallet` payments: your wallet signs directly, netdoctor and e3d.ai never
see or touch it). Minting always happens on **Ethereum mainnet** regardless of
which `--payment-method` was used to pay for the report itself, and costs
**100 E3D + gas** — a separate cost from the 500 credits spent generating the
report. Once confirmed, netdoctor prints `{tokenId, txHash, etherscanUrl}`.

Full command list:

```
preflight                                  Check whether tshark is installed locally.
smoke <file.pcap>                          Parse a capture, print rows/diagnostics.
capture [iface] [seconds]                  Run a live tshark capture (default 30s).
report <pcap> [--format json|markdown|html] [--output file] [--to email] [--pdf] [--no-system-diagnostics] [--speed-test] [--redact]
                                            Defaults to JSON on stdout; --format selects markdown/html;
                                            --output writes to a file; --to emails it (--pdf attaches a PDF).
deliver <pcap> <to> [--pdf] [--no-system-diagnostics] [--speed-test]
paid-report [--pcap file | --interface iface] [--duration s] [--format json|markdown|html]
            [--output file] [--to email] [--pdf] [--request-id id] [--speed-test] [--redact]
            [--wallet address [--credits n] [--payment-method ethereum|base]]
                                            Same defaults/flags as report, gated behind a 500-credit
                                            payment (credit key or --wallet).
mint <report.json> --wallet address --confirm-public [--name "..."] [--description "..."]
                                            Tokenize a --redact'd report as an NFT (E3DNFTManager,
                                            Ethereum mainnet). 100 E3D + gas, paid from --wallet.
```

Every capture/analysis entrypoint prints a reminder up front:
**only analyze traffic on networks you are authorized to monitor.**

## No external dependencies to install

Everything beyond parsing (which reuses `e3d-pcap`'s tested core) is built on
Node's standard library and the system tools you already have:

- **Email** — a small SMTP client on `node:net`/`node:tls` (STARTTLS + AUTH LOGIN).
  No `nodemailer`.
- **PDF export** — shells out to a locally installed Chrome/Chromium/Edge with
  `--headless --print-to-pdf`, the same way netdoctor already shells out to
  `tshark`. No `puppeteer`, no bundled Chromium download.
- **Payment client** — a small, self-contained e3d payments client, not a runtime
  dependency on another repo.

`npm install` has nothing left to resolve beyond the one intentional local
dependency (`e3d-pcap`), and nothing to silently fail on a machine without
internet access.

## Configuration

| Purpose | Env vars |
|---|---|
| Narrative generation | `ANTHROPIC_API_KEY` (preferred if set) or `OPENAI_API_KEY` (used if Anthropic's isn't set); falls back to a deterministic template if neither is configured. Optional `NETDOCTOR_ANTHROPIC_MODEL`/`NETDOCTOR_OPENAI_MODEL` to override the default model. |
| Email delivery | `NETDOCTOR_SMTP_HOST`, `NETDOCTOR_SMTP_PORT`, `NETDOCTOR_SMTP_SECURE`, `NETDOCTOR_SMTP_USER`, `NETDOCTOR_SMTP_PASSWORD` |
| PDF export | `NETDOCTOR_BROWSER_PATH` (auto-detected otherwise) |
| Payment gate | `NETDOCTOR_PAYMENT_CREDIT_KEY`, `NETDOCTOR_PAYMENT_SERVICE_KEY`, `E3D_BASE_URL` — see [`docs/payment-gate.md`](docs/payment-gate.md) |

## Testing

```bash
node --test
```

Every external boundary — `tshark`, `ping`/`traceroute`/`netstat`, SMTP, PDF
rendering, the payment API — is exercised through dependency injection so the suite
runs offline and fast, plus a real local-socket SMTP conversation and real fixture
`.pcap` parses so the important paths are proven end-to-end, not just mocked.

```

## TODO/FIXME matches
- none found

## External Context

### External Context

- **Network diagnostics tooling** has converged on two poles: continuous-monitoring dashboards (Smokeping, ThousandEyes, Pingdom) and one-shot capture tools (Wireshark/tshark, `mtr`). netdoctor deliberately sits in the underserved middle — one-shot like `mtr`, but with the multi-signal correlation (retransmits + RTT + provider diversity) that usually only comes from a always-on SaaS dashboard.
- **Deterministic, rule-based verdicts over LLM judgment calls** is the emerging best practice for agent-consumed tools: agents need a stable, auditable decision function they can cite, not another probabilistic model in the loop. netdoctor's refusal to return "Inconclusive" and its rationale-as-text-not-score design mirrors how eval and observability tooling (e.g., structured tracing schemas) is moving away from opaque scalar confidence.
- **Agent-first CLI design** is now a recognized category distinct from "human CLI with a `--json` flag bolted on" — the growing adoption of the Model Context Protocol (MCP) and tool-use schemas has pushed CLI authors toward JSON-as-primary-output, deterministic exit codes, and no interactive prompts in the default path, all of which this repo already follows.
- **Agent-native payments** (x402-style HTTP 402 flows, wallet-signed one-off transactions) are actively being standardized as of 2026 so that autonomous agents can pay per call without holding custodial keys — netdoctor's non-custodial wallet-poll pattern for `paid-report`/`mint` tracks this trend closely.
- **On-chain provenance for reports/certificates** (minting an audit artifact as an NFT with IPFS-pinned evidence) is a small but growing pattern in verifiable-compute and diagnostic-attestation projects, used to create tamper-evident, shareable proof of a finding without exposing the underlying private data — which is exactly what `--redact` + `mint` implements here.

### Analogous Patterns

- **Fintech trust and verification UX** — mechanic: staged disclosure and non-custodial signing (show exactly what's being approved, let the user's own wallet/app do the signing, never touch the secret). netdoctor already does this for payment and minting; the same staged-disclosure UX could extend to the *verdict* itself — e.g., a "verify this diagnosis" mode where the raw per-flow evidence backing a claim (like a bank transaction receipt) is independently reproducible/hashable so a third party can confirm the verdict without re-running the capture.
- **Developer-tool CLI ergonomics** — mechanic: progressive disclosure via subcommands and flags that scale from "just tell me" to "give me everything" (think `git`, `docker`, `kubectl`). netdoctor could adopt a `--explain` or `-v` tier system so the same JSON payload can render as a one-line verdict for scripts, a paragraph for a human skimming a terminal, or a full evidentiary trail for someone debugging the diagnosis itself — reusing the existing narrative layer as the top of that ladder rather than a separate feature.
- **Marketplace liquidity and two-sided matching** — mechanic: matching many small requesters against a pool of resources/providers to keep both sides liquid (Uber/Airbnb-style). Because netdoctor's ISP-vs-local verdict gets stronger with more independent vantage points, the credit-key/payment infrastructure already built for one user could be repurposed as a lightweight two-sided market: other users' netdoctor runs (paid, opt-in, redacted) contribute anonymized "is this provider/destination currently degraded for others too" signal, turning a single-machine tool into a crowd-corroborated one without standing up a monitoring service.


```

## Git Branches
```text
* main                f8f66d7 Add --redact and mint: publish reports as NFTs without local network identity
  remotes/origin/HEAD -> origin/main
  remotes/origin/main f8f66d7 Add --redact and mint: publish reports as NFTs without local network identity
```

## GH PR List (state: all)
- none found

## Prior Runs (candidates.md / spec-final.md)
- none found

## Proposed Candidates

### Candidate 1: Crowd-corroborated destination/ISP health signal
Duplicate: no
Dedup rationale: Checked `main` (only branch, HEAD f8f66d7) and the full README/command list — `report`/`paid-report` only ever reason over a single machine's own capture plus its own `ping`/`traceroute`/`netstat`. No aggregation, opt-in sharing, or cross-user signal exists anywhere in the code, docs, or git history. No open PRs/issues/prior runs to check against either (all empty).
Category: social
Analogy: marketplace liquidity and two-sided matching (Uber/Airbnb-style pooling of many small signals) -- netdoctor's ISP-vs-local verdict gets more confident with more independent vantage points on the same destination/ASN. Opt-in, `--redact`-style anonymized submission of "destination X was flaky for me too, just now" turns every paid/free run into a contribution to a shared liquidity pool, so verdicts about "is it just me or is Comcast/Cloudflare having a bad day" get stronger the more people run the tool — a genuine network effect a single-machine tool can't otherwise have.
Attraction (1-5): 5
Retention (1-5): 5
Effort: high
Revenue (1-5|n/a): 3
Description: Add an opt-in flag (e.g. `--contribute`) that, only after `--redact`, submits a minimal anonymized signal (destination host/ASN, timestamp, verdict category — never local IPs/MACs) to a lightweight e3d-hosted aggregation endpoint. In return, `report`/`paid-report` can add a line like "3 other netdoctor users also saw degraded performance to this destination in the last hour" to the verdict rationale, making the tool's core answer measurably better for everyone without breaking the "no dashboard, no account" positioning (submission and lookup are per-run, not continuous monitoring). This is the single biggest lever for both attraction (a differentiator no competing one-shot tool has) and retention (people re-run it during an outage to see if others are affected too).

### Candidate 2: Referral / credit-sharing growth loop
Duplicate: no
Dedup rationale: Checked README's payment-gate section and `docs/payment-gate.md` references — the existing credit system (`NETDOCTOR_PAYMENT_CREDIT_KEY`, wallet batch credits) has no referral, invite, or bonus-credit mechanic. Only branch is `main`; no PRs/issues/prior candidates exist to overlap with.
Category: marketing
Analogy: consumer-app viral loops (Dropbox/Uber-style "give credits, get credits") layered onto the fintech trust UX netdoctor already has for wallet payments -- since payment is already non-custodial and credit-key based, a referral code that mints bonus credits to both referrer and referee reuses infrastructure that's already built rather than adding a new system.
Attraction (1-5): 4
Retention (1-5): 3
Effort: low
Revenue (1-5|n/a): 3
Description: Let a `paid-report` credit-key holder generate a shareable referral code (via a new `refer` subcommand or flag) that grants both parties bonus credits on the referee's first `paid-report`. Implementation is mostly bookkeeping on top of the existing credit/wallet client — no new payment rails needed. Directly serves the "attract users" goal via word-of-mouth among the sysadmin/dev communities this tool targets, and nudges casual `report` users toward becoming repeat `paid-report` users.

### Candidate 3: CI/GitHub Action packaging with scheduled verdict-diff alerts
Duplicate: no
Dedup rationale: README already documents that `report`/`paid-report` are CI-safe (deterministic exit codes, non-interactive credit-key auth) but there is no packaged GitHub Action, no diffing between runs, and no alerting — confirmed by reading the full command list and repo root (no `.github/actions`, no action.yml). Only `main` branch exists; nothing to duplicate in PRs/issues/prior runs.
Category: workflow
Analogy: developer-tool CLI ergonomics (git/docker/kubectl-style meeting users where they already work) -- packaging what already works as a first-class GitHub Action with a diff-on-verdict-change comment mechanic turns a manually-invoked CLI into something that shows up automatically in a PR or nightly workflow, which is how tools like Lighthouse CI or bundle-size bots got adopted widely.
Attraction (1-5): 3
Retention (1-5): 3
Effort: medium
Revenue (1-5|n/a): 3
Description: Publish a thin GitHub Action wrapping `paid-report`/`report` that runs on a schedule or PR trigger, stores the prior run's JSON as a workflow artifact, and posts a PR comment or Slack message only when the verdict category changes (e.g. "Likely Local -> Likely Upstream/ISP"). No new product logic — just packaging plus a small diff step — but it puts netdoctor in front of teams during their normal CI review flow instead of requiring someone to remember to run it by hand, which is a strong discovery channel (GitHub Marketplace listing) distinct from anything currently built.

### Candidate 4: Free instant "shareable report" link (non-NFT, non-permanent)
Duplicate: no
Dedup rationale: `mint` already publishes a redacted report permanently/publicly as a paid NFT via IPFS — confirmed in README's "Minting a report as an NFT" section. A free, ephemeral, non-blockchain share link is a distinct feature (different cost, different permanence, different audience) and does not exist anywhere in the current code. No branches/PRs/prior runs to conflict with.
Category: social
Analogy: fintech trust/verification UX (staged disclosure of exactly what's shared) combined with social sharing loops (e.g. sharing a Wordle result) -- reuses the same `--redact` guarantee and the same e3d.ai session-hosting mechanism already built for `mint`'s one-time URLs, just pointed at a free, time-limited public view instead of a paid permanent mint.
Attraction (1-5): 4
Retention (1-5): 2
Effort: medium
Revenue (1-5|n/a): 2
Description: Add a `--share` flag to `report` (free tier) that uploads a `--redact`ed report to e3d.ai's existing session-hosting infra (already built for `mint`) and prints a time-limited public URL (e.g. 7-day expiry) instead of requiring a wallet/mint fee. Gives people a zero-friction way to post "here's proof it's my ISP" in a support ticket, subreddit, or Slack thread — each shared link is a free advertisement for the tool to a new audience, funneling some fraction toward `paid-report`/`mint` for permanent evidence.

### Candidate 5: `--explain`/verbosity tiers and independently-reproducible verify mode
Duplicate: no
Dedup rationale: README confirms only one narrative layer exists today (Claude/OpenAI narrative or deterministic template) with no verbosity flag and no independent-verification/hashing mode for the raw evidence. Only `main` branch; no PRs, issues, or prior candidates reference this.
Category: testing
Analogy: developer-tool CLI ergonomics (progressive disclosure via flags, git/docker-style) plus fintech trust/verification UX (a third party can independently confirm a claim without re-doing the underlying work, like verifying a bank receipt) -- applied to netdoctor's verdict evidence rather than just its narrative.
Attraction (1-5): 2
Retention (1-5): 3
Effort: low
Revenue (1-5|n/a): 1
Description: Add a `-v`/`--explain` tier system (quiet verdict -> paragraph -> full per-flow evidentiary trail) reusing the existing narrative layer, plus a `--verify` mode that hashes the structured findings so a third party can confirm a shared/minted report's evidence matches without re-running the capture. Solid quality-of-life and trust improvement, but lower net-new attraction than the other candidates since it refines an existing flow rather than opening a new usage pattern.

---IDEATE-STATUS---
selected: candidate-1
reason: Highest combined attraction+retention (10) via a genuine network-effect feature with no overlap in existing code, branches, PRs, or prior runs.


```

## Proposed Candidates

### Candidate 1: Crowd-corroborated destination/ISP health signal
Duplicate: no
Dedup rationale: Checked `main` (only branch/PR, HEAD still f8f66d7 — repo unchanged since the 2026-07-27 run) and the full command list/README — `report`/`paid-report` still only reason over a single machine's own capture plus its own `ping`/`traceroute`/`netstat`; there is no aggregation endpoint, opt-in sharing, or cross-user signal anywhere in the code. This exact idea was candidate-1 in the 2026-07-27 `candidates.md` and was selected, but no branch, commit, or PR reflects it — it was never built, so it remains a live, non-duplicate opportunity rather than something "already exists."
Category: social
Analogy: marketplace liquidity and two-sided matching (Uber/Airbnb-style pooling of many small signals) -- netdoctor's ISP-vs-local verdict gets more confident with more independent vantage points on the same destination/ASN. Opt-in, `--redact`-style anonymized submission ("destination X was flaky for me too, just now") turns every run into a contribution to a shared pool, so the tool's core answer gets measurably better as more people use it — a genuine network effect a single-machine tool can't otherwise have.
Attraction (1-5): 5
Retention (1-5): 5
Effort: high
Revenue (1-5|n/a): 3
Description: Add an opt-in `--contribute` flag that, only after `--redact`, submits a minimal anonymized signal (destination host/ASN, timestamp, verdict category — never local IPs/MACs) to a lightweight e3d-hosted aggregation endpoint. In return, the verdict rationale can include "3 other netdoctor users also saw degraded performance to this destination in the last hour," making the core answer better for everyone without breaking the "no dashboard, no account" positioning (per-run submission/lookup, not continuous monitoring). Still the single biggest lever for both attraction (no competing one-shot tool has this) and retention (people re-run it during an outage specifically to see if others are affected).

### Candidate 2: Referral / credit-sharing growth loop
Duplicate: no
Dedup rationale: Checked the payment-gate docs and credit/wallet code paths (`NETDOCTOR_PAYMENT_CREDIT_KEY`, wallet batch credits) — no referral, invite, or bonus-credit mechanic exists. This matches candidate-2 from the 2026-07-27 run, also selected as unbuilt (only `main` exists, no PRs/issues); still nothing in code implements it.
Category: marketing
Analogy: consumer-app viral loops (Dropbox/Uber-style "give credits, get credits") layered on netdoctor's existing non-custodial wallet/credit-key trust UX -- reuses built infrastructure instead of adding a new payment system.
Attraction (1-5): 4
Retention (1-5): 3
Effort: low
Revenue (1-5|n/a): 3
Description: Let a credit-key holder generate a shareable referral code (new `refer` subcommand or flag) that grants both parties bonus credits on the referee's first `paid-report`. Mostly bookkeeping on top of the existing credit/wallet client. Directly serves user-attraction via word-of-mouth in the sysadmin/dev communities this tool targets, and nudges free `report` users toward `paid-report`.

### Candidate 3: CI/GitHub Action packaging with scheduled verdict-diff alerts
Duplicate: no
Dedup rationale: Repo root has no `.github/actions` or `action.yml`; README documents CI-safety (deterministic exit codes, non-interactive credit-key auth) but no packaged Action, diffing, or alerting exists. Matches candidate-3 from 2026-07-27, still unbuilt — no branches/PRs since.
Category: workflow
Analogy: developer-tool CLI ergonomics (git/docker/kubectl-style meeting users where they already work) -- packaging what already works as a first-class GitHub Action with a diff-on-verdict-change comment is how tools like Lighthouse CI or bundle-size bots got adopted widely.
Attraction (1-5): 3
Retention (1-5): 3
Effort: medium
Revenue (1-5|n/a): 3
Description: Publish a thin GitHub Action wrapping `paid-report`/`report` that runs on a schedule or PR trigger, stores the prior run's JSON as a workflow artifact, and posts a PR comment/Slack message only when the verdict category changes (e.g. "Likely Local → Likely Upstream/ISP"). Pure packaging plus a small diff step, but puts netdoctor in front of teams during normal CI review — a discovery channel (GitHub Marketplace) distinct from anything currently built.

### Candidate 4: Free instant "shareable report" link (non-NFT, non-permanent)
Duplicate: no
Dedup rationale: `mint` already publishes a redacted report permanently/publicly as a paid NFT via IPFS (confirmed in README) — a free, ephemeral, non-blockchain link is a distinct feature (different cost, permanence, audience) that does not exist in code. Matches candidate-4 from 2026-07-27, still unbuilt.
Category: social
Analogy: fintech staged-disclosure trust UX combined with social sharing loops (e.g., sharing a Wordle result) -- reuses the same `--redact` guarantee and e3d.ai session-hosting mechanism already built for `mint`'s one-time URLs, just pointed at a free, time-limited public view.
Attraction (1-5): 4
Retention (1-5): 2
Effort: medium
Revenue (1-5|n/a): 2
Description: Add a `--share` flag to `report` (free tier) that uploads a `--redact`ed report to e3d.ai's existing session-hosting infra and prints a time-limited public URL (e.g., 7-day expiry) instead of requiring a wallet/mint fee. Zero-friction way to post "here's proof it's my ISP" in a support ticket or subreddit — each shared link advertises the tool to a new audience, funneling some fraction toward `paid-report`/`mint`.

### Candidate 5: Local run-history "reliability streak"
Duplicate: no
Dedup rationale: Checked the config path already in use (`~/.config/e3d-netdoctor/config.json`, currently only storing wallet credit keys) — no run history, trend tracking, or streak/gamification mechanic exists anywhere in code or docs. Not proposed in the 2026-07-27 run's candidate list either, so this is a genuinely new angle for this round, not a repeat.
Category: gamification
Analogy: game progression and reward loops (streak counters, e.g. fitness-app "days active" or Duolingo streaks) -- applied narrowly enough to not contradict the "no dashboard, no account" ethos: purely local, opt-in, surfaced as one extra line at the end of a run rather than a UI.
Attraction (1-5): 2
Retention (1-5): 4
Effort: low
Revenue (1-5|n/a): 1
Description: Append each run's verdict/timestamp to a small local history file already colocated with the existing config, and print one extra line on `report`/`paid-report` completion (e.g., "14 days since your last ISP-flagged verdict" or "3rd Local-device verdict this month — check your wifi hardware"). Costs almost nothing to build, gives repeat users a reason to keep running it instead of forgetting about it, but has modest new-user pull since it only pays off after multiple runs.

---IDEATE-STATUS---
selected: candidate-1
reason: Highest combined attraction+retention (10), a genuine network-effect feature still unbuilt in code/branches despite being the prior run's top pick.


```

## Proposed Candidates

### Candidate 1: MCP server / agent-native tool registration
Duplicate: no
Dedup rationale: Checked both prior runs (2026-07-27, 2026-07-28-e3d-netdoctor-3) — neither proposed MCP packaging. No branch, PR, or code path references an `mcp.json`, MCP server wrapper, or tool-registration manifest. The README's agent-first framing discusses JSON output and exit-code contracts but never MCP registration specifically.
Category: workflow
Analogy: developer-tool CLI ergonomics -- how `gh` and `stripe` became defaults by meeting agents where they already are (registered tool libraries); MCP is the equivalent for AI agents: a published tool schema lets Claude, Cursor, Copilot, etc. invoke `report`/`paid-report` without a human knowing the CLI syntax, turning every agent deployment into a discovery channel.
Attraction (1-5): 5
Retention (1-5): 4
Effort: medium
Revenue (1-5|n/a): 3
Description: Publish a thin MCP server wrapper (an `mcp.json` tool manifest + a lightweight stdio server shim) that exposes `report`, `paid-report`, and `smoke` as typed MCP tools with documented input/output schemas. The tool is already shaped for this — JSON default output, deterministic exit codes, no interactive prompts. Registration in the MCP tool ecosystem (Anthropic's tool registry, Cursor's tool hub, etc.) makes netdoctor discoverable by any agent with MCP capability, compounding every agent deployment into a user-acquisition event. Agents that register it once keep using it, driving both repeat credit spend and referral-by-usage to human operators who see the agent's output.

---

### Candidate 2: Credit tier ladder with unlock bonuses
Duplicate: no
Dedup rationale: Prior run candidate-2 (both runs) was a referral/credit-sharing growth loop — distinct from a tier ladder. No tier-based pricing, bulk-discount, or feature-unlock mechanic appears in any branch, PR, README section, or prior candidate list. The "game progression" analogy in the current findings explicitly mentions this pattern but it was never promoted to a candidate.
Category: gamification
Analogy: game progression and reward loops -- tiered credit economies (e.g., mobile game IAP tiers, GitHub Actions minutes tiers) where bulk purchase unlocks per-unit discounts and feature gates; transfers directly: buying 10 reports costs less per-report than 1, buying 50 permanently unlocks `--speed-test` on all future runs from that credit key, nudging one-off users toward committed pre-funded batches.
Attraction (1-5): 3
Retention (1-5): 4
Effort: low
Revenue (1-5|n/a): 4
Description: Extend the existing credit-key/wallet system with 3–4 purchase tiers: e.g., 1 report = 500 credits, 10 = 4,500 (10% discount), 50 = 20,000 (20% discount) + `--speed-test` unlocked on all runs from the resulting key. Implementation is pricing logic on the e3d credit API side plus a flag check in the CLI (`NETDOCTOR_SPEED_TEST_UNLOCKED` in the stored config). Tier ladders convert trial users into recurring pre-funded buyers and give CI/automation teams a budget-predictable path without changing the non-custodial payment model.

---

### Candidate 3: Versioned OpenAPI findings schema
Duplicate: no
Dedup rationale: Not proposed in either prior run. The current findings' Analogous Patterns section explicitly names this as a transferable mechanic ("formalizing a stable JSON schema, versioned, OpenAPI-described") but it was never elevated to a candidate. No branch, PR, or file in the repo references a schema file, OpenAPI spec, or versioned findings contract.
Category: data
Analogy: developer-tool CLI ergonomics -- typed, versioned API contracts (OpenAPI/JSON Schema) as the mechanism by which `stripe`, `twilio`, and `gh` enabled community integrations without owning them; the same shape applied to the `findings` output lets downstream scripts and agents declare a schema dependency, catch breaking changes via changelog, and build integrations netdoctor never has to maintain.
Attraction (1-5): 3
Retention (1-5): 4
Effort: medium
Revenue (1-5|n/a): 2
Description: Publish a versioned JSON Schema (or OpenAPI component) for the `findings` output field — field names, types, nullable constraints, verdict enum values — alongside a `CHANGELOG.md` and a `schema-version` field injected into every `report` response. Add a `--schema` flag that prints the current schema to stdout (for agent self-inspection). This lets CI pipelines assert `ajv validate findings.json`, lets agents declare typed tool-call return shapes, and signals project maturity to evaluators. Costs almost nothing to build (the shape is already stable) but unlocks community integrations without netdoctor owning the integration surface.

---

### Candidate 4: Public npm global package / Homebrew tap
Duplicate: no
Dedup rationale: Not proposed in either prior run. No `bin` field in `package.json` pointing at a global install target, no `npm publish` workflow, no Homebrew formula, no `.github/workflows/release.yml` — confirmed by reviewing the repo root and git history. The README's Quickstart says `npm install` (local) not `npm install -g e3d-netdoctor`.
Category: marketing
Analogy: developer-tool CLI ergonomics -- `brew install stripe`, `npm install -g vercel`, `curl | sh` as the standard first-run paths for CLI tools that gain users virally; reducing installation from "git clone + npm install" to one command is the single highest-ROI friction reduction for new-user conversion.
Attraction (1-5): 4
Retention (1-5): 2
Effort: low
Revenue (1-5|n/a): 2
Description: Publish `e3d-netdoctor` to npm as a globally installable package (`npm install -g e3d-netdoctor`) and create a Homebrew tap (`brew install e3d/tap/e3d-netdoctor`). Add a `bin` entry in `package.json`, a GitHub Actions release workflow triggered on version tags, and a minimal Homebrew formula pointing at the npm package or a tarball. No product logic changes. The payoff is appearing in `npm search network diagnostics` and `brew search netdoctor`, which are how this tool's target audience (sysadmins, devs) discovers CLI tools.

---

### Candidate 5: Wallet-signed findings attestation (non-NFT)
Duplicate: no
Dedup rationale: Prior candidate-4 (both runs) was a free ephemeral share link (`--share`) — different feature, different mechanism, different audience. `mint` creates a paid, permanent, blockchain-pinned NFT. Wallet-signed attestation is a third distinct thing: a cryptographic signature over a findings hash, no IPFS upload, no gas, no NFT, just a detached signature the wallet produces offline. Not proposed in either prior run; not referenced in any branch, PR, or README section.
Category: other
Analogy: fintech trust and verification UX -- a bank statement signature vs. a full notarization; cheap, offline, verifiable without re-running the capture; useful for ISP dispute letters or SLA claims where the recipient needs to confirm the report is unmodified but doesn't need blockchain provenance.
Attraction (1-5): 3
Retention (1-5): 3
Effort: medium
Revenue (1-5|n/a): 2
Description: Add a `sign` subcommand (or `--sign` flag on `report`) that produces a detached ECDSA signature over the findings JSON hash using the user's wallet (same non-custodial signing flow already built for `paid-report` and `mint` — print a one-time URL, wallet signs, netdoctor polls for the signature). Output: `{ findingsHash, signature, signerAddress, timestamp }` appended to the report JSON. Recipients can independently verify the hash matches the findings without re-running a capture, without blockchain fees, and without trusting netdoctor's servers. A cheaper, faster alternative to `mint` for the ISP-complaint or SLA-dispute use case where permanence isn't required.

---IDEATE-STATUS---
selected: candidate-1
reason: Highest combined attraction+retention (9), directly amplifies the agent-first positioning already central to the product, and no competing tool in the space has done it.

