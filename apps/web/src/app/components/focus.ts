import { useEffect, useRef } from "react";

/**
 * Moves focus to an element whenever `key` changes to a truthy value (docs/accessibility.md).
 *
 * Several actions replace the control that triggered them: "Show QR code" becomes the QR code, "Sign" becomes the
 * code to show the other party, "Open a case" becomes the form, "Declare" becomes the declaration. Removing the
 * focused element drops focus to the page body, the same defect `Button` avoids while a request runs. This puts
 * focus on the first thing the person needs next, which is also what a screen reader then announces.
 *
 * Headings and paragraphs given this ref need `tabIndex={-1}`: focusable by script, not added to the Tab order.
 * Nothing is focused on first render, so loading a page never moves focus.
 */
export function useFocusAfter<T extends HTMLElement>(key: unknown) {
  const ref = useRef<T>(null);
  useEffect(() => {
    if (key) ref.current?.focus();
  }, [key]);
  return ref;
}
