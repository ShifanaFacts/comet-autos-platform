import type { CSSProperties } from 'react';
import { Mail, Phone, type LucideIcon, Globe } from 'lucide-react';
import { LETTER_PAGE, WATERMARK } from '@/lib/documents/letter-pages';
import type { Letterhead } from '@/lib/documents/letterhead';
import { cn } from '@/lib/utils';

/*
 * One A4 sheet of the company letterhead: the names and logo at the top, the
 * contact details at the bottom and the logo faded in the middle. The letter's
 * text is laid over the sheets by the editor; the sheet itself holds none.
 * The Word export (lib/documents/letter-docx.ts) draws the same letterhead.
 */

const ARABIC_FONT = "'Traditional Arabic', 'Segoe UI', 'Noto Naskh Arabic', serif";

/**
 * The letterhead's double line: a heavy rule over a hairline. Drawn as
 * borders, which always print — backgrounds are dropped when a print
 * dialog's "Background graphics" is off.
 */
function Rule({ className }: { className?: string }) {
  return (
    <div
      aria-hidden
      className={cn('h-1.5 border-t-[3px] border-b border-neutral-600', className)}
    />
  );
}

const mm = (value: number) => `${value}mm`;

export function LetterheadSheet({
  letterhead,
  style,
}: {
  letterhead: Letterhead;
  /** Positions the sheet in the stack. */
  style: CSSProperties;
}) {
  const contact: { icon: LucideIcon; value: string }[] = [
    { icon: Phone, value: letterhead.phone },
    { icon: Mail, value: letterhead.email },
    { icon: Globe, value: letterhead.website },
  ].filter((item) => item.value);

  return (
    <div
      aria-hidden
      className="letter-sheet absolute inset-x-0 overflow-hidden bg-white shadow-md ring-1 ring-black/5"
      style={{
        ...style,
        height: mm(LETTER_PAGE.height),
        paddingInline: mm(LETTER_PAGE.frameMargin),
      }}
    >
      <div className="pointer-events-none absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2">
        {letterhead.logo ? (
          // eslint-disable-next-line @next/next/no-img-element -- a local data URL, not a remote image
          <img
            src={letterhead.logo}
            alt=""
            className="max-w-none"
            style={{ width: mm(WATERMARK.logoWidth), opacity: WATERMARK.logoOpacity }}
          />
        ) : (
          <p
            className="text-center leading-tight font-black tracking-[2px] uppercase"
            style={{
              width: mm(WATERMARK.nameWidth),
              fontSize: mm(WATERMARK.nameWidth * WATERMARK.nameSize),
              opacity: WATERMARK.nameOpacity,
            }}
          >
            {letterhead.legalName}
          </p>
        )}
      </div>

      <header
        className="relative flex items-center"
        style={{
          height: mm(LETTER_PAGE.headerHeight),
          paddingTop: mm(LETTER_PAGE.headerTop),
        }}
      >
        <div className="min-w-0 flex-1">
          {letterhead.arabicName ? (
            <p
              dir="rtl"
              className="w-fit text-[19px] leading-snug font-bold text-neutral-800"
              style={{ fontFamily: ARABIC_FONT }}
            >
              {letterhead.arabicName}
            </p>
          ) : null}
          <Rule className="mt-1.5" />
          <p className="mt-2 text-[15px] tracking-[0.6px] text-neutral-700 uppercase">
            {letterhead.legalName}
          </p>
        </div>
        {letterhead.logo ? (
          // eslint-disable-next-line @next/next/no-img-element -- a local data URL, not a remote image
          <img
            src={letterhead.logo}
            alt=""
            className="max-h-[26mm] max-w-[48mm] shrink-0 object-contain"
          />
        ) : null}
      </header>

      <footer
        className="absolute inset-x-0 bottom-0 flex flex-col justify-end"
        style={{
          height: mm(LETTER_PAGE.footerHeight),
          paddingBottom: mm(LETTER_PAGE.footerBottom),
          paddingInline: mm(LETTER_PAGE.frameMargin),
        }}
      >
        <Rule />
        {contact.length ? (
          <div className="mt-3 flex flex-wrap items-center justify-around gap-x-6 gap-y-1 text-[13px] text-neutral-800">
            {contact.map(({ icon: Icon, value }) => (
              <span key={value} className="flex items-center gap-1.5">
                <Icon className="size-3.5" aria-hidden />
                {value}
              </span>
            ))}
          </div>
        ) : null}
        {letterhead.address ? (
          <p className="mt-1 text-center text-[13px] font-semibold text-neutral-800">
            {letterhead.address}
          </p>
        ) : null}
      </footer>
    </div>
  );
}
