import { randomUUID } from 'node:crypto';
import net from 'node:net';
import tls from 'node:tls';

const CRLF = '\r\n';

function encodeBase64(value) {
  return Buffer.from(value, 'utf8').toString('base64');
}

function dotStuff(body) {
  return body.replace(/\r?\n/g, CRLF).replace(/^\./gm, '..');
}

function buildBoundary() {
  return `netdoctor-${randomUUID().replace(/-/g, '')}`;
}

export function buildMimeMessage({ from, to, subject, html, attachments = [], messageId, date }) {
  const headers = [
    `From: ${from}`,
    `To: ${to}`,
    `Subject: ${subject}`,
    `Date: ${date || new Date().toUTCString()}`,
    `Message-ID: <${messageId || randomUUID()}@e3d-netdoctor>`,
    'MIME-Version: 1.0',
  ];

  if (!attachments.length) {
    headers.push('Content-Type: text/html; charset=utf-8');
    headers.push('Content-Transfer-Encoding: 8bit');
    return `${headers.join(CRLF)}${CRLF}${CRLF}${html}`;
  }

  const boundary = buildBoundary();
  headers.push(`Content-Type: multipart/mixed; boundary="${boundary}"`);

  const parts = [
    [
      `--${boundary}`,
      'Content-Type: text/html; charset=utf-8',
      'Content-Transfer-Encoding: 8bit',
      '',
      html,
    ].join(CRLF),
    ...attachments.map((attachment) => [
      `--${boundary}`,
      `Content-Type: ${attachment.contentType || 'application/octet-stream'}; name="${attachment.filename}"`,
      `Content-Disposition: attachment; filename="${attachment.filename}"`,
      'Content-Transfer-Encoding: base64',
      '',
      Buffer.from(attachment.content).toString('base64').replace(/(.{76})/g, '$1\n'),
    ].join(CRLF)),
    `--${boundary}--`,
  ];

  return `${headers.join(CRLF)}${CRLF}${CRLF}${parts.join(`${CRLF}${CRLF}`)}`;
}

export function parseSmtpReplies(buffer) {
  const replies = [];
  let remainder = buffer;

  while (true) {
    const lineEnd = remainder.indexOf(CRLF);
    if (lineEnd === -1) break;

    const line = remainder.slice(0, lineEnd);
    const match = line.match(/^(\d{3})([ -])(.*)$/);
    if (!match) {
      remainder = remainder.slice(lineEnd + CRLF.length);
      continue;
    }

    const [, code, separator, text] = match;
    if (!replies.length || replies[replies.length - 1].complete) {
      replies.push({ code: Number(code), lines: [text], complete: separator === ' ' });
    } else {
      const current = replies[replies.length - 1];
      current.lines.push(text);
      current.complete = separator === ' ';
    }

    remainder = remainder.slice(lineEnd + CRLF.length);
    if (replies[replies.length - 1].complete) break;
  }

  return { replies, remainder };
}

function createReplyWaiter(socket) {
  let buffer = '';
  let pendingResolve = null;
  let pendingReject = null;

  socket.on('data', (chunk) => {
    buffer += chunk.toString('utf8');
    if (!pendingResolve) return;
    const { replies, remainder } = parseSmtpReplies(buffer);
    if (replies.length && replies[replies.length - 1].complete) {
      buffer = remainder;
      const resolve = pendingResolve;
      pendingResolve = null;
      pendingReject = null;
      resolve(replies[replies.length - 1]);
    }
  });

  socket.on('error', (error) => {
    if (pendingReject) pendingReject(error);
  });

  return function waitForReply() {
    return new Promise((resolve, reject) => {
      pendingResolve = resolve;
      pendingReject = reject;
      const { replies, remainder } = parseSmtpReplies(buffer);
      if (replies.length && replies[replies.length - 1].complete) {
        buffer = remainder;
        pendingResolve = null;
        pendingReject = null;
        resolve(replies[replies.length - 1]);
      }
    });
  };
}

function assertOk(reply, step) {
  if (reply.code >= 200 && reply.code < 400) return;
  throw new Error(`SMTP ${step} failed (${reply.code}): ${reply.lines.join(' ')}`);
}

