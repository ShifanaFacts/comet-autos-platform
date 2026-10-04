import {
  A4,
  PdfDocument,
  type PathSegment,
  type PdfPage,
  type Rgb,
  textWidth,
  wrapText,
} from '@/lib/documents/pdf/writer';
import {
  formatAed,
  formatQuantity,
  formatRate,
  hasLineDiscounts,
  hasMixedVatRates,
  type CustomerDocumentModel,
  type DocumentTone,
} from '@/lib/documents/model';

/*
 * Lays a CustomerDocumentModel out on A4 pages. Formatting only: every
 * amount arrives already calculated. Long item tables continue on new pages
 * with the column headings repeated; every page carries the workshop's
 * contact line and "Page n of m".
 */

const INK: Rgb = [0.094, 0.094, 0.106];
const MUTED: Rgb = [0.392, 0.455, 0.545];
const RULE: Rgb = [0.894, 0.894, 0.914];
const SOFT: Rgb = [0.969, 0.969, 0.98];
const BRAND: Rgb = [0.486, 0.227, 0.929];
const NIGHT: Rgb = [0.067, 0.067, 0.094];
const WHITE: Rgb = [1, 1, 1];

const TONE: Record<DocumentTone, { fill: Rgb; text: Rgb }> = {
  success: { fill: [0.906, 0.969, 0.925], text: [0.086, 0.502, 0.239] },
  warning: { fill: [0.996, 0.953, 0.878], text: [0.706, 0.325, 0.035] },
  danger: { fill: [0.996, 0.922, 0.922], text: [0.725, 0.11, 0.11] },
  info: { fill: [0.914, 0.941, 0.996], text: [0.114, 0.306, 0.847] },
  neutral: { fill: [0.945, 0.945, 0.953], text: [0.322, 0.322, 0.357] },
};

const MARGIN = 48;
const RIGHT = A4.width - MARGIN;
const CONTENT = RIGHT - MARGIN;
const BOTTOM = A4.height - 70;

/*
 * Item table columns, laid out like the workshop's own quotation sheet:
 * S.No · Type · Description · Qty · Price · Amount. A per-line VAT column
 * appears only when the lines are not all at one rate — otherwise the
 * totals already say "VAT 5%" — and a Discount column only when a line has
 * a discount. Numeric columns give their right edge.
 */
interface Columns {
  no: number;
  type: number;
  desc: number;
  qty: number;
  price: number;
  vat: number | null;
  discount: number | null;
  amount: number;
  descWidth: number;
}

function columns(withVat: boolean, withDiscount: boolean): Columns {
  const base = { no: MARGIN + 30, type: MARGIN + 40, desc: MARGIN + 92, amount: RIGHT - 12 };
  const numeric =
    withVat && withDiscount
      ? { qty: MARGIN + 270, price: MARGIN + 338, vat: MARGIN + 370, discount: MARGIN + 425 }
      : withDiscount
        ? { qty: MARGIN + 290, price: MARGIN + 360, vat: null, discount: MARGIN + 420 }
        : withVat
          ? { qty: MARGIN + 322, price: MARGIN + 392, vat: MARGIN + 428, discount: null }
          : { qty: MARGIN + 350, price: MARGIN + 425, vat: null, discount: null };
  return { ...base, ...numeric, descWidth: numeric.qty - base.desc - 40 };
}

function pill(page: PdfPage, label: string, tone: DocumentTone, right: number, top: number) {
  const size = 8.5;
  const width = textWidth(label.toUpperCase(), 'bold', size) + 16;
  page.rect(right - width, top, width, 17, { fill: TONE[tone].fill, radius: 8.5 });
  page.text(label.toUpperCase(), right - width / 2, top + 11.6, {
    font: 'bold',
    size,
    color: TONE[tone].text,
    align: 'center',
  });
}

