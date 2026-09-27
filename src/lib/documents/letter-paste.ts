/*
 * Cleans formatted text pasted into a letter (from Word, Google Docs or a web
 * page) down to what the letter's own toolbar can make: bold, italic,
 * underline, strikethrough, headings, lists, paragraphs, line breaks, the
 * font, its size and colour, highlighting, alignment and indents.
 *
 * Only those styles survive; every other attribute and style is dropped, and
 * so is anything that isn't text — scripts, images, links and embedded
 * objects. The source is parsed with DOMParser, which never runs scripts or
 * loads images, and styles are copied value by value through the browser's
 * own CSS parser, never as raw text.
 *
 * Browser only: it uses DOMParser and the document.
 */

/** Tags kept, and what each becomes in the letter. */
const KEEP: Record<string, string> = {
  B: 'strong',
  STRONG: 'strong',
  I: 'em',
  EM: 'em',
  U: 'u',
  S: 's',
  STRIKE: 's',
  DEL: 's',
  P: 'p',
  DIV: 'div',
  BR: 'br',
  UL: 'ul',
  OL: 'ol',
  LI: 'li',
  H1: 'h2',
  H2: 'h2',
  H3: 'h3',
  H4: 'h3',
  H5: 'h3',
  H6: 'h3',
  // Table rows become lines; their cells run on, separated by a space.
  TR: 'p',
};

const BLOCKS = new Set(['p', 'div', 'li', 'h2', 'h3']);

/** Elements dropped together with everything inside them. */
const DROP = new Set([
  'SCRIPT',
  'STYLE',
  'TEMPLATE',
  'NOSCRIPT',
  'HEAD',
  'TITLE',
  'META',
  'LINK',
  'IFRAME',
  'OBJECT',
  'EMBED',
  'IMG',
  'SVG',
  'MATH',
  'CANVAS',
  'VIDEO',
  'AUDIO',
]);

/** Styles kept on a paragraph. */
const BLOCK_STYLES = ['text-align', 'margin-left', 'text-indent'] as const;
/** Styles kept on a run of text. */
const TEXT_STYLES = ['color', 'background-color', 'font-size', 'font-family'] as const;

/** Highlights that are really "no highlight" on a white page. */
const NO_HIGHLIGHT = new Set(['', 'transparent', 'white', '#ffffff', 'rgb(255, 255, 255)']);

const ELEMENT_NODE = 1;
const TEXT_NODE = 3;

/**
 * The tags an element becomes: its own kept tag, plus bold, italic,
 * underline or strikethrough set through its style — which is how Google
 * Docs and many web pages mark them.
 */
function tagsFor(element: Element, style: CSSStyleDeclaration | null): string[] {
  const weight = style?.fontWeight ?? '';
  const bold = weight === 'bold' || weight === 'bolder' || Number(weight) >= 600;
  // Google Docs wraps a whole paste in <b style="font-weight:normal">.
  const notBold = weight === 'normal' || (weight !== '' && Number(weight) < 600);
  const decoration = style?.textDecorationLine ?? '';

  const tags: string[] = [];
  const own = KEEP[element.tagName];
  if (own && !(own === 'strong' && notBold)) tags.push(own);
  if (bold && own !== 'strong') tags.push('strong');
  if (style?.fontStyle === 'italic' && own !== 'em') tags.push('em');
  if (decoration.includes('underline') && own !== 'u') tags.push('u');
  if (decoration.includes('line-through') && own !== 's') tags.push('s');
  return tags;
}

function copyStyles(
  from: CSSStyleDeclaration,
  to: HTMLElement,
  names: readonly (typeof BLOCK_STYLES | typeof TEXT_STYLES)[number][],
) {
  for (const name of names) {
    const value = from.getPropertyValue(name).trim();
    if (!value || value === 'inherit' || value === 'initial') continue;
    if (name === 'background-color' && NO_HIGHLIGHT.has(value.toLowerCase())) continue;
    to.style.setProperty(name, value);
  }
}

function copyChildren(from: Node, into: Node, target: Document) {
  for (const child of Array.from(from.childNodes)) {
    if (child.nodeType === TEXT_NODE) {
      // The letter keeps spacing as typed, so the source's own line breaks
      // and indentation become single spaces, as a browser shows them.
      // Non-breaking spaces — Word's deliberate spacing — stay.
      const text = (child.textContent ?? '').replace(/[ \t\r\n]+/g, ' ');
      into.appendChild(target.createTextNode(text));
      continue;
    }
    // Comments (Word's conditional ones included) and anything else go.
    if (child.nodeType !== ELEMENT_NODE) continue;
    const element = child as Element;
    if (DROP.has(element.tagName)) continue;
    const style = element instanceof HTMLElement ? element.style : null;

    let parent: Node = into;
    for (const tag of tagsFor(element, style)) {
      const created = target.createElement(tag);
      if (style && BLOCKS.has(tag) && parent === into) copyStyles(style, created, BLOCK_STYLES);
      parent = parent.appendChild(created);
    }
    if (style && TEXT_STYLES.some((name) => style.getPropertyValue(name))) {
      const span = target.createElement('span');
      copyStyles(style, span, TEXT_STYLES);
      if (span.getAttribute('style')) parent = parent.appendChild(span);
    }
    copyChildren(element, parent, target);
    if (element.tagName === 'TD' || element.tagName === 'TH') {
      parent.appendChild(target.createTextNode(' '));
    }
  }
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * Plain text (from WhatsApp, Notepad, an email) as one paragraph per line,
 * so a long paste flows onto new pages like any typed letter instead of
 * arriving as one paragraph too tall for a page.
 */
export function plainTextToHtml(text: string): string {
  return text
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => `<p>${escapeHtml(line) || '<br>'}</p>`)
    .join('');
}

export function cleanPastedHtml(html: string): string {
  const source = new DOMParser().parseFromString(html, 'text/html');
  const target = document.implementation.createHTMLDocument('');
  copyChildren(source.body, target.body, target);
  return target.body.innerHTML;
}
