'use client';

import {
  Children,
  isValidElement,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type ComponentProps,
  type KeyboardEvent,
  type ReactNode,
} from 'react';
import { Popover } from '@base-ui/react/popover';
import { Check, ChevronDown, Plus, Search } from 'lucide-react';
import { cn } from '@/lib/utils';
import { CONTROL } from '@/components/forms/control';

/*
 * The app's dropdown: a `<select>` that can be searched.
 *
 * It is written exactly like a `<select>` — `<option>` and `<optgroup>`
 * children, `name`, `value` / `defaultValue`, `onChange`, `required` — and a
 * real `<select>` still sits underneath, so forms submit it, the browser
 * validates it and `onChange` receives the usual event. What the user sees
 * is a button that opens a list with a search box: type part of a name, a
 * code or a number, and the list narrows.
 *
 * An option with two parts — "1000 · Cash on hand", "Ali Khan — Technician"
 * — is shown with the parts at the two ends of the row rather than joined by
 * a dash or a dot: the name on the left, the code or detail on the right.
 * `data-hint` on an option sets the right-hand part explicitly.
 *
 * Typing while the closed control has the focus opens it already searching
 * for what was typed. Given `onCreate`, the list starts with "Add new …" —
 * for a supplier or a customer not on file yet, under the search box where it
 * never scrolls out of reach — which hands what was
 * typed to the caller (to open a short form) instead of choosing anything.
 */

interface Choice {
  value: string;
  /** Everything the option says, for searching. */
  text: string;
  main: string;
  hint: string;
  disabled: boolean;
  group: string | null;
}

/** The plain text of an option's children. */
function textOf(node: ReactNode): string {
  if (node === null || node === undefined || typeof node === 'boolean') return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(textOf).join('');
  if (isValidElement<{ children?: ReactNode }>(node)) return textOf(node.props.children);
  return '';
}

/** A short code — "1000", "VAT5", "AC-CLUTCH" — which reads better on the right. */
const CODE = /^[A-Z0-9][A-Z0-9._/-]{0,11}$/;
const SEPARATOR = /\s+[—–·]\s+/;

/** "1000 · Cash on hand" → name left, code right; "Ali — Technician" → as written. */
function splitLabel(text: string): { main: string; hint: string } {
  const parts = text
    .split(SEPARATOR)
    .map((part) => part.trim())
    .filter(Boolean);
  if (parts.length < 2) return { main: text.trim(), hint: '' };
  if (CODE.test(parts[0]) && !CODE.test(parts[1])) {
    const [code, name, ...rest] = parts;
    return { main: name, hint: [code, ...rest].join(', ') };
  }
  const [main, ...rest] = parts;
  return { main, hint: rest.join(', ') };
}

function readChoices(children: ReactNode, group: string | null = null): Choice[] {
  const choices: Choice[] = [];
  Children.forEach(children, (child) => {
    if (!isValidElement<Record<string, unknown>>(child)) return;
    const props = child.props;
    if (child.type === 'optgroup') {
      choices.push(...readChoices(props.children as ReactNode, String(props.label ?? '')));
    } else if (child.type === 'option') {
      const text = textOf(props.children as ReactNode)
        .replace(/\s+/g, ' ')
        .trim();
      const explicit = typeof props['data-hint'] === 'string' ? props['data-hint'] : null;
      const split = explicit !== null ? { main: text, hint: explicit } : splitLabel(text);
      choices.push({
        value: String(props.value ?? text),
        text,
        ...split,
        disabled: Boolean(props.disabled),
        group,
      });
    } else {
      // A fragment or wrapper: look inside.
      choices.push(...readChoices(props.children as ReactNode, group));
    }
  });
  return choices;
}

/** Classes that place or size the control in its parent: they belong on the wrapper. */
const LAYOUT =
  /^(w-|min-w-|max-w-|flex-(1|auto|none|initial)$|grow|shrink|basis-|self-|col-span-|row-span-|justify-self-|order-|-?m[trblxy]?-)/;

function splitClasses(className: string | undefined) {
  const layout: string[] = [];
  const look: string[] = [];
  for (const token of (className ?? '').split(' ').filter(Boolean)) {
    // The utility is what follows the last variant: "sm:w-auto" → "w-auto".
    (LAYOUT.test(token.slice(token.lastIndexOf(':') + 1)) ? layout : look).push(token);
  }
  return { layout: layout.join(' '), look: look.join(' ') };
}

const normalise = (value: string) => value.toLowerCase().replace(/[^a-z0-9؀-ۿ]+/g, ' ');