function brandMark(page: PdfPage, x: number, y: number) {
  page.rect(x, y, 34, 34, { fill: BRAND, radius: 8 });
  page.text('C', x + 17, y + 23.5, { font: 'bold', size: 18, color: WHITE, align: 'center' });
}

/** The header band on page one: brand, seller contact, document title, number and status. */
function header(page: PdfPage, doc: CustomerDocumentModel) {
  page.rect(0, 0, A4.width, 6, { fill: BRAND });
  brandMark(page, MARGIN, 34);
  page.text(doc.seller.name, MARGIN + 46, 48, { font: 'bold', size: 15, color: INK });
  page.text('Automotive workshop', MARGIN + 46, 62, { size: 8.5, color: MUTED });

  let y = 88;
  const contact = [
    doc.seller.legalName && doc.seller.legalName !== doc.seller.name ? doc.seller.legalName : null,
    doc.seller.address,
    [doc.seller.phone ? `Tel ${doc.seller.phone}` : null, doc.seller.email]
      .filter(Boolean)
      .join('  ·  ') || null,
    doc.seller.taxNumber ? `TRN ${doc.seller.taxNumber}` : null,
  ].filter((line): line is string => Boolean(line));
  for (const line of contact) {
    for (const wrapped of wrapText(line, 'regular', 8.5, 250)) {
      page.text(wrapped, MARGIN, y, { size: 8.5, color: MUTED });
      y += 11.5;
    }
  }

  page.text(doc.title.toUpperCase(), RIGHT, 48, {
    font: 'bold',
    size: 19,
    color: BRAND,
    align: 'right',
  });
  page.text(doc.number, RIGHT, 66, { font: 'bold', size: 11, color: INK, align: 'right' });
  if (doc.status) pill(page, doc.status.label, doc.status.tone, RIGHT, 76);

  let metaY = 112;
  for (const field of doc.meta) {
    const labelRight = RIGHT - Math.max(120, textWidth(field.value, 'bold', 8.5) + 12);
    page.text(field.label, labelRight, metaY, { size: 8.5, color: MUTED, align: 'right' });
    page.text(field.value, RIGHT, metaY, { font: 'bold', size: 8.5, color: INK, align: 'right' });
    metaY += 13;
  }
  return Math.max(y, metaY) + 14;
}

/** Customer and vehicle, side by side on a soft panel. */
function parties(page: PdfPage, doc: CustomerDocumentModel, top: number) {
  const half = (CONTENT - 12) / 2;
  const blocks: { title: string; lines: { text: string; bold?: boolean }[] }[] = [
    {
      title:
        doc.kind === 'QUOTATION'
          ? 'Prepared for'
          : doc.kind === 'JOB_CARD'
            ? 'Customer'
            : 'Billed to',
      lines: [
        { text: doc.customer.name, bold: true },
        ...(doc.customer.phone ? [{ text: doc.customer.phone }] : []),
        ...(doc.customer.address ? [{ text: doc.customer.address }] : []),
        ...(doc.customer.taxNumber ? [{ text: `TRN ${doc.customer.taxNumber}` }] : []),
      ],
    },
  ];
  if (doc.vehicle) {
    blocks.push({
      title: 'Vehicle',
      lines: [
        { text: doc.vehicle.description, bold: true },
        { text: `Registration ${doc.vehicle.plateNumber}` },
        ...(doc.vehicle.vin ? [{ text: `VIN ${doc.vehicle.vin}` }] : []),
        ...(doc.vehicle.mileage ? [{ text: `Odometer ${doc.vehicle.mileage}` }] : []),
      ],
    });
  }
  const wrapped = blocks.map((block) =>
    block.lines.flatMap((line) =>
      wrapText(line.text, line.bold ? 'bold' : 'regular', 9.5, half - 28).map((text) => ({
        text,
        bold: line.bold,
      })),
    ),
  );
  const height = 34 + Math.max(...wrapped.map((lines) => lines.length)) * 13;
  blocks.forEach((block, index) => {
    const x = MARGIN + index * (half + 12);
    page.rect(x, top, half, height, { fill: SOFT, radius: 8 });
    page.text(block.title.toUpperCase(), x + 14, top + 18, {
      font: 'bold',
      size: 7.5,
      color: MUTED,
    });
    wrapped[index].forEach((line, lineIndex) => {
      page.text(line.text, x + 14, top + 34 + lineIndex * 13, {
        font: line.bold ? 'bold' : 'regular',
        size: 9.5,
        color: INK,
      });
    });
  });
  return top + height + 20;
}

