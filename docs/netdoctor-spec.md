# Feature Ticket Spec: e3d-netdoctor v1

## Summary

Build **e3d-netdoctor**: a one-shot, agentic, no-UI tool that captures and analyzes local network traffic with `tshark`, scores a confidence-rated verdict on why the network is slow, writes a plain-English report, and delivers it by email (optionally PDF) — gated behind an e3d pay-per-report payment.

This is not a UI product and not a general-purpose network health dashboard. The deliverable is a standalone repository, **`e3d-netdoctor`**, that depends on the existing `e3d-pcap` parsing core rather than reimplementing packet parsing, and that answers one specific, validated user complaint: **"why is my network slow?"**

---

## Why This Exists

- Ties to e3d's two primary goals: drive agent awareness/usage of e3d, and grow real E3D Token volume through the e3d payment APIs.
- Targets a real, pre-existing distribution channel — the founder's LinkedIn network of network engineers and Wireshark users, many of whom also support AWS resources and struggle with visibility.
- Deliberately no UI. That space (dashboards, packet graphers) is judged too competitive; the differentiation is agentic analysis and push delivery, not a website.
- The anchor use case is validated directly from the target audience, not guessed: "retransmissions is the one I see most," and upstream/ISP-vs-local ambiguity (e.g. Xfinity) is a recurring, currently unanswerable question for this audience.

---

## Product Requirements

> **Superseded (post-v1):** the "Inconclusive" outcome described below was later
> removed by explicit product decision — netdoctor now always commits to one of
> the three concrete verdicts, with Low confidence and an honest rationale for
> thin-data cases, instead of declining to call it. See `src/verdictScoring.js`.

### The v1 report must:

- Lead with a **headline verdict**: Likely Upstream/ISP, Likely Local, Likely Destination/Path-Specific, or Inconclusive — with an explainable confidence rationale, not a bare score.
- Include supporting findings: bandwidth hogs (top talkers), TCP health (retransmissions, duplicate ACKs, zero-window stalls), latency/RTT outliers, DNS response slowness, broadcast/multicast noise, and a chatty/misbehaving device flag.
- Include a 3–5 bullet plain-English executive summary written by an agent, not a stats dump.
- Be delivered by email, with an optional PDF attachment.
- Be gated behind an e3d pay-per-report payment.
- Only run against networks the user is authorized to monitor — this guardrail must be visible in tool output/docs, not just implied.

### Verdict scoring methodology

Group the retransmission/RTT-outlier signal two ways: by external destination, and by local device (MAC).

- **Likely upstream/ISP** — signal spread across most independent, unrelated external destinations (diversity across providers/ASNs weighted higher than raw destination count), not confined to a single local device.
- **Likely local** — signal confined to one local device across many destinations (bad wifi link, flaky NIC, cabling).
- **Likely destination/path-specific** — signal confined to one or two destinations while most traffic is clean.
- ~~**Inconclusive** — not enough distinct destinations or traffic volume to make a credible call. A confident wrong call off thin data costs more trust with this audience than an honest "inconclusive."~~ *(superseded — see note above; thin-data cases now fall back to the closest of the three concrete verdicts instead.)*

Confidence is shown as explainable reasoning — e.g. "Confidence: High — 7 of 8 independent destinations affected, spanning 3 different providers" — never an opaque number.

---

## Non-Goals (v1)

- Plaintext-protocol / security flags — a different pain point ("is something wrong," not "why is it slow"); candidate for a later, separate "security pass" report type.
- Continuous monitoring, learned baselines, real-time text alerts, historical trend reports.
- Dual capture point (LAN-side + WAN-side) for higher-confidence local/upstream proof.
- AWS traffic correlation as its own vertical — a light IP-range tagging feature is plausible later but not required for v1.
- Credits/subscription payment model — v1 is pay-per-report only.
- Any reuse of or change to core `e3d`'s `pcapRoutes.js` / `PcapView.js` — a separate, actively-maintained product, entirely out of scope here (see Context below).

---

## Context: Source of Truth for PCAP Handling

Resolved 2026-07-03. `e3d-pcap` is the correct and only dependency for netdoctor:

