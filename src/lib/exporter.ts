import { Capacitor } from '@capacitor/core';

// ── Saving a file ───────────────────────────────────────────────────────────
// In a browser this is an ordinary download. Inside the Android app a WebView
// can't save a blob, so the file is written to the app's cache and handed to
// the system share sheet (Save to Drive / Files, WhatsApp, e-mail, …).

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      resolve(result.slice(result.indexOf(',') + 1));
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

export async function saveBlob(filename: string, blob: Blob): Promise<void> {
  if (Capacitor.isNativePlatform()) {
    const [{ Filesystem, Directory }, { Share }] = await Promise.all([
      import('@capacitor/filesystem'),
      import('@capacitor/share')
    ]);
    const written = await Filesystem.writeFile({ path: filename, data: await blobToBase64(blob), directory: Directory.Cache });
    await Share.share({ title: filename, url: written.uri, dialogTitle: 'Save or share' });
    return;
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

// ── Excel ───────────────────────────────────────────────────────────────────

export type SheetCell = string | number | boolean | Date | null | ({ value: string | number | boolean | Date | null } & Record<string, unknown>);
export interface SheetSpec {
  name: string; // max 31 characters
  rows: SheetCell[][];
  widths?: number[]; // in characters
  freezeRows?: number;
}

export async function saveWorkbook(filename: string, sheets: SheetSpec[]): Promise<void> {
  const { default: writeExcelFile } = await import('write-excel-file/browser');
  const blob = await writeExcelFile(
    sheets.map((s) => ({
      data: s.rows,
      sheet: s.name,
      columns: s.widths?.map((width) => ({ width })),
      stickyRowsCount: s.freezeRows
    })) as never
  ).toBlob();
  await saveBlob(filename, blob);
}

const INK = '#201e1d';

export const title = (value: string): SheetCell => ({ value, fontWeight: 'bold', fontSize: 14 });
export const note = (value: string): SheetCell => ({ value, textColor: '#605d5d' });
export const th = (value: string, right = false): SheetCell => ({
  value, fontWeight: 'bold', backgroundColor: INK, textColor: '#ffffff', ...(right ? { align: 'right' } : {})
});
export const label = (value: string): SheetCell => ({ value, fontWeight: 'bold' });

// Money is written as a plain number; the thousands grouping follows the
// viewer's own Excel region settings (lakh grouping on an Indian setup).
export const money = (n: number): SheetCell => ({ value: Math.round(n * 100) / 100, format: '#,##0.00;[Red]-#,##0.00' });
export const int = (n: number): SheetCell => ({ value: Math.round(n), format: '#,##0' });
export const dec = (n: number, places = 1): SheetCell => ({ value: Math.round(n * 1000) / 1000, format: `#,##0.${'0'.repeat(places)}` });
export const percent = (fraction: number): SheetCell => ({ value: fraction, format: '0%' });

// Dates go in as UTC midnight: the writer converts through UTC, so a local
// midnight would land a day early anywhere east of Greenwich (IST included).
export function dateCell(iso: string): SheetCell {
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  return { value: new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))), format: 'dd mmm yyyy' };
}

// ── PDF ─────────────────────────────────────────────────────────────────────

export interface PdfTable {
  heading: string;
  head: string[];
  body: string[][];
  // 0-based indexes of columns to right-align (numbers)
  right?: number[];
  // Size the table to its content instead of the full page width (key/value blocks)
  compact?: boolean;
}

export interface PdfReport {
  title: string;
  company: string;
  lines: string[]; // period, filters, …
  tables: PdfTable[];
}

// The built-in PDF fonts have no ₹ or arrow glyph, so PDFs use "Rs." and ">".
export const rs = (n: number): string => `${n < 0 ? '-' : ''}Rs. ${Math.abs(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

// Turns an on-screen string ("₹-3,91,585", "Avg ₹/km") into PDF-safe text.
export const pdfText = (s: string): string => s.replace(/^₹-/, '-Rs. ').replace(/₹\//g, 'Rs/').replace(/₹/g, 'Rs. ');

export async function savePdf(filename: string, report: PdfReport): Promise<void> {
  const [{ jsPDF }, { default: autoTable }] = await Promise.all([import('jspdf'), import('jspdf-autotable')]);
  const doc = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'a4' });
  const width = doc.internal.pageSize.getWidth();
  const margin = 36;
  const generated = new Date().toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false });

  // Title block
  doc.setFillColor(236, 48, 19);
  doc.rect(margin, margin, 6, 46, 'F');
  doc.setTextColor(32, 30, 29);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(20);
  doc.text(report.title, margin + 16, margin + 20);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  doc.setTextColor(96, 93, 93);
  doc.text(report.company, margin + 16, margin + 36);
  doc.text(report.lines.join('   |   '), margin + 16, margin + 50);


  let y = margin + 74;
  for (const t of report.tables) {
    if (y > doc.internal.pageSize.getHeight() - 110) { doc.addPage(); y = margin; }
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(12);
    doc.setTextColor(32, 30, 29);
    doc.text(t.heading, margin, y);
    autoTable(doc, {
      startY: y + 8,
      head: [t.head],
      body: t.body.length ? t.body : [[{ content: 'Nothing recorded for this period.', colSpan: t.head.length, styles: { textColor: [96, 93, 93] } }]] as never,
      margin: { left: margin, right: margin },
      tableWidth: t.compact ? 'wrap' : 'auto',
      theme: 'grid',
      styles: { font: 'helvetica', fontSize: 9, cellPadding: 5, lineColor: [186, 182, 182], lineWidth: 0.4, textColor: [32, 30, 29] },
      headStyles: { fillColor: [32, 30, 29], textColor: [255, 255, 255], fontStyle: 'bold' },
      alternateRowStyles: { fillColor: [246, 244, 244] },
      columnStyles: Object.fromEntries((t.right ?? []).map((i) => [i, { halign: 'right' }])),
      didParseCell: (data) => {
        // right-align the header cells above right-aligned columns too
        if (data.section === 'head' && (t.right ?? []).includes(data.column.index)) data.cell.styles.halign = 'right';
        // loss figures in red
        if (data.section === 'body' && typeof data.cell.raw === 'string' && /^-Rs\./.test(data.cell.raw)) data.cell.styles.textColor = [174, 24, 0];
      }
    });
    y = ((doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY) + 26;
  }

  // Footer on every page
  const pages = doc.getNumberOfPages();
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(125, 121, 121);
    const footerY = doc.internal.pageSize.getHeight() - 20;
    doc.text(`${report.company}  -  ${report.title}  -  generated ${generated}`, margin, footerY);
    doc.text(`Page ${i} of ${pages}`, width - margin, footerY, { align: 'right' });
  }

  await saveBlob(filename, doc.output('blob'));
}

export const safeName = (s: string): string => s.replace(/[^A-Za-z0-9._-]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
