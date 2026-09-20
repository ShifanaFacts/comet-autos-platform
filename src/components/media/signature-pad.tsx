'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Check, Eraser, PenLine } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

/**
 * Optional signature capture. Works with a finger, stylus or mouse; sized to
 * the available width so nobody has to rotate their phone. The signature is
 * only used once "Confirm signature" is pressed — the value handed back is
 * a PNG data URL (or null when nothing is confirmed), which the server
 * validates and stores. Signing is never required.
 */
export function SignaturePad({
  onChange,
  name = 'signature',
  label = 'Signature',
  optionalNote = 'Optional — you can continue without signing.',
}: {
  onChange?: (value: string | null) => void;
  /** Hidden form field carrying the confirmed signature. */
  name?: string;
  label?: string;
  optionalNote?: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const last = useRef<{ x: number; y: number } | null>(null);
  const [hasInk, setHasInk] = useState(false);
  const [confirmed, setConfirmed] = useState<string | null>(null);

  const setup = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ratio = Math.max(window.devicePixelRatio || 1, 1);
    const { width, height } = canvas.getBoundingClientRect();
    canvas.width = Math.round(width * ratio);
    canvas.height = Math.round(height * ratio);
    const context = canvas.getContext('2d');
    if (!context) return;
    context.scale(ratio, ratio);
    context.lineWidth = 2.4;
    context.lineCap = 'round';
    context.lineJoin = 'round';
    context.strokeStyle = '#18181b';
  }, []);

  useEffect(() => {
    setup();
  }, [setup, confirmed]);

  function point(event: React.PointerEvent<HTMLCanvasElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }

  function start(event: React.PointerEvent<HTMLCanvasElement>) {
    event.currentTarget.setPointerCapture(event.pointerId);
    drawing.current = true;
    last.current = point(event);
  }

  function move(event: React.PointerEvent<HTMLCanvasElement>) {
    if (!drawing.current || !last.current) return;
    const context = event.currentTarget.getContext('2d');
    if (!context) return;
    const next = point(event);
    const mid = { x: (last.current.x + next.x) / 2, y: (last.current.y + next.y) / 2 };
    context.beginPath();
    context.moveTo(last.current.x, last.current.y);
    context.quadraticCurveTo(last.current.x, last.current.y, mid.x, mid.y);
    context.lineTo(next.x, next.y);
    context.stroke();
    last.current = next;
    if (!hasInk) setHasInk(true);
  }

  function end() {
    drawing.current = false;
    last.current = null;
  }

  function clear() {
    const canvas = canvasRef.current;
    canvas?.getContext('2d')?.clearRect(0, 0, canvas.width, canvas.height);
    setHasInk(false);
    setConfirmed(null);
    onChange?.(null);
  }

  function confirm() {
    const canvas = canvasRef.current;
    if (!canvas || !hasInk) return;
    const value = canvas.toDataURL('image/png');
    setConfirmed(value);
    onChange?.(value);
  }

  return (
    <div className="flex flex-col gap-2">
      <input type="hidden" name={name} value={confirmed ?? ''} />
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-sm font-medium">{label}</span>
        <span className="text-xs text-muted-foreground">{optionalNote}</span>
      </div>

      {confirmed ? (
        <div className="flex items-center gap-3 rounded-md border border-success/40 bg-success/5 p-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={confirmed} alt="Your signature" className="h-16 w-auto max-w-[60%] rounded bg-white" />
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <span className="flex items-center gap-1.5 text-sm font-medium text-success">
              <Check className="size-4" />
              Signature added
            </span>
            <button type="button" onClick={clear} className="self-start text-sm text-muted-foreground underline-offset-4 hover:underline">
              Change signature
            </button>
          </div>
        </div>
      ) : (
        <>
          <div className="relative">
            <canvas
              ref={canvasRef}
              onPointerDown={start}
              onPointerMove={move}
              onPointerUp={end}
              onPointerCancel={end}
              onPointerLeave={end}
              aria-label={`${label} pad — draw with your finger or mouse`}
              role="img"
              className="block h-44 w-full cursor-crosshair touch-none rounded-md border border-dashed border-input bg-card sm:h-48"
            />
            {!hasInk ? (
              <span className="pointer-events-none absolute inset-0 flex items-center justify-center gap-2 text-sm text-muted-foreground">
                <PenLine className="size-4" />
                Sign here
              </span>
            ) : null}
            <span aria-hidden className="pointer-events-none absolute inset-x-6 bottom-9 border-b border-foreground/15" />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Button type="button" variant="outline" className="h-11" onClick={clear} disabled={!hasInk}>
              <Eraser />
              Clear
            </Button>
            <Button type="button" variant="secondary" className={cn('h-11', hasInk && 'ring-2 ring-primary/30')} onClick={confirm} disabled={!hasInk}>
              <Check />
              Confirm signature
            </Button>
          </div>
          {hasInk ? <p className="text-xs text-muted-foreground">Tap “Confirm signature” to include it.</p> : null}
        </>
      )}
    </div>
  );
}