- Core `e3d`'s `server/pcapRoutes.js` / `client/src/PcapView.js` is a separate, actively-maintained production feature (`/pcap` route) feeding an account-gated, quota-limited, ClickHouse-backed "PCAP Topology Intelligence" product (paid Stories/Theses on network topology, per `e3d/docs/e3d_pcap_topology_spec.md`). It has real users and must not be touched or depended on here.
- `e3d-pcap` was deliberately built (per `e3d/docs/e3d_pcap_repo_recovery_spec.md`) as a standalone, dependency-free parsing core after a prior session's accidental local-viewer work was extracted out of core `e3d`. That cleanup was verified complete — no leftover `localPcap*` files remain in core `e3d`.
- `e3d-pcap`'s parsing core has zero E3D-only dependencies (no auth, no hosted persistence) by design, which matches netdoctor's no-account, no-UI model.

---

## Resolved Decisions: Reuse Boundaries (2026-07-03)

Three implementation ambiguities identified during spec review, resolved as follows:

1. **tshark field extraction (Phase 2) is a scoped exception to the "no copy-paste" rule.** `e3d-pcap/server/localPcapParse.js`'s `runTsharkPacketFields` hardcodes its tshark `-e` field list and does positional tab-split parsing in-body — there is no extension point to add fields through, and `e3d-pcap` must not be modified. Netdoctor forks this one function into its own module, starting from the same field list, and adds the new TCP-analysis/RTT fields there. `parsePcapFile`/`aggregatePacketRecords` and everything else continue to be imported unmodified from `e3d-pcap` — this exception is scoped only to the tshark field-extraction shell-out, not a general license to fork `e3d-pcap` code.
2. **`e3d/server/send_newsletter.js` is a reference, not an import.** The file self-executes `sendNewsletterToSubscribers()` at module scope and connects to core e3d's MongoDB/`User` model on `require` — importing it directly would trigger that side effect. Netdoctor implements its own small mailer module, modeled on `send_newsletter.js`'s nodemailer transporter config (host/port/auth shape), not by requiring the file.
3. **`createPdfFromHtml` is rewritten, not revived as-is.** The original hardcodes a Linux-specific Chrome path (`/root/.cache/puppeteer/chrome/linux-131.0.6778.204/...`) that doesn't exist on other OS/arch combinations, and `puppeteer` isn't even installed in `e3d/server` today — the function is currently non-functional if called. Netdoctor's version drops the hardcoded `executablePath`, uses the full `puppeteer` package (not `puppeteer-core`) so it launches its own bundled, OS/arch-matched Chromium, and wraps browser launch/close in `try/finally` so a `page.pdf()` failure can't leak the browser process.

---

# Phased Implementation Plan

Each phase below is scoped to be run as its own `codex-spec-runner` ticket. Phases are ordered so the project is left in a working, testable state after any phase.

---

## Phase 1 — Repo Scaffolding & e3d-pcap Dependency Wiring

### Objective

Stand up a runnable `e3d-netdoctor` project skeleton that depends on the existing, tested `e3d-pcap` parsing core rather than reimplementing it.

### Scope

- Initialize root `package.json` with `dev`, `test`, `build` scripts.
- Add a dependency path to `e3d-pcap`'s parsing modules — `localPcapParse.js`, `tsharkCheck.js`, `localPcapEnrichment.js` — as a local/workspace reference (not published to npm).
- Add a CLI entrypoint that runs the `tsharkCheck` preflight and reports install status using the existing install-hint text.
- Confirm a sample `.pcap` file round-trips through the imported `parsePcapFile` with output identical to running it inside `e3d-pcap` directly.

### Requirements

- No copy-pasted duplication of `e3d-pcap` parsing logic — import or reference it directly. (Phase 2 carves a scoped, resolved exception for the tshark field-extraction shell-out only — see Resolved Decisions above.)
- Must not depend on anything from core `e3d` (`pcapRoutes.js`, ClickHouse, Mongo, auth).
- Works with a plain local `npm install && npm test`, no hosted services required.

### Acceptance Criteria

- `npm install` succeeds from a clean clone.
- A CLI smoke command parses a sample `.pcap` and prints aggregated rows/diagnostics.
- The preflight check correctly reports tshark installed/missing with the existing install hint text.

### Verification

- `cd /Users/mini/e3d-netdoctor && npm install`
- `cd /Users/mini/e3d-netdoctor && npm test`
- Run the smoke command against a known sample `.pcap`, confirm non-empty `rows`/`diagnostics`.

