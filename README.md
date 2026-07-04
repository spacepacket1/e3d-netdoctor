# e3d-netdoctor

**Point it at your network. Get told why it's slow.**

A one-shot, agentic, no-UI CLI that captures live traffic, figures out whether your
slowdown is your ISP, your own device, or one flaky destination — and emails you a
plain-English report that says so, with its reasoning shown, not a black-box score.

No dashboard. No account. No continuous monitoring. Run it, get an answer, move on.

```
$ e3d-netdoctor paid-report you@example.com --interface en0 --duration 30

Only analyze traffic on networks you are authorized to monitor.
Requesting e3d payment before capture/analysis...
{
  "verdict": "Likely upstream/ISP",
  "confidence": "High",
  "rationale": "7 of 8 independent destinations affected, spanning 3 different providers",
  "subject": "e3d netdoctor report: Likely upstream/ISP (2026-07-04)"
}
```

## Why this exists

Every network engineer and Wireshark user has had this conversation:

> "Is it my wifi, or is it Comcast again?"

That question is answerable from a single packet capture — *if* you know to group
retransmissions and RTT outliers by destination **and** by local device, and weigh
provider diversity instead of raw destination count. Most people don't do that math
by hand. netdoctor does, every time, and shows its work.

## What it actually does

1. **Captures** a short live packet trace (`tshark`), or takes a `.pcap` you already have.
2. **Extends** the parse with TCP-health signals `e3d-pcap`'s core parser doesn't
   collect on its own: retransmissions, duplicate ACKs, out-of-order, zero-window
   stalls, per-flow RTT (SYN→SYN-ACK), and DNS response timing.
3. **Corroborates** with host-level checks that don't depend on the capture at all —
   real `ping` and `traceroute` to the destinations the capture flagged, and `netstat`
   for local NIC error/collision counters and TCP-stack retransmit stats.
4. **Scores a verdict** — deterministic, rule-based, unit-tested — into one of four
   categories:

   | Verdict | Means |
   |---|---|
   | **Likely Upstream/ISP** | Signal spread across many unrelated destinations and providers — not one device |
   | **Likely Local** | Signal concentrated on one local device (MAC) across many destinations — bad wifi, flaky NIC, bad cabling |
   | **Likely Destination/Path-Specific** | Signal confined to one or two destinations while everything else is clean |
   | **Inconclusive** | Not enough traffic to make a credible call — and it says so, instead of guessing |

   Confidence is always shown as reasoning ("7 of 8 destinations, 3 providers"),
   never a bare number. A confident wrong call costs more trust with this audience
   than an honest "inconclusive."
5. **Writes the report** — an executive summary and per-section narrative from
   Claude, grounded strictly in the structured findings (never raw packets), with a
   deterministic fallback if no API key is configured.
6. **Delivers it** by email, with an optional PDF attachment.
7. **Gates it** behind an e3d pay-per-report payment — fails closed, no free runs,
   clear message on how to pay if it's missing.

## Quickstart

```bash
npm install                      # only local dependency: e3d-pcap
e3d-netdoctor preflight           # confirms tshark is installed
e3d-netdoctor smoke ./fixtures/sample-syn.pcap
e3d-netdoctor report ./fixtures/retransmission-handshake.pcap out.html
```

Full command list:

```
preflight                                  Check whether tshark is installed locally.
smoke <file.pcap>                          Parse a capture, print rows/diagnostics.
capture [iface] [seconds]                  Run a live tshark capture (default 30s).
report <pcap> [out.html] [--no-system-diagnostics]
deliver <pcap> <to> [--pdf] [--no-system-diagnostics]
paid-report <to> [--pcap file | --interface iface] [--duration s] [--pdf] [--request-id id]
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
| Narrative generation | `ANTHROPIC_API_KEY` (falls back to a deterministic template if unset) |
| Email delivery | `NETDOCTOR_SMTP_HOST`, `NETDOCTOR_SMTP_PORT`, `NETDOCTOR_SMTP_SECURE`, `NETDOCTOR_SMTP_USER`, `NETDOCTOR_SMTP_PASSWORD` |
| PDF export | `NETDOCTOR_BROWSER_PATH` (auto-detected otherwise) |
| Payment gate | `NETDOCTOR_PAYMENT_CREDIT_KEY`, `NETDOCTOR_PAYMENT_SERVICE_KEY`, `E3D_BASE_URL` — see [`docs/payment-gate.md`](docs/payment-gate.md) |

## Non-goals (v1)

Deliberately out of scope for now — see [`docs/netdoctor-spec.md`](docs/netdoctor-spec.md)
for the full reasoning: security/plaintext-protocol flags, continuous monitoring or
learned baselines, dual capture points, AWS traffic correlation, credits/subscription
pricing.

## Testing

```bash
node --test
```

Every external boundary — `tshark`, `ping`/`traceroute`/`netstat`, SMTP, PDF
rendering, the payment API — is exercised through dependency injection so the suite
runs offline and fast, plus a real local-socket SMTP conversation and real fixture
`.pcap` parses so the important paths are proven end-to-end, not just mocked.
