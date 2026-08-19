import readline from 'node:readline';

export const SUPPORTED_MCP_PROTOCOL_VERSION = '2024-11-05';
export const SERVER_NAME = 'e3d-netdoctor';
export const SERVER_VERSION = '0.0.0';

const JSONRPC_VERSION = '2.0';
const JSONRPC_ERRORS = {
  parseError: { code: -32700, message: 'Parse error' },
  invalidRequest: { code: -32600, message: 'Invalid Request' },
  methodNotFound: { code: -32601, message: 'Method not found' },
  invalidParams: { code: -32602, message: 'Invalid params' },
};

const TOOL_DESCRIPTION_SUFFIX = ' Captures may only be analyzed on networks the caller is authorized to monitor.';

const SMOKE_TOOL = {
  name: 'netdoctor_smoke',
  description: `Parse a capture and emit the existing netdoctor smoke result.${TOOL_DESCRIPTION_SUFFIX}`,
  inputSchema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      pcapPath: { type: 'string', minLength: 1 },
    },
    required: ['pcapPath'],
  },
};

const REPORT_TOOL = {
  name: 'netdoctor_report',
  description: `Generate a netdoctor report from a capture.${TOOL_DESCRIPTION_SUFFIX}`,
  inputSchema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      pcapPath: { type: 'string', minLength: 1 },
      noSystemDiagnostics: { type: 'boolean' },
      speedTest: { type: 'boolean' },
      redact: { type: 'boolean' },
    },
    required: ['pcapPath'],
  },
};

const PAID_REPORT_TOOL = {
  name: 'netdoctor_paid_report',
  description: `Run the paid report flow using a capture file or live interface.${TOOL_DESCRIPTION_SUFFIX}`,
  inputSchema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      pcapPath: { type: 'string', minLength: 1 },
      interface: { type: 'string', minLength: 1 },
      durationSeconds: { type: 'integer', minimum: 1 },
      requestId: { type: 'string', minLength: 1 },
      noSystemDiagnostics: { type: 'boolean' },
      speedTest: { type: 'boolean' },
      redact: { type: 'boolean' },
    },
    oneOf: [
      { required: ['pcapPath'], not: { required: ['interface'] } },
      { required: ['interface'], not: { required: ['pcapPath'] } },
    ],
    allOf: [
      { if: { required: ['durationSeconds'] }, then: { required: ['interface'] } },
    ],
  },
};

export const MCP_TOOLS = [SMOKE_TOOL, REPORT_TOOL, PAID_REPORT_TOOL];

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function hasOwn(object, key) {
  return Object.prototype.hasOwnProperty.call(object, key);
}

function makeJsonRpcResponse(id, result) {
  return { jsonrpc: JSONRPC_VERSION, id, result };
}

function makeJsonRpcError(id, error) {
  return { jsonrpc: JSONRPC_VERSION, id, error };
}

function makeToolErrorResult(message) {
  return {
    isError: true,
    content: [{ type: 'text', text: message }],
  };
}

function validateClosedObject(value, allowedKeys) {
  if (!isPlainObject(value)) {
    return 'must be an object';
  }

  for (const key of Object.keys(value)) {
    if (!allowedKeys.includes(key)) {
      return `unknown argument: ${key}`;
    }
  }

  return null;
}

function validateString(value, fieldName) {
  if (typeof value !== 'string' || value.length === 0) {
    return `${fieldName} must be a non-empty string`;
  }
  return null;
}

function validateBoolean(value, fieldName) {
  if (typeof value !== 'boolean') {
    return `${fieldName} must be a boolean`;
  }
  return null;
}

function validatePositiveInteger(value, fieldName) {
  if (!Number.isInteger(value) || value <= 0) {
    return `${fieldName} must be a positive integer`;
  }
  return null;
}