class Layout {
  page: PdfPage;
  y: number;
  constructor(
    private readonly pdf: PdfDocument,
    first: PdfPage,
    y: number,
  ) {
    this.page = first;
    this.y = y;
  }
  /** Starts a new page when `height` more points don't fit; returns true if it did. */
  ensure(height: number): boolean {
    if (this.y + height <= BOTTOM) return false;
    this.page = this.pdf.addPage();
    this.page.rect(0, 0, A4.width, 6, { fill: BRAND });
    this.y = 44;
    return true;
  }
}

function tableHeader(layout: Layout, col: Columns) {
  const { page } = layout;
  page.rect(MARGIN, layout.y, CONTENT, 22, { fill: NIGHT, radius: 5 });
  const y = layout.y + 14.5;
  const style = { font: 'bold' as const, size: 7.5, color: WHITE };
  page.text('S.NO', col.no, y, { ...style, align: 'right' });
  page.text('TYPE', col.type, y, style);
  page.text('DESCRIPTION', col.desc, y, style);
  page.text('QTY', col.qty, y, { ...style, align: 'right' });
  page.text('PRICE', col.price, y, { ...style, align: 'right' });
  if (col.vat !== null) page.text('VAT', col.vat, y, { ...style, align: 'right' });
  if (col.discount !== null) page.text('DISCOUNT', col.discount, y, { ...style, align: 'right' });
  page.text('AMOUNT', col.amount, y, { ...style, align: 'right' });
  layout.y += 30;
}

function sections(layout: Layout, doc: CustomerDocumentModel) {
  if (doc.sections.length === 0) return;
  const col = columns(hasMixedVatRates(doc.sections), hasLineDiscounts(doc.sections));
  layout.ensure(80);
  tableHeader(layout, col);
  // One running number across the whole table, like the paper sheet.
  let number = 0;
  for (const section of doc.sections) {
    if (section.title) {
      if (layout.ensure(40)) tableHeader(layout, col);
      layout.page.text(section.title.toUpperCase(), col.type, layout.y + 8, {
        font: 'bold',
        size: 7.5,
        color: BRAND,
      });
      layout.y += 16;
    }
    for (const line of section.lines) {
      number += 1;
      const description = wrapText(line.description, 'regular', 9.5, col.descWidth);
      const height = Math.max(description.length * 12.5, 12.5) + 10;
      if (layout.ensure(height)) tableHeader(layout, col);
      const { page } = layout;
      const base = layout.y + 9;
      page.text(String(number), col.no, base, { size: 9.5, color: MUTED, align: 'right' });
      if (line.type)
        page.text(line.type, col.type, base, { font: 'bold', size: 7.5, color: MUTED });
      description.forEach((text, index) =>
        page.text(text, col.desc, base + index * 12.5, { size: 9.5, color: INK }),
      );
      page.text(formatQuantity(line.quantity), col.qty, base, {
        size: 9.5,
        color: INK,
        align: 'right',
      });
      page.text(formatAed(line.unitPrice), col.price, base, {
        size: 9.5,
        color: INK,
        align: 'right',
      });
      if (col.vat !== null) {
        page.text(formatRate(line.taxRate), col.vat, base, {
          size: 9.5,
          color: MUTED,
          align: 'right',
        });
      }
      if (col.discount !== null && line.discount !== null) {
        page.text(`-${formatAed(line.discount)}`, col.discount, base, {
          size: 9.5,
          color: MUTED,
          align: 'right',
        });
      }
      page.text(formatAed(line.lineTotal), col.amount, base, {
        font: 'bold',
        size: 9.5,
        color: INK,
        align: 'right',
      });
      layout.y += height;
      page.line(MARGIN, layout.y - 4, RIGHT, layout.y - 4, { color: RULE, width: 0.6 });
    }
    layout.y += 6;
  }
}