### Codex-spec-runner ticket suggestions

- `netdoctor-repo-scaffold`
- `netdoctor-pcap-dependency-wiring`
- `netdoctor-tshark-preflight-check`

---

## Phase 2 — Extend Tshark Field Extraction

### Objective

Extend the imported parsing pipeline to capture TCP health signals not currently extracted by `e3d-pcap`, since v1's core value (retransmission-based diagnosis) depends on them.

### Scope

- Fork `runTsharkPacketFields` from `e3d-pcap/server/localPcapParse.js` into a netdoctor-owned module (e.g. `src/tsharkExtendedFields.js`) rather than modifying `e3d-pcap` — its field list and positional tab-parsing have no extension point. Start from the same field list and add the new ones there; continue importing `parsePcapFile`/`aggregatePacketRecords` unmodified from `e3d-pcap` for anything that doesn't need the new fields.
- Add `tcp.analysis.retransmission`, `tcp.analysis.duplicate_ack`, `tcp.analysis.out_of_order` to the forked tshark `-e` field list.
- Add per-flow RTT capture (SYN → SYN-ACK timing).
- Extend the aggregation step to roll these fields up per conversation (counts per flag type, RTT samples/percentiles).
- Preserve the existing aggregation output shape for fields already present.

### Requirements

- This fork is an explicit, resolved exception to Phase 1's "no copy-paste" rule (see Resolved Decisions above), scoped only to the tshark field-extraction shell-out.
- New fields must not unacceptably increase parse time for a typical home-network capture relative to the existing `DEFAULT_PARSE_TIMEOUT_MS`.
- Extraction failures for new fields must degrade gracefully — a missing field is not a parse failure.

### Acceptance Criteria

- Parsing a sample capture with known retransmissions produces non-zero retransmission counts attributed to the correct conversations.
- RTT values are present and plausible (non-negative, consistent with capture conditions) for conversations with a visible handshake.

### Verification

- Unit tests against a fixture `.pcap` with induced or recorded retransmissions, asserting expected counts.
- Server-side test suite run (`npm run test:server` equivalent in `e3d-netdoctor`).

### Codex-spec-runner ticket suggestions

- `netdoctor-tcp-analysis-fields`
- `netdoctor-rtt-extraction`
- `netdoctor-aggregation-extension`

---

## Phase 3 — Verdict Scoring

### Objective

Implement the local/upstream/destination-specific/inconclusive verdict logic with explainable confidence, per the scoring methodology above.

> **Superseded (post-v1):** the "Inconclusive" category and its acceptance
> criterion below were removed by a later product decision — see the note in
> Product Requirements above.

### Scope

- Group retransmission/RTT-outlier signal by external destination and by local device (MAC).
- Implement the four-category verdict classifier.
- Compute and format the confidence rationale as human-readable text, not a bare score.
- Handle the low-sample-size case explicitly — too few distinct destinations/conversations returns Inconclusive rather than a forced guess.

### Requirements

- Verdict logic must be deterministic and unit-testable independent of the LLM narrative step (Phase 5) — this is rule-based, not model-based.
- Provider/ASN diversity, not just destination-IP count, must factor into confidence.

### Acceptance Criteria

- A synthetic dataset with retransmissions spread across many unrelated destinations returns "Likely upstream/ISP" with high confidence.
- A synthetic dataset with retransmissions confined to one local MAC returns "Likely local."
- A synthetic dataset with too few destinations returns "Inconclusive" rather than guessing.

### Verification

- Unit tests covering all four verdict categories against constructed fixture data.
- Manual review of at least one real capture's verdict output for plausibility.

### Codex-spec-runner ticket suggestions

- `netdoctor-verdict-classifier`
- `netdoctor-confidence-rationale`
- `netdoctor-verdict-unit-tests`

---

## Phase 4 — Live Capture Invocation

### Objective

Allow netdoctor to run a live, timed capture directly, rather than requiring the user to supply an existing `.pcap` file.

### Scope

- Add a capture entrypoint using a timed `tshark -i <interface> -a duration:<N> -w <tmpfile>` invocation.
- Feed the resulting temp file into the existing (now-extended) file-based parser.
- Clean up the temp capture file after parsing completes, mirroring `e3d-pcap`'s existing `tempCaptureFile.js` pattern.
- Surface a clear error when no interface is available or capture permissions are insufficient.

