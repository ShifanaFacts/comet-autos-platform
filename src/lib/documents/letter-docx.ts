import {
  AlignmentType,
  BorderStyle,
  Document,
  Footer,
  Header,
  HorizontalPositionAlign,
  HorizontalPositionRelativeFrom,
  ImageRun,
  LevelFormat,
  Packer,
  PageBreak,
  Paragraph,
  Tab,
  TabStopType,
  TextRun,
  VerticalPositionAlign,
  VerticalPositionRelativeFrom,
  convertMillimetersToTwip,
  type IRunOptions,
  type ParagraphChild,
} from 'docx';
import { LETTER_PAGE, TEXT_BOTTOM, TEXT_TOP, WATERMARK } from '@/lib/documents/letter-pages';
import type { Letterhead } from '@/lib/documents/letterhead';

/*
 * The letter as a Word document (.docx), with the letterhead in Word's own
 * header and footer so it repeats on every page there too.
 *
 * The letter's HTML is the small set the editor makes (see letter-paste.ts
 * and the toolbar): paragraphs, headings, lists, page breaks, and runs of
 * text that are bold, italic, underlined, struck through, coloured,
 * highlighted, or in another font or size. Each maps onto its Word
 * equivalent; anything else contributes its text only.
 *
 * Browser only: it reads the letter's HTML with the DOM and redraws the logo
 * on a canvas. Loaded on demand, so the Word library isn't part of the page.
 */

export interface LetterStyle {
  /** The letter's base font, e.g. "Calibri". */
  font: string;
  /** Base size in points. */
  size: number;
  /** Line spacing: 1 is single. */
  lineSpacing: number;
}

/** Space after each paragraph, in points — the editor's paragraph gap. */
export const PARAGRAPH_GAP_PT = 6;

const HEADING_SIZE_PT: Record<string, number> = { H2: 16, H3: 13 };
/** Word measures lengths in twentieths of a point and font sizes in half points. */
const TWIPS_PER_PT = 20;
const PX_PER_MM = 96 / 25.4;
const BULLETS = 'letter-bullets';
const NUMBERS = 'letter-numbers';

/* ---------- reading CSS values ---------- */

let colorContext: CanvasRenderingContext2D | null = null;

/** Any CSS colour as Word's RRGGBB, or undefined for none or transparent. */
function wordColor(value: string): string | undefined {
  if (!value || value === 'transparent') return undefined;
  colorContext ??= document.createElement('canvas').getContext('2d');
  if (!colorContext) return undefined;
  colorContext.fillStyle = '#000000';
  colorContext.fillStyle = value;
  const normalised = String(colorContext.fillStyle);
  // Fully opaque colours come back as #rrggbb; anything see-through as rgba().
  return normalised.startsWith('#') ? normalised.slice(1).toUpperCase() : undefined;
}

/** A CSS length ("12pt", "16px", "1.5em" of `base`) in points. */
function points(value: string, basePt: number): number | undefined {
  const match = /^(-?[\d.]+)(pt|px|em|rem|mm|cm|in)?$/.exec(value.trim());
  if (!match) return undefined;
  const amount = Number(match[1]);
  switch (match[2]) {
    case 'px':
      return amount * 0.75;
    case 'em':
    case 'rem':
      return amount * basePt;
    case 'mm':
      return (amount * 72) / 25.4;
    case 'cm':
      return (amount * 72) / 2.54;
    case 'in':
      return amount * 72;
    default:
      return amount;
  }
}