/*
 * The job card sheet: no prices and no quotation — the customer's complaint,
 * the vehicle diagram to mark damage on at check-in, a box for the workshop
 * supervisor's comments, and signatures. Boxes print what was typed, then
 * ruled lines to write on by hand.
 */
const BOX_LINE = 16;

function writingBox(layout: Layout, title: string, text: string, minLines: number) {
  const lines = text.trim() ? wrapText(text.trim(), 'regular', 9.5, CONTENT - 28) : [];
  const ruled = Math.max(0, minLines - lines.length);
  const height = 24 + (lines.length + ruled) * BOX_LINE + 8;
  layout.ensure(height + 12);
  const { page } = layout;
  const top = layout.y;
  page.rect(MARGIN, top, CONTENT, height, { stroke: RULE, radius: 8 });
  page.text(title.toUpperCase(), MARGIN + 14, top + 17, { font: 'bold', size: 7.5, color: MUTED });
  lines.forEach((line, index) =>
    page.text(line, MARGIN + 14, top + 24 + index * BOX_LINE + 11, { size: 9.5, color: INK }),
  );
  for (let index = lines.length; index < lines.length + ruled; index += 1) {
    const y = top + 24 + (index + 1) * BOX_LINE - 1;
    page.line(MARGIN + 14, y, RIGHT - 14, y, { color: RULE, width: 0.6 });
  }
  layout.y += height + 12;
}

/*
 * Vehicle outlines, drawn in their own design units (y down) and scaled into
 * place: a side view facing right (the car's left side; mirrored, its right
 * side), the top view, and the front and rear.
 */
const SIDE_W = 200;
const SIDE_BODY: PathSegment[] = [
  ['M', 6, 58],
  ['L', 4, 40],
  ['C', 4, 34, 8, 31, 14, 30],
  ['L', 52, 28],
  ['C', 60, 14, 68, 8, 80, 7],
  ['L', 118, 7],
  ['C', 128, 7, 136, 12, 146, 26],
  ['L', 186, 32],
  ['C', 194, 33, 198, 38, 198, 44],
  ['L', 198, 58],
  ['L', 174, 58],
  ['C', 174, 49.2, 166.8, 42, 158, 42],
  ['C', 149.2, 42, 142, 49.2, 142, 58],
  ['L', 61, 58],
  ['C', 61, 49.2, 53.8, 42, 45, 42],
  ['C', 36.2, 42, 29, 49.2, 29, 58],
  ['Z'],
];
const SIDE_GLASS: PathSegment[] = [
  ['M', 58, 28],
  ['C', 64, 17, 70, 12, 80, 11],
  ['L', 117, 11],
  ['C', 125, 11, 131, 15, 139, 26],
  ['Z'],
];
const TOP_BODY: PathSegment[] = [
  ['M', 30, 8],
  ['L', 165, 8],
  ['C', 186, 8, 196, 22, 196, 42],
  ['C', 196, 62, 186, 76, 165, 76],
  ['L', 30, 76],
  ['C', 12, 76, 4, 64, 4, 42],
  ['C', 4, 20, 12, 8, 30, 8],
  ['Z'],
];
const TOP_WINDSHIELD: PathSegment[] = [
  ['M', 128, 16],
  ['L', 146, 20],
  ['C', 150, 32, 150, 52, 146, 64],
  ['L', 128, 68],
  ['C', 132, 52, 132, 32, 128, 16],
  ['Z'],
];
const TOP_REAR_GLASS: PathSegment[] = [
  ['M', 48, 20],
  ['L', 64, 17],
  ['C', 61, 32, 61, 52, 64, 67],
  ['L', 48, 64],
  ['C', 45, 52, 45, 32, 48, 20],
  ['Z'],
];
const END_BODY: PathSegment[] = [
  ['M', 8, 58],
  ['L', 8, 38],
  ['C', 8, 32, 12, 30, 18, 29],
  ['L', 26, 12],
  ['C', 28, 8, 31, 7, 36, 7],
  ['L', 64, 7],
  ['C', 69, 7, 72, 8, 74, 12],
  ['L', 82, 29],
  ['C', 88, 30, 92, 32, 92, 38],
  ['L', 92, 58],
  ['Z'],
];
const END_GLASS: PathSegment[] = [
  ['M', 30, 13],
  ['L', 70, 13],
  ['L', 77, 27],
  ['L', 23, 27],
  ['Z'],
];

