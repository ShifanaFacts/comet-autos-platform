'use client';

import { usePathname, useRouter } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { NAV_GROUPS } from '@/lib/nav';

/** Every page the menu opens directly: those need no back button. */
const MENU_PATHS = new Set(
  NAV_GROUPS.flatMap((group) => group.items).map((item) => item.href.split('?')[0]),
);

/** The menu section a page sits under, for when there is no page to go back to. */
function sectionOf(pathname: string) {
  let best = '/';
  for (const path of MENU_PATHS) {
    if (path !== '/' && pathname.startsWith(`${path}/`) && path.length > best.length) best = path;
  }
  return best;
}

/**
 * Back — on every page below the menu: a job card, an invoice, a form. Goes
 * to the page the user came from; opened directly (a shared link, a new
 * tab), it goes up to the page's menu section instead.
 */
export function BackButton() {
  const pathname = usePathname();
  const router = useRouter();
  if (pathname === '/' || MENU_PATHS.has(pathname)) return null;

  return (
    <button
      type="button"
      onClick={() => {
        if (window.history.length > 1) router.back();
        else router.push(sectionOf(pathname));
      }}
      className="flex h-10 shrink-0 items-center gap-1.5 rounded-lg px-2.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none sm:px-3"
      aria-label="Back"
    >
      <ArrowLeft className="size-4" />
      <span className="hidden sm:inline">Back</span>
    </button>
  );
}
