/*
 * Pages for a letter on the letterhead, the way a word processor lays them
 * out: the text fills a page between the letterhead's header and footer,
 * and whatever doesn't fit continues on the next page, added as needed.
 *
 * The letter is one editable column laid over a stack of A4 sheets. After
 * each change, `paginate` walks the letter's paragraphs and list items from
 * the top. One that would run into a page's footer is either split at its
 * last line that fits — the rest continuing on the next page — or, when that
 * would leave a line stranded, moved to the next page whole. Moving is done
 * with top padding, so the text itself is never touched.
 *
 * A split really divides the paragraph in two, so it is undone before every
 * layout (and in the saved draft and the Word file): the letter's content
 * stays exactly as written.
 *
 * On screen the sheets have a gap between them; on paper they don't. Each
 * padding that crosses to a later page counts those gaps in the CSS
 * variable `--letter-gap`, which the print stylesheet sets to 0 — so the
 * printed pages break exactly where the screen shows them.
 *
 * Browser only: it measures the rendered letter.
 */

/** Page geometry in millimetres. */
export const LETTER_PAGE = {
  width: 210,
  height: 297,
  /** Space between sheets on screen. */
  gap: 10,
  /** Left and right margin of the letterhead's header and footer. */
  frameMargin: 18,
  /** Left and right margin of the letter's text. */
  textMargin: 24,
  /** Space above the header. */
  headerTop: 12,
  /** Height of the header — its top margin included. */
  headerHeight: 38,
  /** Space below the footer. */
  footerBottom: 10,
  /** Height of the footer — its bottom margin included. */
  footerHeight: 28,
  /** Space between the text and the header or footer. */
  textGap: 8,
} as const;

/**
 * The faded mark in the middle of each page: the logo, or — with no logo —
 * the company name. Widths in millimetres; opacity from 0 to 1.
 */
export const WATERMARK = {
  logoWidth: 125,
  logoOpacity: 0.09,
  nameWidth: 150,
  nameOpacity: 0.07,
  /** The name's letters, as a share of the watermark's width. */
  nameSize: 0.06,
} as const;

/** Where the text starts on each page, from the page's top edge. */
export const TEXT_TOP = LETTER_PAGE.headerHeight + LETTER_PAGE.textGap;
/** Where the text must end on each page, from the page's top edge. */
export const TEXT_BOTTOM = LETTER_PAGE.height - LETTER_PAGE.footerHeight - LETTER_PAGE.textGap;

/** CSS pixels per millimetre — fixed by CSS, whatever the screen. */
const PX_PER_MM = 96 / 25.4;

/** Marks a piece padded down the page, so the padding can be undone. */
const PUSHED = 'data-page-push';
/** Marks the first part of a split paragraph; its next sibling is the rest. */
const SPLIT = 'data-page-split';

/** Paragraphs that may be split across pages. List items and headings move whole. */
const SPLITTABLE = new Set(['P', 'DIV']);
const BLOCK_TAGS = new Set(['P', 'DIV', 'H1', 'H2', 'H3', 'H4', 'UL', 'OL', 'LI', 'HR']);
/** Fewest lines left at a page's foot, or carried to the next, by a split. */
const MIN_LINES = 2;

/**
 * The pieces laid out on pages: each paragraph, heading and line, and each
 * item of a list. A page break (<hr>) is one too — whatever follows it starts
 * a new page. A block holding other blocks (pasted pages do this) is looked
 * into rather than laid out whole.
 */
function blocksOf(parent: HTMLElement): HTMLElement[] {
  const blocks: HTMLElement[] = [];
  for (const child of Array.from(parent.children)) {
    if (!(child instanceof HTMLElement)) continue;
    if (child.tagName === 'UL' || child.tagName === 'OL') {
      for (const item of Array.from(child.children)) {
        if (item instanceof HTMLElement) blocks.push(item);
      }
    } else if (
      child.tagName === 'DIV' &&
      Array.from(child.children).some((inner) => BLOCK_TAGS.has(inner.tagName))
    ) {
      blocks.push(...blocksOf(child));
    } else {
      blocks.push(child);
    }
  }
  return blocks;
}

function clearPushes(root: HTMLElement) {
  for (const block of Array.from(root.querySelectorAll<HTMLElement>(`[${PUSHED}]`))) {
    block.style.removeProperty('padding-top');
    block.removeAttribute(PUSHED);
    if (!block.getAttribute('style')) block.removeAttribute('style');
  }
}

/** Joins every split paragraph back into one. */
function joinSplits(root: HTMLElement) {
  // Last first, so a paragraph split over three pages joins up in one pass.
  const heads = Array.from(root.querySelectorAll<HTMLElement>(`[${SPLIT}]`)).reverse();
  for (const head of heads) {
    const rest = head.nextElementSibling;
    head.removeAttribute(SPLIT);
    if (!(rest instanceof HTMLElement)) continue;
    if (rest.hasAttribute(SPLIT)) head.setAttribute(SPLIT, '');
    head.append(...Array.from(rest.childNodes));
    rest.remove();
    head.normalize();
  }
}