/** Scales design units to the page: `x`, `y` is the view's top-left, `s` its scale. */
function placer(page: PdfPage, x: number, y: number, s: number, mirrorWidth?: number) {
  const px = (dx: number) => x + (mirrorWidth ? mirrorWidth - dx : dx) * s;
  const py = (dy: number) => y + dy * s;
  const outline = { stroke: INK, lineWidth: 0.9 };
  return {
    shape(segments: PathSegment[], options: { fill?: Rgb; stroke?: Rgb; lineWidth?: number }) {
      page.path(
        segments.map((seg): PathSegment => {
          if (seg[0] === 'Z') return seg;
          if (seg[0] === 'C')
            return ['C', px(seg[1]), py(seg[2]), px(seg[3]), py(seg[4]), px(seg[5]), py(seg[6])];
          return [seg[0], px(seg[1]), py(seg[2])];
        }),
        options,
      );
    },
    box(dx: number, dy: number, w: number, h: number, options: Parameters<PdfPage['rect']>[4]) {
      const left = mirrorWidth ? px(dx + w) : px(dx);
      page.rect(left, py(dy), w * s, h * s, { ...options, radius: (options.radius ?? 0) * s });
    },
    circle(cx: number, cy: number, r: number, options: { fill?: Rgb; stroke?: Rgb }) {
      page.rect(px(cx) - r * s, py(cy) - r * s, 2 * r * s, 2 * r * s, {
        ...options,
        radius: r * s,
        lineWidth: 0.9,
      });
    },
    line(x1: number, y1: number, x2: number, y2: number) {
      page.line(px(x1), py(y1), px(x2), py(y2), { color: MUTED, width: 0.6 });
    },
    outline,
  };
}

function sideView(page: PdfPage, x: number, y: number, s: number, mirrored: boolean) {
  const v = placer(page, x, y, s, mirrored ? SIDE_W : undefined);
  v.shape(SIDE_BODY, { ...v.outline, fill: WHITE });
  v.shape(SIDE_GLASS, { stroke: MUTED, lineWidth: 0.7 });
  v.line(100, 11, 100, 56);
  v.line(139, 27, 139, 52);
  v.line(62, 30, 62, 54);
  v.line(88, 33, 95, 33);
  v.line(127, 33, 134, 33);
  for (const cx of [45, 158]) {
    v.circle(cx, 58, 12, { stroke: INK, fill: WHITE });
    v.circle(cx, 58, 4.5, { stroke: MUTED });
  }
  v.box(193, 37, 4, 5, { stroke: MUTED, radius: 1 });
  v.box(4, 33, 4, 6, { stroke: MUTED, radius: 1 });
}

