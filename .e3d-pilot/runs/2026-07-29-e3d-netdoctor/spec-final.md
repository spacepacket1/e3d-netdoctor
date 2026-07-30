# Agent-Native MCP Server for e3d-netdoctor

## Overview

Add a dependency-free Model Context Protocol (MCP) stdio server that exposes e3d-netdoctor’s existing `report`, `paid-report`, and `smoke` workflows as typed tools. The existing executable will gain an `mcp` mode, and a root `mcp.json` will provide ready-to-use client registration.

The adapter must delegate to the existing CLI implementation, preserve its payment and diagnostic behavior, and keep protocol stdout free of notices, logs, and other non-JSON-RPC output.

## Goals

- Expose `netdoctor_report`, `netdoctor_paid_report`, and `netdoctor_smoke` as typed MCP tools.
- Support MCP initialization, tool discovery, tool invocation, ping, notifications, and standard JSON-RPC errors over stdio.
- Return structured JSON results that agents can consume without parsing CLI prose.
- Preserve the existing non-interactive credit-key payment path for `paid-report`.
- Provide a portable `mcp.json` registration using `e3d-netdoctor mcp`.
- Keep the implementation dependency-free, offline-testable, and under the aggregate limit of 25 changed files and 600 changed lines.

## Non-Goals

- Publishing to an MCP registry or marketplace.
- Adding npm dependencies or changing the package lockfile.
- Reimplementing packet parsing, report generation, capture, payment, wallet, delivery, or verdict logic.
- Exposing interactive wallet payment, email delivery, report file output, minting, or live capture as separate MCP tools.
- Changing existing CLI command behavior or JSON response shapes.
- Adding an HTTP, SSE, WebSocket, daemon, dashboard, account, or continuous-monitoring service.

## Existing Files

- `bin/e3d-netdoctor.js` loads `.env` before dynamically importing the CLI.
- `src/cli.js` exports `runCli(argv, deps)` and supports dependency-injected streams and external boundaries.
- `test/cli.test.js` demonstrates in-memory stdout/stderr capture and dependency injection.
- `package.json` already registers `e3d-netdoctor` as the executable, so MCP can use an `mcp` subcommand without adding another package binary.
- `README.md` documents the agent-first JSON contract and current command/configuration behavior.
- `fixtures/sample-syn.pcap` may be read by tests or examples but must not be modified.
- `package-lock.json` and `scripts/build.js` are protected and must remain unchanged.

## Shared Constraints

- Do not modify any protected path: `fixtures/**`, `scripts/build.js`, `package-lock.json`, `.codex-spec-runner/**`, `.claude/**`, or `.git/**`.
- Use only Node.js standard-library APIs and existing project modules; do not add dependencies.
- Keep all protocol traffic on stdout as newline-delimited JSON-RPC 2.0 messages, one complete JSON object per line. Send operational diagnostics to captured buffers or stderr, never protocol stdout.
- Invoke existing behavior through `runCli`; do not duplicate report, payment, capture, parsing, redaction, or verdict logic.
- MCP tool calls must be non-interactive. `netdoctor_paid_report` uses the existing `NETDOCTOR_PAYMENT_CREDIT_KEY` flow and must not expose wallet-browser options.
- Tool descriptions and documentation must retain the authorized-network-use guardrail.
- Reject malformed or unsupported inputs before invoking the CLI.
- Do not disclose environment variables, payment keys, raw packet payloads, or stack traces in MCP results.
- Preserve all existing CLI commands and tests.
- Across all phases, touch no more than six files and keep the total implementation plausibly below 600 changed lines.
- Run the configured verification command after each phase.

## Phase 1 - MCP Protocol Core and Typed Tool Adapter

<!-- runner:model=codex:gpt-5.4-mini -->
<!-- pilot:touches=src/mcpServer.js -->
<!-- pilot:touches=test/mcpServer.test.js -->
<!-- runner:read=src/cli.js -->
<!-- runner:read=test/cli.test.js -->
<!-- runner:verify=npm run build && npm test -->

### Requirements

- Add `src/mcpServer.js` with exported, independently testable protocol and tool-dispatch functions plus a `runMcpServer` entrypoint.
- Implement newline-delimited JSON-RPC 2.0 stdio handling without third-party packages:
  - Ignore blank input lines.
  - Process multiple messages in arrival order.
  - Preserve request IDs, including numeric zero.
  - Do not respond to notifications.
  - Return standard JSON-RPC errors for parse errors, invalid requests, unknown methods, and invalid parameters.
  - Support `initialize`, `notifications/initialized`, `ping`, `tools/list`, and `tools/call`.
  - Advertise server name `e3d-netdoctor`, the package version or a stable fallback version, and tool capabilities.
  - Negotiate a documented supported MCP protocol version and return the server-supported version when the client requests an unsupported version.
- Define exactly these MCP tools:
  - `netdoctor_smoke`: requires `pcapPath`.
  - `netdoctor_report`: requires `pcapPath`; optionally accepts `noSystemDiagnostics`, `speedTest`, and `redact`.
  - `netdoctor_paid_report`: requires exactly one of `pcapPath` or `interface`; optionally accepts `durationSeconds`, `requestId`, `noSystemDiagnostics`, `speedTest`, and `redact`. `durationSeconds` is a positive integer and is valid only with `interface`.
