'use client';

import type { ReactNode } from 'react';
import {
  AlignCenter,
  AlignJustify,
  AlignLeft,
  AlignRight,
  Baseline,
  Bold,
  CalendarDays,
  Eraser,
  Highlighter,
  IndentDecrease,
  IndentIncrease,
  Italic,
  List,
  ListOrdered,
  Redo2,
  SeparatorHorizontal,
  Strikethrough,
  Underline,
  Undo2,
  type LucideIcon,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { NativeSelect } from '@/components/forms/fields';
import { cn } from '@/lib/utils';

/*
 * The letter's formatting toolbar, laid out like a word processor's: undo,
 * paragraph style, font and size, character formatting, colours, alignment,
 * lists and indents, then inserts. It only shows state and reports what was
 * pressed; the editor applies it to the letter.
 */

/** Fonts every Windows PC with Office has; each falls back to a similar one elsewhere. */
export const LETTER_FONTS = [
  'Calibri',
  'Arial',
  'Cambria',
  'Times New Roman',
  'Georgia',
  'Garamond',
  'Segoe UI',
  'Tahoma',
  'Verdana',
  'Trebuchet MS',
  'Courier New',
  'Traditional Arabic',
] as const;

/** Font sizes in points, as Word lists them. */
export const FONT_SIZES = [8, 9, 10, 10.5, 11, 12, 14, 16, 18, 20, 22, 24, 28, 36, 48, 72] as const;

export const LINE_SPACINGS = [1, 1.15, 1.5, 2] as const;

const TEXT_COLOURS = [
  '#000000',
  '#404040',
  '#7f7f7f',
  '#c00000',
  '#e36c09',
  '#1f4e79',
  '#2e75b6',
  '#00804a',
  '#7030a0',
  '#b8860b',
];
const HIGHLIGHTS = ['#ffff00', '#00ff00', '#00ffff', '#ff66cc', '#ffc000', '#d9d9d9'];

export type BlockStyle = 'p' | 'h2' | 'h3';
const BLOCK_STYLES: { value: BlockStyle; label: string }[] = [
  { value: 'p', label: 'Normal' },
  { value: 'h2', label: 'Heading 1' },
  { value: 'h3', label: 'Heading 2' },
];

/** What the text at the cursor looks like, for the toolbar to show. */
export interface FormatState {
  bold: boolean;
  italic: boolean;
  underline: boolean;
  strike: boolean;
  align: 'left' | 'center' | 'right' | 'justify';
  list: 'ul' | 'ol' | null;
  block: BlockStyle;
  /** The font at the cursor, or '' when it isn't one of LETTER_FONTS. */
  font: string;
  /** The size at the cursor in points, or '' when it isn't one of FONT_SIZES. */
  size: string;
}

export const EMPTY_FORMAT: FormatState = {
  bold: false,
  italic: false,
  underline: false,
  strike: false,
  align: 'left',
  list: null,
  block: 'p',
  font: '',
  size: '',
};

export interface LetterToolbarActions {
  /** Runs a document.execCommand command on the letter's selection. */
  run: (command: string, value?: string) => void;
  setFontSize: (points: number) => void;
  insertDate: () => void;
  insertPageBreak: () => void;
}

function Group({ children }: { children: ReactNode }) {
  return (
    <div className="flex items-center gap-0.5 border-r border-border pr-1.5 last:border-r-0">
      {children}
    </div>
  );
}

function ToolButton({
  label,
  icon: Icon,
  pressed,
  onPress,
}: {
  label: string;
  icon: LucideIcon;
  pressed?: boolean;
  onPress: () => void;
}) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-sm"
      aria-label={label}
      aria-pressed={pressed}
      title={label}
      className={cn(pressed && 'bg-muted text-foreground')}
      // Keep the selection in the letter while the button is pressed.
      onMouseDown={(event) => event.preventDefault()}
      onClick={onPress}
    >
      <Icon />
    </Button>
  );
}

