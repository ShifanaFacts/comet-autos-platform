/**
 * A tiny PDF with a real text layer, built by hand for the bill-reader
 * tests: one page, Helvetica, one line of text per row. No library — the
 * point is a file whose text can be read without OCR.
 */
export function textPdf(lines: string[]): Buffer {
  const escape = (text: string) => text.replace(/[\\()]/g, (char) => `\\${char}`);
  const content = [
    'BT',
    '/F1 11 Tf',
    '14 TL',
    '40 800 Td',
    ...lines.map((line) => `(${escape(line)}) Tj T*`),
    'ET',
  ].join('\n');
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${Buffer.byteLength(content, 'latin1')} >>\nstream\n${content}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let body = '%PDF-1.4\n';
  const offsets: number[] = [];
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(body, 'latin1'));
    body += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xref = Buffer.byteLength(body, 'latin1');
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) body += `${String(offset).padStart(10, '0')} 00000 n \n`;
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(body, 'latin1');
}

/** A PDF with a page and no text at all: what a scanner produces. */
export function scannedPdf(): Buffer {
  return textPdf([]);
}

export const PDF_BILL = [
  'GULF LUBRICANTS TRADING LLC',
  'TRN 100 4455 6677 8003',
  'TAX INVOICE',
  'Invoice No: GL-20455   Date: 21/09/2026',
  'Bill To: MOHAMMED MOWLA AUTO GARAGE LLC',
  'Sub Total 400.00',
  'VAT Amount 20.00',
  'Total Amount 420.00',
];