/* ---------- keeping the cursor in place ---------- */

/**
 * The cursor as a count of characters from the letter's start. Splitting
 * and joining paragraphs moves text between elements but never changes the
 * text, so the count finds the same spot afterwards.
 */
interface SavedCursor {
  node: Node;
  offset: number;
  characters: number;
}

function saveCursor(letter: HTMLElement): SavedCursor | null {
  const selection = window.getSelection();
  if (!selection?.rangeCount || !selection.isCollapsed) return null;
  const { focusNode: node, focusOffset: offset } = selection;
  if (!node || !letter.contains(node)) return null;
  const before = document.createRange();
  before.setStart(letter, 0);
  before.setEnd(node, offset);
  return { node, offset, characters: before.toString().length };
}

function restoreCursor(letter: HTMLElement, saved: SavedCursor | null) {
  if (!saved) return;
  const selection = window.getSelection();
  if (!selection) return;
  // Placing the cursor again drops formatting picked for the next thing typed
  // (Bold with nothing selected), so only do it where it actually moved.
  const place = (node: Node, offset: number) => {
    if (selection.focusNode !== node || selection.focusOffset !== offset) {
      selection.collapse(node, offset);
    }
  };
  // A cursor outside any text (an empty line) was not moved by splitting.
  if (saved.node.nodeType !== Node.TEXT_NODE) {
    if (saved.node.isConnected) place(saved.node, saved.offset);
    return;
  }
  // At the start of a piece of text the cursor belongs with what follows;
  // anywhere else, with what precedes — so typing at the end of a paragraph
  // stays in that paragraph.
  const atStart = saved.offset === 0;
  const walker = document.createTreeWalker(letter, NodeFilter.SHOW_TEXT);
  let start = 0;
  let last: Text | null = null;
  for (let node = walker.nextNode() as Text | null; node; node = walker.nextNode() as Text | null) {
    const end = start + node.length;
    if (node.length && (atStart ? saved.characters < end : saved.characters <= end)) {
      place(node, saved.characters - start);
      return;
    }
    start = end;
    last = node;
  }
  if (last) place(last, last.length);
}

/* ---------- splitting a paragraph ---------- */

/**
 * The first character of `block` whose line ends below `limit` (a client
 * y-coordinate), as a text node and offset — the start of the first line that
 * doesn't fit. Characters flow top to bottom, so a binary search finds it.
 */
function firstLineBelow(block: HTMLElement, limit: number): { node: Text; offset: number } | null {
  const texts: Text[] = [];
  const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if ((node as Text).length) texts.push(node as Text);
  }
  const positions = texts.flatMap((node) =>
    Array.from({ length: node.length }, (_, offset) => ({ node, offset })),
  );
  const range = document.createRange();
  const bottomOf = (index: number) => {
    // A character that draws nothing (a collapsed space) takes its line
    // from the next one that does.
    for (let at = index; at < positions.length; at++) {
      const { node, offset } = positions[at];
      range.setStart(node, offset);
      range.setEnd(node, offset + 1);
      const rect = range.getBoundingClientRect();
      if (rect.height) return rect.bottom;
    }
    return Infinity;
  };

  let low = 0;
  let high = positions.length;
  while (low < high) {
    const middle = (low + high) >> 1;
    if (bottomOf(middle) > limit) high = middle;
    else low = middle + 1;
  }
  return low > 0 && low < positions.length ? positions[low] : null;
}

/** Splits `block` before the given point; returns the second part. */
function splitBlock(block: HTMLElement, at: { node: Text; offset: number }): HTMLElement {
  const range = document.createRange();
  range.setStart(at.node, at.offset);
  range.setEnd(block, block.childNodes.length);
  const rest = block.cloneNode(false) as HTMLElement;
  rest.removeAttribute(PUSHED);
  rest.removeAttribute(SPLIT);
  rest.style.removeProperty('padding-top');
  // The rest of a paragraph isn't a new paragraph: no first-line indent.
  rest.style.textIndent = '0';
  // extractContents keeps the formatting around the moved text (bold, a font…).
  rest.append(range.extractContents());
  block.setAttribute(SPLIT, '');
  block.after(rest);
  return rest;
}

/* ---------- laying out ---------- */

/**
 * Lays the letter out on pages and returns how many it needs. `letter` is the
 * editable column; its top edge is the first sheet's top edge.
 */