function ColourMenu({
  label,
  icon: Icon,
  colours,
  noneLabel,
  onPick,
}: {
  label: string;
  icon: LucideIcon;
  colours: string[];
  noneLabel: string;
  /** A colour, or null for none. */
  onPick: (colour: string | null) => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button type="button" variant="ghost" size="icon-sm" aria-label={label} title={label} />
        }
      >
        <Icon />
      </DropdownMenuTrigger>
      <DropdownMenuContent className="w-auto p-2">
        <div className="grid grid-cols-5 gap-1.5">
          {colours.map((colour) => (
            <DropdownMenuItem
              key={colour}
              aria-label={colour}
              onClick={() => onPick(colour)}
              className="size-7 rounded-md p-0 ring-1 ring-black/10"
              style={{ backgroundColor: colour }}
            />
          ))}
        </div>
        <DropdownMenuItem onClick={() => onPick(null)} className="mt-2 justify-center text-xs">
          {noneLabel}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

const SELECT = 'h-8 w-auto text-sm';

export function LetterToolbar({
  format,
  actions,
  lineSpacing,
  onLineSpacing,
}: {
  format: FormatState;
  actions: LetterToolbarActions;
  lineSpacing: number;
  onLineSpacing: (spacing: number) => void;
}) {
  const { run } = actions;
  return (
    <div
      role="toolbar"
      aria-label="Formatting"
      className="flex flex-wrap items-center gap-x-1.5 gap-y-1 rounded-lg border border-border bg-card p-1.5 shadow-sm"
    >
      <Group>
        <ToolButton label="Undo (Ctrl+Z)" icon={Undo2} onPress={() => run('undo')} />
        <ToolButton label="Redo (Ctrl+Y)" icon={Redo2} onPress={() => run('redo')} />
      </Group>

      <Group>
        <NativeSelect
          aria-label="Paragraph style"
          value={format.block}
          onChange={(event) => run('formatBlock', event.target.value)}
          className={SELECT}
        >
          {BLOCK_STYLES.map((style) => (
            <option key={style.value} value={style.value}>
              {style.label}
            </option>
          ))}
        </NativeSelect>
        <NativeSelect
          aria-label="Font"
          value={format.font}
          onChange={(event) => run('fontName', event.target.value)}
          className={cn(SELECT, 'max-w-40')}
        >
          <option value="" disabled>
            Font
          </option>
          {LETTER_FONTS.map((font) => (
            <option key={font} value={font} style={{ fontFamily: font }}>
              {font}
            </option>
          ))}
        </NativeSelect>
        <NativeSelect
          aria-label="Font size"
          value={format.size}
          onChange={(event) => actions.setFontSize(Number(event.target.value))}
          className={SELECT}
        >
          <option value="" disabled>
            Size
          </option>
          {FONT_SIZES.map((size) => (
            <option key={size} value={String(size)}>
              {size}
            </option>
          ))}
        </NativeSelect>
      </Group>

      <Group>
        <ToolButton
          label="Bold (Ctrl+B)"
          icon={Bold}
          pressed={format.bold}
          onPress={() => run('bold')}
        />
        <ToolButton
          label="Italic (Ctrl+I)"
          icon={Italic}
          pressed={format.italic}
          onPress={() => run('italic')}
        />
        <ToolButton
          label="Underline (Ctrl+U)"
          icon={Underline}
          pressed={format.underline}
          onPress={() => run('underline')}
        />
        <ToolButton
          label="Strikethrough"
          icon={Strikethrough}
          pressed={format.strike}
          onPress={() => run('strikeThrough')}
        />
        <ColourMenu
          label="Text colour"
          icon={Baseline}
          colours={TEXT_COLOURS}
          noneLabel="Automatic"
          onPick={(colour) => run('foreColor', colour ?? '#000000')}
        />
        <ColourMenu
          label="Highlight"
          icon={Highlighter}
          colours={HIGHLIGHTS}
          noneLabel="No highlight"
          onPick={(colour) => run('hiliteColor', colour ?? 'transparent')}
        />
      </Group>

      <Group>
        <ToolButton
          label="Align left"
          icon={AlignLeft}
          pressed={format.align === 'left'}
          onPress={() => run('justifyLeft')}
        />
        <ToolButton
          label="Centre"
          icon={AlignCenter}
          pressed={format.align === 'center'}
          onPress={() => run('justifyCenter')}
        />
        <ToolButton
          label="Align right"
          icon={AlignRight}
          pressed={format.align === 'right'}
          onPress={() => run('justifyRight')}
        />
        <ToolButton
          label="Justify"
          icon={AlignJustify}
          pressed={format.align === 'justify'}
          onPress={() => run('justifyFull')}
        />
      </Group>

      <Group>
        <ToolButton
          label="Bullets"
          icon={List}
          pressed={format.list === 'ul'}
          onPress={() => run('insertUnorderedList')}
        />
        <ToolButton
          label="Numbering"
          icon={ListOrdered}
          pressed={format.list === 'ol'}
          onPress={() => run('insertOrderedList')}
        />
        <ToolButton
          label="Decrease indent (Shift+Tab)"
          icon={IndentDecrease}
          onPress={() => run('outdent')}
        />
        <ToolButton
          label="Increase indent (Tab)"
          icon={IndentIncrease}
          onPress={() => run('indent')}
        />
        <NativeSelect
          aria-label="Line spacing"
          title="Line spacing"
          value={String(lineSpacing)}
          onChange={(event) => onLineSpacing(Number(event.target.value))}
          className={SELECT}
        >
          {LINE_SPACINGS.map((spacing) => (
            <option key={spacing} value={String(spacing)}>
              {/* As Word shows them: 1.0, 1.15, 1.5, 2.0 */}
              Spacing {Number.isInteger(spacing * 10) ? spacing.toFixed(1) : spacing}
            </option>
          ))}
        </NativeSelect>
      </Group>

      <Group>
        <ToolButton label="Insert today’s date" icon={CalendarDays} onPress={actions.insertDate} />
        <ToolButton
          label="Page break (Ctrl+Enter)"
          icon={SeparatorHorizontal}
          onPress={actions.insertPageBreak}
        />
        <ToolButton
          label="Clear formatting"
          icon={Eraser}
          onPress={() => {
            run('removeFormat');
            run('formatBlock', 'p');
          }}
        />
      </Group>
    </div>
  );
}
