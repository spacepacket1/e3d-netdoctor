import { generateReport } from './reportGeneration.js';
import { sendReportEmail } from './emailDelivery.js';

export async function generateAndDeliverReport(parsedCapture, options = {}) {
  const reportBuilder = options.buildReport || generateReport;
  const deliverReport = options.deliverReport || sendReportEmail;

  const report = await reportBuilder(parsedCapture, options.reportOptions || options);
  const delivery = await deliverReport({
    to: options.to,
    includePdf: options.includePdf,
    report,
    mailer: options.mailer,
    fromName: options.fromName,
    fromAddress: options.fromAddress,
    subjectPrefix: options.subjectPrefix,
    createPdf: options.createPdf,
    attachmentFilename: options.attachmentFilename,
  });

  return {
    report,
    delivery,
  };
}
