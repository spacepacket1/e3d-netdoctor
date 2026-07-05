Implement e3d-netdoctor per the phased spec at `docs/netdoctor-spec.md` in this repo (`/Users/mini/e3d-netdoctor`).

## What this is

e3d-netdoctor is a one-shot, agentic, no-UI tool: point it at a network, get told why it's slow. It captures traffic with `tshark`, scores a confidence-rated verdict (Likely Upstream/ISP vs. Likely Local vs. Likely Destination-Specific — the original v1 prompt below also included an Inconclusive category, later removed by product decision so the verdict always commits to one of the three), writes a plain-English report, and delivers it by email — gated behind an e3d pay-per-report payment. Read the spec's Summary, Product Requirements, and Non-Goals sections in full before writing any code; they explain what's deliberately excluded and why (no UI, no continuous monitoring yet, no security/plaintext-protocol pass yet).

## How to work

Go through the spec's 7 phases in order: repo scaffolding & e3d-pcap dependency wiring → tshark field extraction → verdict scoring → live capture invocation → report generation → delivery → e3d payment gate. Each phase lists Objective / Scope / Requirements / Acceptance Criteria / Verification — treat Acceptance Criteria as that phase's definition of done, and run the Verification steps before starting the next phase. Don't skip ahead or batch phases together; each one is scoped to leave the project in a working, testable state on its own.

## Constraints that matter, not just nice-to-haves

- Depend on `/Users/mini/e3d-pcap`'s parsing core (`localPcapParse.js`, `tsharkCheck.js`, `localPcapEnrichment.js`, `tempCaptureFile.js`) — import or reference it, never copy-paste or reimplement its logic. Exception: Phase 2's tshark field-extraction shell-out (`runTsharkPacketFields`) has no extension point for the new TCP-analysis/RTT fields, so it is forked into netdoctor rather than modified in place — see `docs/netdoctor-spec.md`'s "Resolved Decisions" section (2026-07-03). Everything else in `e3d-pcap` is still imported directly, never copied.
- Do not modify anything in `/Users/mini/e3d-pcap` or core `/Users/mini/e3d`. Both are separate, live repos with their own concerns unrelated to this project — `e3d-pcap` is a standalone viewer with its own users, and core `e3d`'s `pcapRoutes.js`/`PcapView.js` is a live, account-gated, unrelated product. The spec's "Context" section explains why these are intentionally kept apart; read it before touching either repo.
- No UI. This is a deliberate product decision, not an oversight — see the spec's "Why This Exists."
- The capture entrypoint must only run against networks the user is authorized to monitor, and must say so in its own output/docs, not just assume it.
- Verdict confidence must be shown as explainable reasoning (e.g. "7 of 8 independent destinations affected, spanning 3 providers"), never a bare score — this audience (network engineers/Wireshark users) will distrust an opaque number.

## Reuse before you build

The spec's "Reuse Strategy" section catalogs what to lean on instead of writing from scratch — most notably:

- `/Users/mini/e3d/server/send_newsletter.js` and `/Users/mini/e3d/buildDB/write_storybook_enhanced.js` for the email/report-generation pattern (structured data → Claude narrative → HTML template → send). Reuse the *pattern*, not the subscriber-list/broadcast model or the crypto-newsletter's template markup. `send_newsletter.js` specifically is reference-only, not an import (it self-executes on `require`) — model netdoctor's mailer and `createPdfFromHtml` on it, don't require the file directly; see the spec's Resolved Decisions section for why.
- `/Users/mini/e3d-agent/src/e3d/payments-client.ts` and `/Users/mini/e3d-agent/src/strategies/ensure-maps-credits.ts` for the payment gate pattern.

## If something doesn't line up

If the spec is ambiguous, or conflicts with what you actually find in `e3d-pcap` or elsewhere (APIs may have moved on since the spec was written), stop and flag it rather than guessing or silently working around it.
