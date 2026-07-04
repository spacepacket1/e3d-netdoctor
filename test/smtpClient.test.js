import assert from 'node:assert/strict';
import net from 'node:net';
import { test } from 'node:test';

import {
  buildMimeMessage,
  createSmtpMailer,
  parseSmtpReplies,
} from '../src/smtpClient.js';

const CRLF = '\r\n';

test('buildMimeMessage renders a plain HTML message with no attachments', () => {
  const message = buildMimeMessage({
    from: 'e3d netdoctor <support@e3d.ai>',
    to: 'user@example.com',
    subject: 'Report',
    html: '<p>hello</p>',
    messageId: 'fixed-id',
    date: 'Fri, 03 Jul 2026 21:00:00 +0000',
  });

  assert.match(message, /^From: e3d netdoctor <support@e3d\.ai>/);
  assert.match(message, /Content-Type: text\/html; charset=utf-8/);
  assert.match(message, /<p>hello<\/p>$/);
  assert.doesNotMatch(message, /multipart\/mixed/);
});

test('buildMimeMessage builds a multipart message with a base64 attachment', () => {
  const message = buildMimeMessage({
    from: 'support@e3d.ai',
    to: 'user@example.com',
    subject: 'Report with PDF',
    html: '<p>hi</p>',
    attachments: [{ filename: 'report.pdf', content: Buffer.from('pdf-bytes'), contentType: 'application/pdf' }],
  });

  assert.match(message, /Content-Type: multipart\/mixed; boundary="(netdoctor-[a-f0-9]+)"/);
  assert.match(message, /Content-Disposition: attachment; filename="report\.pdf"/);
  assert.match(message, new RegExp(Buffer.from('pdf-bytes').toString('base64')));
});

test('parseSmtpReplies handles single-line and multi-line replies', () => {
  const single = parseSmtpReplies('250 OK\r\n');
  assert.equal(single.replies.length, 1);
  assert.equal(single.replies[0].code, 250);
  assert.equal(single.replies[0].complete, true);

  const multi = parseSmtpReplies('250-first\r\n250-second\r\n250 last\r\n');
  assert.equal(multi.replies.length, 1);
  assert.deepEqual(multi.replies[0].lines, ['first', 'second', 'last']);
  assert.equal(multi.replies[0].complete, true);
});

function createFakeSmtpServer(script) {
  return new Promise((resolve) => {
    const server = net.createServer((socket) => {
      socket.write('220 fake.smtp.local ESMTP\r\n');
      let step = 0;
      let awaitingData = false;
      let dataBuffer = '';

      socket.on('data', (chunk) => {
        const text = chunk.toString('utf8');

        if (awaitingData) {
          dataBuffer += text;
          if (dataBuffer.endsWith(`${CRLF}.${CRLF}`)) {
            awaitingData = false;
            script.onData?.(dataBuffer);
            socket.write('250 Message accepted\r\n');
          }
          return;
        }

        const command = text.trim();
        const reply = script.steps[step]?.(command);
        step += 1;
        if (command === 'DATA') awaitingData = true;
        if (reply) socket.write(reply);
      });
    });

    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

test('createSmtpMailer completes a full SMTP conversation against a real socket', async () => {
  let dataPayload = '';
  const server = await createFakeSmtpServer({
    steps: [
      () => '250-fake.smtp.local\r\n250 AUTH LOGIN\r\n',
      () => '334 VXNlcm5hbWU6\r\n',
      () => '334 UGFzc3dvcmQ6\r\n',
      () => '235 Authentication successful\r\n',
      () => '250 OK\r\n',
      () => '250 OK\r\n',
      () => '354 Start mail input\r\n',
    ],
    onData: (payload) => {
      dataPayload = payload;
    },
  });

  const address = server.address();
  const mailer = createSmtpMailer(
    { host: '127.0.0.1', port: address.port, secure: false, auth: { user: 'tester', pass: 'secret' } },
    { socketFactory: () => new Promise((resolve, reject) => {
      const socket = net.connect({ host: '127.0.0.1', port: address.port }, () => resolve(socket));
      socket.once('error', reject);
    }) },
  );

  const result = await mailer.sendMail({
    from: 'e3d netdoctor <support@e3d.ai>',
    to: 'user@example.com',
    subject: 'Test report',
    html: '<p>content</p>',
  });

  assert.deepEqual(result.accepted, ['user@example.com']);
  assert.match(dataPayload, /Subject: Test report/);
  assert.match(dataPayload, /<p>content<\/p>/);

  await new Promise((resolve) => server.close(resolve));
});

test('createSmtpMailer surfaces a clear error when the server rejects a command', async () => {
  const server = await createFakeSmtpServer({
    steps: [() => '550 relay not permitted\r\n'],
  });

  const address = server.address();
  const mailer = createSmtpMailer(
    { host: '127.0.0.1', port: address.port, secure: false, auth: { user: 'tester', pass: 'secret' } },
    { socketFactory: () => new Promise((resolve, reject) => {
      const socket = net.connect({ host: '127.0.0.1', port: address.port }, () => resolve(socket));
      socket.once('error', reject);
    }) },
  );

  await assert.rejects(
    () => mailer.sendMail({ from: 'support@e3d.ai', to: 'user@example.com', subject: 'x', html: '<p>x</p>' }),
    /SMTP EHLO failed \(550\)/,
  );

  await new Promise((resolve) => server.close(resolve));
});
