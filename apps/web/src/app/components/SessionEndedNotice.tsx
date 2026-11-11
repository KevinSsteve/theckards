"use client";

import { useEffect, useRef, useState } from "react";
import { SESSION_ENDED_EVENT, sessionWatch } from "./session-watch";

/**
 * Tells the person their session ended, once, and gives them the way back.
 *
 * Focus moves to the notice when it appears. Nothing else on the page can be saved at that point, so this is the
 * one interruption worth taking focus for, and it guarantees the message is seen even when the person is scrolled
 * far down a long record. It sits in the page flow rather than floating over it, so it never covers a control.
 */
export function SessionEndedNotice() {
  const [ended, setEnded] = useState(false);
  const notice = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (sessionWatch().ended()) setEnded(true);
    const onEnded = () => setEnded(true);
    window.addEventListener(SESSION_ENDED_EVENT, onEnded);
    return () => window.removeEventListener(SESSION_ENDED_EVENT, onEnded);
  }, []);

  useEffect(() => {
    if (!ended) return;
    notice.current?.scrollIntoView({ block: "start" });
    notice.current?.focus();
  }, [ended]);

  if (!ended) return null;
  // The login route accepts this page as the place to come back to; anything it does not accept goes to /account.
  const next = encodeURIComponent(window.location.pathname);
  return <div className="notice" role="alert" tabIndex={-1} ref={notice}>
    <strong>Your session has ended.</strong> This page has stopped updating and cannot save changes.{" "}
    <a href={`/api/auth/login?next=${next}`}>Sign in again</a> to continue where you were.
  </div>;
}
