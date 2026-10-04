import { AuthError, requireUser } from '@/lib/auth/authorize';
import { getLiveBoard, type LiveBoard } from '@/lib/workshop/live-board';
import { AccessDenied } from '@/components/shared/access-denied';
import { LiveBoardView } from '@/components/team/live-board-view';

export const dynamic = 'force-dynamic';

export default async function LivePage() {
  const user = await requireUser();
  let board: LiveBoard;
  try {
    board = await getLiveBoard(user);
  } catch (error) {
    if (error instanceof AuthError) return <AccessDenied what="the live workshop board" />;
    throw error;
  }
  return <LiveBoardView board={board} audience="staff" />;
}