/** The first family of a CSS font-family list, unquoted. */
function firstFamily(value: string): string | undefined {
  const family = value
    .split(',')[0]
    ?.trim()
    .replace(/^["']|["']$/g, '');
  return family || undefined;
}

const ALIGNMENT = {
  left: AlignmentType.LEFT,
  start: AlignmentType.LEFT,
  center: AlignmentType.CENTER,
  right: AlignmentType.RIGHT,
  end: AlignmentType.RIGHT,
  justify: AlignmentType.JUSTIFIED,
} as const;

/* ---------- the letter's text ---------- */

type Mutable<T> = { -readonly [K in keyof T]: T[K] };
type RunStyle = Mutable<Omit<IRunOptions, 'text' | 'children' | 'break'>>;

/** The runs of text inside one paragraph, formatting included. */
function runsOf(node: Node, style: RunStyle, basePt: number): ParagraphChild[] {
  if (node.nodeType === Node.TEXT_NODE) {
    // Line breaks in the HTML source are just spaces when shown; tabs are
    // Word tabs.
    const text = (node.textContent ?? '').replace(/[\r\n]+/g, ' ');
    if (!text) return [];
    const children = text
      .split('\t')
      .flatMap((part, index) => (index ? [new Tab(), part] : [part]))
      .filter((child) => child !== '');
    return [new TextRun({ ...style, children })];
  }
  if (!(node instanceof HTMLElement)) return [];
  if (node.tagName === 'BR') return [new TextRun({ ...style, break: 1 })];

  const next: RunStyle = { ...style };
  switch (node.tagName) {
    case 'STRONG':
    case 'B':
      next.bold = true;
      break;
    case 'EM':
    case 'I':
      next.italics = true;
      break;
    case 'U':
      next.underline = {};
      break;
    case 'S':
    case 'STRIKE':
      next.strike = true;
      break;
  }
  const css = node.style;
  if (css.fontWeight === 'bold' || Number(css.fontWeight) >= 600) next.bold = true;
  if (css.fontStyle === 'italic') next.italics = true;
  if (css.textDecorationLine.includes('underline')) next.underline = {};
  if (css.textDecorationLine.includes('line-through')) next.strike = true;
  const color = wordColor(css.color);
  if (color) next.color = color;
  const highlight = wordColor(css.backgroundColor);
  if (highlight) next.shading = { type: 'clear', color: 'auto', fill: highlight };
  const size = css.fontSize ? points(css.fontSize, basePt) : undefined;
  if (size) next.size = Math.round(size * 2);
  const font = firstFamily(css.fontFamily);
  if (font) next.font = font;

  return Array.from(node.childNodes).flatMap((child) => runsOf(child, next, size ?? basePt));
}

const BLOCK_TAGS = new Set(['P', 'DIV', 'H2', 'H3', 'H4', 'LI', 'UL', 'OL', 'HR']);

interface ListContext {
  reference: typeof BULLETS | typeof NUMBERS;
  level: number;
  /** Numbered lists each start again at 1. */
  instance: number;
}

class LetterConverter {
  private listInstance = 0;
  private breakBefore = false;
  readonly paragraphs: Paragraph[] = [];

  constructor(private readonly basePt: number) {}

  /** Converts the children of `parent` (the letter, a list item, a block). */
  blocks(parent: Node, list?: ListContext) {
    let inline: Node[] = [];
    const flush = () => {
      if (inline.some((node) => (node.textContent ?? '').trim() || node.nodeName === 'BR')) {
        this.paragraph(inline, parent instanceof HTMLElement ? parent : null, list);
      }
      inline = [];
    };

    for (const node of Array.from(parent.childNodes)) {
      if (!(node instanceof HTMLElement) || !BLOCK_TAGS.has(node.tagName)) {
        inline.push(node);
        continue;
      }
      flush();
      this.block(node, list);
    }
    flush();
  }

  private block(element: HTMLElement, list?: ListContext) {
    switch (element.tagName) {
      case 'HR':
        this.breakBefore = true;
        return;
      case 'UL':
      case 'OL': {
        const reference = element.tagName === 'OL' ? NUMBERS : BULLETS;
        this.blocks(element, {
          reference,
          level: list ? Math.min(list.level + 1, 2) : 0,
          instance: reference === NUMBERS ? ++this.listInstance : 0,
        });
        return;
      }
      case 'LI': {
        // The item's own text, then any list nested inside it.
        const own = Array.from(element.childNodes).filter(
          (node) =>
            !(node instanceof HTMLElement && (node.tagName === 'UL' || node.tagName === 'OL')),
        );
        this.paragraph(own, element, list);
        for (const nested of Array.from(element.children)) {
          if (nested.tagName === 'UL' || nested.tagName === 'OL') {
            this.block(nested as HTMLElement, list);
          }
        }
        return;
      }
      default: {
        // A paragraph holding other paragraphs (pasted pages do this).
        if (Array.from(element.children).some((child) => BLOCK_TAGS.has(child.tagName))) {
          this.blocks(element, list);
          return;
        }
        this.paragraph(Array.from(element.childNodes), element, list);
      }
    }
  }

  private paragraph(nodes: Node[], element: HTMLElement | null, list?: ListContext) {
    const tag = element?.tagName ?? 'P';
    const headingPt = HEADING_SIZE_PT[tag === 'H4' ? 'H3' : tag];
    const base: RunStyle = headingPt ? { bold: true, size: headingPt * 2 } : {};
    const children = nodes.flatMap((node) => runsOf(node, base, headingPt ?? this.basePt));
    const css = element?.style;
    const align = css?.textAlign as keyof typeof ALIGNMENT | undefined;
    const indentLeft = css?.marginLeft ? points(css.marginLeft, this.basePt) : undefined;
    const firstLine = css?.textIndent ? points(css.textIndent, this.basePt) : undefined;

    this.paragraphs.push(
      new Paragraph({
        children,
        pageBreakBefore: this.breakBefore || undefined,
        alignment: align ? ALIGNMENT[align] : undefined,
        numbering: list
          ? {
              reference: list.reference,
              level: list.level,
              ...(list.reference === NUMBERS ? { instance: list.instance } : {}),
            }
          : undefined,
        indent:
          !list && (indentLeft || firstLine)
            ? {
                left: indentLeft ? Math.round(indentLeft * TWIPS_PER_PT) : undefined,
                firstLine:
                  firstLine && firstLine > 0 ? Math.round(firstLine * TWIPS_PER_PT) : undefined,
                hanging:
                  firstLine && firstLine < 0 ? Math.round(-firstLine * TWIPS_PER_PT) : undefined,
              }
            : undefined,
        spacing: headingPt ? { before: 12 * TWIPS_PER_PT } : undefined,
        keepNext: headingPt ? true : undefined,
      }),
    );
    this.breakBefore = false;
  }

  /** A page break at the very end still starts a (blank) new page, as on screen. */
  finish() {
    if (this.breakBefore) this.paragraphs.push(new Paragraph({ children: [new PageBreak()] }));
    if (!this.paragraphs.length) this.paragraphs.push(new Paragraph({}));
  }
}

/* ---------- the letterhead ---------- */

interface PngImage {
  data: Uint8Array;
  width: number;
  height: number;
}

async function canvasPng(canvas: HTMLCanvasElement): Promise<PngImage | null> {
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
  if (!blob) return null;
  return {
    data: new Uint8Array(await blob.arrayBuffer()),
    width: canvas.width,
    height: canvas.height,
  };
}

/**
 * The logo as a PNG — whatever format it was added in — optionally faded
 * onto white for the watermark (Word images have no transparency setting).
 */
async function logoPng(dataUrl: string, opacity = 1): Promise<PngImage | null> {
  const image = new Image();
  image.src = dataUrl;
  try {
    await image.decode();
  } catch {
    return null;
  }
  const canvas = document.createElement('canvas');
  canvas.width = image.naturalWidth;
  canvas.height = image.naturalHeight;
  const context = canvas.getContext('2d');
  if (!context || !canvas.width || !canvas.height) return null;
  if (opacity < 1) {
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.globalAlpha = opacity;
  }
  context.drawImage(image, 0, 0);
  return canvasPng(canvas);
}

/**
 * The company name as a faded image, for the watermark of a letterhead with
 * no logo — the same mark the screen shows. Drawn at 10 pixels a millimetre.
 */
async function nameWatermarkPng(name: string): Promise<PngImage | null> {
  const scale = 10;
  const width = WATERMARK.nameWidth * scale;
  const fontSize = width * WATERMARK.nameSize;
  const lineHeight = fontSize * 1.25;
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d');
  if (!context) return null;
  const font = `900 ${fontSize}px Arial, sans-serif`;
  context.font = font;

  // Wrap the name onto as many lines as it needs, as the screen does.
  const lines: string[] = [];
  for (const word of name.toUpperCase().split(/\s+/).filter(Boolean)) {
    const line = lines.at(-1);
    if (line && context.measureText(`${line} ${word}`).width <= width) {
      lines[lines.length - 1] = `${line} ${word}`;
    } else {
      lines.push(word);
    }
  }
  if (!lines.length) return null;

  canvas.width = width;
  canvas.height = Math.ceil(lines.length * lineHeight);
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.globalAlpha = WATERMARK.nameOpacity;
  context.fillStyle = '#000000';
  context.font = font;
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  lines.forEach((line, index) => context.fillText(line, width / 2, (index + 0.5) * lineHeight));
  return canvasPng(canvas);
}

/** Scales an image to fit within a box given in millimetres; returns pixels. */
function fit(image: PngImage, maxWidthMm: number, maxHeightMm: number) {
  const scale = Math.min(
    (maxWidthMm * PX_PER_MM) / image.width,
    (maxHeightMm * PX_PER_MM) / image.height,
  );
  return { width: Math.round(image.width * scale), height: Math.round(image.height * scale) };
}

const mmToEmu = (mm: number) => Math.round(mm * 36000);

/** The heavy-over-hairline rule under the name and over the footer. */
const RULE = { style: BorderStyle.THICK_THIN_SMALL_GAP, size: 12, color: '595959', space: 4 };

/** Header and footer span the frame, which is wider than the text. */
const FRAME_OVERHANG = convertMillimetersToTwip(LETTER_PAGE.textMargin - LETTER_PAGE.frameMargin);
const FRAME_WIDTH = convertMillimetersToTwip(LETTER_PAGE.width - 2 * LETTER_PAGE.frameMargin);
const LOGO_BOX = { width: 48, height: 26 };

async function letterheadHeader(letterhead: Letterhead): Promise<Header> {
  const [logo, watermark] = letterhead.logo
    ? await Promise.all([logoPng(letterhead.logo), logoPng(letterhead.logo, WATERMARK.logoOpacity)])
    : [null, await nameWatermarkPng(letterhead.legalName)];
  const logoSize = logo ? fit(logo, LOGO_BOX.width, LOGO_BOX.height) : null;
  // The name and the rule stop where the logo starts, so the rule meets it.
  const indent = {
    left: -FRAME_OVERHANG,
    right: -FRAME_OVERHANG + (logoSize ? convertMillimetersToTwip(logoSize.width / PX_PER_MM) : 0),
  };

  const images: ParagraphChild[] = [];
  if (logo && logoSize) {
    images.push(
      new ImageRun({
        type: 'png',
        data: logo.data,
        transformation: logoSize,
        floating: {
          horizontalPosition: {
            relative: HorizontalPositionRelativeFrom.PAGE,
            offset: mmToEmu(
              LETTER_PAGE.width - LETTER_PAGE.frameMargin - logoSize.width / PX_PER_MM,
            ),
          },
          verticalPosition: {
            relative: VerticalPositionRelativeFrom.PAGE,
            offset: mmToEmu(
              LETTER_PAGE.headerTop + (LOGO_BOX.height - logoSize.height / PX_PER_MM) / 2,
            ),
          },
          allowOverlap: true,
        },
      }),
    );
  }
  if (watermark) {
    images.push(
      new ImageRun({
        type: 'png',
        data: watermark.data,
        transformation: letterhead.logo
          ? fit(watermark, WATERMARK.logoWidth, WATERMARK.logoWidth)
          : fit(watermark, WATERMARK.nameWidth, LETTER_PAGE.height),
        floating: {
          horizontalPosition: {
            relative: HorizontalPositionRelativeFrom.PAGE,
            align: HorizontalPositionAlign.CENTER,
          },
          verticalPosition: {
            relative: VerticalPositionRelativeFrom.PAGE,
            align: VerticalPositionAlign.CENTER,
          },
          behindDocument: true,
          allowOverlap: true,
        },
      }),
    );
  }

  return new Header({
    children: [
      new Paragraph({
        indent,
        children: [
          ...images,
          ...(letterhead.arabicName
            ? [
                new TextRun({
                  text: letterhead.arabicName,
                  rightToLeft: true,
                  bold: true,
                  boldComplexScript: true,
                  size: 28,
                  sizeComplexScript: 28,
                  color: '262626',
                  font: 'Traditional Arabic',
                }),
              ]
            : []),
        ],
        border: { bottom: RULE },
        spacing: { after: 100 },
      }),
      new Paragraph({
        indent,
        children: [
          new TextRun({
            text: letterhead.legalName,
            allCaps: true,
            size: 23,
            color: '404040',
            characterSpacing: 10,
          }),
        ],
      }),
    ],
  });
}

function letterheadFooter(letterhead: Letterhead): Footer {
  const contact = [
    letterhead.phone && `☎  ${letterhead.phone}`,
    letterhead.email && `✉  ${letterhead.email}`,
    letterhead.website,
  ].filter(Boolean) as string[];
  const indent = { left: -FRAME_OVERHANG, right: -FRAME_OVERHANG };

  return new Footer({
    children: [
      new Paragraph({
        indent,
        border: { top: RULE },
        spacing: { before: 0, after: 80 },
        // One centred stop per item, spread evenly across the frame.
        tabStops: contact.map((_, index) => ({
          type: TabStopType.CENTER,
          position: Math.round((FRAME_WIDTH * (2 * index + 1)) / (2 * contact.length)),
        })),
        children: contact.flatMap((item) => [
          new TextRun({ children: [new Tab(), item], size: 20, color: '262626' }),
        ]),
      }),
      ...(letterhead.address
        ? [
            new Paragraph({
              indent,
              alignment: AlignmentType.CENTER,
              children: [
                new TextRun({ text: letterhead.address, bold: true, size: 20, color: '262626' }),
              ],
            }),
          ]
        : []),
    ],
  });
}

/* ---------- the document ---------- */

const levels = (
  formats: { format: (typeof LevelFormat)[keyof typeof LevelFormat]; text: string }[],
) =>
  formats.map(({ format, text }, level) => ({
    level,
    format,
    text,
    alignment: AlignmentType.LEFT,
    style: {
      paragraph: {
        indent: {
          left: convertMillimetersToTwip(7 * (level + 1)),
          hanging: convertMillimetersToTwip(5),
        },
      },
    },
  }));

export async function letterDocx(
  letterHtml: string,
  letterhead: Letterhead,
  style: LetterStyle,
): Promise<Blob> {
  const letter = new DOMParser().parseFromString(letterHtml, 'text/html').body;
  const converter = new LetterConverter(style.size);
  converter.blocks(letter);
  converter.finish();

  const document = new Document({
    creator: letterhead.legalName,
    title: 'Letter',
    styles: {
      default: {
        document: {
          run: { font: style.font, size: Math.round(style.size * 2) },
          paragraph: {
            spacing: {
              after: PARAGRAPH_GAP_PT * TWIPS_PER_PT,
              line: Math.round(style.lineSpacing * 240),
            },
          },
        },
      },
    },
    numbering: {
      config: [
        {
          reference: BULLETS,
          levels: levels([
            { format: LevelFormat.BULLET, text: '•' },
            { format: LevelFormat.BULLET, text: '◦' },
            { format: LevelFormat.BULLET, text: '▪' },
          ]),
        },
        {
          reference: NUMBERS,
          levels: levels([
            { format: LevelFormat.DECIMAL, text: '%1.' },
            { format: LevelFormat.LOWER_LETTER, text: '%2.' },
            { format: LevelFormat.LOWER_ROMAN, text: '%3.' },
          ]),
        },
      ],
    },
    sections: [
      {
        properties: {
          page: {
            size: {
              width: convertMillimetersToTwip(LETTER_PAGE.width),
              height: convertMillimetersToTwip(LETTER_PAGE.height),
            },
            margin: {
              top: convertMillimetersToTwip(TEXT_TOP),
              bottom: convertMillimetersToTwip(LETTER_PAGE.height - TEXT_BOTTOM),
              left: convertMillimetersToTwip(LETTER_PAGE.textMargin),
              right: convertMillimetersToTwip(LETTER_PAGE.textMargin),
              header: convertMillimetersToTwip(LETTER_PAGE.headerTop),
              footer: convertMillimetersToTwip(LETTER_PAGE.footerBottom),
            },
          },
        },
        headers: { default: await letterheadHeader(letterhead) },
        footers: { default: letterheadFooter(letterhead) },
        children: converter.paragraphs,
      },
    ],
  });

  return Packer.toBlob(document);
}