async function sendCommand(socket, waitForReply, command, step) {
  socket.write(`${command}${CRLF}`);
  const reply = await waitForReply();
  assertOk(reply, step);
  return reply;
}

export async function runSmtpConversation(socket, config, payload) {
  const waitForReply = createReplyWaiter(socket);
  const greeting = await waitForReply();
  assertOk(greeting, 'greeting');

  let ehloReply = await sendCommand(socket, waitForReply, `EHLO ${config.clientName || 'e3d-netdoctor'}`, 'EHLO');

  if (config.startTls && /STARTTLS/i.test(ehloReply.lines.join(' '))) {
    await sendCommand(socket, waitForReply, 'STARTTLS', 'STARTTLS');
    socket = await config.upgradeToTls(socket);
    const upgradedWaiter = createReplyWaiter(socket);
    ehloReply = await sendCommand(socket, upgradedWaiter, `EHLO ${config.clientName || 'e3d-netdoctor'}`, 'EHLO (after STARTTLS)');
    return runAuthenticatedConversation(socket, upgradedWaiter, config, payload);
  }

  return runAuthenticatedConversation(socket, waitForReply, config, payload);
}

async function runAuthenticatedConversation(socket, waitForReply, config, payload) {
  if (config.auth?.user) {
    await sendCommand(socket, waitForReply, 'AUTH LOGIN', 'AUTH LOGIN');
    await sendCommand(socket, waitForReply, encodeBase64(config.auth.user), 'AUTH LOGIN (username)');
    await sendCommand(socket, waitForReply, encodeBase64(config.auth.pass), 'AUTH LOGIN (password)');
  }

  await sendCommand(socket, waitForReply, `MAIL FROM:<${payload.envelopeFrom}>`, 'MAIL FROM');
  await sendCommand(socket, waitForReply, `RCPT TO:<${payload.envelopeTo}>`, 'RCPT TO');
  await sendCommand(socket, waitForReply, 'DATA', 'DATA');

  const message = dotStuff(payload.mimeMessage);
  socket.write(`${message}${CRLF}.${CRLF}`);
  const dataReply = await waitForReply();
  assertOk(dataReply, 'message body');

  // Best-effort: some servers close the connection without acknowledging QUIT.
  // The message is already accepted at this point, so don't block on a reply.
  socket.write(`QUIT${CRLF}`);

  return dataReply;
}

function defaultSocketFactory(config) {
  return new Promise((resolve, reject) => {
    const connectOptions = { host: config.host, port: config.port };
    const socket = config.secure
      ? tls.connect(connectOptions, () => resolve(socket))
      : net.connect(connectOptions, () => resolve(socket));
    socket.once('error', reject);
  });
}

function defaultTlsUpgrade(socket, config) {
  return new Promise((resolve, reject) => {
    const upgraded = tls.connect({ socket, host: config.host, servername: config.host }, () => resolve(upgraded));
    upgraded.once('error', reject);
  });
}

export function createSmtpMailer(smtpConfig, options = {}) {
  const socketFactory = options.socketFactory || (() => defaultSocketFactory(smtpConfig));

  return {
    async sendMail({ from, to, subject, html, attachments = [] }) {
      const mimeMessage = buildMimeMessage({ from, to, subject, html, attachments });
      const socket = await socketFactory();

      const config = {
        host: smtpConfig.host,
        auth: smtpConfig.auth,
        startTls: !smtpConfig.secure,
        clientName: options.clientName,
        upgradeToTls: (rawSocket) => defaultTlsUpgrade(rawSocket, smtpConfig),
      };

      try {
        await runSmtpConversation(socket, config, {
          envelopeFrom: extractEmailAddress(from),
          envelopeTo: extractEmailAddress(to),
          mimeMessage,
        });
      } finally {
        socket.end();
      }

      return {
        accepted: [to],
        rejected: [],
        messageId: `<${randomUUID()}@e3d-netdoctor>`,
        envelope: { from: extractEmailAddress(from), to: [extractEmailAddress(to)] },
      };
    },
  };
}

function extractEmailAddress(value) {
  const match = String(value || '').match(/<([^>]+)>/);
  return match ? match[1] : String(value || '').trim();
}
