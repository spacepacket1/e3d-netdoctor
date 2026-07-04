import { createPdfFromHtml } from './pdfExport.js';
import { createSmtpMailer } from './smtpClient.js';

const DEFAULT_SMTP_HOST = process.env.NETDOCTOR_SMTP_HOST || 'smtp.office365.com';
const DEFAULT_SMTP_PORT = Number.parseInt(process.env.NETDOCTOR_SMTP_PORT || '587', 10);
const DEFAULT_SMTP_SECURE = String(process.env.NETDOCTOR_SMTP_SECURE || 'false').toLowerCase() === 'true';
const DEFAULT_SMTP_USER = process.env.NETDOCTOR_SMTP_USER || 'support@e3d.ai';
const DEFAULT_FROM_NAME = process.env.NETDOCTOR_EMAIL_FROM_NAME || 'e3d netdoctor';
const DEFAULT_FROM_ADDRESS = process.env.NETDOCTOR_EMAIL_FROM_ADDRESS || DEFAULT_SMTP_USER;

function requireValue(value, message) {
  if (value === null || value === undefined || String(value).trim() === '') {
    throw new Error(message);
  }

  return String(value).trim();
}

export function resolveSmtpConfig(overrides = {}) {
  const host = requireValue(overrides.host || DEFAULT_SMTP_HOST, 'Missing SMTP host for netdoctor delivery');
  const port = Number.isInteger(overrides.port) ? overrides.port : DEFAULT_SMTP_PORT;
  const secure = typeof overrides.secure === 'boolean' ? overrides.secure : DEFAULT_SMTP_SECURE;
  const user = requireValue(overrides.user || DEFAULT_SMTP_USER, 'Missing SMTP username for netdoctor delivery');
  const pass = requireValue(
    overrides.pass || process.env.NETDOCTOR_SMTP_PASSWORD || process.env.FUTCO_EMAIL_PASSWORD,
    'Missing SMTP password for netdoctor delivery',
  );

  return {
    host,
    port,
    secure,
    auth: {
      user,
      pass,
    },
  };
}

function formatFromHeader(fromName, fromAddress) {
  return `${fromName} <${fromAddress}>`;
}

export function buildDeliverySubject({ verdictHeadline, generatedAt, subjectPrefix } = {}) {
  const headline = String(verdictHeadline || 'Network slowdown report').trim();
  const prefix = String(subjectPrefix || 'e3d netdoctor report').trim();
  const parsedDate = generatedAt ? new Date(generatedAt) : null;
  const timestamp = parsedDate && Number.isFinite(parsedDate.getTime())
    ? parsedDate.toISOString().slice(0, 10)
    : null;

  return timestamp
    ? `${prefix}: ${headline} (${timestamp})`
    : `${prefix}: ${headline}`;
}

export async function createMailer(options = {}) {
  const transportConfig = resolveSmtpConfig(options.smtp);
  return createSmtpMailer(transportConfig, options.smtpClient);
}

export async function sendReportEmail({
  to,
  report,
  includePdf = false,
  mailer,
  fromName = DEFAULT_FROM_NAME,
  fromAddress = DEFAULT_FROM_ADDRESS,
  subjectPrefix,
  createPdf = createPdfFromHtml,
  attachmentFilename = 'e3d-netdoctor-report.pdf',
} = {}) {
  const recipient = requireValue(to, 'Delivery requires a recipient email address');
  if (!report?.html) {
    throw new Error('Delivery requires a generated report with HTML content');
  }

  const transport = mailer || await createMailer();
  const subject = buildDeliverySubject({
    verdictHeadline: report.findings?.verdict?.headline,
    generatedAt: report.findings?.generatedAt,
    subjectPrefix,
  });

  const attachments = [];
  if (includePdf) {
    const pdfContent = await createPdf(report.html);
    attachments.push({
      filename: attachmentFilename,
      content: pdfContent,
      contentType: 'application/pdf',
    });
  }

  try {
    const info = await transport.sendMail({
      from: formatFromHeader(fromName, fromAddress),
      to: recipient,
      subject,
      html: report.html,
      attachments,
    });

    return {
      accepted: Array.isArray(info?.accepted) ? info.accepted : [recipient],
      rejected: Array.isArray(info?.rejected) ? info.rejected : [],
      messageId: info?.messageId || null,
      envelope: info?.envelope || null,
      subject,
      from: formatFromHeader(fromName, fromAddress),
      includePdf,
    };
  } catch (error) {
    throw new Error(`Netdoctor delivery failed for ${recipient}: ${error?.message || error}`);
  }
}