function validateToolInput(toolName, input) {
  if (!isPlainObject(input)) {
    return { ok: false, message: 'arguments must be an object' };
  }

  if (toolName === SMOKE_TOOL.name) {
    const invalid = validateClosedObject(input, ['pcapPath']);
    if (invalid) return { ok: false, message: invalid };
    const pcapPathError = validateString(input.pcapPath, 'pcapPath');
    if (pcapPathError) return { ok: false, message: pcapPathError };
    return { ok: true, value: { pcapPath: input.pcapPath } };
  }

  if (toolName === REPORT_TOOL.name) {
    const invalid = validateClosedObject(input, ['pcapPath', 'noSystemDiagnostics', 'speedTest', 'redact']);
    if (invalid) return { ok: false, message: invalid };
    const pcapPathError = validateString(input.pcapPath, 'pcapPath');
    if (pcapPathError) return { ok: false, message: pcapPathError };
    if (hasOwn(input, 'noSystemDiagnostics')) {
      const error = validateBoolean(input.noSystemDiagnostics, 'noSystemDiagnostics');
      if (error) return { ok: false, message: error };
    }
    if (hasOwn(input, 'speedTest')) {
      const error = validateBoolean(input.speedTest, 'speedTest');
      if (error) return { ok: false, message: error };
    }
    if (hasOwn(input, 'redact')) {
      const error = validateBoolean(input.redact, 'redact');
      if (error) return { ok: false, message: error };
    }
    return {
      ok: true,
      value: {
        pcapPath: input.pcapPath,
        noSystemDiagnostics: input.noSystemDiagnostics,
        speedTest: input.speedTest,
        redact: input.redact,
      },
    };
  }

  if (toolName === PAID_REPORT_TOOL.name) {
    const invalid = validateClosedObject(input, [
      'pcapPath',
      'interface',
      'durationSeconds',
      'requestId',
      'noSystemDiagnostics',
      'speedTest',
      'redact',
    ]);
    if (invalid) return { ok: false, message: invalid };

    const hasPcapPath = hasOwn(input, 'pcapPath');
    const hasInterface = hasOwn(input, 'interface');
    if (hasPcapPath === hasInterface) {
      return { ok: false, message: 'provide exactly one of pcapPath or interface' };
    }

    if (hasPcapPath) {
      const pcapPathError = validateString(input.pcapPath, 'pcapPath');
      if (pcapPathError) return { ok: false, message: pcapPathError };
      if (hasOwn(input, 'durationSeconds')) {
        return { ok: false, message: 'durationSeconds is only valid with interface' };
      }
    } else {
      const interfaceError = validateString(input.interface, 'interface');
      if (interfaceError) return { ok: false, message: interfaceError };
      if (hasOwn(input, 'durationSeconds')) {
        const durationError = validatePositiveInteger(input.durationSeconds, 'durationSeconds');
        if (durationError) return { ok: false, message: durationError };
      }
    }

    if (hasOwn(input, 'requestId')) {
      const error = validateString(input.requestId, 'requestId');
      if (error) return { ok: false, message: error };
    }
    if (hasOwn(input, 'noSystemDiagnostics')) {
      const error = validateBoolean(input.noSystemDiagnostics, 'noSystemDiagnostics');
      if (error) return { ok: false, message: error };
    }
    if (hasOwn(input, 'speedTest')) {
      const error = validateBoolean(input.speedTest, 'speedTest');
      if (error) return { ok: false, message: error };
    }
    if (hasOwn(input, 'redact')) {
      const error = validateBoolean(input.redact, 'redact');
      if (error) return { ok: false, message: error };
    }

    return {
      ok: true,
      value: {
        pcapPath: input.pcapPath,
        interface: input.interface,
        durationSeconds: input.durationSeconds,
        requestId: input.requestId,
        noSystemDiagnostics: input.noSystemDiagnostics,
        speedTest: input.speedTest,
        redact: input.redact,
      },
    };
  }

  return { ok: false, message: `unknown tool: ${toolName}` };
}

export function getMcpTools() {
  return MCP_TOOLS.map((tool) => ({
    ...tool,
    inputSchema: JSON.parse(JSON.stringify(tool.inputSchema)),
  }));
}

export function createJsonRpcErrorResponse(id, code, message) {
  return makeJsonRpcError(id, { code, message });
}

export function extractFinalJsonDocument(output) {
  if (typeof output !== 'string' || output.length === 0) {
    return null;
  }

  const indices = [];
  for (let i = 0; i < output.length; i += 1) {
    const char = output[i];
    if (char === '{' || char === '[') {
      indices.push(i);
    }
  }

  let parsed = null;
  for (const index of indices) {
    const candidate = output.slice(index).trim();
    if (!candidate) continue;
    try {
      parsed = JSON.parse(candidate);
    } catch {
      // Try the next candidate. The final JSON payload may be nested or preceded by text.
    }
  }

  return parsed;
}

async function invokeCli(command, runCli) {
  let stdout = '';
  let stderr = '';
  const captureStdout = {
    write(chunk) {
      stdout += String(chunk);
    },
  };
  const captureStderr = {
    write(chunk) {
      stderr += String(chunk);
    },
  };

  const exitCode = await runCli(command, { stdout: captureStdout, stderr: captureStderr });
  return { exitCode, stdout, stderr };
}

async function loadDefaultRunCli() {
  const { runCli } = await import('./cli.js');
  return runCli;
}

function toToolResult(value) {
  const text = JSON.stringify(value, null, 2);
  return {
    content: [{ type: 'text', text, mimeType: 'application/json' }],
    structuredContent: value,
  };
}

function toSanitizedErrorResult(message) {
  return makeToolErrorResult(message);
}

function buildToolCallCommand(toolName, args) {
  if (toolName === SMOKE_TOOL.name) {
    return ['smoke', args.pcapPath];
  }

  if (toolName === REPORT_TOOL.name) {
    const command = ['report', args.pcapPath, '--format', 'json'];
    if (args.noSystemDiagnostics) command.push('--no-system-diagnostics');
    if (args.speedTest) command.push('--speed-test');
    if (args.redact) command.push('--redact');
    return command;
  }

  if (toolName === PAID_REPORT_TOOL.name) {
    const command = ['paid-report', '--format', 'json'];
    if (args.pcapPath) {
      command.push('--pcap', args.pcapPath);
    } else {
      command.push('--interface', args.interface);
      if (args.durationSeconds !== undefined) {
        command.push('--duration', String(args.durationSeconds));
      }
    }
    if (args.requestId) command.push('--request-id', args.requestId);
    if (args.noSystemDiagnostics) command.push('--no-system-diagnostics');
    if (args.speedTest) command.push('--speed-test');
    if (args.redact) command.push('--redact');
    return command;
  }

  throw new Error(`unknown tool: ${toolName}`);
}