function topView(page: PdfPage, x: number, y: number, s: number) {
  const v = placer(page, x, y, s);
  for (const [wx, wy] of [
    [34, 3],
    [150, 3],
    [34, 75],
    [150, 75],
  ])
    v.box(wx, wy, 24, 6, { fill: MUTED, radius: 2 });
  v.box(134, 2, 7, 7, { stroke: INK, fill: WHITE, radius: 1.5 });
  v.box(134, 75, 7, 7, { stroke: INK, fill: WHITE, radius: 1.5 });
  v.shape(TOP_BODY, { ...v.outline, fill: WHITE });
  v.shape(TOP_WINDSHIELD, { stroke: MUTED, lineWidth: 0.7 });
  v.shape(TOP_REAR_GLASS, { stroke: MUTED, lineWidth: 0.7 });
  v.box(66, 18, 60, 48, { stroke: MUTED, radius: 6 });
  v.line(150, 24, 186, 28);
  v.line(150, 60, 186, 56);
}

function endView(page: PdfPage, x: number, y: number, s: number, front: boolean) {
  const v = placer(page, x, y, s);
  v.box(12, 54, 14, 14, { fill: MUTED, radius: 3 });
  v.box(74, 54, 14, 14, { fill: MUTED, radius: 3 });
  v.box(2, 26, 7, 5, { stroke: INK, fill: WHITE, radius: 1.5 });
  v.box(91, 26, 7, 5, { stroke: INK, fill: WHITE, radius: 1.5 });
  v.shape(END_BODY, { ...v.outline, fill: WHITE });
  v.shape(END_GLASS, { stroke: MUTED, lineWidth: 0.7 });
  v.line(10, 50, 90, 50);
  if (front) {
    v.box(13, 35, 17, 7, { stroke: MUTED, radius: 2 });
    v.box(70, 35, 17, 7, { stroke: MUTED, radius: 2 });
    v.box(36, 36, 28, 10, { stroke: MUTED, radius: 2 });
  } else {
    v.box(12, 34, 16, 8, { stroke: MUTED, radius: 2 });
    v.box(72, 34, 16, 8, { stroke: MUTED, radius: 2 });
    v.box(38, 38, 24, 9, { stroke: MUTED, radius: 1 });
  }
}

/** The vehicle diagram panel: left and right sides, top, front and rear, with the marking key. */
function vehicleDiagram(layout: Layout) {
  const height = 188;
  layout.ensure(height + 12);
  const { page } = layout;
  const top = layout.y;
  page.rect(MARGIN, top, CONTENT, height, { stroke: RULE, radius: 8 });
  page.text('VEHICLE CONDITION', MARGIN + 14, top + 17, { font: 'bold', size: 7.5, color: MUTED });
  page.text(
    'Mark on the drawing:  S scratch  ·  D dent  ·  C crack  ·  B broken',
    RIGHT - 14,
    top + 17,
    {
      size: 7.5,
      color: MUTED,
      align: 'right',
    },
  );

  const side = 0.86;
  const end = 0.78;
  const inner = CONTENT - 28;
  const gap = (inner - SIDE_W * side * 2 - 100 * end) / 2;
  const colA = MARGIN + 14;
  const colB = colA + SIDE_W * side + gap;
  const colC = colB + SIDE_W * side + gap;
  const rowOne = top + 30;
  const rowTwo = top + 108;
  const label = (text: string, x: number, width: number, y: number) =>
    page.text(text, x + width / 2, y, { font: 'bold', size: 7, color: MUTED, align: 'center' });

  sideView(page, colA, rowOne, side, false);
  label('LEFT SIDE', colA, SIDE_W * side, rowOne + 71);
  sideView(page, colA, rowTwo, side, true);
  label('RIGHT SIDE', colA, SIDE_W * side, rowTwo + 71);

  const topY = top + (height - 84 * side) / 2 + 4;
  topView(page, colB, topY, side);
  label('TOP', colB, SIDE_W * side, topY + 84 * side + 12);

  endView(page, colC, rowOne + 6, end, true);
  label('FRONT', colC, 100 * end, rowOne + 71);
  endView(page, colC, rowTwo + 6, end, false);
  label('REAR', colC, 100 * end, rowTwo + 71);

  layout.y += height + 12;
}

