import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { test } from 'node:test';

import {
  SUPPORTED_MCP_PROTOCOL_VERSION,
  createJsonRpcErrorResponse,
  dispatchToolCall,
  extractFinalJsonDocument,
  getMcpTools,
  handleJsonRpcMessage,
  runMcpServer,
} from '../src/mcpServer.js';

function createCollector() {
  let output = '';
  return {
    stream: {
      write(chunk) {
        output += String(chunk);
      },
    },
    read() {
      return output;
    },
  };
}

async function collectServerOutput(lines, deps = {}) {
  const stdout = createCollector();
  const stderr = createCollector();
  await runMcpServer({
    stdin: Readable.from(lines.map((line) => `${line}\n`)),
    stdout: stdout.stream,
    stderr: stderr.stream,
    ...deps,
  });
  return { stdout: stdout.read(), stderr: stderr.read() };
}

test('initialize returns protocol metadata and preserves id zero', async () => {
  const response = await handleJsonRpcMessage(JSON.stringify({
    jsonrpc: '2.0',
    id: 0,
    method: 'initialize',
    params: { protocolVersion: '1999-01-01' },
  }));

  assert.equal(response.id, 0);
  assert.equal(response.result.protocolVersion, SUPPORTED_MCP_PROTOCOL_VERSION);
  assert.equal(response.result.serverInfo.name, 'e3d-netdoctor');
  assert.equal(response.result.serverInfo.version, '0.0.0');
  assert.deepEqual(response.result.capabilities, { tools: {} });
});

test('tools/list returns the three closed tool schemas', async () => {
  const response = await handleJsonRpcMessage(JSON.stringify({
    jsonrpc: '2.0',
    id: 1,
    method: 'tools/list',
  }));

  const tools = response.result.tools;
  assert.deepEqual(tools.map((tool) => tool.name), [
    'netdoctor_smoke',
    'netdoctor_report',
    'netdoctor_paid_report',
  ]);
  for (const tool of tools) {
    assert.equal(tool.inputSchema.type, 'object');
    assert.equal(tool.inputSchema.additionalProperties, false);
    assert.match(tool.description, /authorized to monitor/i);
  }
  assert.deepEqual(tools[0].inputSchema.required, ['pcapPath']);
  assert.deepEqual(tools[1].inputSchema.required, ['pcapPath']);
  assert.deepEqual(tools[2].inputSchema.oneOf.length, 2);
});

test('extractFinalJsonDocument parses the final JSON payload after notices', () => {
  const parsed = extractFinalJsonDocument([
    'authorization notice',
    'progress update',
    '{"status":"done","nested":{"ok":true}}',
  ].join('\n'));

  assert.deepEqual(parsed, { status: 'done', nested: { ok: true } });
});

test('dispatchToolCall translates smoke arguments and returns structured JSON', async () => {
  let captured = null;
  const result = await dispatchToolCall('netdoctor_smoke', { pcapPath: './fixtures/sample-syn.pcap' }, {
    runCli: async (argv, { stdout }) => {
      captured = argv;
      stdout.write('preflight notice\n');
      stdout.write('{"rows":[{"Packets":1}],"diagnostics":{"packetCount":1}}\n');
      return 0;
    },
  });

  assert.deepEqual(captured, ['smoke', './fixtures/sample-syn.pcap']);
  assert.deepEqual(result.structuredContent, { rows: [{ Packets: 1 }], diagnostics: { packetCount: 1 } });
  assert.equal(result.content[0].mimeType, 'application/json');
  assert.deepEqual(JSON.parse(result.content[0].text), result.structuredContent);
});

test('dispatchToolCall translates report options without wallet or delivery flags', async () => {
  let captured = null;
  await dispatchToolCall('netdoctor_report', {
    pcapPath: './fixtures/sample-syn.pcap',
    noSystemDiagnostics: true,
    speedTest: true,
    redact: true,
  }, {
    runCli: async (argv) => {
      captured = argv;
      return 0;
    },
  });

  assert.deepEqual(captured, [
    'report',
    './fixtures/sample-syn.pcap',
    '--format',
    'json',
    '--no-system-diagnostics',
    '--speed-test',
    '--redact',
  ]);
});

