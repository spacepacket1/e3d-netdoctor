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