function jobCardBody(layout: Layout, doc: CustomerDocumentModel) {
  doc.narrative.forEach((block, index) =>
    writingBox(layout, block.label, block.value, index === 0 ? 3 : 0),
  );
  vehicleDiagram(layout);
  writingBox(layout, 'Workshop supervisor comments', '', 4);
}

/** Two signature boxes: the customer handing the vehicle over, and the workshop taking it in. */
function signatures(layout: Layout) {
  const height = 64;
  layout.ensure(height);
  const half = (CONTENT - 12) / 2;
  const boxes = [
    { title: 'Customer', caption: 'I hand over the vehicle in the condition marked above.' },
    { title: 'For the workshop', caption: 'Vehicle received by' },
  ];
  boxes.forEach((box, index) => {
    const x = MARGIN + index * (half + 12);
    const { page } = layout;
    page.rect(x, layout.y, half, height, { stroke: RULE, radius: 8 });
    page.text(box.title.toUpperCase(), x + 14, layout.y + 16, {
      font: 'bold',
      size: 7.5,
      color: MUTED,
    });
    page.text(box.caption, x + 14, layout.y + 28, { size: 8, color: MUTED });
    page.line(x + 14, layout.y + 49, x + half - 90, layout.y + 49, { color: MUTED, width: 0.6 });
    page.text('Signature', x + 14, layout.y + 58, { size: 7, color: MUTED });
    page.line(x + half - 80, layout.y + 49, x + half - 14, layout.y + 49, {
      color: MUTED,
      width: 0.6,
    });
    page.text('Date', x + half - 80, layout.y + 58, { size: 7, color: MUTED });
  });
  layout.y += height + 20;
}

function totals(layout: Layout, doc: CustomerDocumentModel) {
  if (doc.totals.length === 0) return;
  const rowHeight = 18;
  const height = doc.totals.length * rowHeight + 20;
  layout.ensure(height + 10);
  const left = RIGHT - 230;
  const { page } = layout;
  page.rect(left, layout.y, 230, height, { fill: SOFT, radius: 8 });
  let y = layout.y + 22;
  for (const total of doc.totals) {
    const strong = total.emphasis === 'total' || total.emphasis === 'balance';
    if (total.emphasis === 'total')
      page.line(left + 14, y - 12, RIGHT - 14, y - 12, { color: RULE, width: 0.8 });
    page.text(total.label, left + 14, y, {
      font: strong ? 'bold' : 'regular',
      size: strong ? 10.5 : 9.5,
      color: strong ? INK : MUTED,
    });
    page.text(formatAed(total.amount), RIGHT - 14, y, {
      font: strong ? 'bold' : 'regular',
      size: strong ? 11.5 : 9.5,
      color: total.emphasis === 'balance' ? BRAND : INK,
      align: 'right',
    });
    y += rowHeight;
  }
  layout.y += height + 22;
}

function highlight(layout: Layout, doc: CustomerDocumentModel) {
  if (!doc.highlight) return;
  const { page } = layout;
  page.rect(MARGIN, layout.y, CONTENT, 74, { fill: NIGHT, radius: 10 });
  page.text(doc.highlight.label.toUpperCase(), MARGIN + 20, layout.y + 24, {
    font: 'bold',
    size: 8,
    color: [0.7, 0.7, 0.78],
  });
  page.text(formatAed(doc.highlight.amount), MARGIN + 20, layout.y + 54, {
    font: 'bold',
    size: 24,
    color: WHITE,
  });
  if (doc.highlight.caption)
    page.text(doc.highlight.caption, RIGHT - 20, layout.y + 54, {
      size: 9.5,
      color: [0.7, 0.7, 0.78],
      align: 'right',
    });
  layout.y += 94;
}

