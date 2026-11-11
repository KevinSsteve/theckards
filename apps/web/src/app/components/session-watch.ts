/**
 * Notices when the signed-in session ends while a page is open (docs/accessibility.md).
 *
 * The agreement page keeps itself up to date by polling. When the session ends underneath it (it expired, the
 * person signed out in another tab, or the account was disabled), every poll returns 401. Measured in production
 * before this existed: thirteen failed requests in 31 seconds, and the only thing on screen was "The record could
 * not be loaded", with no way back. The page looked alive and was not.
 *
 * Every client fetch on that page passes its response through `check`. The first 401 marks the session as ended
 * and announces it once; from then on the panels stop polling, and `SessionEndedNotice` tells the person what
 * happened and how to sign in again.
 */
export const SESSION_ENDED_EVENT = "theckards:session-ended";

export interface SessionWatch {
  /** True once any request has come back 401. */
  ended(): boolean;
  /** False when this response means the session has ended. The first such response announces it. */
  check(response: Response): boolean;
}

export function createSessionWatch(target: EventTarget): SessionWatch {
  let ended = false;
  return {
    ended: () => ended,
    check(response) {
      if (response.status !== 401) return true;
      if (!ended) {
        ended = true;
        target.dispatchEvent(new Event(SESSION_ENDED_EVENT));
      }
      return false;
    },
  };
}

let pageWatch: SessionWatch | undefined;

/** The watch for this page. Only called from browser code, where `window` exists. */
export function sessionWatch(): SessionWatch {
  pageWatch ??= createSessionWatch(window);
  return pageWatch;
}
