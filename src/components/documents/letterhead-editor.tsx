'use client';

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type ClipboardEvent,
  type CSSProperties,
  type KeyboardEvent,
  type MouseEvent,
} from 'react';
import Link from 'next/link';
import { FileDown, FilePlus2, ImagePlus, Loader2, Printer, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ConfirmAction } from '@/components/shared/confirm-action';
import { LetterheadSheet } from '@/components/documents/letterhead-sheet';
import {
  EMPTY_FORMAT,
  FONT_SIZES,
  LETTER_FONTS,
  LetterToolbar,
  type FormatState,
  type LetterToolbarActions,
} from '@/components/documents/letter-toolbar';
import { formatDate, localDateString } from '@/lib/format';
import { cleanPastedHtml, plainTextToHtml } from '@/lib/documents/letter-paste';
import {
  LETTER_PAGE,
  TEXT_TOP,
  letterHtml,
  paginate,
  wrapLooseText,
} from '@/lib/documents/letter-pages';
import type { Letterhead, LetterheadDetails } from '@/lib/documents/letterhead';
import { cn } from '@/lib/utils';

/*
 * A letter on the company letterhead, written like a Word document: it
 * fills A4 pages, adding pages as the text grows, and prints, saves as a
 * PDF or downloads as a Word file with the letterhead on every page.
 *
 * The name, phone, email and address come from Settings. The Arabic name,
 * website and logo are kept in this browser, with the draft.
 *
 * The text is a contentEditable column over the page sheets, formatted
 * through the toolbar (document.execCommand — deprecated, but the one
 * formatting API every browser supports without a library). Pasted text
 * keeps its formatting but nothing else (lib/documents/letter-paste.ts).
 */

interface LocalExtras {
  arabicName: string;
  website: string;
  /** A small image as a data URL. */
  logo: string;
}

interface Draft {
  html: string;
  lineSpacing: number;
}

const EMPTY_EXTRAS: LocalExtras = { arabicName: '', website: '', logo: '' };
/** Large enough for a logo, small enough for browser storage. */
const MAX_LOGO_BYTES = 300 * 1024;

/** Word's defaults for a new document. */
const BASE_FONT = 'Calibri';
const BASE_SIZE_PT = 11;
const DEFAULT_LINE_SPACING = 1.15;
/** Fonts to fall back on where Calibri isn't installed (Carlito matches its size). */
const FONT_FALLBACK = "Carlito, 'Segoe UI', Arial, sans-serif";
/**
 * Word's "single" line is about 1.2 times the font size; CSS's line-height
 * is a plain multiple of it. This keeps the spacing the same in both.
 */
const WORD_LINE_HEIGHT = 1.2;

const EMPTY_LETTER = '<p><br></p>';

function read<T>(key: string, fallback: T): T {
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function write(key: string, value: unknown) {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage full or disabled: the letter still prints, it just isn't kept.
  }
}

function isEmpty(letter: HTMLElement) {
  return !letter.textContent?.trim() && !letter.querySelector('hr, li');
}

