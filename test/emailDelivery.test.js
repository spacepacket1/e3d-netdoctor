import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  buildDeliverySubject,
  resolveSmtpConfig,
  sendReportEmail,
} from '../src/emailDelivery.js';

function createReportFixture() {
  return {
    html: '<!doctype html><html><body><h1>Likely local</h1></body></html>',
    findings: {
      generatedAt: '2026-07-03T21:00:00.000Z',
      verdict: {
        headline: 'Likely local',
      },
    },
  };
}

test('buildDeliverySubject uses the netdoctor sender convention', () => {
  const subject = buildDeliverySubject({
    verdictHeadline: 'Likely destination/path-specific',
    generatedAt: '2026-07-03T21:00:00.000Z',
  });

  assert.equal(subject, 'e3d netdoctor report: Likely destination/path-specific (2026-07-03)');
});

test('resolveSmtpConfig preserves the newsletter-style host/port/auth shape', () => {
  const config = resolveSmtpConfig({
    host: 'smtp.example.com',
    port: 2525,
    secure: false,
    user: 'mailer@example.com',
    pass: 'secret',
  });

  assert.deepEqual(config, {
    host: 'smtp.example.com',
    port: 2525,
    secure: false,
    auth: {
      user: 'mailer@example.com',
      pass: 'secret',
    },
  });
});

test('sendReportEmail sends HTML email with an optional PDF attachment', async () => {
  let sentMail = null;
  const mailer = {
    async sendMail(payload) {
      sentMail = payload;
      return {
        accepted: [payload.to],
        rejected: [],
        messageId: '<delivery-success@example.com>',
      };
    },
  };

  const result = await sendReportEmail({
    to: 'recipient@example.com',
    report: createReportFixture(),
    includePdf: true,
    mailer,
    createPdf: async (html) => Buffer.from(`pdf:${html.length}`),
  });

  assert.equal(result.subject, 'e3d netdoctor report: Likely local (2026-07-03)');
  assert.equal(result.from, 'e3d netdoctor <support@e3d.ai>');
  assert.equal(result.includePdf, true);
  assert.equal(sentMail.to, 'recipient@example.com');
  assert.equal(sentMail.attachments.length, 1);
  assert.equal(sentMail.attachments[0].filename, 'e3d-netdoctor-report.pdf');
  assert.equal(Buffer.isBuffer(sentMail.attachments[0].content), true);
});

test('sendReportEmail surfaces SMTP failures clearly', async () => {
  const mailer = {
    async sendMail() {
      throw new Error('connect ECONNREFUSED 127.0.0.1:587');
    },
  };

  await assert.rejects(
    () => sendReportEmail({
      to: 'recipient@example.com',
      report: createReportFixture(),
      mailer,
    }),
    /Netdoctor delivery failed for recipient@example\.com: connect ECONNREFUSED 127\.0\.0\.1:587/,
  );
});