test('dispatchToolCall translates paid-report options for pcap and interface inputs', async () => {
  const pcapCalls = [];
  await dispatchToolCall('netdoctor_paid_report', {
    pcapPath: './fixtures/sample-syn.pcap',
    requestId: 'req-1',
    noSystemDiagnostics: true,
    speedTest: true,
    redact: true,
  }, {
    runCli: async (argv) => {
      pcapCalls.push(argv);
      return 0;
    },
  });

  const interfaceCalls = [];
  await dispatchToolCall('netdoctor_paid_report', {
    interface: 'en0',
    durationSeconds: 30,
    requestId: 'req-2',
    noSystemDiagnostics: true,
    speedTest: true,
    redact: true,
  }, {
    runCli: async (argv) => {
      interfaceCalls.push(argv);
      return 0;
    },
  });

  assert.deepEqual(pcapCalls[0], [
    'paid-report',
    '--format',
    'json',
    '--pcap',
    './fixtures/sample-syn.pcap',
    '--request-id',
    'req-1',
    '--no-system-diagnostics',
    '--speed-test',
    '--redact',
  ]);
  assert.deepEqual(interfaceCalls[0], [
    'paid-report',
    '--format',
    'json',
    '--interface',
    'en0',
    '--duration',
    '30',
    '--request-id',
    'req-2',
    '--no-system-diagnostics',
    '--speed-test',
    '--redact',
  ]);
});

test('invalid tool arguments are rejected before the CLI runner is invoked', async () => {
  let invoked = 0;
  const response = await handleJsonRpcMessage(JSON.stringify({
    jsonrpc: '2.0',
    id: 7,
    method: 'tools/call',
    params: {
      name: 'netdoctor_paid_report',
      arguments: {
        pcapPath: './fixtures/sample-syn.pcap',
        interface: 'en0',
      },
    },
  }), {
    runCli: async () => {
      invoked += 1;
      return 0;
    },
  });

  assert.equal(invoked, 0);
  assert.equal(response.error.code, -32602);
});

test('handleJsonRpcMessage returns standard JSON-RPC errors', async () => {
  const parseError = await handleJsonRpcMessage('{not json');
  const invalidRequest = await handleJsonRpcMessage(JSON.stringify({ jsonrpc: '2.0', id: 1 }));
  const methodNotFound = await handleJsonRpcMessage(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'missing' }));
  const invalidParams = await handleJsonRpcMessage(JSON.stringify({
    jsonrpc: '2.0',
    id: 1,
    method: 'tools/call',
    params: { name: 'netdoctor_smoke', arguments: { pcapPath: 1 } },
  }));

  assert.equal(parseError.error.code, -32700);
  assert.equal(invalidRequest.error.code, -32600);
  assert.equal(methodNotFound.error.code, -32601);
  assert.equal(invalidParams.error.code, -32602);
});

test('notifications produce no response and the server continues after a failed tool call', async () => {
  let invocations = 0;
  const { stdout, stderr } = await collectServerOutput([
    JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: SUPPORTED_MCP_PROTOCOL_VERSION } }),
    '',
    JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'netdoctor_smoke', arguments: { pcapPath: './fixtures/sample-syn.pcap' } } }),
    JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }),
    JSON.stringify({ jsonrpc: '2.0', id: 3, method: 'ping' }),
  ], {
    runCli: async () => {
      invocations += 1;
      return invocations === 1 ? 1 : 0;
    },
  });

  const responses = stdout.trim().split('\n').map((line) => JSON.parse(line));
  assert.equal(responses.length, 3);
  assert.equal(responses[1].result.isError, true);
  assert.deepEqual(responses[2].result, {});
  assert.equal(stderr, '');
});

test('dispatchToolCall sanitizes CLI failures and invalid final JSON', async () => {
  const failed = await dispatchToolCall('netdoctor_smoke', { pcapPath: './fixtures/sample-syn.pcap' }, {
    runCli: async (_argv, { stderr }) => {
      stderr.write('payment secret: redact-me\n');
      return 1;
    },
  });

  const invalidJson = await dispatchToolCall('netdoctor_smoke', { pcapPath: './fixtures/sample-syn.pcap' }, {
    runCli: async (_argv, { stdout }) => {
      stdout.write('notice\n');
      stdout.write('no final json here\n');
      return 0;
    },
  });

  assert.equal(failed.isError, true);
  assert.match(failed.content[0].text, /CLI execution failed/);
  assert.equal(failed.content[0].text.includes('redact-me'), false);
  assert.equal(invalidJson.isError, true);
  assert.match(invalidJson.content[0].text, /invalid JSON/);
});

test('runMcpServer emits only protocol JSON for requests and no response for notifications', async () => {
  const { stdout, stderr } = await collectServerOutput([
    JSON.stringify({ jsonrpc: '2.0', id: 0, method: 'tools/list' }),
    JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }),
  ]);

  const responses = stdout.trim().split('\n').map((line) => JSON.parse(line));
  assert.equal(responses.length, 1);
  assert.equal(responses[0].id, 0);
  assert.equal(responses[0].result.tools.length, 3);
  assert.equal(stderr, '');
});

test('createJsonRpcErrorResponse keeps the requested id and code', () => {
  const response = createJsonRpcErrorResponse(9, -32602, 'Invalid params');
  assert.equal(response.id, 9);
  assert.equal(response.error.code, -32602);
  assert.equal(response.error.message, 'Invalid params');
});