### Requirements

- Default capture duration short enough for a one-shot report UX (tens of seconds to a couple minutes, not hours).
- Hard timeout required — must not silently capture indefinitely.
- The authorized-network guardrail must be stated in tool output/docs at this entrypoint.

### Acceptance Criteria

- Running the capture entrypoint against a local interface produces a valid temp `.pcap` file.
- The temp file is removed after parsing, on both success and failure.
- Missing permissions produce an actionable error message, not a silent hang.

### Verification

- Manual run against a real local interface; confirm file creation/cleanup and that parsed output matches expectations.
- Test the permission-denied path produces the expected error.

### Codex-spec-runner ticket suggestions

- `netdoctor-live-capture-entrypoint`
- `netdoctor-capture-cleanup`
- `netdoctor-capture-permission-errors`

---

## Phase 5 — Report Generation

### Objective

Turn the scored, aggregated findings into a written report: a plain-English executive summary plus supporting sections, rendered into a new netdoctor-specific HTML template.

### Scope

- Call Claude with the structured findings (verdict, confidence rationale, bandwidth hogs, TCP health stats, RTT outliers, DNS slowness, broadcast/multicast noise, chatty-device flags) to generate the executive summary and section narratives.
- Build a new HTML email template for netdoctor — not a reuse of the crypto-newsletter markup — following the pattern in `e3d/buildDB/write_storybook_enhanced.js`: structured data → Claude narrative → template fill.
- Keep the LLM prompt scoped to structured summary/metrics, not raw packet dumps — same "don't hallucinate beyond evidence" principle used in core `e3d`'s story pipeline.

### Requirements

- Report must lead with the headline verdict and confidence rationale, not bury it.
- Narrative sections must be traceable back to underlying structured findings — no unsupported claims.
- Template must render cleanly in common email clients.

### Acceptance Criteria

- Given a sample scored-findings object, the pipeline produces a complete HTML report with headline verdict, executive summary, and all supporting sections populated.
- Report renders correctly both as a standalone HTML file and as an email body.

### Verification

- Generate a report from a real captured/parsed sample; manually review for accuracy and readability.
- Confirm no raw packet payload data appears in the rendered report (privacy check).

### Codex-spec-runner ticket suggestions

- `netdoctor-report-narrative-generation`
- `netdoctor-report-html-template`
- `netdoctor-report-privacy-check`

---

## Phase 6 — Delivery

### Objective

Deliver the finished report to the requester by email, with an optional PDF attachment.

### Scope

- Build netdoctor's own nodemailer/SMTP mailer module, modeled on the transporter config in `e3d/server/send_newsletter.js` (host/port/auth shape) — read as reference only, not imported, since that file self-executes on `require` and is coupled to core e3d's Mongo/`User` model. Trigger sends per paid request rather than via a subscriber-list/broadcast model.
- Rewrite `createPdfFromHtml` locally using the full `puppeteer` package (not `puppeteer-core`) so it launches its own bundled, OS/arch-matched Chromium instead of the original's hardcoded Linux `executablePath`; wrap browser launch/close in `try/finally`. The original in `send_newsletter.js` is currently non-functional as a direct dependency — `puppeteer` isn't installed in `e3d/server`.
- Set sender identity/from-address and subject line conventions appropriate for netdoctor.

### Requirements

- Delivery is triggered by the orchestration flow (post-payment, post-report-generation), not on a schedule.
- Send failures must be handled explicitly — retry or a clear error surfaced to the requester/agent, never a silent drop.

### Acceptance Criteria

- A generated report is successfully emailed to a test address with the correct subject/sender.
- The PDF attachment, when enabled, matches the HTML report content.
- A simulated SMTP failure surfaces a clear error rather than failing silently.

### Verification

- Manual end-to-end send to a real inbox; confirm rendering and, if enabled, the PDF attachment.
- Test the failure path by pointing at an invalid SMTP config.

### Codex-spec-runner ticket suggestions

- `netdoctor-email-delivery`
- `netdoctor-pdf-export`
- `netdoctor-delivery-failure-handling`

---