- Give every tool a closed JSON Schema input contract with explicit property types, required fields, mutual-exclusion rules where applicable, and `additionalProperties: false`.
- State in every tool description that captures may only be analyzed on networks the caller is authorized to monitor.
- Translate validated MCP arguments into the existing CLI arguments and invoke the exported `runCli` implementation:
  - Always select JSON output.
  - Do not pass `--wallet`, `--credits`, `--to`, `--output`, `--pdf`, or non-JSON formats.
  - Allow dependency injection of the CLI runner in unit tests.
- Capture the CLI invocation’s stdout and stderr so authorization notices, preflight messages, payment progress, and other CLI text never corrupt the MCP transport.
- Extract and parse the final JSON document from successful CLI output even when informational lines precede it.
- On success, return an MCP tool result containing:
  - A JSON text content item.
  - The same parsed value in `structuredContent`.
- If the CLI returns a nonzero code, produces invalid final JSON, or throws, return a tool result with `isError: true` and a concise sanitized message. Keep the MCP server alive for subsequent requests.
- Add focused unit tests covering:
  - Initialization and capability metadata.
  - All three tool schemas.
  - Argument-to-CLI translation for every supported option.
  - Rejection of missing, conflicting, mistyped, unknown, and invalid arguments.
  - Successful parsing when CLI notices precede JSON.
  - Structured success results.
  - Sanitized CLI failures.
  - Parse, method, and request errors.
  - Notifications producing no response.
  - Multiple sequential requests continuing after a failed tool call.

### Acceptance Criteria

- `tools/list` returns exactly the three specified tools with closed, typed schemas.
- Each valid tool call invokes the existing CLI runner once with the expected argument vector.
- No wallet or delivery option can enter the paid-report invocation through MCP input.
- Successful tool calls return equivalent `content` and `structuredContent` JSON.
- CLI notices and progress output never appear as standalone protocol messages.
- A failed tool call produces `isError: true` without terminating the server or leaking secrets.
- Protocol and adapter tests run offline with injected CLI behavior.
- `npm run build && npm test` passes.

## Phase 2 - Executable Mode, Client Manifest, and Documentation

<!-- runner:model=codex:gpt-5.4-mini -->
<!-- pilot:touches=bin/e3d-netdoctor.js -->
<!-- pilot:touches=mcp.json -->
<!-- pilot:touches=README.md -->
<!-- pilot:touches=test/mcpServer.test.js -->
<!-- runner:read=src/mcpServer.js -->
<!-- runner:read=package.json -->
<!-- runner:read=bin/e3d-netdoctor.js -->
<!-- runner:verify=npm run build && npm test -->

### Requirements

- Update `bin/e3d-netdoctor.js` so `e3d-netdoctor mcp` starts the MCP stdio server after the existing `.env` loading step.
- Preserve the current dynamic import and exit-code behavior for every non-MCP command.
- Ensure MCP mode does not call `runCli(['mcp'])`, print CLI usage, or write any startup banner to stdout.
- Add root `mcp.json` containing a single `e3d-netdoctor` server registration:
  - Command: `e3d-netdoctor`.
  - Arguments: `["mcp"]`.
  - Do not embed absolute repository paths, credentials, environment values, or machine-specific settings.
- Do not modify `package.json` or `package-lock.json`; reuse the existing `e3d-netdoctor` binary registration.
- Extend `README.md` with a concise MCP section that documents:
  - The `e3d-netdoctor mcp` stdio command.
  - Importing or copying the root `mcp.json` registration into an MCP-capable client.
  - The three exposed tool names and their intended uses.
  - That `netdoctor_paid_report` requires a pre-provisioned `NETDOCTOR_PAYMENT_CREDIT_KEY` and intentionally excludes interactive wallet payment.
  - That `tshark` and normal capture permissions remain required.
  - That only authorized networks may be analyzed.
  - That MCP responses retain the existing structured findings/narrative contract.
- Add integration-oriented tests that exercise the stdio loop with in-memory readable/writable streams:
  - Initialization followed by `tools/list`.
  - A tool invocation followed by a second request on the same session.
  - Clean end-of-input shutdown.
  - No non-JSON banner or CLI usage text in protocol output.
- Add a test that parses `mcp.json` and asserts the portable command/argument registration.
- Keep all tests offline; inject the CLI runner rather than invoking tshark, payment services, or external model APIs.

### Acceptance Criteria

- Running `e3d-netdoctor mcp` enters MCP mode while existing commands retain their prior behavior.
- Every nonblank stdout line emitted in MCP mode is a valid JSON-RPC 2.0 message.
- `mcp.json` registers `e3d-netdoctor mcp` without local paths or secrets.
- An MCP client can initialize, list all three tools, call a tool, and continue using the same session.
- README instructions are sufficient to configure an MCP-capable client without editing source code.
- No dependency, package-lock, protected-path, payment, parsing, or verdict implementation changes are introduced.
- The completed feature changes no more than six files and remains below 600 changed lines in total.
- `npm run build && npm test` passes.