export type SearchableSelectProps = ComponentProps<'select'> & {
  /** Offers "Add new …" at the end of the list; called with what was typed. */
  onCreate?: (query: string) => void;
  /** The add row's words, e.g. "Add new supplier". */
  createLabel?: string;
};

export function SearchableSelect({
  className,
  children,
  onCreate,
  createLabel = 'Add new',
  id,
  value,
  defaultValue,
  onChange,
  disabled,
  'aria-label': ariaLabel,
  'aria-invalid': ariaInvalid,
  'aria-describedby': ariaDescribedBy,
  ...props
}: SearchableSelectProps) {
  const choices = useMemo(() => readChoices(children), [children]);
  const selectRef = useRef<HTMLSelectElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const classes = splitClasses(className);
  const controlled = value !== undefined;
  // Uncontrolled: what the underlying <select> holds, as a native one starts.
  const [held, setHeld] = useState(() =>
    defaultValue !== undefined ? String(defaultValue) : (choices[0]?.value ?? ''),
  );
  const current = controlled ? String(value) : held;
  // Like a native select: a value that matches no option shows the first one.
  const selected = choices.find((choice) => choice.value === current) ?? choices[0] ?? null;

  // A form reset puts the <select> back to its default: follow it.
  useEffect(() => {
    const select = selectRef.current;
    const form = select?.form;
    if (!select || !form || controlled) return;
    const onReset = () => setTimeout(() => setHeld(select.value), 0);
    form.addEventListener('reset', onReset);
    return () => form.removeEventListener('reset', onReset);
  }, [controlled]);

  const words = normalise(query).split(' ').filter(Boolean);
  const shown = words.length
    ? choices.filter((choice) => {
        const haystack = normalise(`${choice.text} ${choice.hint} ${choice.group ?? ''}`);
        return words.every((word) => haystack.includes(word));
      })
    : choices;

  function changeOpen(next: boolean) {
    setOpen(next);
    if (next) {
      setQuery('');
      setActive(
        Math.max(
          shown.findIndex((choice) => choice.value === current),
          0,
        ),
      );
    }
  }

  /** Sets the real <select> and lets React's onChange run, as if the user had picked it. */
  function choose(choice: Choice) {
    if (choice.disabled) return;
    const select = selectRef.current;
    if (select && select.value !== choice.value) {
      const setValue = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')?.set;
      setValue?.call(select, choice.value);
      select.dispatchEvent(new Event('change', { bubbles: true }));
    }
    setOpen(false);
  }

  function onSelectChange(event: ChangeEvent<HTMLSelectElement>) {
    if (!controlled) setHeld(event.target.value);
    onChange?.(event);
  }

  /*
   * The add row sits above the choices: `active` is -1 on it, otherwise the
   * index of a choice. Typing keeps the first match active, so Enter still
   * picks a match; it adds a new one only when nothing matches.
   */
  const CREATE_ROW = -1;

  function create() {
    setOpen(false);
    onCreate?.(query.trim());
  }

  function move(step: number) {
    if (onCreate) {
      setActive((current) => {
        let next = current;
        for (let i = 0; i <= shown.length; i += 1) {
          next += step;
          if (next > shown.length - 1) next = CREATE_ROW;
          if (next < CREATE_ROW) next = shown.length - 1;
          if (next === CREATE_ROW || !shown[next].disabled) break;
        }
        if (next >= 0) listRef.current?.children[next]?.scrollIntoView({ block: 'nearest' });
        return next;
      });
      return;
    }
    if (shown.length === 0) return;
    let next = active;
    for (let i = 0; i < shown.length; i += 1) {
      next = (next + step + shown.length) % shown.length;
      if (!shown[next].disabled) break;
    }
    setActive(next);
    listRef.current?.children[next]?.scrollIntoView({ block: 'nearest' });
  }

  function onSearchKey(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      move(1);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      move(-1);
    } else if (event.key === 'Enter') {
      event.preventDefault();
      if (onCreate && (active === CREATE_ROW || shown.length === 0)) return create();
      const choice = shown[Math.min(active, shown.length - 1)];
      if (choice) choose(choice);
    }
  }

  return (
    <Popover.Root open={open} onOpenChange={changeOpen}>
      <span className={cn('relative block w-full min-w-0', classes.layout)}>
        {/* The real control: submitted with the form, validated by the browser. */}
        <select
          ref={selectRef}
          tabIndex={-1}
          aria-hidden
          disabled={disabled}
          className="pointer-events-none absolute inset-0 size-full opacity-0"
          {...(controlled ? { value } : { defaultValue })}
          onChange={onSelectChange}
          {...props}
        >
          {children}
        </select>
        <Popover.Trigger
          id={id}
          disabled={disabled}
          aria-label={ariaLabel}
          aria-invalid={ariaInvalid}
          aria-describedby={ariaDescribedBy}
          aria-haspopup="listbox"
          onKeyDown={(event) => {
            if (open || event.key.length !== 1 || event.ctrlKey || event.metaKey || event.altKey)
              return;
            if (event.key === ' ') return;
            event.preventDefault();
            setOpen(true);
            setQuery(event.key);
            setActive(0);
          }}
          className={cn(
            CONTROL,
            'relative flex h-9 items-center justify-between gap-2 text-left',
            classes.look,
          )}
        >
          <span
            className={cn('min-w-0 flex-1 truncate', !selected?.value && 'text-muted-foreground')}
          >
            {selected?.main ?? ''}
          </span>
          {selected?.hint ? (
            <span className="max-w-[45%] shrink-0 truncate text-xs text-muted-foreground tabular-nums">
              {selected.hint}
            </span>
          ) : null}
          <ChevronDown className="size-4 shrink-0 text-muted-foreground" />
        </Popover.Trigger>
      </span>
      <Popover.Portal>
        <Popover.Positioner align="start" sideOffset={4} className="isolate z-50 outline-none">
          <Popover.Popup
            initialFocus={searchRef}
            className="z-50 flex max-h-(--available-height) w-(--anchor-width) min-w-60 origin-(--transform-origin) flex-col overflow-hidden rounded-lg bg-popover text-popover-foreground shadow-md ring-1 ring-foreground/10 outline-none data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95"
          >
            <div className="flex items-center gap-2 border-b border-border px-3">
              <Search className="size-4 shrink-0 text-muted-foreground" />
              <input
                ref={searchRef}
                value={query}
                onChange={(event) => {
                  setQuery(event.target.value);
                  setActive(0);
                }}
                onKeyDown={onSearchKey}
                onFocus={(event) => {
                  const end = event.currentTarget.value.length;
                  event.currentTarget.setSelectionRange(end, end);
                }}
                placeholder="Search…"
                aria-label="Search the options"
                autoComplete="off"
                className="h-10 w-full min-w-0 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
              />
            </div>
            {onCreate ? (
              <div className="border-b border-border p-1">
                <button
                  type="button"
                  onMouseEnter={() => setActive(CREATE_ROW)}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={create}
                  className={cn(
                    'flex w-full items-center gap-2 rounded-md px-2 py-2.5 text-left text-sm font-medium text-primary',
                    active === CREATE_ROW && 'bg-muted',
                  )}
                >
                  <Plus className="size-4 shrink-0" />
                  <span className="min-w-0 truncate">
                    {createLabel}
                    {query.trim() ? ` “${query.trim()}”` : ''}
                  </span>
                </button>
              </div>
            ) : null}
            <ul ref={listRef} role="listbox" className="max-h-64 overflow-y-auto p-1">
              {shown.length === 0 ? (
                onCreate ? null : (
                  <li className="px-2 py-3 text-center text-sm text-muted-foreground">
                    Nothing matches
                  </li>
                )
              ) : (
                shown.map((choice, index) => {
                  const heading =
                    choice.group && choice.group !== shown[index - 1]?.group ? choice.group : null;
                  const isSelected = choice.value === current;
                  return (
                    <li
                      key={`${choice.value}-${index}`}
                      role="option"
                      aria-selected={isSelected}
                      aria-disabled={choice.disabled || undefined}
                      onMouseEnter={() => setActive(index)}
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={() => choose(choice)}
                      className={cn(
                        'flex cursor-pointer flex-col rounded-md text-sm',
                        choice.disabled && 'cursor-not-allowed opacity-50',
                      )}
                    >
                      {heading ? (
                        <span className="cursor-default px-2 pt-2 pb-1 text-[11px] font-semibold tracking-[0.06em] text-muted-foreground uppercase">
                          {heading}
                        </span>
                      ) : null}
                      <span
                        className={cn(
                          'flex items-center justify-between gap-3 rounded-md px-2 py-2',
                          index === active && !choice.disabled && 'bg-muted',
                        )}
                      >
                        <span className="flex min-w-0 items-center gap-2">
                          <Check
                            className={cn(
                              'size-3.5 shrink-0 text-primary',
                              !isSelected && 'invisible',
                            )}
                          />
                          <span
                            className={cn('truncate', !choice.value && 'text-muted-foreground')}
                          >
                            {choice.main}
                          </span>
                        </span>
                        {choice.hint ? (
                          <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                            {choice.hint}
                          </span>
                        ) : null}
                      </span>
                    </li>
                  );
                })
              )}
            </ul>
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}
