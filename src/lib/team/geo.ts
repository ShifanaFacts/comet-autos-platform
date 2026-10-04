/*
 * Where someone is, measured against where the workshop is.
 *
 * Pure functions only — no database, no session — so the phone can show
 * "you are 40 m from the workshop" with exactly the rule the server then
 * enforces, and the rule can be unit-tested.
 */

export interface Position {
  latitude: number;
  longitude: number;
  /** The phone's own estimate of how far off it may be, in metres. */
  accuracy: number;
}

export interface Fence {
  latitude: number;
  longitude: number;
  radiusM: number;
}

/** Above this the phone is guessing (Wi-Fi or cell towers only): ask for a better fix. */
export const MAX_ACCURACY_M = 150;

/**
 * How much of the phone's own uncertainty is given the benefit of the doubt.
 * Someone standing at the far wall with a ±40 m fix is let in; someone a
 * kilometre away with a ±1 km fix is not.
 */
const ACCURACY_ALLOWANCE_M = 50;

/** Great-circle distance in metres (haversine). Plenty exact at workshop scale. */
export function distanceM(a: { latitude: number; longitude: number }, b: { latitude: number; longitude: number }): number {
  const R = 6_371_000;
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(b.latitude - a.latitude);
  const dLon = toRad(b.longitude - a.longitude);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.latitude)) * Math.cos(toRad(b.latitude)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

export type FenceCheck =
  | { ok: true; distanceM: number }
  | { ok: false; reason: 'imprecise' | 'outside'; distanceM: number };

/** Whether a position counts as "at the workshop". */
export function checkFence(position: Position, fence: Fence): FenceCheck {
  const distance = Math.round(distanceM(position, fence));
  if (!(position.accuracy >= 0) || position.accuracy > MAX_ACCURACY_M) {
    return { ok: false, reason: 'imprecise', distanceM: distance };
  }
  const allowance = Math.min(position.accuracy, ACCURACY_ALLOWANCE_M);
  if (distance > fence.radiusM + allowance) {
    return { ok: false, reason: 'outside', distanceM: distance };
  }
  return { ok: true, distanceM: distance };
}

/** "40 m", "1.2 km". */
export function formatDistance(metres: number): string {
  if (metres < 1000) return `${Math.round(metres)} m`;
  return `${(metres / 1000).toFixed(metres < 10_000 ? 1 : 0)} km`;
}

const valid = (latitude: number, longitude: number) =>
  Number.isFinite(latitude) &&
  Number.isFinite(longitude) &&
  Math.abs(latitude) <= 90 &&
  Math.abs(longitude) <= 180 &&
  !(latitude === 0 && longitude === 0);

/**
 * Reads a position out of what someone pastes: "25.2862, 55.3890", or a
 * Google Maps link ("…/@25.2862,55.3890,17z", "…?q=25.2862,55.3890",
 * "…!3d25.2862!4d55.3890"). Short links (maps.app.goo.gl) carry no
 * position until opened, so they are not understood — open, then copy.
 */
export function parseCoordinates(text: string): { latitude: number; longitude: number } | null {
  const value = text.trim();
  if (!value) return null;
  const patterns = [
    // The pin itself, when the link has one — more exact than the view centre.
    /!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)/,
    /[?&](?:q|query|ll|destination)=(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)/,
    /@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/,
    /^(-?\d+(?:\.\d+)?)\s*[, ]\s*(-?\d+(?:\.\d+)?)$/,
  ];
  for (const pattern of patterns) {
    const match = value.match(pattern);
    if (!match) continue;
    const latitude = Number(match[1]);
    const longitude = Number(match[2]);
    if (valid(latitude, longitude)) {
      return { latitude: Number(latitude.toFixed(6)), longitude: Number(longitude.toFixed(6)) };
    }
  }
  return null;
}

/** A link that opens the position in Google Maps, to check it is the right building. */
export function mapsLink(position: { latitude: number; longitude: number }): string {
  return `https://www.google.com/maps/search/?api=1&query=${position.latitude},${position.longitude}`;
}

/** "HH:MM" in Dubai on a calendar date ("2026-10-04"), as an instant. */
export function dubaiTimeOn(dateKey: string, time: string): Date {
  return new Date(`${dateKey}T${time}:00+04:00`);
}
