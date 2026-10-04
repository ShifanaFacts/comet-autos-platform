import type { Metadata } from 'next';
import { getDisplayBoard } from '@/lib/workshop/live-board';
import { LiveBoardView } from '@/components/team/live-board-view';

/*
 * The waiting-area TV. No sign-in: the link's secret is the key, made and
 * revoked in Settings. It shows plates, cars and where each one stands —
 * never names, numbers, prices or notes (lib/workshop/live-board.ts).
 */

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Live status',
  robots: { index: false, follow: false },
};

export default async function DisplayPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const board = await getDisplayBoard(token);
  if (!board) {
    return (
      <main className="flex min-h-dvh items-center justify-center bg-background p-8 text-center">
        <div className="flex max-w-md flex-col gap-2">
          <h1 className="text-2xl font-semibold">This screen’s link isn’t active</h1>
          <p className="text-muted-foreground">
            It was replaced or switched off. Make a new TV link in Settings and open it on this screen.
          </p>
        </div>
      </main>
    );
  }
  return (
    <main className="bg-background">
      <LiveBoardView board={board} audience="public" />
    </main>
  );
}