/** The formatting at the cursor, for the toolbar. */
function readFormat(anchor: Node | null): FormatState {
  const state = (command: string) => document.queryCommandState(command);
  const block = document.queryCommandValue('formatBlock').toLowerCase();
  const element = anchor instanceof Element ? anchor : (anchor?.parentElement ?? null);
  const computed = element ? getComputedStyle(element) : null;
  const family =
    computed?.fontFamily
      .split(',')[0]
      ?.trim()
      .replace(/^["']|["']$/g, '') ?? '';
  const points = computed ? Math.round(parseFloat(computed.fontSize) * 0.75 * 2) / 2 : 0;

  return {
    bold: state('bold'),
    italic: state('italic'),
    underline: state('underline'),
    strike: state('strikeThrough'),
    align: state('justifyCenter')
      ? 'center'
      : state('justifyRight')
        ? 'right'
        : state('justifyFull')
          ? 'justify'
          : 'left',
    list: state('insertOrderedList') ? 'ol' : state('insertUnorderedList') ? 'ul' : null,
    block: block === 'h2' || block === 'h3' ? block : 'p',
    font: LETTER_FONTS.find((font) => font.toLowerCase() === family.toLowerCase()) ?? '',
    size: FONT_SIZES.some((size) => size === points) ? String(points) : '',
  };
}

const mm = (value: number) => `${value}mm`;

export function LetterheadEditor({
  details,
  storageKey,
  canEditSettings,
}: {
  details: LetterheadDetails;
  /** Scopes what this browser keeps to one workshop. */
  storageKey: string;
  /** Whether to offer a link to Settings when a contact detail is missing. */
  canEditSettings: boolean;
}) {
  const letterRef = useRef<HTMLDivElement>(null);
  /** The selection in the letter, restored after a toolbar control takes focus. */
  const savedRange = useRef<Range | null>(null);
  /** The size last picked, for text typed after picking it. */
  const pickedSize = useRef<number | null>(null);
  const [extras, setExtras] = useState<LocalExtras>(EMPTY_EXTRAS);
  const [lineSpacing, setLineSpacing] = useState(DEFAULT_LINE_SPACING);
  const [pageCount, setPageCount] = useState(1);
  const [empty, setEmpty] = useState(true);
  const [format, setFormat] = useState<FormatState>(EMPTY_FORMAT);
  const [logoError, setLogoError] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);
  const extrasKey = `${storageKey}:letterhead`;
  const draftKey = `${storageKey}:letter-draft`;

  /** Contact details Settings lacks, so the footer can't show them. */
  const missing = (
    [
      ['phone number', details.phone],
      ['email', details.email],
      ['address', details.address],
    ] as const
  )
    .filter(([, value]) => !value)
    .map(([label]) => label);

  const letterhead: Letterhead = {
    legalName: details.legalName,
    phone: details.phone,
    email: details.email,
    address: details.address,
    ...extras,
  };

  /** Re-lays the pages after any change to the text. */
  const layout = useCallback(() => {
    const letter = letterRef.current;
    if (!letter) return;
    wrapLooseText(letter);
    setPageCount(paginate(letter));
    setEmpty(isEmpty(letter));
  }, []);

  const saveDraft = useCallback(
    (spacing: number) => {
      const letter = letterRef.current;
      if (letter)
        write(draftKey, { html: letterHtml(letter), lineSpacing: spacing } satisfies Draft);
    },
    [draftKey],
  );

  // Load what this browser kept: the extra details and the last draft.
  useEffect(() => {
    const timeout = setTimeout(() => {
      setExtras({ ...EMPTY_EXTRAS, ...read<Partial<LocalExtras>>(extrasKey, {}) });
      // Drafts kept before line spacing existed are plain HTML.
      const draft = read<Draft | string>(draftKey, '');
      const html = typeof draft === 'string' ? draft : draft.html;
      if (typeof draft !== 'string') setLineSpacing(draft.lineSpacing);
      if (letterRef.current) letterRef.current.innerHTML = html || EMPTY_LETTER;
      layout();
    }, 0);
    return () => clearTimeout(timeout);
  }, [extrasKey, draftKey, layout]);

  // Line spacing changes every line's height; web fonts arriving change
  // widths. Either moves text between pages.
  useEffect(() => {
    const frame = requestAnimationFrame(layout);
    document.fonts?.ready.then(layout).catch(() => {});
    return () => cancelAnimationFrame(frame);
  }, [lineSpacing, layout]);

  // Follow the cursor: remember it, and show its formatting on the toolbar.
  useEffect(() => {
    function onSelectionChange() {
      const letter = letterRef.current;
      const selection = window.getSelection();
      if (!letter || !selection?.rangeCount) return;
      const range = selection.getRangeAt(0);
      if (!letter.contains(range.commonAncestorContainer)) return;
      savedRange.current = range.cloneRange();
      setFormat(readFormat(selection.focusNode));
    }
    document.addEventListener('selectionchange', onSelectionChange);
    return () => document.removeEventListener('selectionchange', onSelectionChange);
  }, []);

  function updateExtras(patch: Partial<LocalExtras>) {
    setExtras((current) => {
      const next = { ...current, ...patch };
      write(extrasKey, next);
      return next;
    });
  }

  /**
   * Sizes are applied as the largest of the browser's seven legacy sizes,
   * then swapped for the size picked — the only way execCommand can set
   * an exact size.
   */
  function applyPickedSize() {
    const letter = letterRef.current;
    if (!letter || pickedSize.current === null) return;
    const size = `${pickedSize.current}pt`;
    for (const span of Array.from(letter.querySelectorAll<HTMLElement>('span'))) {
      if (span.style.fontSize === 'xxx-large') span.style.fontSize = size;
    }
    for (const font of Array.from(letter.querySelectorAll('font[size="7"]'))) {
      const span = document.createElement('span');
      span.style.fontSize = size;
      span.append(...Array.from(font.childNodes));
      font.replaceWith(span);
    }
  }

  function changed() {
    applyPickedSize();
    layout();
    saveDraft(lineSpacing);
  }

  function focusLetter() {
    const letter = letterRef.current;
    if (!letter) return;
    letter.focus({ preventScroll: true });
    const selection = window.getSelection();
    if (savedRange.current && selection) {
      selection.removeAllRanges();
      selection.addRange(savedRange.current);
    }
  }

  function exec(command: string, value?: string) {
    document.execCommand('styleWithCSS', false, 'true');
    document.execCommand(command, false, value);
  }

  const actions: LetterToolbarActions = {
    run(command, value) {
      focusLetter();
      exec(command, value);
      changed();
      setFormat(readFormat(window.getSelection()?.focusNode ?? null));
    },
    setFontSize(points) {
      focusLetter();
      pickedSize.current = points;
      exec('fontSize', '7');
      changed();
      setFormat((current) => ({ ...current, size: String(points) }));
    },
    insertDate() {
      actions.run('insertText', formatDate(new Date()));
    },
    insertPageBreak() {
      actions.run('insertHTML', `<hr>${EMPTY_LETTER}`);
    },
  };

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      actions.insertPageBreak();
    } else if (event.key === 'Tab') {
      event.preventDefault();
      // In a list, Tab moves the item in or out a level; elsewhere it's a tab.
      if (format.list) actions.run(event.shiftKey ? 'outdent' : 'indent');
      else if (!event.shiftKey) actions.run('insertText', '\t');
    }
  }

  function onPaste(event: ClipboardEvent<HTMLDivElement>) {
    event.preventDefault();
    const html = event.clipboardData.getData('text/html');
    const text = event.clipboardData.getData('text/plain');
    if (html) exec('insertHTML', cleanPastedHtml(html));
    // Several lines become paragraphs; a few words just join the line.
    else if (/[\r\n]/.test(text)) exec('insertHTML', plainTextToHtml(text));
    else exec('insertText', text);
    changed();
  }

  /** Puts the cursor at the end of `element`'s text, in the letter. */
  function caretToEnd(element: HTMLElement) {
    letterRef.current?.focus({ preventScroll: true });
    const range = document.createRange();
    range.selectNodeContents(element);
    range.collapse(false);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
  }

  /** A click on a page below the text puts the cursor at the end of the letter. */
  function onPageMouseDown(event: MouseEvent<HTMLDivElement>) {
    const letter = letterRef.current;
    if (!letter || letter.contains(event.target as Node)) return;
    event.preventDefault();
    const last = letter.lastElementChild;
    caretToEnd(last instanceof HTMLElement && last.tagName !== 'HR' ? last : letter);
  }

  /** Starts a new page after the text, with the cursor at its top. */
  function addPage() {
    const letter = letterRef.current;
    if (!letter) return;
    const paragraph = document.createElement('p');
    paragraph.append(document.createElement('br'));
    letter.append(document.createElement('hr'), paragraph);
    layout();
    saveDraft(lineSpacing);
    caretToEnd(paragraph);
    paragraph.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }

  function onLogo(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    setLogoError(null);
    if (!file.type.startsWith('image/')) return setLogoError('Choose an image file.');
    if (file.size > MAX_LOGO_BYTES) return setLogoError('Choose an image under 300 KB.');
    const reader = new FileReader();
    reader.onload = () => updateExtras({ logo: String(reader.result) });
    reader.readAsDataURL(file);
  }

  function changeLineSpacing(spacing: number) {
    setLineSpacing(spacing);
    saveDraft(spacing);
  }

  /** Empties the letter the way Select all + Delete would, so Ctrl+Z brings it back. */
  /**
   * Starts a new letter: the text, its formatting and the line spacing go;
   * the letterhead details stay. Replaces the content outright — the
   * confirmation dialog is open and holds focus, so editing commands, which
   * act only where the cursor is, can't reach the letter.
   */
  function clearLetter() {
    const letter = letterRef.current;
    if (!letter) return;
    letter.innerHTML = EMPTY_LETTER;
    savedRange.current = null;
    pickedSize.current = null;
    setFormat(EMPTY_FORMAT);
    setLineSpacing(DEFAULT_LINE_SPACING);
    layout();
    saveDraft(DEFAULT_LINE_SPACING);
  }

  async function downloadWord() {
    const letter = letterRef.current;
    if (!letter) return;
    setDownloading(true);
    try {
      // The Word library is only loaded when a letter is downloaded.
      const { letterDocx } = await import('@/lib/documents/letter-docx');
      const blob = await letterDocx(letterHtml(letter), letterhead, {
        font: BASE_FONT,
        size: BASE_SIZE_PT,
        lineSpacing,
      });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `${details.filePrefix}-letter-${localDateString()}.docx`;
      link.click();
      // Give the browser a moment to start the download before letting go.
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch {
      toast.error('The Word file could not be made. Try again, or print to PDF instead.');
    } finally {
      setDownloading(false);
    }
  }

  const pageStyle = (index: number): CSSProperties => ({
    top: `calc(${index} * (${mm(LETTER_PAGE.height)} + var(--letter-gap)))`,
  });

  return (
    <div className="flex flex-col gap-6">
      {/* Controls — never printed. */}
      <div className="letterhead-controls flex flex-col gap-4">
        <div className="grid gap-4 rounded-xl border border-border bg-card p-4 sm:grid-cols-3 sm:p-5">
          <label className="flex flex-col gap-1.5 text-sm">
            <span className="font-medium">Name in Arabic</span>
            <Input
              dir="rtl"
              value={extras.arabicName}
              onChange={(event) => updateExtras({ arabicName: event.target.value })}
              placeholder="الاسم بالعربية"
              className="h-10"
            />
          </label>
          <label className="flex flex-col gap-1.5 text-sm">
            <span className="font-medium">Website</span>
            <Input
              value={extras.website}
              onChange={(event) => updateExtras({ website: event.target.value })}
              placeholder="www.example.com"
              className="h-10"
            />
          </label>
          <div className="flex flex-col gap-1.5 text-sm">
            <span className="font-medium">Logo</span>
            <div className="flex flex-wrap items-center gap-2">
              <label className="inline-flex h-10 cursor-pointer items-center gap-2 rounded-lg border border-border bg-card px-3 font-medium hover:bg-muted">
                <ImagePlus className="size-4" />
                {extras.logo ? 'Change' : 'Add logo'}
                <input type="file" accept="image/*" className="sr-only" onChange={onLogo} />
              </label>
              {extras.logo ? (
                <Button variant="ghost" size="sm" onClick={() => updateExtras({ logo: '' })}>
                  Remove
                </Button>
              ) : null}
            </div>
            {logoError ? <span className="text-xs text-destructive">{logoError}</span> : null}
          </div>
          <p className="text-xs text-muted-foreground sm:col-span-3">
            The name, phone, email and address come from Settings. These three are kept in this
            browser only.
          </p>
          {missing.length ? (
            <p
              role="status"
              className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 sm:col-span-3"
            >
              The letterhead has no {missing.join(' or ')} because Settings has none.{' '}
              {canEditSettings ? (
                <Link href="/settings" className="font-medium underline underline-offset-2">
                  Add it in Settings
                </Link>
              ) : (
                'Ask someone who manages Settings to add it.'
              )}
            </p>
          ) : null}
        </div>

        <div className="sticky top-[calc(4.5rem+env(safe-area-inset-top))] z-20 flex flex-col gap-2">
          <LetterToolbar
            format={format}
            actions={actions}
            lineSpacing={lineSpacing}
            onLineSpacing={changeLineSpacing}
          />
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm text-muted-foreground tabular-nums">
              {pageCount} {pageCount === 1 ? 'page' : 'pages'}
            </span>
            <Button variant="ghost" size="sm" onClick={addPage}>
              <FilePlus2 />
              Add page
            </Button>
            <div className="ml-auto flex flex-wrap gap-2">
              <ConfirmAction
                trigger={
                  <Button variant="outline">
                    <Trash2 />
                    New letter
                  </Button>
                }
                title="Start a new letter?"
                description="The text of this letter is cleared. The letterhead details stay."
                confirmLabel="Clear letter"
                onConfirm={async () => clearLetter()}
              />
              <Button variant="outline" onClick={downloadWord} disabled={downloading}>
                {downloading ? <Loader2 className="animate-spin" /> : <FileDown />}
                Download Word
              </Button>
              <Button onClick={() => window.print()}>
                <Printer />
                Print / Save as PDF
              </Button>
            </div>
          </div>
        </div>
      </div>

      {/*
       * The pages: A4 sheets stacked with a gap, the letter laid over them.
       * lib/documents/letter-pages.ts moves text that reaches a sheet's
       * footer to the next sheet; the print stylesheet closes the gaps.
       */}
      <div className="overflow-x-auto pb-6">
        <div
          className="letterhead-page relative mx-auto text-black"
          onMouseDown={onPageMouseDown}
          style={
            {
              '--letter-gap': mm(LETTER_PAGE.gap),
              width: mm(LETTER_PAGE.width),
              height: `calc(${pageCount} * ${mm(LETTER_PAGE.height)} + ${pageCount - 1} * var(--letter-gap))`,
            } as CSSProperties
          }
        >
          {Array.from({ length: pageCount }, (_, index) => (
            <LetterheadSheet key={index} letterhead={letterhead} style={pageStyle(index)} />
          ))}

          {empty ? (
            <p
              aria-hidden
              className="letter-placeholder pointer-events-none absolute text-neutral-400"
              style={{
                top: mm(TEXT_TOP),
                left: mm(LETTER_PAGE.textMargin),
                fontFamily: `${BASE_FONT}, ${FONT_FALLBACK}`,
                fontSize: `${BASE_SIZE_PT}pt`,
              }}
            >
              Type or paste the letter here…
            </p>
          ) : null}

          <div
            ref={letterRef}
            contentEditable
            suppressContentEditableWarning
            role="textbox"
            aria-multiline
            aria-label="Letter text"
            spellCheck
            onInput={changed}
            onBlur={() => saveDraft(lineSpacing)}
            onKeyDown={onKeyDown}
            onPaste={onPaste}
            className={cn(
              'relative wrap-break-word whitespace-pre-wrap outline-none tab-4',
              // Paragraph spacing, headings and lists match the Word export (letter-docx.ts).
              '[&_div]:mb-[6pt] [&_p]:mb-[6pt] [&_h2]:mt-[12pt] [&_h2]:mb-[6pt] [&_h3]:mt-[12pt] [&_h3]:mb-[6pt]',
              '[&_h2]:text-[16pt] [&_h2]:font-bold [&_h3]:text-[13pt] [&_h3]:font-bold',
              '[&_ol]:mb-[6pt] [&_ol]:list-decimal [&_ol]:pl-[7mm] [&_ul]:mb-[6pt] [&_ul]:list-disc [&_ul]:pl-[7mm]',
              '[&_ol_ol]:mb-0 [&_ol_ol]:list-[lower-alpha] [&_ul_ul]:mb-0 [&_ul_ul]:list-[circle]',
              '[&_hr]:my-2 [&_hr]:border-dashed [&_hr]:border-neutral-300',
            )}
            style={{
              paddingTop: mm(TEXT_TOP),
              paddingInline: mm(LETTER_PAGE.textMargin),
              fontFamily: `${BASE_FONT}, ${FONT_FALLBACK}`,
              fontSize: `${BASE_SIZE_PT}pt`,
              lineHeight: lineSpacing * WORD_LINE_HEIGHT,
            }}
          />
        </div>
      </div>
    </div>
  );
}
