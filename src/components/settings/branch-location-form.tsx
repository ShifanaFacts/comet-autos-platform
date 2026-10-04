'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Crosshair, ExternalLink, Loader2, MapPin, Save } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { FormError, TextField } from '@/components/forms/fields';
import { SubmitButton } from '@/components/forms/submit-button';
import { useFormAction } from '@/components/forms/use-form-action';
import type { ActionResult } from '@/lib/errors';
import { formatDistance, mapsLink, parseCoordinates } from '@/lib/team/geo';
import { updateBranchLocationAction } from '@/app/(app)/settings/actions';

const INPUT = '[&_input]:h-11 [&_input]:text-base md:[&_input]:text-sm';

/*
 * Where the workshop is, for checking in from a phone.
 *
 * The surest way to set it: stand inside the workshop with a phone and tap
 * "Use where I am now". Or paste the position from Google Maps (a pin's
 * link, or "25.28, 55.38"). The link under the fields opens the saved spot
 * in Google Maps, to check it is the right building.
 */
export function BranchLocationForm({
  branch,
}: {
  branch: {
    id: string;
    fence: { latitude: number; longitude: number; radiusM: number } | null;
    radiusM: number;
    shiftEndTime: string;
  };
}) {
  const router = useRouter();
  const [latitude, setLatitude] = useState(branch.fence ? String(branch.fence.latitude) : '');
  const [longitude, setLongitude] = useState(branch.fence ? String(branch.fence.longitude) : '');
  const [paste, setPaste] = useState('');
  const [locating, setLocating] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [state, onSubmit, isPending] = useFormAction<ActionResult>(
    async (prev, formData) => {
      const result = await updateBranchLocationAction(branch.id, prev, formData);
      if (result.ok) {
        toast.success('Location lock saved');
        router.refresh();
      }
      return result;
    },
    { ok: false },
  );
  const errors = state.fieldErrors ?? {};
  const id = (name: string) => `${name}-loc-${branch.id}`;

  function useHere() {
    setNote(null);
    if (!navigator.geolocation) {
      setNote('This browser can’t share its location.');
      return;
    }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setLocating(false);
        setLatitude(position.coords.latitude.toFixed(6));
        setLongitude(position.coords.longitude.toFixed(6));
        setNote(
          `Got it, to within ${formatDistance(position.coords.accuracy)}.${position.coords.accuracy > 50 ? ' That is rough — try again standing outside, or near the middle of the workshop.' : ''} Save to keep it.`,
        );
      },
      () => {
        setLocating(false);
        setNote('Location was refused or not found. Allow location for this site and try again.');
      },
      { enableHighAccuracy: true, timeout: 25_000, maximumAge: 0 },
    );
  }

  function applyPaste(value: string) {
    setPaste(value);
    const position = parseCoordinates(value);
    if (position) {
      setLatitude(String(position.latitude));
      setLongitude(String(position.longitude));
      setNote('Position read from what you pasted. Save to keep it.');
    }
  }

  const lat = Number(latitude);
  const lng = Number(longitude);
  const valid = latitude !== '' && longitude !== '' && Number.isFinite(lat) && Number.isFinite(lng);

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-6 @container">
      {!branch.fence ? (
        <p className="rounded-lg border border-warning/30 bg-warning/5 px-3 py-2.5 text-sm text-warning">
          Not set yet — until it is, nobody can check in from their phone.
        </p>
      ) : null}
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" variant="outline" className="h-11" onClick={useHere} disabled={locating}>
          {locating ? <Loader2 className="animate-spin" /> : <Crosshair />}
          Use where I am now
        </Button>
        <span className="text-xs text-muted-foreground">Stand inside the workshop when you tap this.</span>
      </div>
      <TextField
        id={id('paste')}
        name="paste"
        label="Or paste from Google Maps"
        placeholder="A Google Maps link, or 25.28, 55.38"
        value={paste}
        onChange={(event) => applyPaste(event.target.value)}
        hint="In Google Maps: long-press the workshop → copy the numbers shown, or Share → Copy link (open short links first)."
        className={INPUT}
      />
      <div className="grid grid-cols-1 gap-6 @lg:grid-cols-2">
        <TextField
          id={id('latitude')}
          name="latitude"
          label="Latitude"
          inputMode="decimal"
          value={latitude}
          onChange={(event) => setLatitude(event.target.value)}
          error={errors.latitude}
          required
          className={INPUT}
        />
        <TextField
          id={id('longitude')}
          name="longitude"
          label="Longitude"
          inputMode="decimal"
          value={longitude}
          onChange={(event) => setLongitude(event.target.value)}
          error={errors.longitude}
          required
          className={INPUT}
        />
        <TextField
          id={id('radius')}
          name="radius"
          label="Allowed distance (metres)"
          inputMode="numeric"
          defaultValue={String(branch.radiusM)}
          error={errors.radius}
          hint="150 m suits most workshops. Phone GPS indoors can be 20–50 m off."
          className={INPUT}
        />
        <TextField
          id={id('shift')}
          name="shiftEndTime"
          label="Working day ends at"
          type="time"
          defaultValue={branch.shiftEndTime}
          error={errors.shiftEndTime}
          hint="A day nobody checked out of is closed at this time, and flagged for you to confirm."
          className={INPUT}
        />
      </div>
      {note ? <p className="text-sm text-muted-foreground">{note}</p> : null}
      {valid ? (
        <a
          href={mapsLink({ latitude: lat, longitude: lng })}
          target="_blank"
          rel="noreferrer"
          className="inline-flex w-fit items-center gap-1.5 text-sm text-primary hover:underline"
        >
          <MapPin className="size-4" />
          Check this spot on Google Maps
          <ExternalLink className="size-3.5" />
        </a>
      ) : null}
      <FormError message={Object.keys(errors).length ? undefined : state.error} />
      <div>
        <SubmitButton pending={isPending} className="h-11" pendingLabel="Saving…">
          <Save />
          Save location lock
        </SubmitButton>
      </div>
    </form>
  );
}
