import webpush from 'web-push';
import { prisma } from '@/lib/prisma';

/*
 * Web Push: a message to a phone or browser even when the app is closed.
 *
 * Each device that turned notifications on handed over a subscription
 * (an address at its browser's push service, and two keys). The server
 * signs each message with the workshop's VAPID key pair — set once in the
 * environment (VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT) — and
 * the browser's push service delivers it to the service worker (public/sw.js),
 * which shows it.
 *
 * Sending never fails the thing that caused it: a task is saved whether or
 * not a phone could be reached. A subscription the push service says is gone
 * (404/410: the app was uninstalled, permission withdrawn) is deleted.
 */

export interface PushPayload {
  /** The notification's id, so a tap can mark it read. */
  id: string;
  kind: string;
  title: string;
  body: string | null;
  href: string | null;
}

let configured: boolean | null = null;

/** Whether push is set up on this server (the VAPID keys are present). */
export function pushConfigured(): boolean {
  if (configured !== null) return configured;
  const { VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY } = process.env;
  if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) {
    configured = false;
    return false;
  }
  // The subject must be a mailto: or https: address; a bare email is taken as mailto:.
  const subject = process.env.VAPID_SUBJECT?.trim() || 'mailto:notifications@comet-autos.app';
  try {
    webpush.setVapidDetails(
      /^(mailto:|https?:)/i.test(subject) ? subject : `mailto:${subject}`,
      VAPID_PUBLIC_KEY,
      VAPID_PRIVATE_KEY,
    );
    configured = true;
  } catch (error) {
    // A mistyped key turns push off; it must never take a page down with it.
    console.error('Push notifications are off: the VAPID settings are not valid.', (error as Error).message);
    configured = false;
  }
  return configured;
}

/** The public half of the key pair, which a browser needs to subscribe. */
export function vapidPublicKey(): string | null {
  return pushConfigured() ? process.env.VAPID_PUBLIC_KEY! : null;
}

/** Sends one message to every device of one person. Never throws. */
export async function pushToUser(organizationId: string, userId: string, payload: PushPayload) {
  if (!pushConfigured()) return;
  const subscriptions = await prisma.pushSubscription.findMany({
    where: { organizationId, userId },
    select: { id: true, endpoint: true, p256dh: true, auth: true },
  });
  await Promise.all(
    subscriptions.map(async (subscription) => {
      try {
        await webpush.sendNotification(
          { endpoint: subscription.endpoint, keys: { p256dh: subscription.p256dh, auth: subscription.auth } },
          JSON.stringify(payload),
          // An hour to reach a phone that is off or out of signal; then it is stale.
          { TTL: 60 * 60, urgency: 'high', topic: payload.kind.slice(0, 32) },
        );
        await prisma.pushSubscription.update({
          where: { id: subscription.id },
          data: { lastSuccessAt: new Date() },
        });
      } catch (error) {
        const status = (error as { statusCode?: number }).statusCode;
        if (status === 404 || status === 410) {
          await prisma.pushSubscription.delete({ where: { id: subscription.id } }).catch(() => {});
        } else {
          console.error('Push notification failed', status ?? error);
        }
      }
    }),
  );
}