function fields(
  layout: Layout,
  title: string | null,
  items: { label: string; value: string }[],
  width = CONTENT,
) {
  if (items.length === 0) return;
  if (title) {
    layout.ensure(40);
    layout.page.text(title.toUpperCase(), MARGIN, layout.y + 8, {
      font: 'bold',
      size: 7.5,
      color: MUTED,
    });
    layout.y += 18;
  }
  for (const item of items) {
    const lines = wrapText(item.value, 'regular', 9.5, width - 150);
    const height = lines.length * 12.5 + 10;
    layout.ensure(height);
    layout.page.text(item.label, MARGIN, layout.y + 9, { size: 9.5, color: MUTED });
    lines.forEach((line, index) =>
      layout.page.text(line, MARGIN + 150, layout.y + 9 + index * 12.5, { size: 9.5, color: INK }),
    );
    layout.y += height;
    layout.page.line(MARGIN, layout.y - 3, MARGIN + width, layout.y - 3, {
      color: RULE,
      width: 0.5,
    });
  }
  layout.y += 14;
}

function narrative(layout: Layout, doc: CustomerDocumentModel) {
  for (const block of doc.narrative) {
    const lines = wrapText(block.value, 'regular', 9.5, CONTENT);
    layout.ensure(26 + Math.min(lines.length, 3) * 12.5);
    layout.page.text(block.label.toUpperCase(), MARGIN, layout.y + 8, {
      font: 'bold',
      size: 7.5,
      color: MUTED,
    });
    layout.y += 22;
    for (const line of lines) {
      layout.ensure(12.5);
      layout.page.text(line, MARGIN, layout.y, { size: 9.5, color: INK });
      layout.y += 12.5;
    }
    layout.y += 12;
  }
}

function notes(layout: Layout, doc: CustomerDocumentModel) {
  if (doc.notes.length === 0) return;
  layout.ensure(40);
  layout.page.text('NOTES & TERMS', MARGIN, layout.y + 8, {
    font: 'bold',
    size: 7.5,
    color: MUTED,
  });
  layout.y += 22;
  for (const note of doc.notes) {
    const lines = wrapText(note, 'regular', 8.5, CONTENT - 12);
    layout.ensure(lines.length * 11.5 + 4);
    layout.page.text('•', MARGIN, layout.y, { size: 8.5, color: MUTED });
    lines.forEach((line, index) =>
      layout.page.text(line, MARGIN + 12, layout.y + index * 11.5, { size: 8.5, color: MUTED }),
    );
    layout.y += lines.length * 11.5 + 4;
  }
}

function footers(pdf: PdfDocument, doc: CustomerDocumentModel) {
  const contact = [doc.seller.name, doc.seller.phone, doc.seller.email]
    .filter(Boolean)
    .join('  ·  ');
  pdf.pages.forEach((page, index) => {
    page.line(MARGIN, A4.height - 44, RIGHT, A4.height - 44, { color: RULE, width: 0.6 });
    page.text(contact, MARGIN, A4.height - 30, { size: 8, color: MUTED });
    page.text(`${doc.number}  ·  Page ${index + 1} of ${pdf.pages.length}`, RIGHT, A4.height - 30, {
      size: 8,
      color: MUTED,
      align: 'right',
    });
  });
}

/** Renders the document as PDF bytes. */
export function renderDocumentPdf(doc: CustomerDocumentModel): Buffer {
  const pdf = new PdfDocument({ title: `${doc.title} ${doc.number}`, author: doc.seller.name });
  const first = pdf.addPage();
  let y = header(first, doc);
  y = parties(first, doc, y);
  const layout = new Layout(pdf, first, y);
  if (doc.kind === 'JOB_CARD') {
    jobCardBody(layout, doc);
    notes(layout, doc);
    signatures(layout);
  } else {
    highlight(layout, doc);
    narrative(layout, doc);
    if (doc.kind === 'RECEIPT') fields(layout, doc.detailsTitle, doc.details);
    sections(layout, doc);
    totals(layout, doc);
    if (doc.kind !== 'RECEIPT') fields(layout, doc.detailsTitle, doc.details);
    notes(layout, doc);
  }
  footers(pdf, doc);
  return pdf.toBuffer();
}