async function dispatchToolCall(toolName, args, { runCli } = {}) {
  const command = buildToolCallCommand(toolName, args);

  try {
    const runner = runCli || await loadDefaultRunCli();
    const { exitCode, stdout } = await invokeCli(command, runner);
    if (exitCode !== 0) {
      return toSanitizedErrorResult('CLI execution failed');
    }

    const parsed = extractFinalJsonDocument(stdout);
    if (parsed === null) {
      return toSanitizedErrorResult('CLI returned invalid JSON');
    }

    return toToolResult(parsed);
  } catch {
    return toSanitizedErrorResult('CLI execution failed');
  }
}

function getInitializeResult(params = {}) {
  const clientVersion = typeof params.protocolVersion === 'string' ? params.protocolVersion : null;
  return {
    protocolVersion: clientVersion === SUPPORTED_MCP_PROTOCOL_VERSION
      ? clientVersion
      : SUPPORTED_MCP_PROTOCOL_VERSION,
    serverInfo: {
      name: SERVER_NAME,
      version: SERVER_VERSION,
    },
    capabilities: {
      tools: {},
    },
  };
}

function isRequestMessage(message) {
  return isPlainObject(message) && hasOwn(message, 'id');
}

function validateJsonRpcEnvelope(message) {
  if (!isPlainObject(message)) {
    return 'message must be an object';
  }
  if (message.jsonrpc !== JSONRPC_VERSION) {
    return 'jsonrpc must be "2.0"';
  }
  if (typeof message.method !== 'string' || message.method.length === 0) {
    return 'method must be a non-empty string';
  }
  return null;
}

export async function handleJsonRpcMessage(line, deps = {}) {
  let message;
  try {
    message = JSON.parse(line);
  } catch {
    return makeJsonRpcError(null, JSONRPC_ERRORS.parseError);
  }

  if (!isPlainObject(message)) {
    return makeJsonRpcError(null, JSONRPC_ERRORS.invalidRequest);
  }

  const hasId = hasOwn(message, 'id');
  if (!hasId) {
    return null;
  }

  const envelopeError = validateJsonRpcEnvelope(message);
  if (envelopeError) {
    return makeJsonRpcError(message.id ?? null, JSONRPC_ERRORS.invalidRequest);
  }

  const { method, params = {} } = message;
  const id = message.id;

  if (method === 'initialize') {
    if (params !== undefined && !isPlainObject(params)) {
      return makeJsonRpcError(id, JSONRPC_ERRORS.invalidParams);
    }
    return makeJsonRpcResponse(id, getInitializeResult(params));
  }

  if (method === 'ping') {
    if (params !== undefined && !isPlainObject(params)) {
      return makeJsonRpcError(id, JSONRPC_ERRORS.invalidParams);
    }
    return makeJsonRpcResponse(id, {});
  }

  if (method === 'tools/list') {
    if (params !== undefined && !isPlainObject(params)) {
      return makeJsonRpcError(id, JSONRPC_ERRORS.invalidParams);
    }
    return makeJsonRpcResponse(id, { tools: getMcpTools() });
  }

  if (method === 'tools/call') {
    if (!isPlainObject(params)) {
      return makeJsonRpcError(id, JSONRPC_ERRORS.invalidParams);
    }

    const { name, arguments: toolArguments } = params;
    if (typeof name !== 'string' || name.length === 0) {
      return makeJsonRpcError(id, JSONRPC_ERRORS.invalidParams);
    }

    const validation = validateToolInput(name, toolArguments);
    if (!validation.ok) {
      return makeJsonRpcError(id, JSONRPC_ERRORS.invalidParams);
    }

    const result = await dispatchToolCall(name, validation.value, deps);
    return makeJsonRpcResponse(id, result);
  }

  return makeJsonRpcError(id, JSONRPC_ERRORS.methodNotFound);
}

export async function runMcpServer(deps = {}) {
  const stdin = deps.stdin || process.stdin;
  const stdout = deps.stdout || process.stdout;
  const stderr = deps.stderr || process.stderr;
  const rl = readline.createInterface({ input: stdin, crlfDelay: Infinity });
  let processing = Promise.resolve();

  return await new Promise((resolve) => {
    rl.on('line', (line) => {
      if (line.trim() === '') {
        return;
      }
      processing = processing.then(async () => {
        const response = await handleJsonRpcMessage(line, deps);
        if (response) {
          stdout.write(`${JSON.stringify(response)}\n`);
        }
      }).catch((error) => {
        stderr.write(`${String(error?.message || error)}\n`);
      });
    });

    rl.on('close', () => {
      processing.then(() => resolve());
    });
  });
}

export { dispatchToolCall, getInitializeResult, validateToolInput };
