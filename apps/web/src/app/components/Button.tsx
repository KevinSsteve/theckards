"use client";

import type { ButtonHTMLAttributes, MouseEvent, MouseEventHandler } from "react";

/**
 * A button that stays focusable while its action runs (docs/accessibility.md).
 *
 * The usual pattern, `disabled={busy}`, disables the very button the user just pressed. A disabled element cannot
 * hold focus, so the browser drops focus to the page body: a keyboard user loses their place, and a screen reader
 * has nothing to announce. Measured in production on /verify before this existed: pressing "Verify hash" moved
 * focus to BODY, and it was still there after the result appeared.
 *
 * Busy is expressed with `aria-disabled` and `aria-busy` instead, and activation is refused while busy. That also
 * covers pressing Enter in a field of the same form, because implicit submission fires a click on the form's
 * default button, and that click is cancelled here, so a busy form cannot be submitted twice.
 *
 * `disabled` keeps its ordinary meaning: a control that cannot be used yet because the form is incomplete.
 */
export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  busy?: boolean;
}

/** The click handler a busy button uses: cancel the activation, including a form submission, and do nothing else. */
export function refuseWhileBusy(busy: boolean, onClick?: MouseEventHandler<HTMLButtonElement>): MouseEventHandler<HTMLButtonElement> {
  return (event: MouseEvent<HTMLButtonElement>) => {
    if (busy) {
      event.preventDefault();
      return;
    }
    onClick?.(event);
  };
}

export function Button({ busy = false, onClick, ...rest }: ButtonProps) {
  return <button {...rest} aria-disabled={busy || undefined} aria-busy={busy || undefined} onClick={refuseWhileBusy(busy, onClick)} />;
}
