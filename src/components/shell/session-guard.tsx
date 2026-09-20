'use client';

import { useEffect } from 'react';

/**
 * Stops the browser's back/forward cache from showing a signed-in page after
 * sign-out: when a page is restored from that cache, it is reloaded, so the
 * server checks the session again and sends a signed-out user to login.
 */
export function SessionGuard() {
  useEffect(() => {
    function onPageShow(event: PageTransitionEvent) {
      if (event.persisted) window.location.reload();
    }
    window.addEventListener('pageshow', onPageShow);
    return () => window.removeEventListener('pageshow', onPageShow);
  }, []);
  return null;
}