## Phase 7 — e3d Payment Gate

<!-- runner:model=high -->

### Objective

Gate report generation behind a pay-per-report e3d payment, modeled on the existing `ensure-maps-credits.ts` pattern in `e3d-agent`.

### Scope

- Wire a payment check/charge into the orchestration flow before capture/analysis begins.
- Reuse `payments-client.ts` from `e3d-agent` for the actual payment call.
- Define the pay-per-report price point and the failure behavior if payment fails, or if capture/analysis fails after payment succeeds.

### Requirements

- Must not run a capture/analysis for free due to a bypassed or missing payment check.
- Payment failure must produce a clear, actionable message, not a silent skip.
- Post-payment failure behavior (retry, refund, or credit) must be explicitly decided and documented, not left undefined.

### Acceptance Criteria

- A request without a successful payment does not receive a report.
- A request with a successful payment triggers the full capture → analyze → score → report → deliver pipeline.
- Failure after payment has defined, documented behavior.

### Verification

- End-to-end test simulating a successful payment, confirming full pipeline execution.
- End-to-end test simulating a failed/missing payment, confirming the pipeline does not run.

### Codex-spec-runner ticket suggestions

- `netdoctor-payment-gate`
- `netdoctor-payment-failure-handling`
- `netdoctor-e2e-paid-report-flow`

---

# Reuse Strategy

Preferred reuse targets (do not reimplement):

- `e3d-pcap/server/localPcapParse.js` — `parsePcapFile`/`aggregatePacketRecords` imported directly for the base flow; the tshark field-extraction shell-out (`runTsharkPacketFields`) is forked into netdoctor and extended with the new TCP-analysis/RTT fields (Phase 2) since `e3d-pcap` has no extension point for it and must not be modified.
- `e3d-pcap/server/tsharkCheck.js` — tshark-installed health check with install hints.
- `e3d-pcap/server/localPcapEnrichment.js` — optional IP/MAC → hostname/vendor enrichment.
- `e3d-pcap/server/tempCaptureFile.js` — temp capture file handling pattern.
- `e3d/server/send_newsletter.js` — read as reference only for its nodemailer/SMTP transporter config; not imported (it self-executes on `require` and is coupled to core e3d's Mongo/`User` model). Netdoctor implements its own mailer module modeled on it.
- `e3d/buildDB/write_storybook_enhanced.js` — the structured-data → Claude-narrative → template pipeline pattern (not its data source or template).
- `e3d/server/send_newsletter.js`'s `createPdfFromHtml` — rewritten, not copied: drop the hardcoded Linux `executablePath`, use the full `puppeteer` package's bundled Chromium instead.
- `e3d-agent/src/e3d/payments-client.ts` and `e3d-agent/src/strategies/ensure-maps-credits.ts` — payment gate pattern.

New code, scoped to what's genuinely net-new:

- TCP analysis field extraction and RTT capture (Phase 2).
- Verdict scoring logic (Phase 3).
- Live capture invocation (Phase 4).
- Netdoctor-specific report template and narrative orchestration (Phase 5).
- Payment gate wiring specific to netdoctor's per-request flow (Phase 7).

---

# Future Enhancements (Post-v1)

- Continuous monitoring with a learned baseline for real anomaly detection.
- Real-time text alerts.
- Historical/trend reports.
- AWS traffic correlation as its own vertical — bridges toward a second vertical for the same audience, who also manage AWS resources.
- Dual capture point (LAN + WAN) for high-confidence local-vs-upstream proof.
- A separate security/plaintext-protocol report pass.
- Credits/subscription payment model.

---

# Success Metrics

Tied directly to e3d's primary goals, not vanity metrics:

- Report shares/forwards — is the artifact good enough that recipients pass it around unprompted (the distribution loop this whole plan depends on).
- Agent-triggered e3d payment volume via pay-per-report.
- Repeat usage / return requests from the same user or agent.

---

# Final Deliverables

- Standalone repository `/Users/mini/e3d-netdoctor`, depending on `e3d-pcap`'s parsing core (not core `e3d`'s `pcapRoutes.js`).
- A working one-shot pipeline: live capture (or supplied `.pcap`) → extended tshark analysis → verdict scoring → agent-written report → email/PDF delivery.
- A pay-per-report gate wired to e3d payments.
