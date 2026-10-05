'use server';

import { headers } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { requireUser } from '@/lib/auth/authorize';
import { runAction, toClientResult } from '@/lib/action';
import type { ActionResult } from '@/lib/errors';
import {
  countUnread,
  dismissAll,
  dismissNotification,
  listMyNotifications,
  markAllRead,
  removePushSubscription,
  savePushSubscription,
} from '@/lib/notifications/service';

/*
 * The bell's actions. Each one is the signed-in person's own notifications
 * only — the service scopes every query to their login.
 */

/** The list, read when the bell is opened (not on every page). */
export async function loadNotificationsAction() {
  const user = await requireUser();
  const [items, unread] = await Promise.all([listMyNotifications(user), countUnread(user)]);
  return {
    unread,
    items: items.map((item) => ({ ...item, createdAt: item.createdAt.toISOString(), read: item.readAt !== null })),
  };
}

export async function dismissNotificationAction(id: string): Promise<ActionResult> {
  const user = await requireUser();
  return toClientResult(await runAction(() => dismissNotification(user, id)));
}

export async function dismissAllAction(): Promise<ActionResult> {
  const user = await requireUser();
  return toClientResult(await runAction(() => dismissAll(user)));
}

export async function markAllReadAction(): Promise<ActionResult> {
  const user = await requireUser();
  const result = await runAction(() => markAllRead(user));
  if (result.ok) revalidatePath('/', 'layout');
  return toClientResult(result);
}

/** This device agreed to notifications: remember where to push them. */
export async function savePushSubscriptionAction(subscription: unknown): Promise<ActionResult> {
  const user = await requireUser();
  const agent = (await headers()).get('user-agent');
  return toClientResult(await runAction(() => savePushSubscription(user, subscription, agent)));
}

export async function removePushSubscriptionAction(endpoint: string): Promise<ActionResult> {
  const user = await requireUser();
  return toClientResult(await runAction(() => removePushSubscription(user, endpoint)));
}