export function paginate(letter: HTMLElement): number {
  const pitch = (LETTER_PAGE.height + LETTER_PAGE.gap) * PX_PER_MM;
  const textTop = TEXT_TOP * PX_PER_MM;
  const textBottom = TEXT_BOTTOM * PX_PER_MM;
  const textHeight = textBottom - textTop;
  const gap = LETTER_PAGE.gap * PX_PER_MM;

  const cursor = saveCursor(letter);
  clearPushes(letter);
  joinSplits(letter);

  const origin = letter.getBoundingClientRect().top;
  /** Padding given to each piece so far: its height, and the page gaps inside it. */
  const pushes = new Map<HTMLElement, { px: number; gaps: number }>();
  const push = (block: HTMLElement, by: number, gaps: number) => {
    const current = pushes.get(block) ?? { px: 0, gaps: 0 };
    const next = { px: current.px + by, gaps: current.gaps + gaps };
    pushes.set(block, next);
    block.setAttribute(PUSHED, '');
    // On paper there is no gap between sheets: take the gaps out of the padding.
    block.style.paddingTop = next.gaps
      ? `calc(${next.px - next.gaps * gap}px + ${next.gaps} * var(--letter-gap))`
      : `${next.px}px`;
  };

  const blocks = blocksOf(letter);
  let end = textTop;
  let afterBreak = false;
  for (let index = 0; index < blocks.length; index++) {
    const block = blocks[index];
    // Measured afresh each time: every move above shifts what follows.
    for (let attempt = 0; attempt < 3; attempt++) {
      const rect = block.getBoundingClientRect();
      const padding = pushes.get(block)?.px ?? 0;
      const top = rect.top - origin + padding;
      const bottom = rect.bottom - origin;
      const page = Math.max(0, Math.floor(top / pitch));
      const pageTextTop = page * pitch + textTop;
      const pageTextBottom = page * pitch + textBottom;
      const nextPageTop = (page + 1) * pitch + textTop;

      if (afterBreak || top >= pageTextBottom) {
        afterBreak = false;
        push(block, nextPageTop - top, 1);
        continue;
      }
      if (top < pageTextTop) {
        // Starts in the header, below a piece too tall for any page.
        push(block, pageTextTop - top, 0);
        continue;
      }
      if (bottom <= pageTextBottom) {
        end = Math.max(end, bottom);
        break;
      }

      // Runs past this page's end: split it, or move it to the next page.
      const lineHeight = parseFloat(getComputedStyle(block).lineHeight) || 16;
      const linesHere = Math.floor((pageTextBottom - top) / lineHeight);
      const linesAfter = Math.round((bottom - pageTextBottom) / lineHeight);
      const fitsOnAPage = bottom - top <= textHeight;
      const at =
        SPLITTABLE.has(block.tagName) &&
        linesHere >= MIN_LINES &&
        (linesAfter >= MIN_LINES || !fitsOnAPage)
          ? firstLineBelow(block, origin + pageTextBottom)
          : null;
      if (at) {
        blocks.splice(index + 1, 0, splitBlock(block, at));
        end = Math.max(end, pageTextBottom);
        break;
      }
      // (A pixel's allowance: measurements are fractional.)
      if (fitsOnAPage || top > pageTextTop + 1) {
        push(block, nextPageTop - top, 1);
        continue;
      }
      // One unbreakable piece taller than a page: leave it where it is.
      end = Math.max(end, bottom);
      break;
    }
    afterBreak = block.tagName === 'HR';
  }

  restoreCursor(letter, cursor);
  return Math.max(1, Math.floor(end / pitch) + 1);
}

/** The letter's content without the page layout, for keeping and for Word. */
export function letterHtml(letter: HTMLElement): string {
  const copy = letter.cloneNode(true) as HTMLElement;
  clearPushes(copy);
  joinSplits(copy);
  return copy.innerHTML;
}

/**
 * Wraps text typed straight into the letter (outside any paragraph) in a
 * paragraph, so every line belongs to a piece that can move between pages.
 * The cursor stays where it was.
 */
export function wrapLooseText(letter: HTMLElement) {
  const loose = Array.from(letter.childNodes).filter(
    (node) =>
      node.nodeType === Node.TEXT_NODE ||
      (node instanceof HTMLElement && getComputedStyle(node).display.startsWith('inline')),
  );
  if (!loose.length) return;

  const selection = window.getSelection();
  const anchor = selection?.rangeCount ? [selection.anchorNode, selection.anchorOffset] : null;
  for (const node of loose) {
    // Consecutive loose pieces share one paragraph.
    const previous = node.previousSibling;
    if (previous instanceof HTMLElement && previous.dataset.wrapped !== undefined) {
      previous.appendChild(node);
    } else {
      const paragraph = document.createElement('p');
      paragraph.dataset.wrapped = '';
      letter.insertBefore(paragraph, node);
      paragraph.appendChild(node);
    }
  }
  for (const paragraph of Array.from(letter.querySelectorAll<HTMLElement>('[data-wrapped]'))) {
    delete paragraph.dataset.wrapped;
  }
  if (selection && anchor?.[0]) selection.collapse(anchor[0] as Node, anchor[1] as number);
}
